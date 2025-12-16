import { User, UserActivity, UserActivitySchema, UserSchema } from '@entities'
import { forwardRef, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { NotificationModule, QdrantModule, RedisModule } from '@modules/index'
import { UserFollow, UserFollowSchema } from '@entities/user-follow.entity'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: UserFollow.name,
        schema: UserFollowSchema,
      },
      {
        name: UserActivity.name,
        schema: UserActivitySchema,
      },
    ]),
    forwardRef(() => RedisModule),
    forwardRef(() => QdrantModule),
    forwardRef(() => NotificationModule),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
