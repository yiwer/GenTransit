import { Module } from '@nestjs/common'
import { LandmarkCategoryController, LandmarkController, LandmarkService } from './landmarks'

@Module({
  controllers: [LandmarkCategoryController, LandmarkController],
  providers: [LandmarkService],
  exports: [LandmarkService],
})
export class LandmarksModule {}
