import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import type { CreateUserInput, UpdateUserInput } from './users.service';
import { CurrentUser, Roles } from './auth.decorators';
import type { AuthUser } from './auth.decorators';

@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get() findAll() {
    return this.usersService.findAll();
  }

  @Post() create(@Body() body: CreateUserInput) {
    return this.usersService.create(body ?? {});
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateUserInput,
  ) {
    return this.usersService.update(id, actor.id, body ?? {});
  }

  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(
    @Param('id') id: string,
    @Body() body: { password?: string },
  ) {
    await this.usersService.setPassword(id, body?.password);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    await this.usersService.remove(id, actor.id);
  }
}
