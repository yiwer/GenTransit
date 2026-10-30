import { Module } from '@nestjs/common'
import { SignSetModule } from '../sign-sets/sign-set.module'
import { DataCheckController } from './data-check.controller'
import { DataCheckService } from './data-check.service'

/** 数据体检（M5）：线路列表的 check 筛选也用它，所以线路模块导入本模块 */
@Module({
  imports: [SignSetModule],
  controllers: [DataCheckController],
  providers: [DataCheckService],
  exports: [DataCheckService],
})
export class DataCheckModule {}
