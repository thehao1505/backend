import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common'
import { Job } from 'bullmq'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Post, User, UserActivity, UserActivityType } from '@entities/index'
import { QdrantService, RedisService } from '@modules/index-service'
import { EmbeddingService } from './embedding.service'
import { configs } from '@utils/configs/config'
import { VectorUtil } from '@utils/utils'

export enum EmbeddingJobName {
  POST = 'process-post-embedding',
  USER_PROFILE = 'process-profile-user-embedding',
  USER_PERSONA = 'process-persona-user-embedding',
}

const INTERACTION_WEIGHTS: { [key: string]: number } = {
  // --- Passive ---
  [UserActivityType.POST_VIEW]: 0.05,
  [UserActivityType.POST_CLICK]: 0.1,

  // --- Active Light ---
  [UserActivityType.LIKE]: 0.2,
  [UserActivityType.SEARCH]: 0.3,

  // --- Active Heavy ---
  [UserActivityType.SHARE]: 0.35,
  [UserActivityType.REPLY_POST]: 0.4,

  // --- Negative ---
  [UserActivityType.UNLIKE]: -0.3,

  // --- Default ---
  DEFAULT: 0.1,
}

@Processor('embedding')
@Injectable()
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name)
  private readonly LOCK_TTL = 30 // seconds - thời gian lock tối đa
  private readonly LOCK_RETRY_DELAY = 100 // ms - thời gian chờ giữa các lần retry
  private readonly LOCK_MAX_RETRIES = 30 // số lần retry tối đa (30 * 100ms = 3s)

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly qdrantService: QdrantService,
    @Inject(forwardRef(() => RedisService)) private readonly redisService: RedisService,
    @InjectModel(Post.name) private postModel: Model<Post>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(UserActivity.name) private userActivityModel: Model<UserActivity>,
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { name, data } = job

    try {
      switch (name) {
        case EmbeddingJobName.POST:
          return this.handlePostEmbedding(data.postId)
        case EmbeddingJobName.USER_PROFILE:
          return this.handleUserProfileEmbedding(data.userId)
        case EmbeddingJobName.USER_PERSONA:
          return this.handleUserPersonaUpdate(data.activityId, data.vector)
        default:
          this.logger.warn(`Unknown job name: ${name}`)
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${name}: ${error.message}`, error.stack)
      throw error
    }
  }

  // --- Handlers ---

  private async handlePostEmbedding(postId: string) {
    this.logger.log(`Processing embedding for post: ${postId}`)

    // Lock theo postId để tránh race condition khi nhiều job cùng embed 1 post
    const lockKey = `embed:post:${postId}`
    await this.withLock(lockKey, async () => {
      // Query lại post trong lock để đảm bảo data consistency
      const post = await this.postModel.findById(postId).lean()
      if (!post) throw new Error(`Post not found: ${postId}`)

      // Double-check: Kiểm tra lại xem post đã được embed chưa (có thể đã được embed bởi job khác)
      if (post.isEmbedded) {
        this.logger.log(`Post ${postId} already embedded. Skipping.`)
        return
      }

      await this.embedPost(post)

      await this.postModel.findByIdAndUpdate(postId, {
        $set: { isEmbedded: true, lastEmbeddedAt: new Date() },
      })
    })

    return { success: true, postId }
  }

  private async handleUserProfileEmbedding(userId: string) {
    this.logger.log(`Processing embedding for user: ${userId}`)

    // Lock theo userId để tránh race condition khi nhiều job cùng embed 1 user
    const lockKey = `embed:user:${userId}`
    await this.withLock(lockKey, async () => {
      // Query lại user trong lock để đảm bảo data consistency
      const user = await this.userModel.findById(userId).lean()
      if (!user) throw new Error(`User not found: ${userId}`)

      // Double-check: Kiểm tra lại xem user đã được embed chưa (có thể đã được embed bởi job khác)
      if (user.isEmbedded) {
        this.logger.log(`User ${userId} already embedded. Skipping.`)
        return
      }

      await this.embedUser(user)
    })

    return { success: true, userId }
  }

  private async handleUserPersonaUpdate(activityId: string, vector?: number[]) {
    this.logger.log(`Processing persona update for activity: ${activityId}`)

    // Query activity trước để lấy userId cho lock key
    const activity = await this.userActivityModel.findById(activityId)
    if (!activity) throw new Error(`UserActivity not found: ${activityId}`)
    if (activity.isEmbedded) {
      this.logger.warn(`Activity ${activityId} already processed.`)
      return
    }

    // Lock theo userId để tránh race condition khi nhiều activity cùng update vector của 1 user
    const lockKey = `embed:user:${activity.userId.toString()}`
    await this.withLock(lockKey, async () => {
      // Double-check: Query lại activity trong lock để đảm bảo chưa được process bởi job khác
      const currentActivity = await this.userActivityModel.findById(activityId)
      if (!currentActivity) {
        this.logger.warn(`Activity ${activityId} not found during lock. Skipping.`)
        return
      }
      if (currentActivity.isEmbedded) {
        this.logger.warn(`Activity ${activityId} already processed by another job. Skipping.`)
        return
      }

      await this.updateUserEmbeddingFromActivity(currentActivity, vector)
    })

    return { success: true, activityId }
  }

  // --- Core Logic ---

  private async updateUserEmbeddingFromActivity(activity: UserActivity, vector?: number[]) {
    const { userId, postId, userActivityType } = activity
    const weight = INTERACTION_WEIGHTS[userActivityType] || INTERACTION_WEIGHTS['DEFAULT']

    let signalVector: number[] | null = null

    if (userActivityType === UserActivityType.SEARCH) {
      signalVector = vector ? vector : await this.embeddingService.generateEmbedding(activity.searchText)
    } else if (postId) {
      signalVector = await this.getVector(configs.postCollectionName, postId.toString())
    }

    if (!signalVector) {
      this.logger.warn(`No signal vector found for activity ${activity._id}. Skipping.`)
      return
    }

    const currentUserVector = await this.getVector(configs.userCollectionName, userId.toString())
    const newUserVector = this.calculateNewUserVector(currentUserVector, signalVector, weight)
    const contentLog = `Update: ${userActivityType} (w=${weight}) via ${activity._id}`

    await this.qdrantService.upsertVector(configs.userCollectionName, userId.toString(), newUserVector, {
      userId: userId.toString(),
      last_update_reason: contentLog,
    })

    activity.isEmbedded = true
    activity.lastEmbeddedAt = new Date()
    await activity.save()

    this.logger.log(`Updated user ${userId} vector based on ${userActivityType}`)
  }

  private calculateNewUserVector(oldVector: number[] | null, signalVector: number[], weight: number): number[] {
    // Case 1: User mới tinh chưa có vector -> Lấy luôn vector signal làm gốc
    if (!oldVector || oldVector.length === 0) {
      return VectorUtil.normalize(signalVector)
    }

    // Case 2: Vector size lệch (Lỗi model cũ/mới) -> Reset theo cái mới
    if (oldVector.length !== signalVector.length) {
      this.logger.warn('Vector dimensions mismatch. Overwriting with new signal.')
      return VectorUtil.normalize(signalVector)
    }

    // Case 3: Cập nhật (Weighted Update)
    // Công thức: V_new = V_old + (V_signal * weight)
    // Nếu weight âm (Dislike), nó sẽ tự động trừ
    let newVector = VectorUtil.weightedAdd(oldVector, signalVector, weight)

    // Case 3.1: Time Decay (Tùy chọn - Để user quên dần sở thích cũ quá lâu)
    const DECAY_FACTOR = 0.99
    newVector = VectorUtil.weightedAdd(newVector, oldVector, DECAY_FACTOR - 1)

    // QUAN TRỌNG: Phải chuẩn hóa lại về Unit Vector
    return VectorUtil.normalize(newVector)
  }

  private async embedUser(user: User) {
    if (!user.persona || user.persona.length < 1) {
      this.logger.warn(`User ${user._id} has no persona. Skipping.`)
      return
    }

    const personaText = user.persona.join(', ')
    const contentToEmbed = `User profile with interests in: ${personaText}`

    const embedding = await this.embeddingService.generateEmbedding(contentToEmbed)

    const normalizedEmbedding = VectorUtil.normalize(embedding)

    await this.qdrantService.upsertVector(configs.userCollectionName, user._id.toString(), normalizedEmbedding, {
      userId: user._id.toString(),
      content: contentToEmbed,
      persona: user.persona,
      type: 'long-term-interest',
    })

    await this.userModel.findByIdAndUpdate(user._id, {
      $set: { isEmbedded: true, lastEmbeddedAt: new Date() },
    })
  }

  private async embedPost(post: Post) {
    // Cải tiến: Xử lý lỗi từng ảnh một (Promise.allSettled)
    // Tránh việc 1 ảnh lỗi làm chết cả hàm
    const imagePromises = post.images.map(img => this.embeddingService.generateImageAnalysis(img))
    const results = await Promise.allSettled(imagePromises)

    const validDescriptions = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map(r => r.value)

    // Log warning nếu có ảnh lỗi
    const failedCount = results.filter(r => r.status === 'rejected').length
    if (failedCount > 0) this.logger.warn(`Post ${post._id} has ${failedCount} failed image analyses.`)

    // Ghép content + image description
    let rawContent = `${post.content || ''} \nDescriptions: ${validDescriptions.join('. ')}`

    // Cải tiến: Truncate text nếu quá dài (Ví dụ model giới hạn 8192 tokens ~ 24000 chars)
    if (rawContent.length > 20000) {
      rawContent = rawContent.substring(0, 20000)
    }

    const embedding = await this.embeddingService.generateEmbedding(rawContent)
    const normalizedEmbedding = VectorUtil.normalize(embedding)

    await this.qdrantService.upsertVector(configs.postCollectionName, post._id.toString(), normalizedEmbedding, {
      postId: post._id.toString(),
      content: rawContent.substring(0, 500), // Chỉ lưu đoạn đầu vào payload để tiết kiệm RAM Qdrant
      author: post.author,
      createdAt: post.createdAt,
    })
  }

  // --- Helpers ---
  private async getVector(collectionName: string, id: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(collectionName, id)
      if (!result || !Array.isArray(result.vector)) return null
      return result.vector as number[]
    } catch (error) {
      return null
    }
  }

  // --- Lock Management ---
  /**
   * Acquire distributed lock using Redis SET NX EX
   * @param lockKey - Unique key for the lock (e.g., "embed:user:userId")
   * @returns lock token if acquired, null otherwise
   */
  private async acquireLock(lockKey: string): Promise<string | null> {
    const lockToken = `${Date.now()}-${Math.random()}`
    const lockRedisKey = `lock:${lockKey}`

    try {
      // SET key value NX EX ttl - chỉ set nếu key chưa tồn tại, với expiration
      const result = await this.redisService.client.set(lockRedisKey, lockToken, 'EX', this.LOCK_TTL, 'NX')
      if (result === 'OK') {
        this.logger.debug(`Acquired lock: ${lockKey}`)
        return lockToken
      }
      return null
    } catch (error) {
      this.logger.error(`Failed to acquire lock ${lockKey}: ${error.message}`)
      return null
    }
  }

  /**
   * Release distributed lock - chỉ release nếu lock token khớp (tránh release lock của process khác)
   * @param lockKey - Unique key for the lock
   * @param lockToken - Token returned from acquireLock
   */
  private async releaseLock(lockKey: string, lockToken: string): Promise<void> {
    const lockRedisKey = `lock:${lockKey}`

    try {
      // Lua script để đảm bảo atomicity: chỉ delete nếu value khớp
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `
      const result = await this.redisService.client.eval(script, 1, lockRedisKey, lockToken)
      if (result === 1) {
        this.logger.debug(`Released lock: ${lockKey}`)
      } else {
        this.logger.warn(`Lock ${lockKey} was not released (token mismatch or already released)`)
      }
    } catch (error) {
      this.logger.error(`Failed to release lock ${lockKey}: ${error.message}`)
    }
  }

  /**
   * Acquire lock with retry mechanism
   * @param lockKey - Unique key for the lock
   * @returns lock token if acquired, throws error if max retries exceeded
   */
  private async acquireLockWithRetry(lockKey: string): Promise<string> {
    for (let attempt = 0; attempt < this.LOCK_MAX_RETRIES; attempt++) {
      const lockToken = await this.acquireLock(lockKey)
      if (lockToken) {
        return lockToken
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, this.LOCK_RETRY_DELAY))
    }

    throw new Error(`Failed to acquire lock ${lockKey} after ${this.LOCK_MAX_RETRIES} attempts`)
  }

  /**
   * Execute function with distributed lock
   * @param lockKey - Unique key for the lock
   * @param fn - Function to execute while holding the lock
   */
  private async withLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const lockToken = await this.acquireLockWithRetry(lockKey)

    try {
      return await fn()
    } finally {
      await this.releaseLock(lockKey, lockToken)
    }
  }
}
