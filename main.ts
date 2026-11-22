// token-radar-01 entrypoint (Node 22, standard library only).
//
// Pipeline: read the sealed snapshot, score it with the calibrated model in lib/model.ts,
// refuse to hand in a board the gate would refuse, then write the four outputs the scorer
// reads — board.json, data.js for the dashboard, copies of dashboard/ and screenshots/,
// and dossier.json last, because the scorer rebuilds the dossier from the finished output
// directory and compares bytes.
//
//   node main.ts --input <snapshot.json|dir> --output <dir>
//   MAKEFUN_OUTPUT_DIR=<dir> node main.ts        (outside the grader's container)
//
// Defaults follow the grader's mounts: input /input, output /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// The scorer's caps, mirrored so a bad hand-in fails here first with a readable reason
// instead of failing silently at grade time (reference/gate.json).
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const DOSSIER_SCREENSHOTS = { max: 4, max_bytes: 524_288 };
const DOSSIER_DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SCREENSHOTS = 3;

/** One `--name value` or `--name=value` argument, or the fallback when absent. */
function readArg(name: string, fallback: string): string {
  const argv = process.argv;
  const spaced = argv.indexOf(`--${name}`);
  if (spaced >= 0 && spaced + 1 < argv.length) return argv[spaced + 1]!;
  const joined = argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Stop the run with a reason a human can act on. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outputDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);

// The board is the deliverable; if the model's own gate check objects, nothing is written.
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outputDir, { recursive: true });
const boardPath = join(outputDir, 'board.json');
writeFileSync(boardPath, `${JSON.stringify({ rows: board })}\n`);
const dataPath = join(outputDir, 'data.js');
writeFileSync(dataPath, dataScript(radar));

/**
 * Copy a directory's regular files into the output, skipping dotfiles, and return what was
 * copied with byte counts, so the run can report a manifest and police the image caps.
 */
function copyTree(from: string, to: string): { name: string; bytes: number }[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: { name: string; bytes: number }[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    const stat = statSync(source);
    if (!stat.isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push({ name, bytes: stat.size });
  }
  return copied;
}

const dashboardFiles = copyTree(join(ROOT, 'dashboard'), join(outputDir, 'dashboard'));
const shots = copyTree(join(ROOT, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < MIN_SCREENSHOTS) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in at least ${MIN_SCREENSHOTS} — the board, a detail view and a filtered view`);
}
for (const shot of shots) {
  if (!IMAGE_NAME.test(shot.name)) fail(`screenshots/${shot.name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  if (shot.bytes > DOSSIER_SCREENSHOTS.max_bytes) fail(`screenshots/${shot.name} is ${shot.bytes} bytes, over the ${DOSSIER_SCREENSHOTS.max_bytes}-byte cap`);
}

// Written last on purpose: buildDossier reads the finished output directory.
const dossierPath = join(outputDir, 'dossier.json');
writeFileSync(dossierPath, buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES, screenshots: DOSSIER_SCREENSHOTS, dashboard: DOSSIER_DASHBOARD }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${boardPath}, ${dataPath}, dashboard (${dashboardFiles.length} files), screenshots (${shots.length} images) and ${dossierPath}\n`,
);
