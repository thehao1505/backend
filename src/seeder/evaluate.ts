import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module' // Đường dẫn
import { Model } from 'mongoose'
import { getModelToken } from '@nestjs/mongoose'
import { Logger } from '@nestjs/common'
import { RecommendationLog } from '@entities' // Đường dẫn
import * as fs from 'fs'
import * as csv from 'csv-parser'
import { SEEDER_CONFIG } from './config'

const DATA_PATH = SEEDER_CONFIG.DATA_PATH
const TEST_INTERACTIONS_FILE = `${DATA_PATH}/test_interactions.csv`
const SOURCE_TO_EVALUATE = SEEDER_CONFIG.SOURCE // Đảm bảo khớp với SOURCE trong predict.ts
const K = SEEDER_CONFIG.K // Đánh giá P@10, R@10, MAP@10

/**
 * Helper tính P@K, R@K, AP@K
 */
function calculateUserMetrics(recommendations: string[], groundTruth: Set<string>, K: number) {
  // 1. Kiểm tra Ground Truth (Chỉ kiểm tra 1 lần ở đây)
  if (groundTruth.size === 0) {
    return { p_at_k: null, r_at_k: null, ap_at_k: null }
  }

  let hits = 0
  let precisionSum = 0
  const n = Math.min(recommendations.length, K)

  for (let k = 0; k < n; k++) {
    const item = recommendations[k]
    if (groundTruth.has(item)) {
      hits++
      const precision_at_k_plus_1 = hits / (k + 1)
      precisionSum += precision_at_k_plus_1
    }
  }

  const totalRelevantItems = groundTruth.size

  const p_at_k = hits / K
  const r_at_k = hits / totalRelevantItems
  const ap_at_k = precisionSum / totalRelevantItems

  // 2. [ĐÃ XÓA] Khối "if (totalRelevantItems === 0)" thừa ở đây

  return { p_at_k, r_at_k, ap_at_k }
}

/**
 * Helper đọc "đáp án" (ground truth)
 */
async function loadGroundTruth(): Promise<Map<string, Set<string>>> {
  const truthMap = new Map<string, Set<string>>()
  const stream = fs.createReadStream(TEST_INTERACTIONS_FILE).pipe(csv())

  for await (const row of stream) {
    const userId = row.userId
    const postId = row.postId
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

  logger.log(`--- [Bước 4] Bắt đầu đánh giá (Evaluate) @ K=${K} cho feed '${SOURCE_TO_EVALUATE}' ---`)

  try {
    // 1. Đọc "Đáp án" (Ground Truth)
    const groundTruthMap = await loadGroundTruth()
    logger.log(`Đã tải ${groundTruthMap.size} users từ file test (ground truth).`)

    // 2. Đọc "Dự đoán" (Predictions)
    const logs = await recLogModel.find({ source: SOURCE_TO_EVALUATE }).lean()
    if (logs.length === 0) {
      throw new Error(`Không tìm thấy RecommendationLog cho source='${SOURCE_TO_EVALUATE}'. Bạn đã chạy script "predict.ts" chưa?`)
    }
    logger.log(`Đã tải ${logs.length} dự đoán từ RecommendationLog.`)

    const metrics = {
      precisionAtK: [],
      recallAtK: [],
      averagePrecisionAtK: [],
    }

    // 3. So sánh
    for (const log of logs) {
      const userId = log.userId.toString()
      const predictions = log.shownPostIds.map(id => id.toString())
      const truth = groundTruthMap.get(userId) || new Set<string>()

      // Chỉ đánh giá user có trong bộ test
      if (truth.size === 0) {
        continue
      }

      const { p_at_k, r_at_k, ap_at_k } = calculateUserMetrics(predictions, truth, K)

      if (p_at_k !== null) {
        metrics.precisionAtK.push(p_at_k)
        metrics.recallAtK.push(r_at_k)
        metrics.averagePrecisionAtK.push(ap_at_k)
      }
    }

    // 4. Tính trung bình
    const numUsers = metrics.precisionAtK.length
    if (numUsers === 0) {
      throw new Error('Không có user nào trong log khớp với ground truth.')
    }

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

    const meanPrecision = mean(metrics.precisionAtK)
    const meanRecall = mean(metrics.recallAtK)
    const MAP = mean(metrics.averagePrecisionAtK)

    // Thống kê thêm
    const usersWithHits = metrics.precisionAtK.filter(p => p > 0).length
    const avgGroundTruthSize =
      groundTruthMap.size > 0 ? Array.from(groundTruthMap.values()).reduce((sum, set) => sum + set.size, 0) / groundTruthMap.size : 0

    logger.log('--- 📊 KẾT QUẢ ĐÁNH GIÁ 📊 ---')
    logger.log(`Feed được đánh giá:      ${SOURCE_TO_EVALUATE}`)
    logger.log(`Số user được đánh giá: ${numUsers}`)
    logger.log(`Số user có hits:        ${usersWithHits} (${((usersWithHits / numUsers) * 100).toFixed(2)}%)`)
    logger.log(`Avg ground truth size:  ${avgGroundTruthSize.toFixed(4)}`)
    logger.log(`Mean Precision@${K}:    ${(meanPrecision * 100).toFixed(4)}%`)
    logger.log(`Mean Recall@${K}:       ${(meanRecall * 100).toFixed(4)}%`)
    logger.log(`MAP@${K}:                ${(MAP * 100).toFixed(4)}%`)

    // Phân tích chi tiết hơn
    const precisionDistribution = {
      zero: metrics.precisionAtK.filter(p => p === 0).length,
      low: metrics.precisionAtK.filter(p => p > 0 && p < 0.1).length,
      medium: metrics.precisionAtK.filter(p => p >= 0.1 && p < 0.3).length,
      high: metrics.precisionAtK.filter(p => p >= 0.3).length,
    }
    logger.log(`Precision distribution:`)
    logger.log(`  Zero:    ${precisionDistribution.zero} (${((precisionDistribution.zero / numUsers) * 100).toFixed(4)}%)`)
    logger.log(`  Low:     ${precisionDistribution.low} (${((precisionDistribution.low / numUsers) * 100).toFixed(4)}%)`)
    logger.log(`  Medium:  ${precisionDistribution.medium} (${((precisionDistribution.medium / numUsers) * 100).toFixed(4)}%)`)
    logger.log(`  High:    ${precisionDistribution.high} (${((precisionDistribution.high / numUsers) * 100).toFixed(4)}%)`)

    logger.log('--- Hoàn tất ---')
  } catch (error) {
    logger.error('❌ ❌ ❌ Kịch bản thất bại:', error)
  } finally {
    await app.close()
  }
}

bootstrap()
