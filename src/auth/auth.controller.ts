import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthService, toCompanyInfo } from './auth.service';
import { SessionsService } from './sessions.service';
import {
  AllowNoCompany,
  CurrentUser,
  KioskAllowed,
  Public,
} from './auth.decorators';
import type { AuthUser } from './auth.decorators';
import { clientInfo } from './client-info';

// A super admin uses these without picking a company.
@AllowNoCompany()
@KioskAllowed()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  // Stricter limit than the rest of the API: slows down password guessing
  // from one address (accounts also lock after 5 wrong passwords).
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email?: string; password?: string }, @Req() req: any) {
    return this.authService.login(body?.email, body?.password, clientInfo(req));
  }

  /** Swaps the refresh token for new tokens. Public: the access token may have expired. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: { refreshToken?: string }, @Req() req: any) {
    return this.authService.refresh(body?.refreshToken, clientInfo(req));
  }

  @SkipThrottle()
  @Get('me')
  me(@CurrentUser() user: AuthUser, @Req() req: { company?: any }) {
    return { user, company: toCompanyInfo(req.company ?? null) };
  }

  /** Ends this session: its tokens stop working at once. */
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    if (user.sessionId)
      await this.sessions.revoke(user.sessionId, 'logout', user.id);
  }

  /** Signs out every other device of this account. */
  @Post('logout-others')
  @HttpCode(200)
  async logoutOthers(@CurrentUser() user: AuthUser) {
    const ended = await this.sessions.revokeAllForUser(
      user.id,
      'logout_others',
      {
        by: user.id,
        keepSessionId: user.sessionId,
      },
    );
    return { ended };
  }

  /** Your open sessions (devices where you are signed in). */
  @Get('sessions')
  sessionsList(@CurrentUser() user: AuthUser) {
    return this.sessions.listForUser(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async endSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.sessions.revokeOwn(user.id, id);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    await this.authService.changePassword(
      user.id,
      user.sessionId,
      body?.currentPassword,
      body?.newPassword,
    );
  }
}
