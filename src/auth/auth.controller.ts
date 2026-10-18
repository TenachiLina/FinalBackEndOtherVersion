import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './auth.decorators';
import type { AuthUser } from './auth.decorators';

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
  me(@CurrentUser() user: AuthUser) {
    return user;
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
