import { QueryRecommendationDto, QuerySearchDto } from '@dtos/recommendation.dto'
import { RecommendationService } from '@modules/index-service'
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger'
import { Request } from 'express'

@Controller()
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@ApiTags('Recommendation')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get('embed-all-posts')
  async embedPosts() {
    return await this.recommendationService.handleEnqueuePostForEmbedding()
  }

  @Get('embed-post/:postId')
  async embedPost(@Param('postId') postId: string) {
    return this.recommendationService.enqueuePostForEmbedding(postId)
  }

  @Get('hybrid')
  async getFeed(@Req() req: Request, @Query() query: QueryRecommendationDto) {
    return this.recommendationService.getHybridRecommendations(req.user['_id'], query)
  }

  @Get('cbf')
  async getRecSysCbf(@Req() req: Request, @Query() query: QueryRecommendationDto) {
    return this.recommendationService.getRecommendations_CBF(req.user['_id'], query)
  }

  @Get('cf')
  async getRecSysCf(@Req() req: Request, @Query() query: QueryRecommendationDto) {
    return this.recommendationService.getRecommendations_CF(req.user['_id'], query)
  }

  @Get('following')
  async getRecSysFollowing(@Req() req: Request, @Query() query: QueryRecommendationDto) {
    return this.recommendationService.getFollowingRecommendations(req.user['_id'], query)
  }

  @Get('search')
  async semanticSearch(@Req() req: Request, @Query() query: QuerySearchDto) {
    return this.recommendationService.search(req.user['_id'], query)
  }

  @Get(':id/similar-posts')
  async getRecSysSimilarPosts(@Param('id') id: string, @Query() query: QueryRecommendationDto) {
    return this.recommendationService.getSimilarPosts(id, query)
  }
}
