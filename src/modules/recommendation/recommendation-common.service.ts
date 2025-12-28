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

  public async _getCachedRecommendations(key: string) {
    try {
      const cached = await this.redisService.client.get(key)
      if (cached) {
        return JSON.parse(cached)
      }
    } catch (error) {
      this.logger.warn(`Error getting cache for key ${key}: ${error.message}`)
    }
    return null
  }

  public async _cacheRecommendations(key: string, recommendations: any) {
    try {
      await this.redisService.client.setex(key, this.CACHE_TTL, JSON.stringify(recommendations))
    } catch (error) {
      this.logger.warn(`Error caching recommendations for key ${key}: ${error.message}`)
    }
  }

  public async _getPostVector(postId: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(configs.postCollectionName, postId)
      if (!result || !Array.isArray(result.vector)) return null
      return result.vector as number[]
    } catch (error) {
      return null
    }
  }

  public async _getPostVectorsBatch(postIds: string[]): Promise<Map<string, number[]>> {
    if (postIds.length === 0) return new Map()
    try {
      const results = await this.qdrantService.getVectorsByIds(configs.postCollectionName, postIds)
      const vectorMap = new Map<string, number[]>()
      for (const result of results) {
        if (result && Array.isArray(result.vector)) {
          vectorMap.set(result.id.toString(), result.vector as number[])
        }
      }
      return vectorMap
    } catch (error) {
      this.logger.warn(`Error batch retrieving post vectors: ${error.message}`)
      return new Map()
    }
  }

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

  public async _getUserInterestVector(userId: string): Promise<number[] | null> {
    const longTermVector = await this._getUserLongTermVector(userId)
    const shortTermVector = await this._getUserShortTermVector(userId)

    if (longTermVector && shortTermVector) {
      return this._combineDualVectors(longTermVector, shortTermVector, userId)
    }

    if (longTermVector) {
      return longTermVector
    }

    if (shortTermVector) {
      return shortTermVector
    }

    try {
      const result = await this.qdrantService.getVectorById(configs.userCollectionName, userId)
      if (!result || !Array.isArray(result.vector)) return null
      return result.vector as number[]
    } catch (error) {
      return null
    }
  }

  public async _combineDualVectors(longTermVector: number[], shortTermVector: number[], userId: string): Promise<number[]> {
    let shortTermInteractionCount = 0
    try {
      const shortTermData = await this.qdrantService.getVectorById(configs.userShortTermCollectionName, userId)
      shortTermInteractionCount = (shortTermData?.payload as any)?.interaction_count || 0
    } catch (error) {}

    let longTermWeight = 0.6
    let shortTermWeight = 0.4

    if (shortTermInteractionCount > 50) {
      longTermWeight = 0.4
      shortTermWeight = 0.6
    } else if (shortTermInteractionCount > 20) {
      longTermWeight = 0.5
      shortTermWeight = 0.5
    }

    const combined = longTermVector.map((val, i) => val * longTermWeight + shortTermVector[i] * shortTermWeight)

    return VectorUtil.normalize(combined)
  }

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

      const isTop10 = diversePosts.length < 10
      const authorLimit = isTop10 ? 3 : 4
      const categoryLimit = isTop10 ? 4 : 6

      if (authorPosts < authorLimit && maxCategoryCount < categoryLimit) {
        diversePosts.push(post)
        authorCount.set(authorId, authorPosts + 1)
        for (const cat of postCategories) {
          categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1)
        }
      }
    }

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

  public _addSourceToPosts(posts: Post[], source: string): (Post & { source: string })[] {
    return posts.map(post => ({
      ...post,
      source,
    })) as (Post & { source: string })[]
  }

  public async _getDiversePostsByAuthor(posts: Post[], limit: number): Promise<Post[]> {
    const authorGroups = new Map<string, Post[]>()
    posts.forEach(post => {
      let authorId: string
      if (typeof post.author === 'string') {
        authorId = post.author
      } else if (post.author && typeof post.author === 'object' && '_id' in post.author) {
        authorId = (post.author as any)._id.toString()
      } else {
        return
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
      for (const authorId of authors) {
        if (diversePosts.length >= limit) break
        const authorPosts = authorGroups.get(authorId)
        if (authorPosts && authorPosts.length > 0) {
          diversePosts.push(authorPosts.shift())
          postCount--
        }
      }
      if (postCount === 0 || postCount === posts.length) break
    }
    return diversePosts
  }

  public _calculateTimeDecayScore(post: Post): number {
    const now = new Date()
    const postDate = new Date(post.createdAt)
    const hoursDiff = (now.getTime() - postDate.getTime()) / (1000 * 60 * 60)
    return Math.exp(-hoursDiff / (21 * 24))
  }

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

  public _getRecencyWeight(daysAgo: number): number {
    if (daysAgo <= 7) return 1.0
    if (daysAgo <= 14) return 0.8
    if (daysAgo <= 21) return 0.6
    if (daysAgo <= 30) return 0.4
    return 0.2
  }

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
      items: this._addSourceToPosts(shuffledPosts, 'popular'),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  public async _getPopularPosts(limit: number): Promise<Post[]> {
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

    return this._addSourceToPosts(popularPosts, 'popular')
  }

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

  public async _logRecommendations(userId: string, source: string, items: Post[]): Promise<void> {
    try {
      if (!items || items.length === 0) {
        return
      }

      const postIds = items.map(post => post._id.toString())

      const log = new this.recommendationLogModel({
        _id: uuidv4(),
        userId: userId,
        source: source,
        shownPostIds: postIds,
        sessionId: uuidv4(),
      })

      await log.save()

      this._exportRecommendationToCsv(userId, source, postIds).catch(err => {
        this.logger.warn(`[CSV Export] Lỗi khi export CSV: ${err.message}`)
      })
    } catch (error) {
      this.logger.error(`[Metrics] Lỗi khi ghi log recommendations: ${error.message}`)
    }
  }

  public async _exportRecommendationToCsv(userId: string, source: string, postIds: string[]): Promise<void> {
    try {
      if (!fs.existsSync(this.CSV_EXPORT_PATH)) {
        fs.mkdirSync(this.CSV_EXPORT_PATH, { recursive: true })
      }

      const csvFileName = `recommendations_${source}.csv`
      const csvFilePath = path.join(this.CSV_EXPORT_PATH, csvFileName)

      const fileExists = fs.existsSync(csvFilePath)
      const fileHandle = fs.openSync(csvFilePath, 'a')

      try {
        if (!fileExists) {
          fs.writeSync(fileHandle, 'userId,postIds,source\n')
        }

        const postIdsStr = postIds.join('|')
        const csvLine = `${userId},${postIdsStr},${source}\n`
        fs.writeSync(fileHandle, csvLine)
      } finally {
        fs.closeSync(fileHandle)
      }
    } catch (error) {
      this.logger.warn(`[CSV Export] Không thể export recommendation ra CSV: ${error.message}`)
    }
  }
}
