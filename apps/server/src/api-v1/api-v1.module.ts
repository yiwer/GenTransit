import { Module } from '@nestjs/common'
import { SignSetModule } from '../sign-sets/sign-set.module'
import { UploadModule } from '../uploads/upload.module'
import { V1CoreController, V1DocsController, V1FileController, V1ReferenceController } from './api-v1.controller'
import { ApiV1Service } from './api-v1.service'

/** 只读 API /api/v1（M4 计划第 3 节）：只认 API Token，只有 GET */
@Module({
  imports: [SignSetModule, UploadModule],
  controllers: [V1CoreController, V1ReferenceController, V1FileController, V1DocsController],
  providers: [ApiV1Service],
})
export class ApiV1Module {}
