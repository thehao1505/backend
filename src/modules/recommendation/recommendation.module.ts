import { RecommendationService } from '@modules/index-service'
import { forwardRef, Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
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
import { RecommendationCommonService } from './recommendation-common.service'
import { RecommendationCbfService } from './recommendation-cbf.service'
import { RecommendationCfService } from './recommendation-cf.service'
import { RecommendationHybridService } from './recommendation-hybrid.service'

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
    BullModule.registerQueue({
      name: 'embedding',
    }),
  ],
  providers: [
    RecommendationCommonService,
    RecommendationCbfService,
    RecommendationCfService,
    RecommendationHybridService,
    RecommendationService,
  ],
  exports: [RecommendationService],
  controllers: [RecommendationController],
})
export class RecommendationModule {}
