import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import {
  LoginSession,
  LoginSessionDocument,
  RevokeReason,
  SESSION_HISTORY_DAYS,
} from './login-session.schema';
import type { UserDocument } from './user.schema';
import { describeDevice } from './device';
import {
  AUTH_CODES,
  ROTATION_GRACE_MS,
  securityConfig,
  TOUCH_EVERY_MS,
} from './security.config';

/** What a token is signed with. The role is NOT in it: it is read from the database. */
export interface JwtPayload {
  sub: string; // user id
  sid: string; // login session id
  jti?: string; // token id, set by the signer
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  // Seconds until the access token expires
  expiresIn: number;
  sessionId: string;
}

export interface SessionQuery {
  status?: 'active' | 'ended' | 'all';
  userId?: string;
  page?: string;
  limit?: string;
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function sameHash(a: string | undefined, b: string) {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const ended = (message: string) =>
  new UnauthorizedException({ message, code: AUTH_CODES.sessionEnded });

const objectId = (id: string) => {
  if (!Types.ObjectId.isValid(id))
    throw new NotFoundException('Session not found');
  return new Types.ObjectId(id);
};

/**
 * Login sessions and their tokens.
 *
 * - Sign-in creates a session and gives the browser two tokens: a short-lived
 *   access token (sent on every request) and a refresh token (used only to
 *   get new tokens).
 * - Every refresh replaces BOTH tokens ("rotation"). Each refresh token works
 *   once: if an old one is presented again, someone copied it, and the whole
 *   session is ended.
 * - Every request checks that the access token is the one the session
 *   currently expects, so ending a session takes effect immediately.
 */
@Injectable()
export class SessionsService {
  private readonly config = securityConfig();

  constructor(
    @InjectModel(LoginSession.name)
    private readonly sessionModel: Model<LoginSessionDocument>,
    private readonly jwtService: JwtService,
  ) {}

  async create(user: UserDocument, client: ClientInfo): Promise<IssuedTokens> {
    const now = Date.now();
    const expiresAt = new Date(now + this.config.maxAgeMs);
    const sessionId = new Types.ObjectId();
    const refreshToken = this.newRefreshToken(String(sessionId));
    const access = await this.signAccess(
      String(user._id),
      String(sessionId),
      expiresAt,
    );

    await this.sessionModel.create({
      _id: sessionId,
      userId: user._id,
      companyId: user.companyId ?? null,
      userEmail: user.email,
      userName: user.name,
      userRole: user.role,
      ip: client.ip,
      lastIp: client.ip,
      userAgent: client.userAgent?.slice(0, 300),
      device: describeDevice(client.userAgent),
      lastSeenAt: new Date(now),
      accessTokenId: access.jti,
      accessTokenExpiresAt: access.expiresAt,
      refreshTokenHash: sha256(refreshToken),
      idleExpiresAt: this.idleUntil(now, expiresAt),
      expiresAt,
      purgeAt: this.purgeDate(expiresAt),
    });
    return {
      accessToken: access.token,
      refreshToken,
      expiresIn: access.expiresIn,
      sessionId: String(sessionId),
    };
  }

  /**
   * Swaps a refresh token for a new pair of tokens.
   * `checkUser` re-checks the account (still active, company not suspended).
   */
  async refresh(
    refreshToken: unknown,
    client: ClientInfo,
    checkUser: (userId: string) => Promise<void>,
  ): Promise<IssuedTokens> {
    if (typeof refreshToken !== 'string' || !refreshToken.includes('.')) {
      throw ended('Session expired, please log in again');
    }
    const sessionId = refreshToken.split('.')[0];
    if (!Types.ObjectId.isValid(sessionId)) {
      throw ended('Session expired, please log in again');
    }
    const hash = sha256(refreshToken);
    const session = await this.sessionModel
      .findById(sessionId)
      .select('+refreshTokenHash +previousRefreshTokenHash')
      .exec();
    if (!session) throw ended('Session expired, please log in again');

    const now = Date.now();
    const usedBefore = sameHash(session.previousRefreshTokenHash, hash);
    if (!sameHash(session.refreshTokenHash, hash) && !usedBefore) {
      throw ended('Session expired, please log in again');
    }
    this.assertActive(session, now);

    if (usedBefore) {
      // Another tab refreshed with this same token a moment ago: fine.
      if (
        session.rotatedAt &&
        now - session.rotatedAt.getTime() < ROTATION_GRACE_MS
      ) {
        throw new ConflictException({
          message: 'Session already renewed',
          code: AUTH_CODES.refreshRace,
        });
      }
      // An old refresh token came back: it was copied. End the session for
      // both the thief and the real user.
      await this.revoke(session._id, 'refresh_token_reused');
      throw ended(
        'This session was ended for security reasons. Please log in again.',
      );
    }

    await checkUser(String(session.userId));

    const newRefresh = this.newRefreshToken(sessionId);
    const access = await this.signAccess(
      String(session.userId),
      sessionId,
      session.expiresAt,
    );
    // Only succeeds if nobody rotated in between (two refreshes at once).
    const updated = await this.sessionModel
      .findOneAndUpdate(
        { _id: session._id, refreshTokenHash: hash, revokedAt: null },
        {
          $set: {
            refreshTokenHash: sha256(newRefresh),
            previousRefreshTokenHash: hash,
            previousAccessTokenId: session.accessTokenId,
            accessTokenId: access.jti,
            accessTokenExpiresAt: access.expiresAt,
            rotatedAt: new Date(now),
            lastSeenAt: new Date(now),
            lastIp: client.ip,
            idleExpiresAt: this.idleUntil(now, session.expiresAt),
          },
          $inc: { rotationCount: 1 },
        },
      )
      .exec();
    if (!updated) {
      throw new ConflictException({
        message: 'Session already renewed',
        code: AUTH_CODES.refreshRace,
      });
    }
    return {
      accessToken: access.token,
      refreshToken: newRefresh,
      expiresIn: access.expiresIn,
      sessionId,
    };
  }

  /**
   * Called by the auth guard on every request, after the token's signature
   * and expiry were checked. Throws if the session no longer accepts it.
   */
  async checkAccess(payload: JwtPayload, client: ClientInfo) {
    if (!payload.sid || !payload.jti || !Types.ObjectId.isValid(payload.sid)) {
      throw new UnauthorizedException({
        message: 'Session expired, please log in again',
        code: AUTH_CODES.tokenInvalid,
      });
    }
    const session = await this.sessionModel.findById(payload.sid).exec();
    if (!session || String(session.userId) !== payload.sub) {
      throw ended('Session expired, please log in again');
    }
    const now = Date.now();
    this.assertActive(session, now);

    const current = session.accessTokenId === payload.jti;
    const justReplaced =
      session.previousAccessTokenId === payload.jti &&
      !!session.rotatedAt &&
      now - session.rotatedAt.getTime() < ROTATION_GRACE_MS;
    if (!current && !justReplaced) {
      // A token from before a rotation: only the newest one is accepted.
      throw new UnauthorizedException({
        message: 'Session expired, please log in again',
        code: AUTH_CODES.tokenExpired,
      });
    }

    // Record activity (at most once a minute, it is one write per request otherwise)
    if (
      !session.lastSeenAt ||
      now - session.lastSeenAt.getTime() > TOUCH_EVERY_MS
    ) {
      void this.sessionModel
        .updateOne(
          { _id: session._id },
          {
            lastSeenAt: new Date(now),
            lastIp: client.ip,
            idleExpiresAt: this.idleUntil(now, session.expiresAt),
          },
        )
        .exec()
        .catch(() => undefined);
    }
    return session;
  }

  // ── Ending sessions ──────────────────────────────────────────────────────

  async revoke(
    id: Types.ObjectId | string,
    reason: RevokeReason,
    by?: string,
  ): Promise<boolean> {
    const res = await this.sessionModel
      .updateOne(
        { _id: id, revokedAt: null },
        {
          revokedAt: new Date(),
          revokedReason: reason,
          revokedBy:
            by && Types.ObjectId.isValid(by) ? new Types.ObjectId(by) : null,
        },
      )
      .exec();
    return res.modifiedCount > 0;
  }

  /** Ends every open session of a user, except `keepSessionId` if given. */
  async revokeAllForUser(
    userId: string,
    reason: RevokeReason,
    options: { by?: string; keepSessionId?: string } = {},
  ): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      revokedAt: null,
    };
    if (
      options.keepSessionId &&
      Types.ObjectId.isValid(options.keepSessionId)
    ) {
      filter._id = { $ne: new Types.ObjectId(options.keepSessionId) };
    }
    const res = await this.sessionModel
      .updateMany(filter, {
        revokedAt: new Date(),
        revokedReason: reason,
        revokedBy:
          options.by && Types.ObjectId.isValid(options.by)
            ? new Types.ObjectId(options.by)
            : null,
      })
      .exec();
    return res.modifiedCount;
  }

  /** A user ends one of their own sessions. */
  async revokeOwn(userId: string, sessionId: string) {
    const session = await this.sessionModel
      .findOne({ _id: objectId(sessionId), userId: new Types.ObjectId(userId) })
      .exec();
    if (!session) throw new NotFoundException('Session not found');
    await this.revoke(session._id, 'revoked_by_user', userId);
  }

  /** An admin ends a session in their company (super admin: any, with companyId null). */
  async revokeInCompany(
    companyId: string | null,
    sessionId: string,
    actorId: string,
  ) {
    const filter: Record<string, unknown> = { _id: objectId(sessionId) };
    if (companyId) filter.companyId = new Types.ObjectId(companyId);
    const session = await this.sessionModel.findOne(filter).exec();
    if (!session) throw new NotFoundException('Session not found');
    await this.revoke(session._id, 'revoked_by_admin', actorId);
  }

  // ── Listing ──────────────────────────────────────────────────────────────

  async listForUser(userId: string, currentSessionId?: string) {
    const now = new Date();
    const sessions = await this.sessionModel
      .find({
        userId: new Types.ObjectId(userId),
        revokedAt: null,
        expiresAt: { $gt: now },
        idleExpiresAt: { $gt: now },
      })
      .sort({ lastSeenAt: -1 })
      .lean()
      .exec();
    return sessions.map((s) => ({
      ...this.toView(s, now),
      current: String(s._id) === currentSessionId,
    }));
  }

  /** companyId null = every company (super admin outside any company). */
  async listForCompany(companyId: string | null, query: SessionQuery) {
    const now = new Date();
    const filter: Record<string, any> = {};
    if (companyId) filter.companyId = new Types.ObjectId(companyId);
    if (query.userId && Types.ObjectId.isValid(query.userId)) {
      filter.userId = new Types.ObjectId(query.userId);
    }
    const status = query.status ?? 'active';
    if (status === 'active') {
      Object.assign(filter, {
        revokedAt: null,
        expiresAt: { $gt: now },
        idleExpiresAt: { $gt: now },
      });
    } else if (status === 'ended') {
      filter.$or = [
        { revokedAt: { $ne: null } },
        { expiresAt: { $lte: now } },
        { idleExpiresAt: { $lte: now } },
      ];
    }
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const page = Math.max(Number(query.page) || 1, 1);
    const [items, total] = await Promise.all([
      this.sessionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.sessionModel.countDocuments(filter).exec(),
    ]);
    return { items: items.map((s) => this.toView(s, now)), total, page, limit };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** What the API shows about a session. Never the token hashes. */
  private toView(
    s: LoginSession & { _id: Types.ObjectId; rotatedAt?: Date },
    now: Date,
  ) {
    const endedAt =
      s.revokedAt ??
      (s.expiresAt <= now
        ? s.expiresAt
        : s.idleExpiresAt <= now
          ? s.idleExpiresAt
          : null);
    const endReason =
      s.revokedReason ??
      (s.expiresAt <= now
        ? 'expired'
        : s.idleExpiresAt <= now
          ? 'idle_timeout'
          : undefined);
    return {
      id: String(s._id),
      userId: String(s.userId),
      userName: s.userName,
      userEmail: s.userEmail,
      userRole: s.userRole,
      companyId: s.companyId ? String(s.companyId) : null,
      ip: s.ip,
      lastIp: s.lastIp,
      device: s.device,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      accessTokenId: s.accessTokenId,
      accessTokenExpiresAt: s.accessTokenExpiresAt,
      rotationCount: s.rotationCount ?? 0,
      rotatedAt: s.rotatedAt,
      idleExpiresAt: s.idleExpiresAt,
      expiresAt: s.expiresAt,
      active: !endedAt,
      endedAt,
      endReason,
    };
  }

  private assertActive(session: LoginSessionDocument, now: number) {
    if (session.revokedAt)
      throw ended('This session was ended. Please log in again.');
    if (
      session.expiresAt.getTime() <= now ||
      session.idleExpiresAt.getTime() <= now
    ) {
      throw ended('Session expired, please log in again');
    }
  }

  private newRefreshToken(sessionId: string) {
    return `${sessionId}.${randomBytes(32).toString('base64url')}`;
  }

  private async signAccess(
    userId: string,
    sessionId: string,
    sessionEnd: Date,
  ) {
    const jti = randomUUID();
    // Never valid beyond the end of the session
    const ms = Math.max(
      1000,
      Math.min(this.config.accessTokenMs, sessionEnd.getTime() - Date.now()),
    );
    const expiresIn = Math.floor(ms / 1000);
    const payload: JwtPayload = { sub: userId, sid: sessionId };
    const token = await this.jwtService.signAsync(payload, {
      jwtid: jti,
      expiresIn,
    });
    return {
      token,
      jti,
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  private idleUntil(now: number, expiresAt: Date) {
    return new Date(
      Math.min(now + this.config.idleTimeoutMs, expiresAt.getTime()),
    );
  }

  private purgeDate(expiresAt: Date) {
    return new Date(expiresAt.getTime() + SESSION_HISTORY_DAYS * 86400 * 1000);
  }
}
