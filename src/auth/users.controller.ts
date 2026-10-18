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

// Users of the current company. The guard guarantees companyId is set here.
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get() findAll(@CurrentUser() actor: AuthUser) {
    return this.usersService.findAll(actor.companyId!);
  }

  @Post() create(
    @CurrentUser() actor: AuthUser,
    @Body() body: CreateUserInput,
  ) {
    return this.usersService.create(actor.companyId!, body ?? {});
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateUserInput,
  ) {
    return this.usersService.update(id, actor.companyId!, actor.id, body ?? {});
  }

  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: { password?: string },
  ) {
    await this.usersService.setPassword(id, body?.password, actor.companyId!);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    await this.usersService.remove(id, actor.companyId!, actor.id);
  }
}
