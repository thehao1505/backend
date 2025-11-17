import { NestFactory } from '@nestjs/core'
import { AppModule } from './../../app.module'
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

const DATA_PATH = './data_synthetic'
const USERS_FILE = `${DATA_PATH}/users.csv`
const POSTS_FILE = `${DATA_PATH}/posts.csv`
const TRAIN_INTERACTIONS_FILE = `${DATA_PATH}/train_interactions.csv`

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

  // async function clearDatabase() {
  //   logger.log('--- [Bước 0] Bắt đầu dọn dẹp DB ---')
  //   await userModel.deleteMany({})
  //   await postModel.deleteMany({})
  //   await userActivityModel.deleteMany({})
  //   await recLogModel.deleteMany({})
  //   await userFollowModel.deleteMany({})
  //   await embeddingQueue.obliterate({ force: true })

  //   try {
  //     await qdrantService.deleteCollection(configs.userCollectionName)
  //     await qdrantService.deleteCollection(configs.postCollectionName)
  //   } catch (e) {
  //     logger.warn(`Không thể xóa collection (có thể chưa tồn tại): ${e.message}`)
  //   }
  //   await qdrantService.createCollection(configs.userCollectionName)
  //   await qdrantService.createCollection(configs.postCollectionName)
  //   logger.log('--- [Bước 0] Dọn dẹp DB hoàn tất ---')
  // }

  async function clearDatabase() {
    logger.log('--- [Bước 0] Bắt đầu dọn dẹp DB ---')

    // [MỚI] Tạm dừng queue để worker (trong cùng process) không lấy job
    await embeddingQueue.pause()
    logger.log('Đã tạm dừng (pause) BullMQ queue.')

    await userModel.deleteMany({})
    await postModel.deleteMany({})
    await userActivityModel.deleteMany({})
    await recLogModel.deleteMany({})
    await userFollowModel.deleteMany({})
    await embeddingQueue.obliterate({ force: true }) // Xóa sạch job cũ

    // Dọn dẹp Qdrant (An toàn hơn)
    try {
      await qdrantService.deleteCollection(configs.userCollectionName)
      logger.log(`Đã xóa collection ${configs.userCollectionName}`)
    } catch (e) {
      logger.warn(`Không thể xóa ${configs.userCollectionName}: ${e.message}`)
    }

    try {
      await qdrantService.deleteCollection(configs.postCollectionName)
      logger.log(`Đã xóa collection ${configs.postCollectionName}`)
    } catch (e) {
      logger.warn(`Không thể xóa ${configs.postCollectionName}: ${e.message}`)
    }

    // [MỚI] Đợi 1 giây để Qdrant ổn định sau khi xóa
    await new Promise(resolve => setTimeout(resolve, 1000))

    // [MỚI] Gọi trực tiếp createCollection mà không check exists
    // (Bạn PHẢI đảm bảo hàm createCollection trong qdrant.service.ts
    // không có check "exists" nữa, hoặc dùng recreateCollection)
    // Tạm thời, chúng ta sẽ gọi hàm createCollection gốc:

    await qdrantService.createCollection(configs.userCollectionName)
    await qdrantService.createCollection(configs.postCollectionName)

    logger.log('--- [Bước 0] Dọn dẹp DB hoàn tất ---')
  }

  async function seedUsers() {
    logger.log('--- [Bước 1] Bắt đầu nuôi Users (chậm nhưng chính xác) ---')
    const usersToCreate: User[] = []
    const stream = fs.createReadStream(USERS_FILE).pipe(csv())

    // Đọc tất cả user từ CSV vào bộ nhớ
    for await (const row of stream) {
      usersToCreate.push({
        _id: row.id,
        username: row.username,
        firstName: row.firstName,
        lastName: row.lastName,
        shortDescription: row.shortDescription,
        email: `${row.username}@synthetic.com`,
        password: 'password123', // Hook pre('save') sẽ hash cái này
        isEmbedded: false,
      } as User)
    }

    // Lặp và create() từng user (chậm nhưng chính xác)
    let count = 0
    for (const userData of usersToCreate) {
      try {
        // 1. TẠO USER: Lệnh này sẽ đợi và kích hoạt hooks
        const newUser = await userModel.create(userData) // Dùng create()
        count++

        // 2. ENQUEUE JOB: Chỉ enqueue SAU KHI user đã được tạo thành công
        await embeddingQueue.add('process-profile-user-embedding', {
          userId: newUser._id,
        })

        if (count % 100 === 0) {
          logger.log(`Đã tạo VÀ enqueued ${count}/${usersToCreate.length} users...`)
        }
      } catch (e) {
        logger.warn(`Lỗi khi tạo/enqueue user ${userData.username}: ${e.message}`)
      }
    }
    logger.log(`--- [Bước 1] Đã tạo và enqueued ${count} Users ---`)
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
        createdAt: new Date(row.createdAt),
        isEmbedded: false,
      } as Post)
    }

    await postModel.insertMany(postsToCreate)
    logger.log(`--- [Bước 2] Đã tạo ${postsToCreate.length} Posts ---`)

    for (const post of postsToCreate) {
      await embeddingQueue.add('process-post-embedding', {
        postId: post._id,
      })
    }
    logger.log(`--- [Bước 2] Đã enqueue ${postsToCreate.length} job 'process-post-embedding' ---`)
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
      // 1. Lưu lại log hành vi
      await userActivityModel.create({
        _id: row.id || uuidv4(),
        userId: row.userId,
        postId: row.postId || null,
        userActivityType: row.type as UserActivityType,
        dwellTime: row.dwellTime ? parseInt(row.dwellTime, 10) : null,
        searchText: row.searchText || null,
        createdAt: new Date(row.createdAt),
      })

      if (row.type !== UserActivityType.SEARCH && row.postId) {
        await embeddingQueue.add('process-persona-user-embedding', {
          userId: row.userId,
          postId: row.postId,
          interactionType: row.type,
        })
        count++
      }
    }
    logger.log(`--- [Bước 3] Đã tạo ${total} UserActivities.`)
    logger.log(`--- [Bước 3] Đã enqueue ${count} jobs 'process-persona-user-embedding' ---`)
  }

  try {
    await clearDatabase()
    await seedUsers()
    await seedPosts()
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
