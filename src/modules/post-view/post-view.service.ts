import { PostView } from '@entities'
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'

@Injectable()
export class PostViewService {
  constructor(@InjectModel(PostView.name) private readonly postViewModel: Model<PostView>) {}

  async recordPostView(userId: string, postId: string) {
    const recentlyViewed = await this.postViewModel.findOne({
      userId,
      postId,
      viewedAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
    })

    if (!recentlyViewed) {
      await this.postViewModel.create({ userId, postId })
    }
  }
}
