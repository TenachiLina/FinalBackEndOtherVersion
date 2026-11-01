import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { ManagerVisibilityService } from './manager-visibility.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';

// Other managers stay listed (planning and clock-in need them), without their
// salary or contact details, and flagged so salary pages can leave them out.
function withoutPrivateFields(employee: any) {
  const { baseSalary, address, phoneNumber, ...rest } = employee.toObject
    ? employee.toObject()
    : employee;
  return { ...rest, otherManager: true };
}

@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly visibility: ManagerVisibilityService,
  ) {}

  private async assertCanChange(user: AuthUser, id: string) {
    if ((await this.visibility.hiddenFor(user)).ids.has(id)) {
      throw new ForbiddenException(
        "You can't see or change another manager's information",
      );
    }
  }

  @Roles('admin', 'manager') @Post() create(@Body() body: any) {
    return this.employeesService.create(body);
  }
  @Get() async findAll(@CurrentUser() user: AuthUser) {
    const [employees, hidden] = await Promise.all([
      this.employeesService.findAll(),
      this.visibility.hiddenFor(user),
    ]);
    return employees.map((e) =>
      hidden.ids.has(String(e._id)) ? withoutPrivateFields(e) : e,
    );
  }
  @Get(':id') async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const employee = await this.employeesService.findOne(id);
    if (employee && (await this.visibility.hiddenFor(user)).ids.has(id)) {
      return withoutPrivateFields(employee);
    }
    return employee;
  }
  @Roles('admin', 'manager') @Put(':id') async update(
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
  @Body() body: any,
  ) {
    await this.assertCanChange(user, id);

    if (body?.baseSalary !== undefined && (await this.visibility.isOwnRecord(user, id))) {
      const current: any = await this.employeesService.findOne(id);
      if (current && Number(body.baseSalary) !== Number(current.baseSalary)) {
        throw new ForbiddenException('Only an admin can change your salary');
      }
    }

    return this.employeesService.update(id, body);
  }
  @Roles('admin', 'manager') @Delete(':id') async remove(
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
  ) {
    await this.assertCanChange(user, id);

    if (await this.visibility.isOwnRecord(user, id)) {
      throw new ForbiddenException("You can't delete your own employee record");
    }

    return this.employeesService.remove(id);
  }
}
