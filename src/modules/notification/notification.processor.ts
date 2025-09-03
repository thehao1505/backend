import { Processor, WorkerHost } from '@nestjs/bullmq'
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { NotificationService } from '@modules/index-service'
import { NotificationPayload } from '@dtos/notification.dto'

@Processor('notifications')
@Injectable()
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name)
  constructor(@Inject(forwardRef(() => NotificationService)) private readonly notificationService: NotificationService) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'send-notification':
        await this.handleNotification(job.data)
    }
  }

  private async handleNotification(data: NotificationPayload) {
    this.logger.debug('Processing notification...')

    try {
      const notification = await this.notificationService.createNotification(data)

      this.logger.debug(`Notification ${notification._id} processed successfully`)
    } catch (error) {
      this.logger.error(`Error processing notification: ${error.message}`)
      throw error
    }
  }
}
