// おすすめ打牌の理由を文章にする
import { kindOf, isHonor, isDragon, numOf, kindName, idsToCounts, doraFromIndicator } from './tile.js';
import { shanten as calcShanten } from './shanten.js';
import { yakuPath, isYakuhai } from './ai.js';

const SHANTEN_TEXT = (s) => (s < 0 ? '和了' : s === 0 ? '聴牌' : `${s}向聴`);

// 手牌の中でその牌がどれだけ他の牌と繋がっているか
function tileRole(counts, k, game, seat) {
  const c = counts[k];
  if (isHonor(k)) {
    const yakuhai = isDragon(k) || k === game.seatWind(seat) || k === game.roundWindKind;
    if (c >= 3) return { key: 'set', text: `${kindName(k)}は刻子(3枚組)になっている` };
    if (c === 2) return { key: 'pair', text: `${kindName(k)}の対子は${yakuhai ? '役牌候補だが、' : ''}崩した方が手が広くなる` };
    if (yakuhai) return { key: 'lone-yakuhai', text: `${kindName(k)}は役牌だが1枚だけで、重なる見込みが薄い` };
    return { key: 'lone-honor', text: `${kindName(k)}は1枚だけの字牌で、順子(連番)にも使えず役にもならない` };
  }
  const n = numOf(k);
  const has = (d) => {
    const nn = n + d;
    if (nn < 1 || nn > 9) return false;
    return counts[k + d] > 0;
  };
  if (c >= 2) {
    let pairs = 0;
    for (let i = 0; i < 34; i++) if (counts[i] >= 2) pairs++;
    if (pairs >= 3) return { key: 'pair', text: `対子が${pairs}組あって多すぎるので、${kindName(k)}の対子を崩す` };
    return { key: 'pair', text: `${kindName(k)}の対子を崩した方が、残りの形が広く使える` };
  }
  const near = has(-1) || has(1);
  const gap = has(-2) || has(2);
  if (!near && !gap) return { key: 'isolated', text: `${kindName(k)}は孤立牌(近くに繋がる牌がない)` };
  if (!near && gap) {
    return { key: 'kanchan', text: `${kindName(k)}は1つ飛び(嵌張)の繋がりしかない${n === 1 || n === 9 ? '端の牌' : ''}` };
  }
  if ((n === 1 && has(1)) || (n === 9 && has(-1)))
    return { key: 'penchan', text: `${kindName(k)}は端の辺張(12・89)で、待ちが狭くなりやすい` };
  return { key: 'connected', text: `${kindName(k)}は隣の牌と繋がっている` };
}

function doraSet(game) {
  return new Set(game.doraIndicators.map((id) => doraFromIndicator(kindOf(id))));
}

// an: ui.myAnalysis() の結果 (cands, recoKind, anyThreat を使う)
export function explainReco(game, seat, an) {
  const p = game.players[seat];
  const counts = idsToCounts(p.hand);
  const cands = an.cands.slice().sort((a, b) => b.score - a.score);
  // 同じ種類の牌 (赤5 など) は1つにまとめる
  const seen = new Set();
  const uniq = cands.filter((c) => (seen.has(c.k) ? false : (seen.add(c.k), true)));
  const best = uniq[0];
  const alt = uniq[1];
  const minS = Math.min(...uniq.map((c) => c.shanten));
  const doras = doraSet(game);
  const reasons = [];
  let headline;

  const defensive =
    an.anyThreat && best.risk !== undefined && (best.shanten > minS || (alt && alt.risk !== undefined && alt.risk - best.risk > 2));
  if (defensive) {
    const d = an.danger[best.k];
    const why = d && d.worst ? d.worst.reason : '危険度が低い';
    headline = `守備優先: 候補の中で一番振り込みにくい (${kindName(best.k)}は${why})`;
    reasons.push(`相手の聴牌気配が強く、自分の手は${SHANTEN_TEXT(minS)}。ここで振り込むと大きく失点するので、安全な牌を選んでいます。`);
    if (best.shanten > minS)
      reasons.push(`この牌を切ると${SHANTEN_TEXT(best.shanten)}に下がりますが、危険な牌を切るよりも損が小さいと判断しました。`);
  } else if (best.shanten === 0 && best.waitInfo) {
    const w = best.waitInfo.kinds.map(kindName).join('・');
    headline = `切ると聴牌: ${w}待ち (残り${best.waitInfo.left}枚)`;
    const tenpais = uniq.filter((c) => c.shanten === 0 && c.waitInfo);
    if (tenpais.length > 1) {
      const other = tenpais.find((c) => c.k !== best.k);
      reasons.push(
        `聴牌できる切り方は${tenpais.length}通り。${kindName(best.k)}切りは待ちが残り${best.waitInfo.left}枚で、${kindName(other.k)}切り(残り${other.waitInfo.left}枚)より和了りやすい形です。`,
      );
    } else {
      reasons.push(`${kindName(best.k)}以外を切ると聴牌になりません。`);
    }
  } else {
    const role = tileRole(counts, best.k, game, seat);
    headline = `${role.text}`;
    if (best.shanten > minS) {
      reasons.push(`この牌を切るとシャンテン数が下がりますが、役や打点を優先しています。`);
    } else {
      reasons.push(`切った後も${SHANTEN_TEXT(best.shanten)}のまま、手を進める牌(有効牌)が${best.ukeire}枚残ります。`);
    }
    if (alt && alt.shanten === best.shanten) {
      if (alt.ukeire < best.ukeire) {
        reasons.push(`次の候補の${kindName(alt.k)}切りだと有効牌は${alt.ukeire}枚で、${best.ukeire - alt.ukeire}枚少なくなります。`);
      } else if (alt.ukeire >= best.ukeire && alt.value > best.value) {
        reasons.push(
          `${kindName(alt.k)}切りも同じくらい広いですが、${doras.has(alt.k) ? 'ドラなので' : '打点や役に繋がりやすいので'}残しています。`,
        );
      } else if (alt.ukeire > best.ukeire) {
        reasons.push(
          `${kindName(alt.k)}切りの方が今の有効牌は${alt.ukeire - best.ukeire}枚多いですが、聴牌したときの待ちの良さまで考えると${kindName(best.k)}切りが上です。`,
        );
      }
    }
    if (role.key === 'lone-honor') reasons.push('字牌は場に出やすいうちに早めに切るのが基本です。');
    if (role.key === 'lone-yakuhai') reasons.push('役牌は2枚以上あれば残す価値がありますが、1枚なら手を進める方を優先します。');
  }
  if (best.ukTiles && best.ukTiles.length && best.shanten > 0) {
    reasons.push(`有効牌: ${best.ukTiles.map(kindName).join('・')}`);
  }

  // 比較表 (上位 5 件)
  const table = uniq.slice(0, 5).map((c) => ({
    k: c.k,
    after: SHANTEN_TEXT(c.shanten),
    count: c.shanten === 0 && c.waitInfo ? c.waitInfo.left : c.ukeire,
    countLabel: c.shanten === 0 ? '待ち' : '有効牌',
    danger: an.anyThreat && an.danger[c.k] ? an.danger[c.k] : null,
    best: c.k === best.k,
  }));
  return { headline, reasons, table, bestKind: best.k };
}

// ---- 鳴き・ロンの判断の説明 ----

const PATH_TEXT = {
  yakuhai: '役牌の刻子があるので役は確定',
  'yakuhai-pair': '役牌の対子があり、役を作れる見込みがある',
  tanyao: '2〜8だけで作るタンヤオが狙える',
  flush: '1色に染める混一色・清一色が狙える',
  toitoi: '刻子ばかりの対々和が狙える',
};

export function explainCall(game, seat, tileId, fromSeat, opts) {
  const p = game.players[seat];
  const k = kindOf(tileId);
  const who = ['あなた', '下家', '対面', '上家'][(fromSeat - seat + 4) % 4];
  const intro = `${who}が ${kindName(k)} を捨てました。`;
  if (opts.ron) {
    return { intro, rec: 'ron', text: 'この牌で和了れます！「ロン」を押しましょう。', detail: [] };
  }
  const counts = idsToCounts(p.hand);
  const mc = p.melds.length;
  const cur = calcShanten(counts, mc);
  const meldsBase = p.melds.map((m) => ({ type: m.type, k: m.k }));
  const threat = game.players.some((q) => q.riichi && q.seat !== seat);
  const evals = [];
  const tryCall = (type, ids) => {
    const c = counts.slice();
    for (const id of ids) c[kindOf(id)]--;
    const start = type === 'chi' ? Math.min(k, ...ids.map(kindOf)) : k;
    const melds = [...meldsBase, { type, k: start }];
    let after = 99;
    for (let x = 0; x < 34; x++) {
      if (!c[x]) continue;
      c[x]--;
      after = Math.min(after, calcShanten(c, mc + 1));
      c[x]++;
    }
    const path = yakuPath(game, seat, c, melds);
    const yakuhaiPon = type === 'pon' && isHonor(k) && isYakuhai(game, seat, k);
    let ok = true;
    let why;
    if (after >= cur) {
      ok = false;
      why = '鳴いても手が進まない';
    } else if (!yakuhaiPon && !path) {
      ok = false;
      why = '鳴くと役がなくなり、和了れなくなる(リーチもできなくなる)';
    } else if (!yakuhaiPon && after >= 3 && game.isMenzen(p)) {
      ok = false;
      why = 'まだ手が遠いので、鳴かずにリーチを目指した方が高くなる';
    } else if (threat && after >= 1) {
      ok = false;
      why = 'リーチしている人がいるので、手牌を減らすと守りにくくなる';
    } else {
      why = yakuhaiPon ? '役牌なので鳴くだけで役がつく' : PATH_TEXT[path] || '手が進む';
    }
    evals.push({ type, ids, after, ok, why, score: (cur - after) * 10 + (yakuhaiPon ? 5 : 0) });
  };
  for (const ids of opts.pon) tryCall('pon', ids);
  for (const ids of opts.chi) tryCall('chi', ids);
  const good = evals.filter((e) => e.ok).sort((a, b) => b.score - a.score)[0];
  const name = { pon: 'ポン', chi: 'チー' };
  if (good) {
    return {
      intro,
      rec: good.type,
      recIds: good.ids,
      text: `「${name[good.type]}」がおすすめ: ${good.why}。鳴くとテンパイまであと${Math.max(0, good.after)}歩になります。`,
      detail: evals,
    };
  }
  const first = evals[0];
  return {
    intro,
    rec: 'pass',
    text: `「スキップ」がおすすめ: ${first ? first.why : '鳴く理由がない'}。`,
    detail: evals,
  };
}
