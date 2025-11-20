import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { BaseEntity } from './base.entity'

@Schema({
  timestamps: true,
  collectionOptions: {
    changeStreamPreAndPostImages: { enabled: true },
  },
  _id: false,
})
export class Post extends BaseEntity {
  @Prop({ type: String })
  content: string

  @Prop({ type: [String] })
  images: string[]

  @Prop({ type: String, ref: 'User' })
  author: string

  @Prop({ type: Boolean, default: false })
  isHidden: boolean

  @Prop({ type: Boolean, default: false })
  isEmbedded: boolean

  @Prop({ type: Date, default: null })
  lastEmbeddedAt: Date

  @Prop({ type: [String], default: [] })
  categories: string[]

  @Prop({ type: String, ref: 'Post' })
  parentId: string

  @Prop({ type: Boolean, default: false })
  isReply: boolean

  @Prop({ type: Number, default: 0 })
  dwellTimeThreshold: number

  @Prop({ type: Number, default: 0 })
  likeCount: number

  @Prop({ type: Number, default: 0 })
  viewCount: number

  @Prop({ type: Number, default: 0 })
  shareCount: number

  @Prop({ type: Number, default: 0 })
  clickCount: number
}
export const PostSchema = SchemaFactory.createForClass(Post)

PostSchema.index({ author: 1, parentId: 1 })
PostSchema.index({ parentId: 1, author: 1 })

export type PostDocument = Post & Document
