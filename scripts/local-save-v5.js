/* Save local da ficha V5.0. Sem rede: fichas, artes e versões ficam neste navegador. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HH_LOCAL_SAVE=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const FORMAT='hh-pokemon-save-1',ASSET='__hhSaveImage';
  const valid=value=>!!(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.pokemon)&&value.pokemon.length&&value.pokemon.every(p=>p&&typeof p==='object'&&!Array.isArray(p)));
  function digest(value){
    let a=2166136261,b=2246822507;
    for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),3266489909);}
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0')+'-'+value.length;
  }
  const clone=value=>JSON.parse(JSON.stringify(value));
  const problem=message=>Object.assign(new Error(message),{name:'SaveError'});
  function create(options={}){
    const env=options.env||globalThis;
    const namespace=options.namespace||'pokemon_hh_v5_local';
    const dbName=namespace+'_database',journalPrefix=namespace+':pending:';
    const legacy=options.legacy||{primary:'pokemon_rpg_sheet_v13',backup:'pokemon_rpg_sheet_v13_recovery',timestamp:'pokemon_rpg_sheet_v13_timestamp',database:'pokemon_rpg_sheet_recovery'};
    const now=options.now||Date.now;
    const writer=options.writer||Math.random().toString(36).slice(2)+'-'+now().toString(36);
    let storage;try{storage=options.storage||env.localStorage;}catch{}
    const idb=options.indexedDB||env.indexedDB;
    let dbPromise=null,db=null,baseId=null,sequence=0,generation=0,pending=null,running=null,timer=null;
    let ready=false,dirty=false,halted=false,conflict=false,basic=false,lastSavedAt=0,lastError='',destroyed=false;
    let lastJournalOK=false,source='default',knownLegacyTimestamp=0,legacyCheck=null;
    const knownAssets=new Set(),badAssets=new Set(),imageCache=new Map(),listeners=new Set();
    let channel=null;
    const status=()=>({ready,dirty,saving:!!running,halted,conflict,basic,savedAt:lastSavedAt,error:lastError,source,journalSaved:lastJournalOK});
    function emit(){const s=status();for(const fn of listeners){try{fn(s);}catch(e){console.error(e);}}options.onStatus?.(s);}
    const safeRead=key=>{try{return storage?.getItem(key)||null;}catch{return null;}};
    function imageId(value){
      if(imageCache.has(value))return imageCache.get(value);
      const id='image-'+digest(value);imageCache.set(value,id);
      if(imageCache.size>24)imageCache.delete(imageCache.keys().next().value);
      return id;
    }
    function encode(value,journal=false){
      if(!valid(value))throw problem('O save não contém fichas Pokémon válidas.');
      const assets=new Map();
      const json=JSON.stringify(value,(_,item)=>{
        if(typeof item==='string'&&/^data:image\//i.test(item)){
          const id=imageId(item);assets.set(id,item);
          return journal&&!knownAssets.has(id)?item:{[ASSET]:id};
        }
        return item;
      });
      return {json,checksum:digest(json),assets,pokemonCount:value.pokemon.length,names:value.pokemon.slice(0,4).map(p=>String(p.name||'Sem nome'))};
    }
    function makeRecord(encoded,reason='autosave'){
      const savedAt=now();
      return {format:FORMAT,id:savedAt.toString(36)+'-'+writer+'-'+(++sequence),savedAt,writer,basedOn:baseId,reason,legacyTimestamp:knownLegacyTimestamp,
        json:encoded.json,checksum:encoded.checksum,assetIds:[...encoded.assets.keys()],pokemonCount:encoded.pokemonCount,names:encoded.names};
    }
    function verify(record){
      if(!record||record.format!==FORMAT||typeof record.json!=='string'||digest(record.json)!==record.checksum)throw problem('Esta cópia do save está incompleta ou danificada.');
      const parsed=JSON.parse(record.json);if(!valid(parsed))throw problem('Esta cópia não contém fichas válidas.');return parsed;
    }
    function transaction(database,names,mode){
      if(mode==='readwrite'){try{return database.transaction(names,mode,{durability:'strict'});}catch{}}
      return database.transaction(names,mode);
    }
    function open(){
      if(dbPromise)return dbPromise;
      if(!idb)return Promise.reject(problem('O banco local não está disponível neste navegador.'));
      dbPromise=new Promise((resolve,reject)=>{
        let settled=false;
        const request=idb.open(dbName,1);
        const timeout=setTimeout(()=>finish(problem('O banco local demorou para abrir. Feche outras versões antigas da ficha e tente novamente.')),8000);
        function finish(error,value){if(settled){value?.close();return;}settled=true;clearTimeout(timeout);error?reject(error):resolve(value);}
        request.onupgradeneeded=()=>{
          const database=request.result;
          database.createObjectStore('heads');
          database.createObjectStore('history',{keyPath:'id'});
          database.createObjectStore('assets',{keyPath:'id'});
        };
        request.onsuccess=()=>{
          db=request.result;
          db.onversionchange=()=>{db.close();db=null;dbPromise=null;};
          finish(null,db);
        };
        request.onerror=()=>finish(request.error||problem('Não foi possível abrir o banco local.'));
        request.onblocked=()=>finish(problem('Outra aba está bloqueando a abertura do save. Feche a versão antiga e tente novamente.'));
      }).catch(error=>{dbPromise=null;throw error;});
      return dbPromise;
    }
    async function readAll(){
      const database=await open();
      return new Promise((resolve,reject)=>{
        const tx=transaction(database,['heads','history'],'readonly');
        const head=tx.objectStore('heads').get('current'),backup=tx.objectStore('heads').get('backup'),history=tx.objectStore('history').getAll(),seen=tx.objectStore('heads').get('legacySeen');
        tx.oncomplete=()=>resolve({head:head.result||null,backup:backup.result||null,history:history.result||[],legacySeen:seen.result||0});
        tx.onerror=tx.onabort=()=>reject(tx.error||problem('Não foi possível ler as cópias salvas.'));
      });
    }
    async function hydrate(record){
      verify(record);
      const needed=new Set();
      JSON.parse(record.json,(_,v)=>{if(v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v[ASSET]==='string')needed.add(v[ASSET]);return v;});
      const images=new Map();
      if(needed.size){
        const database=await open();
        await new Promise((resolve,reject)=>{
          const tx=transaction(database,['assets'],'readonly');
          for(const id of needed){const r=tx.objectStore('assets').get(id);r.onsuccess=()=>{if(r.result)images.set(id,r.result.data);};}
          tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||problem('Não foi possível recuperar as artes.'));
        });
        for(const id of needed){const data=images.get(id);if(typeof data!=='string'||'image-'+digest(data)!==id){badAssets.add(id);throw problem('Uma arte desta cópia está ausente ou danificada. Outra versão será preservada para recuperação.');}knownAssets.add(id);imageCache.set(data,id);}
      }
      return JSON.parse(record.json,(_,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v[ASSET]==='string'?images.get(v[ASSET]):v);
    }
    function journalRecords(){
      const records=[];
      try{
        for(let i=0;i<(storage?.length||0);i++){
          const key=storage.key(i);
          if(key?.startsWith(journalPrefix)||key===namespace+':fallback'||key===namespace+':fallback-backup'){
            try{const record=JSON.parse(storage.getItem(key));verify(record);records.push({...record,journalKey:key});}catch{}
          }
        }
      }catch{}
      return records;
    }
    function writeJournal(value){
      try{
        const record=makeRecord(encode(value,true),'Alterações recuperadas após fechamento');
        record.generation=generation;
        storage.setItem(journalPrefix+writer,JSON.stringify(record));lastJournalOK=true;
      }catch{lastJournalOK=false;}
      return lastJournalOK;
    }
    function clearJournal(record){
      try{
        const key=record?.journalKey||journalPrefix+writer,stored=JSON.parse(storage.getItem(key)||'null');
        if(stored&&(record?.journalKey?stored.id===record.id:stored.generation<=generation&&!pending))storage.removeItem(key);
      }catch{}
    }
    async function oldRecovery(){
      if(!idb||!legacy.database)return null;
      return new Promise(resolve=>{
        let settled=false;
        const done=value=>{if(!settled){settled=true;clearTimeout(timeout);resolve(value);}};
        const timeout=setTimeout(()=>done(null),2500);
        try{
          const req=idb.open(legacy.database);
          req.onupgradeneeded=()=>{req.transaction.abort();done(null);};
          req.onerror=req.onblocked=()=>done(null);
          req.onsuccess=()=>{
            const database=req.result;
            if(settled||!database.objectStoreNames.contains('snapshots')){database.close();done(null);return;}
            const tx=database.transaction('snapshots','readonly'),get=tx.objectStore('snapshots').get('latest');
            tx.oncomplete=()=>{database.close();done(get.result||null);};tx.onerror=tx.onabort=()=>{database.close();done(null);};
          };
        }catch{done(null);}
      });
    }
    function readLegacy(){
      const entries=[];
      for(const key of [legacy.primary,legacy.backup].filter(Boolean)){
        try{const value=JSON.parse(safeRead(key)||'null');if(valid(value))entries.push({state:value,savedAt:Number(safeRead(legacy.timestamp)||0),source:key===legacy.primary?'legacy':'legacy-backup'});}catch{}
      }
      return entries;
    }
    function loadSync(fallback){return clone(readLegacy()[0]?.state||fallback);}
    async function commit(encoded,{reason='autosave',force=false,archiveOnly=false,legacyTimestamp=0}={}){
      const database=await open(),record=makeRecord(encoded,reason);
      return new Promise((resolve,reject)=>{
        const tx=transaction(database,['heads','history','assets'],'readwrite');
        const heads=tx.objectStore('heads'),history=tx.objectStore('history'),assets=tx.objectStore('assets');
        const read=heads.get('current'),archive=heads.get('archiveAt');
        let outcome;
        archive.onsuccess=()=>{
          const current=read.result||null;
          record.revision=(current?.revision||0)+1;
          if(archiveOnly){history.put(record);heads.put(legacyTimestamp,'legacySeen');outcome={record,archived:true};}
          if(current&&current.checksum===record.checksum&&reason==='autosave'){outcome={record:current,identical:true};return;}
          if(!outcome&&current?.id!==baseId&&current){
            if(current.checksum===record.checksum){outcome={record:current,identical:true};return;}
            if(!force){record.reason='Conflito entre abas';history.put(record);outcome={record,conflict:true,current};}
          }
          if(!outcome){
            if(current){
              heads.put(current,'backup');
              if(reason!=='autosave'||record.savedAt-Number(archive.result||0)>=60000||current.pokemonCount!==record.pokemonCount){history.put(current);heads.put(record.savedAt,'archiveAt');}
            }
            heads.put(record,'current');outcome={record};
          }
          for(const [id,data] of encoded.assets){const check=assets.getKey(id);check.onsuccess=()=>{if(check.result===undefined||badAssets.has(id))assets.put({id,data});};}
          const all=history.getAll();
          all.onsuccess=()=>{
            const versions=all.result.sort((a,b)=>b.savedAt-a.savedAt),remove=versions.slice(18);
            remove.forEach(v=>history.delete(v.id));
            if(!remove.length)return;
            const live=new Set(versions.slice(0,18).flatMap(v=>v.assetIds||[]));
            for(const r of [current,record])for(const id of r?.assetIds||[])live.add(id);
            const allHeads=heads.getAll();allHeads.onsuccess=()=>{
              for(const r of allHeads.result)for(const id of r?.assetIds||[])live.add(id);
              const allKeys=assets.getAllKeys();allKeys.onsuccess=()=>{for(const id of allKeys.result)if(!live.has(id))assets.delete(id);};
            };
          };
        };
        tx.oncomplete=()=>resolve(outcome);
        tx.onerror=tx.onabort=()=>reject(tx.error||problem('O navegador não concluiu a gravação do save.'));
      });
    }
    async function basicCommit(encoded,reason){
      // Sem IndexedDB, a cópia alternativa precisa conter as artes completas.
      const record=makeRecord(encoded,reason),key=namespace+':fallback';
      const previous=safeRead(key);
      if(previous){try{storage.setItem(namespace+':fallback-backup',previous);}catch{}}
      storage.setItem(key,JSON.stringify(record));return {record};
    }
    function markDirty(){if(destroyed)return;generation++;dirty=true;emit();}
    function schedule(value,settings={}){
      if(!ready||halted||destroyed)return false;
      try{
        const encoded=encode(value,basic);
        pending={encoded,settings,generation:++generation};dirty=true;lastError='';writeJournal(value);
        clearTimeout(timer);if(!conflict)timer=setTimeout(()=>flush(),160);emit();return true;
      }catch(error){dirty=true;lastError=error.message;emit();return false;}
    }
    function announce(record){
      try{channel?.postMessage({id:record.id,writer});}catch{}
      try{storage?.setItem(namespace+':updated',JSON.stringify({id:record.id,writer,at:record.savedAt}));}catch{}
    }
    async function flush(){
      clearTimeout(timer);timer=null;
      if(running)return running;
      if(!ready||halted||conflict||!pending)return !dirty;
      running=(async()=>{
        while(pending&&!conflict&&!halted){
          const next=pending;pending=null;
          try{
            const outcome=basic?await basicCommit(next.encoded,next.settings.reason):await commit(next.encoded,next.settings);
            if(outcome.conflict){conflict=true;dirty=true;lastError='Outra aba salvou uma versão diferente. Suas alterações foram guardadas no histórico.';break;}
            baseId=outcome.record.id;lastSavedAt=outcome.record.savedAt;
            for(const id of next.encoded.assets.keys())knownAssets.add(id);
            dirty=!!pending||generation!==next.generation;
            if(!dirty)clearJournal();
            announce(outcome.record);
          }catch(error){pending=pending||next;dirty=true;lastError=error?.name==='QuotaExceededError'?'O espaço do navegador acabou. Exporte um JSON antes de continuar.':error.message||'Não foi possível salvar.';break;}
        }
        return !dirty;
      })();
      emit();
      try{return await running;}finally{running=null;emit();}
    }
    async function saveNow(value,settings={}){
      if(settings.force)conflict=false;
      if(!schedule(value,settings))return false;
      return flush();
    }
    async function list(){
      let records=[];try{const data=await readAll();records=[data.head,data.backup,...data.history].filter(Boolean);}catch{}
      records.push(...journalRecords());
      const unique=new Map(records.map(r=>[r.id,r]));
      return [...unique.values()].sort((a,b)=>b.savedAt-a.savedAt);
    }
    async function getVersion(id){const record=(await list()).find(r=>r.id===id);if(!record)throw problem('A versão selecionada não está disponível.');return {record,state:await hydrate(record)};}
    async function loadLatest(preserve){
      clearTimeout(timer);
      if(running)await running;
      if(preserve&&dirty){
        const outcome=await commit(encode(preserve),{reason:'Cópia desta aba antes de carregar outra versão'});
        if(!outcome.conflict){baseId=outcome.record.id;lastSavedAt=outcome.record.savedAt;}
      }
      const data=await readAll();
      if(!data.head)throw problem('Nenhum save principal disponível.');
      const value=await hydrate(data.head);
      pending=null;conflict=false;dirty=false;halted=false;baseId=data.head.id;lastSavedAt=data.head.savedAt;lastError='';
      clearJournal();emit();return value;
    }
    async function checkLegacy(data){
      if(legacyCheck)return legacyCheck;
      legacyCheck=(async()=>{
        const entry=readLegacy()[0];
        const seen=Math.max(knownLegacyTimestamp,Number(data.legacySeen||0),Number(data.head?.legacyTimestamp||0));
        knownLegacyTimestamp=seen;
        if(!data.head||!entry||entry.savedAt<=seen)return false;
        const encoded=encode(entry.state);
        await commit(encoded,{reason:'Save de uma aba com versão antiga',archiveOnly:true,legacyTimestamp:entry.savedAt});
        knownLegacyTimestamp=entry.savedAt;
        if(encoded.checksum!==data.head.checksum){
          conflict=true;lastError='Uma aba com a versão antiga gravou um save. A cópia foi preservada no histórico; confira as versões antes de continuar.';emit();return true;
        }
        return false;
      })();
      try{return await legacyCheck;}finally{legacyCheck=null;}
    }
    async function checkRemote(){
      if(!ready||halted||basic||destroyed)return;
      try{
        const data=await readAll();
        if(await checkLegacy(data))return;
        if(!data.head||data.head.id===baseId)return;
        if(dirty||pending||running){conflict=true;lastError='Há uma versão mais recente em outra aba. Escolha qual versão continuar usando.';emit();return;}
        const before=generation,value=await hydrate(data.head);
        if(dirty||generation!==before){conflict=true;emit();return;}
        baseId=data.head.id;lastSavedAt=data.head.savedAt;lastError='';
        options.onExternal?.(value);emit();
      }catch{}
    }
    async function boot(fallback){
      let data={head:null,backup:null,history:[]},failure=null;
      try{data=await readAll();}catch(error){failure=error;basic=!idb;}
      baseId=data.head?.id||null;
      const old=await oldRecovery();
      const legacyEntries=readLegacy();
      if(valid(old?.state))legacyEntries.unshift({state:old.state,savedAt:Number(old.savedAt||0),source:'old-recovery'});
      legacyEntries.sort((a,b)=>b.savedAt-a.savedAt);
      knownLegacyTimestamp=data.head?Math.max(Number(data.legacySeen||0),Number(data.head.legacyTimestamp||0)):Number(legacyEntries[0]?.savedAt||0);
      const journals=journalRecords();
      const records=[data.head,data.backup,...data.history].filter(Boolean);
      // Um rascunho de outra base continua no histórico, sem substituir um save novo.
      const eligible=journals.filter(r=>!data.head||r.basedOn===data.head.id||r.id===data.head.id||r.checksum===data.head.checksum);
      const candidates=[...records.map(record=>({record,savedAt:record.savedAt,source:record.id===data.head?.id?'database':'recovery'})),
        ...eligible.map(record=>({record,savedAt:record.savedAt,source:'journal'})),...legacyEntries];
      const followsHead=c=>c.source==='journal'&&(!data.head||c.record.basedOn===data.head.id)&&c.record.checksum!==data.head?.checksum;
      function priority(c){
        if(followsHead(c))return 0;
        if(c.source==='database')return 1;
        if(c.record?.id===data.backup?.id)return 2;
        if(c.source==='recovery')return 3;
        return 4;
      }
      // O ponteiro confirmado vale mais que o relógio do aparelho.
      candidates.sort((a,b)=>priority(a)-priority(b)||(b.record?.revision||0)-(a.record?.revision||0)||b.savedAt-a.savedAt);
      let selected=null,errors=0;
      for(const candidate of candidates){try{selected={...candidate,state:candidate.state||await hydrate(candidate.record)};break;}catch{errors++;}}
      source=selected?.source||'default';
      const value=clone(selected?.state||fallback);
      const legacyPresent=!!(safeRead(legacy.primary)||safeRead(legacy.backup));
      halted=!!(failure&&!basic||!selected&&(records.length||journals.length||legacyPresent));
      ready=true;lastSavedAt=selected?.savedAt||0;
      if(halted)lastError=failure?.message||'As cópias existentes precisam de recuperação. Elas foram preservadas; o save automático está pausado.';
      if(!halted&&selected&&selected.source!=='database'){
        const encoded=encode(value,basic);
        try{
          const outcome=basic?await basicCommit(encoded,'Recuperação do save anterior'):await commit(encoded,{reason:'Recuperação do save anterior'});
          if(outcome.conflict){conflict=true;lastError='Uma segunda aba salvou durante a recuperação. Escolha a versão que deseja usar.';}
          else {baseId=outcome.record.id;lastSavedAt=outcome.record.savedAt;for(const id of encoded.assets.keys())knownAssets.add(id);if(selected.record?.journalKey)clearJournal(selected.record);}
        }catch(error){halted=true;lastError=error.message;}
      }
      if(!basic&&!halted){
        try{await checkLegacy(data);}catch(error){conflict=true;lastError='Há uma gravação de uma aba antiga que não pôde ser arquivada. A cópia original foi preservada. '+error.message;}
        const stale=journals.some(r=>!eligible.includes(r)&&r.savedAt>(data.head?.savedAt||0));
        if(stale){conflict=true;lastError='Foi encontrada uma cópia de outra aba no histórico. Confira as versões antes de continuar.';}
      }
      emit();return {state:value,source,recovered:!!selected&&selected.source!=='database'&&selected.source!=='legacy',errors,halted};
    }
    function emergency(value){writeJournal(value);return lastJournalOK;}
    async function retry(fallback){halted=false;db?.close();db=null;dbPromise=null;return boot(fallback);}
    function destroy(){destroyed=true;clearTimeout(timer);channel?.close();db?.close();env.removeEventListener?.('storage',storageEvent);env.removeEventListener?.('focus',focusEvent);}
    function storageEvent(event){if(event.key===namespace+':updated'||event.key===legacy.primary||event.key===legacy.timestamp)checkRemote();}
    const focusEvent=()=>checkRemote();
    if(options.listen!==false){
      try{if(env.BroadcastChannel){channel=new env.BroadcastChannel(namespace);channel.onmessage=e=>{if(e.data?.writer!==writer)checkRemote();};}}catch{}
      env.addEventListener?.('storage',storageEvent);env.addEventListener?.('focus',focusEvent);
    }
    function continueBasic(){basic=true;halted=false;ready=true;lastError='';emit();}
    return {boot,loadSync,markDirty,schedule,flush,saveNow,list,getVersion,loadLatest,checkRemote,emergency,retry,continueBasic,destroy,status,
      subscribe(fn){listeners.add(fn);fn(status());return ()=>listeners.delete(fn);},validate:valid};
  }
  return {create,validate:valid,digest};
});
