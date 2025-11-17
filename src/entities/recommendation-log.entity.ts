import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { BaseEntity } from './base.entity' // Import BaseEntity của bạn

@Schema({
  timestamps: true,
  collectionOptions: {
    changeStreamPreAndPostImages: { enabled: true },
  },
  _id: false, // Kế thừa _id: string từ BaseEntity
})
export class RecommendationLog extends BaseEntity {
  @Prop({ ref: 'User', type: String, index: true })
  userId: string

  @Prop({ type: String, index: true })
  source: string // 'hybrid', 'cbf', 'cf'

  @Prop({ type: [String], ref: 'Post' })
  shownPostIds: string[] // Danh sách ID bài post đã hiển thị, THEO THỨ TỰ

  @Prop({ type: String })
  sessionId: string // ID duy nhất cho phiên đề xuất này
}

export const RecommendationLogSchema = SchemaFactory.createForClass(RecommendationLog)
export type RecommendationLogDocument = RecommendationLog & Document
