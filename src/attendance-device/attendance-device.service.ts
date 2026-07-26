// src/attendance-device/attendance-device.service.ts
import { Injectable, Logger } from '@nestjs/common';
import ZKLib from 'node-zklib';

@Injectable()
export class AttendanceDeviceService {
  private readonly logger = new Logger(AttendanceDeviceService.name);
  private zkInstance: any;

  async connect() {
    this.zkInstance = new ZKLib(process.env.DEVICE_IP, 4370, 10000, 4000);
    try {
      await this.zkInstance.createSocket();
      this.logger.log('Connected to device');
    } catch (err) {
      this.logger.error('Connection failed', err);
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

  //Attendance logs.
  async getAttendanceLogs() {
  await this.connect();
  const logs = await this.zkInstance.getAttendances();
  await this.disconnect();
  return logs.data; // array of { userId, timestamp, ... }
  }
}