import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ExportController } from './export.controller'
import { ExportService } from './export.service'
import { Post, PostSchema, UserActivity, UserActivitySchema, UserFollow, UserFollowSchema, User, UserSchema } from '@entities'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: User.name, schema: UserSchema },
      { name: UserActivity.name, schema: UserActivitySchema },
      { name: UserFollow.name, schema: UserFollowSchema },
    ]),
  ],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
