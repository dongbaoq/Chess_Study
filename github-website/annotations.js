// Board markings are keyed by position by the caller. The overlay lives beside,
// rather than inside, the squares, so replacing board.innerHTML is safe.
let annotationInstance = 0;
const ANNOTATION_COLORS = {
  green: '#157f3b',
  red: '#cf3333',
  blue: '#2867bc',
  yellow: '#d5a51e'
};
const VALID_SQUARE = /^[a-h][1-8]$/;
const eventColor = event => event.shiftKey ? 'red' : event.altKey ? 'blue' : (event.ctrlKey || event.metaKey) ? 'yellow' : 'green';

/**
 * Attach study markings to a board.
 *
 * createBoardAnnotations({ board, getFlipped, getKey, read, write, onModeChange })
 * - board: square grid element whose buttons have data-square="e4".
 * - getFlipped: returns whether black is at the bottom.
 * - getKey: returns the identity of the currently displayed position.
 * - read(key): returns { squares: { e4: 'green' }, arrows: [{from,to,color}] } or null.
 * - write(key, markings): persists a copy of those markings.
 * Call refresh() after changing position or recreating squares, setMode(true) to
 * enable tap/drag drawing on touch screens, clear() to clear the current key.
 */
export function createBoardAnnotations({ board, getFlipped = () => false, getKey = () => '', read = () => null, write = () => {}, onModeChange = () => {} }) {
  const host = board.parentElement;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '5', overflow: 'hidden' });
  host.appendChild(svg);
  const prefix = `study-mark-${++annotationInstance}`;
  let mode = false, gesture = null, pending = null, currentKey = null;

  function normalize(value) {
    const squares = {}, arrows = [];
    if (value && typeof value === 'object') {
      for (const [square, color] of Object.entries(value.squares || {})) if (VALID_SQUARE.test(square) && ANNOTATION_COLORS[color]) squares[square] = color;
      if (Array.isArray(value.arrows)) for (const item of value.arrows) {
        if (item && VALID_SQUARE.test(item.from) && VALID_SQUARE.test(item.to) && item.from !== item.to && ANNOTATION_COLORS[item.color]) arrows.push({from: item.from, to: item.to, color: item.color});
      }
    }
    return { squares, arrows };
  }
  function point(square) {
    const col = square.charCodeAt(0)-97, row = 8-Number(square[1]);
    return getFlipped() ? [7-col+0.5, 7-row+0.5] : [col+0.5, row+0.5];
  }
  function render() {
    const key = String(getKey() ?? '');
    if (currentKey !== key) { pending = null; currentKey = key; }
    const markings = normalize(read(key));
    let out = `<defs>${Object.entries(ANNOTATION_COLORS).map(([name,color])=>`<marker id="${prefix}-${name}" markerWidth="0.38" markerHeight="0.38" refX="0.28" refY="0.19" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0.38,0.19 L0,0.38 Z" fill="${color}" /></marker>`).join('')}</defs>`;
    for (const [square,color] of Object.entries(markings.squares)) {
      const [x,y] = point(square);
      out += `<rect x="${x-.5}" y="${y-.5}" width="1" height="1" fill="${ANNOTATION_COLORS[color]}" fill-opacity="0.46" />`;
    }
    for (const {from,to,color} of markings.arrows) {
      const [x1,y1] = point(from), [x2,y2] = point(to);
      const length = Math.hypot(x2-x1,y2-y1);
      const endX = x2-(x2-x1)/length*.19, endY = y2-(y2-y1)/length*.19;
      out += `<line x1="${x1}" y1="${y1}" x2="${endX}" y2="${endY}" stroke="${ANNOTATION_COLORS[color]}" stroke-opacity=".88" stroke-width=".15" stroke-linecap="round" marker-end="url(#${prefix}-${color})" />`;
    }
    if (pending) { const [x,y] = point(pending.square); out += `<rect x="${x-.46}" y="${y-.46}" width=".92" height=".92" fill="none" stroke="${ANNOTATION_COLORS[pending.color]}" stroke-width=".08" />`; }
    svg.innerHTML = out;
  }
  function toggle(from,to,color) {
    const key = String(getKey() ?? ''), data = normalize(read(key));
    if (from === to) {
      if (data.squares[from] === color) delete data.squares[from]; else data.squares[from] = color;
    } else {
      const i = data.arrows.findIndex(a => a.from === from && a.to === to);
      if (i >= 0) { const old = data.arrows.splice(i,1)[0]; if (old.color !== color) data.arrows.push({from,to,color}); }
      else data.arrows.push({from,to,color});
    }
    write(key,data);
    render();
  }
  function squareAt(x,y) {
    const element = document.elementFromPoint(x,y), square = element && element.closest('[data-square]');
    return square && board.contains(square) && VALID_SQUARE.test(square.dataset.square) ? square.dataset.square : null;
  }
  function pointerDown(event) {
    const right = event.button === 2 && event.pointerType !== 'touch';
    if (!right && !mode) return;
    const square = squareAt(event.clientX,event.clientY);
    if (!square) return;
    event.preventDefault(); event.stopPropagation();
    gesture = { pointerId: event.pointerId, from: square, right, color: eventColor(event), key: String(getKey() ?? '') };
    try { board.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture is optional. */ }
  }
  function pointerUp(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const active = gesture; gesture = null;
    event.preventDefault(); event.stopPropagation();
    const end = squareAt(event.clientX,event.clientY);
    if (!end || active.key !== String(getKey() ?? '')) { pending = null; render(); return; }
    if (active.right || active.from !== end) { pending = null; toggle(active.from,end,active.color); return; }
    // In drawing mode two taps choose the endpoints; tapping the same square twice colors it.
    if (!pending) { pending = {square:end,color:active.color}; render(); }
    else { const start = pending; pending = null; toggle(start.square,end,start.color); }
  }
  function pointerCancel() { gesture = null; }
  function contextMenu(event) { event.preventDefault(); }
  function swallowClick(event) { if (mode) { event.preventDefault(); event.stopImmediatePropagation(); } }
  board.addEventListener('pointerdown',pointerDown,true);
  board.addEventListener('pointerup',pointerUp,true);
  board.addEventListener('pointercancel',pointerCancel,true);
  board.addEventListener('contextmenu',contextMenu);
  board.addEventListener('click',swallowClick,true);
  render();
  return {
    refresh: render,
    setMode(value) { mode = !!value; pending = null; board.style.touchAction = mode ? 'none' : ''; board.classList.toggle('drawing-mode',mode); render(); onModeChange(mode); },
    getMode() { return mode; },
    clear() { const key=String(getKey() ?? ''); pending=null; write(key,{squares:{},arrows:[]}); render(); },
    destroy() { board.removeEventListener('pointerdown',pointerDown,true); board.removeEventListener('pointerup',pointerUp,true); board.removeEventListener('pointercancel',pointerCancel,true); board.removeEventListener('contextmenu',contextMenu); board.removeEventListener('click',swallowClick,true); board.style.touchAction=''; board.classList.remove('drawing-mode'); svg.remove(); }
  };
}
