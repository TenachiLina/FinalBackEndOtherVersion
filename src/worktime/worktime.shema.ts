import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorktimeDocument = HydratedDocument<Worktime>;

@Schema({ collection: 'worktime' })
export class Worktime {
  @Prop()
  worktime_id?: number;

  @Prop()
  emp_id?: number;

  @Prop()
@Prop()
shift_id?: string;   // ← change from number to string

  @Prop({ required: true })
  work_date!: Date;

  @Prop({ default: '0' })
  late_minutes?: string;

  @Prop({ default: '0' })
  overtime_minutes?: string;

  @Prop({ default: '0' })
  work_hours?: string;

  @Prop()
  consomation?: number;

  @Prop({ default: 0 })
  penalty?: number;

  @Prop({ default: 0 })
  bonus?: number;

  @Prop({ default: false })
  absent?: boolean;

  @Prop()
  absent_comment?: string;
}

export const WorktimeSchema = SchemaFactory.createForClass(Worktime);