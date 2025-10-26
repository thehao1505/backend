import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { BaseEntity } from './base.entity'

export enum UserActivityType {
  LIKE = 'LIKE',
  SHARE = 'SHARE',
  SEARCH = 'SEARCH',
  POST_VIEW = 'POST_VIEW',
  POST_CLICK = 'POST_CLICK',
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
  dwellTime: Number

  @Prop({ type: String })
  searchText: String

  @Prop({ ref: 'Post', type: String })
  postId: string
}
export const UserActivitySchema = SchemaFactory.createForClass(UserActivity)
export type UserActivityDocument = UserActivity & Document
