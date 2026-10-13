import { beforeAll, describe, expect, it } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { uploadAttachment, readAttachment, sha256 } from '../src/data/assets';
import { fakeRuntime } from './fakeRuntime';
beforeAll(() => {
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob });
  Object.defineProperty(globalThis, 'File', { value: NodeFile });
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
});
describe('Room binary files', () => {
  it('saves a binary Draft in the explicit Room and reads its bytes', async () => {
    const f = fakeRuntime(), file = new File(['synthetic audio'], 'voice.webm', { type: 'audio/webm' });
    const value = await uploadAttachment(f.runtime, 'r_one', file, 'version-fixture');
    expect(f.raw.roomDraft.write).toHaveBeenCalledWith('r_one', 'files/version-fixture', null, { file: { blob: file } });
    expect(f.raw.save).toHaveBeenCalledWith('r_one', [{ path: 'files/version-fixture', revision: 'draft-1' }]);
    expect(value).toEqual({ path: 'files/version-fixture', name: 'voice.webm', mime: 'audio/webm', bytes: file.size, sha256: await sha256(file) });
    expect((await readAttachment(f.runtime, 'r_one', value)).blob).toBe(file);
    expect(f.raw.binaryFile.read).toHaveBeenCalledWith('r_one', value.path);
    expect(f.raw.call).not.toHaveBeenCalled();
  });
  it('keeps a failed Save draft and never reports a completed upload', async () => {
    const f = fakeRuntime();
    f.raw.save.mockResolvedValueOnce({ outcome: 'refused', code: 'new_refusal', retryable: false } as never);
    await expect(uploadAttachment(f.runtime, 'r_one', new File(['x'], 'x.txt'), 'file-one')).rejects.toThrow('new_refusal');
    expect(f.drafts.has('r_one/files/file-one')).toBe(true);
    expect(f.raw.save).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite an existing draft or automatically retry', async () => {
    const f = fakeRuntime();
    await f.runtime.roomDraft.write('r_one', 'files/file-one', null, { file: { blob: new Blob(['existing']) } });
    await expect(uploadAttachment(f.runtime, 'r_one', new File(['x'], 'x.txt'), 'file-one')).rejects.toThrow('stale');
    expect(f.raw.save).not.toHaveBeenCalled();
  });
  it('preserves an unknown binary refusal code without inventing available bytes', async () => {
    const f = fakeRuntime(), file = new File(['x'], 'x.txt');
    const value = await uploadAttachment(f.runtime, 'r_one', file);
    f.raw.binaryFile.read.mockResolvedValueOnce({ kind: 'rejected', code: 'new_refusal', retryable: true } as never);
    expect(await readAttachment(f.runtime, 'r_one', value)).toEqual({ blob: null, name: 'x.txt', status: 'new_refusal' });
  });
  it('checks size and hash before playback', async () => {
    const f = fakeRuntime(), value = await uploadAttachment(f.runtime, 'r_one', new File(['x'], 'x.txt'));
    f.raw.binaryFile.read.mockResolvedValueOnce({ kind: 'binary', blob: new Blob(['y']) });
    await expect(readAttachment(f.runtime, 'r_one', value)).rejects.toThrow('size/hash');
  });
  it.each(['../outside', 'files/../outside', 'https://other.test/file'])('rejects an out-of-scope path %s before reading', async path => {
    const f = fakeRuntime();
    await expect(readAttachment(f.runtime, 'r_one', { path, name: 'x', mime: 'text/plain', bytes: 1, sha256: '0'.repeat(64) })).rejects.toThrow();
    expect(f.raw.binaryFile.read).not.toHaveBeenCalled();
  });
  it('rejects an empty upload before writing', async () => {
    const f = fakeRuntime();
    await expect(uploadAttachment(f.runtime, 'r_one', new File([], 'empty'))).rejects.toThrow('nonempty');
    expect(f.raw.roomDraft.write).not.toHaveBeenCalled();
  });
});
