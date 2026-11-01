import { test, expect } from 'vite-plus/test';
import { Game } from '../js/game.js';
import { CpuAgent } from '../js/ai.js';
import { makeRng } from '../js/tile.js';

// CPU 同士で半荘を打たせ、点数の保存と終局を確認する
test('CPU 対戦で点数合計が常に 100000 点', async () => {
  for (let g = 0; g < 8; g++) {
    let hands = 0;
    const game = new Game({
      agents: ['hard', 'normal', 'easy', 'normal'].map((l) => new CpuAgent(l)),
      rng: makeRng(500 + g),
      ui: {
        async event(type, d, gm) {
          if (type !== 'handEnd') return;
          hands++;
          expect(gm.scores.reduce((a, b) => a + b, 0) + gm.riichiSticks * 1000).toBe(100000);
        },
      },
    });
    const ranking = await game.run();
    expect(ranking.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(hands).toBeGreaterThanOrEqual(8);
  }
});
