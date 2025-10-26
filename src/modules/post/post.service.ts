import { Inject, Injectable, forwardRef, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { NotificationType, Post, UserActivity, UserActivityType } from '@entities'
import { NotificationService, RedisService, UserService } from '@modules/index-service'
import { CreatePostDto, UpdatePostDto } from '@dtos/post.dto'
import { QueryDto } from '@dtos/post.dto'
import { configs } from '@utils/configs/config'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { NotificationPayload } from '@dtos/notification.dto'

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

  async createPost(author: string, createPostDto: CreatePostDto) {
    if (createPostDto.parentId) {
      const parentPost = await this.postModel.findById(createPostDto.parentId)
      if (!parentPost) throw new NotFoundException('Parent post not found')

      const post = await this.postModel.create({ ...createPostDto, isReply: true, author: author })

      const payload = {
        type: NotificationType.POST_REPLY,
        recipientId: parentPost.author,
        senderId: author,
        postId: parentPost._id,
      } as NotificationPayload

      await this.notificationQueue.add('send-notification', payload)

      return post.populate('author', 'username avatar')
    } else {
      return (await this.postModel.create({ ...createPostDto, author: author })).populate('author', 'username avatar')
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
  }

  async getPost(userId: string, id: string) {
    const post = await this.postModel.findById(id).populate('author', 'username avatar')
    if (!post) throw new NotFoundException('Post not found')

    if (post.isHidden && post.author.toString() !== userId) {
      throw new BadRequestException('This post is hidden by the author')
    }

    return post
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
    try {
      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      const isLiked = await this.userActivityModel.findOne({ postId, userId, userActivityType: UserActivityType.LIKE, isDeleted: false })

      if (isLiked) {
        throw new BadRequestException('User already liked this post')
      }

      return await this.userActivityModel.updateOne(
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
      )
    } catch (error) {
      throw new BadRequestException('Fail to like this post!')
    }
  }

  async unLikePost(postId: string, userId: string) {
    try {
      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      const isLiked = await this.userActivityModel.exists({ postId, userId, userActivityType: UserActivityType.LIKE })

      if (!isLiked) {
        throw new BadRequestException('User has not liked this post')
      }
      return await this.userActivityModel.updateOne(
        { postId, userId, userActivityType: UserActivityType.LIKE },
        { $set: { isDeleted: true } },
      )
    } catch (error) {
      throw new BadRequestException('Fail to unlike this post')
    }
  }

  async sharePost(postId: string, userId: string) {
    try {
      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      return await this.userActivityModel.create({ postId, userId, userActivityType: UserActivityType.SHARE })
    } catch (error) {
      throw new BadRequestException('Fail to share this post')
    }
  }

  async viewPost(postId: string, userId: string, dwellTime: number) {
    try {
      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      return await this.userActivityModel.create({ postId, userId, userActivityType: UserActivityType.POST_VIEW, dwellTime })
    } catch (error) {
      throw new BadRequestException('Fail to record this activity (view)')
    }
  }

  async clickPost(userId: string, postId: string) {
    try {
      const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
      if (!post || !user) throw new NotFoundException('Post or user not found')

      return await this.userActivityModel.create({ postId, userId, userActivityType: UserActivityType.POST_CLICK })
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
