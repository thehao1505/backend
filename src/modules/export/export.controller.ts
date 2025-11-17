// src/export/export.controller.ts
import { Controller, Get, Res, UseGuards } from '@nestjs/common'
import { Response } from 'express' // Import Response từ express
import { ExportService } from './export.service'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '@nestjs/passport'

@Controller()
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@ApiTags('Export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('stream/recsys-evaluation-csv')
  async streamRecsysEvaluationCsv(@Res() res: Response) {
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const fileName = `export_user_activities_${timestamp}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`)

    res.write('\uFEFF')

    try {
      await this.exportService.streamEnrichedActivitiesToCsv(res)
    } catch (error) {
      console.error(`Error streaming evaluation csv: ${error.message}`)
    }
  }

  @Get('stream/recsys-evaluation-follows-csv')
  async streamRecsysEvaluationFollowsCsv(@Res() res: Response) {
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const fileName = `export_user_follows_${timestamp}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`)
    res.write('\uFEFF')

    try {
      await this.exportService.streamEnrichedFollowsToCsv(res)
    } catch (error) {
      console.error(`Error streaming evaluation csv: ${error.message}`)
    }
  }

  @Get('stream/posts')
  async streamPostsCsv(@Res() res: Response) {
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const fileName = `export_posts_${timestamp}.csv`

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`)

    try {
      await this.exportService.streamPostsToCsv(res)
    } catch (error) {
      console.error(`Error streaming posts: ${error.message}`)
    }
  }

  @Get('stream/users')
  async streamUsersCsv(@Res() res: Response) {
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    const fileName = `export_users_${timestamp}.csv`

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`)

    try {
      await this.exportService.streamUsersToCsv(res)
    } catch (error) {
      console.error(`Error streaming users: ${error.message}`)
    }
  }
}
