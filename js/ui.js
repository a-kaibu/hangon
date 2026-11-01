// 画面描画と人間プレイヤーの入力
import { kindOf, isRed, kindName, WIND_NAMES, idsToCounts, parseKinds, sortIds } from './tile.js';
import { shanten, waits } from './shanten.js';
import { chooseDiscard, LEVELS } from './ai.js';
import { combinedDanger, dangerLevel, threatLevel } from './danger.js';
import { YAKU_LIST, DORA_NOTE } from './yakulist.js';

const REL_NAMES = ['あなた', '下家', '対面', '上家'];
const ROT = ['0deg', '-90deg', '180deg', '90deg'];
const DANGER_LABEL = ['安全', '比較的安全', '注意', '危険'];

export function tileHtml(id, { kind = null, cls = '', sideways = false, back = false, attrs = '' } = {}) {
  if (back) return `<div class="tile back ${cls}"></div>`;
  const k = kind !== null ? kind : kindOf(id);
  const red = kind === null && isRed(id);
  const sym = `t${k}${red ? 'r' : ''}`;
  return `<div class="tile ${sideways ? 'sideways' : ''} ${cls}" ${attrs} title="${kindName(k)}${red ? '(赤)' : ''}"><svg viewBox="0 0 60 80"><use href="#${sym}"/></svg></div>`;
}

const kindsHtml = (ks, cls = '') => ks.map((k) => tileHtml(null, { kind: k, cls })).join('');

function meldHtml(m, ownerSeat, cls = '') {
  // 鳴いた相手の方向の牌を横向きに: 上家=左, 対面=中央, 下家=右
  const rel = (m.from - ownerSeat + 4) % 4;
  if (m.type === 'ankan') {
    return `<div class="meld">${m.ids.map((id, i) => tileHtml(id, { back: i === 0 || i === 3, cls })).join('')}</div>`;
  }
  let ids = m.ids.filter((x) => x !== m.called && x !== m.added);
  if (m.type === 'chi') ids = ids.sort((a, b) => a - b);
  const pos = rel === 3 ? 0 : rel === 2 ? 1 : ids.length;
  const parts = ids.map((id) => tileHtml(id, { cls }));
  let calledHtml = tileHtml(m.called, { sideways: true, cls });
  if (m.type === 'kakan') {
    calledHtml = `<div class="kakan-wrap">${calledHtml}${tileHtml(m.added, { sideways: true, cls })}</div>`;
  }
  parts.splice(pos, 0, calledHtml);
  return `<div class="meld">${parts.join('')}</div>`;
}

function fmtDelta(d) {
  if (d > 0) return `<span class="plus">+${d}</span>`;
  if (d < 0) return `<span class="minus">${d}</span>`;
  return '±0';
}

export class UI {
  constructor(settings, onNewGame) {
    this.settings = settings;
    this.onNewGame = onNewGame;
    this.board = document.getElementById('board');
    this.handRow = document.getElementById('hand-row');
    this.actions = document.getElementById('actions');
    this.assist = document.getElementById('assist');
    this.modal = document.getElementById('modal');
    this.callouts = document.getElementById('callouts');
    this.game = null;
    this.pending = null;
    this.selected = null;
    this.riichiMode = false;
    this.lastDiscardId = null;
    this.hoverKind = null;
    document.querySelector('.tools').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'yaku') this.showYakuList();
      if (b.dataset.act === 'help') this.showDangerHelp();
      if (b.dataset.act === 'settings') this.showSettings(false);
    });
    this.handRow.addEventListener('pointerup', (e) => this.onHandPointer(e));
    this.handRow.addEventListener('pointerover', (e) => {
      const t = e.target.closest('[data-id]');
      if (!t || e.pointerType !== 'mouse') return;
      this.hoverKind = kindOf(+t.dataset.id);
      this.renderAssist();
    });
    this.handRow.addEventListener('pointerleave', () => {
      this.hoverKind = null;
      this.renderAssist();
    });
    window.addEventListener('resize', () => this.game && this.render());
  }

  get speed() {
    return { slow: 1.6, normal: 1, fast: 0.45 }[this.settings.speed] ?? 1;
  }
  sleep(ms) {
    const g = this.game;
    return new Promise((r) => setTimeout(r, ms * this.speed)).then(() => {
      if (g !== this.game) throw new Error('cancelled');
    });
  }

  attach(game) {
    this.game = game;
    this.pending = null;
    this.closeModal();
  }

  // ---- ゲームからのイベント ----
  async event(type, data, game) {
    if (game !== this.game) throw new Error('cancelled');
    switch (type) {
      case 'gameStart':
        this.render();
        break;
      case 'handStart':
        this.lastDiscardId = null;
        this.render();
        this.callout(game.roundLabel() + (game.honba ? ` ${game.honba}本場` : ''), 0, true, false);
        await this.sleep(900);
        break;
      case 'draw':
        this.render();
        if (data.seat !== 0) await this.sleep(180);
        break;
      case 'discard':
        this.lastDiscardId = data.id;
        if (data.riichi) {
          this.callout('リーチ', data.seat);
        }
        this.render();
        await this.sleep(data.seat === 0 ? 120 : data.riichi ? 800 : 420);
        break;
      case 'riichiEstablished':
        this.render();
        break;
      case 'call': {
        const name = { pon: 'ポン', chi: 'チー', minkan: 'カン' }[data.type];
        this.callout(name, data.seat);
        this.render();
        await this.sleep(650);
        break;
      }
      case 'kan':
        this.callout('カン', data.seat);
        this.render();
        await this.sleep(650);
        break;
      case 'dora':
        this.render();
        break;
      case 'win': {
        const r = data.result;
        for (const w of r.wins) this.callout(w.tsumo ? 'ツモ' : 'ロン', w.seat, false, true);
        this.render(true);
        await this.sleep(1100);
        await this.showWinResult(r);
        break;
      }
      case 'draw_end':
        this.callout('流局', 0, true);
        this.render(true);
        await this.sleep(900);
        await this.showDrawResult(data.result);
        break;
      case 'abort':
        this.callout(data.reason, 0, true);
        await this.sleep(1000);
        await this.showAbortResult(data.reason);
        break;
      case 'gameEnd':
        this.render();
        await this.showFinal(data.ranking);
        break;
      default:
        break;
    }
  }

  callout(text, seat, center = false, red = false) {
    const rect = this.board.getBoundingClientRect();
    const cx = rect.left + rect.width / 2,
      cy = rect.top + rect.height / 2;
    const off = rect.width * 0.3;
    const pos = center
      ? [cx, cy]
      : [
          [cx, cy + off],
          [cx + off, cy],
          [cx, cy - off],
          [cx - off, cy],
        ][seat];
    const el = document.createElement('div');
    el.className = 'callout' + (red ? ' red' : '');
    el.textContent = text;
    el.style.left = pos[0] + 'px';
    el.style.top = pos[1] + 'px';
    this.callouts.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  // ---- 描画 ----
  render(reveal = false) {
    const g = this.game;
    if (!g || !g.players) {
      this.board.innerHTML = '';
      return;
    }
    this.renderBoard(reveal);
    this.renderHand();
    this.renderActions();
    this.renderAssist();
  }

  renderBoard(reveal) {
    const g = this.game;
    let html = '';
    const turnSeat = this.currentTurnSeat();
    for (let rel = 0; rel < 4; rel++) {
      const seat = rel; // 人間は seat 0
      const p = g.players[seat];
      // 河
      const rows = [];
      p.discards.forEach((d, i) => {
        const r = Math.min(Math.floor(i / 6), 3);
        (rows[r] ||= []).push({ d, i });
      });
      const riverHtml = rows
        .map(
          (row) =>
            `<div class="river-row">${row
              .map(({ d }) =>
                tileHtml(d.id, {
                  sideways: d.riichi || (p.riichi && !d.riichi && false),
                  cls: [d.called ? 'dim' : '', d.id === this.lastDiscardId && !d.called ? 'last' : ''].join(' '),
                }),
              )
              .join('')}</div>`,
        )
        .join('');
      let area = '';
      if (rel !== 0) {
        const hand =
          reveal || this.settings.debugOpen
            ? sortIds(p.hand)
                .map((id) => tileHtml(id, { cls: 'small' }))
                .join('')
            : p.hand.map(() => tileHtml(null, { back: true, cls: 'small' })).join('');
        const melds = p.melds.map((m) => meldHtml(m, seat, 'small')).join('');
        area = `<div class="opp-area"><div class="opp-hand">${hand}</div><div class="melds">${melds}</div></div>`;
      }
      html += `<div class="seat ${turnSeat === seat ? 'turn' : ''}" style="--rot:${ROT[rel]}"><div class="river">${riverHtml}</div>${area}</div>`;
    }
    // 中央
    const doraSlots = [];
    for (let i = 0; i < 5; i++) {
      const id = g.doraIndicators[i];
      doraSlots.push(id !== undefined ? tileHtml(id) : tileHtml(null, { back: true }));
    }
    let tags = '';
    for (let rel = 0; rel < 4; rel++) {
      const seat = rel;
      const w = g.seatWind(seat) - 27;
      tags += `<div class="score-tag st-${rel} ${turnSeat === seat ? 'active' : ''}">
        <span><span class="wind ${seat === g.dealer ? 'dealer' : ''}">${WIND_NAMES[w]}</span> <span class="pts">${g.scores[seat]}</span></span>
        <span class="st-name">${g.names[seat]}</span>
        ${g.players[seat].riichi ? '<span class="rii"></span>' : ''}
      </div>`;
    }
    html += `<div class="center">${tags}<div class="center-info">
      <div class="round-label">${g.roundLabel()}</div>
      <div class="sub-label">${g.honba}本場 · 供託 ${g.riichiSticks}</div>
      <div class="remain">残り <b>${g.wallRemaining}</b></div>
      <div class="dora-row" title="ドラ表示牌">${doraSlots.join('')}</div>
    </div></div>`;
    this.board.innerHTML = html;
  }

  currentTurnSeat() {
    const g = this.game;
    if (!g.players) return -1;
    const withDrawn = g.players.find((p) => p.hand.length + p.melds.length * 3 === 14);
    if (withDrawn) return withDrawn.seat;
    return g.lastDiscard ? g.lastDiscard.seat : g.dealer;
  }

  myAnalysis() {
    // 現在の pending 状態に対するアシスト計算 (キャッシュ)
    const g = this.game;
    const key = g.players[0].hand.join(',') + '|' + g.discardLog.length + '|' + g.doraIndicators.length;
    if (this._an && this._an.key === key) return this._an;
    const p = g.players[0];
    const an = { key };
    const isMyTurn = this.pending && this.pending.type === 'self';
    const cache = {};
    an.threat = [1, 2, 3].map((s) => ({ seat: s, level: threatLevel(g, 0, s) }));
    an.anyThreat = an.threat.some((t) => t.level >= 0.3);
    an.danger = {};
    for (const id of p.hand) {
      const k = kindOf(id);
      if (!(k in an.danger)) an.danger[k] = combinedDanger(g, 0, k, cache);
    }
    if (isMyTurn) {
      const forbidden = this.pending.opts.forbidden || [];
      const res = chooseDiscard(g, 0, 'hard', forbidden);
      an.recoId = res.id;
      an.cands = res.cands;
      an.recoKind = kindOf(res.id);
      an.shanten = Math.min(...res.cands.map((c) => c.shanten));
      an.byKind = {};
      for (const c of res.cands) if (!(c.k in an.byKind)) an.byKind[c.k] = c;
    } else {
      const c = idsToCounts(p.hand);
      an.shanten13 = shanten(c, p.melds.length);
      if (an.shanten13 === 0) {
        an.waits = waits(c, p.melds.length);
        const rem = g.remainingFor(0);
        an.waitLeft = an.waits.map((k) => rem[k]);
        an.furiten = g.isFuriten(p);
      }
    }
    this._an = an;
    return an;
  }

  renderHand() {
    const g = this.game;
    const p = g.players[0];
    const pend = this.pending && this.pending.type === 'self' ? this.pending : null;
    const an = this.myAnalysis();
    const showDanger = this.settings.assistDanger && an.anyThreat;
    let ids = p.hand.slice();
    let drawn = null;
    if (p.drawn !== null && ids.includes(p.drawn)) {
      drawn = p.drawn;
      ids = ids.filter((x) => x !== drawn);
    }
    ids = sortIds(ids);
    const allowed = (id) => {
      if (!pend) return false;
      if (p.riichi) return id === p.drawn;
      if ((pend.opts.forbidden || []).includes(kindOf(id))) return false;
      if (this.riichiMode) return pend.opts.riichi.includes(id);
      return true;
    };
    const cell = (id, extra = '') => {
      const k = kindOf(id);
      const ok = allowed(id);
      const cls = [
        extra,
        ok ? 'ok' : pend ? 'ng' : '',
        this.selected === id ? 'selected' : '',
        pend && this.settings.assistReco && an.recoId !== undefined && kindOf(an.recoId) === k && !this.riichiMode ? 'reco' : '',
      ].join(' ');
      let badge = '<span class="badge empty">-</span>';
      if (showDanger) {
        const d = an.danger[k];
        const lv = dangerLevel(d.pct);
        const tag = d.worst ? d.worst.tag : '';
        badge = `<span class="badge l${lv}" title="${DANGER_LABEL[lv]}">${lv === 0 ? '安全' : tag}</span>`;
      }
      return `<div class="tile-cell">${tileHtml(id, { cls, attrs: `data-id="${id}"` })}${badge}</div>`;
    };
    const handHtml = ids.map((id) => cell(id)).join('') + (drawn !== null ? cell(drawn, 'drawn') : '');
    const meldsHtml = p.melds
      .slice()
      .reverse()
      .map((m) => meldHtml(m, 0))
      .join('');
    this.handRow.innerHTML = `<div class="my-hand ${pend ? 'can-discard' : ''}">${handHtml}</div><div class="melds my-melds">${meldsHtml}</div>`;
  }

  renderAssist() {
    const g = this.game;
    if (!g || !g.players) {
      this.assist.innerHTML = '';
      return;
    }
    const an = this.myAnalysis();
    const parts = [];
    const p = g.players[0];
    // 脅威
    const threats = an.threat.filter((t) => t.level >= 0.3);
    if (threats.length && this.settings.assistDanger) {
      const names = threats.map((t) => `${REL_NAMES[t.seat]}${g.players[t.seat].riichi ? 'リーチ' : '(仕掛け)'}`).join('・');
      parts.push(`<span class="warn">⚠ ${names}</span>`);
    }
    if (this.hoverKind !== null && this.pending && this.pending.type === 'self') {
      const k = this.hoverKind;
      const c = an.byKind && an.byKind[k];
      let s = `<span class="inl">${kindsHtml([k])}</span>`;
      if (c && this.settings.assistShanten)
        s += ` 切ると ${c.shanten <= 0 ? '聴牌' : c.shanten + '向聴'} · 有効牌 ${c.shanten === 0 && c.waitInfo ? c.waitInfo.left : c.ukeire}枚`;
      if (this.settings.assistDanger && an.anyThreat) {
        const d = an.danger[k];
        if (d && d.worst)
          s += ` · <b>${DANGER_LABEL[dangerLevel(d.pct)]}</b> ${REL_NAMES[d.worst.target]}に${d.worst.reason} (放銃率目安 ${d.worst.pct.toFixed(1)}%)`;
        else if (d) s += ' · <b>安全</b>';
      }
      parts.push(s);
    } else if (this.pending && this.pending.type === 'self') {
      if (this.settings.assistShanten && an.shanten !== undefined) {
        parts.push(an.shanten <= 0 ? '<span class="good">聴牌できます</span>' : `<b>${an.shanten}向聴</b>`);
      }
      if (this.settings.assistReco && an.recoId !== undefined && !p.riichi) {
        const c = an.byKind[an.recoKind];
        let why = '';
        if (c) {
          why = c.shanten === 0 && c.waitInfo ? `待ち ${c.waitInfo.left}枚` : `有効牌 ${c.ukeire}枚`;
          if (c.risk !== undefined && an.anyThreat) why += c.risk < 1 ? ' · 安全寄り' : '';
        }
        parts.push(`おすすめ <span class="inl">${kindsHtml([an.recoKind])}</span> (${why})`);
      }
      if (this.riichiMode) parts.push('<span class="warn">リーチ: 切る牌を選んでください</span>');
    } else if (this.settings.assistShanten && an.shanten13 !== undefined) {
      if (an.shanten13 === 0) {
        const w = an.waits.map((k) => `${tileHtml(null, { kind: k })}`).join('');
        const left = an.waitLeft.reduce((a, b) => a + b, 0);
        parts.push(
          `聴牌 待ち <span class="inl">${w}</span> 残り${left}枚${an.furiten ? ' <span class="bad">フリテン(ロン不可・ツモのみ)</span>' : ''}`,
        );
      } else {
        parts.push(`${an.shanten13}向聴`);
      }
    }
    this.assist.innerHTML = parts.join(' · ');
  }

  renderActions() {
    const pend = this.pending;
    if (!pend) {
      this.actions.innerHTML = '';
      return;
    }
    const b = [];
    if (pend.type === 'self') {
      const o = pend.opts;
      if (o.tsumo) b.push(`<button class="btn win" data-a="tsumo">ツモ</button>`);
      if (o.riichi.length && !this.game.players[0].riichi) {
        b.push(
          this.riichiMode
            ? `<button class="btn ghost" data-a="riichi-cancel">リーチ取消</button>`
            : `<button class="btn primary" data-a="riichi">リーチ</button>`,
        );
      }
      o.kans.forEach((kn, i) =>
        b.push(
          `<button class="btn call" data-a="kan" data-i="${i}">${kn.type === 'ankan' ? '暗槓' : '加槓'}<span class="opt-tiles">${kindsHtml([kn.k])}</span></button>`,
        ),
      );
      if (o.kyuushu) b.push(`<button class="btn ghost" data-a="kyuushu">九種九牌</button>`);
    } else {
      const o = pend.opts;
      if (o.ron) b.push(`<button class="btn win" data-a="ron">ロン</button>`);
      o.chi.forEach((ids, i) =>
        b.push(
          `<button class="btn call" data-a="chi" data-i="${i}">チー<span class="opt-tiles">${sortIds([...ids, pend.tile])
            .map((id) => tileHtml(id))
            .join('')}</span></button>`,
        ),
      );
      o.pon.forEach((ids, i) => b.push(`<button class="btn call" data-a="pon" data-i="${i}">ポン</button>`));
      if (o.minkan) b.push(`<button class="btn call" data-a="minkan">カン</button>`);
      b.push(`<button class="btn ghost" data-a="pass">スキップ</button>`);
    }
    this.actions.innerHTML = b.join('');
    this.actions.onclick = (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      this.onAction(btn.dataset.a, btn.dataset.i !== undefined ? +btn.dataset.i : null);
    };
  }

  onAction(a, i) {
    const pend = this.pending;
    if (!pend) return;
    if (pend.type === 'self') {
      if (a === 'tsumo') return this.resolve({ type: 'tsumo' });
      if (a === 'kyuushu') return this.resolve({ type: 'kyuushu' });
      if (a === 'kan') return this.resolve({ type: 'kan', ...pend.opts.kans[i] });
      if (a === 'riichi') {
        this.riichiMode = true;
        this.selected = null;
        return this.render();
      }
      if (a === 'riichi-cancel') {
        this.riichiMode = false;
        return this.render();
      }
    } else {
      if (a === 'ron') return this.resolve({ type: 'ron' });
      if (a === 'pass') return this.resolve({ type: 'pass' });
      if (a === 'pon') return this.resolve({ type: 'pon', ids: pend.opts.pon[i] });
      if (a === 'chi') return this.resolve({ type: 'chi', ids: pend.opts.chi[i] });
      if (a === 'minkan') return this.resolve({ type: 'minkan' });
    }
  }

  onHandPointer(e) {
    const t = e.target.closest('[data-id]');
    const pend = this.pending;
    if (!t || !pend || pend.type !== 'self') return;
    if (!t.classList.contains('ok')) return;
    const id = +t.dataset.id;
    if (e.pointerType !== 'mouse' && this.selected !== id) {
      // タッチ: 1回目で選択 (情報表示)、2回目で打牌
      this.selected = id;
      this.hoverKind = kindOf(id);
      this.renderHand();
      this.renderAssist();
      return;
    }
    this.resolve({ type: 'discard', id, riichi: this.riichiMode });
  }

  resolve(v) {
    const pend = this.pending;
    this.pending = null;
    this.riichiMode = false;
    this.selected = null;
    this.hoverKind = null;
    this._an = null;
    this.actions.innerHTML = '';
    pend.resolve(v);
  }

  promptSelf(opts) {
    return new Promise((resolve) => {
      this.pending = { type: 'self', opts, resolve };
      this._an = null;
      this.render();
    });
  }

  promptCall(tile, from, opts) {
    return new Promise((resolve) => {
      this.pending = { type: 'call', tile, from, opts, resolve };
      this._an = null;
      this.render();
    });
  }

  // ---- モーダル ----
  openModal(html) {
    this.modal.innerHTML = `<div class="sheet">${html}</div>`;
    this.modal.classList.remove('hidden');
    return this.modal.querySelector('.sheet');
  }
  closeModal() {
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
  }

  waitButton(sheet, sel = '[data-close]') {
    return new Promise((resolve) => {
      sheet.querySelectorAll(sel).forEach((b) =>
        b.addEventListener('click', () => {
          this.closeModal();
          resolve(b.dataset.close);
        }),
      );
    });
  }

  deltasHtml(deltas) {
    const g = this.game;
    return `<div class="deltas">${[0, 1, 2, 3].map((s) => `<div>${g.names[s]}<b>${g.scores[s]}</b>${fmtDelta(deltas[s])}</div>`).join('')}</div>`;
  }

  handGroupsHtml(handIds, melds, seat, winId) {
    const groups = [
      `<div class="group">${sortIds(handIds)
        .map((id) => tileHtml(id))
        .join('')}${winId !== undefined ? tileHtml(winId, { cls: 'win-tile' }) : ''}</div>`,
    ];
    for (const m of melds) groups.push(`<div class="group">${meldHtml(m, seat)}</div>`);
    return `<div class="result-hand">${groups.join('')}</div>`;
  }

  async showWinResult(r) {
    const g = this.game;
    let html = '';
    for (const w of r.wins) {
      const res = w.result;
      const who = g.names[w.seat];
      const how = w.tsumo ? 'ツモ' : `ロン (${g.names[w.from]}から)`;
      const rows =
        res.yaku
          .map((y) => `<tr><td>${y.name}</td><td>${y.yakuman ? (y.han > 1 ? 'ダブル役満' : '役満') : y.han + '翻'}</td></tr>`)
          .join('') + res.dora.map((y) => `<tr><td>${y.name}</td><td>${y.han}翻</td></tr>`).join('');
      const pts = w.tsumo ? (res.pay.all ? `${res.pay.all}オール` : `${res.pay.nonDealer}・${res.pay.dealer}`) : `${res.pay.ron}`;
      const label = res.yakuman ? res.limit : `${res.fu}符 ${res.han}翻${res.limit ? ' ' + res.limit : ''}`;
      html += `<h2>${who} ${how}</h2>
        ${this.handGroupsHtml(w.hand, w.melds, w.seat, w.winId)}
        <div class="ind-row">ドラ表示 ${w.dora.map((id) => tileHtml(id)).join('')}${w.ura.length ? ' 裏ドラ表示 ' + w.ura.map((id) => tileHtml(id)).join('') : ''}</div>
        <table class="yaku-table">${rows}</table>
        <div class="big-points">${pts}点<small>${label}</small></div>`;
    }
    html += this.deltasHtml(r.deltas);
    html += `<div class="foot"><button class="btn primary" data-close="1">次へ</button></div>`;
    await this.waitButton(this.openModal(html));
  }

  async showDrawResult(r) {
    const g = this.game;
    let html = `<h2>流局</h2>`;
    html += `<p>聴牌: ${r.tenpai.length ? r.tenpai.map((s) => g.names[s]).join('、') : 'なし'}</p>`;
    for (const s of r.tenpai) {
      html += `<h3>${g.names[s]}</h3>${this.handGroupsHtml(g.players[s].hand, g.players[s].melds, s)}`;
    }
    html += this.deltasHtml(r.deltas);
    html += `<div class="foot"><button class="btn primary" data-close="1">次へ</button></div>`;
    await this.waitButton(this.openModal(html));
  }

  async showAbortResult(reason) {
    const html = `<h2>途中流局 — ${reason}</h2><p>この局はやり直しになります (親は継続、本場+1)。</p><div class="foot"><button class="btn primary" data-close="1">次へ</button></div>`;
    await this.waitButton(this.openModal(html));
  }

  async showFinal(ranking) {
    const html = `<h2>対局終了</h2><div class="rank-list">${ranking
      .map((r) => `<div class="${r.seat === 0 ? 'me-row' : ''}"><span>${r.rank}位 ${r.name}</span><b>${r.score}</b></div>`)
      .join('')}</div>
      <div class="foot"><button class="btn primary" data-close="new">もう一度</button></div>`;
    const v = await this.waitButton(this.openModal(html));
    if (v === 'new') this.showSettings(true);
  }

  showYakuList() {
    const cats = [
      [1, '1翻'],
      [2, '2翻'],
      [3, '3翻'],
      [6, '6翻'],
      [13, '役満'],
    ];
    const card = (y) => {
      const hn =
        y.cat === 13
          ? (y.han > 13 ? 'ダブル役満' : '役満') + (y.open === null ? ' · 門前のみ' : '')
          : `${y.han}翻` + (y.open === null ? ' · 門前のみ' : y.open < y.han ? ` · 鳴き${y.open}翻` : ' · 鳴きOK');
      const ex = y.ex ? `<div class="ex">${kindsHtml(parseKinds(y.ex))}</div>` : '';
      return `<div class="yaku-card" data-s="${y.name}${y.read}${y.desc}"><div class="hd"><span><span class="nm">${y.name}</span><span class="rd">${y.read}</span></span><span class="hn">${hn}</span></div>
        <div class="ds">${y.desc}</div>${ex}${y.tip ? `<div class="tp">💡 ${y.tip}</div>` : ''}</div>`;
    };
    let html = `<h2>役一覧</h2><input class="search" placeholder="検索 (例: タンヤオ、鳴き)" aria-label="役を検索">
      <p>${DORA_NOTE} 和了るには役が最低1つ必要です。</p>`;
    for (const [c, label] of cats) {
      html += `<h3>${label}</h3><div class="yaku-grid">${YAKU_LIST.filter((y) => y.cat === c)
        .map(card)
        .join('')}</div>`;
    }
    html += `<h3>点数の目安 (子 / 親・ロン)</h3>
      <table class="yaku-table"><tr><td>1翻30符</td><td>1000 / 1500</td></tr><tr><td>2翻30符</td><td>2000 / 2900</td></tr>
      <tr><td>3翻30符</td><td>3900 / 5800</td></tr><tr><td>満貫 (4翻40符〜5翻)</td><td>8000 / 12000</td></tr>
      <tr><td>跳満 (6-7翻)</td><td>12000 / 18000</td></tr><tr><td>倍満 (8-10翻)</td><td>16000 / 24000</td></tr>
      <tr><td>三倍満 (11-12翻)</td><td>24000 / 36000</td></tr><tr><td>役満</td><td>32000 / 48000</td></tr></table>`;
    html += `<div class="foot"><button class="btn primary" data-x>閉じる</button></div>`;
    const sheet = this.openModal(html);
    sheet.querySelector('[data-x]').onclick = () => this.closeModal();
    sheet.querySelector('.search').oninput = (e) => {
      const q = e.target.value.trim();
      sheet.querySelectorAll('.yaku-card').forEach((c) => {
        c.style.display = !q || c.dataset.s.includes(q) ? '' : 'none';
      });
    };
  }

  showDangerHelp() {
    const html = `<h2>危険牌の見方</h2>
      <p>誰かがリーチ(または鳴いて手が進んでいそう)なとき、手牌の下に危険度が表示されます。自分の手が悪いときは、安全な牌から切って放銃(相手に振り込むこと)を避けるのが基本です。</p>
      <div class="legend">
        <div class="item"><span class="badge l0">安全</span><div><b>現物</b>: 相手がすでに捨てている牌。フリテンのルールにより、その相手には絶対にロンされません。リーチ後に他の人が切って通った牌も同じです。</div></div>
        <div class="item"><span class="badge l1">筋</span><div><b>筋 (スジ)</b>: 相手が4を捨てていれば1と7は「両面待ち」では当たりません(14・47の関係)。同様に 2-5-8、3-6-9。両面以外の待ちには当たるので完全安全ではありません。</div></div>
        <div class="item"><span class="badge l1">壁</span><div><b>壁 (ノーチャンス)</b>: 例えば8が4枚すべて見えていれば、相手は「78」「89」を持てないので9の両面待ちはありません。</div></div>
        <div class="item"><span class="badge l1">字牌</span><div><b>字牌</b>: 場に2枚以上見えている字牌は、単騎待ちくらいでしか当たらず比較的安全。1枚も見えていない字牌(生牌)は危険度が上がります。</div></div>
        <div class="item"><span class="badge l2">片筋</span><div><b>片筋</b>: 4・5・6は両側に筋があります。片方しか通っていない場合は半分だけ安全です。</div></div>
        <div class="item"><span class="badge l3">無筋</span><div><b>無筋</b>: 筋も壁もない数牌。真ん中の牌(4〜6)ほど両面待ちに当たりやすく危険です。ドラも危険度が上がります。</div></div>
      </div>
      <h3>押し引きの目安</h3>
      <p>・リーチを受けて自分が2向聴以上 → ほぼベタオリ(安全牌だけ切る)<br>・1向聴 → 手が高い(満貫級)なら少し押す、安ければ降りる<br>・聴牌 → 基本は押す。待ちが悪く安い手なら危険牌は止める</p>
      <p>表示される%は公開されている統計傾向にもとづく目安で、相手の河の読みまではしていません。</p>
      <div class="foot"><button class="btn primary" data-x>閉じる</button></div>`;
    const sheet = this.openModal(html);
    sheet.querySelector('[data-x]').onclick = () => this.closeModal();
  }

  showSettings(isStart) {
    const s = { ...this.settings };
    const seg = (key, opts) =>
      `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${s[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const chk = (key, label) =>
      `<label class="check"><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}> ${label}</label>`;
    const html = `<h2>${isStart ? '対局の設定' : '設定'}</h2>
      <div class="field"><label>CPU の強さ</label>${seg(
        'level',
        Object.entries(LEVELS).map(([k, v]) => [k, v.label]),
      )}</div>
      <div class="field"><label>対局の長さ</label>${seg('length', [
        ['tonpuu', '東風戦'],
        ['hanchan', '半荘戦'],
      ])}</div>
      <div class="field"><label>進行スピード</label>${seg('speed', [
        ['slow', 'ゆっくり'],
        ['normal', 'ふつう'],
        ['fast', 'はやい'],
      ])}</div>
      <div class="field"><label>アシスト</label>
        ${chk('assistShanten', 'シャンテン数・待ちを表示')}
        ${chk('assistReco', 'おすすめの打牌を光らせる')}
        ${chk('assistDanger', '危険牌の目安を表示 (リーチ・仕掛けに対して)')}
        ${chk('noCalls', '鳴きの確認をしない (ロンだけ聞く)')}
      </div>
      <p>ルール: 4人打ち・赤ドラ3枚・喰いタンあり・後付けあり・25000点持ち30000点返し・トビあり。</p>
      <div class="foot">${isStart ? '' : '<button class="btn ghost" data-x>閉じる</button>'}<button class="btn ${isStart ? 'primary' : 'ghost'}" data-new>${isStart ? '対局開始' : '新しい対局を始める'}</button>${isStart ? '' : '<button class="btn primary" data-save>保存</button>'}</div>`;
    const sheet = this.openModal(html);
    sheet.querySelectorAll('.seg').forEach((el) =>
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        s[el.dataset.key] = b.dataset.v;
        el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    sheet.querySelectorAll('input[type=checkbox]').forEach((el) =>
      el.addEventListener('change', () => {
        s[el.dataset.key] = el.checked;
      }),
    );
    const apply = () => {
      Object.assign(this.settings, s);
      this.saveSettings();
      this._an = null;
      if (this.game) this.render();
    };
    sheet.querySelector('[data-new]').onclick = () => {
      apply();
      this.closeModal();
      this.onNewGame();
    };
    const save = sheet.querySelector('[data-save]');
    if (save)
      save.onclick = () => {
        apply();
        this.closeModal();
      };
    const x = sheet.querySelector('[data-x]');
    if (x) x.onclick = () => this.closeModal();
  }

  saveSettings() {
    try {
      localStorage.setItem('hangon.settings', JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }
}

export class HumanAgent {
  constructor(ui) {
    this.ui = ui;
  }
  selfAction(game, seat, opts) {
    return this.ui.promptSelf(opts);
  }
  respond(game, seat, tile, from, opts) {
    if (this.ui.settings.noCalls && !opts.ron) return Promise.resolve({ type: 'pass' });
    return this.ui.promptCall(tile, from, opts);
  }
}
