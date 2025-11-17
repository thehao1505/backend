import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { EmbeddingService, QdrantService } from '@modules/index-service'
import { ApiTags } from '@nestjs/swagger'
import { EmbedDto, ImageDto } from '@dtos/qdrant.dto'

@Controller()
@ApiTags('Qdrant')
export class QdrantController {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly qdrantService: QdrantService,
  ) {}

  @Post('embedding')
  async generateEmbedding(@Body() embedDto: EmbedDto) {
    return this.embeddingService.generateEmbedding(embedDto.text)
  }

  @Post('image-analysis')
  async generateImageAnalysis(@Body() imageDto: ImageDto) {
    return this.embeddingService.generateImageAnalysis(imageDto.imageUrl)
  }

  @Get(':collection/collection/:id/vector')
  async getVectorById(@Param('collection') collection: string, @Param('id') id: string) {
    return await this.qdrantService.getVectorById(collection, id)
  }
}
