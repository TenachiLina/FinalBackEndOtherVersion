import { Schema, Types } from 'mongoose';
import { currentCompanyId, isSystemContext } from './tenant-context';

const QUERY_HOOKS = [
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
] as const;

export class TenantContextError extends Error {
  constructor(model: string) {
    super(`Refusing to access "${model}" without a company context`);
  }
}

function requireCompany(model: string): string | null {
  if (isSystemContext()) return null;
  const companyId = currentCompanyId();
  if (!companyId) throw new TenantContextError(model);
  return companyId;
}

function stripCompanyFromUpdate(update: any) {
  if (!update || typeof update !== 'object') return;
  delete update.companyId;
  for (const op of ['$set', '$setOnInsert', '$unset', '$rename']) {
    if (update[op]) delete update[op].companyId;
  }
}

/**
 * Makes a collection belong to companies:
 * - adds a required `companyId` field, filled in automatically on create
 * - adds `companyId = <current company>` to every query, update and delete
 * - refuses to run at all when no company is known (fails closed)
 *
 * Services therefore never have to remember the filter themselves.
 */
export function tenantPlugin(schema: Schema) {
  schema.add({
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
      immutable: true,
      default: () => currentCompanyId() ?? undefined,
    },
  });

  for (const hook of QUERY_HOOKS) {
    schema.pre(hook, function (this: any) {
      const companyId = requireCompany(this.model.modelName);
      if (companyId) this.where({ companyId: new Types.ObjectId(companyId) });
      stripCompanyFromUpdate(this.getUpdate?.());
    });
  }

  schema.pre('aggregate', function (this: any) {
    const companyId = requireCompany(this._model?.modelName ?? 'aggregate');
    if (companyId) {
      this.pipeline().unshift({
        $match: { companyId: new Types.ObjectId(companyId) },
      });
    }
  });

  schema.pre('insertMany', function (this: any, ...args: any[]) {
    const companyId = requireCompany(this.modelName);
    const docs = args.find((a) => Array.isArray(a)) ?? [];
    if (companyId) for (const doc of docs) doc.companyId = companyId;
  });

  schema.pre('save', function (this: any) {
    const companyId = requireCompany((this.constructor as any).modelName);
    if (!companyId) return;
    // New records always belong to the current company, whatever the request body said.
    if (this.isNew) this.companyId = new Types.ObjectId(companyId);
    else if (String(this.companyId) !== companyId) {
      throw new TenantContextError((this.constructor as any).modelName);
    }
  });

  // Unindexed counts can't be filtered; make accidental use loud.
  schema.pre('estimatedDocumentCount', function (this: any) {
    if (!isSystemContext()) {
      throw new Error(
        'estimatedDocumentCount is not company-aware; use countDocuments',
      );
    }
  });
}
