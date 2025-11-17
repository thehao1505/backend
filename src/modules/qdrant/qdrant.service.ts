import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { QdrantClient } from '@qdrant/js-client-rest'
import { configs } from '@utils/configs'

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name)
  private client: QdrantClient

  constructor() {
    this.client = new QdrantClient({ url: configs.qdrantUrl, apiKey: configs.qdrantApiKey })
  }

  async onModuleInit() {
    await this.initializeCollection()
  }

  // async createCollection(collectionName: string) {
  //   try {
  //     this.logger.log(`Đang kiểm tra và tạo collection: ${collectionName}`)

  //     const exists = await this.client.collectionExists(collectionName)
  //     if (exists) {
  //       this.logger.log(`Collection ${collectionName} đã tồn tại. Bỏ qua.`)
  //       return
  //     }

  //     const VECTOR_DIMENSIONS = 768

  //     await this.client.createCollection(collectionName, {
  //       vectors: {
  //         size: VECTOR_DIMENSIONS,
  //         distance: 'Cosine',
  //       },
  //     })
  //     this.logger.log(`Đã tạo collection ${collectionName} thành công.`)
  //   } catch (error) {
  //     this.logger.error(`Không thể tạo collection ${collectionName}: ${error.message}`)
  //     throw error
  //   }
  // }

  async createCollection(collectionName: string) {
    try {
      this.logger.log(`Đang tạo collection: ${collectionName}`)

      // [XÓA BỎ]
      // const exists = await this.client.collectionExists(collectionName)
      // if (exists) {
      //   this.logger.log(`Collection ${collectionName} đã tồn tại. Bỏ qua.`)
      //   return
      // }

      const VECTOR_DIMENSIONS = 768

      await this.client.createCollection(collectionName, {
        vectors: {
          size: VECTOR_DIMENSIONS,
          distance: 'Cosine',
        },
      })
      this.logger.log(`Đã tạo collection ${collectionName} thành công.`)
    } catch (error) {
      // Bắt lỗi nếu collection đã tồn tại
      if (error.message && error.message.includes('AlreadyExists')) {
        this.logger.warn(`Collection ${collectionName} đã tồn tại. Bỏ qua.`)
        return
      }
      this.logger.error(`Không thể tạo collection ${collectionName}: ${error.message}`)
      throw error
    }
  }

  async deleteCollection(collectionName: string) {
    try {
      this.logger.log(`Đang xóa collection: ${collectionName}`)

      const exists = await this.client.collectionExists(collectionName)
      if (!exists) {
        this.logger.log(`Collection ${collectionName} không tồn tại. Bỏ qua.`)
        return
      }

      await this.client.deleteCollection(collectionName)
      this.logger.log(`Đã xóa collection ${collectionName} thành công.`)
    } catch (error) {
      this.logger.error(`Không thể xóa collection ${collectionName}: ${error.message}`)
      throw error
    }
  }

  private async initializeCollection() {
    try {
      const collections = await this.client.getCollections()
      const postCollectionExists = collections.collections.some(collection => collection.name === configs.postCollectionName)
      const userCollectionExists = collections.collections.some(collection => collection.name === configs.userCollectionName)

      if (!postCollectionExists) {
        await this.client.createCollection(configs.postCollectionName, {
          vectors: {
            size: Number(configs.vectorSize),
            distance: 'Cosine',
          },
        })
        this.logger.log(`Collection ${configs.postCollectionName} created`)
      } else {
        this.logger.log(`Collection ${configs.postCollectionName} already exists`)
      }

      if (!userCollectionExists) {
        await this.client.createCollection(configs.userCollectionName, {
          vectors: {
            size: Number(configs.vectorSize),
            distance: 'Cosine',
          },
        })
        this.logger.log(`Collection ${configs.userCollectionName} created`)
      } else {
        this.logger.log(`Collection ${configs.userCollectionName} already exists`)
      }
    } catch (error) {
      this.logger.error(`Failed to initialize Qdrant collection: ${error.message}`)
      throw error
    }
  }

  async upsertVector(collectionName: string, id: string, vector: number[], payload: Record<string, any>) {
    return this.client.upsert(collectionName, {
      points: [
        {
          id,
          vector,
          payload,
        },
      ],
    })
  }

  async searchSimilar(collectionName: string, vector: number[], limit: number, page: number, filter: Record<string, any>) {
    const offset = (page - 1) * limit

    return this.client.search(collectionName, {
      vector,
      limit,
      offset,
      filter,
      with_payload: true,
      with_vector: false,
    })
  }

  async deleteVector(id: string, collectionName: string) {
    return this.client.delete(collectionName, {
      points: [id],
    })
  }

  async getVectorById(collectionName: string, id: string) {
    this.logger.log(`Retrieving vector for id ${id} from ${collectionName}`)
    try {
      const results = await this.client.retrieve(collectionName, {
        ids: [id],
        with_vector: true,
        with_payload: true,
      })

      if (!results || results.length === 0) {
        throw new Error(`Point with id ${id} not found in ${collectionName}`)
      }

      return results[0]
    } catch (error) {
      this.logger.error(`Error retrieving vector ${id} from ${collectionName}: ${error.message}`)
      throw error
    }
  }
}
