import { inflateSync } from 'zlib';
import * as ExcelJS from 'exceljs';
import type { Test } from 'supertest';

/** Sends the request and keeps the answer as raw bytes (Excel, PDF). */
export function download(req: Test) {
  return req.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });
}

/** An Excel sheet as rows of plain cell texts. */
export async function excelRows(file: Buffer, sheet = 1): Promise<string[][]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file as any);
  const rows: string[][] = [];
  book.worksheets[sheet - 1].eachRow((row) => {
    rows.push(
      // The exports only write text and numbers
      (row.values as (string | number | null | undefined)[])
        .slice(1)
        .map((v) => (v == null ? '' : String(v))),
    );
  });
  return rows;
}

/**
 * The text drawn in a PDF made by pdfkit, one string per text operation.
 * pdfkit writes text as hex strings in (usually compressed) content streams.
 */
export function pdfText(file: Buffer): string[] {
  const raw = file.toString('latin1');
  const texts: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      content = m[1];
    }
    for (const op of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      texts.push(
        [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)]
          .map((h) => Buffer.from(h[1], 'hex').toString('latin1'))
          .join(''),
      );
    }
  }
  return texts;
}

/** Number of pages in a PDF. */
export const pdfPages = (file: Buffer) =>
  (file.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
