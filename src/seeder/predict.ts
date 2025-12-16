import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { Model } from 'mongoose'
import { getModelToken } from '@nestjs/mongoose'
import { Logger } from '@nestjs/common'
import { User, RecommendationLog } from '@entities'
import { RecommendationService, QdrantService } from '@modules/index-service'
import { configs } from '@utils/configs/config'
import { SEEDER_CONFIG } from './config'
import * as fs from 'fs'
import * as csv from 'csv-parser'
import * as path from 'path'

const K = SEEDER_CONFIG.K || 10
const SOURCE: string = SEEDER_CONFIG.SOURCE || 'hybrid'
const DATA_PATH = SEEDER_CONFIG.DATA_PATH || './data_offline_eval'
const TEST_INTERACTIONS_FILE = path.join(DATA_PATH, 'test_interactions.csv')

/**
 * Load danh sách users cần đánh giá từ test set
 */
async function loadTestUsers(): Promise<Set<string>> {
  const testUsers = new Set<string>()

  if (!fs.existsSync(TEST_INTERACTIONS_FILE)) {
    throw new Error(`File test_interactions.csv không tồn tại tại: ${TEST_INTERACTIONS_FILE}`)
  }

  const stream = fs.createReadStream(TEST_INTERACTIONS_FILE).pipe(csv())
  for await (const row of stream) {
    if (row.userId) {
      testUsers.add(row.userId)
    }
  }

  return testUsers
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const logger = new Logger('PredictScript')

  const userModel = app.get<Model<User>>(getModelToken(User.name))
  const recLogModel = app.get<Model<RecommendationLog>>(getModelToken(RecommendationLog.name))
  const recommendationService = app.get<RecommendationService>(RecommendationService)
  const qdrantService = app.get<QdrantService>(QdrantService)

  logger.log(`=== Bắt đầu dự đoán (Predict) Top ${K} cho feed '${SOURCE}' ===`)

  // Helper function to check if user has vectors
  async function userHasVectors(userId: string): Promise<boolean> {
    try {
      // Check for long-term vector (userId) or short-term vector (userId_shortterm)
      await qdrantService.getVectorById(configs.userCollectionName, userId)
      return true
    } catch (error) {
      // Try short-term vector
      try {
        await qdrantService.getVectorById(configs.userCollectionName, `${userId}_shortterm`)
        return true
      } catch {
        return false
      }
    }
  }

  try {
    // Load danh sách users cần đánh giá (chỉ users có trong test set)
    logger.log('Đang load danh sách users từ test set...')
    const testUsers = await loadTestUsers()
    logger.log(`Tìm thấy ${testUsers.size} users trong test set`)

    if (testUsers.size === 0) {
      throw new Error('Không có user nào trong test set. Hãy chạy generate_offline_eval_data.ts trước.')
    }

    // Xóa log cũ cho source này
    await recLogModel.deleteMany({ source: SOURCE })
    logger.log(`Đã xóa log dự đoán cũ cho source: ${SOURCE}`)

    // Lấy tất cả users từ database
    const allUsers = await userModel.find({ _id: { $in: Array.from(testUsers) } }, '_id').lean()
    logger.log(`Tìm thấy ${allUsers.length} users trong database (trong số ${testUsers.size} users test)`)

    let processed = 0
    let errors = 0
    let emptyRecommendations = 0
    let skippedNoVectors = 0

    // Dự đoán cho từng user
    for (const user of allUsers) {
      const userId = user._id.toString()

      // Check if user has vectors before predicting
      const hasVectors = await userHasVectors(userId)
      if (!hasVectors) {
        skippedNoVectors++
        if (skippedNoVectors <= 5) {
          logger.warn(`[WARN] User ${userId}: Không có vectors trong Qdrant, bỏ qua (cold-start user)`)
        }
        continue
      }

      try {
        // Gọi recommendation service tùy theo SOURCE
        let result
        if (SOURCE === 'hybrid') {
          result = await recommendationService.getHybridRecommendations(userId, { page: 1, limit: K })
        } else if (SOURCE === 'cbf') {
          result = await recommendationService.getRecommendations_CBF(userId, { page: 1, limit: K })
        } else if (SOURCE === 'cf') {
          result = await recommendationService.getRecommendations_CF(userId, { page: 1, limit: K })
        } else {
          throw new Error(`SOURCE không hợp lệ: ${SOURCE}. Chọn: 'hybrid', 'cbf', hoặc 'cf'`)
        }

        // Kiểm tra xem có recommendations không
        if (!result || !result.items || result.items.length === 0) {
          emptyRecommendations++
          if (emptyRecommendations <= 5) {
            logger.warn(`[WARN] User ${userId}: Không có recommendations (total: ${result?.total || 0})`)
          }
        } else {
          // Debug: Log một vài recommendations đầu tiên
          if (processed < 3) {
            const log = await recLogModel.findOne({ userId, source: SOURCE }).lean()
            if (log) {
              logger.log(`[DEBUG] User ${userId}: ${log.shownPostIds.length} recommendations`)
              if (log.shownPostIds.length > 0) {
                logger.log(
                  `[DEBUG] Sample postIds: ${log.shownPostIds
                    .slice(0, 3)
                    .map(id => id.toString())
                    .join(', ')}`,
                )
              }
            }
          }
        }

        processed++
      } catch (error) {
        errors++
        logger.warn(`Lỗi khi dự đoán cho user ${userId}: ${error.message}`)
        // Tiếp tục với user tiếp theo
      }

      if (processed % 50 === 0) {
        logger.log(`Đã xử lý ${processed}/${allUsers.length} users... (Empty: ${emptyRecommendations}, Skipped: ${skippedNoVectors})`)
      }
    }

    // Kiểm tra số lượng logs đã tạo
    const logCount = await recLogModel.countDocuments({ source: SOURCE })
    const logsWithItems = await recLogModel.countDocuments({ source: SOURCE, shownPostIds: { $exists: true, $ne: [] } })
    const logsEmpty = await recLogModel.countDocuments({
      source: SOURCE,
      $or: [{ shownPostIds: { $exists: false } }, { shownPostIds: [] }],
    })

    logger.log(`\n📊 Thống kê:`)
    logger.log(`  - Users đã xử lý: ${processed}`)
    logger.log(`  - Users bỏ qua (không có vectors): ${skippedNoVectors}`)
    logger.log(`  - Lỗi: ${errors}`)
    logger.log(`  - Logs đã tạo: ${logCount}`)
    logger.log(`  - Logs có recommendations: ${logsWithItems}`)
    logger.log(`  - Logs rỗng: ${logsEmpty}`)
    logger.log(`  - Users không có recommendations: ${emptyRecommendations}`)

    if (logCount === 0) {
      logger.warn('⚠️  Không có log nào được tạo. Có thể recommendation service không tạo recommendations.')
    } else if (logsEmpty > 0) {
      logger.warn(`⚠️  Có ${logsEmpty} logs rỗng. Có thể CF không tìm thấy similar users hoặc candidates.`)
    }

    logger.log('\n✅ ✅ ✅ Hoàn tất việc dự đoán (Predict)!')
    logger.log(`Dữ liệu đã được lưu vào "RecommendationLog" với source: '${SOURCE}'.`)

    // Export recommendations ra CSV
    logger.log(`\n=== Exporting Recommendations to CSV ===`)
    logger.log(`Source: ${SOURCE}`)
    logger.log(`Output: ${DATA_PATH}/recommendations_${SOURCE}.csv`)

    try {
      // Tạo thư mục nếu chưa có
      if (!fs.existsSync(DATA_PATH)) {
        fs.mkdirSync(DATA_PATH, { recursive: true })
      }

      // Lấy tất cả recommendations từ database
      const logs = await recLogModel.find({ source: SOURCE }).lean()

      if (logs.length === 0) {
        logger.warn(`⚠️ Không tìm thấy RecommendationLog để export.`)
      } else {
        logger.log(`Tìm thấy ${logs.length} recommendations để export`)

        // Tạo CSV content
        const csvLines = ['userId,postIds,source']

        for (const log of logs) {
          const userId = log.userId.toString()
          const postIds = (log.shownPostIds || []).map(id => id.toString()).join('|')
          const source = log.source || SOURCE

          csvLines.push(`${userId},${postIds},${source}`)
        }

        // Ghi file
        const outputPath = path.join(DATA_PATH, `recommendations_${SOURCE}.csv`)
        fs.writeFileSync(outputPath, csvLines.join('\n'))

        logger.log(`✅ Đã export ${logs.length} recommendations vào ${outputPath}`)
      }
    } catch (exportError) {
      logger.warn(`⚠️ Lỗi khi export CSV: ${exportError.message}`)
      // Không throw error để không làm gián đoạn flow chính
    }

    logger.log('\n✅ Hoàn tất! Bây giờ, chạy script "evaluate.ts" để đánh giá.')
  } catch (error) {
    logger.error('❌ ❌ ❌ Kịch bản thất bại:', error)
    throw error
  } finally {
    await app.close()
  }
}

bootstrap()
