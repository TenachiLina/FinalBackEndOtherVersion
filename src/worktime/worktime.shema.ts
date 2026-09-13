import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorktimeDocument = HydratedDocument<Worktime>;

@Schema({ collection: 'worktime' })
export class Worktime {
 @Prop()
shift_id?: string;

@Prop({ default: "0" })
late_minutes?: string;

@Prop({ default: "0" })
overtime_minutes?: string;

@Prop({ default: "0" })
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


/*
@Prop()
shift_id?: number;

@Prop({ default: "00:00" })
clock_in?: string;

@Prop({ default: "00:00" })
clock_out?: string;

@Prop({ default: "0" })
late_minutes?: string;

@Prop({ default: "0" })
overtime_minutes?: string;

@Prop({ default: "0" })
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
absent_comment?: string; */