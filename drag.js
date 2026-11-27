/**
 * Attach piece dragging to a board that already handles click-to-move.
 *
 * createBoardDrag({ board, canStart, onMove, isDrawing })
 * `canStart(square)` should return true only for a movable piece.
 * `onMove(from, to)` should validate and apply the move; it may re-render the board.
 * `isDrawing()` tells this handler when annotation mode owns the pointer.
 * `onDragStart(from)` and `onDragEnd()` can show and clear move hints.
 * The board needs CSS `touch-action: none` for reliable dragging on touch screens.
 */
export function createBoardDrag({board, canStart = () => false, onMove = () => {}, isDrawing = () => false, onDragStart = () => {}, onDragEnd = () => {}}) {
  const host = board.parentElement;
  let gesture = null, suppressClick = false, clearClickTimer = null;
  const threshold = 6;
  function squareAt(x, y) {
    const element = document.elementFromPoint(x,y);
    const square = element?.closest('[data-square]');
    return square && board.contains(square) ? square.dataset.square : null;
  }
  function clean() {
    if (!gesture) return;
    gesture.sourcePiece.style.visibility = gesture.oldVisibility;
    gesture.ghost?.remove();
    const wasDragging = gesture.dragging;
    gesture = null;
    if (wasDragging) onDragEnd();
  }
  function onPointerDown(e) {
    if (gesture || isDrawing() || !e.isPrimary || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const square = e.target.closest('[data-square]');
    if (!square || !board.contains(square) || !canStart(square.dataset.square)) return;
    const piece = square.querySelector('.piece');
    if (!piece) return;
    gesture = {id:e.pointerId, from:square.dataset.square, startX:e.clientX, startY:e.clientY,
      piece, sourcePiece:piece, oldVisibility:piece.style.visibility, dragging:false, ghost:null};
  }
  function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    if (!gesture.dragging) {
      if (Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY) < threshold) return;
      if (isDrawing()) { clean(); return; }
      gesture.dragging = true;
      const boardRect = board.getBoundingClientRect(), rect=gesture.piece.getBoundingClientRect();
      const ghost = gesture.piece.cloneNode(true);
      ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style, {position:'absolute',left:`${rect.left-boardRect.left}px`,top:`${rect.top-boardRect.top}px`,
        width:`${rect.width}px`,height:`${rect.height}px`,zIndex:'6',pointerEvents:'none',willChange:'transform',visibility:'visible'});
      host.appendChild(ghost);gesture.ghost=ghost;gesture.sourcePiece.style.visibility='hidden';
      onDragStart(gesture.from);
      try { board.setPointerCapture(e.pointerId); } catch (_) { /* Optional on older browsers. */ }
    }
    e.preventDefault();
    gesture.ghost.style.transform=`translate(${e.clientX-gesture.startX}px, ${e.clientY-gesture.startY}px)`;
  }
  function onPointerUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    if (!gesture.dragging) { clean(); return; }
    const from=gesture.from, to=squareAt(e.clientX,e.clientY);
    e.preventDefault(); e.stopPropagation();
    // The native click is dispatched after pointerup. Swallow it so it cannot
    // select a square again after the drag has already moved a piece.
    suppressClick=true;
    clearTimeout(clearClickTimer);
    clearClickTimer=setTimeout(()=>{suppressClick=false},0);
    clean();
    if (to && to !== from && !isDrawing()) onMove(from,to);
  }
  function onPointerCancel(e) { if (gesture && e.pointerId===gesture.id) clean(); }
  function onClick(e) { if (suppressClick) { suppressClick=false; e.preventDefault(); e.stopImmediatePropagation(); } }
  board.addEventListener('pointerdown',onPointerDown);
  window.addEventListener('pointermove',onPointerMove);
  window.addEventListener('pointerup',onPointerUp);
  window.addEventListener('pointercancel',onPointerCancel);
  board.addEventListener('click',onClick,true);
  return { cancel:clean, destroy(){clean();clearTimeout(clearClickTimer);board.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('pointermove',onPointerMove);window.removeEventListener('pointerup',onPointerUp);window.removeEventListener('pointercancel',onPointerCancel);board.removeEventListener('click',onClick,true)} };
}
