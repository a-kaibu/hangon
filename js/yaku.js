// 和了判定・役判定・符計算・点数計算

import {
  isHonor, isYaochu, isSimple, isTerminal, isDragon, isWind, suitOf, numOf,
  doraFromIndicator, HAKU, HATSU, CHUN, EAST, kindOf, isRed,
} from './tile.js';

// ---- 面子分解 ----
// counts: 手牌(副露除く)14枚相当。戻り値: [{head, mentsu:[{type:'shuntsu'|'koutsu', k}]}]
export function decompose(counts) {
  const results = [];
  const c = counts.slice();
  for (let h = 0; h < 34; h++) {
    if (c[h] < 2) continue;
    c[h] -= 2;
    const ms = [];
    extract(c, 0, ms, (m) => results.push({ head: h, mentsu: m.slice() }));
    c[h] += 2;
  }
  return results;
}

function extract(c, i, ms, cb) {
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) { cb(ms); return; }
  if (c[i] >= 3) {
    c[i] -= 3; ms.push({ type: 'koutsu', k: i });
    extract(c, i, ms, cb);
    ms.pop(); c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--; ms.push({ type: 'shuntsu', k: i });
    extract(c, i, ms, cb);
    ms.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

function isChiitoi(counts) {
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 2) pairs++;
    else if (counts[i] !== 0) return false;
  }
  return pairs === 7;
}

function isKokushi(counts) {
  let pair = false;
  for (let i = 0; i < 34; i++) {
    if (isYaochu(i)) {
      if (counts[i] === 0) return false;
      if (counts[i] === 2) pair = true;
      if (counts[i] > 2) return false;
    } else if (counts[i] > 0) return false;
  }
  return pair;
}

const GREEN = new Set([19, 20, 21, 23, 25, HATSU]); // 2346 8索 + 發

// ---- 点数 ----
export function basePoints(han, fu, yakuman) {
  if (yakuman > 0) return 8000 * yakuman;
  if (han >= 13) return 8000;
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han >= 5) return 2000;
  return Math.min(2000, fu * Math.pow(2, han + 2));
}

export function limitName(han, fu, yakuman) {
  if (yakuman >= 2) return `${yakuman}倍役満`;
  if (yakuman === 1) return '役満';
  if (han >= 13) return '数え役満';
  if (han >= 11) return '三倍満';
  if (han >= 8) return '倍満';
  if (han >= 6) return '跳満';
  if (han >= 5 || fu * Math.pow(2, han + 2) >= 2000) return '満貫';
  return '';
}

const up100 = (x) => Math.ceil(x / 100) * 100;

// 支払い計算 (本場・供託は含まない)
export function payment(han, fu, yakuman, isDealer, isTsumo) {
  const b = basePoints(han, fu, yakuman);
  if (!isTsumo) return { ron: up100(b * (isDealer ? 6 : 4)) };
  if (isDealer) return { all: up100(b * 2) };
  return { dealer: up100(b * 2), nonDealer: up100(b) };
}

export function paymentTotal(p) {
  if (p.ron) return p.ron;
  if (p.all) return p.all * 3;
  return p.dealer + p.nonDealer * 2;
}

// ---- 役判定 ----
// ctx: {
//   hand: counts (副露を除く手牌。和了牌を含む), melds: [{type, k, ids}],
//   winTile: kind, isTsumo, seatWind, roundWind, riichi, doubleRiichi, ippatsu,
//   haitei, houtei, rinshan, chankan, tenhou, chiihou,
//   doraIndicators: kinds, uraIndicators: kinds, allIds: 和了者の全牌id (赤ドラ用),
//   isDealer
// }
// meld.type: 'chi' | 'pon' | 'minkan' | 'ankan' | 'kakan'
export function evaluate(ctx) {
  const menzen = ctx.melds.every((m) => m.type === 'ankan');
  const allCounts = ctx.hand.slice();
  for (const m of ctx.melds) {
    if (m.type === 'chi') { allCounts[m.k]++; allCounts[m.k + 1]++; allCounts[m.k + 2]++; }
    else if (m.type === 'pon') allCounts[m.k] += 3;
    else allCounts[m.k] += 4;
  }
  const candidates = [];

  // 状況役
  const situational = [];
  if (ctx.doubleRiichi) situational.push(['ダブル立直', 2]);
  else if (ctx.riichi) situational.push(['立直', 1]);
  if (ctx.ippatsu && ctx.riichi) situational.push(['一発', 1]);
  if (menzen && ctx.isTsumo) situational.push(['門前清自摸和', 1]);
  if (ctx.haitei && ctx.isTsumo && !ctx.rinshan) situational.push(['海底摸月', 1]);
  if (ctx.houtei && !ctx.isTsumo) situational.push(['河底撈魚', 1]);
  if (ctx.rinshan) situational.push(['嶺上開花', 1]);
  if (ctx.chankan) situational.push(['槍槓', 1]);

  const situationalYakuman = [];
  if (ctx.tenhou) situationalYakuman.push(['天和', 1]);
  if (ctx.chiihou) situationalYakuman.push(['地和', 1]);

  // 全体の色・字牌系
  const tileSetYaku = (isChiitoiForm) => {
    const ys = [];
    const ym = [];
    let suits = new Set(), honors = 0, allSimple = true, allYaochu = true, allHonor = true, allGreen = true, allTerminal = true;
    for (let k = 0; k < 34; k++) {
      if (!allCounts[k]) continue;
      if (isHonor(k)) honors++; else suits.add(suitOf(k));
      if (!isSimple(k)) allSimple = false;
      if (!isYaochu(k)) allYaochu = false;
      if (!isHonor(k)) allHonor = false;
      if (!GREEN.has(k)) allGreen = false;
      if (!isTerminal(k)) allTerminal = false;
    }
    if (allHonor) ym.push(['字一色', 1]);
    if (allGreen) ym.push(['緑一色', 1]);
    if (allTerminal) ym.push(['清老頭', 1]);
    if (allSimple) ys.push(['断幺九', 1]);
    if (allYaochu && !allHonor && !allTerminal) ys.push(['混老頭', 2]);
    if (suits.size === 1) {
      if (honors === 0) ys.push(['清一色', menzen ? 6 : 5]);
      else ys.push(['混一色', menzen ? 3 : 2]);
    }
    return { ys, ym };
  };

  // 国士無双
  if (menzen && ctx.melds.length === 0 && isKokushi(ctx.hand)) {
    const juusan = ctx.hand[ctx.winTile] === 2;
    candidates.push({
      yakuman: [...situationalYakuman, [juusan ? '国士無双十三面待ち' : '国士無双', juusan ? 2 : 1]],
      yaku: [], fu: 0, form: 'kokushi',
    });
  }

  // 七対子
  if (menzen && ctx.melds.length === 0 && isChiitoi(ctx.hand)) {
    const { ys, ym } = tileSetYaku(true);
    candidates.push({
      yakuman: [...situationalYakuman, ...ym],
      yaku: [...situational, ['七対子', 2], ...ys],
      fu: 25, form: 'chiitoi',
    });
  }

  // 一般形
  const decs = decompose(ctx.hand);
  for (const dec of decs) {
    // 和了牌の位置 (待ちの形) ごとに評価
    const placements = [];
    if (dec.head === ctx.winTile) placements.push({ wait: 'tanki', idx: -1 });
    dec.mentsu.forEach((m, idx) => {
      if (m.type === 'koutsu' && m.k === ctx.winTile) placements.push({ wait: 'shanpon', idx });
      if (m.type === 'shuntsu' && ctx.winTile >= m.k && ctx.winTile <= m.k + 2) {
        const pos = ctx.winTile - m.k;
        let wait;
        if (pos === 1) wait = 'kanchan';
        else if (pos === 2 && numOf(m.k) === 1) wait = 'penchan';
        else if (pos === 0 && numOf(m.k) === 7) wait = 'penchan';
        else wait = 'ryanmen';
        placements.push({ wait, idx });
      }
    });
    const seen = new Set();
    for (const pl of placements) {
      const key = pl.wait + ':' + (pl.idx >= 0 ? dec.mentsu[pl.idx].type + dec.mentsu[pl.idx].k : 'h');
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(evalStandard(ctx, dec, pl, menzen, situational, situationalYakuman, tileSetYaku, allCounts));
    }
  }

  // 最高点の候補を選ぶ
  let best = null;
  for (const c of candidates) {
    const ymCount = c.yakuman.reduce((s, y) => s + y[1], 0);
    let han = c.yaku.reduce((s, y) => s + y[1], 0);
    if (ymCount === 0 && han === 0) continue;
    let res;
    if (ymCount > 0) {
      res = { yakuman: ymCount, han: 0, fu: 0, yaku: c.yakuman.map(([n, v]) => ({ name: n, han: v, yakuman: true })), dora: [] };
    } else {
      const dora = countDora(ctx, allCounts);
      const doraList = [];
      if (dora.dora) doraList.push({ name: 'ドラ', han: dora.dora });
      if (dora.aka) doraList.push({ name: '赤ドラ', han: dora.aka });
      if (dora.ura) doraList.push({ name: '裏ドラ', han: dora.ura });
      const doraHan = dora.dora + dora.aka + dora.ura;
      res = { yakuman: 0, han: han + doraHan, fu: c.fu, yaku: c.yaku.map(([n, v]) => ({ name: n, han: v })), dora: doraList };
    }
    res.form = c.form;
    res.wait = c.wait;
    res.pay = payment(res.han, res.fu, res.yakuman, ctx.isDealer, ctx.isTsumo);
    res.total = paymentTotal(res.pay);
    res.limit = limitName(res.han, res.fu, res.yakuman);
    if (!best || res.total > best.total || (res.total === best.total && res.han > best.han)) best = res;
  }
  return best;
}

function countDora(ctx, allCounts) {
  let dora = 0, ura = 0, aka = 0;
  for (const ind of ctx.doraIndicators) dora += allCounts[doraFromIndicator(ind)];
  if (ctx.riichi) for (const ind of ctx.uraIndicators || []) ura += allCounts[doraFromIndicator(ind)];
  for (const id of ctx.allIds || []) if (isRed(id)) aka++;
  return { dora, ura, aka };
}

function evalStandard(ctx, dec, pl, menzen, situational, situationalYakuman, tileSetYaku, allCounts) {
  // 面子の一覧 (open: 副露, concealed: 暗刻扱いか)
  const sets = [];
  dec.mentsu.forEach((m, idx) => {
    const ronShanpon = !ctx.isTsumo && pl.wait === 'shanpon' && pl.idx === idx;
    sets.push({ type: m.type, k: m.k, open: false, concealed: m.type === 'koutsu' && !ronShanpon, kan: false });
  });
  for (const m of ctx.melds) {
    if (m.type === 'chi') sets.push({ type: 'shuntsu', k: m.k, open: true, concealed: false, kan: false });
    else if (m.type === 'pon') sets.push({ type: 'koutsu', k: m.k, open: true, concealed: false, kan: false });
    else if (m.type === 'ankan') sets.push({ type: 'koutsu', k: m.k, open: false, concealed: true, kan: true });
    else sets.push({ type: 'koutsu', k: m.k, open: true, concealed: false, kan: true });
  }
  const head = dec.head;
  const yaku = [...situational];
  const yakuman = [...situationalYakuman];
  const shuntsu = sets.filter((s) => s.type === 'shuntsu');
  const koutsu = sets.filter((s) => s.type === 'koutsu');
  const anko = koutsu.filter((s) => s.concealed).length;
  const kans = koutsu.filter((s) => s.kan).length;

  const isYakuhaiTile = (k) => isDragon(k) || k === ctx.seatWind || k === ctx.roundWind;

  // 平和
  const pinfu = menzen && shuntsu.length === 4 && !isYakuhaiTile(head) && pl.wait === 'ryanmen';
  if (pinfu) yaku.push(['平和', 1]);

  // 一盃口・二盃口
  if (menzen) {
    const cnt = {};
    for (const s of shuntsu) cnt[s.k] = (cnt[s.k] || 0) + 1;
    let pairs = 0;
    for (const k in cnt) pairs += Math.floor(cnt[k] / 2);
    if (pairs >= 2) yaku.push(['二盃口', 3]);
    else if (pairs === 1) yaku.push(['一盃口', 1]);
  }

  // 役牌
  for (const s of koutsu) {
    if (s.k === HAKU) yaku.push(['役牌 白', 1]);
    if (s.k === HATSU) yaku.push(['役牌 發', 1]);
    if (s.k === CHUN) yaku.push(['役牌 中', 1]);
    if (s.k === ctx.seatWind) yaku.push(['自風 ' + '東南西北'[s.k - EAST], 1]);
    if (s.k === ctx.roundWind) yaku.push(['場風 ' + '東南西北'[s.k - EAST], 1]);
  }

  // 三色同順
  for (let n = 0; n < 7; n++) {
    if ([0, 9, 18].every((o) => shuntsu.some((s) => s.k === o + n))) { yaku.push(['三色同順', menzen ? 2 : 1]); break; }
  }
  // 一気通貫
  for (const o of [0, 9, 18]) {
    if ([0, 3, 6].every((d) => shuntsu.some((s) => s.k === o + d))) { yaku.push(['一気通貫', menzen ? 2 : 1]); break; }
  }
  // 三色同刻
  for (let n = 0; n < 9; n++) {
    if ([0, 9, 18].every((o) => koutsu.some((s) => s.k === o + n))) { yaku.push(['三色同刻', 2]); break; }
  }
  // 対々和
  if (koutsu.length === 4) yaku.push(['対々和', 2]);
  // 三暗刻 / 四暗刻
  if (anko === 4) yakuman.push([pl.wait === 'tanki' ? '四暗刻単騎' : '四暗刻', pl.wait === 'tanki' ? 2 : 1]);
  else if (anko === 3) yaku.push(['三暗刻', 2]);
  // 三槓子 / 四槓子
  if (kans === 4) yakuman.push(['四槓子', 1]);
  else if (kans === 3) yaku.push(['三槓子', 2]);

  // 混全帯么九 / 純全帯么九
  const setHasYaochu = (s) => s.type === 'shuntsu' ? (numOf(s.k) === 1 || numOf(s.k) === 7) : isYaochu(s.k);
  const setHasTerminal = (s) => s.type === 'shuntsu' ? (numOf(s.k) === 1 || numOf(s.k) === 7) : isTerminal(s.k);
  if (shuntsu.length > 0) {
    if (sets.every(setHasTerminal) && isTerminal(head)) yaku.push(['純全帯么九', menzen ? 3 : 2]);
    else if (sets.every(setHasYaochu) && isYaochu(head)) yaku.push(['混全帯么九', menzen ? 2 : 1]);
  }

  // 三元牌
  const dragonK = koutsu.filter((s) => isDragon(s.k)).length;
  if (dragonK === 3) yakuman.push(['大三元', 1]);
  else if (dragonK === 2 && isDragon(head)) yaku.push(['小三元', 2]);
  // 四喜和
  const windK = koutsu.filter((s) => isWind(s.k)).length;
  if (windK === 4) yakuman.push(['大四喜', 2]);
  else if (windK === 3 && isWind(head)) yakuman.push(['小四喜', 1]);

  // 九蓮宝燈
  if (menzen && ctx.melds.length === 0) {
    const s = suitOf(ctx.winTile);
    if (s < 3) {
      const c = ctx.hand.slice(s * 9, s * 9 + 9);
      const total = c.reduce((a, b) => a + b, 0);
      const base = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      if (total === 14 && c.every((v, i) => v >= base[i])) {
        const extra = c.findIndex((v, i) => v > base[i]);
        const junsei = extra === ctx.winTile - s * 9;
        yakuman.push([junsei ? '純正九蓮宝燈' : '九蓮宝燈', junsei ? 2 : 1]);
      }
    }
  }

  const ts = tileSetYaku(false);
  yaku.push(...ts.ys);
  yakuman.push(...ts.ym);
  // 混老頭・清老頭は対子系のみ。順子があれば混老頭不成立 (tileSetYaku 上は順子があると幺九以外を含むので自然に除外される)

  // 符計算
  let fu;
  if (pinfu) fu = ctx.isTsumo ? 20 : 30;
  else {
    fu = 20;
    if (menzen && !ctx.isTsumo) fu += 10;
    if (ctx.isTsumo) fu += 2;
    for (const s of koutsu) {
      let f = 2;
      if (isYaochu(s.k)) f *= 2;
      if (s.concealed) f *= 2;
      if (s.kan) f *= 4;
      fu += f;
    }
    if (isDragon(head)) fu += 2;
    if (head === ctx.seatWind) fu += 2;
    if (head === ctx.roundWind) fu += 2;
    if (pl.wait === 'kanchan' || pl.wait === 'penchan' || pl.wait === 'tanki') fu += 2;
    fu = Math.ceil(fu / 10) * 10;
    if (!menzen && fu === 20) fu = 30;
  }

  return { yaku, yakuman, fu, form: 'standard', wait: pl.wait };
}
