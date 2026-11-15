import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { RequireFeature } from '../auth/auth.decorators';
import { SHIFT_FIELDS } from '../common/body-rules';
import { validateBody } from '../common/validate';

@RequireFeature('planning')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post() create(@Body() body: unknown) {
    return this.shiftsService.create(validateBody(body, SHIFT_FIELDS));
  }

  @Get()
  findAll(@Query('status') status?: 'active' | 'archived' | 'all') {
    return this.shiftsService.findAll(status ?? 'active');
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.shiftsService.findOne(id); }

  @Put(':id') update(@Param('id') id: string, @Body() body: unknown) {
    return this.shiftsService.update(
      id,
      validateBody(body, SHIFT_FIELDS, 'partial'),
    );
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string) { return this.shiftsService.setArchived(id, true); }

  @Patch(':id/restore')
  restore(@Param('id') id: string) { return this.shiftsService.setArchived(id, false); }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('force') force?: string) {
    return this.shiftsService.remove(id, force === 'true');
  }
}