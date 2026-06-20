// import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
// import { ShiftsService } from './shifts.service';

// @Controller('shifts')
// export class ShiftsController {
//   constructor(private readonly shiftsService: ShiftsService) {}

//   @Post() create(@Body() body: any) { return this.shiftsService.create(body); }
//   @Get() findAll() { return this.shiftsService.findAll(); }
//   @Get(':id') findOne(@Param('id') id: string) { return this.shiftsService.findOne(id); }
//   @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.shiftsService.update(id, body); }
//   @Delete(':id') remove(@Param('id') id: string) { return this.shiftsService.remove(id); }
// }

import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { ShiftsService } from './shifts.service';

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post() create(@Body() body: any) { return this.shiftsService.create(body); }

  @Get()
  findAll(@Query('status') status?: 'active' | 'archived' | 'all') {
    return this.shiftsService.findAll(status ?? 'active');
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.shiftsService.findOne(id); }

  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.shiftsService.update(id, body); }

  @Patch(':id/archive')
  archive(@Param('id') id: string) { return this.shiftsService.setArchived(id, true); }

  @Patch(':id/restore')
  restore(@Param('id') id: string) { return this.shiftsService.setArchived(id, false); }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('force') force?: string) {
    return this.shiftsService.remove(id, force === 'true');
  }
}