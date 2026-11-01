// シャンテン数計算
// 一般形: 各色ごとに (面子数, 塔子数, 雀頭有無) のパレート最適な組を
// メモ化DFSで列挙し、4ブロックを合成する。七対子・国士無双も計算。

import { isYaochu } from './tile.js';

const memo = [new Map(), new Map()]; // [数牌, 字牌]

function encode(a) {
  let k = 0;
  for (let i = 0; i < a.length; i++) k = k * 5 + a[i];
  return k;
}

// 結果: [m, t, p] の配列 (p=雀頭 0/1)
function suitOptions(a, honor) {
  const key = encode(a);
  const mm = memo[honor ? 1 : 0];
  const hit = mm.get(key);
  if (hit) return hit;
  let i = 0;
  while (i < a.length && a[i] === 0) i++;
  let res;
  if (i >= a.length) {
    res = [[0, 0, 0]];
  } else {
    const cand = [];
    const add = (sub, dm, dt, dp) => {
      for (const [m, t, p] of sub) {
        if (p + dp > 1) continue;
        cand.push([m + dm, t + dt, p + dp]);
      }
    };
    if (a[i] >= 3) { a[i] -= 3; add(suitOptions(a, honor), 1, 0, 0); a[i] += 3; }
    if (!honor && i + 2 < 9 && a[i + 1] && a[i + 2]) {
      a[i]--; a[i + 1]--; a[i + 2]--;
      add(suitOptions(a, honor), 1, 0, 0);
      a[i]++; a[i + 1]++; a[i + 2]++;
    }
    if (a[i] >= 2) {
      a[i] -= 2;
      const sub = suitOptions(a, honor);
      add(sub, 0, 0, 1);
      add(sub, 0, 1, 0);
      a[i] += 2;
    }
    if (!honor) {
      if (i + 1 < 9 && a[i + 1]) { a[i]--; a[i + 1]--; add(suitOptions(a, honor), 0, 1, 0); a[i]++; a[i + 1]++; }
      if (i + 2 < 9 && a[i + 2]) { a[i]--; a[i + 2]--; add(suitOptions(a, honor), 0, 1, 0); a[i]++; a[i + 2]++; }
    }
    a[i]--; add(suitOptions(a, honor), 0, 0, 0); a[i]++;
    res = pareto(cand);
  }
  mm.set(key, res);
  return res;
}

function pareto(cand) {
  const out = [];
  for (const c of cand) {
    let dominated = false;
    for (const d of cand) {
      if (d === c) continue;
      if (d[2] === c[2] && d[0] >= c[0] && d[1] >= c[1] && (d[0] > c[0] || d[1] > c[1])) { dominated = true; break; }
    }
    if (!dominated && !out.some((o) => o[0] === c[0] && o[1] === c[1] && o[2] === c[2])) out.push(c);
  }
  return out;
}

export function standardShanten(counts, meldCount = 0) {
  const parts = [
    suitOptions(counts.slice(0, 9), false),
    suitOptions(counts.slice(9, 18), false),
    suitOptions(counts.slice(18, 27), false),
    suitOptions(counts.slice(27, 34), true),
  ];
  let best = 8;
  for (const a of parts[0]) for (const b of parts[1]) {
    const p2 = a[2] + b[2];
    if (p2 > 1) continue;
    for (const c of parts[2]) {
      const p3 = p2 + c[2];
      if (p3 > 1) continue;
      for (const d of parts[3]) {
        const p = p3 + d[2];
        if (p > 1) continue;
        const m = a[0] + b[0] + c[0] + d[0] + meldCount;
        let t = a[1] + b[1] + c[1] + d[1];
        if (m + t > 4) t = 4 - m;
        const s = 8 - 2 * m - t - p;
        if (s < best) best = s;
      }
    }
  }
  return best;
}

export function chiitoiShanten(counts) {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] >= 1) kinds++;
    if (counts[i] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function kokushiShanten(counts) {
  let y = 0, pair = 0;
  for (let i = 0; i < 34; i++) {
    if (!isYaochu(i)) continue;
    if (counts[i] >= 1) y++;
    if (counts[i] >= 2) pair = 1;
  }
  return 13 - y - pair;
}

export function shanten(counts, meldCount = 0) {
  let s = standardShanten(counts, meldCount);
  if (meldCount === 0) {
    s = Math.min(s, chiitoiShanten(counts), kokushiShanten(counts));
  }
  return s;
}

// 和了形か (14枚相当)
export function isAgariShape(counts, meldCount = 0) {
  return shanten(counts, meldCount) === -1;
}

// 13枚相当の手で待ちの種類 (純カラは除く)
export function waits(counts, meldCount = 0) {
  const out = [];
  for (let k = 0; k < 34; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    if (shanten(counts, meldCount) === -1) out.push(k);
    counts[k]--;
  }
  return out;
}

// 受け入れ: 打牌後の13枚に対して、シャンテンを進める牌とその残り枚数
// remaining[k] = 見えていない枚数
export function ukeire(counts, meldCount, remaining, base = null) {
  const s0 = base ?? shanten(counts, meldCount);
  let total = 0;
  const tiles = [];
  for (let k = 0; k < 34; k++) {
    if (remaining[k] <= 0 || counts[k] >= 4) continue;
    counts[k]++;
    const s = shanten(counts, meldCount);
    counts[k]--;
    if (s < s0) { total += remaining[k]; tiles.push(k); }
  }
  return { total, tiles, shanten: s0 };
}
