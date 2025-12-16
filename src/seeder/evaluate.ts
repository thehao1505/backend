import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { Model } from 'mongoose'
import { getModelToken } from '@nestjs/mongoose'
import { Logger } from '@nestjs/common'
import { Post, RecommendationLog } from '@entities'
import * as fs from 'fs'
import * as csv from 'csv-parser'
import * as path from 'path'
import { SEEDER_CONFIG } from './config'

const DATA_PATH = SEEDER_CONFIG.DATA_PATH || './data_offline_eval'
const TEST_INTERACTIONS_FILE = path.join(DATA_PATH, 'test_interactions.csv')
const SOURCE_TO_EVALUATE = SEEDER_CONFIG.SOURCE || 'hybrid'
const K = SEEDER_CONFIG.K || 10

/**
 * Helper tính P@K, R@K, AP@K, NDCG@K
 */
function calculateUserMetrics(
  recommendations: string[],
  groundTruth: Set<string>,
  K: number,
): { p_at_k: number | null; r_at_k: number | null; ap_at_k: number | null; ndcg_at_k: number | null } {
  if (groundTruth.size === 0) {
    return { p_at_k: null, r_at_k: null, ap_at_k: null, ndcg_at_k: null }
  }

  let hits = 0
  let precisionSum = 0
  let dcg = 0
  const n = Math.min(recommendations.length, K)

  for (let k = 0; k < n; k++) {
    const item = recommendations[k]
    const isRelevant = groundTruth.has(item) ? 1 : 0

    if (isRelevant) {
      hits++
      const precision_at_k_plus_1 = hits / (k + 1)
      precisionSum += precision_at_k_plus_1
    }

    // NDCG: relevance score = 1 if relevant, 0 otherwise
    // DCG = sum(relevance / log2(position + 1))
    dcg += isRelevant / Math.log2(k + 2)
  }

  const totalRelevantItems = groundTruth.size

  const p_at_k = hits / K
  const r_at_k = hits / totalRelevantItems
  const ap_at_k = precisionSum / totalRelevantItems

  // Ideal DCG: giả sử tất cả relevant items ở top
  let idcg = 0
  for (let i = 0; i < Math.min(totalRelevantItems, K); i++) {
    idcg += 1 / Math.log2(i + 2)
  }
  const ndcg_at_k = idcg > 0 ? dcg / idcg : 0

  return { p_at_k, r_at_k, ap_at_k, ndcg_at_k }
}

/**
 * Helper đọc "đáp án" (ground truth)
 */
async function loadGroundTruth(): Promise<Map<string, Set<string>>> {
  const truthMap = new Map<string, Set<string>>()

  if (!fs.existsSync(TEST_INTERACTIONS_FILE)) {
    throw new Error(`File test_interactions.csv không tồn tại tại: ${TEST_INTERACTIONS_FILE}`)
  }

  const stream = fs.createReadStream(TEST_INTERACTIONS_FILE).pipe(csv())

  for await (const row of stream) {
    const userId = row.userId
    const postId = row.postId

    if (!userId || !postId) continue

    if (!truthMap.has(userId)) {
      truthMap.set(userId, new Set<string>())
    }
    truthMap.get(userId)!.add(postId)
  }

  return truthMap
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const logger = new Logger('EvaluateScript')

  const recLogModel = app.get<Model<RecommendationLog>>(getModelToken(RecommendationLog.name))

  logger.log(`=== Bắt đầu đánh giá (Evaluate) @ K=${K} cho feed '${SOURCE_TO_EVALUATE}' ===`)

  try {
    // 1. Đọc "Đáp án" (Ground Truth)
    logger.log('Đang load ground truth từ test_interactions.csv...')
    const groundTruthMap = await loadGroundTruth()
    logger.log(`Đã tải ${groundTruthMap.size} users từ file test (ground truth).`)

    if (groundTruthMap.size === 0) {
      throw new Error('Không có ground truth nào. Hãy chạy generate_offline_eval_data.ts trước.')
    }

    // 2. Đọc "Dự đoán" (Predictions)
    logger.log(`Đang load predictions từ RecommendationLog với source='${SOURCE_TO_EVALUATE}'...`)
    const logs = await recLogModel.find({ source: SOURCE_TO_EVALUATE }).lean()

    if (logs.length === 0) {
      throw new Error(`Không tìm thấy RecommendationLog cho source='${SOURCE_TO_EVALUATE}'. Bạn đã chạy script "predict.ts" chưa?`)
    }
    logger.log(`Đã tải ${logs.length} dự đoán từ RecommendationLog.`)

    // Debug: Kiểm tra một vài recommendations và ground truth
    if (logs.length > 0) {
      const sampleLog = logs.find(l => l.shownPostIds && l.shownPostIds.length > 0) || logs[0]
      const sampleUserId = sampleLog.userId.toString()
      const samplePredictions = (sampleLog.shownPostIds || []).map(id => id.toString())
      const sampleTruth = groundTruthMap.get(sampleUserId) || new Set<string>()

      logger.log(`\n[DEBUG] Sample User: ${sampleUserId}`)
      logger.log(`  Predictions count: ${samplePredictions.length}`)
      logger.log(`  Ground Truth count: ${sampleTruth.size}`)
      if (samplePredictions.length > 0) {
        logger.log(`  Predictions (first 5): ${samplePredictions.slice(0, 5).join(', ')}`)
      }
      if (sampleTruth.size > 0) {
        logger.log(`  Ground Truth (first 5): ${Array.from(sampleTruth).slice(0, 5).join(', ')}`)
      }

      // Kiểm tra format ID
      if (samplePredictions.length > 0 && sampleTruth.size > 0) {
        const firstPred = samplePredictions[0]
        const firstTruth = Array.from(sampleTruth)[0]
        logger.log(`  Sample prediction ID: "${firstPred}" (length: ${firstPred.length})`)
        logger.log(`  Sample truth ID: "${firstTruth}" (length: ${firstTruth.length})`)
        logger.log(`  IDs match format: ${firstPred.length === firstTruth.length}`)
        logger.log(`  Direct match test: ${sampleTruth.has(firstPred)}`)
      }

      // Đếm số logs rỗng
      const emptyLogs = logs.filter(l => !l.shownPostIds || l.shownPostIds.length === 0).length
      logger.log(`  Logs rỗng (không có recommendations): ${emptyLogs}/${logs.length}`)
    }

    const metrics = {
      precisionAtK: [] as number[],
      recallAtK: [] as number[],
      averagePrecisionAtK: [] as number[],
      ndcgAtK: [] as number[],
    }

    // Metrics mới: Coverage, Diversity, Novelty
    const allRecommendedPostIds = new Set<string>()
    const allGroundTruthPostIds = new Set<string>()
    const userCategoryDiversity: number[] = [] // Diversity score cho mỗi user
    const userAuthorDiversity: number[] = [] // Author diversity cho mỗi user

    let usersWithHits = 0
    let usersEvaluated = 0

    // Load post details để tính diversity (cần categories và authors)
    const postModel = app.get<Model<Post>>(getModelToken(Post.name))
    const allPostIds = new Set<string>()
    logs.forEach(log => {
      log.shownPostIds.forEach(id => allPostIds.add(id.toString()))
    })
    groundTruthMap.forEach(truthSet => {
      truthSet.forEach(id => allPostIds.add(id))
    })

    const postsMap = new Map<string, any>()
    if (allPostIds.size > 0) {
      const posts = await postModel
        .find({ _id: { $in: Array.from(allPostIds) } })
        .select('categories author')
        .lean()
      posts.forEach(post => {
        postsMap.set(post._id.toString(), post)
      })
    }

    // 3. So sánh
    const zeroPrecisionUsers: Array<{ userId: string; predictions: string[]; truth: string[]; overlap: number }> = []

    for (const log of logs) {
      const userId = log.userId.toString()
      const predictions = log.shownPostIds.map(id => id.toString())
      const truth = groundTruthMap.get(userId) || new Set<string>()

      // Chỉ đánh giá user có trong bộ test
      if (truth.size === 0) {
        continue
      }

      usersEvaluated++

      // Debug: Track users với zero precision để phân tích
      const overlap = predictions.filter(p => truth.has(p)).length
      if (overlap === 0 && zeroPrecisionUsers.length < 5) {
        zeroPrecisionUsers.push({
          userId,
          predictions: predictions.slice(0, 10),
          truth: Array.from(truth).slice(0, 10),
          overlap: 0,
        })
      }

      // Tính coverage: thêm tất cả recommended posts
      predictions.forEach(postId => allRecommendedPostIds.add(postId))
      truth.forEach(postId => allGroundTruthPostIds.add(postId))

      // Tính diversity cho user này
      const categories = new Set<string>()
      const authors = new Set<string>()
      predictions.forEach(postId => {
        const post = postsMap.get(postId)
        if (post) {
          if (post.categories && Array.isArray(post.categories)) {
            post.categories.forEach((cat: string) => categories.add(cat))
          }
          if (post.author) {
            authors.add(post.author.toString())
          }
        }
      })

      // Diversity = số unique categories / số posts (normalized)
      const categoryDiversity = predictions.length > 0 ? categories.size / Math.min(predictions.length, 10) : 0
      const authorDiversity = predictions.length > 0 ? authors.size / Math.min(predictions.length, 10) : 0
      userCategoryDiversity.push(categoryDiversity)
      userAuthorDiversity.push(authorDiversity)

      const { p_at_k, r_at_k, ap_at_k, ndcg_at_k } = calculateUserMetrics(predictions, truth, K)

      if (p_at_k !== null) {
        metrics.precisionAtK.push(p_at_k)
        metrics.recallAtK.push(r_at_k)
        metrics.averagePrecisionAtK.push(ap_at_k)
        if (ndcg_at_k !== null) {
          metrics.ndcgAtK.push(ndcg_at_k)
        }

        if (p_at_k > 0) {
          usersWithHits++
        }
      }
    }

    // 4. Tính trung bình
    if (usersEvaluated === 0) {
      throw new Error('Không có user nào trong log khớp với ground truth.')
    }

    const mean = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

    const meanPrecision = mean(metrics.precisionAtK)
    const meanRecall = mean(metrics.recallAtK)
    const MAP = mean(metrics.averagePrecisionAtK)
    const meanNDCG = mean(metrics.ndcgAtK)

    // Thống kê thêm
    const avgGroundTruthSize =
      groundTruthMap.size > 0 ? Array.from(groundTruthMap.values()).reduce((sum, set) => sum + set.size, 0) / groundTruthMap.size : 0

    const avgRecommendationsPerUser = logs.length > 0 ? logs.reduce((sum, log) => sum + log.shownPostIds.length, 0) / logs.length : 0

    logger.log('\n--- 📊 KẾT QUẢ ĐÁNH GIÁ 📊 ---')
    logger.log(`Feed được đánh giá:           ${SOURCE_TO_EVALUATE}`)
    logger.log(`K (Top-K):                    ${K}`)
    logger.log(`Số user được đánh giá:      ${usersEvaluated}`)
    logger.log(`Số user có hits:              ${usersWithHits} (${((usersWithHits / usersEvaluated) * 100).toFixed(2)}%)`)
    logger.log(`Avg ground truth size:        ${avgGroundTruthSize.toFixed(2)}`)
    logger.log(`Avg recommendations/user:   ${avgRecommendationsPerUser.toFixed(2)}`)
    logger.log('')
    logger.log(`Mean Precision@${K}:          ${(meanPrecision * 100).toFixed(4)}%`)
    logger.log(`Mean Recall@${K}:             ${(meanRecall * 100).toFixed(4)}%`)
    logger.log(`MAP@${K}:                     ${(MAP * 100).toFixed(4)}%`)
    logger.log(`Mean NDCG@${K}:                ${(meanNDCG * 100).toFixed(4)}%`)

    // Tính Coverage: % posts trong ground truth được recommend ít nhất 1 lần
    const coverage =
      allGroundTruthPostIds.size > 0
        ? (Array.from(allGroundTruthPostIds).filter(id => allRecommendedPostIds.has(id)).length / allGroundTruthPostIds.size) * 100
        : 0

    // Tính Catalog Coverage: % unique posts được recommend
    const totalPostsInCatalog = allPostIds.size
    const catalogCoverage = totalPostsInCatalog > 0 ? (allRecommendedPostIds.size / totalPostsInCatalog) * 100 : 0

    // Tính Diversity: trung bình diversity scores
    const meanCategoryDiversity = mean(userCategoryDiversity)
    const meanAuthorDiversity = mean(userAuthorDiversity)
    const meanDiversity = (meanCategoryDiversity + meanAuthorDiversity) / 2

    logger.log('')
    logger.log('--- 📈 METRICS MỚI 📈 ---')
    logger.log(`Coverage (Ground Truth):      ${coverage.toFixed(4)}%`)
    logger.log(`Catalog Coverage:              ${catalogCoverage.toFixed(4)}%`)
    logger.log(`Mean Category Diversity:       ${(meanCategoryDiversity * 100).toFixed(4)}%`)
    logger.log(`Mean Author Diversity:         ${(meanAuthorDiversity * 100).toFixed(4)}%`)
    logger.log(`Mean Overall Diversity:        ${(meanDiversity * 100).toFixed(4)}%`)

    // Phân tích chi tiết hơn
    const precisionDistribution = {
      zero: metrics.precisionAtK.filter(p => p === 0).length,
      low: metrics.precisionAtK.filter(p => p > 0 && p < 0.1).length,
      medium: metrics.precisionAtK.filter(p => p >= 0.1 && p < 0.3).length,
      high: metrics.precisionAtK.filter(p => p >= 0.3).length,
    }

    logger.log('\n--- Phân bố Precision ---')
    logger.log(`  Zero (0%):     ${precisionDistribution.zero} (${((precisionDistribution.zero / usersEvaluated) * 100).toFixed(2)}%)`)
    logger.log(`  Low (0-10%):    ${precisionDistribution.low} (${((precisionDistribution.low / usersEvaluated) * 100).toFixed(2)}%)`)
    logger.log(
      `  Medium (10-30%): ${precisionDistribution.medium} (${((precisionDistribution.medium / usersEvaluated) * 100).toFixed(2)}%)`,
    )
    logger.log(`  High (>30%):    ${precisionDistribution.high} (${((precisionDistribution.high / usersEvaluated) * 100).toFixed(2)}%)`)

    // Phân tích theo số lượng ground truth
    const usersByGTSize = {
      small: 0, // 1-2 items
      medium: 0, // 3-5 items
      large: 0, // >5 items
    }

    for (const [userId, truthSet] of groundTruthMap.entries()) {
      const log = logs.find(l => l.userId.toString() === userId)
      if (!log) continue

      const size = truthSet.size
      if (size <= 2) usersByGTSize.small++
      else if (size <= 5) usersByGTSize.medium++
      else usersByGTSize.large++
    }

    logger.log('\n--- Phân bố Ground Truth Size ---')
    logger.log(`  Small (1-2):    ${usersByGTSize.small}`)
    logger.log(`  Medium (3-5):   ${usersByGTSize.medium}`)
    logger.log(`  Large (>5):     ${usersByGTSize.large}`)

    // Debug: Hiển thị sample users với zero precision
    if (zeroPrecisionUsers.length > 0) {
      logger.log('\n--- 🔍 DEBUG: Sample Users với Zero Precision ---')
      for (const user of zeroPrecisionUsers.slice(0, 3)) {
        logger.log(`\n  User: ${user.userId}`)
        logger.log(`    Predictions (first 5): ${user.predictions.slice(0, 5).join(', ')}`)
        logger.log(`    Ground Truth (first 5): ${user.truth.slice(0, 5).join(', ')}`)
        logger.log(`    Overlap: ${user.overlap}`)
      }
      logger.log(`\n  💡 Gợi ý: Kiểm tra xem recommendations có match với user preferences không`)
      logger.log(`  💡 Có thể cần: Tăng candidate pool, cải thiện scoring weights, hoặc cải thiện fallback strategy`)
    }

    logger.log('\n--- ✅ Hoàn tất đánh giá ✅ ---')
  } catch (error) {
    logger.error('❌ ❌ ❌ Kịch bản thất bại:', error)
    throw error
  } finally {
    await app.close()
  }
}

bootstrap()
