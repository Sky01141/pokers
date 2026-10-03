const { newDeck, best, cmp, NAMES } = require('./poker');
const SB = 10, BB = 20, START = 1000, TURN_MS = 30000;
const STYLES = ['BALANCED', 'AGGRESSIVE', 'CAUTIOUS', 'BLUFFER', 'RANDOM'];

class Game {
  constructor(code, onUpdate) {
    Object.assign(this, { code, onUpdate, players: [], phase: 'LOBBY', board: [], pot: 0, log: [], result: null, dealer: -1, turn: null, deadline: 0, last: null, currentBet: 0, minRaise: BB, n: 0 });
  }
  get(id) { return this.players.find(p => p.id === id); }
  inHand() { return this.phase !== 'LOBBY' && this.phase !== 'RESULT'; }
  humans() { return this.players.filter(p => !p.bot && !p.left); }
  add(id, name, bot) {
    if (this.players.length >= 6) return false;
    this.players.push({ id, name: (name || 'PLAYER').slice(0, 12), chips: START, hand: [], bet: 0, total: 0, folded: true, allIn: false, acted: false, ready: !!bot, bot: bot || null, left: false });
    return true;
  }
  addBot() { const st = STYLES[Math.floor(Math.random() * STYLES.length)]; return this.add('bot' + (++this.n), 'COM ' + st.slice(0, 4), st); }
  remove(id) {
    const p = this.get(id); if (!p) return;
    if (!this.inHand()) { this.players = this.players.filter(x => x !== p); return; }
    p.left = true;
    if (this.turn === id) return this.act(id, 'fold');
    p.folded = true; this.log.push(p.name + ' LEFT');
    if (this.players.filter(x => !x.folded).length === 1) this.payout(false);
  }
  canAct(p) { return !p.folded && !p.allIn; }
  post(p, a) { a = Math.min(a, p.chips); p.chips -= a; p.bet += a; p.total += a; this.pot += a; if (!p.chips) p.allIn = true; }

  start() {
    if (this.inHand()) return;
    clearTimeout(this.timer);
    this.players = this.players.filter(p => !p.left);
    this.players.forEach(p => { if (p.chips <= 0) p.chips = START; });
    const ps = this.players, n = ps.length;
    if (n < 2 || !this.humans().length) { this.phase = 'LOBBY'; return this.onUpdate(); }
    this.deck = newDeck(); this.board = []; this.pot = 0; this.result = null; this.last = null;
    ps.forEach(p => Object.assign(p, { hand: [this.deck.pop(), this.deck.pop()], bet: 0, total: 0, folded: false, allIn: false, acted: false, eval: null }));
    this.dealer = (this.dealer + 1) % n;
    const sb = n === 2 ? this.dealer : (this.dealer + 1) % n, bb = (sb + 1) % n;
    this.post(ps[sb], SB); this.post(ps[bb], BB);
    this.currentBet = BB; this.minRaise = BB; this.phase = 'PRE-FLOP'; this.log = ['--- NEW HAND ---'];
    this.after(bb);
  }
  after(i) {
    const ps = this.players, live = ps.filter(p => !p.folded);
    if (live.length === 1) return this.payout(false);
    const actors = live.filter(p => this.canAct(p));
    if (actors.every(p => p.acted && p.bet === this.currentBet)) return this.advance();
    for (let k = 1; k <= ps.length; k++) {
      const j = (i + k) % ps.length;
      if (this.canAct(ps[j]) && !(ps[j].acted && ps[j].bet === this.currentBet)) return this.setTurn(ps[j]);
    }
    this.advance();
  }
  setTurn(p) {
    clearTimeout(this.timer);
    this.turn = p.id; this.deadline = Date.now() + TURN_MS;
    const delay = p.bot ? 900 + Math.random() * 1000 : TURN_MS;
    this.timer = setTimeout(() => {
      if (p.bot) this.botAct(p); else this.act(p.id, this.currentBet > p.bet ? 'fold' : 'check');
    }, delay);
    this.onUpdate();
  }
  advance() {
    clearTimeout(this.timer);
    const ps = this.players;
    ps.forEach(p => { p.bet = 0; p.acted = false; });
    this.currentBet = 0; this.minRaise = BB; this.turn = null;
    const nxt = { 'PRE-FLOP': ['FLOP', 3], FLOP: ['TURN', 1], TURN: ['RIVER', 1] }[this.phase];
    if (!nxt) return this.showdown();
    this.phase = nxt[0];
    for (let k = 0; k < nxt[1]; k++) this.board.push(this.deck.pop());
    this.log.push('--- ' + this.phase + ' ---');
    if (ps.filter(p => this.canAct(p)).length < 2) { this.onUpdate(); this.timer = setTimeout(() => this.advance(), 1400); return; }
    this.after(this.dealer);
  }
  showdown() {
    this.players.filter(p => !p.folded).forEach(p => p.eval = best([...p.hand, ...this.board]));
    this.payout(true);
  }
  payout(show) {
    clearTimeout(this.timer); this.turn = null;
    const ps = this.players, win = {};
    const levels = [...new Set(ps.filter(p => p.total > 0).map(p => p.total))].sort((a, b) => a - b);
    let prev = 0, carry = 0;
    for (const L of levels) {
      const part = ps.filter(p => p.total >= L), amt = (L - prev) * part.length + carry; prev = L;
      const el = part.filter(p => !p.folded);
      if (!el.length) { carry = amt; continue; } carry = 0;
      let w = el;
      if (show) { const top = el.reduce((a, b) => cmp(a.eval, b.eval) >= 0 ? a : b); w = el.filter(p => cmp(p.eval, top.eval) === 0); }
      const share = Math.floor(amt / w.length);
      w.forEach(p => { p.chips += share; win[p.id] = (win[p.id] || 0) + share; });
      const rem = amt - share * w.length; w[0].chips += rem; win[w[0].id] += rem;
    }
    this.result = { show, winners: Object.entries(win).map(([id, amount]) => { const p = this.get(id); return { id, name: p.name, amount, hand: show ? NAMES[p.eval.cat] : null }; }) };
    this.phase = 'RESULT'; this.pot = 0;
    this.log.push(this.result.winners.map(w => `${w.name} WINS ${w.amount}${w.hand ? ' (' + w.hand + ')' : ''}`).join(', '));
    this.onUpdate();
    this.timer = setTimeout(() => this.start(), 7000);
  }
  act(id, type, amount) {
    const p = this.get(id);
    if (!p || !this.inHand() || this.turn !== id) return 'NOT YOUR TURN';
    const toCall = this.currentBet - p.bet; amount = Math.floor(+amount) || 0;
    if (type === 'check' && toCall > 0) return 'CANNOT CHECK';
    if (type === 'call' && toCall <= 0) return 'NOTHING TO CALL';
    if (type === 'raise' || type === 'bet') {
      if (amount > p.bet + p.chips) return 'NOT ENOUGH CHIPS';
      if (amount <= this.currentBet) return 'INVALID RAISE';
      if (amount < this.currentBet + this.minRaise && amount < p.bet + p.chips) return 'RAISE TOO SMALL';
    } else if (!['check', 'call', 'fold', 'allin'].includes(type)) return 'INVALID ACTION';
    clearTimeout(this.timer);
    if (type === 'fold') p.folded = true;
    else if (type === 'call') this.post(p, toCall);
    else if (type !== 'check') {
      const to = type === 'allin' ? p.bet + p.chips : amount, inc = to - this.currentBet;
      if (inc > 0) { if (inc >= this.minRaise) this.minRaise = inc; this.currentBet = to; this.players.forEach(q => q.acted = false); }
      this.post(p, to - p.bet);
    }
    p.acted = true;
    const t = type === 'bet' ? 'raise' : (type !== 'fold' && p.allIn) ? 'allin' : type;
    this.last = { id, type: t, n: (this.last ? this.last.n : 0) + 1 };
    this.log.push(`${p.name} ${t.toUpperCase()}`);
    this.after(this.players.indexOf(p));
  }
  botAct(p) {
    const toCall = this.currentBet - p.bet, st = p.bot;
    let s;
    if (this.board.length < 3) { const [a, b] = p.hand; s = (a.r + b.r) / 30 + (a.r === b.r ? .4 : 0) + (a.s === b.s ? .05 : 0); }
    else s = best([...p.hand, ...this.board]).cat / 5 + .15;
    s += { AGGRESSIVE: .12, CAUTIOUS: -.1 }[st] || 0;
    if (st === 'BLUFFER' && Math.random() < .25) s = .9;
    if (st === 'RANDOM') s = Math.random();
    const to = Math.min(p.bet + p.chips, this.currentBet + this.minRaise * (1 + Math.floor(Math.random() * 3)));
    let r;
    if (s > .75 && p.chips > toCall) r = ['raise', to];
    else if (s > .4 || (toCall <= p.chips * .1 && s > .3)) r = [toCall > 0 ? 'call' : 'check'];
    else r = [toCall > 0 ? 'fold' : 'check'];
    if (this.act(p.id, r[0], r[1])) this.act(p.id, toCall > 0 ? 'call' : 'check');
  }
  view(id) {
    const reveal = this.result && this.result.show;
    const host = (this.players.find(p => !p.bot) || {}).id;
    return {
      code: this.code, phase: this.phase, board: this.board, pot: this.pot, currentBet: this.currentBet, minRaise: this.minRaise,
      turn: this.turn, ttl: Math.max(0, (this.deadline - Date.now()) / 1000), me: id, host, log: this.log.slice(-6), result: this.result, last: this.last,
      players: this.players.map((p, i) => ({
        id: p.id, name: p.name, chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn, ready: p.ready, bot: !!p.bot,
        dealer: this.phase !== 'LOBBY' && i === this.dealer,
        hand: p.id === id || (reveal && !p.folded) ? p.hand : p.hand.map(() => null)
      }))
    };
  }
}
module.exports = { Game };
