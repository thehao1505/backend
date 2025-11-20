import { QueryRecommendationDto, QuerySearchDto } from '@dtos/recommendation.dto'
import { RecommendationLog, User, UserActivity, UserActivityType } from '@entities/index'
import { Post } from '@entities/post.entity'
import { UserFollow } from '@entities/user-follow.entity'
import { EmbeddingService, PostService, QdrantService, RedisService } from '@modules/index-service'
import { InjectQueue } from '@nestjs/bullmq'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron, CronExpression } from '@nestjs/schedule'
import { configs } from '@utils/configs/config'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name)
  private readonly CACHE_TTL = 60 * 30
  private readonly HYBRID_POOL_LIMIT = 100

  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(UserFollow.name) private readonly userFollowModel: Model<UserFollow>,
    @InjectModel(UserActivity.name) private readonly userActivityModel: Model<UserActivity>,
    @InjectModel(RecommendationLog.name) private readonly recommendationLogModel: Model<RecommendationLog>,
    @InjectQueue('embedding') private readonly embeddingQueue: Queue,
    private readonly qdrantService: QdrantService,
    private readonly embeddingService: EmbeddingService,
    private readonly redisService: RedisService,
    private readonly postService: PostService,
  ) {}

  // @Cron(CronExpression.EVERY_10_MINUTES)
  async handleEnqueuePostForEmbedding() {
    if (configs.isSkipCron === 'true') return
    const posts = await this.postModel
      .find({ isEmbedded: { $ne: true } })
      .limit(100)
      .lean()

    if (!posts.length) return

    for (const post of posts) {
      await this.enqueuePostForEmbedding(post._id)
    }
  }

  async enqueuePostForEmbedding(postId: string) {
    await this.embeddingQueue.add(
      'process-post-embedding',
      { postId },
      {
        attempts: 1,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    )
    this.logger.log(`Enqueued post ${postId} for embedding`)
  }

  async getSimilarPosts(postId: string, query: QueryRecommendationDto) {
    const { page, limit } = query
    try {
      const post = await this.postModel.findById(postId).lean()
      if (!post) throw new BadRequestException('Post not found')

      const postVector = await this._getPostVector(postId)
      if (!postVector) {
        throw new BadRequestException('Post vector not found')
      }

      const filter = {
        must_not: [{ key: 'postId', match: { value: postId.toString() } }],
      }

      const similar = await this.qdrantService.searchSimilar(
        configs.postCollectionName,
        postVector,
        Number(limit),
        Number(page - 1),
        filter,
      )

      const similarPostIds = similar.map(item => item.id).filter(id => id !== postId)
      const total = similarPostIds.length

      const similarPostsRaw = await this.postModel
        .find({ _id: { $in: similarPostIds }, isHidden: false })
        .populate('author', 'username avatar fullName')
        .lean()

      const idToPostMap = new Map(similarPostsRaw.map(post => [post._id.toString(), post]))
      const similarPosts = similarPostIds.map(id => idToPostMap.get(id.toString())).filter(Boolean)

      return {
        items: similarPosts,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    } catch (error) {
      this.logger.error(`Error finding similar posts: ${error.message}`, error.stack)
      throw new BadRequestException(`Failed to find similar posts: ${error.message}`)
    }
  }

  async getFollowingRecommendations(userId: string, query: QueryRecommendationDto) {
    const { page, limit } = query

    try {
      const followingRelations = await this.userFollowModel.find({ followerId: userId }).select('followingId').lean()
      const followingIds = followingRelations.map(rel => rel.followingId)

      if (followingIds.length === 0) {
        return { items: [], total: 0, page, limit, totalPages: 0 }
      }

      const totalFollowingPosts = await this.postModel.countDocuments({
        author: { $in: followingIds },
        isHidden: false,
      })

      if (totalFollowingPosts === 0) {
        return { items: [], total: 0, page, limit, totalPages: 0 }
      }

      const followingPosts = await this.postModel
        .find({
          author: { $in: followingIds },
          isHidden: false,
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('author', 'username avatar fullName')
        .lean()

      // Áp dụng đa dạng hóa để 1 user không chiếm hết feed
      const diversePosts = await this._getDiversePostsByAuthor(followingPosts, limit)

      return {
        items: diversePosts,
        total: totalFollowingPosts,
        page,
        limit,
        totalPages: Math.ceil(totalFollowingPosts / limit),
      }
    } catch (error) {
      this.logger.error(`[Following] Lỗi khi lấy feed: ${error.message}`)
      throw new BadRequestException('Không thể tải feed "Following"')
    }
  }

  async search(userId: string, query: QuerySearchDto) {
    const { page, limit, text } = query
    const embedding = await this.embeddingService.generateEmbedding(text)

    if (text) {
      await this.postService.searchActivity(text, userId, embedding)
    }
    const similar = await this.qdrantService.searchSimilar(configs.postCollectionName, embedding, Number(limit), Number(page), {})

    const similarPostIds = similar.map(item => item.id)
    const similarPostsRaw = await this.postModel
      .find({ _id: { $in: similarPostIds }, isHidden: false })
      .populate('author', 'username avatar fullName')
      .lean()

    const idToPostMap = new Map(similarPostsRaw.map(post => [post._id.toString(), post]))
    const similarPosts = similarPostIds.map(id => idToPostMap.get(id.toString())).filter(Boolean)

    return similarPosts
  }

  async getHybridRecommendations(userId: string, query: QueryRecommendationDto) {
    const { page, limit } = query
    const cacheKey = `recommendations:hybrid:${userId}:${page}:${limit}`

    try {
      const cached = await this._getCachedRecommendations(cacheKey)
      if (cached) return cached

      const cbfPool = await this._getCBFCandidates(userId, this.HYBRID_POOL_LIMIT)
      const cfPool = await this._getCFCandidatesAsPost(userId, this.HYBRID_POOL_LIMIT)

      if (cbfPool.length === 0 && cfPool.length === 0) {
        this.logger.log(`[Hybrid] Cold-start cho user ${userId}, fallback to popular post`)
        return this._getFallbackPopularPosts(query)
      }

      const mergedList = this._interleaveList(cbfPool, cfPool)

      const diverseList = await this._getDiversePostsByAuthor(mergedList, mergedList.length)

      const total = diverseList.length
      const items = diverseList.slice((page - 1) * limit, page * limit)

      const recommendations = {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }

      if (page === 1) {
        this._logRecommendations(userId, 'hybrid', items)
      }

      await this._cacheRecommendations(cacheKey, recommendations)
      return recommendations
    } catch (error) {
      this.logger.log(`[Hybrid] Error when fetch recommendations: ${error.message}`)
      return this._getFallbackPopularPosts(query)
    }
  }

  async getRecommendations_CBF(userId: string, query: QueryRecommendationDto) {
    const { page, limit } = query
    const cacheKey = `recommendations:cbf:${userId}:${page}:${limit}`

    try {
      const cached = await this._getCachedRecommendations(cacheKey)
      if (cached) return cached

      const cbfPool = await this._getCBFCandidates(userId, this.HYBRID_POOL_LIMIT)

      // Cold-start
      if (cbfPool.length === 0) {
        this.logger.log(`[CBF] Cold-start for user ${userId}, fallback to popular post.`)
        return this._getFallbackPopularPosts(query)
      }

      const diversePosts = await this._getDiversePostsByAuthor(cbfPool, cbfPool.length)

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
        this._logRecommendations(userId, 'cbf', items)
      }

      await this._cacheRecommendations(cacheKey, recommendations)
      return recommendations
    } catch (error) {
      this.logger.error(`[CBF] Error when fetch recommendations: ${error.message}`)
      return this._getFallbackPopularPosts(query)
    }
  }

  async getRecommendations_CF(userId: string, query: QueryRecommendationDto) {
    const { page, limit } = query
    const cacheKey = `recommendation:cf:${userId}:${page}:${limit}`

    try {
      const cached = await this._getCachedRecommendations(cacheKey)
      if (cached) return cached

      const cfPool = await this._getCFCandidatesAsPost(userId, this.HYBRID_POOL_LIMIT)

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
        this._logRecommendations(userId, 'cf', items)
      }

      await this._cacheRecommendations(cacheKey, recommendations)
      return recommendations
    } catch (error) {
      this.logger.error(`[CF] Error when fetch recommendations: ${error.message}`)
      return { items: [], total: 0, page, limit, totalPages: 0 }
    }
  }

  private _interleaveList(listA: Post[], listB: Post[]) {
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

  private async _getCBFCandidates(userId: string, poolLimit: number) {
    const userInterestVector = await this._getUserInterestVector(userId)
    if (!userInterestVector) {
      return []
    }

    const interactedPostIds = await this.userActivityModel.distinct('postId', { userId, postId: { $ne: null } })
    const interactedPostIdsStr = interactedPostIds.map(id => id)

    const filter = {
      must_not: [
        { key: 'author', match: { value: userId } },
        ...interactedPostIdsStr.map(postId => ({
          key: 'postId',
          match: { value: postId },
        })),
      ],
    }

    const similar = await this.qdrantService.searchSimilar(configs.postCollectionName, userInterestVector, poolLimit, 1, filter)
    if (similar.length === 0) return []

    const similarPostIds = similar.map(item => item.id)
    const similarPostsRaw = await this.postModel
      .find({ _id: { $in: similarPostIds }, isHidden: false })
      .populate('author', 'username avatar fullName')
      .lean()

    const idToPostMap = new Map(similarPostsRaw.map(post => [post._id, post]))
    const sortedSimilarPosts = similarPostIds.map(id => idToPostMap.get(id.toString())).filter(Boolean)

    const scoredPosts = sortedSimilarPosts.map(post => ({
      ...post,
      score: this._calculateTimeDecayScore(post),
    }))
    scoredPosts.sort((a, b) => b.score - a.score)

    return scoredPosts
  }

  private async _getCFCandidatesAsPost(userId: string, poolLimit: number) {
    const myInteractions = await this._getHighIntentInteraction(userId)
    if (myInteractions.length === 0) return []

    const similarUsers = await this._getSimilarUsers(userId, myInteractions)
    if (similarUsers.length === 0) return []
    const similarUserIds = similarUsers.map(u => u.userId)

    const candidateScores = await this._getCFCandidates(similarUserIds, myInteractions)
    if (candidateScores.size === 0) return []

    const sortedCandidates = Array.from(candidateScores.entries()).map(([postId, score]) => ({ postId, score }))
    sortedCandidates.sort((a, b) => b.score - a.score)

    const paginatedCandidates = sortedCandidates.slice(0, poolLimit)
    const postIds = paginatedCandidates.map(c => c.postId)

    const posts = await this.postModel
      .find({ _id: { $in: postIds }, isHidden: false })
      .populate('author', 'username avatar fullName')
      .lean()

    const idToPostMap = new Map(posts.map(post => [post._id.toString(), post]))
    const items = paginatedCandidates.map(c => idToPostMap.get(c.postId)).filter(Boolean)

    return items
  }

  private async _getCFCandidates(similarUserIds: string[], myInteractions: string[]) {
    const activityAgg = this.userActivityModel.aggregate([
      {
        $match: {
          userId: { $in: similarUserIds },
          postId: { $nin: myInteractions },
          userActivityType: { $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.POST_CLICK] },
        },
      },
      {
        $group: {
          _id: '$postId',
          score: { $sum: 1 },
        },
      },
    ])

    const replyAgg = this.postModel.aggregate([
      {
        $match: {
          author: { $in: similarUserIds },
          $and: [{ parentId: { $ne: null } }, { parentId: { $nin: myInteractions } }],
        },
      },
      {
        $group: {
          _id: '$parentId',
          score: { $sum: 1 },
        },
      },
    ])

    const [activityCandidates, replyCandidates] = await Promise.all([activityAgg, replyAgg])

    const candidateScores = new Map<string, number>()

    activityCandidates.forEach(item => {
      candidateScores.set(item._id.toString(), (candidateScores.get(item._id.toString()) || 0) + item.score)
    })

    replyCandidates.forEach(item => {
      candidateScores.set(item._id.toString(), (candidateScores.get(item._id.toString()) || 0) + item.score)
    })

    return candidateScores
  }

  private async _getSimilarUsers(userId: string, myInteractions: string[]) {
    const activityAgg = this.userActivityModel.aggregate([
      {
        $match: {
          postId: { $in: myInteractions },
          userId: { $ne: userId },
          userActivityType: { $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.POST_CLICK] },
        },
      },
      {
        $group: {
          _id: '$userId',
          overlapCount: { $sum: 1 },
        },
      },
    ])

    const replyAgg = this.postModel.aggregate([
      {
        $match: {
          parentId: { $in: myInteractions },
          author: { $ne: userId },
        },
      },
      {
        $group: {
          _id: '$author',
          overlapCount: { $sum: 1 },
        },
      },
    ])

    const [activityUsers, replyUsers] = await Promise.all([activityAgg, replyAgg])
    const userScores = new Map<string, number>()

    activityUsers.forEach(user => {
      userScores.set(user._id, (userScores.get(user._id) || 0) + user.overlapCount)
    })

    replyUsers.forEach(user => {
      userScores.set(user._id, (userScores.get(user._id) || 0) + user.overlapCount)
    })

    if (userScores.size === 0) return []

    const similarUsers = Array.from(userScores.entries()).map(([userId, overlapCount]) => {
      const similarity = overlapCount / Math.sqrt(overlapCount * myInteractions.length)
      return { userId: userId, similarity }
    })

    similarUsers.sort((a, b) => b.similarity - a.similarity)

    return similarUsers.slice(0, 20)
  }

  private async _getHighIntentInteraction(userId: string): Promise<string[]> {
    const standardInteractions = await this.userActivityModel.distinct('postId', {
      userId,
      userActivityType: { $in: [UserActivityType.LIKE, UserActivityType.SHARE, UserActivityType.POST_CLICK] },
    })
    const replyInteractions = await this.postModel.distinct('parentId', {
      author: userId,
      parentId: { $ne: null },
    })

    let viewInteractions: string[] = []
    const viewAgg = await this.userActivityModel.aggregate([
      {
        $match: {
          userId,
          userActivityType: UserActivityType.POST_VIEW,
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
        $group: { _id: '$postId' },
      },
    ])
    viewInteractions = viewAgg.map(item => item._id)

    const allPostIds = [
      ...standardInteractions.map(id => id.toString()),
      ...replyInteractions.map(id => id.toString()),
      ...viewInteractions.map(id => id.toString()),
    ]
    const uniquePostIds = [...new Set(allPostIds)]

    return uniquePostIds
  }

  private async _getFallbackPopularPosts(query: QueryRecommendationDto) {
    const { page, limit } = query
    const skip = (page - 1) * limit
    const total = await this.postModel.countDocuments({ isHidden: false, isDeleted: false })
    const popularPosts = await this.postModel
      .find({ isHidden: false, isDeleted: false })
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

  private async _getDiversePostsByAuthor(posts: Post[], limit: number): Promise<Post[]> {
    const authorGroups = new Map<string, Post[]>()
    posts.forEach(post => {
      const authorId = post.author['_id'].toString()
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

  private _calculateTimeDecayScore(post: Post): number {
    const now = new Date()
    const postDate = new Date(post.createdAt)
    const hoursDiff = (now.getTime() - postDate.getTime()) / (1000 * 60 * 60)
    // Giảm 50% "giá trị" sau mỗi 24 giờ
    return Math.exp(-hoursDiff / 24)
  }

  private async _getUserInterestVector(userId: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(configs.userCollectionName, userId)
      if (!result || !Array.isArray(result.vector)) return null
      return result.vector as number[]
    } catch (error) {
      return null
    }
  }

  private async _getPostVector(postId: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(configs.postCollectionName, postId)
      if (!result || !Array.isArray(result.vector)) return null
      return result.vector as number[]
    } catch (error) {
      return null
    }
  }

  private async _getCachedRecommendations(key: string) {
    const cached = await this.redisService.client.get(key)
    if (cached) {
      return JSON.parse(cached)
    }
    return null
  }

  private async _cacheRecommendations(key: string, recommendations: any) {
    await this.redisService.client.setex(key, this.CACHE_TTL, JSON.stringify(recommendations))
  }

  private async _logRecommendations(userId: string, source: string, items: Post[]): Promise<void> {
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
    } catch (error) {
      // Quan trọng: Bắt lỗi ở đây để không làm crash hàm recommendation chính
      this.logger.error(`[Metrics] Lỗi khi ghi log recommendations: ${error.message}`)
    }
  }
}
