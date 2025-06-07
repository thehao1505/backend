import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { BaseEntity } from './base.entity'

@Schema({
  timestamps: true,
  collectionOptions: {
    changeStreamPreAndPostImages: { enabled: true },
  },
})
export class PostView extends BaseEntity {
  @Prop({ ref: 'Post', type: String, index: true })
  postId: string

  @Prop({ ref: 'User', type: String, index: true })
  userId: string

  @Prop({ default: Date.now })
  viewedAt: Date
}
export const PostViewSchema = SchemaFactory.createForClass(PostView)
export type PostViewDocument = PostView & Document
