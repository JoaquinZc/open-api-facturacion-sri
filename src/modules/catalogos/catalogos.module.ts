import { Module } from '@nestjs/common';
import { SriModule } from '../sri/sri.module';
import { CatalogosAdminController } from './catalogos-admin.controller';
import { CatalogosAdminService } from './catalogos-admin.service';

@Module({
  imports: [SriModule],
  controllers: [CatalogosAdminController],
  providers: [CatalogosAdminService],
})
export class CatalogosModule {}
