import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const mapping = [
  ["src/App.tsx", "research/chatcn-original/src/components/ui/chat/layouts.tsx"],
  ["src/chatcn/layouts.tsx", "research/chatcn-original/src/components/ui/chat/layouts.tsx"],
  ["src/chatcn/chat.tsx", "research/chatcn-original/src/components/ui/chat/chat.tsx"],
  ["src/chatcn/chat.css", "research/chatcn-original/src/app/globals.css"],
  ["registry", "../messenger-chat-donor/registry"],
  ["src/components/ui", "../messenger-chat-donor/src/components/ui"],
  ["src/lib/utils.ts", "../messenger-chat-donor/src/lib/utils.ts"],
  [
    "src/hooks/use-mobile.ts",
    "../messenger-chat-donor/src/hooks/use-mobile.ts",
  ],
  ["src/index.css", "../messenger-chat-donor/src/app/globals.css"],
  [
    "vendor/serenada-core/src",
    "../messenger-call-donor/client/packages/core/src",
  ],
  [
    "vendor/serenada-react-ui/src",
    "../messenger-call-donor/client/packages/react-ui/src",
  ],
  [
    "vendor/peerix-picker/media-button.tsx",
    "../messenger-picker-donor/src/components/media-button.tsx",
  ],
  [
    "vendor/peerix-picker/use-media-devices.ts",
    "../messenger-picker-donor/src/hooks/use-media-devices.ts",
  ],
  [
    "vendor/peerix-picker/use-audio-analysis.ts",
    "../messenger-picker-donor/src/hooks/use-audio-analysis.ts",
  ],
];
const files = (dir) =>
  fs.statSync(dir).isDirectory()
    ? fs.readdirSync(dir).flatMap((name) => files(path.join(dir, name)))
    : [dir];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pins = JSON.parse(fs.readFileSync(path.join(root, "reports/chatcn-source-pins.json"), "utf8"));
assert.equal(pins.commit, "a7be5c3aedebed3441594ce8f532acc168c1628c");
for (const file of pins.files) {
  const bytes = fs.readFileSync(path.join(root, file.local));
  assert.equal(bytes.length, file.size_bytes, file.local);
  assert.equal(hash(bytes), file.sha256, file.local);
}
const entries = [];
for (const [local, donor] of mapping)
  for (const file of files(path.join(root, local))) {
    const relative = path.relative(path.join(root, local), file);
    const original = path.join(root, donor, relative);
    assert(fs.existsSync(original), `Missing donor origin ${original}`);
    const before = fs.readFileSync(original),
      after = fs.readFileSync(file);
    entries.push({
      path: path.relative(root, file),
      donorPath: path.relative(root, original),
      originalSha256: hash(before),
      retainedSha256: hash(after),
      status: before.equals(after) ? "identical" : "adapted",
      bytes: after.length,
    });
  }
const report = {
  donors: [
    { repository: "https://github.com/leonickson1/chatcn", commit: "a7be5c3aedebed3441594ce8f532acc168c1628c", license: "MIT", scope: "Actual rail/header, bubble/date/reply/thread/composer code and themes; Room adapter replaces donor demo authority" },
    {
      repository: "https://github.com/Mesailor/shadcn-chat",
      commit: "25daf263eaea42d125c942a80e2ed03cc72b3fe2",
      license: "MIT",
    },
    {
      repository: "https://github.com/agatx/serenada",
      commit: "8ce3de95d8fc7db81322381270fd251efd4c9134",
      license: "BSD-3-Clause root grant retained",
    },
    {
      repository: "https://github.com/meefik/peerix-talk",
      commit: "f2592faee6ecf33916767c386c27af9aafba2dac",
      license: "MIT",
      scope: "Picker only, no Peerix library",
    },
  ],
  retainedFiles: entries.length,
  identicalFiles: entries.filter((x) => x.status === "identical").length,
  adaptedFiles: entries
    .filter((x) => x.status === "adapted")
    .map((x) => x.path),
  entries,
  visualAcceptance:
    "Pending hosted donor-versus-port browser comparison; file fidelity is not a visual pass.",
};
fs.writeFileSync(
  path.join(root, "reports/source-provenance.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    retainedFiles: report.retainedFiles,
    identicalFiles: report.identicalFiles,
    adaptedFiles: report.adaptedFiles,
  }),
);
