// src/attendance-device/attendance-device.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ZKLib from 'node-zklib';
import { CompaniesService } from '../companies/companies.service';
import { currentCompanyId } from '../tenancy/tenant-context';

@Injectable()
export class AttendanceDeviceService {
  private readonly logger = new Logger(AttendanceDeviceService.name);

  constructor(private readonly companiesService: CompaniesService) {}

  // The current company's machine: the address saved on the company, or
  // DEVICE_IP for the one company named by DEVICE_COMPANY_ID, until its address
  // is saved too. No other company may reach it; with neither, nobody can.
  private async machineIp() {
    const companyId = currentCompanyId();
    if (!companyId) return undefined;
    const company = await this.companiesService.findById(companyId);
    const own = company?.devices?.find((device) => device.ip)?.ip;
    if (own) return own;
    return companyId === process.env.DEVICE_COMPANY_ID
      ? process.env.DEVICE_IP
      : undefined;
  }

  // Each caller keeps its own connection: on a field shared by all requests,
  // two companies syncing at once would read each other's machine.
 async connect() {
  const ip = await this.machineIp();
  if (!ip) {
    throw new BadRequestException(
      'No clocking machine is set up for this company',
    );
  }

  const zkInstance = new ZKLib(
    ip,
    4370,
    10000,
    4000,
  );

  try {
    await zkInstance.createSocket();

    this.setConnectionState(true);

    return zkInstance;
  } catch (err) {
    // Don't print connection failures every time we check status
    this.setConnectionState(false);

    // Still throw so the caller knows the connection failed
    throw err;
  }
}

  async disconnect(zkInstance: any) {
    await zkInstance.disconnect();
  }

  //Pulls the users' list exists in the device
  async getDeviceUsers() {
  const zkInstance = await this.connect();
  const users = await zkInstance.getUsers();
  await this.disconnect(zkInstance);
  return users.data; // array of { uid, userId, name, ... }
  }


  async getDeviceStatus() {
  const ip = await this.machineIp();

  try {
    await this.disconnect(await this.connect());

    return {
      connected: true,
      name: 'Face Recognition Machine',
      ip,
    };
  } catch (err) {
    return {
      connected: false,
      name: 'Face Recognition Machine',
      ip,
    };
  }
}private deviceConnected = false;

private setConnectionState(connected: boolean) {
  if (this.deviceConnected === connected) {
    return;
  }

  this.deviceConnected = connected;

  if (connected) {
    this.logger.log('Attendance machine connected');
  } else {
    this.logger.warn('Attendance machine disconnected');
  }
}
  //Attendance logs.
  async getAttendanceLogs() {
  const zkInstance = await this.connect();
  const logs = await zkInstance.getAttendances();
  await this.disconnect(zkInstance);
  return logs.data; // array of { userId, timestamp, ... }
  }
}
