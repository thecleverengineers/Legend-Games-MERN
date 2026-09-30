import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GAMES } from "../services/games.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const required = [
  "README.md",
  "MIGRATION.md",
  "FEATURE_PARITY.md",
  "PM2_DEPLOY.md",
  "LEGACY_REFERENCE.md",
  "ecosystem.config.cjs",
  "client/src/main.jsx",
  "server/index.js",
  "server/worker.js",
  "server/routes/api.js",
  "server/models/index.js",
  "src/routes/web.js",
  "src/server.js",
  "src/public",
];

const exists = async (relative) =>
  fs
    .access(path.join(root, relative))
    .then(() => true)
    .catch(() => false);
const walk = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const children = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory() ? walk(path.join(directory, entry.name)) : 1,
    ),
  );
  return children.reduce((total, count) => total + count, 0);
};

const missing = [];
for (const item of required) if (!(await exists(item))) missing.push(item);
const missingGameAssets = [];
for (const game of GAMES) {
  const asset = game.image?.replace(/^\//, "");
  if (asset && !(await exists(path.join("src/public", asset))))
    missingGameAssets.push({ game: game.id, asset: game.image });
}
const summary = {
  ok: missing.length === 0 && missingGameAssets.length === 0,
  legacySourceFiles: await walk(path.join(root, "src")),
  publicAssetFiles: await walk(path.join(root, "src", "public")),
  reactSourceFiles: await walk(path.join(root, "client", "src")),
  serverSourceFiles: await walk(path.join(root, "server")),
  games: GAMES.length,
  missing,
  missingGameAssets,
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
