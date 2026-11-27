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
const isKnownColor = color => typeof color === 'string' && Object.hasOwn(ANNOTATION_COLORS,color);
const eventColor = event => {
  const red = !!(event.shiftKey || event.ctrlKey), blue = !!(event.altKey || event.metaKey || event.getModifierState?.('AltGraph'));
  return red ? (blue ? 'yellow' : 'red') : (blue ? 'blue' : 'green');
};

/**
 * Attach study markings to a board.
 *
 * createBoardAnnotations({ board, getFlipped, getKey, read, write, onModeChange })
 * - board: square grid element whose buttons have data-square="e4".
 * - getFlipped: returns whether black is at the bottom.
 * - getKey: returns the identity of the currently displayed position.
 * - read(key): returns { squares: { e4: 'green' }, arrows: [{from,to,color}] } or null.
 * - write(key, markings): persists a copy of those markings.
 * - onError(message): reports an unreadable or unsupported marking without overwriting it.
 * Call refresh() after changing position or recreating squares, setMode(true) to
 * enable tap/drag drawing on touch screens, clear() to clear the current key.
 */
export function createBoardAnnotations({ board, getFlipped = () => false, getKey = () => '', read = () => null, write = () => {}, onModeChange = () => {}, onError = () => {} }) {
  const host = board.parentElement;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '5', overflow: 'hidden' });
  host.appendChild(svg);
  const prefix = `study-mark-${++annotationInstance}`;
  let mode = false, gesture = null, pending = null, currentKey = null, suppressClick = false, suppressTimer = null;
  function releaseGesture(active) {
    if (!active) return;
    try { board.releasePointerCapture(active.pointerId); } catch (_) { /* Pointer capture may be unavailable. */ }
  }
  function suppressGestureClick(active) {
    if (!active?.suppressClick) return;
    suppressClick = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => { suppressClick = false; suppressTimer = null; }, 0);
  }

  function normalize(value) {
    const squares = {}, arrows = [];
    if (value && typeof value === 'object') {
      for (const [square, color] of Object.entries(value.squares || {})) if (VALID_SQUARE.test(square) && isKnownColor(color)) squares[square] = color;
      if (Array.isArray(value.arrows)) for (const item of value.arrows) {
        if (item && VALID_SQUARE.test(item.from) && VALID_SQUARE.test(item.to) && item.from !== item.to && isKnownColor(item.color)) arrows.push({from: item.from, to: item.to, color: item.color});
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
    if (currentKey !== key) {
      pending = null;
      if (gesture && gesture.key !== key) { const active = gesture; gesture = null; releaseGesture(active); suppressGestureClick(active); }
      currentKey = key;
    }
    const markings = normalize(read(key));
    let out = `<defs>${Object.entries(ANNOTATION_COLORS).map(([name,color])=>`<marker id="${prefix}-${name}" markerWidth="0.4" markerHeight="0.4" refX="0.3" refY="0.2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0.4,0.2 L0,0.4 Z" fill="${color}" fill-opacity=".75" /></marker>`).join('')}</defs>`;
    const circle = (square, color, opacity = .75) => {
      const [x,y] = point(square);
      return `<circle cx="${x}" cy="${y}" r=".42" fill="none" stroke="${ANNOTATION_COLORS[color]}" stroke-opacity="${opacity}" stroke-width=".09" />`;
    };
    const arrow = (from, to, color, opacity = .75) => {
      const [x1,y1] = point(from), [x2,y2] = point(to);
      const length = Math.hypot(x2-x1,y2-y1);
      const endX = x2-(x2-x1)/length*.2, endY = y2-(y2-y1)/length*.2;
      return `<line x1="${x1}" y1="${y1}" x2="${endX}" y2="${endY}" stroke="${ANNOTATION_COLORS[color]}" stroke-opacity="${opacity}" stroke-width=".14" stroke-linecap="round" marker-end="url(#${prefix}-${color})" />`;
    };
    for (const [square,color] of Object.entries(markings.squares)) out += circle(square,color);
    for (const {from,to,color} of markings.arrows) out += arrow(from,to,color);
    if (pending) out += circle(pending.square,pending.color,.55);
    if (gesture && gesture.key === key && gesture.to) {
      out += gesture.from === gesture.to ? circle(gesture.from,gesture.color,.55) : arrow(gesture.from,gesture.to,gesture.color,.55);
    }
    svg.innerHTML = out;
  }
  // Edit the stored record itself, rather than the display-only normalized view.
  // Fields and entries from newer versions must survive unrelated edits.
  function editableRecord(value) {
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      onError('This position’s markings could not be read. The original data was preserved.');
      return null;
    }
    return {...value};
  }
  function readableArrow(item) {
    return !!item && typeof item === 'object' && VALID_SQUARE.test(item.from) && VALID_SQUARE.test(item.to) && item.from !== item.to && isKnownColor(item.color);
  }
  function toggle(from,to,color) {
    const key = String(getKey() ?? ''), data = editableRecord(read(key));
    if (!data) return;
    if (from === to) {
      if (data.squares != null && (typeof data.squares !== 'object' || Array.isArray(data.squares))) {
        onError('This position’s square markings could not be read. The original data was preserved.');
        return;
      }
      const squares = {...(data.squares || {})};
      if (Object.hasOwn(squares,from) && !isKnownColor(squares[from])) {
        onError('This square has an unsupported marking. The original data was preserved.');
        return;
      }
      if (squares[from] === color) delete squares[from]; else squares[from] = color;
      data.squares = squares;
    } else {
      if (data.arrows != null && !Array.isArray(data.arrows)) {
        onError('This position’s arrows could not be read. The original data was preserved.');
        return;
      }
      const arrows = (data.arrows || []).slice();
      const i = arrows.findIndex(a => readableArrow(a) && a.from === from && a.to === to);
      if (i >= 0) {
        if (arrows[i].color === color) arrows.splice(i,1);
        else arrows[i] = {...arrows[i], color};
      } else arrows.push({from,to,color});
      data.arrows = arrows;
    }
    write(key,data);
    render();
  }
  function clearVisible() {
    const key = String(getKey() ?? ''), data = editableRecord(read(key));
    if (!data) return;
    if (data.squares != null && (typeof data.squares !== 'object' || Array.isArray(data.squares)) || data.arrows != null && !Array.isArray(data.arrows)) {
      onError('This position’s markings could not be read. The original data was preserved.');
      return;
    }
    if (data.squares != null) {
      const squares = {...data.squares};
      for (const [square,color] of Object.entries(squares)) if (VALID_SQUARE.test(square) && isKnownColor(color)) delete squares[square];
      data.squares = squares;
    }
    if (data.arrows != null) data.arrows = data.arrows.filter(item => !readableArrow(item));
    write(key,data);
    render();
  }
  function squareAt(x,y) {
    const element = document.elementFromPoint(x,y), square = element && element.closest('[data-square]');
    return square && board.contains(square) && VALID_SQUARE.test(square.dataset.square) ? square.dataset.square : null;
  }
  function pointerDown(event) {
    const right = event.pointerType !== 'touch' && (event.button === 2 || (event.button === 0 && event.ctrlKey));
    if (!right && !mode) return;
    const square = squareAt(event.clientX,event.clientY);
    if (!square) return;
    event.preventDefault(); event.stopPropagation();
    gesture = { pointerId: event.pointerId, from: square, to: square, right, suppressClick: right && event.button === 0, color: eventColor(event), key: String(getKey() ?? '') };
    render();
    try { board.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture is optional. */ }
  }
  function pointerMove(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const end = squareAt(event.clientX,event.clientY);
    if (gesture.to !== end) { gesture.to = end; render(); }
  }
  function pointerUp(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const active = gesture; gesture = null;
    releaseGesture(active); suppressGestureClick(active);
    event.preventDefault(); event.stopPropagation();
    const end = squareAt(event.clientX,event.clientY);
    if (!end || active.key !== String(getKey() ?? '')) { pending = null; render(); return; }
    if (active.right || active.from !== end) { pending = null; toggle(active.from,end,active.color); return; }
    // In drawing mode two taps choose the endpoints; tapping the same square twice colors it.
    if (!pending) { pending = {square:end,color:active.color}; render(); }
    else { const start = pending; pending = null; toggle(start.square,end,start.color); }
  }
  function pointerCancel(event) { if (gesture && (event.pointerId == null || gesture.pointerId === event.pointerId)) { const active = gesture; gesture = null; releaseGesture(active); suppressGestureClick(active); render(); } }
  function contextMenu(event) { event.preventDefault(); }
  function swallowClick(event) { if (mode || suppressClick) { suppressClick = false; clearTimeout(suppressTimer); suppressTimer = null; event.preventDefault(); event.stopImmediatePropagation(); } }
  board.addEventListener('pointerdown',pointerDown,true);
  board.addEventListener('pointermove',pointerMove,true);
  board.addEventListener('pointerup',pointerUp,true);
  board.addEventListener('pointercancel',pointerCancel,true);
  board.addEventListener('contextmenu',contextMenu);
  board.addEventListener('click',swallowClick,true);
  render();
  return {
    refresh: render,
    setMode(value) { mode = !!value; pending = null; const active = gesture; gesture = null; releaseGesture(active); suppressGestureClick(active); board.style.touchAction = mode ? 'none' : ''; board.classList.toggle('drawing-mode',mode); render(); onModeChange(mode); },
    getMode() { return mode; },
    clear() { pending=null; clearVisible(); },
    destroy() { releaseGesture(gesture); gesture = null; clearTimeout(suppressTimer); board.removeEventListener('pointerdown',pointerDown,true); board.removeEventListener('pointermove',pointerMove,true); board.removeEventListener('pointerup',pointerUp,true); board.removeEventListener('pointercancel',pointerCancel,true); board.removeEventListener('contextmenu',contextMenu); board.removeEventListener('click',swallowClick,true); board.style.touchAction=''; board.classList.remove('drawing-mode'); svg.remove(); }
  };
}
