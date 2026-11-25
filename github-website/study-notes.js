import { folderPath } from './library.js';
import { ChessGame } from './chess.js';

const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labelForPly = (moves, index) => index ? `${Math.ceil(index / 2)}${index % 2 ? '.' : '...'} ${moves[index-1]}` : 'Starting position';
const samePrefix = (prefix, moves) => Array.isArray(prefix) && prefix.length <= moves.length && prefix.every((move, i) => move === moves[i]);
const getWarnings = folder => Array.isArray(folder.blunders) ? folder.blunders : [];
const makeId = () => globalThis.crypto?.randomUUID?.() || `warning-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Read-first notes that follow the opening path and selected game. */
export function createStudyNotes({container, onChange = () => {}, onJump = () => {}, getSaveStatus = () => null}) {
  if (!container) throw new Error('A study notes container is required.');
  let storedVisibility={};try { storedVisibility=JSON.parse(localStorage.getItem('opening-notebook-note-visibility-v1'))||{}; } catch {}
  const visible = new Map(Object.entries(storedVisibility));
  const editing = new Set();
  let context = {folders:[], folder:null, game:null, moves:[], index:0};
  let path = [];

  function editable({key, value, label, placeholder, attributes, warning=false}) {
    const safeValue=escapeText(value || ''), open=editing.has(key);
    return `<div class="study-note-section ${warning?'is-warning':''}"><div class="study-note-label-row"><span class="study-field-label">${escapeText(label)}</span><button type="button" class="study-edit" data-edit-key="${escapeText(key)}">${open?'Done':value?'Edit':'Add note'}</button></div>${open?`<textarea class="study-editor ${warning?'study-warning-input':''}" data-editor-key="${escapeText(key)}" ${attributes} aria-label="${escapeText(label)}" placeholder="${escapeText(placeholder)}">${safeValue}</textarea>`:`<div class="study-note-text ${value?'':'is-empty'}">${value?safeValue:'No note yet.'}</div>`}</div>`;
  }
  function warningRows(folder) {
    const warnings=getWarnings(folder);
    if (!warnings.length) return '<p class="study-empty">No blunders marked for this line.</p>';
    return warnings.map((item,i) => {
      const w=item && typeof item==='object'?item:{};
      const recordedMoves=Array.isArray(w.moves)?w.moves:[];
      const jumpable=recordedMoves.length>0 && samePrefix(recordedMoves,context.moves);
      const moveLabel=w.moveLabel || (recordedMoves.length?labelForPly(recordedMoves,recordedMoves.length):'Position');
      const key=`warning:${folder.id}:${w.id||i}`;
      const field=editable({key,value:w.text,label:'Why is this a mistake?',placeholder:'Explain what went wrong and what to play instead…',attributes:`data-warning-text="${i}" data-folder="${escapeText(folder.id)}"`,warning:true});
      return `<article class="study-blunder" data-warning-row="${i}"><div class="study-blunder-heading"><span class="study-blunder-badge">?? &nbsp; BLUNDER</span><span class="study-blunder-move">${escapeText(moveLabel)}</span></div>${field}<div class="study-warning-actions"><button type="button" class="study-link" data-jump="${escapeText(folder.id)}" data-warning-index="${i}" ${jumpable?'':'disabled'}>${jumpable?'Show move':'Not in this line'}</button><button type="button" class="study-link study-remove" data-remove-warning="${escapeText(folder.id)}" data-warning-index="${i}">Remove</button></div></article>`;
    }).join('');
  }
  function folderCard(folder,i) {
    const field=editable({key:`idea:${folder.id}`,value:folder.note??[folder.idea,folder.plan].filter(Boolean).join('\n\n'),label:'Ideas and plans',placeholder:'Write the key ideas and plans for this line…',attributes:`data-idea="${escapeText(folder.id)}"`});
    return `<article class="study-opening-card"><div class="study-card-heading"><div><span class="study-level">${i===0?'OPENING':`BRANCH ${i}`}</span><h3>${escapeText(folder.name)}</h3></div><span class="study-card-current">${folder.id===context.folder?.id?'CURRENT':'PARENT'}</span></div>${field}<div class="study-blunders-header"><h4>Blunders &amp; traps</h4><button type="button" class="study-add-warning" data-add-warning="${escapeText(folder.id)}">＋ Mark this position</button></div>${warningRows(folder)}</article>`;
  }
  function gameCard() {
    const game=context.game;if(!game)return '';
    const line=context.moves.slice(0,context.index),key=line.join(' '),original=new ChessGame(game.pgn||'').moves;
    const legacy=samePrefix(line,original)?game.notes?.[context.index]:undefined;
    const positionNote=game.notes?.[key]??legacy??'',summary=game.gameNote??game.takeaway??'';
    const gameField=editable({key:`game:${game.id}:summary`,value:summary,label:'Game reflection',placeholder:'What did you learn from this game?',attributes:'data-game-summary'});
    const positionField=editable({key:`game:${game.id}:position:${key}`,value:positionNote,label:`Note at ${labelForPly(context.moves,context.index)}`,placeholder:'Write what you noticed at this position…',attributes:'data-position-note'});
    return `<article class="study-game-card"><div class="study-card-heading"><div><span class="study-level">GAME</span><h3>${escapeText(game.name)}</h3></div><span class="study-card-current">${escapeText(labelForPly(context.moves,context.index))}</span></div>${gameField}${positionField}</article>`;
  }
  function draw() {
    path=context.folder?folderPath(context.folders,context.folder.id):[];
    for(const folder of path)if(!visible.has(folder.id))visible.set(folder.id,true);
    const toggles=path.map(folder=>`<button type="button" class="study-path-toggle ${visible.get(folder.id)?'is-on':''}" aria-pressed="${visible.get(folder.id)?'true':'false'}" data-toggle-opening="${escapeText(folder.id)}">${escapeText(folder.name)}</button>`).join('');
    const cards=path.filter(folder=>visible.get(folder.id)).map(folder=>folderCard(folder,path.indexOf(folder))).join('');
    container.innerHTML=`<div class="study-notes-bar"><span>${context.game?'GAME ANALYSIS':'OPENING THEORY'}</span><span class="study-autosave">${getSaveStatus()?'Changes not saved':'Saved as you type'}</span></div>${context.game?`<div class="study-game-section">${gameCard()}</div>`:path.length?`<div class="study-path-area"><span class="study-field-label">Opening path</span><div class="study-path-toggles">${toggles}</div></div><div class="study-cards">${cards||'<p class="study-empty">Choose a line above to show its notes.</p>'}</div>`:'<p class="study-empty study-no-opening">Choose an opening to add notes.</p>'}`;
  }
  function change(event) {
    const el=event.target;if(!(el instanceof HTMLTextAreaElement))return;
    if(el.hasAttribute('data-idea')){const folder=context.folders.find(f=>f.id===el.dataset.idea);if(!folder)return;folder.note=el.value;onChange();}
    else if(el.hasAttribute('data-warning-text')){const folder=context.folders.find(f=>f.id===el.dataset.folder);const item=folder && getWarnings(folder)[Number(el.dataset.warningText)];if(!item||typeof item!=='object')return;item.text=el.value;onChange();}
    else if(el.hasAttribute('data-game-summary')&&context.game){context.game.gameNote=el.value;onChange();}
    else if(el.hasAttribute('data-position-note')&&context.game){context.game.notes ||= {};context.game.notes[context.moves.slice(0,context.index).join(' ')]=el.value;onChange();}
  }
  function focusEditor(key) {
    for(const el of container.querySelectorAll('[data-editor-key]'))if(el.dataset.editorKey===key){el.focus();break;}
  }
  function click(event) {
    const button=event.target.closest('button');if(!button||!container.contains(button))return;
    if(button.dataset.toggleOpening){const id=button.dataset.toggleOpening;visible.set(id,!visible.get(id));try{localStorage.setItem('opening-notebook-note-visibility-v1',JSON.stringify(Object.fromEntries(visible)))}catch{}draw();return;}
    if(button.dataset.editKey){const key=button.dataset.editKey,wasOpen=editing.has(key);if(wasOpen)editing.delete(key);else editing.add(key);draw();if(!wasOpen)focusEditor(key);return;}
    if(button.dataset.addWarning){const folder=context.folders.find(f=>f.id===button.dataset.addWarning);if(!folder)return;if(!Array.isArray(folder.blunders))folder.blunders=[];const line=context.moves.slice(0,context.index),id=makeId();folder.blunders.push({id,moveLabel:labelForPly(context.moves,context.index),moves:line,text:''});const key=`warning:${folder.id}:${id}`;editing.add(key);onChange();draw();focusEditor(key);return;}
    if(button.dataset.removeWarning){const folder=context.folders.find(f=>f.id===button.dataset.removeWarning),index=Number(button.dataset.warningIndex);if(!folder||!getWarnings(folder)[index])return;const row=button.closest('[data-warning-row]');if(button.dataset.confirm!=='yes'){button.dataset.confirm='yes';button.textContent='Confirm removal';row?.classList.add('confirming');return;}const w=folder.blunders[index];editing.delete(`warning:${folder.id}:${w.id||index}`);folder.blunders.splice(index,1);onChange();draw();return;}
    if(button.dataset.jump){const folder=context.folders.find(f=>f.id===button.dataset.jump),item=folder&&getWarnings(folder)[Number(button.dataset.warningIndex)];if(item&&Array.isArray(item.moves)&&samePrefix(item.moves,context.moves))onJump(item.moves.length);}
  }
  container.addEventListener('input',change);container.addEventListener('click',click);
  return {render(next){const current=globalThis.document?.activeElement;const same=next.folder?.id===context.folder?.id&&next.game?.id===context.game?.id&&Number(next.index||0)===context.index&&JSON.stringify(next.moves||[])===JSON.stringify(context.moves);context={folders:next.folders||[],folder:next.folder||null,game:next.game||null,moves:Array.isArray(next.moves)?next.moves:[],index:Number(next.index)||0};if(same&&current&&container.contains(current)&&current instanceof HTMLTextAreaElement)return;draw()},destroy(){container.removeEventListener('input',change);container.removeEventListener('click',click);container.innerHTML='';}};
}
