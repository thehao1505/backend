import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { BaseEntity } from './base.entity' // Import BaseEntity của bạn

@Schema({
  timestamps: true,
  collectionOptions: {
    changeStreamPreAndPostImages: { enabled: true },
  },
  _id: false,
})
export class RecommendationLog extends BaseEntity {
  @Prop({ ref: 'User', type: String, index: true })
  userId: string

  @Prop({ type: String, index: true })
  source: string

  @Prop({ type: [String], ref: 'Post' })
  shownPostIds: string[]

  @Prop({ type: String })
  sessionId: string
}

export const RecommendationLogSchema = SchemaFactory.createForClass(RecommendationLog)
export type RecommendationLogDocument = RecommendationLog & Document
