// 牌の表現
// kind: 0-8 萬子 1-9, 9-17 筒子, 18-26 索子, 27-30 東南西北, 31-33 白發中
// id: 0-135 (kind*4 + copy)。copy 0 の 5 は赤ドラ。

export const NUM_KINDS = 34;
export const EAST = 27,
  SOUTH = 28,
  WEST = 29,
  NORTH = 30,
  HAKU = 31,
  HATSU = 32,
  CHUN = 33;
export const RED_IDS = new Set([4 * 4, 13 * 4, 22 * 4]);

export const kindOf = (id) => id >> 2;
export const isRed = (id) => RED_IDS.has(id);
export const suitOf = (k) => Math.floor(k / 9); // 0 m, 1 p, 2 s, 3 z
export const numOf = (k) => (k % 9) + 1;
export const isHonor = (k) => k >= 27;
export const isWind = (k) => k >= 27 && k <= 30;
export const isDragon = (k) => k >= 31;
export const isTerminal = (k) => k < 27 && (k % 9 === 0 || k % 9 === 8);
export const isYaochu = (k) => k >= 27 || k % 9 === 0 || k % 9 === 8;
export const isSimple = (k) => !isYaochu(k);

export function doraFromIndicator(k) {
  if (k < 27) return Math.floor(k / 9) * 9 + (((k % 9) + 1) % 9);
  if (k < 31) return 27 + ((k - 27 + 1) % 4);
  return 31 + ((k - 31 + 1) % 3);
}

const SUIT_CH = ['m', 'p', 's', 'z'];
export function kindCode(k) {
  return k < 27 ? `${numOf(k)}${SUIT_CH[suitOf(k)]}` : `${k - 26}z`;
}

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
const SUIT_NAMES = ['萬', '筒', '索'];
export function kindName(k) {
  if (k >= 27) return HONOR_NAMES[k - 27];
  return KANJI_NUM[k % 9] + SUIT_NAMES[suitOf(k)];
}
export const WIND_NAMES = ['東', '南', '西', '北'];

// "123m456p11z" 形式 → kind 配列
export function parseKinds(str) {
  const out = [];
  let buf = [];
  for (const ch of str) {
    if (/[0-9]/.test(ch)) buf.push(ch === '0' ? 5 : +ch);
    else {
      const s = SUIT_CH.indexOf(ch);
      for (const n of buf) out.push(s * 9 + n - 1);
      buf = [];
    }
  }
  return out;
}

export function toCounts(kinds) {
  const c = Array.from({ length: NUM_KINDS }, () => 0);
  for (const k of kinds) c[k]++;
  return c;
}

export function idsToCounts(ids) {
  const c = Array.from({ length: NUM_KINDS }, () => 0);
  for (const id of ids) c[id >> 2]++;
  return c;
}

export function sortIds(ids) {
  return ids.slice().sort((a, b) => a - b);
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// シード付き乱数 (mulberry32)
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => a;
  rng.setState = (v) => {
    a = v;
  };
  return rng;
}
