import { test, expect } from 'vite-plus/test';
import { Game } from '../js/game.js';
import { CpuAgent } from '../js/ai.js';
import { makeRng } from '../js/tile.js';

// seat 0 を「人間扱い」の CPU にしてチェックポイントを取らせる
class CheckpointCpu extends CpuAgent {
  constructor() {
    super('normal');
    this.isHuman = true;
  }
}

function makeGame(seed, onEvent) {
  const g = new Game({
    agents: [new CheckpointCpu(), new CpuAgent('hard'), new CpuAgent('normal'), new CpuAgent('easy')],
    rng: makeRng(seed),
    rules: { length: 'tonpuu' },
    ui: { event: async (type, d, gm) => onEvent && onEvent(type, d, gm) },
  });
  return g;
}

test('途中のチェックポイントから再開すると同じ結果になる', async () => {
  const saves = [];
  const g1 = makeGame(42);
  g1.onCheckpoint = (d) => saves.push(JSON.stringify(d));
  const r1 = await g1.run();
  expect(saves.length).toBeGreaterThan(10);
  for (const idx of [3, Math.floor(saves.length / 2), saves.length - 1]) {
    const data = JSON.parse(saves[idx]);
    const g2 = makeGame(1);
    const point = g2.restore(data);
    const r2 = await g2.run(point);
    expect(r2).toEqual(r1);
  }
});
