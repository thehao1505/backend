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
      if (cached && configs.isSkipCacheRecommendation !== 'true') return cached

      const cbfPool = await this.getCBFCandidates(userId, this.HYBRID_POOL_LIMIT)

      if (cbfPool.length === 0) {
        this.logger.log(`[CBF] Cold-start for user ${userId}, fallback to popular post.`)
        return this.commonService._getFallbackPopularPosts(query)
      }

      const diversePosts = await this.commonService._getDiversePostsByAuthor(cbfPool, cbfPool.length)

      const total = diversePosts.length
      const items = diversePosts.slice((page - 1) * limit, page * limit)

      const recommendations = {
        items: this.commonService._addSourceToPosts(items, 'cbf'),
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
    const [longTermVector, shortTermVector, userInterestVector, recentInteractionsProfile, categoryPreferences, authorPreferences] =
      await Promise.all([
        this.commonService._getUserLongTermVector(userId),
        this.commonService._getUserShortTermVector(userId),
        this.commonService._getUserInterestVector(userId),
        this._buildRecentInteractionsProfile(userId), // 30%
        this._buildCategoryPreferences(userId), // 20%
        this._buildAuthorPreferences(userId), // 10%
      ])

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
          const expandedPoolLimit = Math.min(poolLimit * 8, 100)
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
            const similarPostIds = similar.map(item => item.id.toString())
            const similarPostsRaw = await this.commonService.postModel
              .find({ _id: { $in: similarPostIds }, isHidden: false, parentId: null, isReply: false })
              .populate('author', 'username avatar fullName')
              .lean()

            const idToPostMap = new Map(similarPostsRaw.map(post => [post._id.toString(), post]))
            const candidatePosts = similarPostIds.map(id => idToPostMap.get(id.toString())).filter(Boolean)

            const extendedPostIds = candidatePosts.map(p => p._id.toString())
            const extendedPostVectorsMap = await this.commonService._getPostVectorsBatch(extendedPostIds)

            const scoredPosts = candidatePosts.map(post => {
              const postVector = extendedPostVectorsMap.get(post._id.toString())
              const similarity = postVector ? this.commonService._cosineSimilarity(extendedProfile, postVector) : 0
              const categoryScore = post.categories
                ? post.categories.map(cat => categoryPreferences.get(cat) || 0).reduce((sum, score) => sum + score, 0) /
                  post.categories.length
                : 0
              const timeDecay = this.commonService._calculateTimeDecayScore(post)
              const finalScore = similarity * 0.6 + categoryScore * 0.3 + timeDecay * 0.1
              return { ...post, score: finalScore }
            })

            scoredPosts.sort((a, b) => b.score - a.score)
            const diversePosts = await this.commonService._applyDiversityFilter(scoredPosts, poolLimit)
            return diversePosts
          }
        }
      }

      return []
    }

    const queryVector = userInterestVector || recentInteractionsProfile

    const excludedPostIds = await this._getExcludedPostIds(userId)

    const expandedPoolLimit = Math.min(poolLimit * 8, 100)
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

    const similarPostIds = similar.map(item => item.id.toString())
    const [similarPostsRaw, postVectorsMap] = await Promise.all([
      this.commonService.postModel
        .find({ _id: { $in: similarPostIds }, isHidden: false, parentId: null, isReply: false })
        .populate('author', 'username avatar fullName')
        .lean(),
      this.commonService._getPostVectorsBatch(similarPostIds),
    ])

    const idToPostMap = new Map(similarPostsRaw.map(post => [post._id.toString(), post]))
    const candidatePosts = similarPostIds.map(id => idToPostMap.get(id.toString())).filter(Boolean)

    const scoredPosts = candidatePosts.map(post => {
      const postVector = postVectorsMap.get(post._id.toString())
      const scores = this._calculateCBFScoreSync(
        post,
        postVector,
        userInterestVector,
        recentInteractionsProfile,
        categoryPreferences,
        authorPreferences,
        longTermVector,
        shortTermVector,
      )
      return { ...post, score: scores.finalScore, scoreDetails: scores }
    })

    scoredPosts.sort((a, b) => b.score - a.score)
    const diversePosts = await this.commonService._applyDiversityFilter(scoredPosts, poolLimit)

    return diversePosts
  }

  private async _buildRecentInteractionsProfile(userId: string): Promise<number[] | null> {
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
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()

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

    const now = new Date()
    const weightedVectors: Array<{ vector: number[]; weight: number }> = []

    const activityPostIds = allActivities.map(a => a.postId?.toString()).filter(Boolean) as string[]
    const postVectorsMap = await this.commonService._getPostVectorsBatch(activityPostIds)

    for (const activity of allActivities) {
      const postId = activity.postId?.toString()
      if (!postId) continue

      const postVector = postVectorsMap.get(postId)
      if (!postVector) continue

      const interactionWeight =
        activity.userActivityType === UserActivityType.LIKE
          ? 0.2
          : activity.userActivityType === UserActivityType.SHARE
            ? 0.35
            : activity.userActivityType === UserActivityType.REPLY_POST
              ? 0.4
              : activity.userActivityType === UserActivityType.POST_CLICK
                ? 0.1
                : 0.05

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

    const maxScore = Math.max(...Array.from(categoryScores.values()), 1)
    const normalized = new Map<string, number>()
    for (const [category, score] of categoryScores.entries()) {
      normalized.set(category, score / maxScore)
    }

    return normalized
  }

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

    const maxScore = Math.max(...Array.from(authorScores.values()), 1)
    const normalized = new Map<string, number>()
    for (const [authorId, score] of authorScores.entries()) {
      normalized.set(authorId, score / maxScore)
    }

    return normalized
  }

  private _calculateCBFScoreSync(
    post: Post,
    postVector: number[] | null,
    userInterestVector: number[] | null,
    recentInteractionsProfile: number[] | null,
    categoryPreferences: Map<string, number>,
    authorPreferences: Map<string, number>,
    longTermVector: number[] | null = null,
    shortTermVector: number[] | null = null,
  ): {
    vectorScore: number
    longTermScore: number
    shortTermScore: number
    recentScore: number
    categoryScore: number
    authorScore: number
    timeDecay: number
    finalScore: number
  } {
    let longTermScore = 0
    let shortTermScore = 0
    let vectorScore = 0

    if (longTermVector && postVector) {
      longTermScore = this.commonService._cosineSimilarity(longTermVector, postVector)
    }
    if (shortTermVector && postVector) {
      shortTermScore = this.commonService._cosineSimilarity(shortTermVector, postVector)
    }

    if (userInterestVector && postVector && !longTermVector && !shortTermVector) {
      vectorScore = this.commonService._cosineSimilarity(userInterestVector, postVector)
    }

    if (longTermVector && shortTermVector) {
      vectorScore = longTermScore * 0.45 + shortTermScore * 0.35
    } else if (longTermVector) {
      vectorScore = longTermScore
    } else if (shortTermVector) {
      vectorScore = shortTermScore
    }

    // (30%)
    let recentScore = 0
    if (recentInteractionsProfile && postVector) {
      recentScore = this.commonService._cosineSimilarity(recentInteractionsProfile, postVector)
    }

    // (20%)
    let categoryScore = 0
    if (post.categories && post.categories.length > 0) {
      const categoryMatches = post.categories.map(cat => categoryPreferences.get(cat) || 0).reduce((sum, score) => sum + score, 0)
      categoryScore = categoryMatches / post.categories.length
    }

    // (10%)
    let authorScore = 0
    const authorId = typeof post.author === 'string' ? post.author : (post.author as any)?._id?.toString()
    if (authorId) {
      authorScore = authorPreferences.get(authorId) || 0
    }

    let categoryBoost = 0
    let authorBoost = 0
    if (categoryScore > 0.3) {
      categoryBoost = categoryScore * 0.15
    }
    if (authorScore > 0.3) {
      authorBoost = authorScore * 0.1
    }

    const timeDecay = this.commonService._calculateTimeDecayScore(post)
    const hoursDiff = (new Date().getTime() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60)
    const recencyBonus = hoursDiff < 24 ? 0.1 : hoursDiff < 168 ? 0.05 : 0 // < 24h: +0.1, < 7 days: +0.05

    const hasVector = !!userInterestVector
    const hasRecent = !!recentInteractionsProfile
    const hasInteractions = categoryPreferences.size > 0 || authorPreferences.size > 0

    let vectorWeight = 0.4
    let recentWeight = 0.3
    let categoryWeight = 0.2
    let authorWeight = 0.1

    if (hasInteractions) {
      vectorWeight = 0.4
      recentWeight = 0.25
      categoryWeight = 0.25
      authorWeight = 0.1
    }

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
      timeDecay * 0.1 +
      recencyBonus +
      categoryBoost +
      authorBoost

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
    return this._calculateCBFScoreSync(
      post,
      postVector,
      userInterestVector,
      recentInteractionsProfile,
      categoryPreferences,
      authorPreferences,
      longTermVector,
      shortTermVector,
    )
  }

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

    const extendedPostIds = activities.map(a => a.postId?.toString()).filter(Boolean) as string[]
    const extendedPostVectorsMap = await this.commonService._getPostVectorsBatch(extendedPostIds)

    for (const activity of activities) {
      const postId = activity.postId?.toString()
      if (!postId) continue

      const postVector = extendedPostVectorsMap.get(postId)
      if (!postVector) continue

      const interactionWeight =
        activity.userActivityType === UserActivityType.LIKE
          ? 0.15
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

  private async _getExcludedPostIds(userId: string): Promise<string[]> {
    const [highIntentPostIds, repliedPostIds] = await Promise.all([
      this.userActivityModel.distinct('postId', {
        userId,
        postId: { $ne: null },
        userActivityType: { $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.REPLY_POST] },
      }),
      this.commonService.postModel.distinct('parentId', {
        author: userId,
        parentId: { $ne: null },
      }),
    ])

    return [...new Set([...highIntentPostIds.map(id => id.toString()), ...repliedPostIds.map(id => id.toString())])]
  }
}
