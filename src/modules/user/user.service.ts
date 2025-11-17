import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { NotificationType, User } from '@entities'
import { QueryDto, QuerySearchDto, UpdateUserDto } from '@dtos/user.dto'
import { NotificationService } from '@modules/notification/notification.service'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { Cron, CronExpression } from '@nestjs/schedule'
import { configs } from '@utils/configs'
import { EmbeddingService, QdrantService } from '@modules/index-service'
import { UserFollow } from '@entities/user-follow.entity'
import { InteractionType } from '@utils/enum'

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name)

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(UserFollow.name) private readonly userFollowModel: Model<UserFollow>,
    @InjectQueue('embedding') private readonly embeddingQueue: Queue,
    @Inject(forwardRef(() => QdrantService)) private readonly qdrantService: QdrantService,
    @Inject(forwardRef(() => EmbeddingService)) private readonly embeddingService: EmbeddingService,
    @Inject(forwardRef(() => NotificationService)) private readonly notificationService: NotificationService,
  ) {}

  // @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleEnqueueUserForEmbedding() {
    if (configs.isSkipCron === 'true') {
      console.log('a')
      return
    }
    const users = await this.userModel
      .find({ isEmbedded: { $ne: true } })
      .limit(100)
      .lean()

    if (users.length) return

    for (const user of users) {
      await this.enqueueUserForEmbedding(user._id.toString())
    }
  }

  async getMe(userId: string) {
    return await this.userModel.findById(userId).select('-password')
  }

  async getUsers(queryDto: QueryDto) {
    return await this.userModel.find().limit(queryDto.limit).skip(queryDto.page).lean()
  }

  async getUser(id: string) {
    const user = await this.userModel.findById(id).select('-password')
    if (!user) {
      throw new NotFoundException('User not found')
    }
    return user
  }

  async getUserByUsername(username: string) {
    const user = await this.userModel.findOne({ username }).select('-password')
    if (!user) {
      throw new NotFoundException('User not found')
    }
    return user
  }

  async updateUser(id: string, updateUserDto: UpdateUserDto) {
    const updatedUser = await this.userModel.findOneAndUpdate({ _id: id }, { $set: updateUserDto }, { new: true, runValidators: true })
    if (!updatedUser) {
      throw new NotFoundException('User not found')
    }
    return updatedUser
  }

  async deleteUser(id: string) {
    return 'This function temporary deprecated'
    // await this.userModel.findByIdAndUpdate(id, { $set: { isDeleted: true } })
    // return 'Deleted user successfully!'
  }

  async followUser(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new ConflictException('Cannot follow yourself')
    }

    const existing = await this.userFollowModel.findOne({ followerId, followingId })
    if (existing) {
      throw new ConflictException('Already following')
    }

    const follow = new this.userFollowModel({ followerId, followingId })

    // Cập nhật tất cả đồng thời để đảm bảo đồng bộ
    // Promise.all thực hiện các tác vụ song song
    await Promise.all([
      follow.save(),
      this.notificationService.createNotification({
        type: NotificationType.FOLLOW,
        recipientId: followingId,
        senderId: followerId,
      }),

      this.userModel.updateOne({ _id: followerId }, { $inc: { followingCount: 1 } }),

      this.userModel.updateOne({ _id: followingId }, { $inc: { followerCount: 1 } }),
    ])

    return follow
  }

  async unfollowUser(followerId: string, followingId: string) {
    const result = await this.userFollowModel.deleteOne({ followerId, followingId })
    if (result.deletedCount === 0) {
      throw new NotFoundException('Follow relationship not found')
    }

    await Promise.all([
      this.userModel.updateOne({ _id: followerId }, { $inc: { followingCount: -1 } }),
      this.userModel.updateOne({ _id: followingId }, { $inc: { followerCount: -1 } }),
    ])

    return { success: true }
  }

  async removeFollower(userId: string, followerId: string) {
    const result = await this.userFollowModel.deleteOne({
      followerId,
      followingId: userId,
    })
    if (result.deletedCount === 0) {
      throw new NotFoundException('Follower relationship not found')
    }

    await Promise.all([
      this.userModel.updateOne({ _id: followerId }, { $inc: { followingCount: -1 } }),
      this.userModel.updateOne({ _id: userId }, { $inc: { followerCount: -1 } }),
    ])

    return { success: true, message: 'Follower removed successfully' }
  }

  async getFollowers(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit
    const followers = await this.userFollowModel
      .find({ followingId: userId })
      .skip(skip)
      .limit(limit)
      .sort({ followedAt: -1 })
      .select('followerId followedAt -_id')
      .lean()

    const total = await this.userFollowModel.countDocuments({ followingId: userId })

    return { total, followers }
  }

  async getFollowings(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit
    const followings = await this.userFollowModel
      .find({ followerId: userId })
      .skip(skip)
      .limit(limit)
      .sort({ followedAt: -1 })
      .select('followingId followedAt -_id')
      .lean()

    const total = await this.userFollowModel.countDocuments({ followerId: userId })

    return { total, followings }
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const exist = await this.userFollowModel.exists({ followerId, followingId })
    return !!exist
  }

  async getUserConnection(userId: string) {
    const followings = await this.userFollowModel.find({ followerId: userId }).select('followingId').lean()

    const followers = await this.userFollowModel.find({ followingId: userId }).select('followerId').lean()

    const followingIds = new Set(followings.map(f => f.followingId))
    const mutualIds = followers.map(f => f.followerId).filter(id => followingIds.has(id))

    if (mutualIds.length === 0) {
      return []
    }

    return this.userModel
      .find({ _id: { $in: mutualIds } })
      .select('avatar username fullName')
      .lean()
  }

  async searchUsers(query: QuerySearchDto) {
    const { page, limit } = query
    const { text } = query

    const embedding = await this.embeddingService.generateEmbedding(text)
    const similar = await this.qdrantService.searchSimilar(configs.userCollectionName, embedding, Number(limit), Number(page), {})

    const similarUserIds = similar.map(item => item.id)
    const similarUsersRaw = await this.userModel
      .find({
        _id: { $in: similarUserIds },
      })
      .select('avatar username fullName')
      .lean()

    const idToUserMap = new Map(similarUsersRaw.map(user => [user._id.toString(), user]))
    const similarUsers = similarUserIds.map(id => idToUserMap.get(id.toString())).filter(Boolean)

    return similarUsers
  }

  async enqueueUserForEmbedding(userId: string) {
    await this.embeddingQueue.add(
      'process-profile-user-embedding',
      { userId },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    )
    this.logger.log(`Enqueued user ${userId} for embedding`)
  }

  async enqueueUserPersonaForEmbedding(userId: string, postId: string, interactionType: InteractionType) {
    await this.embeddingQueue.add(
      'process-persona-user-embedding',
      { userId, postId, interactionType },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    )
    this.logger.log(`Enqueued user ${userId} for embedding`)
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async syncUserFollowData() {
    try {
      const followerPipeline = [
        {
          $group: {
            _id: '$followingId',
            followerCount: { $sum: 1 },
          },
        },
        {
          $merge: {
            into: 'users',
            on: '_id',
            whenMatched: 'merge',
            whenNotMatched: 'discard',
          },
        },
      ]
      await this.userFollowModel.aggregate(followerPipeline as any[]).exec()

      const followingPipeline = [
        {
          $group: {
            _id: '$followerId',
            followingCount: { $sum: 1 },
          },
        },
        {
          $merge: {
            into: 'users',
            on: '_id',
            whenMatched: 'merge',
            whenNotMatched: 'discard',
          },
        },
      ]
      await this.userFollowModel.aggregate(followingPipeline as any[]).exec()

      await this.userModel.updateMany({ followerCount: { $exists: false } }, { $set: { followerCount: 0 } })
      await this.userModel.updateMany({ followingCount: { $exists: false } }, { $set: { followingCount: 0 } })

      return { success: true, message: 'Updated user follow data successfully' }
    } catch (error) {
      throw new Error(`Cant backfill: ${error.message}`)
    }
  }
}
