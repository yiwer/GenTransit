import { Module } from '@nestjs/common'
import { UploadModule } from '../uploads/upload.module'
import { CompanyController, CompanyService } from './company'
import { DictController, DictService } from './dict'
import { RegionController, RegionService } from './region'
import { ShelfTypeController, ShelfTypeService } from './shelf-type'

@Module({
  imports: [UploadModule],
  controllers: [DictController, RegionController, CompanyController, ShelfTypeController],
  providers: [DictService, RegionService, CompanyService, ShelfTypeService],
})
export class BaseDataModule {}
