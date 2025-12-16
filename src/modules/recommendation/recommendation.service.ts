import { QueryRecommendationDto, QuerySearchDto } from '@dtos/recommendation.dto'
import { RecommendationLog, User, UserFollow } from '@entities/index'
import { Post } from '@entities/post.entity'
import { EmbeddingService, PostService, QdrantService, RedisService } from '@modules/index-service'
import { InjectQueue } from '@nestjs/bullmq'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron, CronExpression } from '@nestjs/schedule'
import { configs } from '@utils/configs/config'
import { VectorUtil } from '@utils/utils'
import { Queue } from 'bullmq'
import { Model } from 'mongoose'
import { RecommendationCommonService } from './recommendation-common.service'
import { RecommendationCbfService } from './recommendation-cbf.service'
import { RecommendationCfService } from './recommendation-cf.service'
import { RecommendationHybridService } from './recommendation-hybrid.service'

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name)

  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(UserFollow.name) private readonly userFollowModel: Model<UserFollow>,
    @InjectModel(RecommendationLog.name) private readonly recommendationLogModel: Model<RecommendationLog>,
    @InjectQueue('embedding') private readonly embeddingQueue: Queue,
    private readonly qdrantService: QdrantService,
    private readonly embeddingService: EmbeddingService,
    private readonly redisService: RedisService,
    private readonly postService: PostService,
    private readonly commonService: RecommendationCommonService,
    private readonly cbfService: RecommendationCbfService,
    private readonly cfService: RecommendationCfService,
    private readonly hybridService: RecommendationHybridService,
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

      const postVector = await this.commonService._getPostVector(postId)
      if (!postVector) {
        throw new BadRequestException('Post vector not found')
      }

      const filter = {
        must_not: [{ key: 'postId', match: { value: postId.toString() } }],
      }

      const similar = await this.qdrantService.searchSimilar(configs.postCollectionName, postVector, Number(limit), Number(page), filter)

      const similarPostIds = similar.map(item => item.id).filter(id => id !== postId)
      const total = similarPostIds.length

      const similarPostsRaw = await this.postModel
        .find({ _id: { $in: similarPostIds }, isHidden: false, parentId: null, isReply: false })
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
        parentId: null,
        isReply: false,
      })

      if (totalFollowingPosts === 0) {
        return { items: [], total: 0, page, limit, totalPages: 0 }
      }

      const followingPosts = await this.postModel
        .find({
          author: { $in: followingIds },
          isHidden: false,
          parentId: null,
          isReply: false,
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('author', 'username avatar fullName')
        .lean()

      // Áp dụng đa dạng hóa để 1 user không chiếm hết feed
      const diversePosts = await this.commonService._getDiversePostsByAuthor(followingPosts, limit)

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
    const normalizedEmbedding = VectorUtil.normalize(embedding)

    if (text) {
      await this.postService.searchActivity(text, userId, normalizedEmbedding)
    }
    const similar = await this.qdrantService.searchSimilar(configs.postCollectionName, normalizedEmbedding, Number(limit), Number(page), {})

    const similarPostIds = similar.map(item => item.id)
    const similarPostsRaw = await this.postModel
      .find({ _id: { $in: similarPostIds }, isHidden: false, parentId: null, isReply: false })
      .populate('author', 'username avatar fullName')
      .lean()

    const idToPostMap = new Map(similarPostsRaw.map(post => [post._id.toString(), post]))
    const similarPosts = similarPostIds.map(id => idToPostMap.get(id.toString())).filter(Boolean)

    return similarPosts
  }

  // Delegate to hybrid service
  async getHybridRecommendations(userId: string, query: QueryRecommendationDto) {
    return this.hybridService.getHybridRecommendations(userId, query)
  }

  // Delegate to CBF service
  async getRecommendations_CBF(userId: string, query: QueryRecommendationDto) {
    return this.cbfService.getRecommendations_CBF(userId, query)
  }

  // Delegate to CF service
  async getRecommendations_CF(userId: string, query: QueryRecommendationDto) {
    return this.cfService.getRecommendations_CF(userId, query)
  }
}
