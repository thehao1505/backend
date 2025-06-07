import { PostView, PostViewSchema } from '@entities'
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { PostViewController } from './post-view.controller'
import { PostViewService } from './post-view.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PostView.name,
        schema: PostViewSchema,
      },
    ]),
  ],
  controllers: [PostViewController],
  providers: [PostViewService],
  exports: [PostViewService],
})
export class PostViewModule {}
