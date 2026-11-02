import mongoose, { Schema, Types, type Connection, type Model } from 'mongoose';
import { tenantPlugin, TenantContextError } from '../src/tenancy/tenant.plugin';
import {
  runAsSystem as system,
  runForCompany as forCompany,
} from '../src/tenancy/tenant-context';

// The tenant plugin on its own, against a real MongoDB: every read, write and
// delete stays inside the current company, and nothing runs without one.

let conn: Connection;
let Item: Model<any>;
const A = String(new Types.ObjectId());
const B = String(new Types.ObjectId());

beforeAll(async () => {
  conn = await mongoose
    .createConnection(
      `${process.env.MONGO_TEST_URI!.replace(/\/?$/, '/')}tenancy_${Date.now()}`,
    )
    .asPromise();
  const schema = new Schema({ name: String, n: Number });
  schema.plugin(tenantPlugin);
  Item = conn.model('Item', schema);
  await Item.init();
});

afterAll(async () => {
  await conn.dropDatabase();
  await conn.close();
});

beforeEach(async () => {
  await runAsSystem(() => Item.deleteMany({}));
  await runForCompany(A, () =>
    Item.create([
      { name: 'a1', n: 1 },
      { name: 'a2', n: 2 },
    ]),
  );
  await runForCompany(B, () => Item.create({ name: 'b1', n: 1 }));
});

// Queries run when awaited, so the await must happen inside the context
const runForCompany = <T>(id: string, fn: () => PromiseLike<T>) =>
  forCompany(id, async () => await fn());
const runAsSystem = <T>(fn: () => PromiseLike<T>) =>
  system(async () => await fn());

const names = (docs: any[]) => docs.map((d) => d.name).sort();
const inA = <T>(fn: () => PromiseLike<T>) => runForCompany(A, fn);

describe('creating', () => {
  it('stamps the current company on new records', async () => {
    const doc = await inA(() => Item.create({ name: 'new' }));
    expect(String(doc.companyId)).toBe(A);
  });

  it('ignores a companyId sent in the data', async () => {
    const doc = await inA(() => Item.create({ name: 'sneaky', companyId: B }));
    expect(String(doc.companyId)).toBe(A);
  });

  it('stamps every record of an insertMany', async () => {
    const docs = await inA(() =>
      Item.insertMany([{ name: 'x', companyId: B }, { name: 'y' }]),
    );
    expect(docs.map((d) => String(d.companyId))).toEqual([A, A]);
  });

  it('refuses to save a record of another company', async () => {
    const theirs = await runForCompany(B, () => Item.findOne({ name: 'b1' }));
    theirs!.name = 'changed';
    await expect(inA(() => theirs!.save())).rejects.toBeInstanceOf(
      TenantContextError,
    );
  });

  it('saves changes to its own records', async () => {
    const mine = await inA(() => Item.findOne({ name: 'a1' }));
    mine!.name = 'a1 renamed';
    await inA(() => mine!.save());
    expect(names(await inA(() => Item.find()))).toEqual(['a1 renamed', 'a2']);
  });
});

describe('reading', () => {
  it("sees only the current company's records", async () => {
    expect(names(await inA(() => Item.find()))).toEqual(['a1', 'a2']);
    expect(await inA(() => Item.countDocuments())).toBe(2);
    expect(await inA(() => Item.distinct('name'))).toEqual(['a1', 'a2']);
  });

  it("can't find another company's record, even by its id", async () => {
    const theirs = await runForCompany(B, () => Item.findOne());
    expect(await inA(() => Item.findById(theirs!._id))).toBeNull();
  });

  it('filters aggregations too', async () => {
    const out = await inA(() =>
      Item.aggregate([{ $group: { _id: null, total: { $sum: '$n' } } }]),
    );
    expect(out[0].total).toBe(3);
  });

  it('refuses estimatedDocumentCount, which cannot be filtered', async () => {
    await expect(inA(() => Item.estimatedDocumentCount())).rejects.toThrow(
      /countDocuments/,
    );
    expect(await runAsSystem(() => Item.estimatedDocumentCount())).toBe(3);
  });
});

describe('changing and deleting', () => {
  it("doesn't touch another company's records", async () => {
    await inA(() => Item.updateMany({}, { $set: { n: 9 } }));
    await inA(() => Item.deleteMany({ n: 9 }));
    expect(names(await runAsSystem(() => Item.find()))).toEqual(['b1']);
  });

  it('never moves a record to another company', async () => {
    await inA(() => Item.updateOne({ name: 'a1' }, { companyId: B }));
    await inA(() => Item.updateOne({ name: 'a1' }, { $set: { companyId: B } }));
    await inA(() =>
      Item.findOneAndUpdate({ name: 'a1' }, { $setOnInsert: { companyId: B } }),
    );
    await inA(() =>
      Item.updateOne({ name: 'a1' }, { $unset: { companyId: 1 } }),
    );
    const doc = await runAsSystem(() => Item.findOne({ name: 'a1' }));
    expect(String(doc!.companyId)).toBe(A);
  });

  it("can't delete another company's record by id", async () => {
    const theirs = await runForCompany(B, () => Item.findOne());
    expect(await inA(() => Item.findByIdAndDelete(theirs!._id))).toBeNull();
    expect(await runAsSystem(() => Item.countDocuments())).toBe(3);
  });
});

describe('without a company', () => {
  it('refuses every kind of access', async () => {
    await expect(Item.find()).rejects.toBeInstanceOf(TenantContextError);
    // Stopped even earlier, by validation: companyId is required
    await expect(Item.create({ name: 'x' })).rejects.toThrow(/companyId/);
    await expect(Item.insertMany([{ name: 'x' }])).rejects.toBeInstanceOf(
      TenantContextError,
    );
    await expect(Item.aggregate([])).rejects.toBeInstanceOf(TenantContextError);
    await expect(Item.deleteMany({})).rejects.toThrow(
      'Refusing to access "Item" without a company context',
    );
  });

  it('lets trusted code save a record with the company it is given', async () => {
    const saved: any = await runAsSystem(() =>
      new Item({ name: 'sys', companyId: B }).save(),
    );
    expect(String(saved.companyId)).toBe(B);
    expect(names(await runForCompany(B, () => Item.find()))).toEqual([
      'b1',
      'sys',
    ]);
  });

  it('lets trusted code see everything', async () => {
    expect(names(await runAsSystem(() => Item.find()))).toEqual([
      'a1',
      'a2',
      'b1',
    ]);
  });
});
