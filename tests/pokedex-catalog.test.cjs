'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bridge() {
  const context = vm.createContext({window:{},document:{readyState:'loading',addEventListener(){}},console,URL});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/pokedex-gm-bridge.js'),'utf8'),context);
  return context.window.HH_GM_CATALOG_BRIDGE;
}
const plain = value => JSON.parse(JSON.stringify(value));
function species(name,dex,extra={}) {
  return {species_id:name.toLowerCase(),data:{name,dex,slug:name.toLowerCase(),
    type1:'Water',baseStats:{hp:50,atk:55,def:45,spa:55,spd:45,spe:55},
    classification:'fakemon',abilities:[],evolution:{},...extra}};
}
function mega(parent,id,name) {
  return {form_id:name.toLowerCase(),data:{name,kind:'mega',parentName:parent,
    parentPokeapiId:id,parentSlug:parent.toLowerCase(),type1:'Flying',
    baseStats:{hp:80,atk:100,def:80,spa:130,spd:80,spe:120},abilities:[]}};
}

test('números da Dex determinam a ordem, independentemente da criação ou do nome',()=>{
  const b=bridge();
  const entries=b._build([
    species('Sem número',null,{createdAt:'2020-01-01'}),
    species('Dez',10,{createdAt:'2021-01-01'}),
    species('Dois','2',{createdAt:'2026-01-01'}),
    species('Um',1,{createdAt:'2025-01-01'}),
    species('Dex inválida',0,{createdAt:'2019-01-01'})
  ],[],[]);
  assert.deepEqual(plain(entries.filter(s=>s.dex>0).map(s=>s.dex)),[1,2,10]);
  assert(entries.slice(3).every(s=>!s.dex));
});

test('linhas evolutivas permanecem juntas e são ordenadas pelo menor número da Dex',()=>{
  const b=bridge();
  const rows=[
    species('Plaskatto',9,{evolution:{previous:'Plakappa'},createdAt:'2020-01-01'}),
    species('Kidling',4,{createdAt:'2023-01-01'}),
    species('Plakappa',8,{evolution:{previous:'Platycco',next:'Plaskatto'},createdAt:'2021-01-01'}),
    species('Larvike',10,{createdAt:'2019-01-01'}),
    species('Platycco',7,{evolution:{next:'Plakappa'},createdAt:'2026-01-01'})
  ];
  const lines=b._evolutionLines(b._build(rows,[],[]));
  assert.deepEqual(plain(lines.map(line=>line.members.map(s=>s.dex))),[[4],[7,8,9],[10]]);
});

test('Megas independentes não criam registros de Pidgeot e Haxorus na seção de espécies',()=>{
  const b=bridge();
  const catalog=b._build([species('Platycco',7)],[],[
    mega('Haxorus',612,'Mega Haxorus'),mega('Pidgeot',18,'Mega Pidgeot')
  ]);
  const sections=b._catalogSections(catalog);
  assert.deepEqual(plain(sections.species.map(s=>s.name)),['Platycco']);
  assert.deepEqual(plain(sections.forms.map(e=>e.form.name)),['Mega Pidgeot','Mega Haxorus']);
  assert.equal(b.find('Pidgeot'),null);
  assert.equal(b.find('Haxorus'),null);
});

test('Megas e outras formas ficam na seção de formas, vinculadas à espécie correta e sem duplicar a base',()=>{
  const b=bridge();
  const forms=[
    {form_id:'regional',species_id:'platycco',data:{id:'regional',name:'Platycco Regional',kind:'regional',type1:'Ice',baseStats:{},abilities:[]}},
    {form_id:'shiny',species_id:'platycco',data:{id:'shiny',name:'Platycco Shiny',kind:'shiny',type1:'Water',baseStats:{},abilities:[]}}
  ];
  const sections=b._catalogSections(b._build([species('Pidgeot',18),species('Platycco',7)],forms,[mega('Pidgeot',18,'Mega Pidgeot')]));
  assert.deepEqual(plain(sections.species.map(s=>s.name)),['Platycco','Pidgeot']);
  assert.equal(sections.species.length,2);
  assert.equal(sections.forms.length,3);
  assert.deepEqual(plain(sections.forms.map(e=>[e.species.dex,e.form.kind])),[[7,'regional'],[7,'shiny'],[18,'mega']]);
});

test('um catálogo só de Megas mantém a seção de espécies vazia e as formas acessíveis',()=>{
  const b=bridge();
  const catalog=b._build([],[],[mega('Pidgeot',18,'Mega Pidgeot')]);
  const sections=b._catalogSections(catalog);
  assert.equal(sections.species.length,0);
  assert.equal(sections.forms.length,1);
  assert.equal(sections.forms[0].species.dex,18);
  assert.equal(sections.forms[0].form.formType,'mega');
});

test('dados incompletos ou referências circulares não removem nem repetem espécies',()=>{
  const b=bridge();
  const rows=[species('A',11,{evolution:{next:'B'}}),species('B',12,{evolution:{next:'A'}}),species('C',5,{evolution:{previous:'Não publicada'}})];
  const lines=b._evolutionLines(b._build(rows,[],[]));
  const names=plain(lines.flatMap(line=>line.members.map(s=>s.name)));
  assert.deepEqual(names,['C','A','B']);
  assert.equal(new Set(names).size,3);
});
