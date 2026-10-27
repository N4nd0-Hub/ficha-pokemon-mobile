/* Pokémon Heaven & Hell V5.0 — catálogo da Pokédex para ficha PC e Mobile.
   Apenas registros PUBLICADOS. Nenhuma credencial privada, escrita remota ou alteração automática de personagens. */
(function () {
  'use strict';
  if (window.HH_GM_CATALOG_BRIDGE) return;
  var API = 'https://eoteckuikfmhfmkbbndc.supabase.co/rest/v1/';
  var PUBLIC_KEY = 'sb_publishable_a7zlErG9omVgrP_W9MK-4w_yjvP3Qd8';
  var GM_SITE = 'https://n4nd0-hub.github.io/Pok-dex-GM/';
  var CACHE_DB = 'hh-pokedex-gm-bridge-v5';
  var cache = {species:[], forms:[], customMegas:[], savedAt:0};
  /* INDEPENDENT_CUSTOM_MEGA_V1 — Megas criadas sem duplicar a espécie oficial. */
  var catalog = [];
  var online = false;
  var busy = null;
  var mounted = false;
  var originalFind = null;
  var originalMegaModal = null;
  var originalLoadMegas = null;
  var lastError = '';
  var previousFocus = null;
  var previousOverflow = null;
  var activeSection = 'species';
  var repositoryLibrary = null;

  async function repositoryRows(force) {
    if (!window.POKEDEX_REPOSITORY) {
      if (!repositoryLibrary) repositoryLibrary = new Promise(function(resolve,reject){
        var script = document.createElement('script');
        script.src = GM_SITE + 'repository-catalog.js?files=1';
        script.onload = function(){
          if (window.POKEDEX_REPOSITORY) resolve();
          else {repositoryLibrary=null; reject(Error('Catálogo dos arquivos indisponível.'));}
        };
        script.onerror = function(){script.remove();repositoryLibrary=null;reject(Error('Não foi possível consultar as criações do Git.'));};
        document.head.appendChild(script);
      });
      await repositoryLibrary;
    }
    var data = await window.POKEDEX_REPOSITORY.fetchCatalog({baseUrl:GM_SITE,force:!!force});
    return window.POKEDEX_REPOSITORY.publicRows(data);
  }
  function dexNumber(entry) {
    var value = Number(entry.dex);
    return Number.isFinite(value) && value > 0 ? value : Infinity;
  }
  function dexOrder(a, b) {
    var left = dexNumber(a), right = dexNumber(b);
    return (left === right ? 0 : left < right ? -1 : 1)
      || a.name.localeCompare(b.name,'pt-BR',{numeric:true,sensitivity:'base'})
      || String(a.gmId || a.id || '').localeCompare(String(b.gmId || b.id || ''));
  }
  function dexLabel(entry) {
    var value = dexNumber(entry);
    return value === Infinity ? '—' : '#' + String(value).padStart(3,'0');
  }
  function catalogSections(entries) {
    return {
      species:entries.filter(function(s){return !s.megaOnly;}).sort(dexOrder),
      forms:entries.flatMap(function(s){return s.forms.map(function(f){return {species:s,form:f};});})
        .sort(function(a,b){return dexOrder(a.species,b.species) || dexOrder(a.form,b.form);})
    };
  }
  function catalogSummary() {
    var sections = catalogSections(catalog);
    return sections.species.length+' espécie(s) · '+sections.forms.length+' forma(s)';
  }
  function references(value) {
    if (Array.isArray(value)) return value.flatMap(references);
    if (value && typeof value === 'object') {
      return references(value.name || value.speciesId || value.id || value.slug);
    }
    return String(value || '').split(/\s*(?:→|->|;|\n|\|)\s*/).map(key)
      .filter(function(token){return token && !/^(?:nenhum|nenhuma|none|nao|n-a|forma-final)$/.test(token);});
  }
  function evolutionLines(entries) {
    var aliases = new Map(), parents = new Map(), edges = new Map();
    entries.forEach(function(s){
      parents.set(s.gmId, s.gmId); edges.set(s.gmId, new Set());
      [s.gmId, s.id, s.slug, s.name].map(key).filter(Boolean).forEach(function(alias){aliases.set(alias, s.gmId);});
    });
    function root(id) {
      if (!parents.has(id)) parents.set(id, id);
      if (parents.get(id) !== id) parents.set(id, root(parents.get(id)));
      return parents.get(id);
    }
    function connect(a, b) {parents.set(root(b), root(a));}
    entries.forEach(function(s){
      var ev = s.evolution || {};
      var previous = references(ev.previous || ev.evolvesFrom);
      var next = references(ev.next || ev.evolvesTo);
      previous.forEach(function(alias){
        var id = aliases.get(alias);
        connect(s.gmId, id || 'unpublished:' + alias);
        if (id && id !== s.gmId) edges.get(id).add(s.gmId);
      });
      next.forEach(function(alias){
        var id = aliases.get(alias);
        connect(s.gmId, id || 'unpublished:' + alias);
        if (id && id !== s.gmId) edges.get(s.gmId).add(id);
      });
    });
    var groups = new Map();
    entries.forEach(function(s){
      var id = root(s.gmId);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(s);
    });
    return Array.from(groups.values()).map(function(members){
      var byId = new Map(members.map(function(s){return [s.gmId, s];}));
      var pending = new Map(members.map(function(s){return [s.gmId, 0];}));
      members.forEach(function(s){edges.get(s.gmId).forEach(function(id){if (pending.has(id)) pending.set(id, pending.get(id) + 1);});});
      var queue = members.filter(function(s){return !pending.get(s.gmId);}).sort(dexOrder);
      var sorted = [], visited = new Set();
      while (queue.length) {
        var s = queue.shift();
        if (visited.has(s.gmId)) continue;
        visited.add(s.gmId); sorted.push(s);
        edges.get(s.gmId).forEach(function(id){
          if (!pending.has(id)) return;
          pending.set(id, pending.get(id) - 1);
          if (!pending.get(id)) queue.push(byId.get(id));
        });
        queue.sort(dexOrder);
      }
      // Dados incompletos ou circulares continuam visíveis, sem duplicação.
      members.filter(function(s){return !visited.has(s.gmId);}).sort(dexOrder).forEach(function(s){sorted.push(s);});
      return {members: sorted, first: members.slice().sort(dexOrder)[0]};
    }).sort(function(a,b){return dexOrder(a.first, b.first);});
  }

  function key(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function art(s) {
    if (!s || typeof s !== 'string') return '';
    try { var u = new URL(s); return u.protocol === 'https:' ? u.href : ''; }
    catch (err) { return ''; }
  }
  function stats(s) {
    var result = {};
    ['hp','atk','def','spa','spd','spe'].forEach(function(k) {
      var value = Number(s && s[k]);
      result[k] = Number.isFinite(value) ? Math.max(1,Math.min(999,Math.round(value))) : 1;
    });
    return result;
  }
  function abilities(raw) {
    return Array.isArray(raw) ? raw.filter(function(a){return a && a.name;}).map(function(a){
      return {name:String(a.name), description:String(a.text || a.description || '')};
    }) : [];
  }
  function learnLevel(s) {
    var match = String(s || '').match(/(?:lv\.?|level|nível)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }
  function moves(raw) {
    return Array.isArray(raw) ? raw.filter(function(m){return m && m.name;}).map(function(m) {
      var accuracy = m.accuracy == null || m.accuracy === '' ? null : Number(m.accuracy);
      return {name:String(m.name),type:m.type || 'Normal',category:m.category || 'Status',
        power:Number(m.power || 0),accuracy:accuracy == null ? null : Math.max(1,Math.min(90,accuracy)),
        alwaysHits:accuracy == null,description:String(m.text || m.description || ''),
        learnLevel:learnLevel(m.learn),learnMethod:m.learn || '',
        source:'Pokédex GM',specialRules:m.specialRules || []};
    }) : [];
  }
  function adaptForm(record) {
    var d = record && (record.data || record);
    if (!d || !d.name) return null;
    var aa = abilities(d.abilities);
    return {id:String(d.id || record.form_id || ''),name:String(d.name),slug:d.slug || '',
      formType:String(d.kind || 'alternate').toLowerCase(),kind:String(d.kind || 'alternate').toLowerCase(),
      types:[d.type1 || 'Normal',d.type2 || ''].filter(Boolean),
      baseStats:stats(d.baseStats),ability:aa[0] || {name:'',description:''},
      abilities:aa,image:{dataUrl:art(d.artUrl || d.thumbUrl || '')},
      specialRules:d.specialRules ? [String(d.specialRules)] : [],
      revision:Number(record.revision || d.revision || 1),
      createdAt:record.created_at || d.createdAt || '',
      publishedAt:record.published_at || d.publishedAt || ''};
  }
  function adaptIndependentMega(record) {
    var d = record && (record.data || record);
    var form = adaptForm(record);
    if (!d || !form) return null;
    form.formType='mega';
    form.kind='mega';
    form.independentMega=true;
    form.parentPokeapiId=Number(d.parentPokeapiId || record.parent_pokeapi_id || 0) || null;
    form.parentName=String(d.parentName || record.parent_name || '');
    form.parentSlug=String(d.parentSlug || record.parent_slug || key(form.parentName));
    form.parentSpriteUrl=art(d.parentSpriteUrl || record.parent_sprite_url || '');
    return form;
  }
  function adaptSpecies(record, formRecords) {
    var d = record && (record.data || record);
    if (!d || !d.name || !d.baseStats) return null;
    var aa = abilities(d.abilities);
    var id = String(record.species_id || d.id || '');
    if (!id) return null;
    var fs = formRecords.filter(function(f){return String(f.species_id) === id;})
      .map(adaptForm).filter(Boolean);
    return {id:'gm-'+id, gmId:id,slug:d.slug || record.slug || '',name:String(d.name),
      dex:d.dex == null ? null : Number(d.dex),category:d.category || '',
      classification:d.classification || record.classification || 'fakemon',
      types:[d.type1 || record.type1 || 'Normal',d.type2 || record.type2 || ''].filter(Boolean),
      baseStats:stats(d.baseStats),ability:aa[0] || {name:'',description:''},abilities:aa,
      image:{dataUrl:art(d.coverUrl || d.thumbUrl || '')},moves:moves(d.moves),
      evolution:d.evolution || {},specialRules:d.specialRules ? [String(d.specialRules)] : [],
      forms:fs,revision:Number(record.revision || d.revision || 1),
      createdAt:record.created_at || d.createdAt || '',
      publishedAt:record.published_at || d.publishedAt || '',
      description:d.description || '',source:'Pokédex GM'};
  }
  function build(species, forms, customMegaRows) {
    if (!Array.isArray(species) || !Array.isArray(forms)) throw Error('Resposta inválida do banco.');
    var result = species.map(function(r, index){
      var entry = adaptSpecies(r,forms);
      if (entry) entry.catalogOrder = index;
      return entry;
    }).filter(Boolean);
    (Array.isArray(customMegaRows) ? customMegaRows : []).forEach(function(row){
      var form=adaptIndependentMega(row);
      if(!form || !form.parentPokeapiId) return;
      var parent=result.find(function(s){
        return Number(s.dex)===Number(form.parentPokeapiId)
          || key(s.slug)===key(form.parentSlug)
          || key(s.name)===key(form.parentName);
      });
      if(parent){
        if(!parent.forms.some(function(f){return String(f.id)===String(form.id);})) parent.forms.push(form);
        return;
      }
      result.push({
        id:'gm-pokeapi-'+form.parentPokeapiId,
        gmId:'pokeapi-'+form.parentPokeapiId,
        slug:form.parentSlug || key(form.parentName),
        name:form.parentName || ('Pokémon #'+form.parentPokeapiId),
        dex:form.parentPokeapiId,
        category:'Espécie oficial · base via PokéAPI',
        classification:'official',
        types:[],
        baseStats:{hp:0,atk:0,def:0,spa:0,spd:0,spe:0},
        ability:{name:'',description:''},abilities:[],
        image:{dataUrl:form.parentSpriteUrl},moves:[],evolution:{},specialRules:[],
        forms:[form],revision:form.revision,createdAt:form.createdAt,publishedAt:form.publishedAt,description:'',
        catalogOrder:result.length,
        source:'Pokédex GM',megaOnly:true
      });
    });
    return result.sort(dexOrder);
  }
  function readCache() {
    return new Promise(function(resolve) {
      if (!window.indexedDB) return resolve(null);
      try {
        var req = indexedDB.open(CACHE_DB,1);
        req.onupgradeneeded = function(){req.result.createObjectStore('catalog');};
        req.onerror = function(){resolve(null);};
        req.onsuccess = function(){
          var db = req.result, tx = db.transaction('catalog','readonly'), get = tx.objectStore('catalog').get('published');
          get.onsuccess = function(){resolve(get.result || null);db.close();};
          get.onerror = function(){resolve(null);db.close();};
        };
      } catch(err) {resolve(null);}
    });
  }
  function writeCache(value) {
    if (!window.indexedDB) return;
    try {
      var req = indexedDB.open(CACHE_DB,1);
      req.onupgradeneeded = function(){req.result.createObjectStore('catalog');};
      req.onsuccess = function(){
        var db = req.result, tx = db.transaction('catalog','readwrite');
        tx.objectStore('catalog').put(value,'published');
        tx.oncomplete = tx.onerror = function(){db.close();};
      };
    } catch(err) {console.warn('Cache Pokédex GM:',err);}
  }
  function request(table, offset) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function(){ctrl.abort();},11000) : null;
    var url = API+table+'?select=*&limit=500&offset='+offset;
    return fetch(url,{method:'GET',mode:'cors',cache:'no-store',
      headers:{apikey:PUBLIC_KEY,Accept:'application/json'},
      signal:ctrl ? ctrl.signal : undefined
    }).then(function(response) {
      if (!response.ok) throw Error('Supabase '+response.status+' ('+table+')');
      return response.json();
    }).finally(function(){if(timer) clearTimeout(timer);});
  }
  async function allRows(table) {
    var result = [];
    for (var offset=0;offset<10000;offset+=500) {
      var batch = await request(table,offset);
      if (!Array.isArray(batch)) throw Error('Resposta inesperada de '+table);
      result.push.apply(result,batch);
      if (batch.length<500) break;
    }
    return result;
  }
  function status(message) {
    var el=document.getElementById('hhGmDexStatus');
    if(el)el.textContent=message;
    document.querySelectorAll('[data-gm-count]').forEach(function(n){
      n.textContent = String(catalogSections(catalog).species.length);
    });
  }
  function notify(message) {
    if (typeof showToast==='function') showToast(message);
    else console.info(message);
  }
  async function refresh(force) {
    if (busy) return busy;
    if (!force && online) return catalog;
    status('Sincronizando espécies e Megas publicadas...');
    busy = (async function(){
      try {
        var data = await Promise.all([
          allRows('pokedex_public_species'),
          allRows('pokedex_public_forms'),
          allRows('pokedex_public_custom_megas'),
          repositoryRows(force).catch(function(){return {species:[],forms:[]};})
        ]);
        var combined = window.POKEDEX_REPOSITORY
          ? window.POKEDEX_REPOSITORY.mergePublicRows({species:data[0],forms:data[1]},data[3])
          : {species:data[0],forms:data[1]};
        var entries = build(combined.species,combined.forms,data[2]);
        catalog = entries;
        online = true;
        lastError = '';
        cache = {species:combined.species,forms:combined.forms,customMegas:data[2],savedAt:Date.now()};
        writeCache(cache);
        status(catalogSummary()+' • catálogo online');
        render();
        if(typeof current!=='undefined' && current){
          var activeMatch=catalog.find(currentMatch);
          if(activeMatch && activeMatch.forms.some(function(f){return f.formType==='mega';})){
            addMegas(activeMatch,true);
          }
        }
        return catalog;
      } catch(err) {
        try {
          var files = await repositoryRows(force);
          var recovered = window.POKEDEX_REPOSITORY.mergePublicRows({species:cache.species||[],forms:cache.forms||[]},files);
          catalog = build(recovered.species,recovered.forms,cache.customMegas||[]);
        } catch(repositoryError) {/* O cache anterior continua disponível. */}
        lastError = err.message || 'Falha de conexão';
        online = false;
        status(catalog.length
          ? catalogSummary()+' em cache offline • '+lastError+' • registros podem estar desatualizados'
          : 'Banco indisponível: '+lastError);
        render();
        return catalog;
      } finally {busy=null;}
    })();
    return busy;
  }
  function findRemote(q) {
    var k=key(q);
    if(!k)return null;
    return catalog.find(function(s){
      if(s.megaOnly) return false;
      return [s.id,s.gmId,s.name,s.slug,s.dex==null?'':String(s.dex)]
        .some(function(a){return key(a)===k;});
    }) || null;
  }
  function currentMatch(species) {
    if (!species || typeof current==='undefined' || !current) return false;
    var api = current.apiData || {};
    var currentKeys = [current.name,api.speciesName,api.pokemonName,api.integratedSpeciesId,api.gmCatalogId]
      .map(key).filter(Boolean);
    var currentDex = Number(current.dex || api.pokemonId || 0);
    return [species.id,species.gmId,species.name,species.slug]
      .map(key).some(function(k){return currentKeys.indexOf(k)>=0;})
      || !!(species.dex && currentDex && Number(species.dex)===currentDex);
  }
  function addMegas(species,quiet) {
    if(!species || !currentMatch(species)) {
      if(!quiet) notify('Selecione primeiro um Pokémon correspondente à espécie.');
      return 0;
    }
    if (typeof ensurePage2Data!=='function' || typeof integratedFormToMega!=='function') return 0;
    ensurePage2Data(current);
    var gmForms=species.forms.filter(function(f){return f.formType==='mega';});
    var old=current.gimmicks.mega.customForms || [];
    var existing=old.filter(function(f){
      return !f.gmCatalogFormId ||
        (current.gimmicks.mega.active && current.gimmicks.mega.formName==='custom:'+f.id);
    });
    var mapped=gmForms.map(function(f){
      var form=integratedFormToMega(species,f);
      form.id='gm-mega-'+f.id;
      form.gmCatalogFormId=f.id;
      form.gmCatalogRevision=f.revision;
      form.source='Pokédex GM';
      return form;
    });
    mapped.forEach(function(f){
      if (!existing.some(function(e){return e.id===f.id;})) existing.push(f);
    });
    current.gimmicks.mega.customForms=existing;
    if(typeof renderCustomMegaOptions==='function') renderCustomMegaOptions();
    if(typeof saveState==='function') saveState();
    if(!quiet)notify(mapped.length+' Mega(s) registradas em Gimmicks.');
    return mapped.length;
  }
  function installHooks() {
    if (typeof findIntegratedCustomSpecies==='function') {
      originalFind = findIntegratedCustomSpecies;
      findIntegratedCustomSpecies = function(q){return findRemote(q) || originalFind(q);};
    }
    if (typeof openMegaGimmickModal==='function') {
      originalMegaModal=openMegaGimmickModal;
      openMegaGimmickModal=function() {
        /* MEGA_OPEN_REFRESH_V2
           Abre o modal imediatamente, mas sincroniza novamente o catálogo.
           Isso evita perder Megas criadas depois do cache local da ficha. */
        var args=arguments;
        var result=originalMegaModal.apply(this,args);
        var sync=function(){
          var match=catalog.find(currentMatch);
          if(match && match.forms.some(function(f){return f.formType==='mega';})){
            addMegas(match,true);
            if(typeof renderCustomMegaOptions==='function') renderCustomMegaOptions();
            var status=document.getElementById('megaGimmickStatus');
            var gmCount=match.forms.filter(function(f){return f.formType==='mega' && f.independentMega;}).length;
            if(status && gmCount){
              status.textContent=gmCount+' Mega(s) publicada(s) pela Pokédex GM sincronizada(s) com esta ficha.';
            }
          }
        };
        sync();
        Promise.resolve(refresh(true)).then(sync).catch(function(err){
          console.warn('Pokédex GM Mega sync:',err);
        });
        return result;
      };
    }
    if (typeof loadMegaOptions==='function') {
      originalLoadMegas=loadMegaOptions;
      loadMegaOptions=function(){
        var hasGmMega = !!(current && current.gimmicks && current.gimmicks.mega
          && current.gimmicks.mega.customForms.some(function(f){return f.gmCatalogFormId;}));
        if (hasGmMega && current.apiData && current.apiData.source==='IntegratedCustomSpecies') {
          var n=document.getElementById('megaGimmickStatus');
          var l=document.getElementById('megaOptionsList');
          if(n)n.textContent='Mega personalizada publicada pela Pokédex GM — selecione nas opções abaixo.';
          if(l)l.innerHTML='';
          return Promise.resolve();
        }
        var result = originalLoadMegas.apply(this,arguments);
        if(hasGmMega && result && typeof result.then==='function'){
          return result.then(function(value){
            if(typeof renderCustomMegaOptions==='function') renderCustomMegaOptions();
            return value;
          });
        }
        if(hasGmMega && typeof renderCustomMegaOptions==='function') renderCustomMegaOptions();
        return result;
      };
    }
  }
  function applySpecies(species, mode, formId) {
    if(!species || typeof applyIntegratedCustomSpecies!=='function')return;
    if(species.megaOnly){
      addMegas(species,false);
      return;
    }
    var selected=species, form=species.forms.find(function(f){return f.id===formId;});
    if(form && form.formType!=='mega') {
      selected=Object.assign({},species,{
        id:species.id+':'+form.id,name:form.name,types:form.types,baseStats:form.baseStats,
        ability:form.ability,image:form.image,forms:[],source:'Pokédex GM'
      });
    }
    if(mode==='current') {
      if(!window.confirm('Aplicar '+selected.name+' à ficha atual? Nível, Nature, itens e pontos investidos serão mantidos; dados de espécie e Ability serão atualizados.'))return;
    } else {
      if(typeof createBlankPokemon!=='function')return;
      createBlankPokemon();
    }
    try {
      applyIntegratedCustomSpecies(selected,{preserveInvested:mode==='current',syncCurrent:mode!=='current'});
      if(current && current.apiData) {
        current.apiData.gmCatalogId=species.gmId;
        current.apiData.gmCatalogRevision=species.revision;
        current.apiData.gmCatalogFormId=form ? form.id : '';
        current.apiData.source='IntegratedCustomSpecies';
      }
      if(typeof upsertSpeciesBank==='function' && typeof speciesTemplateFromPokemon==='function')
        upsertSpeciesBank(speciesTemplateFromPokemon(current));
      if(typeof saveState==='function')saveState();
      if(typeof setActiveSheetPage==='function')setActiveSheetPage('page1');
      document.getElementById('app')?.classList.remove('drawer-open');
      close();
    } catch(err) {notify('Falha ao importar: '+(err.message||err));console.error(err);}
  }
  function matchesFilters(s, form) {
    var input=document.getElementById('hhGmDexSearch');
    var filter=document.getElementById('hhGmDexFilter');
    var q=key(input && input.value);
    if (filter && filter.value!=='all' && s.classification!==filter.value)return false;
    if (!q)return true;
    return [s.name,s.slug,s.dex,s.classification].concat(form?[form.name,form.slug,form.formType].concat(form.types):[])
      .some(function(x){return key(x).includes(q);});
  }
  function renderSpecies(s) {
    var bst=Object.values(s.baseStats).reduce(function(a,b){return a+Number(b||0);},0);
    var image=art(s.image.dataUrl);
    var category={fakemon:'Fakemon',rework:'Rework',official:'Oficial'}[s.classification] || s.classification;
    var previous=s.evolution && (s.evolution.previous || s.evolution.evolvesFrom);
    var previousName=typeof previous==='string' ? previous.trim() : previous && previous.name;
    var stage=previousName ? 'Evolução' : 'Forma base';
    return '<article class="hh-gm-entry" data-species-id="'+esc(s.gmId)+'">'
      +'<div class="hh-gm-art"><span class="hh-gm-stage">'+stage+'</span>'
      +(image?'<img loading="lazy" src="'+esc(image)+'" alt="'+esc(s.name)+'">':'<div class="hh-gm-placeholder" aria-hidden="true">◓</div>')+'</div>'
      +'<div class="hh-gm-details"><div class="hh-gm-entry-top"><strong>'+esc(s.name)+'</strong>'
      +'<span>'+esc(category)+' · BST '+bst+' · '+dexLabel(s)+'</span></div>'
      +(s.types.length?'<div class="hh-gm-types">'+s.types.map(function(type){return '<span class="hh-gm-type">'+esc(type)+'</span>';}).join('')+'</div>':'')
      +(previousName?'<div class="hh-gm-sub">Evolui de '+esc(previousName)+'</div>':'')
      +(s.ability.name?'<div class="hh-gm-sub">Ability: '+esc(s.ability.name)+'</div>':'')
      +'<div class="hh-gm-buttons">'
      +'<button type="button" data-gm-create="'+esc(s.gmId)+'">＋ Nova ficha</button>'
      +'<button type="button" data-gm-apply="'+esc(s.gmId)+'">Aplicar à atual</button>'
      +'</div>'
      +'</div></article>';
  }
  function renderForm(entry) {
    var s=entry.species,f=entry.form;
    var bst=Object.values(f.baseStats).reduce(function(a,b){return a+Number(b||0);},0);
    var image=art(f.image.dataUrl || s.image.dataUrl);
    var label={mega:'Mega',alternate:'Forma alternativa',regional:'Forma regional',shiny:'Shiny',primal:'Primal',gigantamax:'Gigantamax',other:'Outra forma'}[f.formType] || f.formType;
    return '<article class="hh-gm-entry" data-species-id="'+esc(s.gmId)+'" data-form-id="'+esc(f.id)+'">'
      +'<div class="hh-gm-art"><span class="hh-gm-stage">'+esc(label)+'</span>'
      +(image?'<img loading="lazy" src="'+esc(image)+'" alt="'+esc(f.name)+'">':'<div class="hh-gm-placeholder" aria-hidden="true">◓</div>')+'</div>'
      +'<div class="hh-gm-details"><div class="hh-gm-entry-top"><strong>'+esc(f.name)+'</strong>'
      +'<span>'+dexLabel(s)+' · '+esc(s.name)+' · BST '+bst+'</span></div>'
      +'<div class="hh-gm-types">'+f.types.map(function(t){return '<span class="hh-gm-type">'+esc(t)+'</span>';}).join('')+'</div>'
      +(f.ability.name?'<div class="hh-gm-sub">Ability: '+esc(f.ability.name)+'</div>':'')
      +(f.formType==='mega'?'<div class="hh-gm-sub">Disponível em Gimmicks na ficha de '+esc(s.name)+'.</div>':'')
      +'<div class="hh-gm-buttons">'
      +(f.formType==='mega'
        ? (currentMatch(s)?'<button type="button" data-gm-mega="'+esc(s.gmId)+'">Registrar Mega</button>':'')
        : '<button type="button" data-gm-form="'+esc(s.gmId)+'" data-form-id="'+esc(f.id)+'">＋ Nova ficha</button>')
      +'</div></div></article>';
  }
  function render() {
    var list=document.getElementById('hhGmDexList');
    if(!list)return;
    var sections=catalogSections(catalog);
    document.getElementById('hhGmDexSpeciesCount').textContent=sections.species.length;
    document.getElementById('hhGmDexFormsCount').textContent=sections.forms.length;
    document.querySelectorAll('[data-gm-section]').forEach(function(button){
      button.setAttribute('aria-pressed',String(button.getAttribute('data-gm-section')===activeSection));
    });
    var lines=evolutionLines(sections.species);
    var shown=activeSection==='forms'
      ? sections.forms.filter(function(entry){return matchesFilters(entry.species,entry.form);})
      : sections.species.filter(function(s){return matchesFilters(s);});
    var visibleLines=lines.filter(function(line){return line.members.some(function(s){return matchesFilters(s);});});
    var count=document.getElementById('hhGmDexCount');
    if(count)count.textContent=activeSection==='forms'
      ? shown.length+' forma(s)'
      : shown.length+' Pokémon · '+visibleLines.length+' linha(s)';
    if(!shown.length) {
      var available=activeSection==='forms'?sections.forms.length:sections.species.length;
      list.innerHTML='<div class="hh-gm-empty">'+(available
        ? 'Nenhum registro corresponde à busca.'
        : online ? (activeSection==='forms'?'Nenhuma Mega ou forma extra disponível ainda.':'Nenhuma espécie extra disponível ainda.')
          : 'Conecte-se à internet para carregar os Pokémon extras.')+'</div>';
      return;
    }
    if(activeSection==='forms') {
      list.innerHTML='<div class="hh-gm-line-cards">'+shown.map(renderForm).join('')+'</div>';
      return;
    }
    list.innerHTML=lines.map(function(line){
      var members=line.members.filter(function(s){return matchesFilters(s);});
      if(!members.length)return '';
      var title=line.members[0].name;
      return '<section class="hh-gm-line" aria-label="Linha de '+esc(title)+'">'
        +'<header class="hh-gm-line-heading"><span class="hh-gm-line-number">'+dexLabel(line.first)+'</span>'
        +'<div><small>'+(line.members.length>1?'Linha evolutiva':'Registro')+'</small><h3>'+esc(title)+'</h3></div></header>'
        +'<div class="hh-gm-line-cards">'+members.map(renderSpecies).join('')+'</div></section>';
    }).join('');
  }
  function close() {
    var modal=document.getElementById('hhGmDexModal');
    if(!modal || modal.hidden)return;
    modal.hidden=true;
    if(previousOverflow!==null)document.body.style.overflow=previousOverflow;
    previousOverflow=null;
    if(previousFocus && previousFocus.isConnected)previousFocus.focus();
  }
  function open() {
    var modal=document.getElementById('hhGmDexModal');
    if(!modal)return;
    if(typeof setMobileToolsOpen==='function')setMobileToolsOpen(false);
    if(typeof setDrawerOpen==='function')setDrawerOpen(false);
    if(modal.hidden){
      previousFocus=document.activeElement;
      previousOverflow=document.body.style.overflow;
      document.body.style.overflow='hidden';
    }
    modal.hidden=false;
    render();
    refresh(true);
    // No celular, a lista abre sem acionar o teclado sobre os cartões.
    if(!window.matchMedia || !window.matchMedia('(max-width: 900px)').matches){
      document.getElementById('hhGmDexSearch')?.focus();
    }else document.getElementById('hhGmDexClose')?.focus({preventScroll:true});
  }
  function mount() {
    if(mounted)return;
    mounted=true;
    var overlay=document.createElement('div');
    overlay.id='hhGmDexModal';overlay.hidden=true;overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','hhGmDexTitle');
    overlay.innerHTML='<div class="hh-gm-panel">'
      +'<div class="hh-gm-header"><div class="hh-gm-lens" aria-hidden="true"></div><div class="hh-gm-heading">'
      +'<div class="hh-gm-leds" aria-hidden="true"><i></i><i></i><i></i></div>'
      +'<h2 id="hhGmDexTitle">Pokédex</h2><small>Heaven &amp; Hell · Pokémon extras</small></div>'
      +'<button type="button" class="hh-gm-close" id="hhGmDexClose" aria-label="Fechar Pokédex">×</button></div>'
      +'<div class="hh-gm-screen-frame"><div class="hh-gm-screen">'
      +'<div class="hh-gm-screen-top"><span>Banco de Pokémon</span><span id="hhGmDexCount">Carregando...</span></div>'
      +'<nav class="hh-gm-sections" aria-label="Seções da Pokédex">'
      +'<button type="button" data-gm-section="species" aria-pressed="true" aria-controls="hhGmDexList">Espécies <span id="hhGmDexSpeciesCount">0</span></button>'
      +'<button type="button" data-gm-section="forms" aria-pressed="false" aria-controls="hhGmDexList">Megas e formas <span id="hhGmDexFormsCount">0</span></button></nav>'
      +'<div class="hh-gm-tools"><input id="hhGmDexSearch" placeholder="Buscar nome, Dex ou forma..." aria-label="Buscar Pokémon">'
      +'<select id="hhGmDexFilter" aria-label="Filtrar catálogo"><option value="all">Todas as espécies</option><option value="fakemon">Fakemon</option><option value="rework">Reworks</option><option value="official">Oficiais</option></select>'
      +'<button type="button" id="hhGmDexRefresh">↻ Atualizar</button></div>'
      +'<div id="hhGmDexStatus" role="status">Carregando Pokémon extras...</div>'
      +'<div id="hhGmDexList"></div></div></div>'
      +'<div class="hh-gm-footer"><span>Linhas evolutivas · ordem do número da Pokédex</span></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click',function(e){
      if(e.target===overlay)close();
      var btn=e.target.closest('button');
      if(!btn)return;
      if(btn.hasAttribute('data-gm-section')) {
        activeSection=btn.getAttribute('data-gm-section');
        render();document.getElementById('hhGmDexList').scrollTop=0;return;
      }
      var id=btn.getAttribute('data-gm-create') || btn.getAttribute('data-gm-apply')
        || btn.getAttribute('data-gm-form') || btn.getAttribute('data-gm-mega');
      if(!id)return;
      var species=catalog.find(function(s){return s.gmId===id;});
      if(!species)return;
      if(btn.hasAttribute('data-gm-mega'))addMegas(species,false);
      else applySpecies(species,btn.hasAttribute('data-gm-apply')?'current':'new',btn.getAttribute('data-form-id'));
    });
    document.getElementById('hhGmDexClose').addEventListener('click',close);
    document.getElementById('hhGmDexSearch').addEventListener('input',render);
    document.getElementById('hhGmDexFilter').addEventListener('change',render);
    document.getElementById('hhGmDexRefresh').addEventListener('click',function(){refresh(true);});
    document.addEventListener('keydown',function(e){
      if(overlay.hidden)return;
      if(e.key==='Escape'){close();e.stopPropagation();}
      if(e.key==='Tab'){
        var focusable=Array.from(overlay.querySelectorAll('button,input,select,[tabindex="0"]')).filter(function(el){return !el.disabled && el.getClientRects().length;});
        var first=focusable[0],last=focusable[focusable.length-1];
        if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
      }
    });
    var top=document.getElementById('mobileToolsPanel');
    if(top){
      var button=document.createElement('button');
      button.type='button';button.className='btn';button.id='hhGmDexTopBtn';
      button.textContent='◓ Pokémon extras';button.title='Fakemon, reworks e Megas publicados';
      button.addEventListener('click',open);
      top.insertBefore(button,document.getElementById('newPokemonBtn') || null);
    }
    var registry=document.querySelector('.pokemon-registry-console');
    if(registry){
      var entry=document.createElement('button');
      entry.type='button';entry.className='btn';entry.id='hhGmDexRegistryBtn';
      entry.textContent='◓ Pokémon extras';entry.title='Buscar Pokémon publicados pela sua campanha';
      entry.style.cssText='margin:8px 0;max-width:100%;font-size:14px';
      entry.addEventListener('click',open);
      registry.appendChild(entry);
    }
  }
  async function start(){
    if(typeof applyIntegratedCustomSpecies!=='function'){
      console.warn('Pokédex GM: ficha V5.0 incompatível; integração não inicializada.');
      return;
    }
    installHooks();mount();
    var old=await readCache();
    if(old && Array.isArray(old.species) && Array.isArray(old.forms) && !online){
      try{cache=old;catalog=build(old.species,old.forms,old.customMegas||[]);status(catalogSummary()+' em cache offline • verificando atualizações...');render();}
      catch(err){console.warn('Cache GM inválido:',err);}
    }
    refresh(true);
  }
  window.HH_GM_CATALOG_BRIDGE={
    open:open,refresh:refresh,getCatalog:function(){return catalog.slice();},
    find:findRemote,registerMegas:addMegas,getStatus:function(){
      return {online:online,count:catalog.length,savedAt:cache.savedAt,lastError:lastError,
        independentMegas:Array.isArray(cache.customMegas)?cache.customMegas.length:0};
    },_evolutionLines:evolutionLines,_catalogSections:catalogSections,_adaptSpecies:adaptSpecies,_adaptForm:adaptForm,_adaptIndependentMega:adaptIndependentMega,_build:build
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
