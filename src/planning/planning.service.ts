import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Planning, PlanningDocument } from './planning.shema';
import * as ExcelJS from "exceljs";
import { Response } from "express";

@Injectable()
export class PlanningService {
  constructor(@InjectModel(Planning.name) private planningModel: Model<PlanningDocument>) {}

  async create(data: Partial<Planning>): Promise<PlanningDocument> {
    return this.planningModel.create(data);
  }

  async findAll(query: Record<string, any> = {}): Promise<PlanningDocument[]> {
    const filter: Record<string, any> = {};

    if (query.planDate) {
      const start = new Date(query.planDate); start.setHours(0, 0, 0, 0);
      const end   = new Date(query.planDate); end.setHours(23, 59, 59, 999);
      filter.planDate = { $gte: start, $lte: end };
    }

    return this.planningModel.find(filter).populate('shiftId').populate('empId').exec();
  }

  // /** Keep existing planning entries in the database.
  //     Add only new entries.
  //     Avoid deleting all planning for the day.
  //  */
  // async bulkSave(entries: any[], planDate: string): Promise<PlanningDocument[]> {
  //   const inserted: PlanningDocument[] = [];

  //   for (const entry of entries) {
  //     const exists = await this.planningModel.findOne({
  //       planDate: new Date(entry.planDate),
  //       shiftId: entry.shiftId,
  //       empId: entry.empId,
  //       taskId: entry.taskId,
  //     });

  //     if (!exists) {
  //       const doc = await this.planningModel.create({
  //         shiftId: entry.shiftId,
  //         empId: entry.empId,
  //         taskId: entry.taskId,
  //         planDate: new Date(entry.planDate),
  //       });

  //       inserted.push(doc);
  //     }
  //   }

  //   return inserted;
  // }

  //Delete old entries and insert new ones for the day. This is simpler and avoids duplicates.
  // async bulkSave(entries: any[], planDate: string): Promise<PlanningDocument[]> 
  // { 
  //   const start = new Date(planDate); 
  //   start.setHours(0, 0, 0, 0); 
  //   const end = new Date(planDate); 
  //   end.setHours(23, 59, 59, 999); 
  //   await this.planningModel.deleteMany({ planDate: { $gte: start, $lte: end } }); 
  //   if (!entries.length) return []; 
  //   const docs = entries.map((e) => (
  //     { shiftId: e.shiftId, empId: e.empId, taskId: e.taskId, planDate: new Date(e.planDate), })); 
  //     return this.planningModel.insertMany(docs) as any; 
  // }

  async bulkSave(entries: any[], planDate: string): Promise<PlanningDocument[]>
  {
    const start = new Date(planDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(planDate);
    end.setHours(23, 59, 59, 999);
    await this.planningModel.deleteMany({ planDate: { $gte: start, $lte: end } });
    if (!entries.length) return [];
    const docs = entries.map((e) => ({
      shiftId: e.shiftId,
      empId: e.empId,
      taskId: e.taskId,
      planDate: new Date(e.planDate),
      tasks: e.tasks ?? [],
    }));
    return this.planningModel.insertMany(docs) as any;
  }

  async importFromDate(date: string) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const planning = await this.planningModel
      .find({
        planDate: {
          $gte: start,
          $lte: end,
        },
      })
      .populate('empId')
      .populate('shiftId')
      .lean();

    return planning.map((item: any) => ({
      id: item._id,
      empId: item.empId._id,
      shiftId: item.shiftId._id,
      taskId: item.taskId,
      title: `${item.empId.firstName} ${item.empId.lastName}`,
      tasks: item.tasks ?? [],
    }));
  }

  private async buildFirstWeekPlanning(
    year: number,
    month: number,
  ): Promise<{
    weekGrid: Record<string, Record<string, string[]>>;
    weekDays: string[];
    weekDates: Date[];
    hours: string[];
  }>{
      // --------------------------------------------------
      // 1. Month range
      // --------------------------------------------------
      const monthStart = new Date(year, month - 1, 1);
      monthStart.setHours(0, 0, 0, 0);

      const monthEnd = new Date(year, month, 0);
      monthEnd.setHours(23, 59, 59, 999);

      // --------------------------------------------------
      // 2. Load all planning for the month
      // --------------------------------------------------
      const planning = await this.planningModel
        .find({
          planDate: {
            $gte: monthStart,
            $lte: monthEnd,
          },
        })
        .populate("empId")
        .populate("shiftId")
        .lean();

      // --------------------------------------------------
      // 3. Days order (always Saturday -> Friday)
      // --------------------------------------------------
      const weekDays = [
        "Saturday",
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
      ];

      // --------------------------------------------------
      // 4. Calculate first week's dates
      // --------------------------------------------------
      const firstDay = new Date(year, month - 1, 1);

      // JS weekday:
      // Sunday=0 Monday=1 ... Saturday=6
      const jsWeekDay = firstDay.getDay();

      // Convert to Saturday-first index
      const firstColumn = (jsWeekDay + 1) % 7;

      const weekDates: Date[] = [];

      for (let i = 0; i < 7; i++) {

        const d = new Date(firstDay);

        d.setDate(
          1 + ((i - firstColumn + 7) % 7)
        );

        d.setHours(0,0,0,0);

        weekDates.push(d);
      }

      // --------------------------------------------------
      // 5. Hours
      // --------------------------------------------------
      const hours = [
        "06H",
        "07H",
        "08H",
        "09H",
        "10H",
        "11H",
        "12H",
        "14H",
        "15H",
        "16H",
      ];

      // --------------------------------------------------
      // 6. Empty grid
      // --------------------------------------------------
      const weekGrid: Record<string, Record<string, string[]>> = {};

      weekDays.forEach(day => {

        weekGrid[day] = {};

        hours.forEach(hour => {
          weekGrid[day][hour] = [];
        });

      });

      // --------------------------------------------------
      // 7. Fill grid
      // --------------------------------------------------
      planning.forEach((item: any) => {

        const itemDate = new Date(item.planDate);
        itemDate.setHours(0,0,0,0);

        const index = weekDates.findIndex(d =>
          d.getFullYear() === itemDate.getFullYear() &&
          d.getMonth() === itemDate.getMonth() &&
          d.getDate() === itemDate.getDate()
        );

        if(index === -1)
          return;

        const day = weekDays[index];

        let startTime: string;

        if(item.tasks?.length){
          startTime = item.tasks[0].startTime;
        }else{
          startTime = item.shiftId.startTime;
        }

        const hour = `${startTime.substring(0,2)}H`;

        const employee =
          `${item.empId.firstName} ${item.empId.lastName}`;

        if(weekGrid[day][hour]){
          weekGrid[day][hour].push(employee);
        }

      });

      return {
        weekGrid,
        weekDays,
        weekDates,
        hours,
    };
  }

  //Export in Excel Format
  async exportFirstWeek(
  year: number,
  month: number,
  ): Promise<ExcelJS.Workbook> {
    const {
      weekGrid,
      weekDays,
      weekDates,
      hours,
    } = await this.buildFirstWeekPlanning(year, month);
    // --------------------------------------------------
    // 8. Workbook
    // --------------------------------------------------
    const workbook = new ExcelJS.Workbook();
    const sheet =
      workbook.addWorksheet("First Week Planning");
    // --------------------------------------------------
    // 9. Header
    // --------------------------------------------------
    sheet.addRow([
      "Hour",
      ...weekDays,
    ]);
    // --------------------------------------------------
    // 10. Rows
    // --------------------------------------------------
    hours.forEach(hour => {
      const row = [hour];
      weekDays.forEach(day => {
        row.push(
          weekGrid[day][hour].join("\n")
        );
      });
      sheet.addRow(row);
    });
    // --------------------------------------------------
    // 11. Formatting
    // --------------------------------------------------
    sheet.columns = [
      { width: 12 },
      { width: 25 },
      { width: 25 },
      { width: 25 },
      { width: 25 },
      { width: 25 },
      { width: 25 },
      { width: 25 },
    ];
    sheet.eachRow((row, rowNumber) => {
      row.height = 35;
      row.eachCell(cell => {
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        };
        cell.border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
        if(rowNumber === 1){
          cell.font = {
            bold: true,
            size: 12,
          };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: "D9D9D9",
            },
          };
        }
      });
    });
    return workbook;
  }


  async exportFirstWeekPdf(
    year: number,
    month: number,
    res: Response,
  ): Promise<void> {
    const {
      weekGrid,
      weekDays,
      weekDates,
      hours,
    } = await this.buildFirstWeekPlanning(year, month);
    // PDF generation...
    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 20,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="FirstWeekPlanning.pdf"',
    );
    doc.pipe(res);
    // --------------------------------------------------
    // Layout
    // --------------------------------------------------
    const startX = 20;
    let startY = 70;
    const rowHeight = 40;
    const hourWidth = 60;
    const dayWidth = 95;
    // --------------------------------------------------
    // Title
    // --------------------------------------------------
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .text("First Week Planning", 0, 25, {
        align: "center",
      });
    // --------------------------------------------------
    // Header
    // --------------------------------------------------
    doc.font("Helvetica-Bold").fontSize(10);
    let x = startX;
    // Hour header
    doc.rect(x, startY, hourWidth, rowHeight).stroke();
    doc.text("Hour", x, startY + 12, {
      width: hourWidth,
      align: "center",
    });
    x += hourWidth;
    // Days headers
    weekDays.forEach((day) => {
      doc.rect(x, startY, dayWidth, rowHeight).stroke();

      doc.text(day, x, startY + 12, {
        width: dayWidth,
        align: "center",
      });
      x += dayWidth;
    });
    // --------------------------------------------------
    // Rows
    // --------------------------------------------------
    doc.font("Helvetica").fontSize(9);
    hours.forEach((hour, rowIndex) => {
      const y = startY + rowHeight * (rowIndex + 1);
      // Hour column
      doc.rect(startX, y, hourWidth, rowHeight).stroke();
      doc.text(hour, startX, y + 12, {
        width: hourWidth,
        align: "center",
      });
      let x = startX + hourWidth;
      weekDays.forEach((day) => {
        doc.rect(x, y, dayWidth, rowHeight).stroke();
        const employees = weekGrid[day][hour].join("\n");
        doc.text(employees, x + 2, y + 4, {
          width: dayWidth - 4,
          height: rowHeight - 8,
          align: "center",
        });
        x += dayWidth;
      });
    });
    doc.end();
  }

    async findOne(id: string): Promise<PlanningDocument | null> {
      return this.planningModel.findById(id).populate('shiftId').populate('empId').exec();
    }

    async update(id: string, data: Partial<Planning>): Promise<PlanningDocument | null> {
      return this.planningModel.findByIdAndUpdate(id, data, { new: true }).exec();
    }

    async remove(id: string): Promise<PlanningDocument | null> {
      return this.planningModel.findByIdAndDelete(id).exec();
    }
}