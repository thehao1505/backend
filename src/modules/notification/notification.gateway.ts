/* eslint-disable @typescript-eslint/no-unused-vars */
import { NotificationDocument } from '@entities/index'
import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer, WsException } from '@nestjs/websockets'
import { configs } from '@utils/configs'
import { Server, Socket } from 'socket.io'

@WebSocketGateway({
  cors: { origin: '*' },
})
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationGateway.name)
  @WebSocketServer() server: Server

  private users: Map<string, string> = new Map()

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const userId = await this.authenticateSocket(client)

      this.users.set(userId, client.id)
      if (userId) {
        client.join(`user:${userId}`)
      }
    } catch (error) {
      this.logger.error(`❌ Connection rejected: ${error.message}`)
      client.disconnect()
    }
  }

  handleDisconnect(client: Socket) {
    const userId = Array.from(this.users.entries()).find(([_, socketId]) => socketId === client.id)?.[0]
    if (userId) {
      this.users.delete(userId)
    }
  }

  sendToUser(userId: string, notification: NotificationDocument) {
    this.logger.log(`Sending notification to user: ${userId}`)
    this.server.to(`user:${userId}`).emit('new-notification', notification)
  }

  private authenticateSocket(client: Socket): Promise<string> {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1]

      if (!token) {
        throw new WsException('Unauthorized: Token not found')
      }

      const payload = this.jwtService.verify(token, {
        secret: configs.jwtSecret,
      })

      client.data.userId = payload._id
      return payload._id
    } catch (err) {
      this.logger.error(err.message)
      throw new WsException('Unauthorized: Invalid token')
    }
  }
}
