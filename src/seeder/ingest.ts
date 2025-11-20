import { NestFactory } from '@nestjs/core'
import { AppModule } from './../app.module'
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

  async function clearDatabase() {
    logger.log('--- [Bước 0] Bắt đầu dọn dẹp DB ---')

    await embeddingQueue.pause()
    logger.log('Đã tạm dừng (pause) BullMQ queue.')

    await userModel.deleteMany({})
    await postModel.deleteMany({})
    await userActivityModel.deleteMany({})
    await recLogModel.deleteMany({})
    await userFollowModel.deleteMany({})
    await embeddingQueue.obliterate({ force: true })
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

    await new Promise(resolve => setTimeout(resolve, 1000))

    await qdrantService.createCollection(configs.userCollectionName)
    await qdrantService.createCollection(configs.postCollectionName)

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
        firstName: row.firstName,
        lastName: row.lastName,
        shortDescription: row.shortDescription,
        email: `${row.username}@synthetic.com`,
        password: 'password',
        isEmbedded: false,
      } as User)
    }

    await userModel.create(usersToCreate)
    logger.log(`--- [Bước 1] Đã tạo và enqueued ${usersToCreate.length} Users ---`)
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

    // for (const post of postsToCreate) {
    //   await embeddingQueue.add('process-post-embedding', {
    //     postId: post._id,
    //   })
    // }
    logger.log(`--- [Bước 2] Đã enqueue ${postsToCreate.length} job 'process-post-embedding' ---`)
  }

  async function seedFollows() {
    logger.log('--- [Bước 2.5] Bắt đầu nuôi Follows ---')
    const followsToCreate: UserFollow[] = []
    const stream = fs.createReadStream(FOLLOWS_FILE).pipe(csv())

    for await (const row of stream) {
      followsToCreate.push({
        _id: uuidv4(), // UserFollow dùng _id
        followerId: row.followerId,
        followingId: row.followingId,
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
        userActivityType: row.type as UserActivityType,
        dwellTime: row.dwellTime ? parseInt(row.dwellTime, 10) : null,
        searchText: row.searchText || null,
        createdAt: new Date(row.createdAt),
      })

      // 2. Enqueue job với payload chính xác
      // await embeddingQueue.add('process-persona-user-embedding', {
      //   activityId: newActivity._id, // Chỉ cần truyền ID
      // })
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
