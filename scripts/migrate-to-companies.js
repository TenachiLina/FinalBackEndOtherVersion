// One-time migration from the single-company version to multi-company.
//
// Moves all existing data (employees, planning, shifts, ...) and all existing
// admin/manager users into one company, registers the ZKTeco serial from
// ZKTECO_DEVICE_SERIAL on that company, and replaces the old global unique
// indexes with per-company ones. Safe to run more than once.
//
// Usage (reads MONGODB_URI from .env), BEFORE starting the new backend:
//   npm run migrate:companies -- "Company name"

const dns = require('dns');
const mongoose = require('mongoose');

dns.setServers(['1.1.1.1', '8.8.8.8']);

// Collections whose documents belong to a company (see tenancy/tenant.plugin.ts).
const TENANT_COLLECTIONS = [
  'employees',
  'shifts',
  'tasks',
  'planning',
  'worktime',
  'advances',
  'bonus',
  'rawattendancelogs',
  'zkteco_attendance_events',
];

// Old global unique indexes that must become per-company.
const OLD_UNIQUE_INDEXES = {
  employees: 'empNumber_1',
  tasks: 'taskId_1',
  rawattendancelogs: 'deviceLogId_1',
};

const FEATURES = [
  'planning',
  'clockin',
  'faceRecognition',
  'reporting',
  'advances',
  'bonuses',
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (check your .env file)');
  const companyName = (process.argv[2] || '').trim();
  if (!companyName) {
    throw new Error(
      'Give the company name: npm run migrate:companies -- "Name"',
    );
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const existing = new Set(
    (await db.listCollections().toArray()).map((c) => c.name),
  );
  console.log(`Database "${db.databaseName}"`);

  // 1. The company that receives the existing data
  const companies = db.collection('companies');
  let company = await companies.findOne({ name: companyName });
  if (!company) {
    const serial = process.env.ZKTECO_DEVICE_SERIAL?.trim();
    const now = new Date();
    const doc = {
      name: companyName,
      active: true,
      features: FEATURES,
      settings: {
        currency: 'DA',
        utcOffset: process.env.ZKTECO_UTC_OFFSET || '+01:00',
        hoursPerDay: 8,
        workingDaysPerMonth: 26,
        weeklyAdvanceRatio: 0.5,
      },
      devices: serial ? [{ serial, name: 'ZKTeco' }] : [],
      createdAt: now,
      updatedAt: now,
    };
    const res = await companies.insertOne(doc);
    company = { ...doc, _id: res.insertedId };
    console.log(
      `Created company "${companyName}" (${company._id})` +
        (serial ? ` with device ${serial}` : ' (no ZKTECO_DEVICE_SERIAL set)'),
    );
  } else {
    console.log(`Using existing company "${companyName}" (${company._id})`);
  }
  const companyId = company._id;

  // 2. Drop old global unique indexes so two companies can reuse the same numbers
  for (const [name, index] of Object.entries(OLD_UNIQUE_INDEXES)) {
    if (!existing.has(name)) continue;
    const indexes = await db.collection(name).indexes();
    if (indexes.some((i) => i.name === index)) {
      await db.collection(name).dropIndex(index);
      console.log(`Dropped old index ${name}.${index}`);
    }
  }

  // 3. Tag all existing data with the company
  for (const name of TENANT_COLLECTIONS) {
    if (!existing.has(name)) continue;
    const res = await db
      .collection(name)
      .updateMany({ companyId: { $exists: false } }, { $set: { companyId } });
    console.log(`${name}: ${res.modifiedCount} records moved into the company`);
  }

  // 4. Existing company users join the company
  const users = await db.collection('users').updateMany(
    {
      role: { $in: ['admin', 'manager'] },
      $or: [{ companyId: { $exists: false } }, { companyId: null }],
    },
    { $set: { companyId } },
  );
  console.log(
    `users: ${users.modifiedCount} admins/managers moved into the company`,
  );

  console.log(
    'Done. Start the backend so it creates the new per-company indexes.',
  );
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
