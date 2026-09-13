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

   return this.planningModel
    .find(filter)
    .populate('shiftId')
    .populate('empId')
    .populate('backupEmpId')
    .exec();
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
      backupEmpId: e.backupEmpId ?? null,
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
      .populate('backupEmpId')
      .populate('shiftId')
      .lean();

    return planning.map((item: any) => ({
      id: item._id,
      // Main employee
      empId: item.empId._id,
      title: `${item.empId.firstName} ${item.empId.lastName}`,
      // Backup employee
      backupEmpId: item.backupEmpId?._id ?? null,
      backupTitle: item.backupEmpId
        ? `${item.backupEmpId.firstName} ${item.backupEmpId.lastName}`
        : null,
      shiftId: item.shiftId._id,
      taskId: item.taskId,
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
        .populate("backupEmpId")
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
        `${item.empId.firstName} ${item.empId.lastName}` +
        (
          item.backupEmpId
            ? `\nBackup: ${item.backupEmpId.firstName} ${item.backupEmpId.lastName}`
            : `\nBackup: No backup`
        );

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

  //Export Week in Excel Format
  async exportFirstWeek(
  year: number,
  month: number,
  ): Promise<ExcelJS.Workbook> {
    const {
      weekGrid,
      weekDays,
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

  // Export Week in PDF Format
  async exportFirstWeekPdf(
    year: number,
    month: number,
    res: Response,
  ): Promise<void> {

    const {
      weekGrid,
      weekDays,
      hours,
    } = await this.buildFirstWeekPlanning(year, month);

    const PDFDocument = require("pdfkit");

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 20,
    });

    res.setHeader(
      "Content-Type",
      "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="FirstWeekPlanning.pdf"',
    );

    doc.pipe(res);

    // ==================================================
    // PAGE DIMENSIONS
    // ==================================================

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    const margin = 20;

    const availableWidth =
      pageWidth - margin * 2;

    // ==================================================
    // TABLE WIDTH
    // ==================================================

    const hourWidth = 50;

    const dayWidth =
      (availableWidth - hourWidth) / 7;

    const startX = margin;

    // ==================================================
    // FONTS
    // ==================================================

    const headerFontSize = 9;

    // Employee font
    const employeeFontSize = 6.5;

    const hourFontSize = 8;

    // ==================================================
    // HEADER HEIGHT
    // ==================================================

    const headerHeight = 30;

    // Minimum height for a normal row
    const minimumRowHeight = 30;

    // Padding inside employee cells
    const cellPadding = 5;

    // ==================================================
    // MONTH DATE RANGE
    // ==================================================

    /*
    * IMPORTANT:
    *
    * JavaScript months are 0-based:
    *
    * January  = 0
    * February = 1
    * ...
    * August   = 7
    * September = 8
    *
    * Therefore:
    *
    * new Date(year, month, 1)
    * new Date(year, month + 1, 0)
    *
    * correctly gives the first and last day
    * of the requested month.
    */

    const firstDayOfMonth =
      new Date(year, month, 1);

    const lastDayOfMonth =
      new Date(year, month + 1, 0);

    /*
    * Use numeric date formatting here.
    *
    * This avoids timezone-related problems that can
    * accidentally move the date to the previous/next day.
    */

    const monthName =
      firstDayOfMonth.toLocaleDateString(
        "en-US",
        {
          month: "long",
        },
      );

    const firstDayNumber =
      firstDayOfMonth.getDate();

    const lastDayNumber =
      lastDayOfMonth.getDate();

    const dateRangeText =
      `From: ${firstDayNumber} ${monthName} ${year} ` +
      `to ${lastDayNumber} ${monthName} ${year}`;
 
    // ==================================================
    // DRAW TITLE
    // ==================================================

    const drawTitle = () => {

      // ------------------------------------------------
      // Main title
      // ------------------------------------------------

      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(
          "First Week Planning",
          0,
          15,
          {
            align: "center",
            width: pageWidth,
          },
        );

      // ------------------------------------------------
      // Date range
      // ------------------------------------------------

      doc
        .font("Helvetica")
        .fontSize(9)
        .text(
          dateRangeText,
          0,
          38,
          {
            align: "center",
            width: pageWidth,
          },
        );
    };

    // ==================================================
    // DRAW HEADER
    // ==================================================

    const drawHeader = (startY: number) => {

      doc
        .font("Helvetica-Bold")
        .fontSize(headerFontSize);

      let x = startX;

      // ----------------------------------------------
      // Hour header
      // ----------------------------------------------

      doc
        .rect(
          x,
          startY,
          hourWidth,
          headerHeight,
        )
        .stroke();

      doc.text(
        "Hour",
        x,
        startY + 10,
        {
          width: hourWidth,
          align: "center",
        },
      );

      x += hourWidth;

      // ----------------------------------------------
      // Days headers
      // ----------------------------------------------

      weekDays.forEach((day) => {

        doc
          .rect(
            x,
            startY,
            dayWidth,
            headerHeight,
          )
          .stroke();

        doc.text(
          day,
          x,
          startY + 10,
          {
            width: dayWidth,
            align: "center",
          },
        );

        x += dayWidth;
      });
    };

    // ==================================================
    // GET EMPLOYEE / BACKUP PARTS
    // ==================================================

    /*
    * The PDF data is expected to contain employees
    * like:
    *
    * John Smith
    * (Backup: Ahmed Ali)
    *
    * Main employee will be displayed in BOLD.
    *
    * Backup will be displayed in NORMAL font.
    */

    const getEmployeeParts = (employee: string) => {

      const backupMatch =
        employee.match(
          /\(Backup:\s*(.*?)\)/i,
        );

      if (!backupMatch) {

        return {
          main: employee,
          backup: null,
        };
      }

      const main =
        employee
          .replace(
            backupMatch[0],
            "",
          )
          .trim();

      const backup =
        `Backup: ${backupMatch[1].trim()}`;

      return {
        main,
        backup,
      };
    };

    // ==================================================
    // CALCULATE EMPLOYEE TEXT HEIGHT
    // ==================================================

    const calculateEmployeeHeight = (
      employees: string[],
    ) => {

      let totalHeight = 0;

      employees.forEach((employee) => {

        const {
          main,
          backup,
        } = getEmployeeParts(employee);

        // ----------------------------------------------
        // Main employee
        // ----------------------------------------------

        doc
          .font("Helvetica-Bold")
          .fontSize(employeeFontSize);

        totalHeight +=
          doc.heightOfString(
            main,
            {
              width:
                dayWidth -
                cellPadding * 2,

              lineGap: 0,
            },
          );

        // ----------------------------------------------
        // Backup employee
        // ----------------------------------------------

        if (backup) {

          doc
            .font("Helvetica")
            .fontSize(employeeFontSize);

          totalHeight +=
            doc.heightOfString(
              backup,
              {
                width:
                  dayWidth -
                  cellPadding * 2,

                lineGap: 0,
              },
            );
        }
      });

      return totalHeight;
    };

    // ==================================================
    // DRAW EMPLOYEES
    // ==================================================

    const drawEmployees = (
      employees: string[],
      x: number,
      y: number,
      availableHeight: number,
    ) => {

      if (employees.length === 0) {
        return;
      }

      const totalHeight =
        calculateEmployeeHeight(
          employees,
        );

      // Vertically center employees
      let textY =
        y +
        Math.max(
          cellPadding,
          (availableHeight -
            totalHeight) / 2,
        );

      employees.forEach((employee) => {

        const {
          main,
          backup,
        } = getEmployeeParts(employee);

        // ==================================================
        // MAIN EMPLOYEE — BOLD
        // ==================================================

        doc
          .font("Helvetica-Bold")
          .fontSize(employeeFontSize);

        const mainHeight =
          doc.heightOfString(
            main,
            {
              width:
                dayWidth -
                cellPadding * 2,

              lineGap: 0,
            },
          );

        doc.text(
          main,
          x + cellPadding,
          textY,
          {
            width:
              dayWidth -
              cellPadding * 2,

            align: "center",

            lineGap: 0,
          },
        );

        textY += mainHeight;

        // ==================================================
        // BACKUP EMPLOYEE — NORMAL
        // ==================================================

        if (backup) {

          doc
            .font("Helvetica")
            .fontSize(employeeFontSize);

          const backupHeight =
            doc.heightOfString(
              backup,
              {
                width:
                  dayWidth -
                  cellPadding * 2,

                lineGap: 0,
              },
            );

          doc.text(
            backup,
            x + cellPadding,
            textY,
            {
              width:
                dayWidth -
                cellPadding * 2,

              align: "center",

              lineGap: 0,
            },
          );

          textY += backupHeight;
        }
      });
    };

    // ==================================================
    // TITLE + FIRST HEADER
    // ==================================================

    drawTitle();

    /*
    * Title:
    *      First Week Planning
    *
    * Date:
    *      From: 1 August 2026 to 31 August 2026
    *
    * Therefore table starts below both.
    */

    let currentY = 62;

    drawHeader(currentY);

    currentY += headerHeight;

    // ==================================================
    // ROWS
    // ==================================================

    hours.forEach((hour) => {

      // ------------------------------------------------
      // Calculate required row height
      // ------------------------------------------------

      let requiredRowHeight =
        minimumRowHeight;

      weekDays.forEach((day) => {

        const employees =
          weekGrid[day]?.[hour] ?? [];

        if (employees.length === 0) {
          return;
        }

        // Calculate employee + backup height
        const textHeight =
          calculateEmployeeHeight(
            employees,
          );

        const cellHeight =
          textHeight +
          cellPadding * 2;

        if (
          cellHeight >
          requiredRowHeight
        ) {

          requiredRowHeight =
            cellHeight;
        }
      });

      // ------------------------------------------------
      // Make sure row doesn't go outside page
      // ------------------------------------------------

      if (
        currentY +
          requiredRowHeight >
        pageHeight - margin
      ) {

        // ==================================================
        // NEW PAGE
        // ==================================================

        doc.addPage();

        // Draw title and date again
        drawTitle();

        currentY = 62;

        drawHeader(currentY);

        currentY += headerHeight;
      }

      // ==================================================
      // DRAW HOUR CELL
      // ==================================================

      doc
        .font("Helvetica")
        .fontSize(hourFontSize);

      doc
        .rect(
          startX,
          currentY,
          hourWidth,
          requiredRowHeight,
        )
        .stroke();

      doc.text(
        hour,
        startX,
        currentY +
          (requiredRowHeight / 2) -
          5,
        {
          width: hourWidth,
          align: "center",
        },
      );

      // ==================================================
      // DRAW EMPLOYEE CELLS
      // ==================================================

      let x =
        startX + hourWidth;

      weekDays.forEach((day) => {

        // ------------------------------------------------
        // Cell border
        // ------------------------------------------------

        doc
          .rect(
            x,
            currentY,
            dayWidth,
            requiredRowHeight,
          )
          .stroke();

        // ------------------------------------------------
        // Employees
        // ------------------------------------------------

        const employees =
          weekGrid[day]?.[hour] ?? [];

        if (employees.length > 0) {

          drawEmployees(
            employees,
            x,
            currentY,
            requiredRowHeight,
          );
        }

        x += dayWidth;
      });

      // ------------------------------------------------
      // Move to next row
      // ------------------------------------------------

      currentY += requiredRowHeight;
    });

    // ==================================================
    // FINISH PDF
    // ==================================================

    doc.end();
  }
  
  private async buildDayPlanning(
    year: number,
    month: number,
    day: number,
  ): Promise<{
    dayGrid: Record<string, Record<string, string[]>>;
    dayName: string;
    date: Date;
    hours: string[];
  }> {

    // --------------------------------------------------
    // 1. Selected date
    // --------------------------------------------------

    const date = new Date(year, month - 1, day);

    date.setHours(0, 0, 0, 0);

    const startOfDay = new Date(date);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);


    // --------------------------------------------------
    // 2. Load planning for this day
    // --------------------------------------------------

    const planning = await this.planningModel
      .find({
        planDate: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      })
      .populate("empId")
      .populate("backupEmpId")
      .populate("shiftId")
      .lean();


    // --------------------------------------------------
    // 3. Day name
    // --------------------------------------------------

    const dayName = date.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "Africa/Algiers",
    });


    // --------------------------------------------------
    // 4. Hours
    // Same format as buildFirstWeekPlanning()
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
    // 5. Empty grid
    // --------------------------------------------------

    const dayGrid: Record<string, Record<string, string[]>> = {};

    dayGrid[dayName] = {};

    hours.forEach((hour) => {
      dayGrid[dayName][hour] = [];
    });


    // --------------------------------------------------
    // 6. Fill grid
    // --------------------------------------------------

    planning.forEach((item: any) => {

      if (!item.empId) {
        return;
      }

      let startTime: string;

      // Use task start time first
      if (item.tasks?.length) {

        startTime = item.tasks[0].startTime;

      } else if (item.shiftId) {

        // Otherwise use shift start time
        startTime = item.shiftId.startTime;

      } else {

        return;
      }


      // Example:
      // "06:00" -> "06H"
      // "14:00" -> "14H"

      const hour = `${startTime.substring(0, 2)}H`;


      // --------------------------------------------------
      // Employee
      // --------------------------------------------------

      const employee =
        `${item.empId.firstName} ${item.empId.lastName}` +
        (
          item.backupEmpId
            ? `\nBackup: ${item.backupEmpId.firstName} ${item.backupEmpId.lastName}`
            : `\nBackup: No backup`
        );


      // --------------------------------------------------
      // Add employee to grid
      // --------------------------------------------------

      if (dayGrid[dayName][hour]) {

        dayGrid[dayName][hour].push(employee);

      }

    });


    return {
      dayGrid,
      dayName,
      date,
      hours,
    };
  }
  //Export Day in Excel Format
  async exportCurrentDay(
    year: number,
    month: number,
    day: number,
  ): Promise<ExcelJS.Workbook> {

    const {
      dayGrid,
      dayName,
      hours,
    } = await this.buildDayPlanning(year, month, day);

    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet("Daily Planning");

    // --------------------------------------------------
    // Header
    // --------------------------------------------------

    sheet.addRow([
      "Hour",
      dayName,
    ]);

    // --------------------------------------------------
    // Rows
    // --------------------------------------------------

    hours.forEach((hour) => {

      const employees =
        dayGrid[dayName][hour]?.join("\n") ?? "";

      sheet.addRow([
        hour,
        employees,
      ]);
    });

    // --------------------------------------------------
    // Formatting
    // --------------------------------------------------

    sheet.columns = [
      { width: 15 },
      { width: 45 },
    ];

    sheet.eachRow((row, rowNumber) => {

      row.height = 45;

      row.eachCell((cell) => {

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

        // Header
        if (rowNumber === 1) {

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
  async exportCurrentDayPdf(
  year: number,
  month: number,
  day: number,
  res: Response,
  ): Promise<void> {

    const {
      dayGrid,
      dayName,
      hours,
    } = await this.buildDayPlanning(year, month, day);

    const PDFDocument = require("pdfkit");

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 20,
    });

    res.setHeader(
      "Content-Type",
      "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="DailyPlanning_${dayName}.pdf"`,
    );

    doc.pipe(res);

    // --------------------------------------------------
    // Layout
    // --------------------------------------------------

    const startX = 80;
    const startY = 70;

    const hourWidth = 80;
    const dayWidth = 650;

    const headerHeight = 45;

    // Minimum row height
    const minRowHeight = 45;

    // Height of one employee line
    const lineHeight = 14;

    // Padding inside the cell
    const verticalPadding = 16;

    // --------------------------------------------------
    // Title
    // --------------------------------------------------

    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .text(
        `Daily Planning - ${dayName}`,
        0,
        25,
        {
          align: "center",
        },
      );

    // --------------------------------------------------
    // Header
    // --------------------------------------------------

    doc
      .font("Helvetica-Bold")
      .fontSize(11);

    let x = startX;

    // Hour header
    doc
      .rect(
        x,
        startY,
        hourWidth,
        headerHeight,
      )
      .stroke();

    doc.text(
      "Hour",
      x,
      startY + 14,
      {
        width: hourWidth,
        align: "center",
      },
    );

    x += hourWidth;

    // Day header
    doc
      .rect(
        x,
        startY,
        dayWidth,
        headerHeight,
      )
      .stroke();

    doc.text(
      dayName,
      x,
      startY + 14,
      {
        width: dayWidth,
        align: "center",
      },
    );

    // --------------------------------------------------
    // Rows
    // --------------------------------------------------

    doc
      .font("Helvetica")
      .fontSize(10);

    let currentY = startY + headerHeight;

    hours.forEach((hour) => {

      // ------------------------------------------------
      // Employees
      // ------------------------------------------------

      const employees =
        dayGrid[dayName]?.[hour]?.join("\n") ?? "";

      // ------------------------------------------------
      // Calculate number of lines
      // ------------------------------------------------

      const lineCount = employees
        ? employees.split("\n").length
        : 1;

      // ------------------------------------------------
      // Calculate dynamic row height
      // ------------------------------------------------

      const rowHeight = Math.max(
        minRowHeight,
        lineCount * lineHeight + verticalPadding,
      );

      // ------------------------------------------------
      // Check if row fits on current page
      // ------------------------------------------------

      if (
        currentY + rowHeight >
        doc.page.height - 30
      ) {

        doc.addPage();

        currentY = 40;
      }

      // ------------------------------------------------
      // Hour column
      // ------------------------------------------------

      doc
        .rect(
          startX,
          currentY,
          hourWidth,
          rowHeight,
        )
        .stroke();

      doc.text(
        hour,
        startX,
        currentY + rowHeight / 2 - 6,
        {
          width: hourWidth,
          align: "center",
        },
      );

      // ------------------------------------------------
      // Employees column
      // ------------------------------------------------

      const employeeX =
        startX + hourWidth;

      doc
        .rect(
          employeeX,
          currentY,
          dayWidth,
          rowHeight,
        )
        .stroke();

      if (employees) {

        doc.text(
          employees,
          employeeX + 5,
          currentY + 8,
          {
            width: dayWidth - 10,
            align: "center",
            lineGap: 2,
          },
        );

      }

      // ------------------------------------------------
      // Move to next row
      // ------------------------------------------------

      currentY += rowHeight;
    });

    // --------------------------------------------------
    // Finish PDF
    // --------------------------------------------------

    doc.end();
  }
  
    async findOne(id: string): Promise<PlanningDocument | null> {
      return this.planningModel
        .findById(id)
        .populate('shiftId')
        .populate('empId')
        .populate('backupEmpId')
        .exec();
    }

    async update(id: string, data: Partial<Planning>): Promise<PlanningDocument | null> {
      return this.planningModel.findByIdAndUpdate(id, data, { new: true }).exec();
    }

    async remove(id: string): Promise<PlanningDocument | null> {
      return this.planningModel.findByIdAndDelete(id).exec();
    }

    async copyMonth(
      sourceMonth: string,
      destinationMonth: string,
    ) {
      const [sourceYear, sourceMonthNumber] =
        sourceMonth.split("-").map(Number);

      const [destinationYear, destinationMonthNumber] =
        destinationMonth.split("-").map(Number);

      // ==================================================
      // SOURCE MONTH RANGE
      // ==================================================

      const sourceStart = new Date(
        Date.UTC(
          sourceYear,
          sourceMonthNumber - 1,
          1,
          0,
          0,
          0,
          0,
        ),
      );

      const sourceEnd = new Date(
        Date.UTC(
          sourceYear,
          sourceMonthNumber,
          0,
          23,
          59,
          59,
          999,
        ),
      );

      // ==================================================
      // GET SOURCE PLANNING
      // ==================================================

      const sourcePlanning = await this.planningModel
        .find({
          planDate: {
            $gte: sourceStart,
            $lte: sourceEnd,
          },
        })
        .lean();

      if (sourcePlanning.length === 0) {
        return {
          message: "No planning found in the source month.",
          copied: 0,
          sourceMonth,
          destinationMonth,
        };
      }

      // ==================================================
      // DESTINATION MONTH RANGE
      // ==================================================

      const destinationStart = new Date(
        Date.UTC(
          destinationYear,
          destinationMonthNumber - 1,
          1,
          0,
          0,
          0,
          0,
        ),
      );

      const destinationEnd = new Date(
        Date.UTC(
          destinationYear,
          destinationMonthNumber,
          0,
          23,
          59,
          59,
          999,
        ),
      );

      // ==================================================
      // REMOVE EXISTING DESTINATION PLANNING
      // ==================================================

      await this.planningModel.deleteMany({
        planDate: {
          $gte: destinationStart,
          $lte: destinationEnd,
        },
      });

      // ==================================================
      // GROUP SOURCE PLANNING BY EXACT DATE
      // ==================================================

      const planningByDate = new Map<
        string,
        any[]
      >();

      for (const record of sourcePlanning) {
        const sourceDate = new Date(record.planDate);

        /*
          planDate is stored in MongoDB as UTC midnight.

          Example:

          2026-08-29T00:00:00.000Z

          toISOString() therefore gives:

          2026-08-29T00:00:00.000Z

          and the date remains:

          2026-08-29
        */

        const dateKey = sourceDate
          .toISOString()
          .split("T")[0];

        if (!planningByDate.has(dateKey)) {
          planningByDate.set(dateKey, []);
        }

        planningByDate
          .get(dateKey)!
          .push(record);
      }

      // ==================================================
      // KEEP ONE SOURCE OCCURRENCE PER WEEKDAY
      // ==================================================

      /*
        JavaScript weekday values:

        0 = Sunday
        1 = Monday
        2 = Tuesday
        3 = Wednesday
        4 = Thursday
        5 = Friday
        6 = Saturday
      */

      const planningByWeekday: (any[] | null)[] =
        new Array(7).fill(null);

      for (const [dateKey, records] of planningByDate) {
        const [year, month, day] =
          dateKey.split("-").map(Number);

        /*
          Re-create the calendar date at UTC midnight.

          Example:

          2026-08-29
              ↓
          2026-08-29T00:00:00.000Z
              ↓
          getUTCDay()
              ↓
          6 = Saturday
        */

        const sourceDate = new Date(
          Date.UTC(
            year,
            month - 1,
            day,
          ),
        );

        const weekday =
          sourceDate.getUTCDay();

        /*
          Keep only the FIRST occurrence of each weekday.

          Example:

          August:
            Saturday 1  → keep
            Saturday 8  → ignore
            Saturday 15 → ignore
            Saturday 22 → ignore
            Saturday 29 → ignore

          The planning from the first Saturday
          will be used for every Saturday in
          the destination month.
        */

        if (planningByWeekday[weekday] === null) {
          planningByWeekday[weekday] = records;
        }
      }

      // ==================================================
      // NUMBER OF DAYS IN DESTINATION MONTH
      // ==================================================

      const lastDayOfDestinationMonth =
        new Date(
          Date.UTC(
            destinationYear,
            destinationMonthNumber,
            0,
          ),
        ).getUTCDate();

      // ==================================================
      // CREATE DESTINATION PLANNING
      // ==================================================

      const copiedPlanning: any[] = [];

      for (
        let day = 1;
        day <= lastDayOfDestinationMonth;
        day++
      ) {
        /*
          IMPORTANT:

          Always create destination dates with UTC.

          Do NOT use:

            new Date(year, month, day)

          because that creates a LOCAL timezone date.

          Instead use:

            Date.UTC(year, month, day)
        */

        const destinationDate = new Date(
          Date.UTC(
            destinationYear,
            destinationMonthNumber - 1,
            day,
            0,
            0,
            0,
            0,
          ),
        );

        /*
          Determine weekday from the UTC calendar date.

          Example:

          September 5, 2026
              ↓
          getUTCDay()
              ↓
          6 = Saturday
        */

        const weekday =
          destinationDate.getUTCDay();

        const weekdayPlanning =
          planningByWeekday[weekday];

        /*
          If the source month has no planning
          for this weekday, don't create anything.
        */

        if (!weekdayPlanning) {
          continue;
        }

        // ==================================================
        // COPY EACH PLANNING RECORD
        // ==================================================

        for (const record of weekdayPlanning) {
          copiedPlanning.push({
            shiftId: record.shiftId,

            empId: record.empId,

            backupEmpId:
              record.backupEmpId ?? null,

            taskId: record.taskId,

            /*
              Destination date is stored at UTC midnight.
            */

            planDate: destinationDate,

            tasks:
              record.tasks ?? [],

            customStartTime:
              record.customStartTime ??
              undefined,

            customEndTime:
              record.customEndTime ??
              undefined,
          });
        }
      }

      // ==================================================
      // SAVE NEW PLANNING
      // ==================================================

      if (copiedPlanning.length > 0) {
        await this.planningModel.insertMany(
          copiedPlanning,
        );
      }

      // ==================================================
      // RESULT
      // ==================================================

      return {
        message:
          "Planning copied successfully.",

        copied:
          copiedPlanning.length,

        sourceMonth,

        destinationMonth,
      };
    }
}