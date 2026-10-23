import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type LoginSessionDocument = HydratedDocument<LoginSession>;

export type RevokeReason =
  | 'logout'
  | 'logout_others'
  | 'revoked_by_user'
  | 'revoked_by_admin'
  | 'password_changed'
  | 'password_reset'
  | 'role_changed'
  | 'account_disabled'
  | 'account_deleted'
  | 'refresh_token_reused';

// Ended sessions are kept this long for history, then MongoDB deletes them.
export const SESSION_HISTORY_DAYS = 30;

/**
 * One sign-in: which device and IP it came from, which token it currently
 * uses, when it ends and why it ended.
 *
 * The tokens themselves are never stored. The access token is known by its
 * id (jti); the refresh token only as a SHA-256 hash, so a database leak
 * gives nobody a usable token.
 *
 * Not tenant-scoped by the plugin: refresh and logout run before a company is
 * known, and super admins have none. SessionsService filters by companyId.
 */
@Schema({ collection: 'login_sessions', timestamps: true })
export class LoginSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  })
  companyId!: Types.ObjectId | null;
  // Copied so the list still reads well after a rename or deletion.
  @Prop() userEmail?: string;
  @Prop() userName?: string;
  @Prop() userRole?: string;

  // Where the sign-in came from
  @Prop() ip?: string;
  @Prop() userAgent?: string;
  // e.g. "Chrome on Windows"
  @Prop() device?: string;
  // Where the latest request came from (can change, e.g. phone on 4G)
  @Prop() lastIp?: string;
  @Prop() lastSeenAt?: Date;

  // The access token currently in use: its id and expiry
  @Prop({ required: true }) accessTokenId!: string;
  @Prop({ required: true }) accessTokenExpiresAt!: Date;
  // The one before, still accepted for a few seconds after a rotation so
  // requests already on their way don't fail.
  @Prop() previousAccessTokenId?: string;

  @Prop({ required: true, select: false }) refreshTokenHash!: string;
  @Prop({ select: false }) previousRefreshTokenHash?: string;
  // How many times the tokens were renewed during this session
  @Prop({ default: 0 }) rotationCount!: number;
  @Prop() rotatedAt?: Date;

  // The session ends at the first of: no activity until idleExpiresAt, or
  // expiresAt (fixed at sign-in, never extended).
  @Prop({ required: true }) idleExpiresAt!: Date;
  @Prop({ required: true }) expiresAt!: Date;

  @Prop({ type: Date, default: null }) revokedAt!: Date | null;
  @Prop({ type: String }) revokedReason?: RevokeReason;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  revokedBy!: Types.ObjectId | null;

  // MongoDB deletes the record at this date (TTL index below).
  @Prop({ required: true }) purgeAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const LoginSessionSchema = SchemaFactory.createForClass(LoginSession);
LoginSessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
LoginSessionSchema.index({ companyId: 1, createdAt: -1 });
LoginSessionSchema.index({ userId: 1, revokedAt: 1 });
