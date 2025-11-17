import { Inject, Injectable, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { NotificationType, Post, UserActivity, UserActivityType } from '@entities'
import { NotificationService, RedisService, UserService } from '@modules/index-service'
import { CreatePostDto, PostViewDwellTimeDto, UpdatePostDto } from '@dtos/post.dto'
import { QueryDto } from '@dtos/post.dto'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { NotificationPayload } from '@dtos/notification.dto'
import { estimateDwellTimeThreshold } from '@utils/utils'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InteractionType } from '@utils/enum'

@Injectable()
export class PostService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(UserActivity.name) private readonly userActivityModel: Model<UserActivity>,
    @Inject(forwardRef(() => RedisService)) private readonly redisService: RedisService,
    @Inject(forwardRef(() => NotificationService)) private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => UserService)) private readonly userService: UserService,
    @InjectQueue('notifications') private notificationQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async syncPostInteractionData() {
    const pipeline = [
      {
        $match: {
          userActivityType: {
            $in: [UserActivityType.LIKE, UserActivityType.POST_VIEW, UserActivityType.SHARE, UserActivityType.POST_CLICK],
          },
          postId: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$postId',
          likeCount: {
            $sum: {
              $cond: {
                if: {
                  $and: [{ $eq: ['$userActivityType', UserActivityType.LIKE] }, { $eq: ['$isDeleted', false] }],
                },
                then: 1,
                else: 0,
              },
            },
          },
          viewCount: {
            $sum: {
              $cond: [{ $eq: ['$userActivityType', UserActivityType.POST_VIEW] }, 1, 0],
            },
          },
          shareCount: {
            $sum: {
              $cond: [{ $eq: ['$userActivityType', UserActivityType.SHARE] }, 1, 0],
            },
          },
          clickCount: {
            $sum: {
              $cond: [{ $eq: ['$userActivityType', UserActivityType.POST_CLICK] }, 1, 0],
            },
          },
        },
      },
      {
        $merge: {
          into: 'posts',
          on: '_id',
          whenMatched: 'merge',
          whenNotMatched: 'discard',
        },
      },
    ]
    try {
      await this.userActivityModel.aggregate(pipeline as any[]).exec()
      return { success: true, message: 'Updated post interaction data' }
    } catch (error) {
      throw new Error(`Cant sync: ${error.message}`)
    }
  }

  async createPost(author: string, createPostDto: CreatePostDto) {
    const dwellTimeThreshold = estimateDwellTimeThreshold(createPostDto.content, createPostDto.images, 600)

    if (createPostDto.parentId) {
      const parentPost = await this.postModel.findById(createPostDto.parentId)
      if (!parentPost) throw new NotFoundException('Parent post not found')

      const post = await this.postModel.create({ ...createPostDto, isReply: true, author: author, dwellTimeThreshold })

      const payload = {
        type: NotificationType.POST_REPLY,
        recipientId: parentPost.author,
        senderId: author,
        postId: parentPost._id,
      } as NotificationPayload

      await this.notificationQueue.add('send-notification', payload)
      this.userService.enqueueUserPersonaForEmbedding(author, parentPost._id, InteractionType.POST_REPLY)

      return post.populate('author', 'username avatar')
    } else {
      return (await this.postModel.create({ ...createPostDto, author: author, dwellTimeThreshold })).populate('author', 'username avatar')
    }
  }

  async countReplyPost(postId: string) {
    return await this.postModel.countDocuments({ parentId: postId, isReply: true })
  }

  async updatePost(id: string, updatePostDto: UpdatePostDto) {
    return await this.postModel.findByIdAndUpdate(id, updatePostDto, { new: true })
  }

  async getPosts(queryDto: QueryDto) {
    const { author, parentId, page, limit, sort } = queryDto

    let sortObject = {}
    if (sort) {
      sortObject = JSON.parse(sort)
    } else {
      sortObject = { createdAt: -1 }
    }
    const authorFilter = author ? { author: author } : {}
    const replyPostFilter = parentId ? { parentId: parentId, isReply: true } : { isReply: false }
    return await this.postModel
      .find({ isHidden: false, isDeleted: false, ...replyPostFilter, ...authorFilter })
      .populate('author', 'username avatar')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ ...sortObject })
      .lean()
  }

  async getPost(userId: string, id: string) {
    const post = await this.postModel.findById(id).populate('author', 'username avatar').lean()
    if (!post) throw new NotFoundException('Post not found')

    if (post.isHidden && post.author.toString() !== userId) {
      throw new BadRequestException('This post is hidden by the author')
    }

    const isLikedThisPost = await this.userActivityModel.exists({
      postId: post._id,
      userActivityType: UserActivityType.LIKE,
      isDeleted: false,
      userId: userId,
    })

    return { ...post, isLikedThisPost: !!isLikedThisPost }
  }

  async softDeletePost(id: string) {
    return await this.postModel.findByIdAndUpdate(id, { isDeleted: true }, { new: true })
  }

  async hiddenPost(userId: string, id: string) {
    const post = await this.postModel.findById(id)
    if (!post) throw new NotFoundException('Post not found')

    if (post.author.toString() !== userId) {
      throw new BadRequestException('You are not the author of this post')
    }

    return await this.postModel.findByIdAndUpdate(id, { isHidden: true }, { new: true })
  }

  async likePost(postId: string, userId: string) {
    const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
    if (!post || !user) throw new NotFoundException('Post or user not found')

    const isLiked = await this.userActivityModel.findOne({ postId, userId, userActivityType: UserActivityType.LIKE, isDeleted: false })

    if (isLiked) {
      throw new BadRequestException('User already liked this post')
    }

    await Promise.all([
      this.userActivityModel.updateOne(
        {
          postId,
          userId,
          userActivityType: UserActivityType.LIKE,
        },
        {
          $set: {
            isDeleted: false,
          },
        },
        { upsert: true },
      ),
      this.postModel.updateOne({ _id: postId }, { $inc: { likeCount: 1 } }),
    ])
    this.userService.enqueueUserPersonaForEmbedding(userId, postId, InteractionType.LIKE)
    this.notificationService.createNotification({
      type: NotificationType.LIKE,
      recipientId: post.author,
      senderId: user._id,
    })

    return 'Liked this post successfully!'
  }

  async unLikePost(postId: string, userId: string) {
    try {
      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      const activeLike = await this.userActivityModel.findOne({
        postId,
        userId,
        userActivityType: UserActivityType.LIKE,
        isDeleted: false,
      })

      if (!activeLike) {
        throw new BadRequestException('User has not liked this post')
      }

      await Promise.all([
        this.userActivityModel.updateOne({ _id: activeLike._id }, { $set: { isDeleted: true } }),
        this.postModel.updateOne({ _id: postId }, { $inc: { likeCount: -1 } }),
        this.userService.enqueueUserPersonaForEmbedding(userId, postId, InteractionType.UNLIKE),
      ])

      return 'Unliked this post successfully!'
    } catch (error) {
      throw new BadRequestException('Fail to unlike this post')
    }
  }

  async sharePost(postId: string, userId: string) {
    try {
      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      await Promise.all([
        this.userActivityModel.create({
          postId,
          userId,
          userActivityType: UserActivityType.SHARE,
        }),
        this.postModel.updateOne({ _id: postId }, { $inc: { shareCount: 1 } }),
        this.userService.enqueueUserPersonaForEmbedding(userId, postId, InteractionType.SHARE),
      ])

      return 'Share this post successfully!'
    } catch (error) {
      throw new BadRequestException('Fail to share this post')
    }
  }

  async viewPost(postId: string, userId: string, postViewDwellTimeDto: PostViewDwellTimeDto) {
    try {
      const { dwellTime } = postViewDwellTimeDto

      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      await Promise.all([
        this.userActivityModel.create({
          postId,
          userId,
          userActivityType: UserActivityType.POST_VIEW,
          dwellTime,
        }),
        this.postModel.updateOne({ _id: postId }, { $inc: { viewCount: 1 } }),
      ])

      if (dwellTime > post.dwellTimeThreshold) {
        await this.userService.enqueueUserPersonaForEmbedding(userId, postId, InteractionType.POST_VIEW)
      }

      return 'Record view this post successfully!'
    } catch (error) {
      throw new BadRequestException('Fail to record this activity (view)')
    }
  }

  async clickPost(postId: string, userId: string) {
    try {
      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      await Promise.all([
        this.userActivityModel.create({
          postId,
          userId,
          userActivityType: UserActivityType.POST_CLICK,
        }),
        this.postModel.updateOne({ _id: postId }, { $inc: { clickCount: 1 } }),
        this.userService.enqueueUserPersonaForEmbedding(userId, postId, InteractionType.POST_CLICK),
      ])

      return 'Record click this post successfully!'
    } catch (error) {
      throw new BadRequestException('Fail to record this activity (click)')
    }
  }

  async searchActivity(searchText: string, userId: string) {
    try {
      const user = await this.userService.getUser(userId)
      if (!user) throw new NotFoundException('User not found')

      return await this.userActivityModel.create({ userId, userActivityType: UserActivityType.SEARCH, searchText })
    } catch (error) {
      throw new BadRequestException('Fail to record this activity (search)')
    }
  }
}
