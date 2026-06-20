import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dns from 'dns';

dns.setServers(['1.1.1.1', '8.8.8.8']);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
 app.enableCors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
 });

  await app.listen(3001);
  console.log('Backend running on http://localhost:3001');
}
bootstrap();