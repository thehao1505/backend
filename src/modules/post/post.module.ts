import { Module, forwardRef } from '@nestjs/common'
import { PostController } from './post.controller'
import { PostService } from '@modules/index-service'
import { BullModule } from '@nestjs/bullmq'
import { Post, PostSchema } from '@entities'
import { MongooseModule } from '@nestjs/mongoose'
import { RedisModule, UserModule, NotificationModule, RecommendationModule } from '@modules/index'
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Post.name,
        schema: PostSchema,
      },
    ]),
    forwardRef(() => RedisModule),
    forwardRef(() => UserModule),
    forwardRef(() => NotificationModule),
    forwardRef(() => RecommendationModule),
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  controllers: [PostController],
  providers: [PostService],
  exports: [PostService],
})
export class PostModule {}
