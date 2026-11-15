import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { PacksService } from '../companies/packs.service';
import type { PackInput } from '../companies/packs.service';
import { PAGES } from '../companies/pages';
import { SubscriptionsService } from '../companies/subscriptions.service';
import type {
  PaymentInput,
  SubscriptionInput,
} from '../companies/subscriptions.service';
import { AllowNoCompany, CurrentUser, Roles } from './auth.decorators';
import type { AuthUser } from './auth.decorators';
import { toCompanySummary } from './auth.service';

/** Super admin: the packs (offers) that can be given to companies. */
@Roles('superadmin')
@AllowNoCompany()
@Controller('packs')
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @Get() findAll() {
    return this.packs.findAll();
  }

  /** The pages that can be switched off one by one, with the feature each belongs to. */
  @Get('pages') pages() {
    return PAGES;
  }

  @Post() create(@Body() body: PackInput) {
    return this.packs.create(body ?? {});
  }

  @Patch(':id') update(@Param('id') id: string, @Body() body: PackInput) {
    return this.packs.update(id, body ?? {});
  }

  @Delete(':id') remove(@Param('id') id: string) {
    return this.packs.remove(id);
  }
}

/**
 * Super admin: a company's subscription. Payments are made outside the app
 * and only recorded here.
 */
@Roles('superadmin')
@AllowNoCompany()
@Controller('companies/:id/subscription')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** Gives the company a pack, as a trial or a paid period. */
  @Put()
  async set(@Param('id') id: string, @Body() body: SubscriptionInput) {
    return toCompanySummary(await this.subscriptions.set(id, body ?? {}));
  }

  /** Records a payment and extends the subscription by its months. */
  @Post('payments')
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PaymentInput,
  ) {
    return toCompanySummary(
      await this.subscriptions.addPayment(id, body ?? {}, {
        id: user.id,
        name: user.name,
      }),
    );
  }

  /** Removes the subscription: no end date and no limit any more. */
  @Delete()
  async clear(@Param('id') id: string) {
    return toCompanySummary(await this.subscriptions.clear(id));
  }
}
