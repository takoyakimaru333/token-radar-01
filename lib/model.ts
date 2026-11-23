// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board.
//
// Implied value is calibrated from the snapshot itself, not asserted. Protocols that already trade
// reveal what the market pays per dollar of TVL in each category: the ratio market cap / TVL. The
// model works in log space (ratios span orders of magnitude, so the centre it takes is the
// geometric median) and shrinks each category toward the global centre (weight SHRINK_K peers),
// because a median over three peers is a hint, not a measurement. It also fits, from the same
// peers, how much less the market pays per TVL dollar the larger a protocol is: a single size
// slope, estimated within categories and clamped to [-0.8, 0], applied against each category's
// own typical size. A pre-token protocol is then valued as if its category's market applied to it:
//
//   logMultiple = (peers x (category_median_log + beta x (logTVL - category_median_logTVL))
//                + SHRINK_K x (global_median_log + beta x (logTVL - global_median_logTVL)))
//                / (peers + SHRINK_K)     (peer ratios winsorised at their 95th percentile first)
//   base       = tvl_usd x 10^logMultiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// The model grades itself on the same snapshot: every trading peer is priced blind, left out of
// its own calibration, and the miss against its actual market cap is measured (validateModel).
// The dashboard states those measured errors and each row's range is that measured factor, so
// any reader can re-derive every number on the board, including how wrong it usually is.
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// states the calibration table it derived.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  shrink_k: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: what the snapshot's trading protocols say a TVL dollar is worth. */
export interface CategoryCalibration {
  category: string;
  peers: number;
  /** The geometric median of the peers' ratios: the centre in log space, back in ratio units. */
  median_ratio: number;
  /** The multiple at the category's own typical size: its shrunk geometric median. */
  multiple: number;
  /** The category's typical size: the median of its peers' log10(TVL). */
  median_log_tvl: number;
}

/** The whole calibration derived from one snapshot. */
export interface Calibration {
  global_median: number;
  peer_count: number;
  shrink_k: number;
  ratio_cap: number;
  /** The fitted size slope: how many log10 of ratio a log10 of TVL costs, within categories. */
  beta: number;
  /** The market's typical size: the median of all peers' log10(TVL). */
  global_median_log_tvl: number;
  categories: CategoryCalibration[];
}

/**
 * The model's report card on one snapshot: every trading peer priced blind (left out of its
 * own calibration) and the miss against its actual market cap, in log10. median_factor is
 * 10^median_abs_log_error: half of the blind prices landed within that factor of the truth.
 */
export interface Validation {
  peers: number;
  median_abs_log_error: number;
  median_factor: number;
  within_2x_pct: number;
  within_3x_pct: number;
  beta: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    size_multiplier: number;
    peer_count: number;
    peer_median: number | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  category_multiple: number;
  size_multiplier: number;
  peer_count: number;
  peer_median: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  why: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  validation: Validation;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The nearest-rank percentile of a non-empty list: the smallest value at or above rank q. */
function percentile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

/**
 * One row's derivation in a single sentence, for the dashboard's detail view: where the
 * multiple came from, what growth and maturity did to it, and the number they produce.
 * The sentence is generated from the row's own model block, so it cannot drift from the
 * arithmetic that priced the row.
 */
export function explainRow(row: BoardRow): string {
  const m = row.model;
  const origin = m.peer_count > 0
    ? `a multiple of ${m.category_multiple} calibrated on ${m.peer_count} trading peer${m.peer_count === 1 ? '' : 's'} in ${row.category ?? 'its category'}`
    : `the global median multiple of ${m.category_multiple}, because no protocol in ${row.category ?? 'its category'} trades in this snapshot`;
  const growth = m.growth_pct === 0 ? 'no seven-day growth adjustment' : `a ${m.growth_pct}% seven-day move (x${m.growth_multiplier})`;
  const size = Math.abs(m.size_multiplier - 1) < 0.01 ? 'no size adjustment' : `a size factor of x${m.size_multiplier} for its TVL against its category's typical size`;
  return `${row.name} is priced from ${origin}, ${size}, ${growth} and a maturity factor of x${m.maturity_multiplier} for ${m.age_days === null ? 'an unknown time' : `${m.age_days} days`} with no token on record.`;
}

/** One peer in log space: its category, its winsorised log ratio and its log TVL. */
interface PeerLog {
  category: string;
  logRatio: number;
  logTvl: number;
}

/**
 * What the snapshot's own trading protocols say a dollar of TVL is worth, per category.
 * Peers are protocols with a recorded market cap; their ratio is mcap / TVL. The centre is
 * taken in log space (the geometric median) because ratios span orders of magnitude, and each
 * category is shrunk toward the global centre so thin categories borrow the market's centre
 * instead of swinging on two or three prints. The size slope is fitted on the same peers,
 * within categories: how much of the log ratio a log of TVL costs, pooled across categories
 * so no thin category fits its own noise, and clamped to [-0.8, 0] — larger protocols never
 * pay more per dollar for being larger, and the slope never runs away on a strange snapshot.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  return calibrateFrom(snapshot.protocols, model);
}

/** calibrate() over an explicit protocol list: the holdout validation prices peers one by one. */
function calibrateFrom(protocols: SnapshotProtocol[], model: ModelConstants): Calibration {
  const raw: { category: string; ratio: number; tvl: number }[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    raw.push({ category: p.category ?? '', ratio, tvl: p.tvl_usd });
  }
  // Winsorise at the 95th percentile: a handful of peers print ratios in the tens or hundreds
  // because their recorded TVL is a sliver of their business. Left raw, one such print would set
  // a whole category's price; capped at the 95th percentile it still counts, at the edge of what
  // the market demonstrably pays.
  const cap = raw.length > 0 ? percentile(raw.map((r) => r.ratio), 0.95) : 0.25;
  const peers: PeerLog[] = raw.map((r) => ({
    category: r.category,
    logRatio: Math.log10(Math.min(r.ratio, cap)),
    logTvl: Math.log10(r.tvl),
  }));
  const byCategory = new Map<string, PeerLog[]>();
  for (const peer of peers) {
    const list = byCategory.get(peer.category);
    if (list === undefined) byCategory.set(peer.category, [peer]);
    else list.push(peer);
  }
  const globalLogMedian = peers.length > 0 ? median(peers.map((p) => p.logRatio)) : Math.log10(0.25);
  const globalLogTvl = peers.length > 0 ? median(peers.map((p) => p.logTvl)) : 0;
  // The within-category slope: demean each peer by its own category's means, then pool.
  let num = 0;
  let den = 0;
  for (const list of byCategory.values()) {
    const mx = list.reduce((a, p) => a + p.logTvl, 0) / list.length;
    const my = list.reduce((a, p) => a + p.logRatio, 0) / list.length;
    for (const p of list) {
      num += (p.logTvl - mx) * (p.logRatio - my);
      den += (p.logTvl - mx) ** 2;
    }
  }
  const beta = den > 0 ? Math.max(-0.8, Math.min(0, num / den)) : 0;
  const categories: CategoryCalibration[] = [];
  for (const [category, list] of byCategory) {
    const medLog = median(list.map((p) => p.logRatio));
    const medLogTvl = median(list.map((p) => p.logTvl));
    // The anchor multiple: the shrunk centre at the category's own typical size, where the
    // category's slope term is zero and the global term is priced at that same size.
    const globalAtAnchor = globalLogMedian + beta * (medLogTvl - globalLogTvl);
    const anchorLog = (list.length * medLog + model.shrink_k * globalAtAnchor) / (list.length + model.shrink_k);
    categories.push({
      category,
      peers: list.length,
      median_ratio: round4(10 ** medLog),
      multiple: round4(10 ** anchorLog),
      median_log_tvl: round4(medLogTvl),
    });
  }
  categories.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return {
    global_median: round4(10 ** globalLogMedian),
    peer_count: peers.length,
    shrink_k: model.shrink_k,
    ratio_cap: round4(cap),
    beta: round4(beta),
    global_median_log_tvl: round4(globalLogTvl),
    categories,
  };
}

/**
 * The multiple one protocol carries at its own TVL: its category's shrunk centre, moved by the
 * size slope from the category's typical size to this protocol's size. The slope term is the
 * same in the category part and the global part of the blend, so the size multiplier factors
 * out exactly: 10^(beta x (logTVL - the anchor's median logTVL)), 1 when TVL is not positive.
 */
function multipleFor(
  cal: Calibration,
  category: string | null,
  tvl: number,
): { multiple: number; anchorMultiple: number; sizeMultiplier: number; peers: number; medianRatio: number | null } {
  const hit = cal.categories.find((c) => c.category === (category ?? ''));
  const anchorLogTvl = hit !== undefined ? hit.median_log_tvl : cal.global_median_log_tvl;
  // Rounded to the same 4 places the board publishes: the dashboard recomputes each row from
  // the published anchor multiple and size multiplier, and the two must agree to the dollar.
  const sizeMultiplier = tvl > 0 ? round4(10 ** (cal.beta * (Math.log10(tvl) - anchorLogTvl))) : 1;
  if (hit !== undefined) {
    return { multiple: hit.multiple * sizeMultiplier, anchorMultiple: hit.multiple, sizeMultiplier, peers: hit.peers, medianRatio: hit.median_ratio };
  }
  return { multiple: cal.global_median * sizeMultiplier, anchorMultiple: cal.global_median, sizeMultiplier, peers: 0, medianRatio: null };
}

/** The multipliers and the implied value one protocol gets under `model` and `cal`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  cal: Calibration,
): { implied: number; multiple: number; anchorMultiple: number; sizeMultiplier: number; peers: number; medianRatio: number | null; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const priced = multipleFor(cal, protocol.category, protocol.tvl_usd);
  const base = protocol.tvl_usd * priced.multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple: priced.multiple, anchorMultiple: priced.anchorMultiple, sizeMultiplier: priced.sizeMultiplier, peers: priced.peers, medianRatio: priced.medianRatio, growthPct, growthMult, maturityMult, age };
}

/**
 * The model graded on its own snapshot: every trading peer with a real market cap is priced
 * blind — recalibrated without it, then priced by the same function that prices the board —
 * and the miss against its actual market cap is collected. Exchange peers are left out of the
 * targets (the board never ranks exchanges) but stay in the calibration pool, as they do when
 * the board is priced. This is the number the dashboard quotes and the rows' ranges come from:
 * measured on this snapshot, not asserted from another one.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const targets = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const errors: number[] = [];
  for (const target of targets) {
    const rest = snapshot.protocols.filter((p) => p.slug !== target.slug);
    const cal = calibrateFrom(rest, model);
    const v = impliedValue(target, snapshot.as_of, model, cal);
    errors.push(Math.abs(Math.log10(v.implied / target.mcap_usd!)));
  }
  if (errors.length === 0) {
    return { peers: 0, median_abs_log_error: 0, median_factor: 1, within_2x_pct: 0, within_3x_pct: 0, beta: calibrate(snapshot, model).beta };
  }
  const med = median(errors);
  const within = (factor: number): number => Math.round((errors.filter((e) => e < Math.log10(factor)).length / errors.length) * 100);
  return {
    peers: errors.length,
    median_abs_log_error: round4(med),
    median_factor: Math.round(10 ** med * 100) / 100,
    within_2x_pct: within(2),
    within_3x_pct: within(3),
    beta: calibrate(snapshot, model).beta,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are asset wrappers, not farmable protocols: their TVL is another asset in transit. */
const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool, not a wrapper. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !(p.category !== null && WRAPPER_CATEGORIES.has(p.category));
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const cal = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, cal);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.anchorMultiple,
      size_multiplier: round4(s.sizeMultiplier),
      peer_count: s.peers,
      peer_median: s.medianRatio,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Where else the protocol runs, for plans that should not pretend it lives on one chain. */
function alsoOn(p: SnapshotProtocol): string {
  return p.chains.length > 1 ? ` (it also runs on ${p.chains.slice(1, 3).join(' and ')})` : '';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment')) return `Fund $${capital} and make one real payment through ${name}'s app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly action that keeps a position qualifying, in the category's own terms. */
function weeklyFor(p: SnapshotProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Once a week, borrow a small amount against the supplied collateral on ${name} and repay it within the day, so both sides of the market carry your wallet's history.`;
  if (c.includes('dex')) return `Once a week, add or rebalance about $${Math.max(10, Math.round(capital / 5))} in the same pool on ${name}, so the position is a working one and not a single forgotten deposit.`;
  if (c.includes('curator') || c.includes('allocator')) return `Once a week, check the vault's allocation on ${name} and move a small part of the deposit to a second vault of the same curator if one is open, so the curator's records show an active allocator.`;
  if (c.includes('rwa')) return `Once a week, mint or redeem a small amount (about $${Math.max(10, Math.round(capital / 5))}) on ${name}, so both directions of the asset are on record for your wallet.`;
  if (c.includes('staking') || c.includes('restak')) return `Once a week, claim the staking rewards on ${name} and restake them, so the position compounds and the wallet shows continuing activity.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Once a week, open and close one small hedge on ${name} and check the funding rate first: skip the week when funding costs more than the position earns.`;
  if (c.includes('stable')) return `Once a week, mint or redeem a small amount on ${name} so the wallet's history shows use of the stable asset, not only a deposit.`;
  if (c.includes('insurance')) return `Once a week, check the cover on ${name} is still active and extend it before it lapses if the position is still open.`;
  if (c.includes('payment')) return `Once a week, make one real payment through ${name}'s app, the activity a payments protocol counts.`;
  return `Make one qualifying action each week on ${name}, such as a deposit, a swap or a vote, so the wallet's history is continuous.`;
}

/**
 * The risk that belongs to this category, in its own terms. Every plan names the way its own
 * position can lose money, because a plan that lists only rewards teaches the reader to skip
 * the one step that protects the rest: liquidation for lenders, impermanent loss for pools,
 * depeg for stables, redemption queues for real-world assets, and so on down the categories.
 */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Know the liquidation line before you supply: if the collateral behind your position on ${name} falls to its liquidation threshold, the position is sold automatically and at a penalty, so keep the loan-to-value low enough to survive a bad week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged')) return `Price both sides of the pool before you add liquidity on ${name}: when the pair moves apart, the pool hands you more of the falling asset (impermanent loss), and a week of fees may not repay a hard move.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Size the hedge so a liquidation cannot take the whole deposit: on ${name} a leveraged position is closed automatically at its maintenance margin, and funding can charge you every hour you hold it.`;
  if (c.includes('staking') || c.includes('restak')) return `Read the unbonding period and the slashing terms on ${name} before you stake: the receipt asset can trade below the staked asset, and a validator's fault can be charged to everyone who delegated to it.`;
  if (c.includes('curator') || c.includes('allocator')) return `Check what the vault on ${name} actually holds before you deposit: a curator allocates other people's money into markets it chooses, and losses in those markets are shared by the vault's depositors.`;
  if (c.includes('rwa')) return `Check the redemption terms on ${name} before you mint: real-world assets often redeem on a schedule, sometimes with identity checks, so the position may not be sellable the week you want out.`;
  if (c.includes('prediction')) return `Treat the stake on ${name} as money that can go to zero: a prediction position pays only if the outcome lands your way, and most markets settle at nothing for the losing side.`;
  if (c.includes('stable')) return `Hold only what you can afford to see depeg: the stable asset behind ${name} is a promise backed by reserves you cannot audit from the app, and stablecoins have broken their peg before.`;
  if (c.includes('bridge')) return `Move a test amount across ${name} first and wait for it to arrive: bridges hold the original asset in a contract while the copy travels, and that contract is the part that gets attacked.`;
  if (c.includes('insurance')) return `Read what the cover on ${name} actually pays for before you rely on it: most policies name specific failures, and a loss outside the wording is not compensated.`;
  return `Keep the position on ${name} small enough that a contract failure is survivable: an unaudited or freshly upgraded contract is the standing risk of every pre-token protocol, whatever its category.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names: the opening action and the weekly action follow the category, the capital follows the
 * TVL tier, the hold follows the age, and one step is the safety rule every pre-token farm
 * needs, because unlaunched protocols are the most impersonated.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${action.replace(/\.$/, '')}${alsoOn(p)}.`,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p, capital),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: riskFor(p),
      cost: 'nothing to check, and it sizes every other step',
      time: '10 minutes, before the first deposit',
    },
    {
      text: `Never sign a claim, an airdrop check or an approval from a search result, an ad or a direct message: a protocol with no token yet is the easiest to impersonate, so reach ${p.name} only through its own app.`,
      cost: 'nothing, and it protects the whole position',
      time: 'every time, before signing',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/**
 * A board row's compact form for data.js, with the farm plan generated in the page. The range
 * is the model's measured holdout factor from validateModel: half of the trading peers this
 * same function priced blind landed within that factor of their actual market cap, so the
 * range is a measured error band on this snapshot, not a round-number sensitivity.
 */
export function radarRow(row: BoardRow, watchlist: ReadonlySet<string>, factor: number): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: Math.max(1, Math.round(row.implied_value_usd / factor)),
    implied_high_usd: Math.round(row.implied_value_usd * factor),
    category_multiple: row.model.category_multiple,
    size_multiplier: row.model.size_multiplier,
    peer_count: row.model.peer_count,
    peer_median: row.model.peer_median,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
    why: explainRow(row),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const cal = calibrate(snapshot, model);
  const validation = validateModel(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration: cal,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((row) => radarRow(row, new Set(snapshot.watchlist), validation.median_factor)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
