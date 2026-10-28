import { Module } from '@nestjs/common'
import { UploadModule } from '../uploads/upload.module'
import { CompanyController, CompanyService } from './company'
import { DictController, DictService } from './dict'
import { RegionController, RegionService } from './region'

@Module({
  imports: [UploadModule],
  controllers: [DictController, RegionController, CompanyController],
  providers: [DictService, RegionService, CompanyService],
})
export class BaseDataModule {}
