import { expect, it, vi } from 'vitest';
import { DraftSession } from '../src/data/draft-session';

it('preserves an unknown write refusal and never automatically retries it', async () => {
  const prior = {room:'room',path:'doc.md',revision:'held',parts:{fields:{title:{value:'Kept',base:null}}},changedUnderneath:{},returned:null};
  const runtime = {
    roomDraft: {
      read: vi.fn().mockResolvedValue(prior),
      write: vi.fn().mockResolvedValue({outcome:'refused',code:'future-write-policy',retryable:false}),
    },
    save: vi.fn(),
  };
  const session = new DraftSession(runtime as never, 'room', 'doc.md');
  await expect(session.stage({fields:{title:{value:'Next',base:null}}})).rejects.toMatchObject({code:'future-write-policy',retryable:false});
  expect(runtime.roomDraft.write).toHaveBeenCalledTimes(1);
  expect(runtime.save).not.toHaveBeenCalled();
  expect(prior.parts.fields.title.value).toBe('Kept');
});
