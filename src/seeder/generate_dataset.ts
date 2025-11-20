import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { Model } from 'mongoose'
import { getModelToken } from '@nestjs/mongoose'
import { Logger } from '@nestjs/common'
import { User, Post, UserActivity, UserFollow, UserActivityType } from '@entities'
import * as fs from 'fs'
import * as path from 'path'
import { SEEDER_CONFIG } from './config'

const DATA_PATH = SEEDER_CONFIG.DATA_PATH || './data_real'
const TRAIN_TEST_SPLIT = 0.8 // 80% train, 20% test (per-user chronological)
const MAX_USERS = 500
const MAX_POSTS = 3000
const MIN_HIGH_INTENT_FOR_TEST = 30 // filter users with too few high-intent

// Interaction weights aligned with embedding.processor.ts
const INTERACTION_WEIGHTS: { [key: string]: number } = {
  LIKE: 0.2,
  SHARE: 0.4,
  UNLIKE: -0.2,
  SEARCH: 0.15,
  POST_VIEW: 0.2,
  POST_CLICK: 0.3,
  REPLY_POST: 0.45,
  DEFAULT: 0.15,
}

/**
 * Xác định high-intent interactions dựa trên logic trong embedding.processor.ts và recommendation.service.ts
 */
function isHighIntentInteraction(activity: Partial<UserActivity>, post: Partial<Post> | null): boolean {
  const userActivityType = activity.userActivityType as any
  const dwellTime = activity.dwellTime as any

  if (
    userActivityType === UserActivityType.LIKE ||
    userActivityType === UserActivityType.SHARE ||
    userActivityType === UserActivityType.POST_CLICK
  ) {
    return true
  }

  if (userActivityType === UserActivityType.REPLY_POST) return true

  if (userActivityType === UserActivityType.POST_VIEW && post && dwellTime) {
    return dwellTime > (post?.dwellTimeThreshold || 3000)
  }

  return false
}

function getInteractionWeight(activity: Partial<UserActivity>): number {
  return INTERACTION_WEIGHTS[activity.userActivityType as string] ?? INTERACTION_WEIGHTS['DEFAULT']
}

function normalizeText(s?: string) {
  if (!s) return ''
  return s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/,/g, ';').replace(/\n/g, ' ')
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const logger = new Logger('GenerateDatasetScript')

  const userModel = app.get<Model<User>>(getModelToken(User.name))
  const postModel = app.get<Model<Post>>(getModelToken(Post.name))
  const userActivityModel = app.get<Model<UserActivity>>(getModelToken(UserActivity.name))
  const userFollowModel = app.get<Model<UserFollow>>(getModelToken(UserFollow.name))

  logger.log('--- Bắt đầu sinh dataset từ dữ liệu thực tế (fixed & sampled) ---')

  try {
    // Tạo thư mục output
    if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true })

    // 1. Export Users (sample up to MAX_USERS)
    logger.log('🔹 Bước 1: Export Users (sample)...')
    // Lấy random sample users ordered by createdAt desc (recent users), you can change sampling strategy
    const users = await userModel.find({}).sort({ createdAt: -1 }).limit(MAX_USERS).lean()
    const usersCsv = ['id,username,firstName,lastName,shortDescription,email']
    for (const user of users) {
      usersCsv.push(
        [
          user._id.toString(),
          user.username || '',
          user.firstName || '',
          user.lastName || '',
          normalizeText(user.shortDescription || ''),
          user.email || '',
        ].join(','),
      )
    }
    fs.writeFileSync(path.join(DATA_PATH, 'users.csv'), usersCsv.join('\n'))
    logger.log(`✅ Đã export ${users.length} users (max ${MAX_USERS})`)

    const userIdSet = new Set(users.map(u => u._id.toString()))

    // 2. Export Posts (sample up to MAX_POSTS)
    logger.log('🔹 Bước 2: Export Posts (sample)...')
    // Lấy posts recent, exclude deleted
    const postsCursor = postModel
      .find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(MAX_POSTS)
      .lean()
    const posts = await postsCursor
    const postsMap = new Map<string, Post>()
    const postsCsv = ['id,authorId,content,dwellTimeThreshold,createdAt,parentId,isReply']
    for (const post of posts) {
      postsMap.set(post._id.toString(), post as Post)
      postsCsv.push(
        [
          post._id.toString(),
          post.author?.toString() || '',
          (post.content || '').replace(/,/g, ';').replace(/\n/g, ' '),
          post.dwellTimeThreshold?.toString() || '3000',
          post.createdAt?.toISOString() || new Date().toISOString(),
          post.parentId?.toString() || '',
          post.isReply ? 'true' : 'false',
        ].join(','),
      )
    }
    fs.writeFileSync(path.join(DATA_PATH, 'posts.csv'), postsCsv.join('\n'))
    logger.log(`✅ Đã export ${posts.length} posts (max ${MAX_POSTS})`)

    // 3. Export Follows (only for sampled users)
    logger.log('🔹 Bước 3: Export Follows (filtered by sampled users)...')
    const follows = await userFollowModel.find({ followerId: { $in: Array.from(userIdSet) } }).lean()
    const followsCsv = ['followerId,followingId']
    for (const follow of follows) {
      followsCsv.push([follow.followerId, follow.followingId].join(','))
    }
    fs.writeFileSync(path.join(DATA_PATH, 'follows.csv'), followsCsv.join('\n'))
    logger.log(`✅ Đã export ${follows.length} follows (filtered)`)

    // 4. Export Interactions và chia Train/Test
    logger.log('🔹 Bước 4: Export Interactions và chia Train/Test...')

    // Lấy tất cả activities cho sampled users, sắp xếp theo userId và createdAt
    const allActivities = await userActivityModel
      .find({ userId: { $in: Array.from(userIdSet) } })
      .sort({ userId: 1, createdAt: 1 })
      .lean()
    logger.log(`Tìm thấy ${allActivities.length} activities cho ${users.length} user(s)`)

    // Lấy reply posts (author in sampled users)
    const replyPosts = await postModel
      .find({ parentId: { $ne: null }, isDeleted: { $ne: true }, author: { $in: Array.from(userIdSet) } })
      .select('_id author parentId createdAt')
      .lean()
    logger.log(`Tìm thấy ${replyPosts.length} reply posts (author in sampled users)`)

    const replyPostsByUser = new Map<string, Array<{ postId: string; parentId: string; createdAt: Date }>>()
    for (const replyPost of replyPosts) {
      const userId = replyPost.author?.toString()
      if (!userId) continue
      if (!replyPostsByUser.has(userId)) replyPostsByUser.set(userId, [])
      replyPostsByUser.get(userId)!.push({
        postId: replyPost._id.toString(),
        parentId: replyPost.parentId?.toString() || '',
        createdAt: replyPost.createdAt || new Date(),
      })
    }

    // Group activities by user
    const activitiesByUser = new Map<string, UserActivity[]>()
    for (const activity of allActivities) {
      const uid = activity.userId?.toString()
      if (!uid) continue
      if (!activitiesByUser.has(uid)) activitiesByUser.set(uid, [])
      activitiesByUser.get(uid)!.push(activity as UserActivity)
    }

    const trainInteractions: any[] = []
    const testInteractions: any[] = []

    for (const [userId, userActivities] of activitiesByUser.entries()) {
      // Merge replyPosts
      const userReplyPosts = replyPostsByUser.get(userId) || []
      const allUserInteractions: Array<any> = []

      for (const activity of userActivities) {
        allUserInteractions.push({
          type: activity.userActivityType,
          postId: activity.postId?.toString() || '',
          createdAt: activity.createdAt || new Date(),
          dwellTime: activity.dwellTime || undefined,
          searchText: activity.searchText || undefined,
          activityId: activity._id?.toString(),
          weight: getInteractionWeight(activity as UserActivity),
        })
      }

      for (const replyPost of userReplyPosts) {
        allUserInteractions.push({
          type: UserActivityType.REPLY_POST,
          postId: replyPost.parentId, // parent is the replied post
          parentId: replyPost.postId, // reply id
          createdAt: replyPost.createdAt,
          weight: INTERACTION_WEIGHTS['REPLY_POST'] || 0.45,
        })
      }

      // sort by time
      allUserInteractions.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      if (allUserInteractions.length < 2) {
        // push all to train
        for (const interaction of allUserInteractions) {
          trainInteractions.push({
            id: interaction.activityId || `reply_${interaction.parentId}`,
            userId,
            postId: interaction.postId,
            type: interaction.type,
            dwellTime: interaction.dwellTime?.toString() || '',
            searchText: normalizeText(interaction.searchText || ''),
            createdAt: new Date(interaction.createdAt).toISOString(),
            weight: interaction.weight,
          })
        }
        continue
      }

      // split train/test chronologically per user
      const splitIndex = Math.floor(allUserInteractions.length * TRAIN_TEST_SPLIT)
      const trainList = allUserInteractions.slice(0, splitIndex)
      const testList = allUserInteractions.slice(splitIndex)

      for (const interaction of trainList) {
        trainInteractions.push({
          id: interaction.activityId || `reply_${interaction.parentId}`,
          userId,
          postId: interaction.postId,
          type: interaction.type,
          dwellTime: interaction.dwellTime?.toString() || '',
          searchText: normalizeText(interaction.searchText || ''),
          createdAt: new Date(interaction.createdAt).toISOString(),
          weight: interaction.weight,
        })
      }

      // For test: only include high-intent interactions (use isHighIntentInteraction)
      const highIntentInTest: any[] = []
      for (const interaction of testList) {
        const post = interaction.postId ? postsMap.get(interaction.postId) : null
        if (isHighIntentInteraction(interaction, post)) {
          highIntentInTest.push({
            userId,
            postId: interaction.postId,
            replyId: interaction.parentId || '',
            createdAt: new Date(interaction.createdAt).toISOString(),
          })
        }
      }

      // Only keep users with enough high-intent interactions for stable evaluation
      if (highIntentInTest.length >= MIN_HIGH_INTENT_FOR_TEST) {
        for (const h of highIntentInTest) testInteractions.push(h)
      } else {
        // If not enough, treat all testList as train to avoid weak evaluation
        for (const interaction of testList) {
          trainInteractions.push({
            id: interaction.activityId || `reply_${interaction.parentId}`,
            userId,
            postId: interaction.postId,
            type: interaction.type,
            dwellTime: interaction.dwellTime?.toString() || '',
            searchText: normalizeText(interaction.searchText || ''),
            createdAt: new Date(interaction.createdAt).toISOString(),
            weight: interaction.weight,
          })
        }
      }
    }

    // Sort trainInteractions chronologically
    trainInteractions.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    // Export train_interactions.csv
    const trainCsv = ['id,userId,postId,type,dwellTime,searchText,createdAt,weight']
    for (const interaction of trainInteractions) {
      trainCsv.push(
        [
          interaction.id,
          interaction.userId,
          interaction.postId,
          interaction.type,
          interaction.dwellTime,
          (interaction.searchText || '').replace(/,/g, ';'),
          interaction.createdAt,
          interaction.weight,
        ].join(','),
      )
    }
    fs.writeFileSync(path.join(DATA_PATH, 'train_interactions.csv'), trainCsv.join('\n'))
    logger.log(`✅ Đã export ${trainInteractions.length} train interactions`)

    // Export test_interactions.csv with replyId and createdAt
    const testCsv = ['userId,postId,replyId,createdAt']
    for (const interaction of testInteractions) {
      testCsv.push([interaction.userId, interaction.postId, interaction.replyId || '', interaction.createdAt].join(','))
    }
    fs.writeFileSync(path.join(DATA_PATH, 'test_interactions.csv'), testCsv.join('\n'))
    logger.log(`✅ Đã export ${testInteractions.length} test interactions (ground truth)`)

    // Export summary.json
    const summary = {
      generatedAt: new Date().toISOString(),
      users: users.length,
      posts: posts.length,
      follows: follows.length,
      trainInteractions: trainInteractions.length,
      testInteractions: testInteractions.length,
      trainTestRatio: `${((trainInteractions.length / (trainInteractions.length + testInteractions.length)) * 100).toFixed(2)}% / ${((testInteractions.length / (trainInteractions.length + testInteractions.length)) * 100).toFixed(2)}%`,
    }
    fs.writeFileSync(path.join(DATA_PATH, 'summary.json'), JSON.stringify(summary, null, 2))

    // Stats by interaction type in train
    const interactionTypes = new Map<string, number>()
    for (const interaction of trainInteractions) {
      const type = interaction.type || 'UNKNOWN'
      interactionTypes.set(type, (interactionTypes.get(type) || 0) + 1)
    }

    logger.log('\n--- 📊 THỐNG KÊ DATASET 📊 ---')
    logger.log(`Users: ${users.length}`)
    logger.log(`Posts: ${posts.length}`)
    logger.log(`Follows: ${follows.length}`)
    logger.log(`Train Interactions: ${trainInteractions.length}`)
    logger.log(`Test Interactions: ${testInteractions.length}`)
    logger.log(summary.trainTestRatio)

    logger.log('\n--- Phân bổ Train Interactions theo loại ---')
    for (const [type, count] of interactionTypes.entries()) {
      logger.log(`  ${type}: ${count}`)
    }

    logger.log(`\n✅ ✅ ✅ Hoàn tất! Dataset đã được lưu tại: ${DATA_PATH}`)
    logger.log('Các file đã tạo:')
    logger.log('  1. users.csv')
    logger.log('  2. posts.csv')
    logger.log('  3. follows.csv')
    logger.log('  4. train_interactions.csv')
    logger.log('  5. test_interactions.csv')
    logger.log('  6. summary.json')
    logger.log('\nBước tiếp theo:')
    logger.log('  1. Cập nhật SEEDER_CONFIG.DATA_PATH trong config.ts nếu cần')
    logger.log('  2. Chạy ingest.ts để import dữ liệu vào database')
    logger.log('  3. Chạy predict.ts để generate recommendations (dựa trên train)')
    logger.log('  4. Chạy evaluate.ts để đánh giá kết quả (so sánh với test_interactions.csv)')
  } catch (error) {
    logger.error('❌ ❌ ❌ Lỗi khi sinh dataset:', error)
    throw error
  } finally {
    await app.close()
  }
}

bootstrap()
