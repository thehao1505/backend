import { Controller, Delete, Get, Param, Req, Post, Query, UseGuards, Patch, Body, UseInterceptors } from '@nestjs/common'
import { UserService } from './user.service'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { QueryDto, QuerySearchDto, UpdateUserDto } from '@dtos/user.dto'
import { Request } from 'express'
import { AuthGuard } from '@nestjs/passport'
import { UserEmbeddingInterceptor } from 'src/interceptors/user-embedding.interceptor'
import { Pagination } from '@dtos/base.dto'

@Controller()
@ApiTags('Users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('sync-follows')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async syncFollows() {
    return this.userService.syncUserFollowData()
  }

  @Get('process-profile-user-embedding/:userId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async embedProfileUser(@Param('userId') userId: string) {
    return this.userService.enqueueUserForEmbedding(userId)
  }

  @Get('process-persona-user-embedding/:userId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async embedPersonaUser(@Param('userId') userId: string) {
    return this.userService.enqueueUserForEmbedding(userId)
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  me(@Req() req: Request) {
    return this.userService.getMe(req.user['_id'])
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async getUsers(@Query() queryDto: QueryDto) {
    return await this.userService.getUsers(queryDto)
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async getUser(@Param('id') id: string) {
    return await this.userService.getUser(id)
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(UserEmbeddingInterceptor)
  async updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return await this.userService.updateUser(id, updateUserDto)
  }

  @Get('username/:username')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async getUserByUsername(@Param('username') username: string) {
    return await this.userService.getUserByUsername(username)
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    return await this.userService.deleteUser(id)
  }

  @Post('follow/:followingId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async followUser(@Req() req: Request, @Param('followingId') followingId: string) {
    return await this.userService.followUser(req.user['_id'], followingId)
  }

  @Post('unfollow/:followingId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async unFollowUser(@Req() req: Request, @Param('followingId') followingId: string) {
    return await this.userService.unfollowUser(req.user['_id'], followingId)
  }

  @Post('remove-follower/:followerId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async removeFollower(@Req() req: Request, @Param('followerId') followerId: string) {
    return await this.userService.removeFollower(req.user['_id'], followerId)
  }

  @Get('connection/user')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async getUserConnection(@Req() req: Request) {
    return await this.userService.getUserConnection(req.user['_id'])
  }

  @Get('search/users')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async searchUsers(@Query() query: QuerySearchDto) {
    return await this.userService.searchUsers(query)
  }

  @Get('sync/qdrant')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async a() {
    return this.userService.handleEnqueueUserForEmbedding()
  }

  @Post(':userId/refresh-persona')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async refreshPersona(@Param('userId') userId: string) {
    return await this.userService.refreshUserLongTermVector(userId)
  }

  @Get('/interactions/list')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async getUserInteractions(@Req() req: Request, @Query() query: Pagination) {
    return await this.userService.userInteraction(req.user['_id'], query)
  }
}
