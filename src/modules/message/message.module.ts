import { Message, MessageSchema } from '@entities/index'
import { forwardRef, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { MessageService } from './message.service'
import { MessageController } from './message.controller'
import { MessageGateway } from './message.gateway'
import { JwtModule } from '@nestjs/jwt'
import { UserModule } from '@modules/user/user.module'

@Module({
  imports: [
    JwtModule,
    MongooseModule.forFeature([
      {
        name: Message.name,
        schema: MessageSchema,
      },
    ]),
    forwardRef(() => UserModule),
  ],
  controllers: [MessageController],
  providers: [MessageService, MessageGateway],
})
export class MessageModule {}
