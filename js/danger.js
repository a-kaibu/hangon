// 危険度推定 (押し引き・危険牌ヒント用)
// 現物 / 筋 / 壁 (ノーチャンス) / 字牌の見え枚数 などから
// 「その牌で放銃する確率(%)」の目安を返す。数値は公開されている
// 統計(対リーチ時の牌種別放銃率)のおおよその傾向に基づく概算。

import { kindOf, isHonor, numOf, isDragon, doraFromIndicator } from './tile.js';

// 相手 target が「安全」と分かっている牌 (現物)
export function safeKinds(game, target) {
  const t = game.players[target];
  const safe = new Set();
  for (const d of t.discards) safe.add(kindOf(d.id));
  if (t.riichi) {
    // リーチ後に他家が切って見逃した牌も現物
    const seq = game.discardLog || [];
    for (const e of seq) {
      if (e.afterRiichiOf && e.afterRiichiOf.includes(target)) safe.add(kindOf(e.id));
    }
  }
  return safe;
}

// 1 相手に対する危険度 (%) と理由
export function tileDanger(game, viewer, target, k, visible, safe) {
  safe = safe || safeKinds(game, target);
  visible = visible || game.visibleCounts(viewer);
  if (safe.has(k)) return { pct: 0, reason: '現物', tag: '現物' };
  const doras = game.doraIndicators.map((id) => doraFromIndicator(kindOf(id)));
  const doraMul = doras.includes(k) ? 1.3 : 1;
  if (isHonor(k)) {
    const left = 4 - visible[k];
    const yakuhai = isDragon(k) || k === game.seatWind(target) || k === game.roundWindKind;
    let pct, reason;
    if (left <= 0) {
      pct = 0;
      reason = '4枚見え';
    } else if (left === 1) {
      pct = 1.0;
      reason = '字牌ラス1 (単騎のみ)';
    } else if (left === 2) {
      pct = 3.0;
      reason = '字牌2枚見え';
    } else if (left === 3) {
      pct = yakuhai ? 6.5 : 5.0;
      reason = '字牌1枚見え';
    } else {
      pct = yakuhai ? 9.0 : 7.0;
      reason = '生牌 (まだ見えていない字牌)';
    }
    return { pct: pct * doraMul, reason, tag: left <= 2 ? '字牌' : '字牌注意' };
  }
  const n = numOf(k);
  const base = k - (n - 1);
  const kindAt = (nn) => base + nn - 1;
  const noChance = (nn) => nn < 1 || nn > 9 || visible[kindAt(nn)] >= 4; // 壁
  const oneChance = (nn) => nn >= 1 && nn <= 9 && visible[kindAt(nn)] === 3;
  // 両面待ちの形: 低い側 (n-2,n-1) で待ち n-3/n, 高い側 (n+1,n+2) で待ち n/n+3
  const sides = [];
  if (n >= 3) sides.push({ shape: [n - 2, n - 1], suji: n - 3 });
  if (n <= 7) sides.push({ shape: [n + 1, n + 2], suji: n + 3 });
  let open = 0,
    sujiKilled = 0,
    kabeKilled = 0,
    oneCh = 0;
  for (const s of sides) {
    const bySuji = s.suji >= 1 && s.suji <= 9 && safe.has(kindAt(s.suji));
    const byKabe = noChance(s.shape[0]) || noChance(s.shape[1]);
    if (bySuji) sujiKilled++;
    else if (byKabe) kabeKilled++;
    else {
      open++;
      if (oneChance(s.shape[0]) || oneChance(s.shape[1])) oneCh++;
    }
  }
  const edge = n === 1 || n === 9 ? 0 : n === 2 || n === 8 ? 1 : n === 3 || n === 7 ? 2 : 3;
  let pct, reason, tag;
  if (open === 0) {
    // 両面には当たらない: 嵌張・辺張・双碰・単騎のみ
    const kill = sujiKilled && kabeKilled ? '筋+壁' : sujiKilled ? '筋' : '壁(ノーチャンス)';
    pct = [1.8, 3.0, 4.0, 4.0][edge];
    reason = sides.length > 1 ? `両側とも${kill}で両面なし` : `${kill}で両面なし`;
    tag = sujiKilled ? '筋' : '壁';
    if (visible[k] >= 3) {
      pct *= 0.5;
      reason += '・残り1枚';
    }
  } else if (sides.length === 2 && open === 1) {
    pct = 7.0;
    reason = '片筋 (片側の両面だけ残る)';
    tag = '片筋';
    if (oneCh) {
      pct = 5.0;
      reason += '・ワンチャンス';
    }
  } else {
    pct = [5.5, 7.5, 9.0, 12.0][edge];
    if (n === 5) pct = 12.5;
    reason = '無筋';
    tag = '無筋';
    if (oneCh) {
      pct *= 0.7;
      reason += '・ワンチャンス';
    }
  }
  return { pct: pct * doraMul, reason: reason + (doraMul > 1 ? '・ドラ' : ''), tag };
}

// 相手の聴牌気配 (0..1)
export function threatLevel(game, viewer, target) {
  const t = game.players[target];
  if (t.riichi) return 1.0;
  const opens = t.melds.filter((m) => m.type !== 'ankan');
  const turn = t.discards.length;
  if (opens.length >= 3) return 0.7;
  if (opens.length === 2) return turn >= 8 ? 0.5 : 0.3;
  if (opens.length === 1) return turn >= 10 ? 0.3 : 0.12;
  if (turn >= 14) return 0.25;
  if (turn >= 10) return 0.1;
  return 0.03;
}

// 全相手を合算した放銃リスク (%) と、最も危ない相手に対する理由
export function combinedDanger(game, viewer, k, cache = {}) {
  const visible = cache.visible || (cache.visible = game.visibleCounts(viewer));
  let total = 0;
  let worst = null;
  for (let i = 1; i < 4; i++) {
    const target = (viewer + i) % 4;
    const threat = (cache.threat ||= {})[target] ?? (cache.threat[target] = threatLevel(game, viewer, target));
    if (threat < 0.05) continue;
    const safe = (cache.safe ||= {})[target] ?? (cache.safe[target] = safeKinds(game, target));
    const d = tileDanger(game, viewer, target, k, visible, safe);
    const w = threat * d.pct;
    total += w;
    if (!worst || w > worst.weighted) worst = { ...d, target, threat, weighted: w };
  }
  return { pct: total, worst };
}

// UI 用: 危険度レベル 0..3
export function dangerLevel(pct) {
  if (pct <= 0.01) return 0;
  if (pct < 3.5) return 1;
  if (pct < 7) return 2;
  return 3;
}
