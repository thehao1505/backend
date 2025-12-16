import { QueryRecommendationDto } from '@dtos/recommendation.dto'
import { RecommendationLog } from '@entities/index'
import { Post } from '@entities/post.entity'
import { QdrantService, RedisService } from '@modules/index-service'
import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { configs } from '@utils/configs/config'
import { Model } from 'mongoose'
import { RecommendationCommonService } from './recommendation-common.service'
import { RecommendationCbfService } from './recommendation-cbf.service'
import { RecommendationCfService } from './recommendation-cf.service'

@Injectable()
export class RecommendationHybridService {
  private readonly logger = new Logger(RecommendationHybridService.name)
  private readonly HYBRID_POOL_LIMIT = 100

  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(RecommendationLog.name) private readonly recommendationLogModel: Model<RecommendationLog>,
    private readonly commonService: RecommendationCommonService,
    private readonly cbfService: RecommendationCbfService,
    private readonly cfService: RecommendationCfService,
  ) {}

  async getHybridRecommendations(userId: string, query: QueryRecommendationDto) {
    const { page, limit } = query
    const cacheKey = `recommendations:hybrid:${userId}:${page}:${limit}`

    try {
      const cached = await this.commonService._getCachedRecommendations(cacheKey)
      if (cached && !(configs.isSkipCacheRecommendation === 'true')) return cached

      // Get candidates from both CBF and CF
      const cbfPool = await this.cbfService.getCBFCandidates(userId, this.HYBRID_POOL_LIMIT)
      const cfPool = await this.cfService.getCFCandidatesAsPost(userId, this.HYBRID_POOL_LIMIT)
      const popularPool = await this.commonService._getPopularPosts(this.HYBRID_POOL_LIMIT) // Lấy pool lớn hơn để có đủ diversity

      if (cbfPool.length === 0 && cfPool.length === 0 && popularPool.length === 0) {
        this.logger.log(`[Hybrid] Cold-start cho user ${userId}, fallback to popular post`)
        return this.commonService._getFallbackPopularPosts(query)
      }

      // Cải thiện: Dynamic interleaving weights dựa trên quality của từng pool
      // Nếu một pool có nhiều items hơn, có thể có chất lượng tốt hơn
      const cbfWeight = cbfPool.length > 0 ? Math.min(cbfPool.length / 50, 1.0) : 0
      const cfWeight = cfPool.length > 0 ? Math.min(cfPool.length / 50, 1.0) : 0
      const totalWeight = cbfWeight + cfWeight + 0.2 // Popular pool luôn có weight 0.2

      // Normalize weights
      const normalizedCbfWeight = totalWeight > 0 ? cbfWeight / totalWeight : 0.4
      const normalizedCfWeight = totalWeight > 0 ? cfWeight / totalWeight : 0.4
      const normalizedPopularWeight = totalWeight > 0 ? 0.2 / totalWeight : 0.2

      // Interleave với dynamic weights: CBF, CF, Popular theo tỷ lệ
      const mergedList = this._interleaveWithWeights(
        cbfPool,
        cfPool,
        popularPool,
        normalizedCbfWeight,
        normalizedCfWeight,
        normalizedPopularWeight,
      )

      const diverseList = await this.commonService._getDiversePostsByAuthor(mergedList, mergedList.length)

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
        this.commonService._logRecommendations(userId, 'hybrid', items)
      }

      await this.commonService._cacheRecommendations(cacheKey, recommendations)
      return recommendations
    } catch (error) {
      this.logger.error(`[Hybrid] Error when fetch recommendations: ${error.message}`, error.stack)
      return this.commonService._getFallbackPopularPosts(query)
    }
  }

  /**
   * Interleave three lists với dynamic weights
   * Cải thiện: Thay vì round-robin đơn giản, sử dụng weighted interleaving
   */
  private _interleaveWithWeights(listA: Post[], listB: Post[], listC: Post[], weightA: number, weightB: number, weightC: number): Post[] {
    const merged: Post[] = []
    const addedIds = new Set<string>()

    // Tính số items cần lấy từ mỗi list dựa trên weights
    const totalItems = Math.max(listA.length, listB.length, listC.length, 100)
    const countA = Math.floor(totalItems * weightA)
    const countB = Math.floor(totalItems * weightB)
    const countC = Math.floor(totalItems * weightC)

    // Lấy items từ mỗi list theo weights
    const itemsA = listA.slice(0, countA)
    const itemsB = listB.slice(0, countB)
    const itemsC = listC.slice(0, countC)

    // Interleave theo round-robin nhưng ưu tiên list có weight cao hơn
    let i = 0,
      j = 0,
      k = 0
    const maxLength = Math.max(itemsA.length, itemsB.length, itemsC.length)

    while (i < itemsA.length || j < itemsB.length || k < itemsC.length) {
      // Priority: A > B > C nếu weights bằng nhau, nhưng điều chỉnh theo weights
      if (i < itemsA.length && (weightA >= weightB || j >= itemsB.length) && (weightA >= weightC || k >= itemsC.length)) {
        const post = itemsA[i++]
        if (!addedIds.has(post._id.toString())) {
          merged.push(post)
          addedIds.add(post._id.toString())
        }
      }
      if (j < itemsB.length && (weightB >= weightC || k >= itemsC.length)) {
        const post = itemsB[j++]
        if (!addedIds.has(post._id.toString())) {
          merged.push(post)
          addedIds.add(post._id.toString())
        }
      }
      if (k < itemsC.length) {
        const post = itemsC[k++]
        if (!addedIds.has(post._id.toString())) {
          merged.push(post)
          addedIds.add(post._id.toString())
        }
      }
    }

    return merged
  }
}
