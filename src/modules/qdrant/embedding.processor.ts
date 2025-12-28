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
  [UserActivityType.POST_VIEW]: 0.05,
  [UserActivityType.POST_CLICK]: 0.1,
  [UserActivityType.LIKE]: 0.2,
  [UserActivityType.SEARCH]: 0.3,
  [UserActivityType.SHARE]: 0.35,
  [UserActivityType.REPLY_POST]: 0.4,
  [UserActivityType.UNLIKE]: -0.3,
  DEFAULT: 0.1,
}

@Processor('embedding')
@Injectable()
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name)
  private readonly LOCK_TTL = 30
  private readonly LOCK_RETRY_DELAY = 100
  private readonly LOCK_MAX_RETRIES = 30

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

  private async handlePostEmbedding(postId: string) {
    this.logger.log(`Processing embedding for post: ${postId}`)

    const lockKey = `embed:post:${postId}`
    await this.withLock(lockKey, async () => {
      const post = await this.postModel.findById(postId).lean()
      if (!post) throw new Error(`Post not found: ${postId}`)

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

    const lockKey = `embed:user:${userId}`
    await this.withLock(lockKey, async () => {
      const user = await this.userModel.findById(userId).lean()
      if (!user) throw new Error(`User not found: ${userId}`)

      const shouldEmbed = !user.isEmbedded || !user.persona || user.persona.length === 0

      if (!shouldEmbed && user.isEmbedded) {
        this.logger.log(`User ${userId} already embedded. To refresh, update persona.`)
        return
      }

      await this.embedUser(user)
    })

    return { success: true, userId }
  }

  private async handleUserPersonaUpdate(activityId: string, vector?: number[]) {
    this.logger.log(`Processing persona update for activity: ${activityId}`)

    const activity = await this.userActivityModel.findById(activityId)
    if (!activity) throw new Error(`UserActivity not found: ${activityId}`)
    if (activity.isEmbedded) {
      this.logger.warn(`Activity ${activityId} already processed.`)
      return
    }

    const lockKey = `embed:user:${activity.userId.toString()}`
    await this.withLock(lockKey, async () => {
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

  private async updateUserEmbeddingFromActivity(activity: UserActivity, vector?: number[]) {
    const { userId, postId, userActivityType, createdAt } = activity
    const weight = INTERACTION_WEIGHTS[userActivityType] || INTERACTION_WEIGHTS['DEFAULT']

    let signalVector: number[] | null = null

    if (userActivityType === UserActivityType.SEARCH) {
      signalVector = vector ? vector : await this.embeddingService.generateEmbedding(activity.searchText)
      if (signalVector) {
        signalVector = VectorUtil.normalize(signalVector)
      }
    } else if (postId) {
      signalVector = await this.getVector(configs.postCollectionName, postId.toString())
    }

    if (!signalVector) {
      this.logger.warn(`No signal vector found for activity ${activity._id}. Skipping.`)
      return
    }

    let currentShortTermVector: number[] | null = null
    let interactionCount = 0
    let isInitializing = false

    const currentData = await this.qdrantService.getVectorById(configs.userShortTermCollectionName, userId)
    if (currentData && currentData.vector) {
      currentShortTermVector = currentData.vector as number[]
      interactionCount = (currentData.payload as any)?.interaction_count || 0
    }

    const newShortTermVector = this.calculateShortTermVector(currentShortTermVector, signalVector, weight, interactionCount, isInitializing)

    const contentLog = isInitializing
      ? `Short-term initialization: ${userActivityType} (w=${weight}) via ${activity._id}`
      : `Short-term update: ${userActivityType} (w=${weight}) via ${activity._id}`

    await this.qdrantService.upsertVector(configs.userShortTermCollectionName, userId, newShortTermVector, {
      userId,
      type: 'short-term-preference',
      last_update_reason: contentLog,
      interaction_count: interactionCount + 1,
      createdAt,
      lastUpdated: new Date(),
    })

    activity.isEmbedded = true
    activity.lastEmbeddedAt = new Date()
    await activity.save()

    if (isInitializing) {
      this.logger.log(`Initialized short-term vector for user ${userId} based on ${userActivityType} (first interaction)`)
    } else {
      this.logger.log(
        `Updated short-term vector for user ${userId} based on ${userActivityType} (total interactions: ${interactionCount + 1})`,
      )
    }
  }

  private calculateShortTermVector(
    oldVector: number[] | null,
    signalVector: number[],
    weight: number,
    interactionCount: number = 0,
    isInitializing: boolean = false,
  ): number[] {
    if (!oldVector || oldVector.length === 0) {
      return VectorUtil.normalize(signalVector)
    }

    if (oldVector.length !== signalVector.length) {
      this.logger.warn('Vector dimensions mismatch. Overwriting with new signal.')
      return VectorUtil.normalize(signalVector)
    }

    const BASE_ALPHA = 0.3
    const WEIGHT_MULTIPLIER = 1.5

    const SATURATION_BONUS = Math.min(0.3, interactionCount / 1000)

    let alpha: number
    const absWeight = Math.abs(weight)
    const INITIALIZATION_WEIGHT_THRESHOLD = 0.2

    if (isInitializing && absWeight < INITIALIZATION_WEIGHT_THRESHOLD) {
      alpha = Math.min(0.3, BASE_ALPHA * 0.5 + absWeight * WEIGHT_MULTIPLIER)
    } else if (absWeight < 0.1) {
      alpha = Math.min(0.5, BASE_ALPHA * 0.7 + absWeight * WEIGHT_MULTIPLIER + SATURATION_BONUS)
    } else {
      alpha = Math.min(0.9, BASE_ALPHA + absWeight * WEIGHT_MULTIPLIER + SATURATION_BONUS)
    }

    const adjustedSignal = weight < 0 ? signalVector.map(v => -v) : signalVector

    const newVector = VectorUtil.exponentialMovingAverage(oldVector, adjustedSignal, alpha)

    return VectorUtil.normalize(newVector)
  }

  private calculateLongTermVector(oldVector: number[] | null, signalVector: number[], weight: number = 1.0): number[] {
    if (!oldVector || oldVector.length === 0) {
      return VectorUtil.normalize(signalVector)
    }

    if (oldVector.length !== signalVector.length) {
      this.logger.warn('Vector dimensions mismatch. Overwriting with new signal.')
      return VectorUtil.normalize(signalVector)
    }

    const BASE_ALPHA = 0.1
    const alpha = Math.min(0.3, BASE_ALPHA + Math.abs(weight) * 0.2)

    const newVector = VectorUtil.exponentialMovingAverage(oldVector, signalVector, alpha)
    return VectorUtil.normalize(newVector)
  }

  private async embedUser(user: User) {
    try {
      if (!user.persona || user.persona.length < 1) {
        this.logger.warn(`User ${user._id} has no persona. Skipping.`)
        return
      }

      const personaText = user.persona.join(', ')
      const contentToEmbed = `User profile with interests in: ${personaText}`

      const embedding = await this.embeddingService.generateEmbedding(contentToEmbed)
      const normalizedEmbedding = VectorUtil.normalize(embedding)

      const userId = user._id.toString()

      await this.qdrantService.upsertVector(configs.userCollectionName, userId, normalizedEmbedding, {
        userId: userId,
        content: contentToEmbed,
        persona: user.persona,
        type: 'long-term-interest',
        createdAt: new Date(),
        lastUpdated: new Date(),
      })

      await this.qdrantService.upsertVector(configs.userShortTermCollectionName, userId, normalizedEmbedding, {
        userId: userId,
        type: 'short-term-preference',
        interaction_count: 0,
        createdAt: new Date(),
        lastUpdated: new Date(),
      })

      await this.userModel.findByIdAndUpdate(user._id, {
        $set: { isEmbedded: true, lastEmbeddedAt: new Date() },
      })

      this.logger.log(`Created dual vectors for user ${userId} (long-term from persona, short-term initialized)`)
    } catch (error) {
      this.logger.error(`Error embedding user ${user._id}: ${error.message}`, error)
    }
  }

  private async embedPost(post: Post) {
    const imagePromises = post.images.map(img => this.embeddingService.generateImageAnalysis(img))
    const results = await Promise.allSettled(imagePromises)

    const validDescriptions = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map(r => r.value)

    const failedCount = results.filter(r => r.status === 'rejected').length
    if (failedCount > 0) this.logger.warn(`Post ${post._id} has ${failedCount} failed image analyses.`)

    const imageDescriptions = post.images.length > 0 ? `\nDescriptions: ${validDescriptions.join('. ')}` : ''
    let rawContent = `${post.content || ''} ${imageDescriptions}`

    const embedding = await this.embeddingService.generateEmbedding(rawContent)
    const normalizedEmbedding = VectorUtil.normalize(embedding)

    await this.qdrantService.upsertVector(configs.postCollectionName, post._id.toString(), normalizedEmbedding, {
      postId: post._id.toString(),
      content: rawContent,
      author: post.author,
      createdAt: post.createdAt,
    })
  }

  private async getVector(collectionName: string, id: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(collectionName, id)
      if (!result || !Array.isArray(result.vector)) return null
      return result.vector as number[]
    } catch (error) {
      return null
    }
  }

  async refreshUserLongTermVector(userId: string) {
    const lockKey = `embed:user:${userId}`
    await this.withLock(lockKey, async () => {
      const user = await this.userModel.findById(userId).lean()
      if (!user) throw new Error(`User not found: ${userId}`)
      if (!user.persona || user.persona.length === 0) {
        this.logger.warn(`User ${userId} has no persona. Cannot refresh long-term vector.`)
        return
      }

      const personaText = user.persona.join(', ')
      const contentToEmbed = `User profile with interests in: ${personaText}`
      const embedding = await this.embeddingService.generateEmbedding(contentToEmbed)
      const newLongTermVector = VectorUtil.normalize(embedding)

      let oldLongTermVector: number[] | null = null
      let oldPayload: any = null
      try {
        const oldData = await this.qdrantService.getVectorById(configs.userCollectionName, userId)
        if (oldData && oldData.vector) {
          oldLongTermVector = oldData.vector as number[]
          oldPayload = oldData.payload
        }
      } catch (error) {}

      const finalVector =
        oldLongTermVector && oldLongTermVector.length === newLongTermVector.length
          ? this.calculateLongTermVector(oldLongTermVector, newLongTermVector, 0.5)
          : newLongTermVector

      await this.qdrantService.upsertVector(configs.userCollectionName, userId, finalVector, {
        userId: userId,
        content: contentToEmbed,
        persona: user.persona,
        type: 'long-term-interest',
        createdAt: oldPayload?.createdAt || new Date(),
        lastUpdated: new Date(),
        refreshed: true,
        refreshCount: (oldPayload?.refreshCount || 0) + 1,
      })

      this.logger.log(`Refreshed long-term vector for user ${userId}`)
    })
  }

  private async acquireLock(lockKey: string): Promise<string | null> {
    const lockToken = `${Date.now()}-${Math.random()}`
    const lockRedisKey = `lock:${lockKey}`

    try {
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

  private async releaseLock(lockKey: string, lockToken: string): Promise<void> {
    const lockRedisKey = `lock:${lockKey}`

    try {
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

  private async acquireLockWithRetry(lockKey: string): Promise<string> {
    for (let attempt = 0; attempt < this.LOCK_MAX_RETRIES; attempt++) {
      const lockToken = await this.acquireLock(lockKey)
      if (lockToken) {
        return lockToken
      }

      await new Promise(resolve => setTimeout(resolve, this.LOCK_RETRY_DELAY))
    }

    throw new Error(`Failed to acquire lock ${lockKey} after ${this.LOCK_MAX_RETRIES} attempts`)
  }

  private async withLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const lockToken = await this.acquireLockWithRetry(lockKey)

    try {
      return await fn()
    } finally {
      await this.releaseLock(lockKey, lockToken)
    }
  }
}
