import { Notification, NotificationSchema } from '@entities'
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { NotificationService } from './notification.service'
import { NotificationProcessor } from './notification.processor'
import { NotificationController } from './notification.controller'
import { NotificationGateway } from './notification.gateway'
import { JwtModule } from '@nestjs/jwt'
@Module({
  imports: [JwtModule, MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }])],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationProcessor, NotificationGateway],
  exports: [NotificationService],
})
export class NotificationModule {}
