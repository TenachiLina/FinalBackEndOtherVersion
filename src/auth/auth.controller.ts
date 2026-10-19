import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { AuthService, toCompanyInfo } from './auth.service';
import {
  AllowNoCompany,
  CurrentUser,
  KioskAllowed,
  Public,
} from './auth.decorators';
import type { AuthUser } from './auth.decorators';

// A super admin uses these without picking a company.
@AllowNoCompany()
@KioskAllowed()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email?: string; password?: string }) {
    return this.authService.login(body?.email, body?.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser, @Req() req: { company?: any }) {
    return { user, company: toCompanyInfo(req.company ?? null) };
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    await this.authService.changePassword(
      user.id,
      body?.currentPassword,
      body?.newPassword,
    );
  }
}
