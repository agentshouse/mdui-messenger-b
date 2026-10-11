/** Fixture guard for Master's 20261011T1742Z Local Query contract.
 * Only field references in queries are JSON Pointers. Returned frontmatter and
 * Room Draft business-field names remain unchanged. This is not a query engine.
 */
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function pointer(value: unknown, at: string) {
  // A frontmatter member is a non-root RFC 6901 pointer. Slashes delimit
  // segments; the only permitted tilde escapes are ~0 and ~1.
  if (typeof value !== 'string' || !/^\/(?:[^~]|~[01])*$/.test(value)) {
    throw new Error(`invalid-query at ${at}: frontmatter fields must use JSON Pointer paths, for example /title`);
  }
}

function where(input: unknown, at: string) {
  if (!record(input)) return;
  for (const [name, value] of Object.entries(input)) {
    if (name === '$and' || name === '$or') {
      if (Array.isArray(value)) value.forEach((branch, index) => where(branch, `${at}.${name}[${index}]`));
    } else {
      pointer(name, `${at}.${name}`);
      // Predicate values and operators are data, not field references.
    }
  }
}

function key(input: unknown, at: string, intrinsic: readonly string[]) {
  if (record(input) && 'field' in input) pointer(input.field, `${at}.field`);
  else if (typeof input !== 'string' || !intrinsic.includes(input)) {
    throw new Error(`invalid-query at ${at}: use an intrinsic key or { field: '/title' }`);
  }
}

export function assertStrictLocalQuery(input: unknown) {
  if (!record(input)) throw new Error('invalid-query: expected a Local Query object');
  if (record(input.select) && input.select.fields !== undefined && input.select.fields !== 'all') {
    if (!Array.isArray(input.select.fields)) throw new Error('invalid-query at select.fields: expected all or JSON Pointer paths');
    input.select.fields.forEach((field, index) => pointer(field, `select.fields[${index}]`));
  }
  where(input.where, 'where');
  for (const relation of ['hop', 'backlinks'] as const) {
    const filter = input[relation];
    if (!record(filter)) continue;
    if (filter.field !== undefined) pointer(filter.field, `${relation}.field`);
    where(filter.where, `${relation}.where`);
  }
  if (Array.isArray(input.orderBy)) input.orderBy.forEach((order, index) => {
    if (record(order)) key(order.by, `orderBy[${index}].by`, ['room', 'path', 'type', 'count']);
  });
  if (Array.isArray(input.groupBy)) input.groupBy.forEach((field, index) => key(field, `groupBy[${index}]`, ['room', 'type']));
}
