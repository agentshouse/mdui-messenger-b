// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftSession, mergeDraftParts, type RoomDraft } from '../src/data/draft-session';
import { HouseMessengerStore } from '../src/data/house';
import { chat, fakeRuntime, message, MESSAGE, NOW } from './fakeRuntime';

import { uploadAttachment } from '../src/data/assets';
vi.mock('../src/data/assets', async original => ({
  ...await original<typeof import('../src/data/assets')>(), uploadAttachment: vi.fn(),
}));
const upload = vi.mocked(uploadAttachment);
beforeEach(() => upload.mockReset());
const receipt = (path: string) => ({ path, sha256: '0'.repeat(64), name: `${path.split('/').at(-1)}.txt`, mime: 'text/plain', bytes: 1 });

const KEY = `r_one/messages/${MESSAGE}.md`;
const FILE = { path: 'files/original', sha256:'0'.repeat(64), name: 'original.txt', mime: 'text/plain', bytes: 4 };
const stores: HouseMessengerStore[] = [];
afterEach(() => { stores.splice(0).forEach(store => store.dispose()); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function open(f = fakeRuntime()) { const store = new HouseMessengerStore(async () => f.runtime); stores.push(store); await store.start(); return { f, store }; }
function seed(f: ReturnType<typeof fakeRuntime>, draft: RoomDraft) { f.drafts.set(`${draft.room}/${draft.path}`, draft); f.observations['room-drafts'].publish([...f.drafts.values()]); }
function editDraft(parts: RoomDraft['parts']): RoomDraft { return { room: 'r_one', path: `messages/${MESSAGE}.md`, revision: 'external-1', parts, returned: null, changedUnderneath: {} }; }
const batch = (id = 'batch-1') => ({ id, baseRoomVersion: 'rv0', changes: [{ kind: 'field' as const, path: `messages/${MESSAGE}.md`, name: 'text', value: 'Saved text' }], preconditions: [] });

describe('native message edits', () => {
  it('stages only text with its original base and preserves reply, attachments, sections and preamble', async () => {
    const target = message();
    const reply = { ...message(), path: 'messages/33333333-3333-4333-8333-333333333333.md', fields: { ...message().fields, id: '33333333-3333-4333-8333-333333333333', text: 'Reply target' } };
    const f = fakeRuntime([chat(), { ...target, fields: { ...target.fields, attachments: [FILE], reply: './33333333-3333-4333-8333-333333333333.md' } }, reply]);
    seed(f, editDraft({ sections: { Notes: { base: 'Original notes', value: 'Other-tab notes' } }, preamble: { base: 'Original body', value: 'Other-tab body' } }));
    const { store } = await open(f);
    const shown = store.snapshot().messages.find(item => item.id === MESSAGE)!;
    await store.writeMessage(shown, '  Edited text\n');
    const draft = f.drafts.get(KEY)!;
    expect(draft.parts).toEqual({ fields: { text: { base: { value: 'Ready for review' }, value: '  Edited text\n' } }, sections: { Notes: { base: 'Original notes', value: 'Other-tab notes' } }, preamble: { base: 'Original body', value: 'Other-tab body' } });
    expect(store.snapshot().messageDrafts?.[KEY].draft).toEqual(draft);
    expect(f.raw.save).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
    await store.saveMessage(shown);
    expect(store.snapshot().messages.find(item => item.id === MESSAGE)).toMatchObject({ text: '  Edited text\n', reply: './33333333-3333-4333-8333-333333333333.md', attachments: [FILE] });
    expect(f.raw.roomDraft.write.mock.calls[0][3]).not.toHaveProperty('creation');
  });

  it('keeps invalid raw text across reload and allows a corrected explicit Save', async () => {
    const { f, store } = await open(); const shown = store.snapshot().messages[0]; const raw = 'x'.repeat(50001);
    await store.writeMessage(shown, raw);
    await expect(store.saveMessage(shown)).rejects.toThrow();
    expect(f.raw.save).not.toHaveBeenCalled(); expect(store.snapshot().messageOutcomes?.[KEY].status).toBe('invalid');
    const { store: reload } = await open(f);
    expect(reload.snapshot().messageDrafts?.[KEY].text).toBe(raw);
    await reload.writeMessage(reload.snapshot().messages[0], 'Corrected');
    await reload.saveMessage(reload.snapshot().messages[0]);
    expect(f.raw.save).toHaveBeenCalledOnce(); expect(reload.snapshot().messageDrafts?.[KEY]).toBeUndefined();
  });

  it('synchronizes two editors while preserving first bases and disjoint sections through CAS retry', async () => {
    const { f, store: one } = await open(); const { store: two } = await open(f);
    await one.writeMessage(one.snapshot().messages[0], 'First local edit');
    const native = f.raw.roomDraft.write.getMockImplementation()!;
    f.raw.roomDraft.write.mockImplementationOnce(async (room, path, revision, parts) => {
      const current = f.drafts.get(KEY)!;
      await native(room, path, current.revision, { ...current.parts, sections: { Body: { base: 'Original', value: 'Concurrent section' } }, fields: { text: { base: { value: 'Ready for review' }, value: 'Concurrent text' } } });
      return native(room, path, revision, parts);
    });
    await two.writeMessage(two.snapshot().messages[0], 'Latest local input');
    expect(f.drafts.get(KEY)?.parts).toEqual({ fields: { text: { base: { value: 'Ready for review' }, value: 'Latest local input' } }, sections: { Body: { base: 'Original', value: 'Concurrent section' } } });
    expect(one.snapshot().messageDrafts?.[KEY].text).toBe('Latest local input');
    expect(f.raw.save).not.toHaveBeenCalled();
  });

  it('keeps the same document identity separate in two Rooms', async () => {
    const { f, store } = await open(fakeRuntime([chat(), chat('r_two'), message(), message('r_two')]));
    for (const shown of store.snapshot().messages) await store.writeMessage(shown, shown.room);
    expect(f.drafts.size).toBe(2);
    expect(store.snapshot().messageDrafts?.[KEY].text).toBe('r_one');
    expect(store.snapshot().messageDrafts?.[`r_two/messages/${MESSAGE}.md`].text).toBe('r_two');
  });

  it('can inspect and explicitly retry after a local Save refusal without typing again', async () => {
    const { f, store } = await open(); const shown = store.snapshot().messages[0];
    await store.writeMessage(shown, 'Preserve after refusal');
    f.raw.save.mockResolvedValueOnce({ outcome: 'refused', code:'stale',retryable:false });
    await expect(store.saveMessage(shown)).rejects.toThrow('stale');
    expect(store.snapshot().messageDrafts?.[KEY].text).toBe('Preserve after refusal');
    await store.saveMessage(shown); expect(f.raw.save).toHaveBeenCalledTimes(2);
    expect(store.snapshot().messages[0].text).toBe('Preserve after refusal');
  });

  it('preserves changed-underneath bases and exposes the actual refusal fields', async () => {
    const { f, store } = await open(); const shown = store.snapshot().messages[0];
    await store.writeMessage(shown, 'Local text');
    f.raw.save.mockResolvedValueOnce({ outcome: 'refused', code:'changed-underneath',retryable:false, parts: [{ path: shown.path, part: 'field', name: 'text' }] } as never);
    await expect(store.saveMessage(shown)).rejects.toThrow('changed-underneath');
    expect(f.drafts.get(KEY)?.parts.fields?.text).toEqual({ base: { value: shown.text }, value: 'Local text' });
    expect(store.snapshot().messageOutcomes?.[KEY]).toMatchObject({ status: 'changed-underneath', details: expect.stringContaining('"name":"text"') });
  });

  it('blocks blind retries of uncertain Save without claiming rejection or delivery', async () => {
    const { f, store } = await open(); const shown = store.snapshot().messages[0];
    await store.writeMessage(shown, 'Keep this'); f.raw.save.mockRejectedValueOnce(new Error('Lost bridge answer'));
    await expect(store.saveMessage(shown)).rejects.toThrow('uncertain');
    await expect(store.saveMessage(shown)).rejects.toThrow('uncertain');
    expect(f.raw.save).toHaveBeenCalledOnce(); expect(store.snapshot().messageOutcomes?.[KEY].status).toBe('uncertain');
    expect(store.snapshot().messageDrafts?.[KEY].text).toBe('Keep this');
  });

  it('exposes raw whole-document drafts and refuses to overwrite them with a field edit', async () => {
    const f = fakeRuntime(); const draft = editDraft({ markdown: { base: 'Original document', value: '---\nmalformed: [' } }); seed(f, draft);
    const { store } = await open(f);
    expect(store.snapshot().messageDrafts?.[KEY].draft).toEqual(draft);
    await expect(store.writeMessage(store.snapshot().messages[0], 'Local input')).rejects.toThrow('whole-document');
    expect(f.drafts.get(KEY)).toEqual(draft); expect(f.raw.roomDraft.write).not.toHaveBeenCalled();
    expect(store.snapshot().messageDrafts?.[KEY].text).toBe('Local input');
  });
});

describe('native composer Send races', () => {
  it('preserves creation fields, original timestamp, exact body, reply, sections and attachments on Send', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', '  Body\n', store.snapshot().messages[0]);
    const composer = store.snapshot().composerDrafts!.r_one; const key = `r_one/${composer.path}`; const held = f.drafts.get(key)!;
    const creation = held.parts.creation!; if (!('fields' in creation)) throw new Error('Expected typed creation');
    seed(f, { ...held, revision: 'enriched', parts: { creation: { ...creation, fields: { ...creation.fields, attachments: [FILE], kind: 'file' }, sections: { Body: 'Preserved section' } } } });
    await store.send('r_one', '  Body\n');
    const saved = store.snapshot().messages.find(item => item.path === composer.path)!;
    expect(saved).toMatchObject({ text: '  Body\n', created_at: composer.created_at, reply: `./${MESSAGE}.md`, attachments: [FILE], kind: 'file' });
    expect((await f.raw.query({ select: 'all' })).documents.find(item => item.path === composer.path)?.sections).toEqual({ Body: 'Preserved section' });
  });

  it('does not replace or send newer native text from a stale Send click', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Earlier'); await store.writeComposer('r_one', 'Newer');
    await expect(store.send('r_one', 'Earlier')).rejects.toThrow('newer contents');
    expect(store.snapshot().composerDrafts?.r_one.text).toBe('Newer'); expect(f.raw.save).not.toHaveBeenCalled();
    await store.send('r_one', 'Newer'); expect(f.raw.save).toHaveBeenCalledOnce();
  });

  it('keeps typing during a successful Send on a new draft path without sending it', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Selected for Send'); const original = store.snapshot().composerDrafts!.r_one;
    const gate = deferred<void>(); const save = f.raw.save.getMockImplementation()!;
    f.raw.save.mockImplementationOnce(async (...args) => { await gate.promise; return save(...args); });
    const sending = store.send('r_one', 'Selected for Send'); await vi.waitFor(() => expect(f.raw.save).toHaveBeenCalledOnce());
    const writing = store.writeComposer('r_one', 'Typed while saving'); expect(store.snapshot().composerDrafts?.r_one.text).toBe('Typed while saving');
    gate.resolve(); await sending; await writing;
    expect(store.snapshot().composerDrafts?.r_one).toMatchObject({ text: 'Typed while saving' });
    expect(store.snapshot().composerDrafts?.r_one.path).not.toBe(original.path);
    expect(store.snapshot().messages.find(item => item.path === original.path)?.text).toBe('Selected for Send');
    expect(f.raw.save).toHaveBeenCalledOnce();
  });

  it('keeps typing during a refused Send on the preserved draft path', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Selected'); const path = store.snapshot().composerDrafts!.r_one.path;
    const gate = deferred<void>(); f.raw.save.mockImplementationOnce(async () => { await gate.promise; return { outcome: 'refused', code:'stale',retryable:false }; });
    const sending = store.send('r_one', 'Selected'); const refused = expect(sending).rejects.toThrow('stale'); await vi.waitFor(() => expect(f.raw.save).toHaveBeenCalledOnce());
    const writing = store.writeComposer('r_one', 'Newer after refusal'); gate.resolve(); await refused; await writing;
    expect(store.snapshot().composerDrafts?.r_one).toMatchObject({ path, text: 'Newer after refusal' });
    expect(f.raw.save).toHaveBeenCalledOnce();
  });

  it('retains an acknowledged attachment when another tab edits during upload, without sending newer text', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Selected'); const { store: other } = await open(f);
    const gate = deferred<Awaited<ReturnType<typeof uploadAttachment>>>(); upload.mockImplementationOnce(() => gate.promise as never);
    const sending = store.send('r_one', 'Selected', undefined, [new File(['synthetic'], 'new.txt', { type: 'text/plain' })]);
    const changed = expect(sending).rejects.toThrow('newer contents'); await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    await other.writeComposer('r_one', 'Other-tab text'); gate.resolve(receipt('files/new')); await changed;
    expect(store.snapshot().composerDrafts?.r_one).toMatchObject({ text: 'Other-tab text', attachments: [{ path: 'files/new', sha256:'0'.repeat(64), name: 'new.txt' }] });
    expect(f.raw.save).not.toHaveBeenCalled(); expect(upload).toHaveBeenCalledOnce();
  });

  it('retains oversized native composer input on reload and failed Send', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', ' '.repeat(2) + 'x'.repeat(50001)); const { store: reload } = await open(f);
    await expect(reload.send('r_one', reload.snapshot().composerDrafts!.r_one.text)).rejects.toThrow();
    expect(reload.snapshot().composerDrafts?.r_one.text).toHaveLength(50003); expect(f.raw.save).not.toHaveBeenCalled();
  });
});

describe('real native message outcome observations', () => {
  it('shows waiting, submitted, retry reset and accepted without invented read/delivery claims', async () => {
    const { f, store } = await open();
    for (const [native, expected] of [ [{ batch: batch(), state: 'waiting' }, 'waiting'], [{ batch: batch(), state: 'submitted' }, 'submitted'], [{ batch: batch(), state: 'reset', reset: NOW }, 'retrying'], [{ batch: batch(), state: 'accepted', roomVersion: 'rv1' }, 'accepted'] ] as const) {
      f.observations.queue.publish([native]); expect(store.snapshot().messageOutcomes?.[KEY].status).toBe(expected);
      expect(store.snapshot().messageOutcomes?.[KEY].details).not.toMatch(/delivered|recipient|read by/i);
    }
    expect(store.snapshot().messageOutcomes?.[`r_two/messages/${MESSAGE}.md`]).toBeUndefined();
  });

  it('keeps the accepted receipt stable through redraws and confirms only after reached', async () => {
    const { f, store } = await open(); const reached = deferred<boolean>(); f.raw.reached.mockImplementation(() => reached.promise);
    const accepted = { batch: batch(), state: 'accepted' as const, roomVersion: 'rv1' };
    f.observations.queue.publish([accepted]); f.setDocuments([chat(), message()]); f.observations.queue.publish([accepted]);
    expect(store.snapshot().messageOutcomes?.[KEY].status).toBe('accepted'); reached.resolve(true);
    await vi.waitFor(() => expect(store.snapshot().messageOutcomes?.[KEY].status).toBe('confirmed'));
    f.observations.queue.publish([]); f.setDocuments([chat(), message()]); expect(store.snapshot().messageOutcomes?.[KEY].status).toBe('confirmed');
    expect(f.raw.reached).toHaveBeenCalledWith('r_one', 'rv1');
  });

  it('does not let an older accepted confirmation replace a newer pending batch', async () => {
    const { f, store } = await open(); const reached = deferred<boolean>(); f.raw.reached.mockImplementation(() => reached.promise);
    f.observations.queue.publish([{ batch: batch('old'), state: 'accepted', roomVersion: 'rv1' }]);
    f.observations.queue.publish([{ batch: batch('new'), state: 'waiting' }]); reached.resolve(true); await Promise.resolve(); await Promise.resolve();
    expect(store.snapshot().messageOutcomes?.[KEY]).toMatchObject({ status: 'waiting', batchId: 'new' });
  });

  it('uses uncertainty when a pending queue entry disappears without a Provider result', async () => {
    const { f, store } = await open(); f.observations.queue.publish([{ batch: batch(), state: 'submitted' }]); f.observations.queue.publish([]);
    expect(store.snapshot().messageOutcomes?.[KEY].status).toBe('uncertain');
  });

  it.each(['rejected', 'conflicted'] as const)('shows structured %s returned reasons exactly and preserves the draft', async kind => {
    const { f, store } = await open(); const reason = { kind, code: 'permission_changed', retryable: false, fields: { operation: 'write', path: `messages/${MESSAGE}.md` } };
    seed(f, { ...editDraft({ fields: { text: { base: { value: 'Ready for review' }, value: 'Returned input' } } }), returned: reason });
    expect(store.snapshot().messageOutcomes?.[KEY]).toMatchObject({ status: kind, returned: reason, details: expect.stringContaining(JSON.stringify(reason.fields)) });
    expect(store.snapshot().messageDrafts?.[KEY].text).toBe('Returned input'); expect(f.raw.save).not.toHaveBeenCalled();
  });

  it('restores returned creation drafts as selectable composers', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Returned composer'); const composer = store.snapshot().composerDrafts!.r_one;
    const key = `r_one/${composer.path}`; seed(f, { ...f.drafts.get(key)!, returned: { kind: 'rejected', code: 'invalid_message', retryable: false, fields: { field: 'text' } } });
    const { store: reload } = await open(f); reload.selectComposer('r_one', composer.path);
    expect(reload.snapshot().composerDrafts?.r_one.text).toBe('Returned composer'); expect(reload.snapshot().messageOutcomes?.[key].status).toBe('rejected');
  });

  it('updates halted queue wording without keeping a stale paused label after reopening', async () => {
    const { f, store } = await open(); f.observations.queue.publish([{ batch: batch(), state: 'waiting' }]);
    f.observations['service-mode'].publish('write-halted'); expect(store.snapshot().messageOutcomes?.[KEY].details).toContain('paused');
    f.observations['service-mode'].publish('open'); expect(store.snapshot().messageOutcomes?.[KEY].details).not.toContain('paused');
  });
});

describe('draft session revision guards', () => {
  it('keeps first bases when later field/section/preamble patches carry different bases', () => {
    const merged = mergeDraftParts({ fields: { text: { base: null, value: 'First' } }, sections: { Body: { base: 'First body', value: 'First' } }, preamble: { base: 'First preamble', value: 'First' } }, { fields: { text: { base: { value: 'Incorrect new base' }, value: 'Latest' } }, sections: { Body: { base: 'Incorrect new base', value: 'Latest' } }, preamble: { base: 'Incorrect new base', value: 'Latest' } });
    expect(merged.fields?.text).toEqual({ base: null, value: 'Latest' }); expect(merged.sections?.Body.base).toBe('First body'); expect(merged.preamble?.base).toBe('First preamble');
  });
  it('never commits a newer shared revision just because it arrived before the write answer', async () => {
    const f = fakeRuntime(); const initial = editDraft({ fields: { text: { base: { value: 'Ready for review' }, value: 'Before' } } }); seed(f, initial);
    const session = new DraftSession(f.runtime, 'r_one', initial.path); await session.read(); const write = f.raw.roomDraft.write.getMockImplementation()!;
    f.raw.roomDraft.write.mockImplementationOnce(async (...args) => {
      const result = await write(...args); const current = f.drafts.get(KEY)!;
      const newer = { ...current, revision: 'newer-external', parts: { fields: { text: { base: { value: 'Ready for review' }, value: 'External newer' } } } };
      seed(f, newer); session.accept(newer); return result;
    });
    await expect(session.stage({ fields: { text: { value: 'Send selected' } } }, initial.revision)).rejects.toThrow('newer contents');
    expect((await session.read())?.parts.fields?.text.value).toBe('External newer'); expect(f.raw.save).not.toHaveBeenCalled();
  });
});

describe('acknowledged attachment preservation', () => {
  it.each(['', 'Text with files'])('retains the first acknowledged file in a native draft when the next upload is uncertain: %j', async text => {
    const { f, store } = await open();
    upload.mockResolvedValueOnce(receipt('files/first')).mockRejectedValueOnce(new Error('Second upload answer lost'));
    const files = [new File(['first'], 'first.txt', { type: 'text/plain' }), new File(['second'], 'second.txt', { type: 'text/plain' })];
    await expect(store.send('r_one', text, undefined, files)).rejects.toThrow('uncertain');
    const composer = store.snapshot().composerDrafts!.r_one;
    expect(composer).toMatchObject({ text, attachments: [{ path: 'files/first', sha256:'0'.repeat(64), name: 'first.txt' }] });
    expect(f.drafts.get(`r_one/${composer.path}`)?.parts.creation).toMatchObject({ fields: { text, attachments: [{ path: 'files/first' }] } });
    expect(store.snapshot().messageOutcomes?.[`r_one/${composer.path}`].status).toBe('uncertain');
    expect(f.raw.save).not.toHaveBeenCalled(); expect(upload).toHaveBeenCalledTimes(2);
    await expect(store.send('r_one', text, undefined, files)).rejects.toThrow('needs review');
    expect(upload).toHaveBeenCalledTimes(2);
    const { store: reload } = await open(f); expect(reload.snapshot().composerDrafts?.r_one.attachments[0].path).toBe('files/first');
  });

  it('persists each acknowledged file before starting the next upload and keeps concurrent body/reply/sections', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Before files', store.snapshot().messages[0]);
    const { store: other } = await open(f); const gate = deferred<Awaited<ReturnType<typeof uploadAttachment>>>();
    upload.mockResolvedValueOnce(receipt('files/first')).mockImplementationOnce(() => gate.promise as never);
    const files = [new File(['first'], 'first.txt'), new File(['second'], 'second.txt')];
    const sending = store.send('r_one', 'Before files', undefined, files); const changed = expect(sending).rejects.toThrow('newer contents');
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    const composer = store.snapshot().composerDrafts!.r_one; const key = `r_one/${composer.path}`;
    expect(f.drafts.get(key)?.parts.creation).toMatchObject({ fields: { attachments: [{ path: 'files/first' }] } });
    await other.writeComposer('r_one', 'Newer text'); const draft = f.drafts.get(key)!; const creation = draft.parts.creation!; if (!('fields' in creation)) throw new Error('Expected creation');
    seed(f, { ...draft, revision: 'newer-section', parts: { creation: { ...creation, sections: { Body: 'New section' } } } });
    gate.resolve(receipt('files/second')); await changed;
    expect(f.drafts.get(key)?.parts.creation).toMatchObject({ fields: { text: 'Newer text', reply: `./${MESSAGE}.md`, attachments: [{ path: 'files/first' }, { path: 'files/second' }] }, sections: { Body: 'New section' } });
    expect(f.raw.save).not.toHaveBeenCalled();
  });

  it('keeps all acknowledged files on Save refusal and an explicit retry does not upload the same File objects again', async () => {
    const { f, store } = await open();
    upload.mockResolvedValueOnce(receipt('files/first')).mockResolvedValueOnce(receipt('files/second'));
    f.raw.save.mockResolvedValueOnce({ outcome: 'refused', code:'stale',retryable:false });
    const files = [new File(['first'], 'first.txt'), new File(['second'], 'second.txt')];
    await expect(store.send('r_one', '', undefined, files)).rejects.toThrow('stale');
    expect(store.snapshot().composerDrafts?.r_one.attachments).toHaveLength(2);
    await store.send('r_one', '', undefined, files);
    expect(upload).toHaveBeenCalledTimes(2); expect(f.raw.save).toHaveBeenCalledTimes(2);
    expect(store.snapshot().messages.find(item => item.text === '')?.attachments).toHaveLength(2);
  });

  it('keeps acknowledged files after an uncertain Save and does not resend automatically', async () => {
    const { f, store } = await open(); upload.mockResolvedValueOnce(receipt('files/first'));
    f.raw.save.mockRejectedValueOnce(new Error('Lost save answer'));
    await expect(store.send('r_one', '', undefined, [new File(['first'], 'first.txt')])).rejects.toThrow('uncertain');
    expect(store.snapshot().composerDrafts?.r_one.attachments[0].path).toBe('files/first');
    expect(upload).toHaveBeenCalledOnce(); expect(f.raw.save).toHaveBeenCalledOnce();
  });

  it('keeps an in-flight acknowledged upload as native attachment edits on the same path if another tab saved it', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Original selected text'); const original = store.snapshot().composerDrafts!.r_one;
    const { store: other } = await open(f); const gate = deferred<Awaited<ReturnType<typeof uploadAttachment>>>(); upload.mockImplementationOnce(() => gate.promise as never);
    const files = [new File(['first'], 'first.txt')];
    const sending = store.send('r_one', 'Original selected text', undefined, files); const changed = expect(sending).rejects.toThrow('same message path');
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce()); await other.send('r_one', 'Original selected text');
    gate.resolve(receipt('files/first')); await changed;
    const draft = f.drafts.get(`r_one/${original.path}`)!;
    expect(draft.parts).toMatchObject({ fields: { attachments: { base: { value: [] }, value: [{ path: 'files/first' }] } } });
    expect(draft.parts).not.toHaveProperty('creation');
    expect(f.raw.roomDraft.write.mock.calls.every(call => call[1] === original.path)).toBe(true);
    expect(store.snapshot().composerDrafts?.r_one).toBeUndefined();
    expect(store.snapshot().messages.find(item => item.path === original.path)?.attachments).toEqual([]);
    expect(f.raw.save).toHaveBeenCalledOnce();
    await expect(store.send('r_one', 'Original selected text', undefined, files)).rejects.toThrow('Save changes');
    expect(upload).toHaveBeenCalledOnce();
    expect(f.raw.roomDraft.write.mock.calls.every(call => call[1] === original.path)).toBe(true);
    expect(store.snapshot().messageDrafts?.[`r_one/${original.path}`].attachments?.[0].path).toBe('files/first');
    await store.saveMessage(store.snapshot().messages.find(item => item.path === original.path)!);
    expect(store.snapshot().messages.find(item => item.path === original.path)?.attachments[0].path).toBe('files/first');
    expect(f.raw.save).toHaveBeenCalledTimes(2); expect(upload).toHaveBeenCalledOnce();
  });

  it('keeps receipt evidence in memory and creates no extra draft when the original path was discarded', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Original selected text'); const original = store.snapshot().composerDrafts!.r_one;
    const gate = deferred<Awaited<ReturnType<typeof uploadAttachment>>>(); upload.mockImplementationOnce(() => gate.promise as never);
    const sending = store.send('r_one', 'Original selected text', undefined, [new File(['first'], 'first.txt')]); const unavailable = expect(sending).rejects.toThrow('No replacement draft was created');
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    f.drafts.delete(`r_one/${original.path}`); f.observations['room-drafts'].publish([]);
    gate.resolve(receipt('files/first')); await unavailable;
    expect(f.drafts.size).toBe(0); expect(f.raw.save).not.toHaveBeenCalled();
    expect(f.raw.roomDraft.write.mock.calls.every(call => call[1] === original.path)).toBe(true);
    expect(store.snapshot().error).toContain('first.txt (files/first)');
    expect(store.snapshot().messageOutcomes?.[`r_one/${original.path}`]).toMatchObject({ status: 'uncertain', details: expect.stringContaining('files/first') });
    await expect(store.send('r_one', 'Original selected text')).rejects.toThrow('needs review');
  });

  it('preserves raw text even when Send creates the native draft without earlier typing', async () => {
    const { store } = await open(); await store.send('r_one', '  Exact body\n');
    expect(store.snapshot().messages.find(item => item.text === '  Exact body\n')).toBeDefined();
  });
});

describe('draft lifecycle boundaries', () => {
  it('closes a late queue observation after disposal without starting more observations', async () => {
    const f = fakeRuntime(); const gate = deferred<typeof f.observations.queue>();
    f.raw.observe.mockImplementation(async (topic, input) => topic === 'queue' && input === 'r_one' ? gate.promise : f.observations[topic]);
    const { store } = await open(f); const calls = f.raw.observe.mock.calls.length;
    const subscribe = vi.spyOn(f.observations.queue, 'subscribe'); store.dispose(); gate.resolve(f.observations.queue);
    await vi.waitFor(() => expect(f.observations.queue.close).toHaveBeenCalledOnce());
    expect(subscribe).not.toHaveBeenCalled(); expect(f.raw.observe).toHaveBeenCalledTimes(calls);
  });

  it('surfaces exact receipt evidence if a local draft write fails after an acknowledged upload', async () => {
    const { f, store } = await open(); await store.writeComposer('r_one', 'Keep original');
    const path = store.snapshot().composerDrafts!.r_one.path;
    upload.mockResolvedValueOnce(receipt('files/known'));
    f.raw.roomDraft.write.mockRejectedValueOnce(new Error('Local storage unavailable'));
    await expect(store.send('r_one', 'Keep original', undefined, [new File(['content'], 'known.txt')])).rejects.toThrow('known.txt (files/known)');
    expect(f.raw.save).not.toHaveBeenCalled(); expect(upload).toHaveBeenCalledOnce();
    expect([...f.drafts.values()].map(draft => draft.path)).toEqual([path]);
    expect(store.snapshot().error).toContain('Local storage unavailable');
  });
});
