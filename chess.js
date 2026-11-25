const FILES = 'abcdefgh';
const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const square = (r, c) => FILES[c] + (8 - r);
const coords = s => [8 - Number(s[1]), FILES.indexOf(s[0])];
const copy = s => ({ board: s.board.map(row => row.slice()), turn: s.turn, castle: s.castle, ep: s.ep, halfmove: s.halfmove, fullmove: s.fullmove });
const initial = () => ({ board: [
  ['bR','bN','bB','bQ','bK','bB','bN','bR'],
  Array(8).fill('bP'), ...Array.from({length:4}, () => Array(8).fill(null)),
  Array(8).fill('wP'), ['wR','wN','wB','wQ','wK','wB','wN','wR']
], turn: 'w', castle: 'KQkq', ep: '-', halfmove: 0, fullmove: 1 });

function attacked(state, r, c, by) {
  const b = state.board;
  const pawnRow = r + (by === 'w' ? 1 : -1);
  for (const dc of [-1,1]) if (inBounds(pawnRow,c+dc) && b[pawnRow][c+dc] === by+'P') return true;
  for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])
    if (inBounds(r+dr,c+dc) && b[r+dr][c+dc] === by+'N') return true;
  for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    for (let d = 1; inBounds(r+dr*d,c+dc*d); d++) {
      const p = b[r+dr*d][c+dc*d];
      if (!p) continue;
      if (p[0] === by && ((d === 1 && p[1] === 'K') || (dr && dc && 'BQ'.includes(p[1])) || ((!dr || !dc) && 'RQ'.includes(p[1])))) return true;
      break;
    }
  }
  return false;
}
function inCheck(state, side) {
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) if (state.board[r][c] === side+'K') return attacked(state,r,c,side === 'w' ? 'b' : 'w');
  return true;
}
function apply(state, m) {
  const s = copy(state), b = s.board, [r,c] = m.from, [tr,tc] = m.to, p = b[r][c], target = b[tr][tc];
  b[tr][tc] = m.promotion ? p[0]+m.promotion : p;
  b[r][c] = null;
  if (m.enPassant) b[r][tc] = null;
  if (m.castle) { const rookFrom = m.castle === 'K' ? 7 : 0, rookTo = m.castle === 'K' ? 5 : 3; b[tr][rookTo] = b[tr][rookFrom]; b[tr][rookFrom] = null; }
  if (p[1] === 'K') s.castle = s.castle.replace(p[0] === 'w' ? /[KQ]/g : /[kq]/g, '');
  for (const [rr,cc,key] of [[7,0,'Q'],[7,7,'K'],[0,0,'q'],[0,7,'k']]) if ((r===rr&&c===cc)||(tr===rr&&tc===cc)) s.castle = s.castle.replace(key,'');
  s.ep = p[1] === 'P' && Math.abs(tr-r) === 2 ? square((tr+r)/2,c) : '-';
  s.halfmove = p[1] === 'P' || target || m.enPassant ? 0 : s.halfmove+1;
  if (p[0] === 'b') s.fullmove++;
  s.turn = p[0] === 'w' ? 'b' : 'w';
  return s;
}
function legalMoves(state) {
  const b = state.board, side = state.turn, out = [];
  function add(r,c,tr,tc, extra={}) {
    if (!inBounds(tr,tc) || b[tr][tc]?.[0] === side || b[tr][tc]?.[1] === 'K') return;
    const promotions = b[r][c][1] === 'P' && (tr === 0 || tr === 7) ? ['Q','R','B','N'] : [null];
    for (const promotion of promotions) {
      const m = {from:[r,c], to:[tr,tc], piece:b[r][c], capture:!!b[tr][tc] || !!extra.enPassant, promotion, ...extra};
      if (!inCheck(apply(state,m),side)) out.push(m);
    }
  }
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const p=b[r][c]; if (!p || p[0] !== side) continue;
    const t=p[1];
    if (t === 'P') {
      const dir=side==='w'?-1:1, start=side==='w'?6:1;
      if (inBounds(r+dir,c) && !b[r+dir][c]) { add(r,c,r+dir,c); if (r===start && !b[r+2*dir][c]) add(r,c,r+2*dir,c); }
      for (const dc of [-1,1]) if (inBounds(r+dir,c+dc)) {
        if (b[r+dir][c+dc]?.[0] && b[r+dir][c+dc][0] !== side) add(r,c,r+dir,c+dc);
        else if (state.ep === square(r+dir,c+dc) && b[r][c+dc] === (side==='w'?'b':'w')+'P') add(r,c,r+dir,c+dc,{enPassant:true});
      }
    } else if (t === 'N') {
      for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(r,c,r+dr,c+dc);
    } else if (t === 'K') {
      for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) add(r,c,r+dr,c+dc);
      const home=side==='w'?7:0, other=side==='w'?'b':'w';
      if (r===home && c===4 && !inCheck(state,side)) {
        const k=side==='w'?'K':'k', q=side==='w'?'Q':'q';
        if (state.castle.includes(k) && b[home][7]===side+'R' && !b[home][5] && !b[home][6] && !attacked(state,home,5,other) && !attacked(state,home,6,other)) add(r,c,home,6,{castle:'K'});
        if (state.castle.includes(q) && b[home][0]===side+'R' && !b[home][1] && !b[home][2] && !b[home][3] && !attacked(state,home,3,other) && !attacked(state,home,2,other)) add(r,c,home,2,{castle:'Q'});
      }
    } else {
      const dirs = t==='B' ? [[-1,-1],[-1,1],[1,-1],[1,1]] : t==='R' ? [[-1,0],[1,0],[0,-1],[0,1]] : [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dr,dc] of dirs) for (let d=1;inBounds(r+dr*d,c+dc*d);d++) {const tr=r+dr*d,tc=c+dc*d; if (b[tr][tc]?.[0]===side) break; add(r,c,tr,tc); if (b[tr][tc]) break;}
    }
  }
  return out;
}
function sanFor(state,m,all=legalMoves(state)) {
  let san;
  if (m.castle) san = m.castle==='K'?'O-O':'O-O-O';
  else {
    const type=m.piece[1], dest=square(...m.to);
    let dis='';
    if (type !== 'P') {
      const others=all.filter(x => x!==m && x.piece[1]===type && x.to[0]===m.to[0] && x.to[1]===m.to[1] && (x.from[0]!==m.from[0]||x.from[1]!==m.from[1]));
      if (others.length) {
        if (!others.some(x=>x.from[1]===m.from[1])) dis=FILES[m.from[1]];
        else if (!others.some(x=>x.from[0]===m.from[0])) dis=String(8-m.from[0]);
        else dis=square(...m.from);
      }
    } else if (m.capture) dis=FILES[m.from[1]];
    san=(type==='P'?'':type)+dis+(m.capture?'x':'')+dest+(m.promotion?'='+m.promotion:'');
  }
  const after=apply(state,m);
  if (inCheck(after,after.turn)) san += legalMoves(after).length ? '+' : '#';
  return san;
}
function normalize(s) { return s.trim().replace(/0/g,'O').replace(/[!?]+/g,'').replace(/[+#]+$/,'').replace(/e\.p\.?$/i,'').replace(/=/g,'').toLowerCase(); }
function tokenize(text) {
  let s=String(text||'').replace(/\[[^\]]*\]/g,' ').replace(/\{[^}]*\}/g,' ').replace(/;[^\n]*/g,' ');
  let last; do { last=s; s=s.replace(/\([^()]*\)/g,' '); } while(s!==last);
  return s.replace(/\$\d+/g,' ').replace(/\d+\.{1,3}/g,' ').trim().split(/\s+/).filter(x => x && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(x));
}
export class ChessGame {
  constructor(text='') { this.reset(); if(text) this.load(text); }
  reset() { this.states=[initial()]; this.moves=[]; this._history=[]; this.index=0; this.error=''; return this; }
  get state() { return this.states[this.index]; }
  get board() { return this.state.board; }
  get turn() { return this.state.turn; }
  get lastMove() { return this.index ? this.history[this.index-1] : null; }
  get history() { return this._history || (this._history=[]); }
  fen() { const s=this.state; return s.board.map(row=>{let n=0,o=''; for(const p of row){if(!p)n++;else {if(n)o+=n; n=0; o+=p[0]==='w'?p[1]:p[1].toLowerCase();}}return o+(n||'');}).join('/')+' '+s.turn+' '+(s.castle||'-')+' '+s.ep+' '+s.halfmove+' '+s.fullmove; }
  legalMoves() { return legalMoves(this.state).map(m=>({from:square(...m.from),to:square(...m.to),san:sanFor(this.state,m),promotion:m.promotion})); }
  move(input, to, promotion='Q') {
    const s=this.state, all=legalMoves(s);
    let m;
    if (to) m=all.find(x=>square(...x.from)===input && square(...x.to)===to && (!x.promotion || x.promotion===promotion.toUpperCase()));
    else {
      const value=normalize(String(input));
      m=all.find(x=>normalize(sanFor(s,x,all))===value);
      if (!m && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(value)) m=all.find(x=>square(...x.from)===value.slice(0,2) && square(...x.to)===value.slice(2,4) && (!x.promotion || x.promotion===((value[4]||'q').toUpperCase())));
    }
    if (!m) { this.error=`Invalid move: ${input}${to ? '–'+to : ''}`; return false; }
    const san=sanFor(s,m,all); this.moves=this.moves.slice(0,this.index); this.states=this.states.slice(0,this.index+1); this._history=this.history.slice(0,this.index);
    this.moves.push(san); this._history.push({from:square(...m.from),to:square(...m.to),san}); this.states.push(apply(s,m)); this.index++; this.error=''; return true;
  }
  load(text) { this.reset(); this._history=[]; for (const move of tokenize(text)) if(!this.move(move)) return false; this.go(0); return true; }
  go(index) { this.index=Math.max(0,Math.min(this.moves.length,Number(index)||0)); return this; }
  next() { return this.go(this.index+1); }
  prev() { return this.go(this.index-1); }
}
