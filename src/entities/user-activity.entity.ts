import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { BaseEntity } from './base.entity'

export enum UserActivityType {
  LIKE = 'LIKE',
  SHARE = 'SHARE',
  SEARCH = 'SEARCH',
  POST_VIEW = 'POST_VIEW',
  POST_CLICK = 'POST_CLICK',
  UNLIKE = 'UNLIKE',
  REPLY_POST = 'REPLY_POST',
}

@Schema({
  timestamps: true,
  collectionOptions: {
    changeStreamPreAndPostImages: { enabled: true },
  },
})
export class UserActivity extends BaseEntity {
  @Prop({ ref: 'User', type: String, index: true })
  userId: string

  @Prop({ required: true, enum: UserActivityType })
  userActivityType: UserActivityType

  @Prop({ type: Number })
  dwellTime: number

  @Prop({ type: String })
  searchText: string

  @Prop({ ref: 'Post', type: String })
  postId: string

  @Prop({ type: Boolean, default: false })
  isEmbedded: boolean

  @Prop({ type: Date, default: null })
  lastEmbeddedAt: Date
}
export const UserActivitySchema = SchemaFactory.createForClass(UserActivity)

UserActivitySchema.index({ userId: 1, postId: 1, userActivityType: 1 })
UserActivitySchema.index({ postId: 1, userId: 1, userActivityType: 1 })

export type UserActivityDocument = UserActivity & Document
