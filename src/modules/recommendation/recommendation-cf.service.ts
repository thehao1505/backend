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
export class RecommendationCfService {
  private readonly logger = new Logger(RecommendationCfService.name)
  private readonly HYBRID_POOL_LIMIT = 100

  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(UserActivity.name) private readonly userActivityModel: Model<UserActivity>,
    private readonly commonService: RecommendationCommonService,
  ) {}

  async getRecommendations_CF(userId: string, query: QueryRecommendationDto) {
    const { page, limit } = query
    const cacheKey = `recommendation:cf:${userId}:${page}:${limit}`

    try {
      const cached = await this.commonService._getCachedRecommendations(cacheKey)
      if (cached && configs.isSkipCacheRecommendation === 'true') return cached

      const cfPool = await this.getCFCandidatesAsPost(userId, this.HYBRID_POOL_LIMIT)

      if (cfPool.length === 0) {
        this.logger.log(`[CF] Candidates not found for ${userId}`)
        return { items: [], total: 0, page, limit, totalPages: 0 }
      }

      const total = cfPool.length
      const items = cfPool.slice((page - 1) * limit, page * limit)

      const recommendations = {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }

      if (page === 1) {
        this.commonService._logRecommendations(userId, 'cf', items)
      }

      await this.commonService._cacheRecommendations(cacheKey, recommendations)
      return recommendations
    } catch (error) {
      this.logger.error(`[CF] Error when fetch recommendations: ${error.message}`)
      return { items: [], total: 0, page, limit, totalPages: 0 }
    }
  }

  /**
   * CF Strategy mới: Multi-signal approach với weighted similarity và quality scoring
   * Kết hợp: User Similarity, Interaction Quality, Recency, Popularity Boost
   */
  async getCFCandidatesAsPost(userId: string, poolLimit: number) {
    // 1. Lấy High Intent Interactions của user
    const myInteractions = await this._getHighIntentInteractionWithDetails(userId)
    if (myInteractions.length === 0) {
      this.logger.log(`[CF] User ${userId} không có high intent interactions`)
      return []
    }

    // 2. Tìm Similar Users với weighted Jaccard similarity
    const similarUsers = await this._getSimilarUsersWeighted(userId, myInteractions)
    if (similarUsers.length === 0) {
      this.logger.log(`[CF] User ${userId} không tìm thấy similar users (${myInteractions.length} interactions)`)
      return []
    }

    this.logger.debug(`[CF] User ${userId} tìm thấy ${similarUsers.length} similar users`)

    // 3. Lấy candidate posts từ similar users (mở rộng pool để có đủ diversity)
    // Tăng pool size để có nhiều candidates hơn, cải thiện recall
    const expandedPoolLimit = Math.min(poolLimit * 5, 500) // Tăng từ 300 lên 500
    const candidatePosts = await this._getCFCandidatesWithDetails(
      similarUsers,
      myInteractions.map(i => i.postId),
      expandedPoolLimit,
    )

    if (candidatePosts.length === 0) return []

    // 4. Score mỗi post với multi-signal formula
    const scoredPosts = await Promise.all(
      candidatePosts.map(async candidate => {
        const scores = await this._calculateCFScore(candidate.post, candidate.interactions, similarUsers, myInteractions)
        return { ...candidate.post, score: scores.finalScore, scoreDetails: scores }
      }),
    )

    // 5. Sort và apply diversity
    scoredPosts.sort((a, b) => b.score - a.score)
    // Extract posts từ scored posts để pass vào diversity filter
    const postsForDiversity = scoredPosts.map(sp => sp as any as Post)
    const diversePosts = await this.commonService._applyDiversityFilter(postsForDiversity, poolLimit)

    // Map lại để giữ score và scoreDetails
    const diverseScoredPosts = diversePosts.map(post => {
      const scored = scoredPosts.find(sp => sp._id.toString() === post._id.toString())
      return scored || (post as any)
    })

    return diverseScoredPosts
  }

  /**
   * Tính similarity giữa users với weighted Jaccard similarity
   * Cải tiến: Sử dụng interaction weights và recency weights
   */
  private async _getSimilarUsersWeighted(userId: string, myInteractions: Array<{ postId: string; type: string; createdAt: Date }>) {
    const myPostIds = myInteractions.map(i => i.postId)
    const now = new Date()

    // Tính weighted sum cho my interactions
    const myWeightedSum = myInteractions.reduce((sum, interaction) => {
      const interactionWeight = this.commonService._getInteractionWeight(interaction.type)
      const daysAgo = (now.getTime() - new Date(interaction.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      const recencyWeight = this.commonService._getRecencyWeight(daysAgo)
      return sum + interactionWeight * recencyWeight
    }, 0)

    // Lấy activities từ similar users
    const activityAgg = this.userActivityModel.aggregate([
      {
        $match: {
          postId: { $in: myPostIds },
          userId: { $ne: userId },
          userActivityType: {
            $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.POST_CLICK, UserActivityType.REPLY_POST],
          },
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
        $project: {
          userId: 1,
          postId: 1,
          userActivityType: 1,
          createdAt: 1,
        },
      },
    ])

    // Lấy replies từ similar users
    const replyAgg = this.commonService.postModel.aggregate([
      {
        $match: {
          parentId: { $in: myPostIds },
          author: { $ne: userId },
        },
      },
      {
        $project: {
          author: 1,
          parentId: 1,
          createdAt: 1,
        },
      },
    ])

    const [activityUsers, replyUsers] = await Promise.all([activityAgg, replyAgg])

    // Group by user và tính weighted intersection
    const userOverlaps = new Map<string, Array<{ postId: string; type: string; createdAt: Date }>>()

    activityUsers.forEach(activity => {
      const uid = activity.userId.toString()
      if (!userOverlaps.has(uid)) {
        userOverlaps.set(uid, [])
      }
      userOverlaps.get(uid).push({
        postId: activity.postId.toString(),
        type: activity.userActivityType,
        createdAt: activity.createdAt,
      })
    })

    replyUsers.forEach(reply => {
      const uid = reply.author.toString()
      if (!userOverlaps.has(uid)) {
        userOverlaps.set(uid, [])
      }
      userOverlaps.get(uid).push({
        postId: reply.parentId.toString(),
        type: UserActivityType.REPLY_POST,
        createdAt: reply.createdAt,
      })
    })

    // Tính weighted similarity cho mỗi user
    const similarUsers: Array<{ userId: string; similarity: number; overlapCount: number }> = []

    for (const [similarUserId, overlaps] of userOverlaps.entries()) {
      // Weighted intersection
      let weightedIntersection = 0
      const myInteractionMap = new Map(myInteractions.map(i => [i.postId, { type: i.type, createdAt: i.createdAt }]))

      for (const overlap of overlaps) {
        const myInteraction = myInteractionMap.get(overlap.postId)
        if (!myInteraction) continue

        const myWeight =
          this.commonService._getInteractionWeight(myInteraction.type) *
          this.commonService._getRecencyWeight((now.getTime() - new Date(myInteraction.createdAt).getTime()) / (1000 * 60 * 60 * 24))
        const theirWeight =
          this.commonService._getInteractionWeight(overlap.type) *
          this.commonService._getRecencyWeight((now.getTime() - new Date(overlap.createdAt).getTime()) / (1000 * 60 * 60 * 24))

        // Use minimum weight (both users need to have interacted)
        weightedIntersection += Math.min(myWeight, theirWeight)
      }

      // Lấy interactions của similar user để tính union
      const theirInteractions = await this._getHighIntentInteractionWithDetails(similarUserId)
      const theirWeightedSum = theirInteractions.reduce((sum, interaction) => {
        const interactionWeight = this.commonService._getInteractionWeight(interaction.type)
        const daysAgo = (now.getTime() - new Date(interaction.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        const recencyWeight = this.commonService._getRecencyWeight(daysAgo)
        return sum + interactionWeight * recencyWeight
      }, 0)

      // Weighted union
      const weightedUnion = myWeightedSum + theirWeightedSum - weightedIntersection

      if (weightedUnion === 0 || overlaps.length < 2) continue // Minimum 2 overlaps

      const similarity = weightedIntersection / weightedUnion

      // Filter: Giảm threshold xuống 0.03 để có nhiều similar users hơn, cải thiện coverage
      // Đồng thời yêu cầu tối thiểu 2 overlaps (đã có ở trên)
      if (similarity > 0.03) {
        similarUsers.push({
          userId: similarUserId,
          similarity,
          overlapCount: overlaps.length,
        })
      }
    }

    // Sort và return top 50 (tăng từ 30) để có nhiều candidates hơn
    similarUsers.sort((a, b) => b.similarity - a.similarity)
    return similarUsers.slice(0, 50)
  }

  /**
   * Lấy High Intent Interactions với details (type, createdAt)
   */
  private async _getHighIntentInteractionWithDetails(userId: string): Promise<Array<{ postId: string; type: string; createdAt: Date }>> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // Standard interactions
    const standardInteractions = await this.userActivityModel
      .find({
        userId,
        postId: { $ne: null },
        createdAt: { $gte: thirtyDaysAgo },
        userActivityType: {
          $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.POST_CLICK],
        },
      })
      .select('postId userActivityType createdAt')
      .lean()

    // Reply interactions
    const replyInteractions = await this.commonService.postModel
      .find({
        author: userId,
        parentId: { $ne: null },
        createdAt: { $gte: thirtyDaysAgo },
      })
      .select('parentId createdAt')
      .lean()

    // High dwell time views
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
          $project: {
            postId: 1,
            userActivityType: 1,
            createdAt: 1,
          },
        },
      ])
      .exec()

    const allInteractions: Array<{ postId: string; type: string; createdAt: Date }> = [
      ...standardInteractions.map(i => ({
        postId: i.postId.toString(),
        type: i.userActivityType,
        createdAt: i.createdAt,
      })),
      ...replyInteractions.map(i => ({
        postId: i.parentId.toString(),
        type: UserActivityType.REPLY_POST,
        createdAt: i.createdAt,
      })),
      ...highDwellTimeViews.map(i => ({
        postId: i.postId.toString(),
        type: UserActivityType.POST_VIEW,
        createdAt: i.createdAt,
      })),
    ]

    // Remove duplicates (keep most recent)
    const uniqueInteractions = new Map<string, { postId: string; type: string; createdAt: Date }>()
    for (const interaction of allInteractions) {
      const existing = uniqueInteractions.get(interaction.postId)
      if (!existing || new Date(interaction.createdAt) > new Date(existing.createdAt)) {
        uniqueInteractions.set(interaction.postId, interaction)
      }
    }

    return Array.from(uniqueInteractions.values())
  }

  /**
   * Lấy CF Candidates với interaction details
   */
  private async _getCFCandidatesWithDetails(
    similarUsers: Array<{ userId: string; similarity: number; overlapCount: number }>,
    myInteractions: string[],
    poolLimit: number,
  ): Promise<
    Array<{
      post: Post
      interactions: Array<{ userId: string; type: string; createdAt: Date; similarity: number }>
    }>
  > {
    const similarUserIds = similarUsers.map(u => u.userId)
    const similarityMap = new Map(similarUsers.map(u => [u.userId, u.similarity]))

    // Lấy activities từ similar users
    const activityAgg = this.userActivityModel.aggregate([
      {
        $match: {
          userId: { $in: similarUserIds },
          postId: { $nin: myInteractions },
          userActivityType: {
            $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.POST_CLICK, UserActivityType.REPLY_POST],
          },
        },
      },
      {
        $project: {
          userId: 1,
          postId: 1,
          userActivityType: 1,
          createdAt: 1,
        },
      },
    ])

    // Lấy replies từ similar users
    const replyAgg = this.commonService.postModel.aggregate([
      {
        $match: {
          author: { $in: similarUserIds },
          parentId: { $ne: null, $nin: myInteractions },
        },
      },
      {
        $project: {
          author: 1,
          parentId: 1,
          createdAt: 1,
        },
      },
    ])

    const [activities, replies] = await Promise.all([activityAgg, replyAgg])

    // Group by postId
    const postInteractions = new Map<string, Array<{ userId: string; type: string; createdAt: Date; similarity: number }>>()

    activities.forEach(activity => {
      const postId = activity.postId.toString()
      const userId = activity.userId.toString()
      if (!postInteractions.has(postId)) {
        postInteractions.set(postId, [])
      }
      postInteractions.get(postId).push({
        userId,
        type: activity.userActivityType,
        createdAt: activity.createdAt,
        similarity: similarityMap.get(userId) || 0,
      })
    })

    replies.forEach(reply => {
      const postId = reply.parentId.toString()
      const userId = reply.author.toString()
      if (!postInteractions.has(postId)) {
        postInteractions.set(postId, [])
      }
      postInteractions.get(postId).push({
        userId,
        type: UserActivityType.REPLY_POST,
        createdAt: reply.createdAt,
        similarity: similarityMap.get(userId) || 0,
      })
    })

    // Load posts
    const postIds = Array.from(postInteractions.keys()).slice(0, poolLimit)
    const posts = await this.commonService.postModel
      .find({ _id: { $in: postIds }, isHidden: false, parentId: null, isReply: false })
      .populate('author', 'username avatar fullName')
      .lean()

    const postMap = new Map(posts.map(p => [p._id.toString(), p]))

    return postIds
      .map(postId => {
        const post = postMap.get(postId)
        if (!post) return null
        return {
          post,
          interactions: postInteractions.get(postId) || [],
        }
      })
      .filter(Boolean)
  }

  /**
   * Tính CF Score với multi-signal formula
   */
  private async _calculateCFScore(
    post: Post,
    interactions: Array<{ userId: string; type: string; createdAt: Date; similarity: number }>,
    similarUsers: Array<{ userId: string; similarity: number; overlapCount: number }>,
    myInteractions: Array<{ postId: string; type: string; createdAt: Date }>,
  ): Promise<{
    similarityScore: number
    qualityScore: number
    recencyScore: number
    popularityScore: number
    timeDecay: number
    finalScore: number
  }> {
    const now = new Date()

    // 1. User Similarity Score (45% - tăng từ 40%)
    // Weighted average similarity của users tương tác với post
    // Sử dụng weighted average thay vì simple average để ưu tiên users có similarity cao hơn
    let similarityScore = 0
    if (interactions.length > 0) {
      const totalSimilarity = interactions.reduce((sum, i) => sum + i.similarity * i.similarity, 0) // Weighted by similarity^2
      const totalWeight = interactions.reduce((sum, i) => sum + i.similarity, 0)
      similarityScore = totalWeight > 0 ? totalSimilarity / totalWeight : 0
    }

    // 2. Interaction Quality Score (30%)
    let qualityScore = 0
    if (interactions.length > 0) {
      const weightedSum = interactions.reduce((sum, interaction) => {
        const interactionWeight = this.commonService._getInteractionWeight(interaction.type)
        const daysAgo = (now.getTime() - new Date(interaction.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        const recencyWeight = this.commonService._getRecencyWeight(daysAgo)
        return sum + interactionWeight * recencyWeight * interaction.similarity
      }, 0)
      qualityScore = weightedSum / interactions.length
    }

    // 3. Recency Score (20%)
    let recencyScore = 0
    if (interactions.length > 0) {
      const recencySum = interactions.reduce((sum, interaction) => {
        const daysAgo = (now.getTime() - new Date(interaction.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        const recencyDecay = this.commonService._getRecencyDecay(daysAgo)
        return sum + recencyDecay * interaction.similarity
      }, 0)
      recencyScore = recencySum / interactions.length
    }

    // 4. Popularity Boost (10%)
    const uniqueSimilarUsers = new Set(interactions.map(i => i.userId)).size
    const totalSimilarUsers = similarUsers.length
    const popularityScore = totalSimilarUsers > 0 ? Math.log(1 + uniqueSimilarUsers) / Math.log(1 + totalSimilarUsers) : 0

    // 5. Time Decay
    const timeDecay = this.commonService._calculateTimeDecayScore(post)
    const hoursDiff = (now.getTime() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60)
    const recencyBonus = hoursDiff < 24 ? 0.1 : hoursDiff < 168 ? 0.05 : 0

    // 6. Final Score - Cải thiện weights
    const finalScore =
      similarityScore * 0.45 + // Tăng từ 0.4
      qualityScore * 0.3 +
      recencyScore * 0.15 + // Giảm từ 0.2
      popularityScore * 0.1 +
      timeDecay * 0.1 +
      recencyBonus

    return {
      similarityScore,
      qualityScore,
      recencyScore,
      popularityScore,
      timeDecay,
      finalScore,
    }
  }
}
