'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){
  if(match[1].trim())new vm.Script(match[1],{filename:'index.html inline'});
}
for(const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"#]+)"/g)){
  const target=match[1].split('?')[0];
  if(/^(?:https?:|data:|\/\/)/.test(target))continue;
  if(!fs.existsSync(path.join(__dirname,'..',target)))throw Error('Arquivo local ausente: '+target);
  if(target.endsWith('.js'))new vm.Script(fs.readFileSync(path.join(__dirname,'..',target),'utf8'),{filename:target});
}
const ids=new Set();
const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'');
for(const match of markup.matchAll(/\bid="([^"]+)"/g)){
  if(ids.has(match[1]))throw Error('ID duplicado: '+match[1]);
  ids.add(match[1]);
}
console.log('JavaScript, referências locais e IDs do HTML verificados.');
