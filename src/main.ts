import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dns from 'dns';

dns.setServers(['1.1.1.1', '8.8.8.8']);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allowed frontend origins: local dev + any URLs from the FRONTEND_URL env var
  // (comma-separated, no trailing slashes)
  const allowedOrigins = [
    'http://localhost:3000',
    ...(process.env.FRONTEND_URL?.split(',').map((u) => u.trim()) ?? []),
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Render provides the port via process.env.PORT; 0.0.0.0 lets it detect the open port
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on port ${port}`);
}
bootstrap();