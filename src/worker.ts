import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { Logger } from '@nestjs/common'

async function bootstrap() {
  const logger = new Logger('Worker')

  logger.log('🚀 Starting BullMQ Worker...')

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  })

  // Workers sẽ tự động start khi processors được registered
  // Log khi worker sẵn sàng
  logger.log('✅ Worker is ready and listening for jobs...')
  logger.log('📋 Registered queues: embedding, notifications')
  logger.log('👂 Waiting for jobs to process...')

  // Giữ process chạy
  process.on('SIGTERM', async () => {
    logger.log('SIGTERM received, shutting down worker...')
    await app.close()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    logger.log('SIGINT received, shutting down worker...')
    await app.close()
    process.exit(0)
  })
}

bootstrap().catch(error => {
  console.error('Failed to start worker:', error)
  process.exit(1)
})
