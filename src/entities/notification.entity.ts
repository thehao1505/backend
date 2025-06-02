import { Schema, SchemaFactory } from '@nestjs/mongoose'
import { BaseEntity } from './base.entity'
import { Prop } from '@nestjs/mongoose'

export enum NotificationType {
  FOLLOW = 'FOLLOW',
  LIKE = 'LIKE',
  POST_REPLY = 'POST_REPLY',
}

@Schema({
  timestamps: true,
  collectionOptions: {
    changeStreamPreAndPostImages: { enabled: true },
  },
  _id: false,
})
export class Notification extends BaseEntity {
  @Prop({
    required: true,
    enum: NotificationType,
  })
  type: NotificationType

  @Prop({
    required: true,
    ref: 'User',
  })
  recipientId: string

  @Prop({
    required: true,
    ref: 'User',
  })
  senderId: string

  @Prop({
    default: null,
    ref: 'Post',
  })
  postId?: string

  @Prop({
    default: false,
  })
  isRead: boolean

  @Prop({
    type: Object,
  })
  metadata: Record<string, any>
}

export const NotificationSchema = SchemaFactory.createForClass(Notification)
export type NotificationDocument = Notification & Document
