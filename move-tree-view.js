const escapeMoveTreeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/**
 * Render the saved opening tree and active game below the board.
 * createMoveTreeView({container, onNavigate})
 * render(root) accepts the output of buildMoveTree. Clicking a move calls
 * onNavigate({moves, folders, ply, san}), leaving navigation to the app.
 */
export function createMoveTreeView({container, onNavigate = () => {}}) {
  if (!container) throw new Error('A move tree container is required.');
  let root = null, navigable = new Map();
  const collapsed = new Set();
  const keyOf = node => (node.moves || []).join(' ');
  const sortChildren = children => (children || []).slice().sort((a,b) => Number(!!b.isCurrent)-Number(!!a.isCurrent) || Number(!!b.onLine)-Number(!!a.onLine) || Number(!!b.onGameLine)-Number(!!a.onGameLine));

  function moveMarkup(node, first, lookupId) {
    const ply=Number(node.ply)||0;
    const number=ply%2===1 ? `${Math.ceil(ply/2)}.` : first ? `${Math.ceil(ply/2)}...` : '';
    const warnings=Array.isArray(node.blunders) ? node.blunders : [];
    const explanation=warnings.map(w => [w.folderName,w.text].filter(Boolean).join(': ')).filter(Boolean).join(' | ');
    const label=`${number ? number+' ' : ''}${node.san || ''}${warnings.length ? ', marked blunder' : ''}${explanation ? ': '+explanation : ''}`;
    navigable.set(lookupId,node);
    const tag=(node.folders || []).map(folder => `<span class="move-tree-folder" title="Saved opening">${escapeMoveTreeText(folder.name)}</span>`).join('');
    return `<span class="move-tree-token">${number?`<span class="move-tree-number">${number}</span>`:''}<button type="button" class="move-tree-move ${node.isCurrent?'is-current':''} ${node.onGameLine?'is-game':''}" data-tree-node="${lookupId}" aria-label="${escapeMoveTreeText(label)}" ${node.isCurrent?'aria-current="step"':''} title="${escapeMoveTreeText(explanation || 'Show this position')}">${escapeMoveTreeText(node.san || '')}${warnings.length?'<span class="move-tree-blunder" aria-hidden="true">??</span>':''}</button>${tag}</span>`;
  }

  function draw() {
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
    const rows=[];
    function appendLine(start, depth, isBranch) {
      const path=[];let node=start;
      while(node) {
        path.push(node);
        const children=sortChildren(node.children);
        if(children.length!==1)break;
        node=children[0];
      }
      const key=keyOf(start), isCollapsed=isBranch && collapsed.has(key), shown=isCollapsed?path.slice(0,1):path;
      const canCollapse=isBranch && (path.length>1 || (path.at(-1)?.children||[]).length>0);
      const toggle=canCollapse?`<button type="button" class="move-tree-disclosure" aria-expanded="${!isCollapsed}" data-tree-toggle="${escapeMoveTreeText(key)}" aria-label="${isCollapsed?'Expand':'Collapse'} variation starting ${escapeMoveTreeText(start.san)}">${isCollapsed?'▸':'▾'}</button>`:(isBranch?'<span class="move-tree-branch-mark" aria-hidden="true">↳</span>':'');
      const rowMarkup=shown.map((item,i)=>moveMarkup(item,i===0,String(++counter))).join('');
      rows.push(`<div class="move-tree-line ${isBranch?'is-variation':''}" style="--branch-depth:${Math.min(depth,3)}">${toggle}<div class="move-tree-sequence">${rowMarkup}</div></div>`);
      if(isCollapsed)return;
      for(const child of sortChildren(path.at(-1)?.children || [])) appendLine(child,depth+1,true);
    }
    const starts=sortChildren(root.children);
    starts.forEach((child,index)=>appendLine(child,index?1:0,!!index));
    const gameMode=!!root.gameMode;
    container.innerHTML=`<div class="move-tree-heading"><div><span class="move-tree-overline">${gameMode?'GAME ANALYSIS':'OPENING EXPLORER'}</span><h2>${gameMode?'Moves you played':'Moves &amp; continuations'}</h2><p>${gameMode?'This line shows only the moves recorded in this game.':'Explore saved opening lines and continuations.'}</p></div>${gameMode?'':'<span class="move-tree-legend"><span>??</span> Your blunder marks</span>'}</div><div class="move-tree-content" aria-label="${gameMode?'Moves played in this game':'Saved moves and continuations'}">${start}${rows.length ? rows.join('') : '<p class="move-tree-empty">No moves recorded in this game.</p>'}</div>`;
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
  container.addEventListener('click',click);
  return {render(next){root=next;draw()},destroy(){container.removeEventListener('click',click);container.innerHTML=''}};
}
