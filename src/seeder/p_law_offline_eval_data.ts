import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { Model } from 'mongoose'
import { getModelToken } from '@nestjs/mongoose'
import { Logger } from '@nestjs/common'
import { v4 as uuidv4 } from 'uuid'
import * as bcrypt from 'bcryptjs'
import { User, Post, UserActivity, UserActivityType } from '@entities'
import { getQueueToken } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import * as fs from 'fs'
import * as path from 'path'

// === CẤU HÌNH THỰC TẾ ===
const NUM_USERS = 1000
const NUM_POSTS = 5000
// Power Law Settings
const POWER_LAW_SKEW = 3 // Độ lệch (càng cao thì top càng chiếm nhiều tương tác). 3 là khá gắt (thực tế).
const USER_ACTIVITY_SKEW = 2.5 // Độ lệch mức độ hoạt động của user

// Danh sách nội dung mẫu (giữ nguyên để tiết kiệm không gian, thực tế nên nhiều hơn)
const POST_CONTENTS = [
  'Breaking News: Công nghệ AI mới ra mắt!', // Viral potential high
  'Mẹo vặt cuộc sống: Cách gọt hoa quả nhanh', // Viral potential medium
  'Hôm nay tôi buồn quá...', // Low viral
  'Ảnh mèo cute 🐱', // High viral
  'Review quán ăn lề đường',
  'Quan điểm về kinh tế vĩ mô',
  'Check-in tại Đà Lạt 🌸',
  'Tuyển dụng lập trình viên lương cao',
  'Hỏi đáp về lỗi ReactJS',
  'Meme hài hước 😂',
]

// === HELPER FUNCTIONS ===

/**
 * Chọn một index dựa trên Power Law (Zipf's Law)
 * Trả về index nhỏ nhiều hơn index lớn.
 * @param max Kích thước mảng
 * @param skew Độ lệch (ví dụ 2 hoặc 3). Càng lớn càng tập trung vào đầu mảng.
 */
function getPowerLawIndex(max: number, skew: number): number {
  // Math.random() trả về [0, 1). Mũ skew sẽ làm số nhỏ lại gần 0 hơn.
  // Ví dụ: rand=0.5, skew=2 => 0.25. rand=0.1, skew=2 => 0.01.
  // Ta cần index tập trung về 0, nên dùng logic này.
  const p = Math.pow(Math.random(), skew)
  return Math.floor(p * max)
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const logger = new Logger('GenerateRealisticData')

  const userModel = app.get<Model<User>>(getModelToken(User.name))
  const postModel = app.get<Model<Post>>(getModelToken(Post.name))
  const userActivityModel = app.get<Model<UserActivity>>(getModelToken(UserActivity.name))

  logger.log('=== Bắt đầu tạo dữ liệu (REALISTIC / POWER LAW) ===')

  try {
    // 1. Tạo Users (Không đổi nhiều, chỉ thêm số lượng)
    logger.log(`🔹 Bước 1: Tạo ${NUM_USERS} Users...`)
    const users: User[] = []
    const userIds: string[] = []
    const hashedPassword = await bcrypt.hash('password123', 10)

    for (let i = 0; i < NUM_USERS; i++) {
      const userId = uuidv4()
      userIds.push(userId)
      users.push({
        _id: userId,
        username: `user_${i}`,
        email: `user_${i}@test.com`,
        password: hashedPassword,
        firstName: `User`,
        lastName: `${i}`,
        fullName: `User ${i}`,
        isPublic: true,
        followerCount: 0,
        followingCount: 0,
      } as User)
    }

    // Insert Users
    const BATCH_SIZE = 100
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      await userModel.insertMany(users.slice(i, i + BATCH_SIZE))
    }
    logger.log(`✅ Đã tạo xong Users.`)

    // 2. Tạo Posts với Viral Score (Quality Score)
    logger.log(`🔹 Bước 2: Tạo ${NUM_POSTS} Posts theo quy luật Power Law...`)
    const posts: Post[] = []
    const postIds: string[] = []
    const startTime = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) // 1 năm
    const endTime = new Date()

    // Tạo post
    for (let i = 0; i < NUM_POSTS; i++) {
      const postId = uuidv4()
      const createdAt = randomDate(startTime, endTime)

      // Giả lập điểm chất lượng nội tại (Intrinsic Quality)
      // Điểm này không lưu vào DB, nhưng dùng để sort mảng posts sau này
      // nhằm phục vụ việc pick theo index Power Law.
      // (Trong thực tế: Post hay -> Viral -> Nhiều tương tác)

      posts.push({
        _id: postId,
        author: randomChoice(userIds),
        content: randomChoice(POST_CONTENTS),
        createdAt,
        likeCount: 0,
        viewCount: 0,
        shareCount: 0,
        // Các trường khác...
        isEmbedded: false,
        isReply: false,
      } as Post)
    }

    // QUAN TRỌNG: Sort posts theo một tiêu chí giả định là "Viral Potential"
    // Để khi dùng getPowerLawIndex(max), nó sẽ trúng vào những bài đầu tiên nhiều nhất.
    // Ở đây ta shuffle ngẫu nhiên rồi coi những bài đầu mảng là "Viral Posts"
    posts.sort(() => Math.random() - 0.5)

    // Insert Posts
    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
      await postModel.insertMany(posts.slice(i, i + BATCH_SIZE))
    }
    // Cache lại mảng posts đã sort để dùng cho interactions
    // Index 0 -> Bài hot nhất (Viral King)
    // Index 4999 -> Bài ít người biết (Long tail)
    const sortedPosts = posts
    logger.log(`✅ Đã tạo xong Posts (Đã sắp xếp theo Viral Potential ẩn).`)

    // 3. Tạo Interactions (Thực tế)
    logger.log(`🔹 Bước 3: Tạo Interactions (Sparsity & Power Law)...`)
    const interactions: UserActivity[] = []
    let totalInteractions = 0

    for (const userId of userIds) {
      // a. Xác định User Activity Level (Cũng theo Power Law)
      // Đa số user lười (ít tương tác), một số ít rất chăm.
      // index càng thấp -> activity càng cao (do logic hàm getPowerLawIndex của mình đang ưu tiên số nhỏ)
      // Nên ta đảo ngược lại:
      const activitySkew = getPowerLawIndex(100, USER_ACTIVITY_SKEW) // 0..99, tập trung về 0

      // Logic: Index 0 (nhiều người rơi vào đây) -> Ít tương tác
      // Index 99 (ít người rơi vào đây) -> Nhiều tương tác
      // Số lượng tương tác: Min 2, Max 100.
      // Công thức map từ [0, 100] distribution lệch sang số interactions.
      // Ta muốn đa số user có interaction thấp.
      // getPowerLawIndex trả về số nhỏ nhiều. Vậy số interactions = base + index.
      const numInteractions = 2 + Math.floor(getPowerLawIndex(50, 1.5)) // Đa số user sẽ có 2-10 interactions.

      // Tuy nhiên, cần tạo vài "Power Users" (outliers) để giống thực tế
      const isPowerUser = Math.random() < 0.05 // 5% là power user
      const finalInteractionsCount = isPowerUser ? Math.floor(Math.random() * 150) + 50 : numInteractions

      // b. Tạo interactions cho user này
      const userInteractedPosts = new Set<string>()

      for (let k = 0; k < finalInteractionsCount; k++) {
        // Chọn bài Post để tương tác
        // Sử dụng Power Law: 80% user sẽ tương tác với top 20% bài viết (index nhỏ trong sortedPosts)
        let targetPost: Post
        let attempts = 0

        while (attempts < 10) {
          const postIndex = getPowerLawIndex(sortedPosts.length, POWER_LAW_SKEW)
          targetPost = sortedPosts[postIndex]

          // Validate 1: Không tự like bài mình
          if (targetPost.author === userId) {
            attempts++
            continue
          }

          // Validate 2: Chưa tương tác bài này
          if (userInteractedPosts.has(targetPost._id as string)) {
            attempts++
            continue
          }

          break
        }

        if (!targetPost) continue // Skip nếu không tìm được

        // c. Xác định thời gian tương tác
        // Phải SAU khi post được tạo
        const postCreatedTime = targetPost.createdAt.getTime()
        const now = Date.now()
        // Nếu post mới tạo ngay bây giờ thì interaction cũng ngay bây giờ
        // Nếu post tạo lâu rồi, interaction có thể ngẫu nhiên từ lúc đó đến giờ
        // Nhưng thực tế: Tương tác thường xảy ra trong 1-7 ngày đầu sau khi post
        // Mô phỏng "Hotness Decay":
        const interactionDelay = getPowerLawIndex(7 * 24 * 60 * 60 * 1000, 2) // Tập trung vào delay ngắn (ngay sau khi post)
        let interactionTimeVal = postCreatedTime + interactionDelay
        if (interactionTimeVal > now) interactionTimeVal = now // Cap lại ở hiện tại

        const interactionDate = new Date(interactionTimeVal)

        // d. Loại tương tác
        const rand = Math.random()
        let type = UserActivityType.POST_VIEW
        let dwellTime = 5000

        // Funnel hành vi: View nhiều -> Click -> Like -> Share ít
        if (rand < 0.1) type = UserActivityType.SHARE
        else if (rand < 0.3) type = UserActivityType.LIKE
        else if (rand < 0.6) type = UserActivityType.POST_CLICK
        else type = UserActivityType.POST_VIEW

        if (type === UserActivityType.POST_VIEW) {
          dwellTime = Math.random() * 10000 + 2000
        }

        userInteractedPosts.add(targetPost._id as string)

        interactions.push({
          _id: uuidv4(),
          userId,
          postId: targetPost._id,
          userActivityType: type,
          dwellTime,
          createdAt: interactionDate,
          isEmbedded: false,
        } as UserActivity)
      }
      totalInteractions += userInteractedPosts.size
    }

    logger.log(`✅ Đã tạo interactions trong bộ nhớ. Tổng: ${interactions.length}`)

    // 4. Chia Train/Test (Time-based Split) - GIỮ NGUYÊN LOGIC CŨ CHO CHUẨN
    logger.log(`🔹 Bước 4: Chia Train/Test split...`)
    const TRAIN_TEST_SPLIT = 0.8
    const trainInteractions: UserActivity[] = []
    const testInteractions: UserActivity[] = []

    // Group by User
    const interactionsByUser = new Map<string, UserActivity[]>()
    interactions.forEach(i => {
      if (!interactionsByUser.has(i.userId)) interactionsByUser.set(i.userId, [])
      interactionsByUser.get(i.userId).push(i)
    })

    for (const [uid, userActs] of interactionsByUser.entries()) {
      // Sort theo thời gian
      userActs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

      if (userActs.length < 2) {
        trainInteractions.push(...userActs)
        continue
      }

      const splitIdx = Math.floor(userActs.length * TRAIN_TEST_SPLIT)
      trainInteractions.push(...userActs.slice(0, splitIdx))
      testInteractions.push(...userActs.slice(splitIdx))
    }

    // 5. Lưu vào DB & Export CSV
    logger.log(`🔹 Bước 5: Lưu dữ liệu...`)

    // Chỉ lưu Train vào DB
    for (let i = 0; i < trainInteractions.length; i += BATCH_SIZE) {
      await userActivityModel.insertMany(trainInteractions.slice(i, i + BATCH_SIZE))
    }
    logger.log(`✅ Đã insert ${trainInteractions.length} train interactions vào DB.`)

    // Export CSV
    const DATA_PATH = './data_offline_eval'
    if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true })

    const testCsv = ['userId,postId']
    testInteractions.forEach(i => testCsv.push(`${i.userId},${i.postId}`))
    fs.writeFileSync(path.join(DATA_PATH, 'test_interactions.csv'), testCsv.join('\n'))

    // Export Users map để debug nếu cần
    const usersCsv = ['userId,username']
    users.forEach(u => usersCsv.push(`${u._id},${u.username}`))
    fs.writeFileSync(path.join(DATA_PATH, 'users.csv'), usersCsv.join('\n'))

    logger.log(`✅ Đã export CSV. Test set: ${testInteractions.length} items.`)

    logger.log(`\n📊 THỐNG KÊ DỮ LIỆU THỰC TẾ:`)
    logger.log(`- Users: ${NUM_USERS}`)
    logger.log(`- Posts: ${NUM_POSTS}`)
    logger.log(`- Interactions Total: ${interactions.length}`)
    logger.log(`- Sparsity Level: Rất cao (Do Power Law Skew = ${POWER_LAW_SKEW})`)
    logger.log(`- Top 1% Posts chiếm phần lớn traffic.`)
    logger.log(`✅ Hoàn tất!`)
  } catch (e) {
    logger.error(e)
  } finally {
    await app.close()
  }
}

bootstrap()
