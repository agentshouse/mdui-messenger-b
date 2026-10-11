import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const donors = [
  ["chatcn", "leonickson1/chatcn", "a7be5c3aedebed3441594ce8f532acc168c1628c", "chatcn-MIT.txt"],
  [
    "shadcn-chat",
    "Mesailor/shadcn-chat",
    "25daf263eaea42d125c942a80e2ed03cc72b3fe2",
    "shadcn-chat-MIT.txt",
  ],
  [
    "Serenada",
    "agatx/serenada",
    "8ce3de95d8fc7db81322381270fd251efd4c9134",
    "serenada-BSD-3-Clause.txt",
  ],
  [
    "Peerix Talk picker only",
    "meefik/peerix-talk",
    "f2592faee6ecf33916767c386c27af9aafba2dac",
    "peerix-talk-MIT.txt",
  ],
];
const notices = [
  "MESSENGER — THIRD-PARTY NOTICES\n\nAdaptations keep actual chatcn rail/thread/composer and themes, Mesailor fallback primitives and licensed text samples, media/session/call UI and picker. Outside services, donor branding and unsupported screen capture are omitted. Peerix networking is not included. Local icon.svg is original. Dependency notices cover the production dependency closure, a superset of the actual bundle.",
];
const donorNotices = donors.map(([name, repo, commit, license]) => {
  const body = fs.readFileSync(path.join(root, "licenses", license), "utf8");
  notices.push(
    `\n${"=".repeat(72)}\n${name}\nSource: https://github.com/${repo}/tree/${commit}\n\n${body}`,
  );
  return {
    name,
    repo,
    commit,
    license,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
});
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const packages = [],
  missing = [];
const supplements = [
  {
    name: "qrcode-generator",
    file: "qrcode-generator-MIT.txt",
    sha256: "3a850fa5f08101db6f40676c2786e10bd2cd5fff7b12ffdf1e0c434d4e49d90c",
    source:
      "https://github.com/kazuhikoarase/qrcode-generator/blob/83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8/LICENSE",
  },
  {
    name: "react-remove-scroll-bar",
    file: "react-remove-scroll-bar-MIT.txt",
    sha256: "a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84",
    source:
      "https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE (upstream grant; npm gitHead unavailable, not claimed publication commit)",
  },
  {
    name: "@cfworker/json-schema",
    file: "cfworker-json-schema-MIT.txt",
    sha256: "376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094",
    source:
      "https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md",
  },
];
for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative || entry.dev) continue;
  const directory = path.join(root, relative);
  if (!fs.existsSync(path.join(directory, "package.json"))) {
    if (!entry.optional) missing.push(relative);
    continue;
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const files = fs
    .readdirSync(directory)
    .filter(
      (name) =>
        /^(licen[cs]e|notice|copying|copyright|ofl)(?:[._-]|$)/i.test(name) &&
        fs.statSync(path.join(directory, name)).isFile(),
    );
  packages.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    files,
  });
  notices.push(
    `\n${"=".repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\n`,
  );
  if (!files.length) {
    const supplement = supplements.find((x) => x.name === pkg.name);
    if (supplement) {
      const body = fs.readFileSync(
        path.join(root, "licenses", supplement.file),
      );
      assert.equal(
        createHash("sha256").update(body).digest("hex"),
        supplement.sha256,
      );
      notices.push(`Source: ${supplement.source}\n${body}`);
    } else missing.push(`${pkg.name}@${pkg.version}`);
  }
  for (const name of files)
    notices.push(
      `\n--- ${name} ---\n${fs.readFileSync(path.join(directory, name), "utf8")}`,
    );
}
fs.writeFileSync(
  path.join(root, "public/THIRD_PARTY_NOTICES.txt"),
  notices.join("\n") + "\n",
);
fs.mkdirSync(path.join(root, ".verification"), { recursive: true });
fs.writeFileSync(
  path.join(root, ".verification/license-audit.json"),
  JSON.stringify({ donors: donorNotices, packages, missing }, null, 2) + "\n",
);
console.log(JSON.stringify({ packages: packages.length, missing }));
assert.equal(missing.length, 0, "Missing dependency license texts");
