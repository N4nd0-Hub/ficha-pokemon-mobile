'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const row=(name,dex)=>({species_id:name.toLowerCase(),data:{name,dex,slug:name.toLowerCase(),type1:'Water',baseStats:{hp:50,atk:55,def:45,spa:55,spd:45,spe:55},abilities:[{name:'Torrent',text:'Efeito do sistema.'}],moves:[{name:'Water Gun',type:'Water',category:'Special',power:40,accuracy:90,text:'Efeito do Move.'}]}});

function setup(){
  const requests=[],actions=[],elements={hhGmDexModal:{hidden:true},hhGmDexStatus:{textContent:''},hhGmDexClose:{focus:()=>actions.push('close-focus')},hhGmDexSearch:{focus:()=>actions.push('search-focus')}};
  let unavailable=false;
  const files={species:[row('Platycco',7)],forms:[]};
  const window={matchMedia:()=>({matches:true}),POKEDEX_REPOSITORY:{
    fetchCatalog:async()=>files,publicRows:value=>value,
    mergePublicRows:(db,git)=>({species:[...db.species,...git.species.filter(item=>!db.species.some(s=>s.species_id===item.species_id))],forms:[...db.forms,...git.forms]})
  }};
  const document={readyState:'loading',addEventListener(){},getElementById:id=>elements[id]||null,querySelectorAll:()=>[],body:{style:{overflow:'auto'}},activeElement:null};
  const context=vm.createContext({window,document,URL,console,
    setMobileToolsOpen:value=>actions.push(['tools',value]),setDrawerOpen:value=>actions.push(['drawer',value]),
    fetch:async(url,options)=>{
      requests.push({url,options});
      if(unavailable)throw Error('Sem conexão');
      const data=url.includes('/pokedex_public_species?')?[row('Shepshed',1)]:[];
      return {ok:true,json:async()=>data};
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/pokedex-gm-bridge.js'),'utf8'),context);
  return {bridge:window.HH_GM_CATALOG_BRIDGE,requests,actions,elements,document,offline:()=>{unavailable=true;}};
}

test('mobile consulta somente as três fontes públicas do Supabase e inclui as criações dos arquivos',async()=>{
  const x=setup(),catalog=await x.bridge.refresh(true);
  assert.deepEqual(Array.from(catalog,s=>s.name),['Shepshed','Platycco']);
  assert.equal(catalog[1].ability.name,'Torrent');
  assert.equal(catalog[1].moves[0].description,'Efeito do Move.');
  assert.equal(x.requests.length,3);
  assert.deepEqual(x.requests.map(r=>new URL(r.url).pathname.split('/').pop()).sort(),['pokedex_public_custom_megas','pokedex_public_forms','pokedex_public_species']);
  for(const {options} of x.requests){
    assert.equal(options.method,'GET');
    assert.match(options.headers.apikey,/^sb_publishable_/);
    assert.equal(options.body,undefined);
    assert.equal(options.headers.Authorization,undefined);
  }
  assert.equal(x.bridge.getStatus().online,true);
});

test('uma falha de conexão preserva o catálogo anterior e informa o uso de cache',async()=>{
  const x=setup();await x.bridge.refresh(true);x.offline();
  const catalog=await x.bridge.refresh(true);
  assert.deepEqual(Array.from(catalog,s=>s.name),['Shepshed','Platycco']);
  assert.equal(x.bridge.getStatus().online,false);
  assert.match(x.elements.hhGmDexStatus.textContent,/cache offline.*Sem conexão/);
});

test('a Pokédex mobile fecha as gavetas e abre a lista sem focar o teclado de busca',async()=>{
  const x=setup();x.bridge.open();await x.bridge.refresh(true);
  assert.equal(x.elements.hhGmDexModal.hidden,false);
  assert.equal(x.document.body.style.overflow,'hidden');
  assert.deepEqual(x.actions,[['tools',false],['drawer',false],'close-focus']);
});
