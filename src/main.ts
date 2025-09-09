import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { configs } from '@utils/configs'
import { NestExpressApplication } from '@nestjs/platform-express'
import { ValidationPipe } from '@nestjs/common'
import * as basicAuth from 'express-basic-auth'
import * as https from 'https'

async function getPublicIP(): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get('https://api.ipify.org', res => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => resolve(data.trim()))
      })
      .on('error', reject)
  })
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  })
  app.useGlobalPipes(new ValidationPipe())

  const publicIP = await getPublicIP()
  // const publicIP = '123'

  app.use(
    ['/docs'],
    basicAuth({
      challenge: true,
      users: { [configs?.swaggerUser]: configs?.swaggerPassword },
    }),
  )

  const options = new DocumentBuilder().setTitle(`Social App API ${publicIP}`).addBearerAuth().setVersion('1.0').build()
  const document = SwaggerModule.createDocument(app, options)

  SwaggerModule.setup('docs', app, document)

  await app.listen(configs.port)
}
bootstrap()
