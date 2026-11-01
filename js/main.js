import { Game } from './game.js';
import { makeRng } from './tile.js';
import { CpuAgent } from './ai.js';
import { UI, HumanAgent } from './ui.js';
import { tileSrc } from './ui.js';

const DEFAULTS = {
  level: 'normal',
  length: 'hanchan',
  speed: 'normal',
  threeD: true,
  assistShanten: true,
  assistReco: true,
  assistDanger: true,
  noCalls: false,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('hangon.settings');
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

// 牌画像を先読み
for (let k = 0; k < 34; k++) new Image().src = tileSrc(k);
for (const k of [4, 13, 22]) new Image().src = tileSrc(k, true);
const settings = loadSettings();
if (new URLSearchParams(location.search).has('open')) settings.debugOpen = true;

document.body.classList.toggle('three-d', settings.threeD);
const ui = new UI(settings, startGame);

const SAVE_KEY = 'hangon.save';

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && data.version === 1 && !data.over ? data : null;
  } catch {
    return null;
  }
}

function writeSave(data) {
  try {
    data.level = settings.level;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* 保存できない環境では何もしない */
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

// save を渡すと途中から再開、なければ新しい対局
function startGame(save = null) {
  const level = save?.level || settings.level;
  const human = new HumanAgent(ui);
  const cpu = [1, 2, 3].map(() => new CpuAgent(level));
  const game = new Game({
    agents: [human, ...cpu],
    rules: { length: save?.rules?.length || settings.length },
    rng: makeRng((Math.random() * 2 ** 32) >>> 0),
    ui,
  });
  game.names = ['あなた', '下家 CPU', '対面 CPU', '上家 CPU'];
  let point = null;
  if (save) point = game.restore(save);
  else clearSave();
  game.onCheckpoint = (data) => {
    data.level = level;
    writeSave(data);
  };
  ui.attach(game);
  game
    .run(point)
    .then(() => clearSave())
    .catch((e) => {
      if (e.message !== 'cancelled') {
        console.error(e);
        clearSave();
        alert('エラーが発生しました: ' + e.message);
      }
    });
}

const saved = loadSave();
if (saved) startGame(saved);
else ui.showSettings(true);
