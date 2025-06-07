import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { PostViewService } from '@modules/index-service'
import { Request } from 'express'

@Controller()
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@ApiTags('Post View')
export class PostViewController {
  constructor(private readonly postViewService: PostViewService) {}

  @Post('/:postId')
  async viewPost(@Param('postId') postId: string, @Req() req: Request) {
    await this.postViewService.recordPostView(req.user['_id'], postId)
  }
}
