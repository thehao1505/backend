import { Inject, Injectable, forwardRef, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { NotificationType, Post } from '@entities'
import { NotificationService, RedisService, UserService } from '@modules/index-service'
import { CreatePostDto, UpdatePostDto } from '@dtos/post.dto'
import { QueryDto } from '@dtos/post.dto'
import { configs } from '@utils/configs/config'

@Injectable()
export class PostService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @Inject(forwardRef(() => RedisService)) private readonly redisService: RedisService,
    @Inject(forwardRef(() => NotificationService)) private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => UserService)) private readonly userService: UserService,
  ) {}

  async createPost(author: string, createPostDto: CreatePostDto) {
    if (createPostDto.parentId) {
      const parentPost = await this.postModel.findById(createPostDto.parentId)
      if (!parentPost) throw new NotFoundException('Parent post not found')

      return await this.postModel.create({ ...createPostDto, isReply: true, author: author })
    } else {
      return await this.postModel.create({ ...createPostDto, author: author })
    }
  }

  async countReplyPost(postId: string) {
    return await this.postModel.countDocuments({ parentId: postId })
  }

  async updatePost(id: string, updatePostDto: UpdatePostDto) {
    return await this.postModel.findByIdAndUpdate(id, updatePostDto, { new: true })
  }

  async getPosts(queryDto: QueryDto) {
    const { author, page, limit, sort } = queryDto

    let sortObject = {}
    if (sort) {
      sortObject = JSON.parse(sort)
    } else {
      sortObject = { createdAt: -1 }
    }
    const authorFilter = author ? { author: author } : {}
    return await this.postModel
      .find({ isHidden: false, isDeleted: false, ...authorFilter })
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
    const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
    if (!post || !user) throw new NotFoundException('Post or user not found')

    if (post.likes.includes(userId)) {
      throw new BadRequestException('User already liked this post')
    }

    if (post.author.toString() !== userId)
      await this.notificationService.createNotification({
        type: NotificationType.LIKE,
        recipientId: post.author,
        senderId: userId,
        postId,
      })
    post.likes.push(userId)
    return await post.save()
  }

  async unLikePost(postId: string, userId: string) {
    const [post, user] = await Promise.all([this.postModel.findById(postId), this.userService.getUser(userId)])
    if (!post || !user) throw new NotFoundException('Post or user not found')

    if (!post.likes.includes(userId)) {
      throw new BadRequestException('User has not liked this post')
    }
    post.likes = post.likes.filter(id => id !== userId)
    return await post.save()
  }

  // Cache only post has likes
  async syncPostLikesToRedis(postId: string) {
    const post = await this.postModel.findById(postId)
    if (!post) throw new NotFoundException('Post not found')

    const redisKey = `post:${postId}:likes`

    try {
      await this.redisService.client.del(redisKey)

      if (post.likes && post.likes.length > 0) {
        await this.redisService.client.sadd(redisKey, ...post.likes)
      }

      const ttl = configs.redisLikesTtl || 60 * 60 * 24 * 30
      await this.redisService.client.expire(redisKey, ttl)

      return { synchronized: true, count: post.likes.length }
    } catch (error) {
      console.error(`Failed to sync likes for post ${postId}:`, error)
      throw new InternalServerErrorException('Failed to sync likes for post')
    }
  }

  // async likePost(postId: string, userId: string) {
  //   // Check if user exists
  //   const user = await this.userService.getUser(userId)
  //   if (!user) throw new NotFoundException('User not found')

  //   // Use Redis to check if user already liked this post
  //   const redisKey = `post:${postId}:likes`
  //   const alreadyLiked = await this.redisClient.sismember(redisKey, userId)

  //   if (alreadyLiked) {
  //     throw new BadRequestException('User already liked this post')
  //   }

  //   // Add user to post likes in Redis
  //   await this.redisClient.sadd(redisKey, userId)

  //   // Update MongoDB in background
  //   this.postModel.findByIdAndUpdate(postId, { $addToSet: { likes: userId } }, { new: true }).catch(err => {
  //     console.error('Error updating post likes in MongoDB:', err)
  //     // Consider implementing a retry mechanism or queue
  //   })

  //   // Return success with Redis count (faster than waiting for MongoDB)
  //   const likesCount = await this.redisClient.scard(redisKey)
  //   return { liked: true, count: likesCount }
  // }
}
