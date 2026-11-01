import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument } from './employee.shema';

@Injectable()
export class EmployeesService {
  constructor(@InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>) {}

  async create(data: Partial<Employee>): Promise<EmployeeDocument> {
    return this.employeeModel.create(data);
  }

  async findAll(): Promise<EmployeeDocument[]> {
    return this.employeeModel.find().exec();
  }

  async findOne(id: string): Promise<EmployeeDocument> {
    const employee = await this.employeeModel.findById(id).exec();
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async update(id: string, data: Partial<Employee>): Promise<EmployeeDocument> {
    const employee = await this.employeeModel
      .findByIdAndUpdate(id, data, { new: true, runValidators: true })
      .exec();
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async remove(id: string): Promise<EmployeeDocument> {
    const employee = await this.employeeModel.findByIdAndDelete(id).exec();
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }
}