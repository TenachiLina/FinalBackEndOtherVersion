type IdLike = string | { _id?: unknown } | null | undefined;

const toId = (x: IdLike): string =>
  x && typeof x === 'object' && x._id ? String(x._id) : String(x ?? '');

/** Unique backup ids (works on populated or plain docs), never the main employee. */
export function getBackupIds(doc: {
  empId?: IdLike;
  backupEmpIds?: IdLike[];
  backupEmpId?: IdLike;
}): string[] {
  const raw = doc.backupEmpIds?.length
    ? doc.backupEmpIds
    : doc.backupEmpId
      ? [doc.backupEmpId]
      : [];
  const main = toId(doc.empId);
  return [...new Set(raw.map(toId))].filter((id) => id && id !== main);
}

/** Populated backup employee objects (new array first, legacy field as fallback). */
export function getBackupEmployees(doc: any): any[] {
  const list = doc.backupEmpIds?.length
    ? doc.backupEmpIds
    : doc.backupEmpId
      ? [doc.backupEmpId]
      : [];
  const main = toId(doc.empId);
  const seen = new Set<string>();
  return list.filter((e: any) => {
    if (!e || typeof e !== 'object') return false; // not populated / deleted employee
    const id = String(e._id);
    if (id === main || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}