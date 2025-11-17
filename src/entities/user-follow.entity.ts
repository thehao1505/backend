import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'
import { BaseEntity } from './base.entity'

@Schema({
  timestamps: true,
  collectionOptions: {
    changeStreamPreAndPostImages: { enabled: true },
  },
  _id: false,
})
export class UserFollow extends BaseEntity {
  @Prop({ type: String, ref: 'User', required: true })
  followerId: string

  @Prop({ type: String, ref: 'User', required: true })
  followingId: string
}

export type UserFollowDocument = UserFollow & Document
export const UserFollowSchema = SchemaFactory.createForClass(UserFollow)
