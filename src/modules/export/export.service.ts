import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Response } from 'express'
import * as csv from 'fast-csv'
import { Post, PostDocument } from '@entities'
import { User, UserDocument } from '@entities'
import { UserActivity, UserActivityDocument } from '@entities'
import { UserFollow, UserFollowDocument } from '@entities'

const BATCH_SIZE = 500

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name)

  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,

    @InjectModel(UserActivity.name)
    private userActivityModel: Model<UserActivityDocument>,
    @InjectModel(UserFollow.name)
    private userFollowModel: Model<UserFollowDocument>,
  ) {}

  async streamEnrichedActivitiesToCsv(res: Response): Promise<void> {
    this.logger.log('... Bắt đầu stream CSV "User Activities"')
    const headers = ['Username', 'Activity Type', 'Post Content', 'Post ID', 'User ID', 'Timestamp']

    const csvStream = csv.format({ headers, writeHeaders: true })

    csvStream.pipe(res)

    const cursor = this.userActivityModel.find().lean().cursor()
    let batch = []

    return new Promise(async (resolve, reject) => {
      try {
        for await (const activity of cursor) {
          batch.push(activity)
          if (batch.length >= BATCH_SIZE) {
            await this.processActivityBatch(csvStream, batch)
            batch = []
          }
        }
        if (batch.length > 0) {
          await this.processActivityBatch(csvStream, batch)
        }

        csvStream.end()
        resolve()
      } catch (err) {
        this.logger.error('Lỗi khi stream CSV activities:', err)
        csvStream.destroy(err)
        reject(err)
      }

      res.on('close', () => {
        this.logger.warn('Client ngắt kết nối khi đang stream activities.')
        cursor.destroy()
        reject(new Error('Client disconnected'))
      })
    })
  }

  private async processActivityBatch(csvStream: csv.CsvFormatterStream<any, any>, batch: UserActivityDocument[]) {
    const userIds = [...new Set(batch.map(a => a.userId))]
    const postIds = [...new Set(batch.map(a => a.postId).filter(Boolean))]

    const users = await this.userModel.find({ _id: { $in: userIds } }, 'username').lean()
    const posts = await this.postModel.find({ _id: { $in: postIds } }, 'content').lean()

    const userMap = new Map(users.map(u => [u._id.toString(), u.username]))
    const postMap = new Map(posts.map(p => [p._id.toString(), p.content]))

    for (const activity of batch) {
      const postContent = activity.postId ? postMap.get(activity.postId.toString()) : ''
      csvStream.write({
        Username: userMap.get(activity.userId.toString()) || 'N/A',
        'Activity Type': activity.userActivityType,
        'Post Content': postContent ? postContent.substring(0, 100) + '...' : 'N/A',
        'Post ID': activity.postId,
        'User ID': activity.userId,
        Timestamp: activity.createdAt,
      })
    }
  }

  async streamEnrichedFollowsToCsv(res: Response): Promise<void> {
    this.logger.log('... Bắt đầu stream CSV "User Follows"')
    const headers = ['Follower Username', 'Following Username', 'Follower ID', 'Following ID', 'Timestamp']

    const csvStream = csv.format({ headers, writeHeaders: true })

    csvStream.pipe(res)
    const cursor = this.userFollowModel.find().lean().cursor()
    let batch = []

    return new Promise(async (resolve, reject) => {
      try {
        for await (const follow of cursor) {
          batch.push(follow)
          if (batch.length >= BATCH_SIZE) {
            await this.processFollowBatch(csvStream, batch)
            batch = []
          }
        }
        if (batch.length > 0) {
          await this.processFollowBatch(csvStream, batch)
        }
        csvStream.end()
        resolve()
      } catch (err) {
        this.logger.error('Lỗi khi stream CSV follows:', err)
        csvStream.destroy(err)
        reject(err)
      }

      res.on('close', () => {
        this.logger.warn('Client ngắt kết nối khi đang stream follows.')
        cursor.destroy()
        reject(new Error('Client disconnected'))
      })
    })
  }

  private async processFollowBatch(csvStream: csv.CsvFormatterStream<any, any>, batch: UserFollowDocument[]) {
    const userIds = [...new Set([...batch.map(f => f.followerId), ...batch.map(f => f.followingId)])]
    const users = await this.userModel.find({ _id: { $in: userIds } }, 'username').lean()
    const userMap = new Map(users.map(u => [u._id.toString(), u.username]))

    for (const follow of batch) {
      csvStream.write({
        'Follower Username': userMap.get(follow.followerId.toString()) || 'N/A',
        'Following Username': userMap.get(follow.followingId.toString()) || 'N/A',
        'Follower ID': follow.followerId,
        'Following ID': follow.followingId,
        Timestamp: follow.createdAt,
      })
    }
  }

  async streamPostsToCsv(res: Response): Promise<void> {
    const headers = ['ID', 'Author ID', 'Categories', 'Content', 'Likes', 'Shares', 'Views', 'Clicks', 'Dwelltime Threshold', 'Parent ID']
    const csvStream = csv.format({ headers, writeHeaders: true })

    const cursor = this.postModel
      .find(
        {},
        {
          _id: 1,
          author: 1,
          content: 1,
          categories: 1,
          likeCount: 1,
          shareCount: 1,
          viewCount: 1,
          clickCount: 1,
          parentId: 1,
          dwellTimeThreshold: 1,
        },
      )
      .lean()
      .cursor()

    csvStream.pipe(res)

    return new Promise((resolve, reject) => {
      cursor
        .on('data', doc => {
          csvStream.write({
            ID: doc._id,
            'Author ID': doc.author,
            Categories: doc.categories,
            Content: doc.content,
            Likes: doc.likeCount,
            Shares: doc.shareCount,
            Views: doc.viewCount,
            Clicks: doc.clickCount,
            'Dwelltime Threshold': doc.dwellTimeThreshold,
            'Parent ID': doc.parentId,
          })
        })
        .on('end', () => {
          this.logger.log('Post stream finished.')
          csvStream.end()
          resolve()
        })
        .on('error', err => {
          this.logger.error('Error during Post DB stream:', err)
          csvStream.destroy(err)
          reject(err)
        })

      res.on('close', () => {
        this.logger.warn('Client disconnected during stream.')
        cursor.destroy()
        reject(new Error('Client disconnected'))
      })
    })
  }

  async streamUsersToCsv(res: Response): Promise<void> {
    const headers = ['ID', 'Username', 'Email', 'Full Name', 'Persona', 'Followers', 'Followings']
    const csvStream = csv.format({ headers, writeHeaders: true })

    const cursor = this.userModel
      .find({}, { _id: 1, username: 1, email: 1, fullName: 1, persona: 1, followerCount: 1, followingCount: 1 })
      .lean()
      .cursor()

    csvStream.pipe(res)

    return new Promise((resolve, reject) => {
      cursor
        .on('data', doc => {
          csvStream.write({
            ID: doc._id,
            Username: doc.username,
            Email: doc.email,
            'Full Name': doc.fullName,
            Persona: doc.persona,
            Followers: doc.followerCount,
            Followings: doc.followingCount,
          })
        })
        .on('end', () => {
          this.logger.log('User stream finished.')
          csvStream.end()
          resolve()
        })
        .on('error', err => {
          this.logger.error('Error during User DB stream:', err)
          csvStream.destroy(err)
          reject(err)
        })

      res.on('close', () => {
        this.logger.warn('Client disconnected during stream.')
        cursor.destroy()
        reject(new Error('Client disconnected'))
      })
    })
  }
}
