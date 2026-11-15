import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, CompanySchema } from './company.schema';
import { CompaniesService } from './companies.service';
import { Pack, PackSchema } from './pack.schema';
import { PacksService } from './packs.service';
import { SubscriptionsService } from './subscriptions.service';

// Controllers that manage companies live in AuthModule, because creating a
// company also creates its first admin user.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Company.name, schema: CompanySchema },
      { name: Pack.name, schema: PackSchema },
    ]),
  ],
  providers: [CompaniesService, PacksService, SubscriptionsService],
  exports: [CompaniesService, PacksService, SubscriptionsService],
})
export class CompaniesModule {}
