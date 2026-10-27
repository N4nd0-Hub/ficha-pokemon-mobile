'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {IDBFactory}=require('fake-indexeddb');
const Save=require('../scripts/local-save-v5.js');
const ART='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=';
function memory(seed={}){
  const map=new Map(Object.entries(seed));
  return {get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem(k,v){map.set(k,String(v));},removeItem:k=>map.delete(k),map};
}
const fixture=(name='Platycco',image=ART)=>({currentId:'one',pokemon:[{id:'one',name,imageUrl:image,stats:{hp:50,atk:55,def:45,spa:55,spd:45,spe:55},moves:[{name:'Water Gun',power:40}]}],trainer:{name:'Nando',photo:ART},speciesBank:[{image:{dataUrl:image}}],combatBag:{potion:4}});
function setup(){
  const indexedDB=new IDBFactory(),storage=memory();let time=100000;
  const engines=[];
  return {indexedDB,storage,advance(n=1){time+=n;},engine(extra={}){const e=Save.create({env:{},indexedDB,storage,namespace:'qa',legacy:{primary:'old',backup:'old-backup',timestamp:'old-time',database:''},now:()=>time,listen:false,...extra});engines.push(e);return e;},close(){engines.forEach(e=>e.destroy());}};
}
async function raw(factory,fn){
  const db=await new Promise((resolve,reject)=>{const r=factory.open('qa_database',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(['heads','history','assets'],'readwrite');const result=fn(tx);tx.oncomplete=()=>resolve(typeof result==='function'?result():result);tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}

test('migra o save antigo inteiro, preservando Pokémon, treinador, inventário e artes',async t=>{
  const x=setup();t.after(()=>x.close());const original=fixture();
  x.storage.setItem('old',JSON.stringify(original));x.storage.setItem('old-time','90000');
  const a=x.engine(),loaded=await a.boot(fixture('Default'));
  assert.deepEqual(loaded.state,original);assert.equal(loaded.source,'legacy');assert.equal(a.status().halted,false);
  const b=x.engine(),reloaded=await b.boot(fixture('Default'));
  assert.deepEqual(reloaded.state,original);assert.equal(reloaded.source,'database');
  assert.equal(x.storage.getItem('old'),JSON.stringify(original));
});

test('salva artes maiores que o limite do localStorage e guarda a mesma imagem uma única vez',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());
  const huge='data:image/png;base64,'+'A'.repeat(6*1024*1024),state=fixture('Arte grande',huge);state.trainer.photo=huge;
  const originalSet=x.storage.setItem;x.storage.setItem=function(k,v){if(String(v).length>100000)throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});return originalSet.call(this,k,v);};
  assert.equal(await a.saveNow(state),true);assert.equal(a.status().dirty,false);
  const b=x.engine();assert.deepEqual((await b.boot(fixture())).state,state);
  const count=await raw(x.indexedDB,tx=>{const r=tx.objectStore('assets').count();return ()=>r.result;});
  assert.equal(count,1);
});

test('gravações rápidas e sobrepostas terminam na alteração mais recente',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());
  const first=a.saveNow(fixture('Primeira'));
  a.schedule(fixture('Segunda'));a.schedule(fixture('Última'));
  await first;await a.flush();
  const b=x.engine();assert.equal((await b.boot(fixture())).state.pokemon[0].name,'Última');assert.equal(a.status().dirty,false);
});

test('uma nova edição durante a gravação não recebe um falso status de salvo',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());
  const saving=a.saveNow(fixture('Versão em gravação'));a.markDirty();
  await saving;assert.equal(a.status().dirty,true);
  assert.equal(await a.saveNow(fixture('Nova edição')),true);
});

test('recupera a versão anterior completa quando o save principal está corrompido',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());
  await a.saveNow(fixture('Anterior'));x.advance();await a.saveNow(fixture('Atual'));
  await raw(x.indexedDB,tx=>{const s=tx.objectStore('heads'),r=s.get('current');r.onsuccess=()=>{r.result.json+='quebrado';s.put(r.result,'current');};});
  const b=x.engine(),result=await b.boot(fixture('Default'));
  assert.equal(result.state.pokemon[0].name,'Anterior');assert.equal(result.state.pokemon[0].imageUrl,ART);assert.equal(result.recovered,true);
});

test('fechamento imediato recupera o rascunho mesmo no mesmo milissegundo ou após ajuste do relógio',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());await a.saveNow(fixture('Antes'));
  x.advance(-3000);a.markDirty();assert.equal(a.emergency(fixture('Última tecla')),true);a.destroy();
  const b=x.engine(),result=await b.boot(fixture());assert.equal(result.state.pokemon[0].name,'Última tecla');assert.equal(result.source,'journal');
});

test('duas abas com alterações diferentes preservam ambas e exigem uma escolha',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine(),b=x.engine();await a.boot(fixture());await a.saveNow(fixture('Inicial'));await b.boot(fixture());
  x.advance();await a.saveNow(fixture('Aba A'));x.advance();assert.equal(await b.saveNow(fixture('Aba B')),false);assert.equal(b.status().conflict,true);
  const names=[];for(const r of await b.list()){try{names.push((await b.getVersion(r.id)).state.pokemon[0].name);}catch{}}
  assert(names.includes('Aba A'));assert(names.includes('Aba B'));
  assert.equal(await b.saveNow(fixture('Aba B'),{force:true,reason:'Versão escolhida nesta aba'}),true);
  const c=x.engine();assert.equal((await c.boot(fixture())).state.pokemon[0].name,'Aba B');
});

test('o save confirmado mais recente continua principal mesmo se o relógio voltar no tempo',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());await a.saveNow(fixture('Antes'));
  x.advance(-5000);await a.saveNow(fixture('Depois do ajuste'));
  const b=x.engine();assert.equal((await b.boot(fixture())).state.pokemon[0].name,'Depois do ajuste');
});

test('uma aba sem edições recebe o novo save; uma aba com digitação pendente não é substituída',async t=>{
  const x=setup();t.after(()=>x.close());let external=null;
  const a=x.engine(),b=x.engine({onExternal:v=>external=v});await a.boot(fixture());await a.saveNow(fixture('Inicial'));await b.boot(fixture());
  x.advance();await a.saveNow(fixture('Remota'));await b.checkRemote();assert.equal(external.pokemon[0].name,'Remota');
  external=null;b.markDirty();x.advance();await a.saveNow(fixture('Outra remota'));await b.checkRemote();assert.equal(external,null);assert.equal(b.status().conflict,true);
});

test('carregar a versão de outra aba arquiva as alterações locais antes da troca',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine(),b=x.engine();await a.boot(fixture());await a.saveNow(fixture('Inicial'));await b.boot(fixture());
  x.advance();await a.saveNow(fixture('Remota'));b.markDirty();const restored=await b.loadLatest(fixture('Local ainda não salva'));
  assert.equal(restored.pokemon[0].name,'Remota');
  const names=[];for(const r of await b.list())names.push((await b.getVersion(r.id)).state.pokemon[0].name);
  assert(names.includes('Local ainda não salva'));assert.equal(b.status().conflict,false);
});

test('não sobrescreve dados existentes por uma ficha padrão quando todas as cópias estão danificadas',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());await a.saveNow(fixture('Importante'));
  await raw(x.indexedDB,tx=>{const s=tx.objectStore('heads'),r=s.get('current');r.onsuccess=()=>{r.result.checksum='inválido';s.put(r.result,'current');};});
  const b=x.engine(),result=await b.boot(fixture('Padrão'));
  assert.equal(result.halted,true);assert.equal(b.schedule(fixture('Padrão')),false);
  const stored=await raw(x.indexedDB,tx=>{const r=tx.objectStore('heads').get('current');return ()=>r.result;});
  assert(stored.json.includes('Importante'));assert.equal(stored.checksum,'inválido');
});

test('falha real de transação não aparece como gravação confirmada e pode ser tentada novamente',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());
  const open=x.indexedDB.open.bind(x.indexedDB);
  const database=await new Promise(resolve=>{const r=open('qa_database');r.onsuccess=()=>resolve(r.result);});
  const prototype=Object.getPrototypeOf(database),original=prototype.transaction;
  prototype.transaction=function(names,mode,options){if(mode==='readwrite')throw Object.assign(new Error('quota de teste'),{name:'QuotaExceededError'});return original.call(this,names,mode,options);};
  try{assert.equal(await a.saveNow(fixture('Não confirmada')),false);assert.equal(a.status().savedAt,0);assert.equal(a.status().dirty,true);}finally{prototype.transaction=original;database.close();}
  assert.equal(await a.flush(),true);assert.equal(a.status().dirty,false);
});

test('histórico limitado preserva artes da versão atual, da anterior e de todas as versões listadas',async t=>{
  const x=setup();t.after(()=>x.close());const a=x.engine();await a.boot(fixture());
  for(let i=0;i<25;i++){x.advance(70000);await a.saveNow(fixture('Versão '+i,ART+i));}
  const versions=await a.list();assert(versions.length<=20);assert(versions.length>=18);
  for(const r of versions){const v=await a.getVersion(r.id);assert(v.state.pokemon[0].imageUrl.startsWith(ART));}
  const count=await raw(x.indexedDB,tx=>{const r=tx.objectStore('assets').count();return ()=>r.result;});assert(count<=21);
});

test('sem IndexedDB, o modo básico salva um JSON completo com as imagens',async t=>{
  const storage=memory(),a=Save.create({env:{},storage,namespace:'basic',legacy:{},listen:false});t.after(()=>a.destroy());
  await a.boot(fixture());assert.equal(a.status().basic,true);assert.equal(await a.saveNow(fixture('Básico')),true);
  const b=Save.create({env:{},storage,namespace:'basic',legacy:{},listen:false});t.after(()=>b.destroy());
  const loaded=await b.boot(fixture());assert.equal(loaded.state.pokemon[0].name,'Básico');assert.equal(loaded.state.pokemon[0].imageUrl,ART);
});

test('uma aba com a versão antiga continua recuperável sem sobrescrever o novo save',async t=>{
  const x=setup();t.after(()=>x.close());x.storage.setItem('old',JSON.stringify(fixture('Antiga inicial')));x.storage.setItem('old-time','90000');
  const a=x.engine();await a.boot(fixture());x.advance(10000);await a.saveNow(fixture('Nova versão'));
  x.storage.setItem('old',JSON.stringify(fixture('Edição da aba antiga')));x.storage.setItem('old-time','120000');
  await a.checkRemote();assert.equal(a.status().conflict,true);
  const entries=await a.list(),legacy=entries.find(r=>r.reason==='Save de uma aba com versão antiga');assert(legacy);
  assert.equal((await a.getVersion(legacy.id)).state.pokemon[0].name,'Edição da aba antiga');
  const stored=await raw(x.indexedDB,tx=>{const r=tx.objectStore('heads').get('current');return ()=>r.result;});assert(stored.json.includes('Nova versão'));
  const b=x.engine();assert.equal((await b.boot(fixture())).state.pokemon[0].name,'Nova versão');
});
