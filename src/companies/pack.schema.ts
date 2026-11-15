import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { FEATURES } from './company.schema';
import type { Feature } from './company.schema';

export type PackDocument = HydratedDocument<Pack>;

/**
 * An offer the super admin sells: what a company gets (features, pages,
 * number of employees) and for how much. Not tenant-scoped: packs belong to
 * the product, not to a company. Giving a pack to a company copies its
 * contents onto the company (see SubscriptionsService), so changing a pack
 * later doesn't change what existing customers have.
 */
@Schema({ collection: 'packs', timestamps: true })
export class Pack {
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ trim: true }) description?: string;

  // Price of one billing period, in `currency`. Payments are made outside the app.
  @Prop({ required: true, min: 0, default: 0 }) price!: number;
  @Prop({ trim: true, default: 'DA' }) currency!: string;
  // Length of one billing period
  @Prop({ required: true, min: 1, default: 1 }) periodMonths!: number;

  @Prop({ type: [String], enum: FEATURES, default: () => [...FEATURES] })
  features!: Feature[];
  // Pages switched off inside those features (see pages.ts)
  @Prop({ type: [String], default: [] }) disabledPages!: string[];
  // null: no limit
  @Prop({ type: Number, default: null }) maxEmployees!: number | null;

  // Length of the free trial offered with this pack
  @Prop({ min: 0, default: 14 }) trialDays!: number;

  // An archived pack can't be given to a company any more
  @Prop({ default: true }) active!: boolean;
}

export const PackSchema = SchemaFactory.createForClass(Pack);
PackSchema.index({ name: 1 }, { unique: true });
