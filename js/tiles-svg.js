// 牌の絵柄 (オリジナル SVG)。viewBox 0 0 60 80
const NAVY = '#1d2440';
const RED = '#c8312b';
const GREEN = '#1f7a4a';
const BLUE = '#2357a8';

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

function txt(x, y, size, color, s, weight = 700) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="middle" dominant-baseline="central" font-family="'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif">${s}</text>`;
}

function man(n, red) {
  const c1 = red ? RED : NAVY;
  return txt(30, 25, 30, c1, KANJI_NUM[n - 1]) + txt(30, 58, 28, RED, '萬');
}

const PIN_POS = {
  1: [[30, 40]],
  2: [
    [30, 21],
    [30, 59],
  ],
  3: [
    [15, 16],
    [30, 40],
    [45, 64],
  ],
  4: [
    [18, 22],
    [42, 22],
    [18, 58],
    [42, 58],
  ],
  5: [
    [17, 18],
    [43, 18],
    [30, 40],
    [17, 62],
    [43, 62],
  ],
  6: [
    [19, 16],
    [41, 16],
    [19, 40],
    [41, 40],
    [19, 64],
    [41, 64],
  ],
  7: [
    [14, 12],
    [30, 21],
    [46, 30],
    [19, 50],
    [41, 50],
    [19, 68],
    [41, 68],
  ],
  8: [
    [19, 12],
    [41, 12],
    [19, 31],
    [41, 31],
    [19, 49],
    [41, 49],
    [19, 68],
    [41, 68],
  ],
  9: [
    [14, 16],
    [30, 16],
    [46, 16],
    [14, 40],
    [30, 40],
    [46, 40],
    [14, 64],
    [30, 64],
    [46, 64],
  ],
};
const PIN_R = { 1: 17, 2: 12, 3: 9.5, 4: 10, 5: 9, 6: 8.5, 7: 7.5, 8: 7.5, 9: 7.2 };

function pinColor(n, i, red) {
  if (red) return RED;
  if (n === 1) return RED;
  if (n === 2) return BLUE;
  if (n === 3) return [BLUE, RED, GREEN][i];
  if (n === 4) return [BLUE, GREEN, GREEN, BLUE][i];
  if (n === 5) return i === 2 ? RED : [BLUE, GREEN, 0, GREEN, BLUE][i];
  if (n === 6) return i < 2 ? GREEN : RED;
  if (n === 7) return i < 3 ? GREEN : RED;
  if (n === 8) return BLUE;
  return [BLUE, BLUE, BLUE, RED, RED, RED, GREEN, GREEN, GREEN][i];
}

function circle(x, y, r, color) {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="${Math.max(1.6, r * 0.28)}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="${color}"/>`
  );
}

function pin(n, red) {
  const r = PIN_R[n];
  let s = '';
  PIN_POS[n].forEach(([x, y], i) => {
    s += circle(x, y, r, pinColor(n, i, red));
  });
  if (n === 1) s += `<circle cx="30" cy="40" r="23" fill="none" stroke="${NAVY}" stroke-width="1.2" stroke-dasharray="3 3"/>`;
  return s;
}

function stick(x, y, h, color) {
  const w = 6;
  return (
    `<g><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3" fill="${color}"/>` +
    `<line x1="${x - w / 2}" x2="${x + w / 2}" y1="${y}" y2="${y}" stroke="#fbf6ea" stroke-width="1.2"/></g>`
  );
}

const SOU_POS = {
  2: [
    [30, 22],
    [30, 58],
  ],
  3: [
    [30, 22],
    [18, 58],
    [42, 58],
  ],
  4: [
    [18, 22],
    [42, 22],
    [18, 58],
    [42, 58],
  ],
  5: [
    [16, 20],
    [44, 20],
    [30, 40],
    [16, 60],
    [44, 60],
  ],
  6: [
    [14, 22],
    [30, 22],
    [46, 22],
    [14, 58],
    [30, 58],
    [46, 58],
  ],
  7: [
    [30, 13],
    [14, 42],
    [30, 42],
    [46, 42],
    [14, 66],
    [30, 66],
    [46, 66],
  ],
  8: [
    [10, 22],
    [23, 22],
    [37, 22],
    [50, 22],
    [10, 58],
    [23, 58],
    [37, 58],
    [50, 58],
  ],
  9: [
    [14, 14],
    [30, 14],
    [46, 14],
    [14, 40],
    [30, 40],
    [46, 40],
    [14, 66],
    [30, 66],
    [46, 66],
  ],
};

function sou(n, red) {
  if (n === 1) {
    // 若竹と朱の実 (オリジナル意匠)
    return (
      `<path d="M30 70 C30 50 30 30 30 12" stroke="${GREEN}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `<path d="M30 46 C20 40 14 32 12 22 C22 26 28 34 30 44Z" fill="${GREEN}"/>` +
      `<path d="M30 34 C40 28 46 20 48 10 C38 14 32 22 30 32Z" fill="${GREEN}"/>` +
      `<path d="M30 58 C40 54 46 48 49 40 C40 42 33 48 30 56Z" fill="${GREEN}" opacity="0.8"/>` +
      `<circle cx="30" cy="12" r="5" fill="${RED}"/>`
    );
  }
  const h = n >= 7 ? 16 : 22;
  let s = '';
  SOU_POS[n].forEach(([x, y], i) => {
    let c = red ? RED : GREEN;
    if (!red && ((n === 5 && i === 2) || (n === 7 && i === 0) || (n === 9 && i % 3 === 1))) c = RED;
    s += stick(x, y, h, c);
  });
  return s;
}

function honor(k) {
  const i = k - 27;
  if (i === 4) {
    return (
      `<rect x="14" y="16" width="32" height="48" rx="3" fill="none" stroke="${BLUE}" stroke-width="3"/>` +
      `<rect x="19" y="21" width="22" height="38" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.2"/>`
    );
  }
  const ch = '東南西北白發中'[i];
  const color = i === 5 ? GREEN : i === 6 ? RED : NAVY;
  return txt(30, 41, 40, color, ch, 800);
}

export function tileFaceSvg(k, red = false) {
  if (k < 9) return man(k + 1, red);
  if (k < 18) return pin(k - 8, red);
  if (k < 27) return sou(k - 17, red);
  return honor(k);
}

// 全牌のシンボル定義
export function symbolDefs() {
  let s = '';
  for (let k = 0; k < 34; k++) s += `<symbol id="t${k}" viewBox="0 0 60 80">${tileFaceSvg(k)}</symbol>`;
  for (const k of [4, 13, 22]) s += `<symbol id="t${k}r" viewBox="0 0 60 80">${tileFaceSvg(k, true)}</symbol>`;
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${s}</svg>`;
}
