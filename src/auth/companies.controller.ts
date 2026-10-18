import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CompaniesService } from '../companies/companies.service';
import type { CompanyInput } from '../companies/companies.service';
import { FEATURES } from '../companies/company.schema';
import { UsersService } from './users.service';
import type { CreateUserInput } from './users.service';
import { AllowNoCompany, CurrentUser, Public, Roles } from './auth.decorators';
import type { AuthUser } from './auth.decorators';
import { toCompanyInfo } from './auth.service';

/** Super admin: create and manage customer companies. */
@Roles('superadmin')
@AllowNoCompany()
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly usersService: UsersService,
  ) {}

  @Get('features') features() {
    return FEATURES;
  }

  @Get() findAll() {
    return this.companiesService.findAll();
  }

  @Get(':id') findOne(@Param('id') id: string) {
    return this.companiesService.getById(id);
  }

  /** Creates a company together with its first admin. */
  @Post()
  async create(@Body() body: CompanyInput & { admin?: CreateUserInput }) {
    const admin = body?.admin ?? {};
    if (admin.email && (await this.usersService.emailTaken(admin.email))) {
      throw new ConflictException('A user with this email already exists');
    }
    const company = await this.companiesService.create(body ?? {});
    try {
      await this.usersService.create(String(company._id), {
        ...admin,
        role: 'admin',
      });
    } catch (err) {
      // Don't leave a company nobody can log in to.
      await company.deleteOne();
      throw err;
    }
    return company;
  }

  @Patch(':id') update(@Param('id') id: string, @Body() body: CompanyInput) {
    return this.companiesService.update(id, body ?? {});
  }
}

/** A company admin: view and edit their own company's name and settings. */
@Controller('company')
export class OwnCompanyController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return toCompanyInfo(await this.companiesService.getById(user.companyId!));
  }

  @Roles('admin')
  @Patch()
  async update(@CurrentUser() user: AuthUser, @Body() body: CompanyInput) {
    return toCompanyInfo(
      await this.companiesService.updateOwn(user.companyId!, body ?? {}),
    );
  }
}

/** Public: the sign-in page loads a company's logo and text before login. */
@Public()
@Controller('branding')
export class BrandingController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get(':slug') get(@Param('slug') slug: string) {
    return this.companiesService.publicBranding(slug);
  }
}
