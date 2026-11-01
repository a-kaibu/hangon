import { Game } from '../js/game.js';
import { CpuAgent } from '../js/ai.js';
import { makeRng } from '../js/tile.js';
const N = +(process.argv[2] || 5);
const levels = (process.argv[3] || 'hard,normal,easy,normal').split(',');
const stats = {
  wins: 0,
  draws: 0,
  aborts: 0,
  yaku: {},
  rank: levels.map(() => [0, 0, 0, 0]),
  dealin: [0, 0, 0, 0],
  winsBy: [0, 0, 0, 0],
  hands: 0,
};
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const rng = makeRng(1000 + g);
  // 席をずらして公平に
  const rot = g % 4;
  const seatLv = [0, 1, 2, 3].map((s) => levels[(s + rot) % 4]);
  const game = new Game({
    agents: seatLv.map((l) => new CpuAgent(l)),
    rng,
    ui: {
      async event(type, d, game) {
        if (type === 'handEnd') {
          const r = d.result;
          stats.hands++;
          if (r.type === 'win') {
            stats.wins++;
            for (const w of r.wins) {
              stats.winsBy[(w.seat + rot) % 4]++;
              if (!w.tsumo) stats.dealin[(w.from + rot) % 4]++;
              for (const y of w.result.yaku) stats.yaku[y.name] = (stats.yaku[y.name] || 0) + 1;
            }
          } else if (r.type === 'draw') stats.draws++;
          else stats.aborts++;
          const sum = game.scores.reduce((a, b) => a + b, 0) + game.riichiSticks * 1000;
          if (sum !== 100000) {
            console.log('SCORE SUM MISMATCH', sum, JSON.stringify(r).slice(0, 300));
            process.exit(1);
          }
        }
      },
    },
  });
  const ranking = await game.run();
  for (const r of ranking) stats.rank[(r.seat + rot) % 4][r.rank - 1]++;
}
console.log('time', (Date.now() - t0) / 1000, 's', 'hands', stats.hands, 'wins', stats.wins, 'draws', stats.draws, 'aborts', stats.aborts);
levels.forEach((l, i) =>
  console.log(
    l,
    'ranks',
    stats.rank[i].join('/'),
    'avg',
    (stats.rank[i].reduce((a, c, j) => a + c * (j + 1), 0) / N).toFixed(2),
    'wins',
    stats.winsBy[i],
    'dealin',
    stats.dealin[i],
  ),
);
console.log(
  Object.entries(stats.yaku)
    .sort((a, b) => b[1] - a[1])
    .map((e) => e.join(':'))
    .join(' '),
);
