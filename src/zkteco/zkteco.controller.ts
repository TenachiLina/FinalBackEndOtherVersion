import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZktecoService } from './zkteco.service';

@Controller('iclock')
export class ZktecoController {
  private readonly logger = new Logger(ZktecoController.name);

  constructor(private readonly zktecoService: ZktecoService) {}

  private authorize(serial: string | undefined, res: Response): boolean {
    const expectedSerial = process.env.ZKTECO_DEVICE_SERIAL?.trim();

    // Fail closed if the expected serial has not been configured.
    if (!expectedSerial || !serial || serial !== expectedSerial) {
      this.logger.warn(
        `Rejected ADMS request; SN=${serial || 'missing'}; serial configured=${Boolean(expectedSerial)}`,
      );
      res.status(HttpStatus.FORBIDDEN).type('text/plain').send('ERROR');
      return false;
    }
    return true;
  }

  @Get(['cdata', 'cdata.aspx'])
  registration(
    @Query('SN') serial: string | undefined,
    @Res() res: Response,
  ): void {
    if (!this.authorize(serial, res)) return;

    this.logger.log(`ADMS registration request from ${serial}`);
    // Standard-style ADMS options response. Confirm against the real device's
    // request/firmware logs before relying on every option in production.
    const body = [
      `GET OPTION FROM: ${serial}`,
      'ATTLOGStamp=None',
      'OPERLOGStamp=None',
      'ATTPHOTOStamp=None',
      'ErrorDelay=30',
      'Delay=10',
      'TransInterval=1',
      'TransFlag=TransData AttLog OpLog EnrollUser',
      'Realtime=1',
      'Encrypt=None',
      '',
    ].join('\r\n');

    res.status(200).type('text/plain').send(body);
  }

  @Post(['cdata', 'cdata.aspx'])
  async receiveData(
    @Query('SN') serial: string | undefined,
    @Query('table') table: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.authorize(serial, res)) return;

    const body = req.body;
    if (typeof body !== 'string') {
      this.logger.warn(
        `ADMS request body was not parsed as text; SN=${serial}, table=${table}, content-type=${req.headers['content-type']}`,
      );
      res.status(415).type('text/plain').send('ERROR');
      return;
    }

    this.logger.log(
      `ADMS upload SN=${serial}, table=${table || 'missing'}, bytes=${Buffer.byteLength(body)}`,
    );

    if (table === 'ATTLOG') {
      try {
        const result = await this.zktecoService.saveAttlog(serial!, body);
        if (result.rejected > 0) {
          // Do not acknowledge a partially malformed upload: the device may retry.
          // Successfully inserted rows remain safe because eventKey is unique.
          res.status(500).type('text/plain').send('ERROR');
          return;
        }
        res.status(200).type('text/plain').send('OK');
      } catch (error: unknown) {
        this.logger.error(
          `Failed to persist ATTLOG from ${serial}`,
          error instanceof Error ? error.stack : String(error),
        );
        res.status(500).type('text/plain').send('ERROR');
      }
      return;
    }

    // The current scope is attendance only. Log other tables and acknowledge
    // them so unrelated device tables are not accidentally stored as attendance.
    this.logger.warn(`Ignoring unsupported ADMS table ${table || '(missing)'}`);
    res.status(200).type('text/plain').send('OK');
  }

  @Get(['getrequest', 'getrequest.aspx'])
  pollCommands(
    @Query('SN') serial: string | undefined,
    @Res() res: Response,
  ): void {
    if (!this.authorize(serial, res)) return;
    res.status(200).type('text/plain').send('OK');
  }

  @Get(['ping', 'ping.aspx'])
  ping(
    @Query('SN') serial: string | undefined,
    @Res() res: Response,
  ): void {
    if (!this.authorize(serial, res)) return;
    res.status(200).type('text/plain').send('OK');
  }
}
