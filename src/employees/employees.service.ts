import { Injectable } from '@nestjs/common';
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

 async findOne(id: string): Promise<EmployeeDocument | null> {
  return this.employeeModel.findById(id).exec();
}

async update(id: string, data: Partial<Employee>): Promise<EmployeeDocument | null> {
  return this.employeeModel.findByIdAndUpdate(id, data, { new: true }).exec();
}

async remove(id: string): Promise<EmployeeDocument | null> {
  return this.employeeModel.findByIdAndDelete(id).exec();
}

}