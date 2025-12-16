import { QueryRecommendationDto } from '@dtos/recommendation.dto'
import { RecommendationLog, UserActivityType } from '@entities/index'
import { Post } from '@entities/post.entity'
import { QdrantService, RedisService } from '@modules/index-service'
import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { configs } from '@utils/configs/config'
import { VectorUtil } from '@utils/utils'
import { Model } from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class RecommendationCommonService {
  private readonly logger = new Logger(RecommendationCommonService.name)
  public readonly CACHE_TTL = 60 * 30
  public readonly CSV_EXPORT_PATH = process.env.CSV_EXPORT_PATH || './data_offline_eval'

  constructor(
    @InjectModel(Post.name) public readonly postModel: Model<Post>,
    @InjectModel(RecommendationLog.name) public readonly recommendationLogModel: Model<RecommendationLog>,
    public readonly qdrantService: QdrantService,
    public readonly redisService: RedisService,
  ) {}

  /**
   * Get cached recommendations from Redis
   */
  public async _getCachedRecommendations(key: string) {
    const cached = await this.redisService.client.get(key)
    if (cached) {
      return JSON.parse(cached)
    }
    return null
  }

  /**
   * Cache recommendations to Redis
   */
  public async _cacheRecommendations(key: string, recommendations: any) {
    await this.redisService.client.setex(key, this.CACHE_TTL, JSON.stringify(recommendations))
  }

  /**
   * Get post vector from Qdrant
   */
  public async _getPostVector(postId: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(configs.postCollectionName, postId)
      if (!result || !Array.isArray(result.vector)) return null
      return result.vector as number[]
    } catch (error) {
      return null
    }
  }

  /**
   * DUAL VECTOR STRATEGY: Get long-term interest vector (from persona)
   * FIXED: Lấy từ userCollectionName với userId
   */
  public async _getUserLongTermVector(userId: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(configs.userCollectionName, userId)
      if (!result || !Array.isArray(result.vector)) return null
      const payload = result.payload as any
      if (payload?.type === 'long-term-interest') {
        return result.vector as number[]
      }
      return null
    } catch (error) {
      return null
    }
  }

  /**
   * DUAL VECTOR STRATEGY: Get short-term preference vector (from interactions)
   * FIXED: Lấy từ userShortTermCollectionName với userId (KHÔNG phải userId_shortterm)
   */
  public async _getUserShortTermVector(userId: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(configs.userShortTermCollectionName, userId)
      if (!result || !Array.isArray(result.vector)) return null
      const payload = result.payload as any
      if (payload?.type === 'short-term-preference') {
        return result.vector as number[]
      }
      return null
    } catch (error) {
      return null
    }
  }

  /**
   * DUAL VECTOR STRATEGY: Get combined user interest vector với dynamic weights
   * Fallback: Nếu không có dual vectors, dùng single vector (backward compatibility)
   */
  public async _getUserInterestVector(userId: string): Promise<number[] | null> {
    const longTermVector = await this._getUserLongTermVector(userId)
    const shortTermVector = await this._getUserShortTermVector(userId)

    // Nếu có cả 2 vectors -> Combine với dynamic weights
    if (longTermVector && shortTermVector) {
      return this._combineDualVectors(longTermVector, shortTermVector, userId)
    }

    // Nếu chỉ có long-term
    if (longTermVector) {
      return longTermVector
    }

    // Nếu chỉ có short-term
    if (shortTermVector) {
      return shortTermVector
    }

    // Backward compatibility: Thử get single vector (old format)
    try {
      const result = await this.qdrantService.getVectorById(configs.userCollectionName, userId)
      if (!result || !Array.isArray(result.vector)) return null
      return result.vector as number[]
    } catch (error) {
      return null
    }
  }

  /**
   * Combine long-term và short-term vectors với dynamic weights
   */
  public async _combineDualVectors(longTermVector: number[], shortTermVector: number[], userId: string): Promise<number[]> {
    // Get short-term interaction count để điều chỉnh weights
    let shortTermInteractionCount = 0
    try {
      const shortTermData = await this.qdrantService.getVectorById(configs.userShortTermCollectionName, userId)
      shortTermInteractionCount = (shortTermData?.payload as any)?.interaction_count || 0
    } catch (error) {
      // Ignore
    }

    // Dynamic weights:
    // - Nếu có nhiều interactions gần đây → tăng weight short-term
    // - Nếu ít interactions → giữ long-term làm chủ đạo
    let longTermWeight = 0.6 // Default: Long-term quan trọng hơn
    let shortTermWeight = 0.4

    if (shortTermInteractionCount > 50) {
      // Nhiều interactions -> Short-term quan trọng hơn
      longTermWeight = 0.4
      shortTermWeight = 0.6
    } else if (shortTermInteractionCount > 20) {
      // Trung bình -> Cân bằng
      longTermWeight = 0.5
      shortTermWeight = 0.5
    }
    // < 20 interactions -> Giữ default (long-term 60%, short-term 40%)

    // Weighted combination
    const combined = longTermVector.map((val, i) => val * longTermWeight + shortTermVector[i] * shortTermWeight)

    // Normalize về unit vector
    return VectorUtil.normalize(combined)
  }

  /**
   * Cosine Similarity giữa 2 vectors
   */
  public _cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i]
      normA += vecA[i] * vecA[i]
      normB += vecB[i] * vecB[i]
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB)
    return denominator === 0 ? 0 : dotProduct / denominator
  }

  /**
   * Áp dụng diversity filter để tránh quá nhiều posts từ cùng author/category
   */
  public async _applyDiversityFilter(posts: Post[], limit: number): Promise<Post[]> {
    const diversePosts: Post[] = []
    const authorCount = new Map<string, number>()
    const categoryCount = new Map<string, number>()

    for (const post of posts) {
      if (diversePosts.length >= limit) break

      const authorId = typeof post.author === 'string' ? post.author : (post.author as any)?._id?.toString()
      const authorPosts = authorCount.get(authorId) || 0

      const postCategories = post.categories || []
      const maxCategoryCount = Math.max(...postCategories.map(cat => categoryCount.get(cat) || 0), 0)

      // Diversity rules: Cải thiện để balance giữa relevance và diversity
      // - Tối đa 3 posts từ cùng author trong top 10 (tăng từ 2)
      // - Tối đa 4 posts từ cùng category trong top 10 (tăng từ 3)
      // Giảm diversity constraint một chút để giữ lại posts có score cao
      const isTop10 = diversePosts.length < 10
      const authorLimit = isTop10 ? 3 : 4 // Tăng từ 2:3
      const categoryLimit = isTop10 ? 4 : 6 // Tăng từ 3:5

      if (authorPosts < authorLimit && maxCategoryCount < categoryLimit) {
        diversePosts.push(post)
        authorCount.set(authorId, authorPosts + 1)
        for (const cat of postCategories) {
          categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1)
        }
      }
    }

    // Nếu chưa đủ, thêm các posts còn lại
    if (diversePosts.length < limit) {
      for (const post of posts) {
        if (diversePosts.length >= limit) break
        if (!diversePosts.find(p => p._id.toString() === post._id.toString())) {
          diversePosts.push(post)
        }
      }
    }

    return diversePosts
  }

  /**
   * Get diverse posts by author (round-robin)
   */
  public async _getDiversePostsByAuthor(posts: Post[], limit: number): Promise<Post[]> {
    const authorGroups = new Map<string, Post[]>()
    posts.forEach(post => {
      // Handle both populated and non-populated author field
      let authorId: string
      if (typeof post.author === 'string') {
        authorId = post.author
      } else if (post.author && typeof post.author === 'object' && '_id' in post.author) {
        authorId = (post.author as any)._id.toString()
      } else {
        return // Skip if no author
      }

      if (!authorGroups.has(authorId)) {
        authorGroups.set(authorId, [])
      }
      authorGroups.get(authorId).push(post)
    })

    const diversePosts: Post[] = []
    const authors = Array.from(authorGroups.keys())
    let postCount = posts.length

    while (diversePosts.length < limit && postCount > 0) {
      // Chọn tác giả theo vòng tròn (round-robin) thay vì random
      for (const authorId of authors) {
        if (diversePosts.length >= limit) break
        const authorPosts = authorGroups.get(authorId)
        if (authorPosts && authorPosts.length > 0) {
          diversePosts.push(authorPosts.shift()) // Lấy bài đăng đầu tiên
          postCount--
        }
      }
      // Dừng nếu không còn post nào
      if (postCount === 0 || postCount === posts.length) break
    }
    return diversePosts
  }

  /**
   * Calculate time decay score
   */
  public _calculateTimeDecayScore(post: Post): number {
    const now = new Date()
    const postDate = new Date(post.createdAt)
    const hoursDiff = (now.getTime() - postDate.getTime()) / (1000 * 60 * 60)
    // Cải thiện: Giảm time decay để không penalize posts cũ quá nhiều
    // Thay đổi từ 14 ngày lên 21 ngày (chậm hơn 50%)
    return Math.exp(-hoursDiff / (21 * 24))
  }

  /**
   * Get interaction weight
   */
  public _getInteractionWeight(type: string): number {
    const weights: Record<string, number> = {
      [UserActivityType.LIKE]: 0.2,
      [UserActivityType.SHARE]: 0.35,
      [UserActivityType.REPLY_POST]: 0.4,
      [UserActivityType.POST_CLICK]: 0.1,
      [UserActivityType.POST_VIEW]: 0.05,
    }
    return weights[type] || 0.1
  }

  /**
   * Get recency weight (for similarity calculation)
   */
  public _getRecencyWeight(daysAgo: number): number {
    if (daysAgo <= 7) return 1.0
    if (daysAgo <= 14) return 0.8
    if (daysAgo <= 21) return 0.6
    if (daysAgo <= 30) return 0.4
    return 0.2
  }

  /**
   * Get recency decay (for recency score)
   */
  public _getRecencyDecay(daysAgo: number): number {
    if (daysAgo <= 1) return 1.0
    if (daysAgo <= 7) return 0.8
    if (daysAgo <= 14) return 0.6
    if (daysAgo <= 30) return 0.4
    return 0.2
  }

  /**
   * Get fallback popular posts
   */
  public async _getFallbackPopularPosts(query: QueryRecommendationDto) {
    const { page, limit } = query
    const skip = (page - 1) * limit
    const total = await this.postModel.countDocuments({ isHidden: false, isDeleted: false, parentId: null, isReply: false })
    const popularPosts = await this.postModel
      .find({ isHidden: false, isDeleted: false, parentId: null, isReply: false })
      .sort({ 'likes.length': -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'username avatar fullName')
      .lean()

    const shuffledPosts = popularPosts.sort(() => 0.5 - Math.random())
    return {
      items: shuffledPosts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Get popular posts
   */
  public async _getPopularPosts(limit: number): Promise<Post[]> {
    // Lấy top posts có nhiều tương tác nhất (toàn bộ dataset)
    // Không giới hạn thời gian để phù hợp với offline evaluation
    const popularPosts = await this.postModel.aggregate([
      {
        $match: {
          isHidden: false,
          isDeleted: false,
          parentId: null,
          isReply: false,
        },
      },
      {
        $lookup: {
          from: 'user_activities',
          localField: '_id',
          foreignField: 'postId',
          as: 'interactions',
        },
      },
      {
        $addFields: {
          totalInteractions: { $size: '$interactions' },
        },
      },
      {
        $sort: { totalInteractions: -1 },
      },
      {
        $limit: limit,
      },
      {
        $lookup: {
          from: 'users',
          localField: 'author',
          foreignField: '_id',
          as: 'authorDetails',
        },
      },
      {
        $unwind: {
          path: '$authorDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          author: {
            _id: '$authorDetails._id',
            username: '$authorDetails.username',
            avatar: '$authorDetails.avatar',
            fullName: '$authorDetails.fullName',
          },
        },
      },
      {
        $project: {
          authorDetails: 0,
          interactions: 0,
        },
      },
    ])

    return popularPosts
  }

  /**
   * Interleave two lists
   */
  public _interleaveList(listA: Post[], listB: Post[]) {
    const merged: Post[] = []
    const addedIds = new Set<string>()

    let i = 0,
      j = 0
    while (i < listA.length || j < listB.length) {
      if (i < listA.length) {
        const post = listA[i++]
        if (!addedIds.has(post._id)) {
          merged.push(post)
          addedIds.add(post._id)
        }
      }
      if (j < listB.length) {
        const post = listB[j++]
        if (!addedIds.has(post._id)) {
          merged.push(post)
          addedIds.add(post._id)
        }
      }
    }
    return merged
  }

  /**
   * Interleave three lists
   */
  public _interleaveListThree(listA: Post[], listB: Post[], listC: Post[]): Post[] {
    const merged: Post[] = []
    const addedIds = new Set<string>()

    let i = 0,
      j = 0,
      k = 0
    while (i < listA.length || j < listB.length || k < listC.length) {
      if (i < listA.length) {
        const post = listA[i++]
        if (!addedIds.has(post._id)) {
          merged.push(post)
          addedIds.add(post._id)
        }
      }
      if (j < listB.length) {
        const post = listB[j++]
        if (!addedIds.has(post._id)) {
          merged.push(post)
          addedIds.add(post._id)
        }
      }
      if (k < listC.length) {
        const post = listC[k++]
        if (!addedIds.has(post._id)) {
          merged.push(post)
          addedIds.add(post._id)
        }
      }
    }
    return merged
  }

  /**
   * Log recommendations
   */
  public async _logRecommendations(userId: string, source: string, items: Post[]): Promise<void> {
    try {
      // Chỉ log nếu có items
      if (!items || items.length === 0) {
        return
      }

      // Lấy danh sách ID
      const postIds = items.map(post => post._id.toString())

      const log = new this.recommendationLogModel({
        _id: uuidv4(), // Schema BaseEntity của bạn dùng uuid
        userId: userId,
        source: source,
        shownPostIds: postIds,
        sessionId: uuidv4(), // Một ID duy nhất cho phiên đề xuất này
      })

      // Lưu vào DB.
      // Chúng ta không `await` ở hàm gọi để không block response trả về user.
      await log.save()

      // Export ra CSV (async, không block)
      this._exportRecommendationToCsv(userId, source, postIds).catch(err => {
        this.logger.warn(`[CSV Export] Lỗi khi export CSV: ${err.message}`)
      })
    } catch (error) {
      // Quan trọng: Bắt lỗi ở đây để không làm crash hàm recommendation chính
      this.logger.error(`[Metrics] Lỗi khi ghi log recommendations: ${error.message}`)
    }
  }

  /**
   * Export recommendation log ra CSV file
   * Format: userId,postIds,source
   * postIds được phân cách bằng |
   */
  public async _exportRecommendationToCsv(userId: string, source: string, postIds: string[]): Promise<void> {
    try {
      // Tạo thư mục nếu chưa có
      if (!fs.existsSync(this.CSV_EXPORT_PATH)) {
        fs.mkdirSync(this.CSV_EXPORT_PATH, { recursive: true })
      }

      const csvFileName = `recommendations_${source}.csv`
      const csvFilePath = path.join(this.CSV_EXPORT_PATH, csvFileName)

      // Kiểm tra xem file đã tồn tại chưa để quyết định có cần ghi header không
      const fileExists = fs.existsSync(csvFilePath)
      const fileHandle = fs.openSync(csvFilePath, 'a') // Append mode

      try {
        // Ghi header nếu file mới tạo
        if (!fileExists) {
          fs.writeSync(fileHandle, 'userId,postIds,source\n')
        }

        // Ghi dòng dữ liệu mới
        const postIdsStr = postIds.join('|')
        const csvLine = `${userId},${postIdsStr},${source}\n`
        fs.writeSync(fileHandle, csvLine)
      } finally {
        fs.closeSync(fileHandle)
      }
    } catch (error) {
      // Log lỗi nhưng không throw để không ảnh hưởng đến flow chính
      this.logger.warn(`[CSV Export] Không thể export recommendation ra CSV: ${error.message}`)
    }
  }
}
