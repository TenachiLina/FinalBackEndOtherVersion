import { MongoMemoryServer } from 'mongodb-memory-server';

// One MongoDB for the whole run; every test file gets its own database in it
// (see createTestApp). Workers inherit the address through the environment.
export default async function globalSetup() {
  const mongo = await MongoMemoryServer.create();
  (globalThis as any).__MONGO__ = mongo;
  process.env.MONGO_TEST_URI = mongo.getUri();
}
