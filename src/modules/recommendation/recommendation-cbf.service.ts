import { QueryRecommendationDto } from '@dtos/recommendation.dto'
import { RecommendationLog, UserActivity, UserActivityType } from '@entities/index'
import { Post } from '@entities/post.entity'
import { QdrantService, RedisService } from '@modules/index-service'
import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { configs } from '@utils/configs/config'
import { Model } from 'mongoose'
import { RecommendationCommonService } from './recommendation-common.service'

@Injectable()
export class RecommendationCbfService {
  private readonly logger = new Logger(RecommendationCbfService.name)
  private readonly HYBRID_POOL_LIMIT = 100

  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(UserActivity.name) private readonly userActivityModel: Model<UserActivity>,
    private readonly commonService: RecommendationCommonService,
  ) {}

  async getRecommendations_CBF(userId: string, query: QueryRecommendationDto) {
    const { page, limit } = query
    const cacheKey = `recommendations:cbf:${userId}:${page}:${limit}`

    try {
      const cached = await this.commonService._getCachedRecommendations(cacheKey)
      if (cached && configs.isSkipCacheRecommendation === 'true') return cached

      const cbfPool = await this.getCBFCandidates(userId, this.HYBRID_POOL_LIMIT)

      if (cbfPool.length === 0) {
        this.logger.log(`[CBF] Cold-start for user ${userId}, fallback to popular post.`)
        return this.commonService._getFallbackPopularPosts(query)
      }

      const diversePosts = await this.commonService._getDiversePostsByAuthor(cbfPool, cbfPool.length)

      const total = diversePosts.length
      const items = diversePosts.slice((page - 1) * limit, page * limit)

      const recommendations = {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
      if (page === 1) {
        this.commonService._logRecommendations(userId, 'cbf', items)
      }

      await this.commonService._cacheRecommendations(cacheKey, recommendations)
      return recommendations
    } catch (error) {
      this.logger.error(`[CBF] Error when fetch recommendations: ${error.message}`)
      return this.commonService._getFallbackPopularPosts(query)
    }
  }

  async getCBFCandidates(userId: string, poolLimit: number) {
    const longTermVector = await this.commonService._getUserLongTermVector(userId)
    const shortTermVector = await this.commonService._getUserShortTermVector(userId)
    const userInterestVector = await this.commonService._getUserInterestVector(userId)
    const recentInteractionsProfile = await this._buildRecentInteractionsProfile(userId) // 2. Tạo Recent Interactions Profile (Recency Signal - 30%)
    const categoryPreferences = await this._buildCategoryPreferences(userId) // 3. Tính Category Preferences (Topic Signal - 20%)
    const authorPreferences = await this._buildAuthorPreferences(userId) // 4. Tính Author Preferences (Social Signal - 10%)

    if (!userInterestVector && !recentInteractionsProfile) {
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

      const extendedActivities = await this.userActivityModel
        .find({
          userId,
          postId: { $ne: null },
          createdAt: { $gte: ninetyDaysAgo },
          userActivityType: {
            $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.REPLY_POST, UserActivityType.POST_CLICK],
          },
        })
        .limit(20)
        .lean()

      if (extendedActivities.length > 0) {
        const extendedProfile = await this._buildExtendedInteractionsProfile(userId, ninetyDaysAgo)
        if (extendedProfile) {
          const excludedPostIds = await this._getExcludedPostIds(userId)
          const expandedPoolLimit = Math.min(poolLimit * 8, 800)
          const filter = {
            must_not: [
              { key: 'author', match: { value: userId } },
              ...excludedPostIds.map(postId => ({
                key: 'postId',
                match: { value: postId },
              })),
            ],
          }

          const similar = await this.commonService.qdrantService.searchSimilar(
            configs.postCollectionName,
            extendedProfile,
            expandedPoolLimit,
            1,
            filter,
          )

          if (similar.length > 0) {
            const similarPostIds = similar.map(item => item.id)
            const similarPostsRaw = await this.commonService.postModel
              .find({ _id: { $in: similarPostIds }, isHidden: false, parentId: null, isReply: false })
              .populate('author', 'username avatar fullName')
              .lean()

            const idToPostMap = new Map(similarPostsRaw.map(post => [post._id.toString(), post]))
            const candidatePosts = similarPostIds.map(id => idToPostMap.get(id.toString())).filter(Boolean)

            const scoredPosts = await Promise.all(
              candidatePosts.map(async post => {
                const postVector = await this.commonService._getPostVector(post._id.toString())
                const similarity = postVector ? this.commonService._cosineSimilarity(extendedProfile, postVector) : 0
                const categoryScore = post.categories
                  ? post.categories.map(cat => categoryPreferences.get(cat) || 0).reduce((sum, score) => sum + score, 0) /
                    post.categories.length
                  : 0
                const timeDecay = this.commonService._calculateTimeDecayScore(post)
                const finalScore = similarity * 0.6 + categoryScore * 0.3 + timeDecay * 0.1
                return { ...post, score: finalScore }
              }),
            )

            scoredPosts.sort((a, b) => b.score - a.score)
            const diversePosts = await this.commonService._applyDiversityFilter(scoredPosts, poolLimit)
            return diversePosts
          }
        }
      }

      return []
    }

    // Sử dụng primary vector (userInterestVector) hoặc recent profile làm query vector
    const queryVector = userInterestVector || recentInteractionsProfile

    // 5. Lấy danh sách posts đã tương tác để exclude
    const excludedPostIds = await this._getExcludedPostIds(userId)

    // 6. Tìm candidate posts từ Qdrant (mở rộng pool để có đủ diversity)
    // Tăng pool size để có nhiều candidates hơn, cải thiện recall
    // Tăng từ 500 lên 800 để cải thiện coverage và giảm zero precision users
    const expandedPoolLimit = Math.min(poolLimit * 8, 800)
    const filter = {
      must_not: [
        { key: 'author', match: { value: userId } },
        ...excludedPostIds.map(postId => ({
          key: 'postId',
          match: { value: postId },
        })),
      ],
    }

    const similar = await this.commonService.qdrantService.searchSimilar(
      configs.postCollectionName,
      queryVector,
      expandedPoolLimit,
      1,
      filter,
    )
    if (similar.length === 0) return []

    // 7. Load posts và vectors
    const similarPostIds = similar.map(item => item.id)
    const similarPostsRaw = await this.commonService.postModel
      .find({ _id: { $in: similarPostIds }, isHidden: false, parentId: null, isReply: false })
      .populate('author', 'username avatar fullName')
      .lean()

    const idToPostMap = new Map(similarPostsRaw.map(post => [post._id.toString(), post]))
    const candidatePosts = similarPostIds.map(id => idToPostMap.get(id.toString())).filter(Boolean)

    // 8. Score mỗi post với multi-signal formula (DUAL VECTOR AWARE)
    const scoredPosts = await Promise.all(
      candidatePosts.map(async post => {
        const scores = await this._calculateCBFScore(
          post,
          userInterestVector,
          recentInteractionsProfile,
          categoryPreferences,
          authorPreferences,
          longTermVector, // Pass long-term vector riêng
          shortTermVector, // Pass short-term vector riêng
        )
        return { ...post, score: scores.finalScore, scoreDetails: scores }
      }),
    )

    // 9. Sort và apply diversity
    scoredPosts.sort((a, b) => b.score - a.score)
    const diversePosts = await this.commonService._applyDiversityFilter(scoredPosts, poolLimit)

    return diversePosts
  }

  /**
   * Xây dựng Recent Interactions Profile từ các tương tác gần đây (30 ngày)
   */
  private async _buildRecentInteractionsProfile(userId: string): Promise<number[] | null> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // Lấy các tương tác HIGH INTENT trong 30 ngày
    const recentActivities = await this.userActivityModel
      .find({
        userId,
        postId: { $ne: null },
        createdAt: { $gte: thirtyDaysAgo },
        userActivityType: {
          $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.REPLY_POST, UserActivityType.POST_CLICK],
        },
      })
      .sort({ createdAt: -1 })
      .limit(50) // Giới hạn để tránh quá nhiều
      .lean()

    // Lấy POST_VIEW với dwellTime cao
    const highDwellTimeViews = await this.userActivityModel
      .aggregate([
        {
          $match: {
            userId,
            userActivityType: UserActivityType.POST_VIEW,
            createdAt: { $gte: thirtyDaysAgo },
            dwellTime: { $ne: null },
          },
        },
        {
          $lookup: {
            from: 'posts',
            localField: 'postId',
            foreignField: '_id',
            as: 'postDetails',
          },
        },
        {
          $unwind: '$postDetails',
        },
        {
          $match: {
            'postDetails.dwellTimeThreshold': { $ne: null },
            $expr: { $gt: ['$dwellTime', '$postDetails.dwellTimeThreshold'] },
          },
        },
        {
          $sort: { createdAt: -1 },
        },
        {
          $limit: 30,
        },
      ])
      .exec()

    const allActivities = [
      ...recentActivities,
      ...highDwellTimeViews.map(item => ({
        ...item,
        userActivityType: UserActivityType.POST_VIEW,
      })),
    ]

    if (allActivities.length === 0) return null

    // Tính recency weights
    const now = new Date()
    const weightedVectors: Array<{ vector: number[]; weight: number }> = []

    for (const activity of allActivities) {
      const postId = activity.postId?.toString()
      if (!postId) continue

      const postVector = await this.commonService._getPostVector(postId)
      if (!postVector) continue

      // Interaction weight
      const interactionWeight =
        activity.userActivityType === UserActivityType.LIKE
          ? 0.2
          : activity.userActivityType === UserActivityType.SHARE
            ? 0.35
            : activity.userActivityType === UserActivityType.REPLY_POST
              ? 0.4
              : activity.userActivityType === UserActivityType.POST_CLICK
                ? 0.1
                : 0.05 // POST_VIEW với high dwellTime

      // Recency weight
      const daysAgo = (now.getTime() - new Date(activity.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      let recencyWeight = 1.0
      if (daysAgo > 7 && daysAgo <= 14) recencyWeight = 0.8
      else if (daysAgo > 14 && daysAgo <= 21) recencyWeight = 0.6
      else if (daysAgo > 21 && daysAgo <= 30) recencyWeight = 0.4

      weightedVectors.push({
        vector: postVector,
        weight: interactionWeight * recencyWeight,
      })
    }

    if (weightedVectors.length === 0) return null

    // Weighted average
    const dimension = weightedVectors[0].vector.length
    const sumVector = new Array(dimension).fill(0)
    let totalWeight = 0

    for (const { vector, weight } of weightedVectors) {
      for (let i = 0; i < dimension; i++) {
        sumVector[i] += vector[i] * weight
      }
      totalWeight += weight
    }

    if (totalWeight === 0) return null

    const averageVector = sumVector.map(v => v / totalWeight)
    // Normalize
    const magnitude = Math.sqrt(averageVector.reduce((sum, v) => sum + v * v, 0))
    return magnitude > 0 ? averageVector.map(v => v / magnitude) : null
  }

  /**
   * Xây dựng Category Preferences từ các tương tác
   */
  private async _buildCategoryPreferences(userId: string): Promise<Map<string, number>> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const recentActivities = await this.userActivityModel
      .find({
        userId,
        postId: { $ne: null },
        createdAt: { $gte: thirtyDaysAgo },
        userActivityType: {
          $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.REPLY_POST, UserActivityType.POST_CLICK],
        },
      })
      .select('postId userActivityType createdAt')
      .lean()

    const postIds = recentActivities.map(a => a.postId.toString())
    if (postIds.length === 0) return new Map()

    const posts = await this.commonService.postModel
      .find({ _id: { $in: postIds } })
      .select('categories')
      .lean()

    const postMap = new Map(posts.map(p => [p._id.toString(), p]))
    const categoryScores = new Map<string, number>()

    const now = new Date()
    for (const activity of recentActivities) {
      const post = postMap.get(activity.postId.toString())
      if (!post || !post.categories || post.categories.length === 0) continue

      const interactionWeight =
        activity.userActivityType === UserActivityType.LIKE
          ? 0.2
          : activity.userActivityType === UserActivityType.SHARE
            ? 0.35
            : activity.userActivityType === UserActivityType.REPLY_POST
              ? 0.4
              : 0.1

      const daysAgo = (now.getTime() - new Date(activity.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      const recencyWeight = daysAgo <= 7 ? 1.0 : daysAgo <= 14 ? 0.8 : daysAgo <= 21 ? 0.6 : 0.4

      const score = interactionWeight * recencyWeight
      for (const category of post.categories) {
        categoryScores.set(category, (categoryScores.get(category) || 0) + score)
      }
    }

    // Normalize về [0, 1]
    const maxScore = Math.max(...Array.from(categoryScores.values()), 1)
    const normalized = new Map<string, number>()
    for (const [category, score] of categoryScores.entries()) {
      normalized.set(category, score / maxScore)
    }

    return normalized
  }

  /**
   * Xây dựng Author Preferences từ các tương tác
   */
  private async _buildAuthorPreferences(userId: string): Promise<Map<string, number>> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const recentActivities = await this.userActivityModel
      .find({
        userId,
        postId: { $ne: null },
        createdAt: { $gte: thirtyDaysAgo },
        userActivityType: {
          $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.REPLY_POST, UserActivityType.POST_CLICK],
        },
      })
      .select('postId userActivityType createdAt')
      .lean()

    const postIds = recentActivities.map(a => a.postId.toString())
    if (postIds.length === 0) return new Map()

    const posts = await this.commonService.postModel
      .find({ _id: { $in: postIds } })
      .select('author')
      .lean()

    const postMap = new Map(posts.map(p => [p._id.toString(), p]))
    const authorScores = new Map<string, number>()

    const now = new Date()
    for (const activity of recentActivities) {
      const post = postMap.get(activity.postId.toString())
      if (!post || !post.author) continue

      const authorId = post.author.toString()
      const interactionWeight =
        activity.userActivityType === UserActivityType.LIKE
          ? 0.2
          : activity.userActivityType === UserActivityType.SHARE
            ? 0.35
            : activity.userActivityType === UserActivityType.REPLY_POST
              ? 0.4
              : 0.1

      const daysAgo = (now.getTime() - new Date(activity.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      const recencyWeight = daysAgo <= 7 ? 1.0 : daysAgo <= 14 ? 0.8 : daysAgo <= 21 ? 0.6 : 0.4

      const score = interactionWeight * recencyWeight
      authorScores.set(authorId, (authorScores.get(authorId) || 0) + score)
    }

    // Normalize về [0, 1]
    const maxScore = Math.max(...Array.from(authorScores.values()), 1)
    const normalized = new Map<string, number>()
    for (const [authorId, score] of authorScores.entries()) {
      normalized.set(authorId, score / maxScore)
    }

    return normalized
  }

  /**
   * Tính CBF Score với multi-signal formula
   * DUAL VECTOR STRATEGY: Tính riêng similarity với long-term và short-term
   */
  private async _calculateCBFScore(
    post: Post,
    userInterestVector: number[] | null,
    recentInteractionsProfile: number[] | null,
    categoryPreferences: Map<string, number>,
    authorPreferences: Map<string, number>,
    longTermVector: number[] | null = null,
    shortTermVector: number[] | null = null,
  ): Promise<{
    vectorScore: number
    longTermScore: number
    shortTermScore: number
    recentScore: number
    categoryScore: number
    authorScore: number
    timeDecay: number
    finalScore: number
  }> {
    const postVector = await this.commonService._getPostVector(post._id.toString())

    // DUAL VECTOR: Tính similarity riêng với long-term và short-term
    let longTermScore = 0
    let shortTermScore = 0
    let vectorScore = 0

    if (longTermVector && postVector) {
      longTermScore = this.commonService._cosineSimilarity(longTermVector, postVector)
    }
    if (shortTermVector && postVector) {
      shortTermScore = this.commonService._cosineSimilarity(shortTermVector, postVector)
    }

    // Combined vector score (fallback nếu không có dual vectors)
    if (userInterestVector && postVector && !longTermVector && !shortTermVector) {
      vectorScore = this.commonService._cosineSimilarity(userInterestVector, postVector)
    }

    // Weighted combination của long-term và short-term
    // Cải thiện: Tăng weight cho long-term khi có nhiều interactions (stable preferences)
    // Nếu có cả 2 vectors: 45% long-term, 35% short-term (tăng từ 40%/30%)
    // Nếu chỉ có 1: dùng vector đó
    if (longTermVector && shortTermVector) {
      vectorScore = longTermScore * 0.45 + shortTermScore * 0.35
    } else if (longTermVector) {
      vectorScore = longTermScore
    } else if (shortTermVector) {
      vectorScore = shortTermScore
    }

    // 2. Recent Interactions Score (30%)
    let recentScore = 0
    if (recentInteractionsProfile && postVector) {
      recentScore = this.commonService._cosineSimilarity(recentInteractionsProfile, postVector)
    }

    // 3. Category Score (20%)
    let categoryScore = 0
    if (post.categories && post.categories.length > 0) {
      const categoryMatches = post.categories.map(cat => categoryPreferences.get(cat) || 0).reduce((sum, score) => sum + score, 0)
      categoryScore = categoryMatches / post.categories.length
    } else {
      // Nếu post không có categories, có thể extract từ content hoặc dùng default score
      // Tạm thời để 0, nhưng có thể cải thiện sau bằng cách extract categories từ content
    }

    // 4. Author Score (10%)
    let authorScore = 0
    const authorId = typeof post.author === 'string' ? post.author : (post.author as any)?._id?.toString()
    if (authorId) {
      authorScore = authorPreferences.get(authorId) || 0
    }

    // Boost: Nếu có category hoặc author match, boost thêm score
    // Điều này giúp posts match với user preferences có điểm cao hơn
    let categoryBoost = 0
    let authorBoost = 0
    if (categoryScore > 0.3) {
      // Nếu category score cao, boost thêm
      categoryBoost = categoryScore * 0.15
    }
    if (authorScore > 0.3) {
      // Nếu author score cao, boost thêm
      authorBoost = authorScore * 0.1
    }

    // 5. Time Decay
    const timeDecay = this.commonService._calculateTimeDecayScore(post)
    const hoursDiff = (new Date().getTime() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60)
    const recencyBonus = hoursDiff < 24 ? 0.1 : hoursDiff < 168 ? 0.05 : 0 // < 24h: +0.1, < 7 days: +0.05

    // 6. Final Score với weights
    // Adjust weights nếu thiếu signals (cold start)
    const hasVector = !!userInterestVector
    const hasRecent = !!recentInteractionsProfile
    const hasInteractions = categoryPreferences.size > 0 || authorPreferences.size > 0

    // Cải thiện weights: Điều chỉnh dựa trên có interactions hay không
    // Nếu có interactions, tăng weight cho category/author (có thể match tốt hơn với ground truth)
    let vectorWeight = 0.4
    let recentWeight = 0.3
    let categoryWeight = 0.2
    let authorWeight = 0.1

    // Nếu có interactions, category/author có thể quan trọng hơn
    if (hasInteractions) {
      vectorWeight = 0.4
      recentWeight = 0.25
      categoryWeight = 0.25 // Tăng từ 0.15
      authorWeight = 0.1 // Tăng từ 0.05
    }

    // Cold start adjustment - ưu tiên signals có sẵn
    if (!hasRecent && hasVector) {
      vectorWeight = 0.7
      categoryWeight = 0.25
      authorWeight = 0.05
    } else if (!hasVector && hasRecent) {
      recentWeight = 0.6
      categoryWeight = 0.3
      authorWeight = 0.1
    } else if (!hasInteractions) {
      vectorWeight = 0.55
      recentWeight = 0.45
    }

    const finalScore =
      vectorScore * vectorWeight +
      recentScore * recentWeight +
      categoryScore * categoryWeight +
      authorScore * authorWeight +
      timeDecay * 0.1 + // Time decay contributes 10% to final score
      recencyBonus +
      categoryBoost + // Boost nếu category match tốt
      authorBoost // Boost nếu author match tốt

    return {
      vectorScore,
      longTermScore,
      shortTermScore,
      recentScore,
      categoryScore,
      authorScore,
      timeDecay,
      finalScore,
    }
  }

  /**
   * Build extended interactions profile (90 days) với lower weights
   */
  private async _buildExtendedInteractionsProfile(userId: string, startDate: Date): Promise<number[] | null> {
    const activities = await this.userActivityModel
      .find({
        userId,
        postId: { $ne: null },
        createdAt: { $gte: startDate },
        userActivityType: {
          $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.REPLY_POST, UserActivityType.POST_CLICK],
        },
      })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean()

    if (activities.length === 0) return null

    const now = new Date()
    const weightedVectors: Array<{ vector: number[]; weight: number }> = []

    for (const activity of activities) {
      const postId = activity.postId?.toString()
      if (!postId) continue

      const postVector = await this.commonService._getPostVector(postId)
      if (!postVector) continue

      const interactionWeight =
        activity.userActivityType === UserActivityType.LIKE
          ? 0.15 // Giảm weight vì extended time window
          : activity.userActivityType === UserActivityType.SHARE
            ? 0.25
            : activity.userActivityType === UserActivityType.REPLY_POST
              ? 0.3
              : 0.08

      const daysAgo = (now.getTime() - new Date(activity.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      let recencyWeight = 1.0
      if (daysAgo > 30 && daysAgo <= 60) recencyWeight = 0.5
      else if (daysAgo > 60 && daysAgo <= 90) recencyWeight = 0.3

      weightedVectors.push({
        vector: postVector,
        weight: interactionWeight * recencyWeight,
      })
    }

    if (weightedVectors.length === 0) return null

    const dimension = weightedVectors[0].vector.length
    const sumVector = new Array(dimension).fill(0)
    let totalWeight = 0

    for (const { vector, weight } of weightedVectors) {
      for (let i = 0; i < dimension; i++) {
        sumVector[i] += vector[i] * weight
      }
      totalWeight += weight
    }

    if (totalWeight === 0) return null

    const averageVector = sumVector.map(v => v / totalWeight)
    const magnitude = Math.sqrt(averageVector.reduce((sum, v) => sum + v * v, 0))
    return magnitude > 0 ? averageVector.map(v => v / magnitude) : null
  }

  /**
   * Lấy danh sách post IDs cần exclude
   */
  private async _getExcludedPostIds(userId: string): Promise<string[]> {
    const highIntentPostIds = await this.userActivityModel.distinct('postId', {
      userId,
      postId: { $ne: null },
      userActivityType: { $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.REPLY_POST] },
    })

    const repliedPostIds = await this.commonService.postModel.distinct('parentId', {
      author: userId,
      parentId: { $ne: null },
    })

    return [...new Set([...highIntentPostIds.map(id => id.toString()), ...repliedPostIds.map(id => id.toString())])]
  }
}
