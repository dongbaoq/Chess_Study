const escapeMoveTreeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/**
 * Render the saved opening tree and active game below the board.
 * createMoveTreeView({container, onNavigate})
 * render(root) accepts the output of buildMoveTree. Clicking a move calls
 * onNavigate({moves, folders, ply, san}), leaving navigation to the app.
 */
export function createMoveTreeView({container, onNavigate = () => {}, onDeleteAnalysis = () => {}}) {
  if (!container) throw new Error('A move tree container is required.');
  let root = null, navigable = new Map();
  const collapsed = new Set();
  const keyOf = node => (node.moves || []).join(' ');
  const sortChildren = children => (children || []).slice().sort((a,b) => (root?.gameMode ? Number(!!b.onGameLine)-Number(!!a.onGameLine) : 0) || Number(!!b.isCurrent)-Number(!!a.isCurrent) || Number(!!b.onLine)-Number(!!a.onLine));

  function moveMarkup(node, first, lookupId) {
    const ply=Number(node.ply)||0;
    const number=ply%2===1 ? `${Math.ceil(ply/2)}.` : first ? `${Math.ceil(ply/2)}...` : '';
    const warnings=Array.isArray(node.blunders) ? node.blunders : [];
    const explanation=warnings.map(w => [w.folderName,w.text].filter(Boolean).join(': ')).filter(Boolean).join(' | ');
    const label=`${number ? number+' ' : ''}${node.san || ''}${warnings.length ? ', marked blunder' : ''}${explanation ? ': '+explanation : ''}`;
    navigable.set(lookupId,node);
    const tag=(node.folders || []).map(folder => `<span class="move-tree-folder" title="Saved opening">${escapeMoveTreeText(folder.name)}</span>`).join('');
    return `<span class="move-tree-token">${number?`<span class="move-tree-number">${number}</span>`:''}<button type="button" class="move-tree-move ${node.isCurrent?'is-current':''} ${node.onGameLine?'is-game':''} ${node.isAnalysis?'is-analysis':''}" data-tree-node="${lookupId}" aria-label="${escapeMoveTreeText(label)}" ${node.isCurrent?'aria-current="step"':''} title="${escapeMoveTreeText(explanation || (node.isAnalysis ? 'Show this position. Right-click to delete analysis moves.' : 'Show this position'))}">${escapeMoveTreeText(node.san || '')}${warnings.length?'<span class="move-tree-blunder" aria-hidden="true">??</span>':''}</button>${tag}</span>`;
  }

  function draw() {
    const previousPosition = [...navigable.values()].find(node=>node.isCurrent);
    const previousKey = previousPosition ? keyOf(previousPosition) : null;
    const scrollPositions = new Map();
    for (const area of container.querySelectorAll('[data-move-scroll]')) scrollPositions.set(area.dataset.moveScroll, area.scrollTop);
    function restoreScroll() {
      for (const area of container.querySelectorAll('[data-move-scroll]')) if (scrollPositions.has(area.dataset.moveScroll)) area.scrollTop=scrollPositions.get(area.dataset.moveScroll);
      const current=[...navigable.values()].find(node=>node.isCurrent);
      if (previousKey===null || !current || previousKey===keyOf(current)) return;
      const button=container.querySelector('[aria-current="step"]'), area=button?.closest('[data-move-scroll]');
      if (!area) return;
      const bounds=area.getBoundingClientRect(), target=button.getBoundingClientRect();
      if (target.top<bounds.top) area.scrollTop+=target.top-bounds.top;
      else if (target.bottom>bounds.bottom) area.scrollTop+=target.bottom-bounds.bottom;
    }
    closeMenu();
    navigable=new Map();let counter=0;
    if (!root) {
      container.innerHTML='<div class="move-tree-heading"><div><span class="move-tree-overline">OPENING EXPLORER</span><h2>Moves &amp; continuations</h2></div></div><p class="move-tree-empty">Your moves and saved variations will appear here as you build your repertoire.</p>';
      return;
    }
    navigable.set('0',root);
    const rootWarnings=Array.isArray(root.blunders)?root.blunders:[];
    const rootDescription=rootWarnings.map(w=>[w.folderName,w.text].filter(Boolean).join(': ')).filter(Boolean).join(' | ');
    const startLabel=`Starting position${rootWarnings.length?', marked blunder':''}${rootDescription?': '+rootDescription:''}`;
    const start=`<div class="move-tree-start-row"><button type="button" class="move-tree-move move-tree-start ${root.isCurrent?'is-current':''}" data-tree-node="0" aria-label="${escapeMoveTreeText(startLabel)}" ${root.isCurrent?'aria-current="step"':''} title="${escapeMoveTreeText(rootDescription || 'Show the starting position')}">Start${rootWarnings.length?'<span class="move-tree-blunder" aria-hidden="true">??</span>':''}</button></div>`;
    if (root.gameMode) {
      // Keep the actual game in one uninterrupted sequence. Each analysis branch
      // names its parent position, including branches nested inside analysis.
      const recorded=[]; let node=root;
      while (node) { const next=(node.children || []).find(child=>child.onGameLine); if(!next)break; recorded.push(next); node=next; }
      const gameRows=recorded.map((item,i)=>moveMarkup(item,i===0,String(++counter))).join('');
      const analysisRows=[];
      const describePath=moves=>moves.length ? moves.map((san,i)=>(i%2===0?`${Math.floor(i/2)+1}. `:'')+san).join(' ') : 'starting position';
      function appendVariation(start) {
        const path=[];let current=start;
        while(current) { path.push(current); const children=current.children || []; if(children.length!==1)break; current=children[0]; }
        const parentMoves=(start.moves || []).slice(0,-1);
        const row=path.map((item,i)=>moveMarkup(item,i===0,String(++counter))).join('');
        analysisRows.push(`<div class="move-tree-line is-variation"><div class="move-tree-sequence"><span class="move-tree-number" style="white-space:normal;overflow-wrap:anywhere">After ${escapeMoveTreeText(describePath(parentMoves))}:</span>${row}</div></div>`);
        for(const child of sortChildren(path.at(-1)?.children || [])) appendVariation(child);
      }
      for(const parent of [root,...recorded]) for(const child of sortChildren(parent.children || [])) if(!child.onGameLine) appendVariation(child);
      container.innerHTML=`<div class="move-tree-heading"><div><span class="move-tree-overline">GAME ANALYSIS</span><h2>Game and analysis moves</h2><p>Choose an analysis move to follow it. Right-click an analysis move to delete it and its continuations.</p></div></div><div class="move-tree-content" style="max-height:none;overflow:visible"><div class="move-tree-overline">PLAYED GAME</div><div data-move-scroll="game" style="max-height:130px;overflow:auto" aria-label="Moves played in this game">${start}<div class="move-tree-sequence">${gameRows || '<span class="move-tree-empty">No moves recorded in this game.</span>'}</div></div><div class="move-tree-overline" style="margin-top:12px">ANALYSIS VARIATIONS</div><div data-move-scroll="analysis" style="max-height:200px;overflow:auto" aria-label="Saved analysis variations">${analysisRows.join('') || '<p class="move-tree-empty">Play an alternative move to add a variation.</p>'}</div></div>`;
      restoreScroll();return;
    }
    const rows=[];
    function appendLine(start, depth, isBranch, pauseAfterFirst = false) {
      const path=[];let node=start;
      while(node) {
        path.push(node);
        const children=sortChildren(node.children);
        if(pauseAfterFirst || children.length!==1)break;
        node=children[0];
      }
      const key=keyOf(start), isCollapsed=isBranch && collapsed.has(key), shown=isCollapsed?path.slice(0,1):path;
      const canCollapse=!pauseAfterFirst && isBranch && (path.length>1 || (path.at(-1)?.children||[]).length>0);
      const toggle=canCollapse?`<button type="button" class="move-tree-disclosure" aria-expanded="${!isCollapsed}" data-tree-toggle="${escapeMoveTreeText(key)}" aria-label="${isCollapsed?'Expand':'Collapse'} variation starting ${escapeMoveTreeText(start.san)}">${isCollapsed?'▸':'▾'}</button>`:(isBranch?'<span class="move-tree-branch-mark" aria-hidden="true">↳</span>':'');
      const rowMarkup=shown.map((item,i)=>moveMarkup(item,i===0,String(++counter))).join('');
      rows.push(`<div class="move-tree-line ${isBranch?'is-variation':''}" style="--branch-depth:${Math.min(depth,3)}">${toggle}<div class="move-tree-sequence">${rowMarkup}</div></div>`);
      if(isCollapsed || pauseAfterFirst)return;
      appendChildren(path.at(-1),depth+1);
    }
    function appendChildren(parent, depth, isRoot = false) {
      const children=sortChildren(parent?.children || []);
      if(root.gameMode && children.length>1 && children[0].onGameLine) {
        // Show the played move first, then its alternatives before the rest of a long game.
        appendLine(children[0],isRoot?0:depth,!isRoot,true);
        for(const child of children.slice(1)) appendLine(child,isRoot?1:depth,true);
        appendChildren(children[0],isRoot?0:depth);
      } else {
        children.forEach((child,index)=>appendLine(child,isRoot?(index?1:0):depth,isRoot?!!index:true));
      }
    }
    appendChildren(root,0,true);
    const gameMode=!!root.gameMode;
    container.innerHTML=`<div class="move-tree-heading"><div><span class="move-tree-overline">${gameMode?'GAME ANALYSIS':'OPENING EXPLORER'}</span><h2>${gameMode?'Moves you played':'Moves &amp; continuations'}</h2><p>${gameMode?'Right-click an analysis move to delete it and its continuations.':'Explore saved opening lines and continuations.'}</p></div>${gameMode?'':'<span class="move-tree-legend"><span>??</span> Your blunder marks</span>'}</div><div class="move-tree-content" data-move-scroll="opening" aria-label="${gameMode?'Moves played in this game':'Saved moves and continuations'}">${start}${rows.length ? rows.join('') : '<p class="move-tree-empty">No moves recorded in this game.</p>'}</div>`;
    restoreScroll();
  }
  function click(event) {
    const button=event.target.closest('button');if(!button || !container.contains(button))return;
    if(button.hasAttribute('data-tree-toggle')) {
      const key=button.dataset.treeToggle;
      if(collapsed.has(key))collapsed.delete(key);else collapsed.add(key);
      draw();const next=Array.from(container.querySelectorAll('[data-tree-toggle]')).find(el=>el.dataset.treeToggle===key);next?.focus();return;
    }
    if(button.hasAttribute('data-tree-node')) {
      const node=navigable.get(button.dataset.treeNode);if(!node)return;
      const position=keyOf(node);
      onNavigate({moves:(node.moves||[]).slice(),folders:(node.folders||[]).slice(),ply:node.ply,san:node.san});
      const found=Array.from(navigable.entries()).find(([,value])=>keyOf(value)===position);
      if(found)container.querySelector(`[data-tree-node="${found[0]}"]`)?.focus({preventScroll:true});
    }
  }
  let menu = null, menuTrigger = null;
  function closeMenu(restoreFocus = false) {
    const trigger = menuTrigger;
    if (menu) menu.remove();
    menu = null; menuTrigger = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }
  function contextMenu(event) {
    const button=event.target.closest('[data-tree-node]');
    if (!button || !container.contains(button)) return;
    const node=navigable.get(button.dataset.treeNode);
    if (!root?.gameMode || !node?.isAnalysis || node.onGameLine) return;
    event.preventDefault();closeMenu();
    menuTrigger=button;
    menu=document.createElement('button');
    menu.type='button';
    menu.textContent='Delete analysis from this move';
    menu.setAttribute('aria-label',`Delete analysis from ${node.san} and its continuations`);
    menu.style.cssText='background:#332b2b;color:#ffe3dd;border:1px solid #ad756c;border-radius:4px;padding:6px 9px;font-size:12px;';
    const moves=(node.moves||[]).slice();
    menu.addEventListener('click',event=>{
      event.stopPropagation();
      if (globalThis.confirm('Delete this analysis move and all its continuations? Notes and board markings will be kept.')) {
        closeMenu();onDeleteAnalysis(moves);
      } else closeMenu(true);
    });
    button.after(menu);menu.focus();
  }
  function dismiss(event) {
    if (event.key==='Escape' && menu) {event.preventDefault();closeMenu(true);}
  }
  function outsideClick(event) { if (menu && event.target!==menu && event.target!==menuTrigger) closeMenu(); }
  container.addEventListener('click',click);
  container.addEventListener('contextmenu',contextMenu);
  container.addEventListener('keydown',dismiss);
  document.addEventListener('click',outsideClick);
  return {render(next){root=next;draw()},destroy(){closeMenu();container.removeEventListener('click',click);container.removeEventListener('contextmenu',contextMenu);container.removeEventListener('keydown',dismiss);document.removeEventListener('click',outsideClick);container.innerHTML=''}};
}
