// One-time cleanup of duplicate work time records (same company, employee,
// shift and day). Payroll paid those days twice, and the unique index the
// backend now creates can't be built while they exist.
//
// In each group it keeps the most complete record: one with a clock-out, then
// one with a clock-in, then the newest. Removed records are copied to
// worktime_duplicates_backup first. Without --apply it only lists what it would
// do: read that list, because penalties and consumption on a removed record
// aren't added to the record that stays. Safe to run more than once.
//
// Usage (reads MONGODB_URI from .env), BEFORE starting the new backend:
//   npm run dedupe:worktime             list the duplicates, change nothing
//   npm run dedupe:worktime -- --apply  remove them

const dns = require('dns');
const mongoose = require('mongoose');

dns.setServers(['1.1.1.1', '8.8.8.8']);

const hasTime = (t) => !!t && t !== '00:00';

// Best record first
function rank(a, b) {
  return (
    hasTime(b.clock_out) - hasTime(a.clock_out) ||
    hasTime(b.clock_in) - hasTime(a.clock_in) ||
    String(b._id).localeCompare(String(a._id))
  );
}

function describe(r) {
  return (
    `${r.clock_in ?? '-'}-${r.clock_out ?? '-'}` +
    ` penalty ${r.penalty ?? 0}, consumption ${r.consomation ?? 0}, absent ${!!r.absent}`
  );
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (check your .env file)');
  const apply = process.argv.includes('--apply');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`Database "${db.databaseName}"${apply ? '' : ' (nothing is changed)'}`);

  const worktime = db.collection('worktime');
  const groups = await worktime
    .aggregate(
      [
        { $match: { work_date: { $type: 'date' } } },
        {
          $group: {
            _id: {
              companyId: '$companyId',
              emp_id: '$emp_id',
              shift_id: { $ifNull: ['$shift_id', null] },
              work_date: '$work_date',
            },
            docs: { $push: '$$ROOT' },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  let removed = 0;
  for (const group of groups) {
    const [keep, ...extra] = group.docs.sort(rank);
    const { emp_id, work_date } = group._id;
    console.log(
      `Employee ${emp_id}, ${work_date.toISOString().slice(0, 10)}, shift ${group._id.shift_id ?? '-'}:`,
    );
    console.log(`  keep   ${keep._id} ${describe(keep)}`);
    for (const r of extra) console.log(`  remove ${r._id} ${describe(r)}`);

    if (apply) {
      await db.collection('worktime_duplicates_backup').bulkWrite(
        extra.map((r) => ({
          replaceOne: { filter: { _id: r._id }, replacement: r, upsert: true },
        })),
      );
      await worktime.deleteMany({ _id: { $in: extra.map((r) => r._id) } });
    }
    removed += extra.length;
  }

  console.log(
    `${groups.length} duplicated days, ${removed} records ${apply ? 'removed' : 'to remove'}.`,
  );
  if (!apply && removed) console.log('Run again with --apply to remove them.');
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
