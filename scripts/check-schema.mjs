import fs from "node:fs";
import assert from "node:assert/strict";
import { verify, validate } from "@agentshouse/mdmodel";
const checked = verify(fs.readFileSync("schema.yaml", "utf8"));
assert.equal(checked.verdict, "accept", JSON.stringify(checked));
for (const sample of JSON.parse(
  fs.readFileSync("scripts/sample-rooms.json", "utf8"),
)) {
  const library = Object.fromEntries(
    sample.files.map((name) => [
      name,
      fs.readFileSync(`samples/${sample.folder}/${name}`, "utf8"),
    ]),
  );
  const result = validate(library, undefined, checked.model);
  assert.equal(result.verdict, "accept", JSON.stringify(result));
}
// Local metadata-only call fixture: no real bytes, uploads, Rooms or Agent run.
const callId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const wireId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const participants = [
  { id: "fixture-peer-local", name: "This device" },
  { id: "fixture-peer-remote", name: "Fixture peer" },
];
const document = (type, fields) =>
  "---\n" +
  Object.entries({ type, ...fields })
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n") +
  "\n---\n";
const callLibrary = {
  "chats/main.md": fs.readFileSync("samples/direct/chats/main.md", "utf8"),
  [`calls/${callId}.md`]: document("messenger_call", {
    id: callId,
    wire_call_id: wireId,
    chat: "../chats/main.md",
    started_at: "2026-10-10T09:00:00.000Z",
    participants,
  }),
  [`call-parts/${callId}-part-1.md`]: document("messenger_call_part", {
    id: `${callId}-part-1`,
    wire_call_id: wireId,
    call: `../calls/${callId}.md`,
    call_id: callId,
    part: 1,
    start: "2026-10-10T09:00:00.000Z",
    start_offset_ms: 0,
    duration_ms: 1000.3,
    participants,
    files: participants.map((speaker, index) => ({
      attachment_ref: `at_fixture_${index}`,
      name: `fixture-${index}.webm`,
      mime: "audio/webm",
      bytes: 100,
      speaker_id: speaker.id,
    })),
  }),
};
const callResult = validate(callLibrary, undefined, checked.model);
assert.equal(callResult.verdict, "accept", JSON.stringify(callResult));
console.log(
  "JSON Schema, two independent Room samples, and synthetic call/part references accepted. No live Room or audio created.",
);
