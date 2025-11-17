import { RecommendationService } from '@modules/index-service'
import { forwardRef, Module } from '@nestjs/common'
import { RecommendationController } from './recommendation.controller'
import {
  User,
  UserSchema,
  Post,
  PostSchema,
  UserActivity,
  UserActivitySchema,
  RecommendationLog,
  RecommendationLogSchema,
  UserFollow,
  UserFollowSchema,
} from '@entities/index'
import { MongooseModule } from '@nestjs/mongoose'
import { PostModule, QdrantModule, RedisModule } from '@modules/index'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: User.name, schema: UserSchema },
      { name: UserFollow.name, schema: UserFollowSchema },
      { name: UserActivity.name, schema: UserActivitySchema },
      { name: RecommendationLog.name, schema: RecommendationLogSchema },
    ]),
    forwardRef(() => QdrantModule),
    forwardRef(() => RedisModule),
    forwardRef(() => PostModule),
  ],
  providers: [RecommendationService],
  exports: [RecommendationService],
  controllers: [RecommendationController],
})
export class RecommendationModule {}
