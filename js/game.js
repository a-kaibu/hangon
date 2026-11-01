// 対局進行エンジン
import {
  kindOf, isRed, isYaochu, isWind, idsToCounts, shuffle, EAST, suitOf, numOf, isHonor,
} from './tile.js';
import { shanten, waits } from './shanten.js';
import { evaluate } from './yaku.js';

export const DEFAULT_RULES = { length: 'hanchan', startScore: 25000, returnScore: 30000 };

export class Game {
  constructor({ agents, names, ui = null, rules = {}, rng = Math.random }) {
    this.agents = agents;
    this.ui = ui;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = rng;
    this.scores = [0, 1, 2, 3].map(() => this.rules.startScore);
    this.names = names || ['あなた', '下家', '対面', '上家'];
    this.roundWind = 0; // 0 東 1 南 2 西
    this.firstDealer = this.rules.firstDealer ?? 0;
    this.kyoku = 0; // 局 (0..3)
    this.honba = 0;
    this.riichiSticks = 0;
    this.handCount = 0;
    this.history = [];
    this.over = false;
  }

  async emit(type, data = {}) {
    if (this.ui) await this.ui.event(type, data, this);
  }

  get dealer() { return (this.firstDealer + this.kyoku) % 4; }
  seatWind(seat) { return EAST + ((seat - this.dealer + 4) % 4); }
  get roundWindKind() { return EAST + this.roundWind; }
  get wallRemaining() { return this.live.length; }
  roundLabel() { return `${'東南西北'[this.roundWind]}${this.kyoku + 1}局`; }

  async run() {
    await this.emit('gameStart');
    while (!this.over) {
      const result = await this.playHand();
      this.history.push(result);
      this.advance(result);
      await this.emit('handEnd', { result });
    }
    const ranking = this.finalRanking();
    await this.emit('gameEnd', { ranking });
    return ranking;
  }

  finalRanking() {
    if (this.riichiSticks > 0) {
      const top = this.orderBySeatScore()[0];
      this.scores[top] += this.riichiSticks * 1000;
      this.riichiSticks = 0;
    }
    return this.orderBySeatScore().map((seat, i) => ({ seat, rank: i + 1, score: this.scores[seat], name: this.names[seat] }));
  }

  orderBySeatScore() {
    // 同点は起家に近い順 (起家 = seat 0)
    const ord = (s) => (s - this.firstDealer + 4) % 4;
    return [0, 1, 2, 3].sort((a, b) => this.scores[b] - this.scores[a] || ord(a) - ord(b));
  }

  advance(result) {
    const lastWind = this.rules.length === 'tonpuu' ? 0 : 1;
    let renchan = false;
    if (result.type === 'win') {
      renchan = result.wins.some((w) => w.seat === this.dealer);
      this.honba = renchan ? this.honba + 1 : 0;
    } else if (result.type === 'draw') {
      renchan = result.tenpai.includes(this.dealer);
      this.honba++;
    } else {
      renchan = true; // 途中流局
      this.honba++;
    }
    if (this.scores.some((s) => s < 0)) { this.over = true; return; }
    const allLast = this.roundWind === lastWind && this.kyoku === 3;
    if (allLast && renchan && result.type !== 'abort') {
      // アガリやめ / テンパイやめ: 親がトップかつ返し点以上なら終了
      const top = this.orderBySeatScore()[0];
      if (top === this.dealer && this.scores[this.dealer] >= this.rules.returnScore) { this.over = true; return; }
    }
    if (!renchan) {
      this.kyoku++;
      if (this.kyoku === 4) {
        this.kyoku = 0;
        this.roundWind++;
        if (this.roundWind > lastWind) {
          // 延長戦: 誰も返し点に届いていなければ次の場へ (西場まで)
          const anyAbove = this.scores.some((s) => s >= this.rules.returnScore);
          if (anyAbove || this.roundWind > lastWind + 1) this.over = true;
        }
      }
    }
    if (this.roundWind > lastWind && this.scores.some((s) => s >= this.rules.returnScore) && !this.over) {
      // 延長中は誰かが返し点を超えた時点で終了
      this.over = true;
    }
  }

  // ---- 1局 ----
  setupHand() {
    const ids = shuffle([...Array(136).keys()], this.rng);
    this.dead = ids.splice(0, 14);
    this.live = ids;
    this.kanCount = 0;
    this.doraIndicators = [this.dead[4]];
    this.anyCall = false;
    this.totalDiscards = 0;
    this.lastEvent = null;
    this.discardLog = [];
    this.players = [0, 1, 2, 3].map((seat) => ({
      seat,
      hand: [],
      melds: [],
      discards: [],
      riichi: false,
      doubleRiichi: false,
      riichiDiscardIndex: -1,
      ippatsu: false,
      furitenTemp: false,
      furitenRiichi: false,
      drawn: null,
      kuikae: [],
      kans: 0,
    }));
    for (let r = 0; r < 13; r++) {
      for (let i = 0; i < 4; i++) this.players[(this.dealer + i) % 4].hand.push(this.live.shift());
    }
    this.handCount++;
  }

  uraIndicators() {
    const out = [];
    for (let i = 0; i <= this.kanCount; i++) out.push(this.dead[9 + i]);
    return out;
  }

  meldCount(p) { return p.melds.length; }
  isMenzen(p) { return p.melds.every((m) => m.type === 'ankan'); }
  counts(p) { return idsToCounts(p.hand); }

  // 13枚 (打牌後) の待ち
  playerWaits(p) {
    return waits(this.counts(p), p.melds.length);
  }

  isFuriten(p) {
    if (p.furitenTemp || p.furitenRiichi) return true;
    const w = this.playerWaits(p);
    return p.discards.some((d) => w.includes(kindOf(d.id)));
  }

  // 和了評価
  evalWin(seat, winId, { tsumo, chankan = false, rinshan = false }) {
    const p = this.players[seat];
    const handIds = tsumo ? p.hand.slice() : [...p.hand, winId];
    const counts = idsToCounts(handIds);
    if (shanten(counts, p.melds.length) !== -1) return null;
    const firstTurn = !this.anyCall && p.discards.length === 0;
    const allIds = [...handIds];
    for (const m of p.melds) allIds.push(...m.ids);
    const ctx = {
      hand: counts,
      melds: p.melds.map((m) => ({ type: m.type, k: m.k })),
      winTile: kindOf(winId),
      isTsumo: tsumo,
      seatWind: this.seatWind(seat),
      roundWind: this.roundWindKind,
      riichi: p.riichi,
      doubleRiichi: p.doubleRiichi,
      ippatsu: p.ippatsu,
      haitei: tsumo && this.live.length === 0 && !rinshan,
      houtei: !tsumo && this.live.length === 0 && !chankan,
      rinshan,
      chankan,
      tenhou: tsumo && firstTurn && seat === this.dealer,
      chiihou: tsumo && firstTurn && seat !== this.dealer,
      doraIndicators: this.doraIndicators.map(kindOf),
      uraIndicators: this.uraIndicators().map(kindOf),
      allIds,
      isDealer: seat === this.dealer,
    };
    return evaluate(ctx);
  }

  canRon(seat, tileId, opts = {}) {
    const p = this.players[seat];
    const k = kindOf(tileId);
    const w = this.playerWaits(p);
    if (!w.includes(k)) return { can: false, isWait: false };
    if (this.isFuriten(p)) return { can: false, isWait: true, furiten: true };
    const r = this.evalWin(seat, tileId, { tsumo: false, ...opts });
    return { can: !!r, isWait: true, result: r };
  }

  // リーチ宣言可能な打牌 (id 配列)
  riichiCandidates(p) {
    if (p.riichi || !this.isMenzen(p) || this.scores[p.seat] < 1000 || this.live.length < 4) return [];
    const counts = this.counts(p);
    const ok = new Map();
    return p.hand.filter((id) => {
      const k = kindOf(id);
      if (!ok.has(k)) {
        counts[k]--;
        ok.set(k, shanten(counts, p.melds.length) === 0 && waits(counts, p.melds.length).length > 0);
        counts[k]++;
      }
      return ok.get(k);
    });
  }

  kanOptions(p) {
    if (this.live.length === 0 || this.kanCount >= 4) return [];
    const counts = this.counts(p);
    const out = [];
    for (let k = 0; k < 34; k++) {
      if (counts[k] === 4) {
        if (p.riichi) {
          // リーチ後はツモ牌での暗槓かつ待ちが変わらない場合のみ
          if (kindOf(p.drawn) !== k) continue;
          const before = counts.slice(); before[k]--;
          const w0 = waits(before, p.melds.length);
          const after = counts.slice(); after[k] -= 4;
          const w1 = waits(after, p.melds.length + 1);
          if (w0.join() !== w1.join() || w0.length === 0) continue;
          // 面子構成が変わるケース (例: 3334 の 3 暗槓) を避けるため、待ちの各牌で暗刻扱いになるか確認
          let ok = true;
          for (const w of w0) {
            const c = before.slice(); c[w]++;
            if (!decomposeHasTriplet(c, k)) { ok = false; break; }
          }
          if (!ok) continue;
        }
        out.push({ type: 'ankan', k });
      }
    }
    if (!p.riichi) {
      for (const m of p.melds) {
        if (m.type === 'pon' && counts[m.k] >= 1) out.push({ type: 'kakan', k: m.k });
      }
    }
    return out;
  }

  canKyuushu(p) {
    if (this.anyCall || p.discards.length > 0) return false;
    const c = this.counts(p);
    let n = 0;
    for (let k = 0; k < 34; k++) if (isYaochu(k) && c[k] > 0) n++;
    return n >= 9;
  }

  // 公開情報から見えている枚数 (seat 視点)
  visibleCounts(seat) {
    const c = new Array(34).fill(0);
    for (const id of this.players[seat].hand) c[kindOf(id)]++;
    for (const p of this.players) {
      for (const d of p.discards) if (!d.called) c[kindOf(d.id)]++;
      for (const m of p.melds) for (const id of m.ids) c[kindOf(id)]++;
    }
    for (const id of this.doraIndicators) c[kindOf(id)]++;
    return c;
  }

  remainingFor(seat) {
    const v = this.visibleCounts(seat);
    return v.map((x) => Math.max(0, 4 - x));
  }

  drawTile(seat, rinshan) {
    const p = this.players[seat];
    let id;
    if (rinshan) {
      id = this.dead[this.kanCount - 1 >= 0 ? this.kanCount - 1 : 0];
      // 嶺上牌は dead[0..3]、海底をずらすため live の末尾を王牌に補充
      this.live.pop();
    } else {
      id = this.live.shift();
    }
    p.hand.push(id);
    p.drawn = id;
    return id;
  }

  async playHand() {
    this.setupHand();
    await this.emit('handStart');
    let cur = this.dealer;
    let mode = 'draw'; // 'draw' | 'rinshan' | 'call'
    while (true) {
      const p = this.players[cur];
      let rinshan = false;
      if (mode === 'draw' || mode === 'rinshan') {
        if (mode === 'draw' && this.live.length === 0) return this.exhaustiveDraw();
        rinshan = mode === 'rinshan';
        const id = this.drawTile(cur, rinshan);
        await this.emit('draw', { seat: cur, id, rinshan });
      } else {
        p.drawn = null;
      }

      // 自分の手番の行動
      const opts = { tsumo: null, riichi: [], kans: [], kyuushu: false, forbidden: p.kuikae, afterCall: mode === 'call' };
      if (mode !== 'call') {
        const r = this.evalWin(cur, p.drawn, { tsumo: true, rinshan });
        if (r) opts.tsumo = r;
        opts.riichi = this.riichiCandidates(p);
        opts.kans = this.kanOptions(p);
        opts.kyuushu = this.canKyuushu(p);
      }
      let act;
      if (p.riichi && !opts.tsumo && opts.kans.length === 0) {
        act = { type: 'discard', id: p.drawn };
      } else {
        act = await this.agents[cur].selfAction(this, cur, opts);
      }
      if (act.type === 'tsumo' && opts.tsumo) {
        return this.resolveWin([{ seat: cur, tsumo: true, winId: p.drawn, result: opts.tsumo }], cur);
      }
      if (p.riichi && opts.tsumo) p.furitenRiichi = true; // ツモ見逃し
      if (act.type === 'kyuushu' && opts.kyuushu) {
        await this.emit('abort', { reason: '九種九牌', seat: cur });
        return { type: 'abort', reason: '九種九牌', seat: cur, deltas: [0, 0, 0, 0] };
      }
      if (act.type === 'kan') {
        const kanRes = await this.doSelfKan(cur, act);
        if (kanRes) return kanRes; // 槍槓
        mode = 'rinshan';
        continue;
      }
      // 打牌
      let id = act.id;
      if (!p.hand.includes(id) || p.kuikae.includes(kindOf(id))) {
        id = p.hand.find((x) => !p.kuikae.includes(kindOf(x))) ?? p.hand[0];
      }
      let declareRiichi = !!act.riichi && opts.riichi.includes(id);
      if (p.riichi) declareRiichi = false;
      const res = await this.doDiscard(cur, id, declareRiichi);
      if (res.end) return res.end;
      if (res.call) {
        cur = res.call.seat;
        mode = res.call.type === 'minkan' ? 'rinshan' : 'call';
        continue;
      }
      if (this.live.length === 0) return this.exhaustiveDraw();
      cur = (cur + 1) % 4;
      mode = 'draw';
    }
  }

  async doSelfKan(seat, act) {
    const p = this.players[seat];
    const k = act.k;
    if (act.type === 'ankan') {
      const ids = p.hand.filter((id) => kindOf(id) === k);
      p.hand = p.hand.filter((id) => kindOf(id) !== k);
      p.melds.push({ type: 'ankan', k, ids, from: seat });
    } else {
      const meld = p.melds.find((m) => m.type === 'pon' && m.k === k);
      const id = p.hand.find((x) => kindOf(x) === k);
      p.hand = p.hand.filter((x) => x !== id);
      meld.type = 'kakan';
      meld.ids.push(id);
      meld.added = id;
      // 槍槓チェック
      await this.emit('kan', { seat, type: 'kakan', k });
      const rons = await this.collectRons(seat, id, { chankan: true });
      if (rons.length) {
        return this.resolveWin(rons.map((r) => ({ ...r, winId: id, tsumo: false })), seat);
      }
    }
    p.kans++;
    this.kanCount++;
    this.anyCall = true;
    for (const q of this.players) q.ippatsu = false;
    this.doraIndicators.push(this.dead[4 + this.kanCount]);
    p.drawn = null;
    if (act.type === 'ankan') await this.emit('kan', { seat, type: 'ankan', k });
    await this.emit('dora');
    return null;
  }

  async collectRons(fromSeat, tileId, opts = {}) {
    const rons = [];
    for (let i = 1; i < 4; i++) {
      const s = (fromSeat + i) % 4;
      const q = this.players[s];
      const r = this.canRon(s, tileId, opts);
      if (r.isWait && !r.can) { this.markMissed(q); continue; }
      if (!r.can) continue;
      const ans = await this.agents[s].respond(this, s, tileId, fromSeat, { ron: r.result, pon: [], minkan: null, chi: [] });
      if (ans.type === 'ron') rons.push({ seat: s, result: r.result });
      else this.markMissed(q);
    }
    return rons;
  }

  markMissed(q) {
    q.furitenTemp = true;
    if (q.riichi) q.furitenRiichi = true;
  }

  async doDiscard(seat, id, declareRiichi) {
    const p = this.players[seat];
    const tsumogiri = id === p.drawn;
    p.hand = p.hand.filter((x) => x !== id);
    p.drawn = null;
    p.kuikae = [];
    p.furitenTemp = false;
    if (p.ippatsu && !declareRiichi) p.ippatsu = false;
    const firstDiscard = p.discards.length === 0;
    p.discards.push({ id, tsumogiri, riichi: declareRiichi, called: false });
    this.totalDiscards++;
    if (declareRiichi) {
      p.riichi = true;
      p.doubleRiichi = firstDiscard && !this.anyCall;
      p.riichiDiscardIndex = p.discards.length - 1;
    }
    this.lastDiscard = { seat, id };
    this.discardLog.push({ seat, id, afterRiichiOf: this.players.filter((q) => q.riichi && q.seat !== seat).map((q) => q.seat) });
    await this.emit('discard', { seat, id, riichi: declareRiichi, tsumogiri });

    // 他家の応答
    const k = kindOf(id);
    const canCall = this.live.length > 0;
    const responses = [];
    for (let i = 1; i < 4; i++) {
      const s = (seat + i) % 4;
      const q = this.players[s];
      const opts = { ron: null, pon: [], minkan: null, chi: [] };
      const r = this.canRon(s, id);
      if (r.can) opts.ron = r.result;
      else if (r.isWait) this.markMissed(q);
      if (canCall && !q.riichi) {
        const same = q.hand.filter((x) => kindOf(x) === k).sort((a, b) => isRed(a) - isRed(b));
        if (same.length >= 2 && this.hasDiscardAfterCall(q, [same[0], same[1]], k, null)) opts.pon.push([same[0], same[1]]);
        if (same.length >= 3 && this.kanCount < 4) opts.minkan = same.slice(0, 3);
        if (i === 1 && !isHonor(k)) opts.chi = this.chiOptions(q, k);
      }
      if (opts.ron || opts.pon.length || opts.minkan || opts.chi.length) {
        const ans = await this.agents[s].respond(this, s, id, seat, opts);
        if (ans.type === 'ron' && !opts.ron) ans.type = 'pass';
        if (opts.ron && ans.type !== 'ron') this.markMissed(q);
        responses.push({ seat: s, ans, opts, order: i });
      }
    }
    const rons = responses.filter((r) => r.ans.type === 'ron');
    if (rons.length) {
      if (declareRiichi) { p.riichi = false; p.doubleRiichi = false; }
      return { end: await this.resolveWin(rons.map((r) => ({ seat: r.seat, tsumo: false, winId: id, result: r.opts.ron })), seat) };
    }
    if (declareRiichi) {
      this.scores[seat] -= 1000;
      this.riichiSticks++;
      p.ippatsu = true;
      await this.emit('riichiEstablished', { seat });
      if (this.players.every((q) => q.riichi)) {
        await this.emit('abort', { reason: '四家立直' });
        return { end: { type: 'abort', reason: '四家立直', deltas: [0, 0, 0, 0] } };
      }
    }
    // 四風連打
    if (this.totalDiscards === 4 && !this.anyCall) {
      const firsts = this.players.map((q) => q.discards[0] && kindOf(q.discards[0].id));
      if (isWind(firsts[0]) && firsts.every((x) => x === firsts[0])) {
        await this.emit('abort', { reason: '四風連打' });
        return { end: { type: 'abort', reason: '四風連打', deltas: [0, 0, 0, 0] } };
      }
    }
    const call = responses.find((r) => r.ans.type === 'pon' || r.ans.type === 'minkan')
      || responses.find((r) => r.ans.type === 'chi');
    if (call) {
      await this.doCall(call.seat, seat, id, call.ans, call.opts);
      return { call: { seat: call.seat, type: call.ans.type } };
    }
    return {};
  }

  chiOptions(q, k) {
    const s = suitOf(k), n = numOf(k);
    const out = [];
    const patterns = [[-2, -1], [-1, 1], [1, 2]];
    for (const [a, b] of patterns) {
      const na = n + a, nb = n + b;
      if (na < 1 || nb > 9) continue;
      const ka = s * 9 + na - 1, kb = s * 9 + nb - 1;
      const ia = q.hand.filter((x) => kindOf(x) === ka).sort((x, y) => isRed(x) - isRed(y))[0];
      const ib = q.hand.filter((x) => kindOf(x) === kb).sort((x, y) => isRed(x) - isRed(y))[0];
      if (ia === undefined || ib === undefined) continue;
      if (!this.hasDiscardAfterCall(q, [ia, ib], k, Math.min(ka, kb, k))) continue;
      out.push([ia, ib]);
    }
    return out;
  }

  kuikaeKinds(calledKind, seqStart) {
    const f = [calledKind];
    if (seqStart !== null) {
      // 筋喰い替え
      if (calledKind === seqStart && numOf(seqStart) <= 6) f.push(seqStart + 3);
      if (calledKind === seqStart + 2 && numOf(seqStart) >= 2) f.push(seqStart - 1);
    }
    return f;
  }

  hasDiscardAfterCall(q, ids, calledKind, seqStart) {
    const rest = q.hand.filter((x) => !ids.includes(x));
    const f = this.kuikaeKinds(calledKind, seqStart);
    return rest.some((x) => !f.includes(kindOf(x)));
  }

  async doCall(seat, fromSeat, tileId, ans, opts) {
    const q = this.players[seat];
    const from = this.players[fromSeat];
    from.discards[from.discards.length - 1].called = true;
    const k = kindOf(tileId);
    let ids, meld;
    if (ans.type === 'pon') {
      ids = ans.ids && opts.pon.some((o) => o.join() === ans.ids.join()) ? ans.ids : opts.pon[0];
      meld = { type: 'pon', k, ids: [...ids, tileId], called: tileId, from: fromSeat };
      q.kuikae = this.kuikaeKinds(k, null);
    } else if (ans.type === 'minkan') {
      ids = opts.minkan;
      meld = { type: 'minkan', k, ids: [...ids, tileId], called: tileId, from: fromSeat };
      q.kuikae = [];
    } else {
      ids = ans.ids && opts.chi.some((o) => o.join() === ans.ids.join()) ? ans.ids : opts.chi[0];
      const start = Math.min(k, ...ids.map(kindOf));
      meld = { type: 'chi', k: start, ids: [tileId, ...ids], called: tileId, from: fromSeat };
      q.kuikae = this.kuikaeKinds(k, start);
    }
    q.hand = q.hand.filter((x) => !ids.includes(x));
    q.melds.push(meld);
    this.anyCall = true;
    for (const pl of this.players) pl.ippatsu = false;
    if (ans.type === 'minkan') {
      q.kans++;
      this.kanCount++;
      this.doraIndicators.push(this.dead[4 + this.kanCount]);
    }
    await this.emit('call', { seat, fromSeat, type: ans.type, meld });
    if (ans.type === 'minkan') await this.emit('dora');
  }

  async resolveWin(wins, fromSeat) {
    // wins: [{seat, tsumo, winId, result}] (放銃者から近い順)
    const deltas = [0, 0, 0, 0];
    const details = [];
    wins.forEach((w, idx) => {
      const r = w.result;
      const d = [0, 0, 0, 0];
      const honba = idx === 0 ? this.honba : 0;
      if (w.tsumo) {
        for (let s = 0; s < 4; s++) {
          if (s === w.seat) continue;
          let pay;
          if (r.pay.all) pay = r.pay.all;
          else pay = s === this.dealer ? r.pay.dealer : r.pay.nonDealer;
          pay += honba * 100;
          d[s] -= pay;
          d[w.seat] += pay;
        }
      } else {
        const pay = r.pay.ron + honba * 300;
        d[fromSeat] -= pay;
        d[w.seat] += pay;
      }
      if (idx === 0) {
        d[w.seat] += this.riichiSticks * 1000;
      }
      for (let s = 0; s < 4; s++) deltas[s] += d[s];
      const p = this.players[w.seat];
      details.push({
        seat: w.seat, tsumo: w.tsumo, winId: w.winId, result: r, from: fromSeat,
        hand: w.tsumo ? p.hand.filter((x) => x !== w.winId) : p.hand.slice(),
        melds: p.melds.map((m) => ({ ...m, ids: m.ids.slice() })),
        dora: this.doraIndicators.slice(),
        ura: p.riichi ? this.uraIndicators() : [],
        delta: d,
      });
    });
    this.riichiSticks = 0;
    for (let s = 0; s < 4; s++) this.scores[s] += deltas[s];
    const result = { type: 'win', wins: details, deltas, from: fromSeat };
    await this.emit('win', { result });
    return result;
  }

  async exhaustiveDraw() {
    const tenpai = [];
    for (const p of this.players) {
      if (this.playerWaits(p).length > 0) tenpai.push(p.seat);
    }
    const deltas = [0, 0, 0, 0];
    if (tenpai.length > 0 && tenpai.length < 4) {
      const gain = 3000 / tenpai.length;
      const loss = 3000 / (4 - tenpai.length);
      for (let s = 0; s < 4; s++) deltas[s] = tenpai.includes(s) ? gain : -loss;
    }
    for (let s = 0; s < 4; s++) this.scores[s] += deltas[s];
    const result = { type: 'draw', tenpai, deltas, hands: this.players.map((p) => p.hand.slice()) };
    await this.emit('draw_end', { result });
    return result;
  }
}

function decomposeHasTriplet(counts, k) {
  // counts (14枚) を分解して k が刻子として使われる分解が全て である場合 true
  // 簡易: k を刻子として抜いた残りで和了形になるか
  if (counts[k] < 3) return false;
  const c = counts.slice(); c[k] -= 3;
  // 残り 11 枚が 1雀頭 + 3面子 (副露数は関係なく形だけ)
  const s = shantenLocal(c);
  return s;
}

function shantenLocal(c) {
  // 雀頭 + 面子のみで構成できるか
  for (let h = 0; h < 34; h++) {
    if (c[h] < 2) continue;
    c[h] -= 2;
    const ok = allMentsu(c, 0);
    c[h] += 2;
    if (ok) return true;
  }
  return false;
}

function allMentsu(c, i) {
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) return true;
  if (c[i] >= 3) { c[i] -= 3; const ok = allMentsu(c, i); c[i] += 3; if (ok) return true; }
  if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = allMentsu(c, i);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}
