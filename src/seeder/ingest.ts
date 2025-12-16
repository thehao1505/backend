import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import * as fs from 'fs'
import * as csv from 'csv-parser'
import { Model } from 'mongoose'
import { getModelToken } from '@nestjs/mongoose'
import { getQueueToken } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { Logger } from '@nestjs/common'
import { v4 as uuidv4 } from 'uuid'
import { Post, User, UserActivity, RecommendationLog, UserFollow, UserActivityType } from '@entities'
import { QdrantService } from '@modules/index-service'
import { configs } from '@utils/configs/config'
import { SEEDER_CONFIG } from './config'

const DATA_PATH = SEEDER_CONFIG.DATA_PATH
const USERS_FILE = `${DATA_PATH}/users.csv`
const POSTS_FILE = `${DATA_PATH}/posts.csv`
const TRAIN_INTERACTIONS_FILE = `${DATA_PATH}/train_interactions.csv`
const FOLLOWS_FILE = `${DATA_PATH}/follows.csv`

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const logger = new Logger('IngestScript')

  const userModel = app.get<Model<User>>(getModelToken(User.name))
  const postModel = app.get<Model<Post>>(getModelToken(Post.name))
  const userActivityModel = app.get<Model<UserActivity>>(getModelToken(UserActivity.name))
  const recLogModel = app.get<Model<RecommendationLog>>(getModelToken(RecommendationLog.name))
  const userFollowModel = app.get<Model<UserFollow>>(getModelToken(UserFollow.name))
  const embeddingQueue = app.get<Queue>(getQueueToken('embedding'))
  const qdrantService = app.get<QdrantService>(QdrantService)

  // Validate vector size configuration
  function validateVectorSize() {
    const vectorSize = Number(configs.vectorSize)
    if (!configs.vectorSize || isNaN(vectorSize) || vectorSize <= 0) {
      throw new Error(`VECTOR_SIZE phải được cấu hình và là số dương. Hiện tại: ${configs.vectorSize}. Vui lòng kiểm tra file .env`)
    }
    logger.log(`✅ Vector size validated: ${vectorSize} dimensions`)
    return vectorSize
  }

  // Create collection safely (handle AlreadyExists error)
  async function createCollectionSafely(collectionName: string, vectorSize: number) {
    try {
      await qdrantService.createCollection(collectionName)
      logger.log(`✅ Đã tạo collection ${collectionName} với vector size ${vectorSize}`)
    } catch (error) {
      // Check if error is "AlreadyExists" (có thể xảy ra nếu QdrantService.onModuleInit đã tạo)
      if (error.message && (error.message.includes('AlreadyExists') || error.message.includes('already exists'))) {
        logger.warn(`Collection ${collectionName} đã tồn tại (có thể được tạo bởi QdrantService.onModuleInit), bỏ qua`)
      } else {
        logger.error(`Lỗi khi tạo collection ${collectionName}: ${error.message}`)
        throw error
      }
    }
  }

  // Check if collection exists by trying to get it (safer approach)
  async function collectionExists(collectionName: string): Promise<boolean> {
    try {
      // Try to get collections list via Qdrant client
      // Note: This accesses private client, but it's the safest way to check existence
      const client = (qdrantService as any).client
      if (!client) {
        logger.warn('Cannot access Qdrant client to check collection existence')
        return false
      }
      const collections = await client.getCollections()
      return collections.collections.some((col: any) => col.name === collectionName)
    } catch (error) {
      logger.warn(`Error checking collection existence for ${collectionName}: ${error.message}`)
      return false
    }
  }

  async function clearDatabase() {
    logger.log('--- [Bước 0] Bắt đầu dọn dẹp DB ---')

    // Validate vector size before proceeding
    const vectorSize = validateVectorSize()

    await embeddingQueue.pause()
    logger.log('Đã tạm dừng (pause) BullMQ queue.')

    await userModel.deleteMany({})
    await postModel.deleteMany({})
    await userActivityModel.deleteMany({})
    await recLogModel.deleteMany({})
    await userFollowModel.deleteMany({})
    await embeddingQueue.obliterate({ force: true })

    // Delete Qdrant collections
    try {
      const userCollectionExists = await collectionExists(configs.userCollectionName)
      if (userCollectionExists) {
        await qdrantService.deleteCollection(configs.userCollectionName)
        logger.log(`Đã xóa collection ${configs.userCollectionName}`)
      } else {
        logger.log(`Collection ${configs.userCollectionName} không tồn tại, bỏ qua xóa`)
      }
    } catch (e) {
      logger.warn(`Không thể xóa ${configs.userCollectionName}: ${e.message}`)
    }

    try {
      const postCollectionExists = await collectionExists(configs.postCollectionName)
      if (postCollectionExists) {
        await qdrantService.deleteCollection(configs.postCollectionName)
        logger.log(`Đã xóa collection ${configs.postCollectionName}`)
      } else {
        logger.log(`Collection ${configs.postCollectionName} không tồn tại, bỏ qua xóa`)
      }
    } catch (e) {
      logger.warn(`Không thể xóa ${configs.postCollectionName}: ${e.message}`)
    }

    try {
      const userShortTermCollectionExists = await collectionExists(configs.userShortTermCollectionName)
      if (userShortTermCollectionExists) {
        await qdrantService.deleteCollection(configs.userShortTermCollectionName)
        logger.log(`Đã xóa collection ${configs.userShortTermCollectionName}`)
      } else {
        logger.log(`Collection ${configs.userShortTermCollectionName} không tồn tại, bỏ qua xóa`)
      }
    } catch (e) {
      logger.warn(`Không thể xóa ${configs.userShortTermCollectionName}: ${e.message}`)
    }

    // Wait longer to ensure Qdrant service has time to process deletion
    // and avoid race condition with QdrantService.onModuleInit
    logger.log('Đang đợi Qdrant xử lý xóa collections...')
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Create collections safely (check existence to avoid race condition)
    await createCollectionSafely(configs.userCollectionName, vectorSize)
    await createCollectionSafely(configs.postCollectionName, vectorSize)
    await createCollectionSafely(configs.userShortTermCollectionName, vectorSize)

    logger.log('--- [Bước 0] Dọn dẹp DB hoàn tất ---')
  }

  async function seedUsers() {
    logger.log('--- [Bước 1] Bắt đầu nuôi Users (chậm nhưng chính xác) ---')
    const usersToCreate: User[] = []
    const stream = fs.createReadStream(USERS_FILE).pipe(csv())

    for await (const row of stream) {
      usersToCreate.push({
        _id: row.id,
        username: row.username,
        avatar: row.avatar,
        firstName: row.firstName,
        lastName: row.lastName,
        shortDescription: row.shortDescription,
        // Fix: Ưu tiên email từ CSV, fallback về synthetic email
        email: row.email || `${row.username}@synthetic.com`,
        password: 'password',
        isEmbedded: false,
        persona: row.persona ? row.persona.split('|') : [],
        // Fix: Đọc createdAt từ CSV nếu có
        createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
      } as User)
    }

    await userModel.create(usersToCreate)

    if (SEEDER_CONFIG.IS_EMBEDDED === 'true') {
      for (const user of usersToCreate) {
        await embeddingQueue.add('process-profile-user-embedding', { userId: user._id })
      }
      logger.log(`--- [Bước 1] Đã enqueue ${usersToCreate.length} job 'process-profile-user-embedding' ---`)
    } else {
      logger.log(`--- [Bước 1] Đã tạo ${usersToCreate.length} Users ---`)
    }
  }

  async function seedPosts() {
    logger.log('--- [Bước 2] Bắt đầu nuôi Posts ---')
    const postsToCreate: Post[] = []
    const stream = fs.createReadStream(POSTS_FILE).pipe(csv())

    for await (const row of stream) {
      postsToCreate.push({
        _id: row.id,
        author: row.authorId,
        content: row.content,
        dwellTimeThreshold: parseInt(row.dwellTimeThreshold, 10) || 3000,
        createdAt: row.createdAt,
        isEmbedded: false,
        parentId: row.parentId || null,
        // Fix: Đọc categories từ CSV (pipe-separated)
        categories: row.categories ? row.categories.split('|').filter((c: string) => c.trim()) : [],
        // Fix: Đọc isReply từ CSV
        isReply: row.isReply === 'true' || row.isReply === true || row.isReply === 'True',
        // Set images default (không có trong CSV)
        images: [],
      } as Post)
    }

    await postModel.insertMany(postsToCreate)
    logger.log(`--- [Bước 2] Đã tạo ${postsToCreate.length} Posts ---`)

    if (SEEDER_CONFIG.IS_EMBEDDED === 'true') {
      for (const post of postsToCreate) {
        await embeddingQueue.add('process-post-embedding', { postId: post._id })
      }
      logger.log(`--- [Bước 2] Đã enqueue ${postsToCreate.length} job 'process-post-embedding' ---`)
    } else {
      logger.log(`--- [Bước 2] Đã tạo ${postsToCreate.length} Posts ---`)
    }
  }

  async function seedFollows() {
    logger.log('--- [Bước 2.5] Bắt đầu nuôi Follows ---')
    const followsToCreate: UserFollow[] = []
    const stream = fs.createReadStream(FOLLOWS_FILE).pipe(csv())

    for await (const row of stream) {
      followsToCreate.push({
        // Fix: Ưu tiên ID từ CSV, fallback về uuid mới
        _id: row.id,
        followerId: row.followerId,
        followingId: row.followingId,
        // Fix: Đọc createdAt từ CSV nếu có
        createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
      } as UserFollow)
    }

    if (followsToCreate.length > 0) {
      await userFollowModel.insertMany(followsToCreate)
    }
    logger.log(`--- [Bước 2.5] Đã tạo ${followsToCreate.length} quan hệ Follow ---`)
  }

  /**
   * Bước 3: Nuôi dữ liệu Tương tác (Học)
   */
  async function seedInteractions() {
    logger.log('--- [Bước 3] Bắt đầu nuôi Interactions (Train) ---')
    const stream = fs.createReadStream(TRAIN_INTERACTIONS_FILE).pipe(csv())
    let count = 0
    let total = 0

    for await (const row of stream) {
      total++

      // 1. Tạo UserActivity và LẤY LẠI đối tượng vừa tạo
      const newActivity = await userActivityModel.create({
        _id: row.id || uuidv4(),
        userId: row.userId,
        postId: row.postId || null,
        userActivityType: row.userActivityType as UserActivityType,
        dwellTime: row.dwellTime ? parseInt(row.dwellTime, 10) : null,
        searchText: row.searchText || null,
        createdAt: new Date(row.createdAt),
      })

      // 2. Enqueue job với payload chính xác
      if (SEEDER_CONFIG.IS_EMBEDDED === 'true') {
        await embeddingQueue.add('process-persona-user-embedding', { activityId: newActivity._id })
      } else {
        logger.log(`--- [Bước 3] Đã tạo ${newActivity._id} UserActivity ---`)
      }
      count++
    }
    logger.log(`--- [Bước 3] Đã tạo ${total} UserActivities.`)
    logger.log(`--- [Bước 3] Đã enqueue ${count} jobs 'process-persona-user-embedding' ---`)
  }

  try {
    await clearDatabase()
    await seedUsers()
    await seedPosts()
    await seedFollows()
    await seedInteractions()
    logger.log('✅ ✅ ✅ Hoàn tất việc nuôi dữ liệu (Ingestion)!')
    logger.log('Đang khởi động lại (resume) queue cho worker...')

    await embeddingQueue.resume()

    logger.log('Queue đã resume. Worker sẽ bắt đầu xử lý jobs.')
  } catch (error) {
    logger.error('❌ ❌ ❌ Kịch bản thất bại:', error)
  } finally {
    logger.log('Ingest script finished. Worker is now processing jobs...')
  }
}

bootstrap()
