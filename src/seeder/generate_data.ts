import { Post } from '@entities/post.entity'
import { UserActivity, UserActivityType } from '@entities/user-activity.entity'
import { UserFollow } from '@entities/user-follow.entity'
import { User } from '@entities/user.entity'
import { Logger } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import * as fs from 'fs'
import * as path from 'path'
import { v7 as uuidv7 } from 'uuid'

const CONFIG = {
  NUM_USERS: 2000,
  NUM_POSTS: 10000,
  DATA_PATH: './data_offline_eval',

  TRAIN_TEST_SPLIT: 0.8,

  POWER_LAW_ALPHA: 2.5,

  POWER_USER_RATIO: 0.05,
  CASUAL_USER_RATIO: 0.7,
  NEW_USER_RATIO: 0.25,

  // Độ nhiễu
  NOISE_RATIO: 0.1,
}

const TOPICS = [
  {
    id: 'tech',
    name: 'Công nghệ',
    keywords: ['AI', 'Blockchain', 'ReactJS', 'NestJS', 'Gadgets', 'Robot', 'Coding', 'Startup', 'App', 'Software'],
    templates: [
      'Đánh giá {keyword} mới nhất năm nay',
      'Tại sao {keyword} đang là xu hướng?',
      'Hướng dẫn học {keyword} cho người mới',
      'Lỗi nghiêm trọng trong {keyword} vừa được phát hiện',
      'Cộng đồng {keyword} đang tranh cãi gay gắt',
      'Review {keyword} - Có đáng mua không?',
    ],
    seasonalBoost: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  {
    id: 'travel',
    name: 'Du lịch',
    keywords: ['Đà Lạt', 'Sapa', 'Biển đảo', 'Phượt', 'Homestay', 'Check-in', 'Leo núi', 'Ẩm thực đường phố'],
    templates: [
      'Review chuyến đi {keyword} 3 ngày 2 đêm',
      'Kinh nghiệm săn mây tại {keyword}',
      'Top 5 quán ăn ngon tại {keyword}',
      'Đừng đi {keyword} nếu chưa biết điều này',
      'Bộ ảnh {keyword} đẹp ngỡ ngàng',
    ],
    seasonalBoost: [3, 4, 5, 6, 7, 8],
  },
  {
    id: 'food',
    name: 'Ẩm thực',
    keywords: ['Pizza', 'Sushi', 'Trà sữa', 'Cà phê', 'Bún bò', 'Eat clean', 'Healthy', 'Buffet'],
    templates: [
      'Cách làm {keyword} ngon như ngoài hàng',
      'Review quán {keyword} view đẹp nhất phố',
      'Thử thách ăn {keyword} siêu to khổng lồ',
      'Sự thật về calo trong {keyword}',
      'Truy tìm quán {keyword} chuẩn vị gốc',
    ],
    seasonalBoost: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  {
    id: 'fitness',
    name: 'Thể thao & Fitness',
    keywords: ['Gym', 'Yoga', 'Chạy bộ', 'Bơi lội', 'Bóng đá', 'Bóng rổ', 'Workout', 'Diet'],
    templates: [
      'Lịch tập {keyword} cho người mới bắt đầu',
      'Lỗi thường gặp khi tập {keyword}',
      'Chế độ dinh dưỡng cho {keyword}',
      'Review phòng tập {keyword} tốt nhất',
    ],
    seasonalBoost: [0, 1, 2, 11],
  },
  {
    id: 'fashion',
    name: 'Thời trang',
    keywords: ['Outfit', 'Streetwear', 'Vintage', 'Makeup', 'Skincare', 'Accessories', 'Sneakers'],
    templates: ['Outfit ideas cho {keyword}', 'Review {keyword} hot nhất hiện tại', 'Cách mix & match {keyword}'],
    seasonalBoost: [8, 9, 10, 11],
  },
  {
    id: 'gaming',
    name: 'Gaming & Esports',
    keywords: ['Liên Minh Huyền Thoại', 'Valorant', 'Genshin Impact', 'PS5', 'Steam', 'GTA VI', 'Game Mobile', 'Esports'],
    templates: [
      'Highlight {keyword} xử lý đi vào lòng đất',
      'Phân tích bản cập nhật mới nhất của {keyword}',
      'Drama tuyển thủ {keyword} chấn động cộng đồng',
      'Hướng dẫn leo rank {keyword} thần tốc',
      'Cấu hình PC để chiến mượt {keyword}',
    ],
    seasonalBoost: [5, 6, 7, 0, 1], // Nghỉ hè + nghỉ Tết
  },
  {
    id: 'finance',
    name: 'Tài chính & Crypto',
    keywords: ['Bitcoin', 'Chứng khoán', 'Vàng', 'Bất động sản', 'Tiết kiệm', 'Lãi suất', 'Ethereum', 'Đầu tư'],
    templates: [
      'Nhận định thị trường {keyword} tuần tới: Tăng hay giảm?',
      'Có nên bắt đáy {keyword} ngay lúc này?',
      'Bài học xương máu khi đầu tư {keyword} cho người mới',
      'Cách quản lý tài chính cá nhân và {keyword} hiệu quả',
      'Biến động giá {keyword} hôm nay làm nhà đầu tư hoảng loạn',
    ],
    seasonalBoost: [0, 1, 10, 11], // Cuối năm/Đầu năm
  },
  {
    id: 'entertainment',
    name: 'Giải trí (Phim/Nhạc)',
    keywords: ['Netflix', 'Phim chiếu rạp', 'K-Pop', 'BlackPink', 'Sơn Tùng MTP', 'Anime', 'Marvel', 'Conan'],
    templates: [
      'Review phim {keyword}: Khen chê công tâm',
      'Giả thuyết về cái kết của {keyword} đang gây bão',
      'MV mới của {keyword} đạt top 1 trending chỉ sau 1 giờ',
      'Top những bộ phim về {keyword} hay nhất mọi thời đại',
      'Reaction về màn trình diễn của {keyword}',
    ],
    seasonalBoost: [0, 1, 2, 5, 6, 11, 12], // Lễ tết, hè
  },
  {
    id: 'pets',
    name: 'Thú cưng',
    keywords: ['Mèo Anh Lông Ngắn', 'Corgi', 'Husky', 'Golden', 'Poodle', 'Hamster', 'Nuôi mèo', 'Spa thú cưng'],
    templates: [
      'Khoảnh khắc siêu cute của {keyword} nhà mình',
      'Bí quyết chăm sóc {keyword} không bị rụng lông',
      'Review thức ăn cho {keyword} tốt nhất',
      'Câu chuyện cảm động về {keyword} cứu chủ',
      'Hài hước: Khi {keyword} phá nhà',
    ],
    seasonalBoost: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // Quanh năm
  },
  {
    id: 'education',
    name: 'Giáo dục & Kỹ năng',
    keywords: ['IELTS', 'TOEIC', 'Tiếng Anh', 'Du học', 'Kỹ năng mềm', 'Sách hay', 'Excel', 'PowerPoint'],
    templates: [
      'Lộ trình tự học {keyword} từ mất gốc lên 7.0',
      'Review trung tâm {keyword} có tâm nhất Hà Nội/TPHCM',
      'Tổng hợp tài liệu {keyword} miễn phí cực hay',
      'Mẹo thi {keyword} điểm cao ít người biết',
      'Review cuốn sách về {keyword} thay đổi tư duy',
    ],
    seasonalBoost: [3, 4, 5, 8, 9, 11], // Mùa thi, tựu trường
  },
  {
    id: 'home_decor',
    name: 'Nhà cửa & Đời sống',
    keywords: ['Decor phòng ngủ', 'Smarthome', 'Nghiện Nhà', 'IKEA', 'Cây cảnh', 'Sắp xếp nhà cửa', 'Cải tạo nhà', 'Robot hút bụi'],
    templates: [
      'F5 lại góc làm việc với ngân sách {keyword} 500k',
      'Review {keyword}: Có thực sự tiện lợi như lời đồn?',
      'Khoe thành quả {keyword} sau 1 tháng tự làm',
      'Mẹo {keyword} giúp nhà cửa luôn gọn gàng',
      'Top món đồ {keyword} không thể thiếu cho người lười',
    ],
    seasonalBoost: [0, 1, 11, 12], // Dọn nhà đón Tết, cuối năm
  },
  {
    id: 'automotive',
    name: 'Xe & Tốc độ',
    keywords: ['VinFast', 'Honda SH', 'Mercedes', 'Xe độ', 'Phượt xe máy', 'Bảo dưỡng xe', 'Off-road', 'Siêu xe'],
    templates: [
      'Đánh giá chi tiết {keyword} phiên bản mới nhất',
      'Kinh nghiệm lái {keyword} đường dài an toàn',
      'So sánh {keyword} và đối thủ cùng phân khúc',
      'Chi phí nuôi {keyword} một tháng hết bao nhiêu?',
      'Bộ ảnh {keyword} cực ngầu tại trường đua',
    ],
    seasonalBoost: [0, 1, 4, 5], // Đi chơi Tết, nghỉ lễ
  },
  {
    id: 'parenting',
    name: 'Gia đình & Nuôi dạy con',
    keywords: ['Ăn dặm', 'Mẹ bỉm sữa', 'Dạy con', 'Tâm lý trẻ', 'Hôn nhân', 'Thai giáo', 'Sức khỏe bé', 'Đồ chơi thông minh'],
    templates: [
      'Thực đơn {keyword} giúp bé tăng cân vù vù',
      'Khủng hoảng tuổi lên 3 và cách xử lý {keyword}',
      'Tâm sự chuyện {keyword}: Ai rồi cũng phải trải qua',
      'Review các loại {keyword} tốt nhất cho trẻ sơ sinh',
      'Góc chia sẻ: Cân bằng giữa công việc và {keyword}',
    ],
    seasonalBoost: [2, 3, 5, 8, 11], // Mùa hè, tựu trường, mùa đông (ốm vặt)
  },
  {
    id: 'spiritual',
    name: 'Tâm linh & Chữa lành',
    keywords: ['Tarot', '12 Cung Hoàng Đạo', 'Thần số học', 'Chữa lành', 'Manifest', 'Tử vi', 'Thiền', 'Luật hấp dẫn'],
    templates: [
      'Thông điệp vũ trụ tuần mới cho {keyword}',
      'Tụ bài Tarot: Người cũ có quay lại không? ({keyword})',
      'Dự báo tháng này cho {keyword}: Cẩn thận tiền bạc',
      'Cách ứng dụng {keyword} để thu hút may mắn',
      'Podcast chữa lành: Buông bỏ những {keyword} tiêu cực',
    ],
    seasonalBoost: [0, 1, 6, 7], // Đầu năm (xem bói), tháng cô hồn (tháng 7 âm)
  },
  {
    id: 'art_creative',
    name: 'Nghệ thuật & Sáng tạo',
    keywords: ['Digital Art', 'Vẽ tranh', 'Nhiếp ảnh', 'Thiết kế đồ họa', 'Handmade', 'Bullet Journal', 'UI/UX', 'Viết lách'],
    templates: [
      'Hướng dẫn {keyword} cơ bản cho người mới bắt đầu',
      'Quy trình sáng tạo một tác phẩm {keyword} của mình',
      'Top 5 công cụ hỗ trợ {keyword} miễn phí tốt nhất',
      'Thử thách 30 ngày luyện tập {keyword}',
      'Góc truyền cảm hứng: Những nghệ sĩ {keyword} tài năng',
    ],
    seasonalBoost: [5, 6, 7, 8, 9], // Mùa hè, mùa thu
  },
]

enum UserType {
  POWER = 'POWER',
  CASUAL = 'CASUAL',
  NEW = 'NEW',
}

interface UserBehavior {
  type: UserType
  minInteractions: number
  maxInteractions: number
  interestMatchRate: number
  viralClickRate: number
  eagagementRate: number // View -> like, share, reply, click
}

const USER_BEHAVIORS: Record<UserType, UserBehavior> = {
  [UserType.POWER]: {
    type: UserType.POWER,
    minInteractions: 300,
    maxInteractions: 600,
    interestMatchRate: 0.75,
    viralClickRate: 0.3,
    eagagementRate: 0.4,
  },
  [UserType.CASUAL]: {
    type: UserType.CASUAL,
    minInteractions: 50,
    maxInteractions: 150,
    interestMatchRate: 0.85,
    viralClickRate: 0.2,
    eagagementRate: 0.25,
  },
  [UserType.NEW]: {
    type: UserType.NEW,
    minInteractions: 10,
    maxInteractions: 30,
    interestMatchRate: 0.5,
    viralClickRate: 0.4,
    eagagementRate: 0.15,
  },
}

function getAvatarUrl(userId: string, name: string): string {
  return `https://i.pravatar.cc/300?u=${userId}`
}

async function bootstrap() {
  const logger = new Logger('GenerateData')

  logger.log(`--- Starting Data Generation ---`)

  // Tạo thư mục output nếu chưa có
  if (!fs.existsSync(CONFIG.DATA_PATH)) {
    fs.mkdirSync(CONFIG.DATA_PATH, { recursive: true })
  }

  try {
    // ============================================
    // BƯỚC 1: CREATE USERS WITH BEHAVIOR TYPES
    // ============================================
    const defaultPasswordHash = await bcrypt.hash('password', 12)
    logger.log(`✅ Pre-hashed password generated`)

    // ============================================
    // BƯỚC 1: CREATE USERS WITH BEHAVIOR TYPES
    // ============================================
    logger.log(`[Step 1] Creating ${CONFIG.NUM_USERS} users`)

    const users: (User & { avatar: string })[] = [] // Mở rộng kiểu User tạm thời
    const userIds: string[] = []
    const userPersonas = new Map<string, string[]>()
    const userBehaviors = new Map<string, UserBehavior>()

    const numPowerUsers = Math.floor(CONFIG.NUM_USERS * CONFIG.POWER_USER_RATIO)
    const numCasualUsers = Math.floor(CONFIG.NUM_USERS * CONFIG.CASUAL_USER_RATIO)
    const numNewUsers = CONFIG.NUM_USERS - numPowerUsers - numCasualUsers

    logger.log(`[Users] Power users: ${numPowerUsers}`)
    logger.log(`[Users] Casual users: ${numCasualUsers}`)
    logger.log(`[Users] New users: ${numNewUsers}`)

    let userIndex = 0
    const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

    for (let i = 0; i < numPowerUsers; i++) {
      const userId = uuidv7()
      userIds.push(userId)
      userBehaviors.set(userId, USER_BEHAVIORS[UserType.POWER])

      const numInterests = randomInt(2, 3)
      const persona: string[] = []
      while (persona.length < numInterests) {
        const topic = randomChoice(TOPICS)
        if (!persona.includes(topic.id)) persona.push(topic.id)
      }
      userPersonas.set(userId, persona)

      const createdAt = generateDate(startDate, new Date(Date.now() - 180 * 24 * 60 * 60 * 1000))
      const fullName = `Power User${i}`

      users.push({
        _id: userId,
        username: `power_user_${userIndex++}`,
        firstName: 'Power',
        lastName: `User${i}`,
        fullName: fullName,
        email: `power_user_${i}@eval.com`,
        password: defaultPasswordHash, // Use pre-hashed
        shortDescription: `Yêu thích ${persona.map(p => TOPICS.find(t => t.id === p)?.name).join(', ')}`,
        isEmbedded: false,
        followerCount: 0,
        followingCount: 0,
        persona,
        avatar: getAvatarUrl(userId, fullName), // Add avatar
        createdAt,
      } as any)
    }

    for (let i = 0; i < numCasualUsers; i++) {
      const userId = uuidv7()
      userIds.push(userId)
      userBehaviors.set(userId, USER_BEHAVIORS[UserType.CASUAL])

      const numInterests = randomInt(1, 2)
      const persona: string[] = []
      while (persona.length < numInterests) {
        const topic = randomChoice(TOPICS)
        if (!persona.includes(topic.id)) persona.push(topic.id)
      }
      userPersonas.set(userId, persona)

      const createdAt = generateDate(startDate, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
      const fullName = `Casual User${i}`

      users.push({
        _id: userId,
        username: `casual_user_${userIndex++}`,
        firstName: 'Casual',
        lastName: `User${i}`,
        fullName: fullName,
        email: `casual_user_${i}@eval.com`,
        password: defaultPasswordHash, // Use pre-hashed
        shortDescription: `Quan tâm đến ${persona.map(p => TOPICS.find(t => t.id === p)?.name).join(', ')}`,
        isEmbedded: false,
        followerCount: 0,
        followingCount: 0,
        persona,
        avatar: getAvatarUrl(userId, fullName),
        createdAt,
      } as any)
    }

    for (let i = 0; i < numNewUsers; i++) {
      const userId = uuidv7()
      userIds.push(userId)
      userBehaviors.set(userId, USER_BEHAVIORS[UserType.NEW])

      const persona: string[] = [randomChoice(TOPICS).id]
      userPersonas.set(userId, persona)
      const createdAt = generateDate(startDate, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
      const fullName = `New User${i}`

      users.push({
        _id: userId,
        username: `new_user_${userIndex++}`,
        firstName: 'New',
        lastName: `User${i}`,
        fullName: fullName,
        email: `new_user_${i}@eval.com`,
        password: defaultPasswordHash, // Use pre-hashed
        shortDescription: persona.length > 0 ? `Mới tìm hiểu về ${TOPICS.find(t => t.id === persona[0])?.name}` : 'Người dùng mới',
        isEmbedded: false,
        followerCount: 0,
        followingCount: 0,
        persona,
        avatar: getAvatarUrl(userId, fullName),
        createdAt,
      } as any)
    }

    logger.log(`✅ Created ${users.length} users`)

    // ============================================
    // STEP 2: CREATING POSTS WITH VIRAL SCORE & SEASONAL TRENDS
    // ============================================
    logger.log(`[Step 2] Creating ${CONFIG.NUM_POSTS} posts with viral score & seasonal trends`)

    const posts: Post[] = []
    const postIds: string[] = []
    const postsByTopic = new Map<string, string[]>()
    TOPICS.forEach(t => postsByTopic.set(t.id, []))

    const endDate = new Date()
    const postStartDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

    // Create posts with viral score (Power Law)
    for (let i = 0; i < CONFIG.NUM_POSTS; i++) {
      const postId = uuidv7()
      postIds.push(postId)

      const topic = randomChoice(TOPICS)
      const keyword = randomChoice(topic.keywords)
      const template = randomChoice(topic.templates)
      const content = template.replace('{keyword}', keyword + ` #${topic.id} #${keyword.replace(/\s/g, '')}`)

      const authorId = randomChoice(userIds)
      const createdAt = generateDate(postStartDate, endDate)

      const viralScore = Math.random() * 100
      const month = createdAt.getMonth()
      const seasonalBoost = getSeasonalBoost(topic, month)
      const finalViralScore = viralScore * seasonalBoost

      posts.push({
        _id: postId,
        author: authorId,
        content,
        images: [],
        categories: [topic.id],
        dwellTimeThreshold: randomInt(3000, 10000),
        createdAt,
        isEmbedded: false,
        isReply: false,
        parentId: null,
        likeCount: 0,
        viewCount: 0,
        shareCount: 0,
        clickCount: 0,
        viralScore: finalViralScore, // Temporary for sort
      } as any)

      postsByTopic.get(topic.id)!.push(postId)
    }

    posts.sort((a, b) => (b as any).viralScore - (a as any).viralScore)

    // Remove viralScore từ posts trước khi export
    const postsForExport = posts.map(p => {
      const { viralScore, ...rest } = p as any
      return rest
    })

    logger.log(`✅ Created ${posts.length} posts`)

    // ============================================
    // BƯỚC 3: CREATE FOLLOW RELATIONSHIPS (SOCIAL GRAPH)
    // ============================================
    logger.log(`[Step 3] Create follow relationships`)

    const follows: UserFollow[] = []
    const followGraph = new Map<string, Set<string>>() // userId -> Set<followingId>

    for (const userId of userIds) {
      const behavior = userBehaviors.get(userId)!
      const persona = userPersonas.get(userId) || []

      let numFollows = 0
      if (behavior.type === UserType.POWER) {
        numFollows = randomInt(80, 150)
      } else if (behavior.type === UserType.CASUAL) {
        numFollows = randomInt(40, 90)
      } else {
        numFollows = randomInt(20, 50)
      }

      const followingSet = new Set<string>()

      for (let i = 0; i < numFollows; i++) {
        let targetId = randomChoice(userIds)

        if (persona.length > 0 && Math.random() < 0.7) {
          const samePersonaUsers = userIds.filter(uid => uid !== userId && userPersonas.get(uid)?.some(p => persona.includes(p)))
          if (samePersonaUsers.length > 0) {
            targetId = randomChoice(samePersonaUsers)
          }
        }

        if (targetId === userId || followingSet.has(targetId)) continue
        followingSet.add(targetId)

        follows.push({
          _id: uuidv7(),
          followerId: userId,
          followingId: targetId,
          createdAt: generateDate(users.find(u => u._id === userId)?.createdAt || startDate, endDate),
        } as UserFollow)
      }

      followGraph.set(userId, followingSet)
    }

    logger.log(`✅ Created ${follows.length} follow relationships`)

    // ============================================
    // BƯỚC 4: CREATE INTERACTIONS WITH REALISTIC BEHAVIOR
    // ============================================
    logger.log(`[Step 4] Create interactions with realistic behavior`)

    const allInteractions: UserActivity[] = []
    const replyPostsBatch: Post[] = []
    const viewedPosts = new Map<string, Set<string>>()

    const postMap = new Map(posts.map(p => [p._id, p]))

    for (const userId of userIds) {
      const behavior = userBehaviors.get(userId)!
      const persona = userPersonas.get(userId) || []
      const userCreatedAt = users.find(u => u._id === userId).createdAt

      const numInteractions = randomInt(behavior.minInteractions, behavior.maxInteractions)

      const userViewedPosts = new Set<string>()
      viewedPosts.set(userId, userViewedPosts)

      let numUserInteractions = 0

      while (numUserInteractions < numInteractions) {
        let targetPostId: string | undefined
        let isPreferredTopic = false

        const rand = Math.random()

        // Logic choose posts theo thứ tự ưu tiên:
        // 1. Nếu user có persona: dựa vào interestMatchRate để chọn topic ưa thích
        // 2. Nếu không chọn topic ưa thích: dựa vào viralClickRate để chọn viral posts
        // 3. Còn lại: chọn random posts (diversity)

        if (persona.length > 0 && rand < behavior.interestMatchRate) {
          // Chọn post từ topic ưa thích của user
          const preferredTopicId = randomChoice(persona)
          const topicPosts = postsByTopic.get(preferredTopicId)

          if (topicPosts && topicPosts.length > 0) {
            // Sort posts theo viralScore (giảm dần) - index 0 = post phổ biến nhất
            const sortedTopicPosts = [...topicPosts].sort((a, b) => {
              const postA = postMap.get(a) as any
              const postB = postMap.get(b) as any
              return (postB?.viralScore || 0) - (postA?.viralScore || 0)
            })

            // Power Law: index nhỏ = post phổ biến hơn
            const postIndex = getPowerLawIndex(sortedTopicPosts.length, CONFIG.POWER_LAW_ALPHA)
            targetPostId = sortedTopicPosts[postIndex]
            isPreferredTopic = true
          }
        }

        // Nếu chưa chọn được post (không có persona hoặc không match interest)
        if (!targetPostId) {
          const remainingRand = Math.random()
          const viralPostThreshold = behavior.viralClickRate

          if (remainingRand < viralPostThreshold) {
            // Chọn từ top viral posts (top 2%)
            const topPosts = posts.slice(0, Math.floor(posts.length * 0.02))
            if (topPosts.length > 0) {
              targetPostId = randomChoice(topPosts.map(p => p._id))
            }
          }

          // Nếu vẫn chưa chọn được, chọn random (diversity)
          if (!targetPostId) {
            targetPostId = randomChoice(postIds)
          }
        }

        if (!targetPostId || userViewedPosts.has(targetPostId)) continue

        const post = postMap.get(targetPostId)
        if (!post || post.author === userId) continue

        userViewedPosts.add(targetPostId)

        const interactionDate = generateDate(new Date(Math.max(userCreatedAt.getTime(), post.createdAt.getTime())), endDate)

        allInteractions.push({
          _id: uuidv7(),
          userId,
          postId: targetPostId as any,
          userActivityType: UserActivityType.POST_VIEW,
          dwellTime: 11000,
          searchText: null,
          isEmbedded: false,
          createdAt: interactionDate,
        } as UserActivity)
        numUserInteractions++

        const engagementRate = isPreferredTopic ? behavior.eagagementRate * 1.5 : behavior.eagagementRate
        let currentTime = interactionDate.getTime()

        if (Math.random() < engagementRate * 0.6) {
          currentTime += randomInt(1000, 1000 * 60 * 2)
          allInteractions.push({
            _id: uuidv7(),
            userId,
            postId: targetPostId as any,
            userActivityType: UserActivityType.LIKE,
            dwellTime: null,
            searchText: null,
            isEmbedded: false,
            createdAt: new Date(currentTime),
          } as UserActivity)
          numUserInteractions++
        }

        if (Math.random() < engagementRate * 0.3) {
          currentTime += randomInt(1000, 1000 * 60 * 3)
          allInteractions.push({
            _id: uuidv7(),
            userId,
            postId: targetPostId as any,
            userActivityType: UserActivityType.SHARE,
            dwellTime: null,
            searchText: null,
            isEmbedded: false,
            createdAt: new Date(currentTime),
          } as UserActivity)
          numUserInteractions++
        }

        if (Math.random() < engagementRate * 0.4) {
          currentTime += randomInt(1000, 1000 * 60 * 5)
          allInteractions.push({
            _id: uuidv7(),
            userId,
            postId: targetPostId as any,
            userActivityType: UserActivityType.POST_CLICK,
            dwellTime: null,
            searchText: null,
            isEmbedded: false,
            createdAt: new Date(currentTime),
          } as UserActivity)
          numUserInteractions++
        }

        if (Math.random() < engagementRate * 0.1) {
          currentTime += randomInt(1000 * 60, 1000 * 60 * 10)
          allInteractions.push({
            _id: uuidv7(),
            userId,
            postId: targetPostId as any,
            userActivityType: UserActivityType.REPLY_POST,
            dwellTime: null,
            searchText: null,
            isEmbedded: false,
            createdAt: new Date(currentTime),
          } as UserActivity)
          numUserInteractions++
          replyPostsBatch.push({
            _id: uuidv7(),
            author: userId,
            content: `Reply to ${post.content}`,
            images: [],
            categories: post.categories,
            dwellTimeThreshold: randomInt(11000, 12000),
            createdAt: interactionDate,
            isEmbedded: false,
            isReply: true,
            parentId: targetPostId,
            likeCount: 0,
            viewCount: 0,
            shareCount: 0,
            clickCount: 0,
          } as Post)
        }
      }
      logger.debug(`[USER] ${userId} has ${numUserInteractions} interactions`)
    }

    logger.log(`✅ Created ${allInteractions.length} interactions`)
    logger.log(`✅ Created ${replyPostsBatch.length} reply posts`)

    // ============================================
    // BƯỚC 5: CHIA TRAIN/TEST THEO THỜI GIAN
    // ============================================
    logger.log(`[Step 5] Split train/test by time`)

    const interactionsByUser = new Map<string, UserActivity[]>()
    for (const interaction of allInteractions) {
      if (!interactionsByUser.has(interaction.userId)) {
        interactionsByUser.set(interaction.userId, [])
      }
      interactionsByUser.get(interaction.userId)!.push(interaction)
    }

    const trainInteractions: UserActivity[] = []
    const testInteractions: UserActivity[] = []

    for (const [userId, userInteractions] of interactionsByUser.entries()) {
      const validInteractions = userInteractions.filter(i => i.postId)

      if (validInteractions.length < 2) {
        trainInteractions.push(...validInteractions)
        continue
      }

      validInteractions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

      const splitIndex = Math.floor(validInteractions.length * CONFIG.TRAIN_TEST_SPLIT)
      trainInteractions.push(...validInteractions.slice(0, splitIndex))
      testInteractions.push(...validInteractions.slice(splitIndex))
    }

    logger.log(`  Train: ${trainInteractions.length} interactions`)
    logger.log(`  Test: ${testInteractions.length} interactions`)

    // ============================================
    // BƯỚC 6: EXPORT DATA TO CSV FILES
    // ============================================
    logger.log(`[Step 6] Export data to CSV files`)

    // Export Users CSV
    const usersCsv = ['id,username,avatar,firstName,lastName,fullName,email,shortDescription,persona,createdAt']
    users.forEach(user => {
      usersCsv.push(
        [
          user._id,
          user.username || '',
          user.avatar || '',
          user.firstName || '',
          user.lastName || '',
          (user as any).fullName || '',
          user.email || '',
          (user.shortDescription || '').replace(/,/g, ';').replace(/\n/g, ' '),
          (user.persona || []).join('|'),
          user.createdAt.toISOString(),
        ].join(','),
      )
    })
    fs.writeFileSync(path.join(CONFIG.DATA_PATH, 'users.csv'), usersCsv.join('\n'))
    logger.log(`✅ Exported users.csv (${users.length} users)`)

    // Export Posts CSV (bao gồm cả reply posts)
    const allPosts = [...postsForExport, ...replyPostsBatch]
    const postsCsv = ['id,authorId,content,dwellTimeThreshold,createdAt,categories,parentId,isReply']
    allPosts.forEach(post => {
      postsCsv.push(
        [
          post._id,
          post.author,
          (post.content || '').replace(/,/g, ';').replace(/\n/g, ' ').replace(/"/g, '""'),
          post.dwellTimeThreshold || '',
          post.createdAt.toISOString(),
          (post.categories || []).join('|'),
          (post as any).parentId || '',
          (post as any).isReply || false,
        ].join(','),
      )
    })
    fs.writeFileSync(path.join(CONFIG.DATA_PATH, 'posts.csv'), postsCsv.join('\n'))
    logger.log(`✅ Exported posts.csv (${allPosts.length} posts)`)

    // Export Follows CSV
    const followsCsv = ['id,followerId,followingId,createdAt']
    follows.forEach(follow => {
      followsCsv.push([follow._id, follow.followerId, follow.followingId, follow.createdAt.toISOString()].join(','))
    })
    fs.writeFileSync(path.join(CONFIG.DATA_PATH, 'follows.csv'), followsCsv.join('\n'))
    logger.log(`✅ Exported follows.csv (${follows.length} follows)`)

    // Export Train Interactions CSV
    const trainCsv = ['id,userId,postId,userActivityType,dwellTime,createdAt']
    trainInteractions.forEach(interaction => {
      trainCsv.push(
        [
          interaction._id,
          interaction.userId,
          interaction.postId || '',
          interaction.userActivityType,
          interaction.dwellTime || '',
          interaction.createdAt.toISOString(),
        ].join(','),
      )
    })
    fs.writeFileSync(path.join(CONFIG.DATA_PATH, 'train_interactions.csv'), trainCsv.join('\n'))
    logger.log(`✅ Exported train_interactions.csv (${trainInteractions.length} interactions)`)

    // Export Test Interactions CSV (chỉ userId, postId cho evaluation)
    const testCsv = ['userId,postId']
    testInteractions.forEach(interaction => {
      if (interaction.postId) {
        testCsv.push([interaction.userId, interaction.postId].join(','))
      }
    })
    fs.writeFileSync(path.join(CONFIG.DATA_PATH, 'test_interactions.csv'), testCsv.join('\n'))
    logger.log(`✅ Exported test_interactions.csv (${testInteractions.length} interactions)`)

    logger.log(`\n📊 Thống kê:`)
    logger.log(`  - Users: ${users.length}`)
    logger.log(`  - Posts: ${allPosts.length} (${postsForExport.length} original + ${replyPostsBatch.length} replies)`)
    logger.log(`  - Follows: ${follows.length}`)
    logger.log(`  - Train interactions: ${trainInteractions.length}`)
    logger.log(`  - Test interactions: ${testInteractions.length}`)
    logger.log(`  - Total interactions: ${allInteractions.length}`)
    logger.log(`\n✅ Hoàn tất! Tất cả dữ liệu đã được export vào ${CONFIG.DATA_PATH}/`)
  } catch (error) {
    logger.error('Error generating data:', error)
    throw error
  }
}

// --- HELPER ---

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

function getSeasonalBoost(topic: (typeof TOPICS)[0], month: number): number {
  return topic.seasonalBoost.includes(month) ? 1.5 : 1.0
}

// Power Law distribution - return index (index more small = more popular)
// Eg: 10 posts, alpha = 2.5 -> index 0 is most popular, index 9 is least popular
// Math.random() = 0.5 -> 0.5^1/2.5 = 0.632 -> Math.floor(10 * 0.632) = 6
function getPowerLawIndex(max: number, alpha: number): number {
  const u = Math.random()
  // Đảo ngược: 1 - u^(1/alpha) hoặc dùng hàm phân phối pareto chuẩn hơn
  // Cách đơn giản nhất để ưu tiên index thấp:
  const p = Math.pow(u, alpha) // alpha càng lớn, p càng gần 0
  return Math.floor(p * max)
}

// --- RUN FILE ---
bootstrap()
