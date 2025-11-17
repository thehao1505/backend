import {
  AuthModule,
  UserModule,
  PostModule,
  UploadModule,
  MessageModule,
  NotificationModule,
  RecommendationModule,
  QdrantModule,
  ExportModule,
} from '@modules'
import { Routes } from '@nestjs/core'

export const routes: Routes = [
  {
    path: 'api/v1',
    children: [
      { path: '/auth', module: AuthModule },
      { path: '/users', module: UserModule },
      { path: '/posts', module: PostModule },
      { path: '/upload', module: UploadModule },
      { path: '/message', module: MessageModule },
      { path: '/notifications', module: NotificationModule },
      { path: '/recommendations', module: RecommendationModule },
      { path: '/qdrant', module: QdrantModule },
      { path: '/export', module: ExportModule },
    ],
  },
]
