import { NotificationType } from '@entities'
import { Pagination } from './base.dto'

export interface NotificationPayload {
  type: NotificationType
  recipientId: string
  senderId: string
  postId: string
}

export class NotificationQueryDto extends Pagination {}
