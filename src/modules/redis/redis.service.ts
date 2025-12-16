import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { configs } from '@utils/configs/config'
import * as Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit {
  private readonly logger = new Logger(RedisService.name)
  private readonly redisClient: Redis.Redis

  constructor() {
    const redisConfig = {
      host: configs.redisHost,
      port: Number(configs.redisPort),
    }

    this.redisClient = new Redis.default(redisConfig)
  }

  async onModuleInit() {
    try {
      await this.redisClient.ping()
      this.logger.log('Connected to Redis')
    } catch (error) {
      this.logger.error('Error connecting to Redis:', error)
    }
  }

  get client(): Redis.Redis {
    return this.redisClient
  }
}
