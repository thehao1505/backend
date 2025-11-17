import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Post, User, UserActivity, UserActivityType } from '@entities/index'
import { QdrantService } from '@modules/index-service'
import { EmbeddingService } from './embedding.service'
import { configs } from '@utils/configs/config'

const INTERACTION_WEIGHTS: { [key: string]: number } = {
  LIKE: 0.15,
  SHARE: 0.35,
  UNLIKE: -0.15,
  SEARCH: 0.2,
  POST_VIEW: 0.15,
  POST_CLICK: 0.25,
  REPLY_POST: 0.4,
  DEFAULT: 0.1,
}
@Processor('embedding')
@Injectable()
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name)

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly qdrantService: QdrantService,
    @InjectModel(Post.name) private postModel: Model<Post>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(UserActivity.name) private userActivityModel: Model<UserActivity>,
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === 'process-post-embedding') {
      const { postId } = job.data
      this.logger.log(`Processing embedding for post: ${postId}`)

      try {
        const post = await this.postModel.findById(postId)
        if (!post) {
          throw new Error(`Post not found: ${postId}`)
        }

        await this.embedPost(post)

        await this.postModel.findByIdAndUpdate(postId, {
          $set: {
            isEmbedded: true,
            lastEmbeddedAt: new Date(),
          },
        })

        this.logger.log(`Successfully processed embedding for post: ${postId}`)
        return { success: true, postId }
      } catch (error) {
        this.logger.error(`Error processing embedding for post ${postId}: ${error.message}`)
        throw error
      }
    }

    if (job.name === 'process-profile-user-embedding') {
      const { userId } = job.data
      this.logger.log(`Processing embedding for user: ${userId}`)

      try {
        const user = await this.userModel.findById(userId)
        if (!user) {
          throw new Error(`User not found: ${userId}`)
        }

        await this.embedUser(user)

        await this.userModel.findByIdAndUpdate(
          user._id,
          {
            $set: {
              isEmbedded: true,
              lastEmbeddedAt: new Date(),
            },
          },
          { new: true },
        )

        this.logger.log(`Successfully processed embedding for user: ${userId}`)
        return { success: true, userId }
      } catch (error) {
        this.logger.error(`Error processing embedding for user ${userId}: ${error.message}`)
        throw error
      }
    }

    if (job.name === 'process-persona-user-embedding') {
      const { userId, postId, interactionType } = job.data
      this.logger.log(`Processing embedding persona for user: ${userId}`)

      await this.updateUserEmbeddingFromInteraction(userId, postId, interactionType)
      return { success: true, userId, postId }
    }
  }

  private async updateUserEmbeddingFromInteraction(userId: string, postId: string, interactionType: string) {
    this.logger.log(`Updating dynamic embedding for user ${userId} from post ${postId} (Action: ${interactionType})`)

    const newSignalWeight = INTERACTION_WEIGHTS[interactionType] || INTERACTION_WEIGHTS['default']

    const postVector = await this.getVector(configs.postCollectionName, postId)
    if (!postVector) {
      throw new Error(`Không tìm thấy vector cho post ${postId} để cập nhật user ${userId}`)
    }

    const currentUserVector = await this.getVector(configs.userCollectionName, userId)
    const newUserVector = this.calculateNewUserVector(currentUserVector, postVector, newSignalWeight)

    const contentToEmbed = `Được cập nhật động từ ${interactionType} post ${postId} (weight: ${newSignalWeight})`
    await this.upsertUserVector(userId, newUserVector, contentToEmbed)

    await this.userActivityModel.findOneAndUpdate(
      { userId, postId, userActivityType: UserActivityType[interactionType] },
      { $set: { isEmbedded: true, lastEmbeddedAt: new Date() } },
    )
  }

  private calculateNewUserVector(oldVector: number[] | null, newSignalVector: number[], newSignalWeight: number): number[] {
    if (!oldVector) return newSignalVector

    if (oldVector.length !== newSignalVector.length) {
      this.logger.warn('Vector size does not match, overiding it!')
      return newSignalVector
    }

    if (newSignalWeight < 0) {
      const weight = Math.abs(newSignalWeight)
      return oldVector.map((oldVal, i) => oldVal - (newSignalVector[i] - oldVal) * weight)
    }

    const oldVectorWeight = 1.0 - newSignalWeight
    return oldVector.map((oldVal, i) => oldVal * oldVectorWeight + newSignalVector[i] * newSignalWeight)
  }

  private async getVector(collectionName: string, id: string): Promise<number[] | null> {
    try {
      const result = await this.qdrantService.getVectorById(collectionName, id)
      if (!result || !Array.isArray(result.vector)) {
        this.logger.warn(`Vector of ${id} is invalid in ${collectionName}`)
        return null
      }
      return result.vector as number[]
    } catch (error) {
      this.logger.warn(`Vector not found for ${id} in ${collectionName}: ${error.message}`)
      return null
    }
  }

  private async upsertUserVector(userId: string, vector: number[], content: string) {
    await this.qdrantService.upsertVector(configs.userCollectionName, userId, vector, {
      userId: userId,
      content: content,
    })
    this.logger.log(`Upserted new vector for user: ${userId}`)
  }

  private async embedUser(user: User) {
    try {
      const contentToEmbed = `${user.firstName || ''} ${user.lastName || ''} ${user.username} ${user.shortDescription || ''}`

      const embedding = await this.embeddingService.generateEmbedding(contentToEmbed)

      await this.qdrantService.upsertVector(configs.userCollectionName, user._id, embedding, {
        userId: user._id,
        content: contentToEmbed,
      })
    } catch (error) {
      this.logger.error(`Error embedding user ${user._id}: ${error.message}`)
      throw error
    }
  }

  private async embedPost(post: Post) {
    try {
      const imagesDescription = await Promise.all(post.images.map(image => this.embeddingService.generateImageAnalysis(image)))

      const contentToEmbed = `${post.content} ${imagesDescription.join(' ')}`

      const embedding = await this.embeddingService.generateEmbedding(contentToEmbed)

      await this.qdrantService.upsertVector(configs.postCollectionName, post._id, embedding, {
        postId: post._id,
        content: contentToEmbed,
        author: post.author,
        createdAt: post.createdAt,
      })

      this.logger.log(`Embedded content for post: ${post._id}`)
    } catch (error) {
      this.logger.error(`Error embedding post ${post._id}: ${error.message}`)
      throw error
    }
  }
}
