import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module' // Đường dẫn tới AppModule
import { Model } from 'mongoose'
import { getModelToken } from '@nestjs/mongoose'
import { Logger } from '@nestjs/common'
import { User } from '@entities' // Đường dẫn tới entities
import { RecommendationService } from '@modules/recommendation/recommendation.service' // Đường dẫn tới service
import { RecommendationLog } from '@entities' // Import log
import { SEEDER_CONFIG } from './config'

const K = SEEDER_CONFIG.K // Đánh giá Top 10
const SOURCE: string = SEEDER_CONFIG.SOURCE // Đánh giá feed 'hybrid' (getHybridRecommendations)

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const logger = new Logger('PredictScript')

  const userModel = app.get<Model<User>>(getModelToken(User.name))
  const recLogModel = app.get<Model<RecommendationLog>>(getModelToken(RecommendationLog.name))
  const recommendationService = app.get<RecommendationService>(RecommendationService)

  logger.log(`--- [Bước 3] Bắt đầu dự đoán (Predict) Top ${K} cho feed '${SOURCE}' ---`)

  try {
    // Xóa log cũ
    await recLogModel.deleteMany({ source: SOURCE })
    logger.log('Đã xóa log dự đoán cũ.')

    const userIds = await userModel.find({}, '_id').lean()
    const totalUsers = userIds.length

    logger.log(`Tìm thấy ${totalUsers} users. Bắt đầu lặp...`)

    for (let i = 0; i < totalUsers; i++) {
      const userId = userIds[i]._id.toString()

      // Tùy thuộc vào SOURCE, gọi hàm tương ứng
      // Hàm này sẽ tự động gọi _logRecommendations (từ code service của bạn)
      if (SOURCE === 'hybrid') {
        await recommendationService.getHybridRecommendations(userId, { page: 1, limit: K })
      } else if (SOURCE === 'cbf') {
        await recommendationService.getRecommendations_CBF(userId, { page: 1, limit: K })
      } else if (SOURCE === 'cf') {
        await recommendationService.getRecommendations_CF(userId, { page: 1, limit: K })
      }

      if ((i + 1) % 10 === 0) {
        logger.log(`Đã xử lý ${i + 1}/${totalUsers} users...`)
      }
    }

    logger.log('✅ ✅ ✅ Hoàn tất việc dự đoán (Predict)!')
    logger.log(`Dữ liệu đã được lưu vào "RecommendationLog" với source: '${SOURCE}'.`)
    logger.log('Bây giờ, chạy script "evaluate.ts".')
  } catch (error) {
    logger.error('❌ ❌ ❌ Kịch bản thất bại:', error)
  } finally {
    await app.close()
  }
}

bootstrap()
