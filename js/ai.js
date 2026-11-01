// CPU 思考
// - 牌効率: シャンテン数 → 有効牌枚数 (残り枚数で重み付け)
// - 上級: 一向聴時に「聴牌時の待ち枚数」まで読む 2 手先評価
// - 守備: 現物/筋/壁/字牌の見え枚数から放銃率を推定し、手の価値と
//         シャンテン数に応じて押し引きの重みを変える
// - 鳴き: 役 (役牌・断幺九・染め・対々) の見込みがあり前進する場合のみ

import { kindOf, isRed, isHonor, isDragon, isYaochu, isSimple, suitOf, numOf, doraFromIndicator, idsToCounts } from './tile.js';
import { shanten, ukeire, waits } from './shanten.js';
import { evaluate } from './yaku.js';
import { combinedDanger, threatLevel } from './danger.js';

export const LEVELS = {
  easy: { label: 'やさしい', defense: 0, lookahead: false, noise: 0.25, callSmart: false },
  normal: { label: 'ふつう', defense: 1, lookahead: false, noise: 0.03, callSmart: true },
  hard: { label: 'つよい', defense: 2, lookahead: true, noise: 0, callSmart: true },
};

// ---- 手牌評価ユーティリティ (UI のヒントからも使う) ----

export function doraKinds(game) {
  return game.doraIndicators.map((id) => doraFromIndicator(kindOf(id)));
}

function isYakuhai(game, seat, k) {
  return isDragon(k) || k === game.seatWind(seat) || k === game.roundWindKind;
}

// 打牌候補ごとの効率評価
export function analyzeDiscards(game, seat, { lookahead = false, forbidden = [] } = {}) {
  const p = game.players[seat];
  const counts = idsToCounts(p.hand);
  const remaining = game.remainingFor(seat);
  const mc = p.melds.length;
  const doras = doraKinds(game);
  const out = [];
  const seen = new Set();
  for (const id of p.hand) {
    const k = kindOf(id);
    if (forbidden.includes(k)) continue;
    // 赤5 は普通の5より後に切る
    const key = k * 2 + (isRed(id) ? 1 : 0);
    if (seen.has(key)) continue;
    seen.add(key);
    counts[k]--;
    const s = shanten(counts, mc);
    const uk = ukeire(counts, mc, remaining, s);
    let quality = uk.total;
    let waitInfo = null;
    if (s === 0) {
      const w = waits(counts, mc);
      const left = w.reduce((a, x) => a + remaining[x], 0);
      waitInfo = { kinds: w, left };
      quality = left;
    } else if (lookahead && s === 1) {
      quality = uk.total + 0.35 * tenpaiQuality(counts, mc, remaining, uk.tiles);
    }
    counts[k]++;
    out.push({
      id,
      k,
      shanten: s,
      ukeire: uk.total,
      ukTiles: uk.tiles,
      quality,
      waitInfo,
      value: tileKeepValue(game, seat, p, counts, k, id, doras),
    });
  }
  return out;
}

// 一向聴から各有効牌を引いた時の最良聴牌の待ち枚数の加重平均
function tenpaiQuality(counts, mc, remaining, ukTiles) {
  let sum = 0,
    weight = 0;
  for (const d of ukTiles) {
    const r = remaining[d];
    if (r <= 0) continue;
    counts[d]++;
    remaining[d]--;
    let best = 0;
    for (let k = 0; k < 34; k++) {
      if (!counts[k]) continue;
      counts[k]--;
      if (shanten(counts, mc) === 0) {
        const w = waits(counts, mc);
        const left = w.reduce((a, x) => a + remaining[x], 0);
        if (left > best) best = left;
      }
      counts[k]++;
    }
    remaining[d]++;
    counts[d]--;
    sum += best * r;
    weight += r;
  }
  return weight ? sum / weight : 0;
}

// 牌を手に残す価値 (大きいほど切りたくない)
function tileKeepValue(game, seat, p, counts, k, id, doras) {
  let v = 0;
  const c = counts[k];
  if (doras.includes(k)) v += 1.5;
  if (isRed(id)) v += 1.5;
  if (isHonor(k)) {
    if (isYakuhai(game, seat, k)) v += c >= 2 ? 3 : 0.4;
    else v -= 0.3; // オタ風は早めに
    if (c === 1) v -= 0.2;
  } else {
    const n = numOf(k);
    if (n === 1 || n === 9) v -= 0.25;
    else if (n === 2 || n === 8) v -= 0.1;
  }
  return v;
}

// おおよその打点 (翻数の見込み)
export function estimateHan(game, seat) {
  const p = game.players[seat];
  const doras = doraKinds(game);
  let han = 0;
  const all = [...p.hand];
  for (const m of p.melds) all.push(...m.ids);
  for (const id of all) {
    if (doras.includes(kindOf(id))) han++;
    if (isRed(id)) han++;
  }
  const c = idsToCounts(all);
  for (let k = 27; k < 34; k++) if (c[k] >= 3 && isYakuhai(game, seat, k)) han++;
  if (game.isMenzen(p)) han += 1;
  return han;
}

// 鳴いた後の手に役の見込みがあるか
function yakuPath(game, seat, counts, melds) {
  // counts: 鳴き後の手牌, melds: [{type,k}]
  const all = counts.slice();
  for (const m of melds) {
    if (m.type === 'chi') {
      all[m.k]++;
      all[m.k + 1]++;
      all[m.k + 2]++;
    } else all[m.k] += 3;
  }
  // 役牌刻子 (確定) / 役牌対子 (見込み)
  for (let k = 27; k < 34; k++) {
    if (!isYakuhai(game, seat, k)) continue;
    if (melds.some((m) => m.type !== 'chi' && m.k === k)) return 'yakuhai';
    if (counts[k] >= 2) return 'yakuhai-pair';
  }
  // 断幺九: 副露がすべて中張牌で、手牌の幺九牌が 2 枚以下
  if (melds.every((m) => (m.type === 'chi' ? numOf(m.k) >= 2 && numOf(m.k) <= 6 : isSimple(m.k)))) {
    let y = 0;
    for (let k = 0; k < 34; k++) if (isYaochu(k)) y += counts[k];
    if (y <= 2) return 'tanyao';
  }
  // 染め手: 1 色 + 字牌が 11 枚以上
  for (let s = 0; s < 3; s++) {
    let n = 0;
    for (let k = 0; k < 34; k++) if (suitOf(k) === s || isHonor(k)) n += all[k];
    const total = all.reduce((a, b) => a + b, 0);
    if (n >= total - 2 && melds.every((m) => suitOf(m.k) === s || isHonor(m.k))) return 'flush';
  }
  // 対々和
  if (melds.every((m) => m.type !== 'chi')) {
    let pairs = 0;
    for (let k = 0; k < 34; k++) if (counts[k] >= 2) pairs++;
    if (pairs + melds.length >= 4) return 'toitoi';
  }
  return null;
}

// 13 枚の聴牌形に役があるか (ロン想定、門前ならリーチで役が付く)
function hasYakuOnWaits(game, seat, counts, waitKinds) {
  const p = game.players[seat];
  if (game.isMenzen(p)) return true;
  for (const w of waitKinds) {
    const c = counts.slice();
    c[w]++;
    const r = evaluate({
      hand: c,
      melds: p.melds.map((m) => ({ type: m.type, k: m.k })),
      winTile: w,
      isTsumo: false,
      seatWind: game.seatWind(seat),
      roundWind: game.roundWindKind,
      doraIndicators: [],
      uraIndicators: [],
      allIds: [],
      isDealer: false,
    });
    if (r) return true;
  }
  return false;
}

// 押し引きの重み: 危険度(%) 1 あたりの減点
function foldWeight(game, seat, best) {
  const est = estimateHan(game, seat);
  const s = best.shanten;
  const wall = game.wallRemaining;
  if (s <= 0) {
    const goodWait = best.waitInfo && best.waitInfo.left >= 5;
    if (est >= 3 || goodWait) return 2.5;
    return 6;
  }
  if (s === 1) {
    if (est >= 3 && wall > 20) return 8;
    return 20;
  }
  return 60;
}

// 総合的な打牌選択
export function chooseDiscard(game, seat, level, forbidden = []) {
  const L = LEVELS[level] || LEVELS.normal;
  const cands = analyzeDiscards(game, seat, { lookahead: L.lookahead, forbidden });
  if (!cands.length) return { id: game.players[seat].hand[0], cands };
  const minS = Math.min(...cands.map((c) => c.shanten));
  const cache = {};
  let threatSum = 0;
  for (let i = 1; i < 4; i++) {
    const t = (seat + i) % 4;
    const th = L.defense >= 2 ? threatLevel(game, seat, t) : game.players[t].riichi ? 1 : 0;
    if (th >= 0.3) threatSum += th;
  }
  const bestEff = cands.filter((c) => c.shanten === minS).sort((a, b) => b.quality - a.quality)[0];
  const W = L.defense > 0 && threatSum > 0 ? foldWeight(game, seat, bestEff) : 0;
  const p = game.players[seat];
  for (const c of cands) {
    let score = -c.shanten * 100 + c.quality - c.value * 2;
    // 鳴き手で役が無くなる聴牌は低評価
    if (c.shanten === 0 && c.waitInfo && !game.isMenzen(p)) {
      const counts = idsToCounts(p.hand);
      counts[c.k]--;
      if (!hasYakuOnWaits(game, seat, counts, c.waitInfo.kinds)) score -= 60;
    }
    if (W > 0) {
      let risk;
      if (L.defense >= 2) risk = combinedDanger(game, seat, c.k, cache).pct;
      else {
        // ふつう: 現物かどうかだけを見る簡易守備
        risk = 0;
        for (let i = 1; i < 4; i++) {
          const t = (seat + i) % 4;
          if (!game.players[t].riichi) continue;
          const safe = game.players[t].discards.some((d) => kindOf(d.id) === c.k);
          risk += safe ? 0 : isHonor(c.k) ? 4 : 9;
        }
      }
      c.risk = risk;
      score -= risk * W;
    }
    if (L.noise) score += (game.rng() - 0.5) * 200 * L.noise;
    c.score = score;
  }
  cands.sort((a, b) => b.score - a.score);
  return { id: cands[0].id, cands };
}

export class CpuAgent {
  constructor(level = 'normal') {
    this.level = level;
    this.L = LEVELS[level] || LEVELS.normal;
  }

  async selfAction(game, seat, opts) {
    const p = game.players[seat];
    if (opts.tsumo) return { type: 'tsumo' };
    if (opts.kyuushu) {
      const c = idsToCounts(p.hand);
      let y = 0;
      for (let k = 0; k < 34; k++) if (isYaochu(k) && c[k]) y++;
      if (y < 11 || this.level === 'easy') return { type: 'kyuushu' };
    }
    if (p.riichi) {
      if (opts.kans.length) return { type: 'kan', ...opts.kans[0] };
      return { type: 'discard', id: p.drawn };
    }
    // 槓: シャンテン数が変わらず、リーチ者がいない時だけ
    for (const kan of opts.kans) {
      if (this.level === 'easy' || this.kanKeepsShape(game, seat, kan)) {
        if (game.players.some((q) => q.riichi && q.seat !== seat) && this.level === 'hard') continue;
        return { type: 'kan', ...kan };
      }
    }
    const { id, cands } = chooseDiscard(game, seat, this.level, opts.forbidden);
    let riichi = false;
    if (opts.riichi.includes(id)) {
      const c = cands.find((x) => x.id === id);
      const left = c && c.waitInfo ? c.waitInfo.left : 0;
      riichi = left > 0;
      if (this.level === 'hard' && left > 0) {
        // 終盤の悪待ちリーチや、リーチ者への無筋押しは控えめに
        if (game.wallRemaining < 8 && left <= 2) riichi = false;
      }
    }
    return { type: 'discard', id, riichi };
  }

  kanKeepsShape(game, seat, kan) {
    const p = game.players[seat];
    const counts = idsToCounts(p.hand);
    const mc = p.melds.length;
    // 打牌後の最良シャンテン vs 槓後
    let before = 99;
    for (let k = 0; k < 34; k++) {
      if (!counts[k]) continue;
      counts[k]--;
      before = Math.min(before, shanten(counts, mc));
      counts[k]++;
    }
    const c2 = counts.slice();
    if (kan.type === 'ankan') {
      c2[kan.k] -= 4;
      return shanten(c2, mc + 1) <= before;
    }
    c2[kan.k] -= 1;
    return shanten(c2, mc) <= before;
  }

  async respond(game, seat, tileId, fromSeat, opts) {
    if (opts.ron) return { type: 'ron' };
    const p = game.players[seat];
    const k = kindOf(tileId);
    const counts = idsToCounts(p.hand);
    const mc = p.melds.length;
    const cur = shanten(counts, mc);
    const meldsBase = p.melds.map((m) => ({ type: m.type, k: m.k }));
    const threat = game.players.some((q) => q.riichi && q.seat !== seat);
    let best = null;
    const tryCall = (type, ids) => {
      const c = counts.slice();
      for (const id of ids) c[kindOf(id)]--;
      const start = type === 'chi' ? Math.min(k, ...ids.map(kindOf)) : k;
      const melds = [...meldsBase, { type, k: start }];
      // 鳴き後の最良打牌でのシャンテン
      let after = 99;
      for (let x = 0; x < 34; x++) {
        if (!c[x]) continue;
        c[x]--;
        after = Math.min(after, shanten(c, mc + 1));
        c[x]++;
      }
      if (after >= cur) return;
      const path = yakuPath(game, seat, c, melds);
      const yakuhaiPon = type === 'pon' && isHonor(k) && isYakuhai(game, seat, k);
      if (this.L.callSmart) {
        if (!yakuhaiPon && !path) return;
        if (!yakuhaiPon && path === 'yakuhai-pair' && after > 2) return;
        if (!yakuhaiPon && after >= 3 && game.isMenzen(p)) return; // 遠い仕掛けは避ける
        if (threat && after >= 1 && this.level === 'hard') return;
      } else {
        if (!yakuhaiPon && !path && game.rng() < 0.7) return;
        if (game.rng() < 0.3) return;
      }
      const score = (cur - after) * 10 + (yakuhaiPon ? 5 : 0);
      if (!best || score > best.score) best = { type, ids, score };
    };
    for (const ids of opts.pon) tryCall('pon', ids);
    for (const ids of opts.chi) tryCall('chi', ids);
    if (best) return { type: best.type, ids: best.ids };
    return { type: 'pass' };
  }
}
