import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { EmployeesService, archiveStatus } from './employees.service';
import { subscriptionState } from '../companies/subscription.util';
import { EMPLOYEE_FIELDS } from '../common/body-rules';
import { validateBody } from '../common/validate';
import { ManagerVisibilityService } from './manager-visibility.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthUser } from '../auth/auth.decorators';

// Other managers stay listed (planning and clock-in need them), without their
// salary or contact details, and flagged so salary pages can leave them out.
function withoutPrivateFields(employee: any) {
  const {
    baseSalary,
    address,
    phoneNumber,
    familyStatus,
    birthDate,
    hireDate,
    socialSecurityNumber,
    declaredSalary,
    ...rest
  } = employee.toObject ? employee.toObject() : employee;
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

  @Roles('admin', 'manager') @Post() async create(
    @Req() req: { company?: { subscription?: any } | null },
    @Body() body: any,
  ) {
    const data = validateBody(body, EMPLOYEE_FIELDS);
    await this.employeesService.assertRoomFor(
      subscriptionState(req.company?.subscription).maxEmployees,
    );
    return this.employeesService.create(data);
  }
  /**
   * GET /employees[?status=active|archived|all]
   * Everyone when status is missing, each with isArchived: history and
   * reports need the people who left; pickers ask for status=active.
   */
  @Get() async findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
  ) {
    const [employees, hidden] = await Promise.all([
      this.employeesService.findAll(archiveStatus(status)),
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
    const data = validateBody<Record<string, any>>(
      body,
      EMPLOYEE_FIELDS,
      'partial',
    );

    if (data.baseSalary !== undefined && (await this.visibility.isOwnRecord(user, id))) {
      const current: any = await this.employeesService.findOne(id);
      if (current && Number(data.baseSalary) !== Number(current.baseSalary)) {
        throw new ForbiddenException('Only an admin can change your salary');
      }
    }

    return this.employeesService.update(id, data);
  }
  /** Archives an employee who left: off the daily screens, history and pay kept. */
  @Roles('admin', 'manager') @Patch(':id/archive') async archive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.assertCanChange(user, id);
    if (await this.visibility.isOwnRecord(user, id)) {
      throw new ForbiddenException("You can't archive your own employee record");
    }
    return this.employeesService.setArchived(id, true);
  }

  /** Brings an archived employee back (they count again in the pack's limit). */
  @Roles('admin', 'manager') @Patch(':id/restore') async restore(
    @CurrentUser() user: AuthUser,
    @Req() req: { company?: { subscription?: any } | null },
    @Param('id') id: string,
  ) {
    await this.assertCanChange(user, id);
    const employee = await this.employeesService.findOne(id);
    if (employee.isArchived) {
      await this.employeesService.assertRoomFor(
        subscriptionState(req.company?.subscription).maxEmployees,
      );
    }
    return this.employeesService.setArchived(id, false);
  }

  /** Deletes an employee added by mistake; one with history is refused (archive instead). */
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
