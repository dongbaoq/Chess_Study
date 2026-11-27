// Run with: node --experimental-vm-modules --test tests/study-notes-ui.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');

async function createHarness() {
  const listeners = {};
  const container = {
    innerHTML: '',
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener(name) { delete listeners[name]; },
    contains() { return true; },
    querySelectorAll() { return []; }
  };
  const memory = new Map();
  class Textarea {
    constructor(dataset, value) { this.dataset = dataset; this.value = value; }
    hasAttribute(name) { return name === 'data-idea' && !!this.dataset.idea; }
  }
  const sandbox = vm.createContext({
    HTMLTextAreaElement: Textarea,
    document: { activeElement: null },
    localStorage: { getItem(k) { return memory.get(k) ?? null; }, setItem(k, v) { memory.set(k, v); } }
  });
  const cache = new Map();
  async function moduleFor(name) {
    const filename = path.resolve(root, name.split('?')[0]);
    assert.ok(filename.startsWith(root + path.sep));
    if (!cache.has(filename)) cache.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context:sandbox, identifier:filename }));
    const mod = cache.get(filename);
    if (mod.status === 'unlinked') await mod.link((specifier, from) => moduleFor(path.relative(root, path.resolve(path.dirname(from.identifier), specifier))));
    return mod;
  }
  const module = await moduleFor('study-notes.js');
  await module.evaluate();
  let changes = 0;
  const notes = module.namespace.createStudyNotes({container, onChange() { changes++; }});
  const click = dataset => listeners.click({target:{closest() { return {dataset}; }}});
  const input = (dataset, value) => listeners.input({target:new Textarea(dataset, value)});
  return {notes, container, click, input, changes:() => changes, memory};
}
const fixture = () => [
  {id:'root', side:'white', parentId:null, name:'Ruy Lopez', line:'1. e4 e5', note:'Root idea', blunders:[{id:'b',moves:['e4'],text:'Keep this',extra:{unknown:1}}], games:[], unknown:'preserve'},
  {id:'child', side:'white', parentId:'root', name:'Morphy Defense', line:'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6', note:'Child plan', blunders:[{id:'b2',text:'Keep too'}], games:[]},
  {id:'leaf', side:'white', parentId:'child', name:'Retreat', line:'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4', note:'Leaf note', games:[]}
];
const clone = value => JSON.parse(JSON.stringify(value));

test('opening theory renders deepest branch first and hides blunder controls without changing saved records', async () => {
  const h = await createHarness(), folders = fixture(), before = clone(folders);
  h.notes.render({folders,folder:folders[2],game:null,moves:[],index:0});
  const html = h.container.innerHTML;
  const toggles = [...html.matchAll(/data-toggle-opening="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(toggles,['leaf','child','root']);
  const cards = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
  assert.deepEqual(cards,['Retreat','Morphy Defense','Ruy Lopez']);
  assert.match(html, /study-opening-info/);
  assert.match(html, /study-opening-note/);
  assert.doesNotMatch(html, /Blunders &amp; traps|data-add-warning|data-remove-warning/);
  assert.deepEqual(folders,before);
  h.click({toggleOpening:'child'});
  assert.doesNotMatch(h.container.innerHTML, /<h3>Morphy Defense<\/h3>/);
  assert.deepEqual(folders,before);
  assert.equal(h.changes(),0);
});

test('editing an opening note leaves hidden blunders, other notes, and unknown fields intact', async () => {
  const h = await createHarness(), folders = fixture(), before = clone(folders);
  h.notes.render({folders,folder:folders[2],game:null,moves:[],index:0});
  h.click({editKey:'idea:child'});
  assert.match(h.container.innerHTML, /data-editor-key="idea:child"/);
  h.input({idea:'child'}, 'Revised child plan');
  assert.equal(folders[1].note,'Revised child plan');
  before[1].note='Revised child plan';
  assert.deepEqual(folders,before);
  assert.equal(h.changes(),1);
  h.click({editKey:'idea:child'});
  assert.match(h.container.innerHTML, /Revised child plan/);
});

test('legacy opening text and game analysis notes still render without rewriting data', async () => {
  const h = await createHarness(), folders = fixture();
  delete folders[0].note;
  folders[0].idea = 'Legacy idea';
  folders[0].plan = 'Legacy plan';
  const game = {id:'game',name:'Game',pgn:'1. e4 e5',gameNote:'Game reflection',notes:{e4:'Position note'},extra:'preserve'};
  folders[2].games.push(game);
  const before = clone(folders);
  h.notes.render({folders,folder:folders[0],game:null,moves:['e4'],index:1});
  assert.match(h.container.innerHTML, /Legacy idea\n\nLegacy plan/);
  assert.deepEqual(folders,before);
  h.notes.render({folders,folder:folders[2],game,moves:['e4','e5'],index:1});
  assert.match(h.container.innerHTML, /Game reflection/);
  assert.match(h.container.innerHTML, /Position note/);
  assert.doesNotMatch(h.container.innerHTML, /study-opening-info/);
  assert.deepEqual(folders,before);
});
