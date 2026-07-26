import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Res,
} from '@nestjs/common';
import { PlanningService } from './planning.service';
import type { Response } from "express";


@Controller('planning')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Post()
  create(@Body() body: any) {
    return this.planningService.create(body);
  }

  /** Save all planning entries for a date (replaces existing ones for that day) */
  @Post('bulk')
  async bulkSave(@Body() body: { entries: any[]; planDate: string }) {
    return this.planningService.bulkSave(body.entries, body.planDate);
  }

  @Get()
  async findAll(@Query() query: any) {
    try {
      return await this.planningService.findAll(query);
    } catch (err) {
      console.error('💀💀💀 findAll error:', err);
      throw err;
    }
  }

  @Get('import/:date')
  async importFromDate(@Param('date') date: string) {
    return this.planningService.importFromDate(date);
  }
  
  @Get("export-first-week")
  async exportFirstWeek(
    @Query("year") year: string,
    @Query("month") month: string,
    @Query("format") format: string,
    @Res() res: Response,
  ) {
    if (format === "pdf") {
      return this.planningService.exportFirstWeekPdf(
        Number(year),
        Number(month),
        res,
      );
    }

    const workbook = await this.planningService.exportFirstWeek(
      Number(year),
      Number(month),
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="WeeklyPlanning.xlsx"',
    );

    await workbook.xlsx.write(res);
    res.end();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.planningService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.planningService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.planningService.remove(id);
  }
}