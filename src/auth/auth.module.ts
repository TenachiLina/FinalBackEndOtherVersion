import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { LoginSession, LoginSessionSchema } from './login-session.schema';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { JWT_AUDIENCE, JWT_ISSUER } from './security.config';
import { isProduction } from '../common/security';

// The secret that used to be committed in .env.example.
const KNOWN_PUBLIC_SECRETS = new Set([
  '390e28b2b76799d433bb9f9636585d7cf0d34ebb65a066d1aaabb607840a40bb4875838002aef81585444f7b4da6d844',
]);
import { Employee, EmployeeSchema } from '../employees/employee.shema';
import { UsersService } from './users.service';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import {
  BrandingController,
  CompaniesController,
  OwnCompanyController,
} from './companies.controller';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [
    CompaniesModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: LoginSession.name, schema: LoginSessionSchema },
      { name: Employee.name, schema: EmployeeSchema },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32) {
          throw new Error(
            'JWT_SECRET must be set to a random string of at least 32 characters',
          );
        }
        // Refuse secrets that were ever published (they are in git history):
        // anyone who has one could sign their own admin tokens.
        if (KNOWN_PUBLIC_SECRETS.has(secret) || /change[-_]?me/i.test(secret)) {
          const problem =
            'JWT_SECRET is a published example value. Generate a new one (see .env.example).';
          if (isProduction()) throw new Error(problem);
          new Logger('Auth').warn(problem);
        }
        // Only HS256, and only tokens made by this API for this app, are
        // accepted (blocks "alg: none" and tokens signed for something else).
        // Each token's lifetime is set when it is signed (see SessionsService).
        return {
          secret,
          signOptions: {
            algorithm: 'HS256',
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
          },
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
          },
        };
      },
    }),
  ],
  controllers: [
    AuthController,
    UsersController,
    CompaniesController,
    OwnCompanyController,
    BrandingController,
    SessionsController,
  ],
  providers: [
    UsersService,
    AuthService,
    SessionsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
