import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Notification, NotificationType, NotificationDocument } from '../../entities/notification.entity'
import { NotificationGateway } from './notification.gateway'
import { NotificationQueryDto } from '@dtos/notification.dto'

@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async createNotification(data: {
    type: NotificationType
    recipientId: string
    senderId: string
    postId?: string
    metadata?: Record<string, any>
  }) {
    const initNotification = await this.notificationModel.create(data)
    const notification = await this.notificationModel
      .findById(initNotification._id)
      .populate('senderId', 'avatar username followers followings')
      .populate('postId', 'content likes')

    this.notificationGateway.sendToUser(data.recipientId, notification)

    return notification
  }

  async markAsRead(notificationId: string) {
    return this.notificationModel.findByIdAndUpdate(notificationId, { isRead: true }, { new: true })
  }

  async getUserNotifications(userId: string, queryDto: NotificationQueryDto) {
    const { page, limit } = queryDto
    const skip = (page - 1) * limit

    const notifications = await this.notificationModel
      .find({ recipientId: userId })
      .populate('senderId', 'avatar username followers followings')
      .populate('postId', 'content likes parentId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec()

    const notificationIds = notifications.map(n => n._id)

    await this.notificationModel.updateMany({ _id: { $in: notificationIds }, isRead: false }, { $set: { isRead: true } })

    return notifications
  }

  async getUnreadCount(userId: string) {
    return this.notificationModel.countDocuments({
      recipientId: userId,
      isRead: false,
    })
  }
}
