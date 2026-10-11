import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  dist = path.join(root, "dist");
const files = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(dir, e.name))
        : [path.join(dir, e.name)],
    );
const output = files(dist),
  bytes = output.reduce((sum, p) => sum + fs.statSync(p).size, 0);
assert(output.length <= 2000);
assert.equal(output.filter(file => file.endsWith(".js")).length, 1, "All application code must load in the initial JavaScript asset");
assert(bytes <= 20 * 1024 * 1024);
assert.equal(
  fs.readFileSync(path.join(dist, "schema.yaml"), "utf8"),
  fs.readFileSync(path.join(root, "schema.yaml"), "utf8"),
);
assert.equal(
  fs.readFileSync(path.join(dist, "app.json"), "utf8"),
  fs.readFileSync(path.join(root, "app.json"), "utf8"),
);
for (const required of [
  "LICENSE.txt",
  "THIRD_PARTY_NOTICES.txt",
  "schema.yaml",
  "app.json",
  "index.html",
  "icon.svg",
])
  assert(fs.existsSync(path.join(dist, required)), `Missing ${required}`);
const references = new Set();
function local(value, from) {
  if (value.startsWith("data:") || value.startsWith("#")) return;
  assert(
    !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value),
    `External reference ${value}`,
  );
  const target = path.resolve(
    path.dirname(from),
    decodeURIComponent(value.split(/[?#]/)[0]),
  );
  assert(target.startsWith(dist + path.sep));
  assert(fs.existsSync(target), `Missing ${value}`);
  references.add(path.relative(dist, target));
}
for (const file of output) {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".html")) {
    assert(
      !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(text),
      "Inline scripts",
    );
    for (const m of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g))
      local(m[1], file);
  }
  if (file.endsWith(".css"))
    for (const m of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\)/g))
      local(m[1], file);
  if (file.endsWith(".js")) {
    assert(
      !/cdn\.jsdelivr|unsplash|serenada\.app|talk\.peerix|stun\.l\.google|localStorage|sessionStorage|indexedDB|serviceWorker|new WebSocket|new EventSource|getDisplayMedia/.test(
        text,
      ),
      `Forbidden runtime mechanism in ${file}`,
    );
    assert(!/\bfetch\s*\(/.test(text), "Direct fetch in release");
  }
}
for (const file of [
  ...files(path.join(root, "src")),
  ...files(path.join(root, "vendor")),
]) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  // Master1118: Messenger hands off only persisted Room documents to Room automation.
  assert(
    !/\bchatDraft\b|\bconversation\s*\.\s*(?:send|create|answer|discard)|Send to agent/.test(
      text,
    ),
    `Agent conversation action outside Messenger scope: ${file}`,
  );
  assert(
    !/connectMdRuntime|serveMdRuntime|createMemoryAdapter|new WebSocket|new EventSource|\bfetch\s*\(|stun\.l\.google|localStorage|sessionStorage|indexedDB|getDisplayMedia/.test(
      text,
    ),
    `Forbidden production source API ${file}`,
  );
}
const manifest = JSON.parse(
  fs.readFileSync(path.join(dist, "app.json"), "utf8"),
);
assert(!manifest.external_calls && !manifest.external_origins);
const report = {
  result: "passed",
  files: output.length,
  bytes,
  mebibytes: +(bytes / 1024 / 1024).toFixed(3),
  references: [...references],
  sha256: Object.fromEntries(
    output.map((file) => [
      path.relative(dist, file),
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    ]),
  ),
  networkScope:
    "Static source/entry/CSS/bundle audit. Hosted network capture not yet run.",
  browser: "Desktop and 360px hosted checks pending parent",
  media: "Synthetic fixtures only; no actual capture or peer call",
  publication: "This static audit does not establish publication or hosted acceptance.",
};
fs.writeFileSync(
  path.join(root, "reports/release-audit.json"),
  JSON.stringify(report, null, 2) + "\n",
);
execFileSync(process.execPath, [path.join(root, "scripts/check-schema.mjs")], {
  cwd: root,
  stdio: "inherit",
});
console.log(JSON.stringify(report, null, 2));
