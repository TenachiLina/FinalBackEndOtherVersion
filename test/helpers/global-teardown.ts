import type { MongoMemoryServer } from 'mongodb-memory-server';

export default async function globalTeardown() {
  await (
    (globalThis as any).__MONGO__ as MongoMemoryServer | undefined
  )?.stop();
}
