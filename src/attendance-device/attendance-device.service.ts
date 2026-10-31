// src/attendance-device/attendance-device.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ZKLib from 'node-zklib';
import { currentCompanyId } from '../tenancy/tenant-context';

@Injectable()
export class AttendanceDeviceService {
  private readonly logger = new Logger(AttendanceDeviceService.name);
  private zkInstance: any;

  // DEVICE_IP is one company's machine and DEVICE_COMPANY_ID says which one:
  // no other company may reach it, and with no owner set, nobody can.
  private machineIp() {
    const owner = process.env.DEVICE_COMPANY_ID;
    return owner && currentCompanyId() === owner
      ? process.env.DEVICE_IP
      : undefined;
  }

 async connect() {
  const ip = this.machineIp();
  if (!ip) {
    throw new BadRequestException(
      'No clocking machine is set up for this company',
    );
  }

  this.zkInstance = new ZKLib(
    ip,
    4370,
    10000,
    4000,
  );

  try {
    await this.zkInstance.createSocket();

    this.setConnectionState(true);

    return true;
  } catch (err) {
    // Don't print connection failures every time we check status
    this.setConnectionState(false);

    // Still throw so the caller knows the connection failed
    throw err;
  }
}

  async disconnect() {
    if (this.zkInstance) await this.zkInstance.disconnect();
  }

  //Pulls the users' list exists in the device 
  async getDeviceUsers() {
  await this.connect();
  const users = await this.zkInstance.getUsers();
  await this.disconnect();
  return users.data; // array of { uid, userId, name, ... }
  }


  async getDeviceStatus() {
  const ip = this.machineIp();

  try {
    await this.connect();
    await this.disconnect();

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
  await this.connect();
  const logs = await this.zkInstance.getAttendances();
  await this.disconnect();
  return logs.data; // array of { userId, timestamp, ... }
  }
}