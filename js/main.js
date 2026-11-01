import { Game } from './game.js';
import { CpuAgent } from './ai.js';
import { UI, HumanAgent } from './ui.js';
import { symbolDefs } from './tiles-svg.js';

const DEFAULTS = {
  level: 'normal',
  length: 'hanchan',
  speed: 'normal',
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

document.body.insertAdjacentHTML('afterbegin', symbolDefs());
const settings = loadSettings();
if (new URLSearchParams(location.search).has('open')) settings.debugOpen = true;

const ui = new UI(settings, startGame);

function startGame() {
  const human = new HumanAgent(ui);
  const cpu = [1, 2, 3].map(() => new CpuAgent(settings.level));
  const game = new Game({
    agents: [human, ...cpu],
    names: ['あなた', 'CPU 南', 'CPU 西', 'CPU 北'],
    rules: { length: settings.length },
    ui,
  });
  game.names = ['あなた', '下家 CPU', '対面 CPU', '上家 CPU'];
  ui.attach(game);
  game.run().catch((e) => {
    if (e.message !== 'cancelled') {
      console.error(e);
      alert('エラーが発生しました: ' + e.message);
    }
  });
}

ui.showSettings(true);
