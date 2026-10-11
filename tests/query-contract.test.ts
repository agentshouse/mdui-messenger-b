import { describe, expect, it } from 'vitest';
import { HouseMessengerStore, query } from '../src/data/house';
import { fakeRuntime } from './fakeRuntime';
import { assertStrictLocalQuery } from './strictQuery';

const bareReferences: [string, unknown][] = [
  ['select.fields', { select: { fields: ['title'] } }],
  ['where', { select: 'all', where: { title: 'Unsent' } }],
  ['nested where', { select: 'all', where: { $and: [{ '/kind': 'text' }, { $or: [{ title: { $exists: true } }] }] } }],
  ['orderBy', { select: 'all', orderBy: [{ by: { field: 'created_at' } }] }],
  ['groupBy', { groupBy: [{ field: 'kind' }] }],
  ['group orderBy', { groupBy: [{ field: '/kind' }], orderBy: [{ by: { field: 'kind' } }] }],
  ['hop.field', { select: 'all', hop: { field: 'chat' } }],
  ['hop.where', { select: 'all', hop: { field: '/chat', where: { title: 'Design review' } } }],
  ['backlinks.field', { select: 'all', backlinks: { field: 'reply' } }],
  ['backlinks.where', { select: 'all', backlinks: { where: { $or: [{ kind: 'text' }] } } }],
];

describe('strict Local Query JSON Pointer contract', () => {
  it.each(bareReferences)('rejects a bare frontmatter name in %s at both fixture entry points', async (_name, invalid) => {
    const f = fakeRuntime();
    expect(() => assertStrictLocalQuery(invalid)).toThrow(/JSON Pointer/);
    await expect(f.raw.query(invalid)).rejects.toThrow(/invalid-query/);
    await expect(f.raw.observe('query', invalid)).rejects.toThrow(/invalid-query/);
    expect(f.raw.roomDraft.write).not.toHaveBeenCalled();
    expect(f.raw.save).not.toHaveBeenCalled();
    expect(f.raw.call).not.toHaveBeenCalled();
  });

  it.each(['', 'text', '#/text', '/bad~', '/bad~2', '/bad~9escape'])('rejects malformed member pointer %j', field => {
    expect(() => assertStrictLocalQuery({ select: { fields: [field] } })).toThrow(/JSON Pointer/);
  });

  it.each(['mode', '/mode'])('rejects unwrapped order/group fields %j', field => {
    expect(() => assertStrictLocalQuery({ select: 'all', orderBy: [{ by: field }] })).toThrow(/intrinsic key/);
    expect(() => assertStrictLocalQuery({ groupBy: [field] })).toThrow(/intrinsic key/);
  });

  it('accepts JSON Pointer references throughout relation, predicate, selection and ordering queries', async () => {
    const documentQuery = {
      rooms: ['r_one'], types: ['messenger_message'], pathPrefix: 'messages',
      select: { fields: ['/text', '/created_at', '/metadata/topic', '/slash~1key', '/tilde~0key'], sections: ['Body'], change: true },
      where: { $and: [{ '/text': { $ne: 'title' } }, { $or: [{ '/kind': { $in: ['text', 'file'] } }, { '/attachments': { $size: 0 } }] }] },
      hop: { field: '/chat', where: { '/title': 'Design review' } },
      backlinks: { field: '/reply', where: { $and: [{ '/kind': 'text' }] } },
      orderBy: [{ by: { field: '/created_at' }, direction: 'asc' }, { by: 'path' }],
    };
    const groupingQuery = { groupBy: ['room', 'type', { field: '/kind' }], orderBy: [{ by: 'count' }, { by: { field: '/kind' } }] };
    const f = fakeRuntime();
    expect(() => assertStrictLocalQuery(documentQuery)).not.toThrow();
    expect(() => assertStrictLocalQuery(groupingQuery)).not.toThrow();
    await expect(f.raw.query(documentQuery)).resolves.toHaveProperty('documents');
    await expect(f.raw.observe('query', documentQuery)).resolves.toBe(f.observations.query);
  });

  it('keeps all-fields selection, intrinsic ordering, literal predicate data and section headings unchanged', () => {
    expect(() => assertStrictLocalQuery({ select: { fields: 'all', sections: ['Notes'] }, where: { '/text': { $eq: 'text' } }, orderBy: [{ by: 'room' }, { by: 'path' }, { by: 'type' }] })).not.toThrow();
    expect(() => assertStrictLocalQuery({ select: 'all', backlinks: {} })).not.toThrow();
    expect(() => assertStrictLocalQuery({ select: { fields: ['all'] } })).toThrow(/JSON Pointer/);
  });

  it('runs the unchanged published Messenger query and local save refresh against the strict fixture', async () => {
    expect(query.select).toEqual({ fields: 'all', change: true });
    expect(query.orderBy).toEqual([{ by: 'path', direction: 'asc' }]);
    const f = fakeRuntime();
    const store = new HouseMessengerStore(async () => f.runtime);
    try {
      await store.start();
      expect(store.snapshot().error).toBeNull();
      expect(store.snapshot().messages[0].text).toBe('Ready for review');
      await store.writeComposer('r_one', 'A local contract-test draft');
      await store.send('r_one', 'A local contract-test draft');
      expect(store.snapshot().error).toBeNull();
      expect(f.raw.query).toHaveBeenCalledWith(expect.objectContaining({ select: { fields: 'all', change: true }, orderBy: [{ by: 'path', direction: 'asc' }] }));
      const creation = f.raw.roomDraft.write.mock.calls[0][3].creation as { fields: Record<string, unknown> };
      expect(creation.fields.text).toBe('A local contract-test draft');
      expect(creation.fields).not.toHaveProperty('/text');
      expect(f.raw.call).not.toHaveBeenCalled();
    } finally { store.dispose(); }
  });
});
