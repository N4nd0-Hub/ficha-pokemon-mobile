(function(){
  'use strict';
  window.HH_LOCAL_SAVE_UI={mount:function(config){
    const store=config.store;
    const button=document.createElement('button');
    button.id='hhLocalSaveButton';button.type='button';button.innerHTML='<i aria-hidden="true"></i><span>Preparando save…</span>';
    button.setAttribute('aria-label','Abrir central de save local');
    const blocker=document.createElement('div');blocker.id='hhLocalSaveLoading';blocker.setAttribute('role','status');blocker.textContent='Recuperando suas fichas e imagens…';
    const alertBox=document.createElement('div');alertBox.id='hhLocalSaveAlert';alertBox.hidden=true;alertBox.setAttribute('role','status');
    const dialog=document.createElement('dialog');dialog.id='hhLocalSaveDialog';dialog.setAttribute('aria-labelledby','hhLocalSaveTitle');
    dialog.innerHTML='<header><div><small>NESTE NAVEGADOR</small><h2 id="hhLocalSaveTitle">Seus saves</h2></div><button type="button" class="hh-save-close" aria-label="Fechar central de save">×</button></header>'
      +'<div class="hh-save-body"><p id="hhSaveSummary" role="status"></p>'
      +'<div class="hh-save-actions"><button type="button" data-save-action="save">Salvar agora</button><button type="button" data-save-action="export">Baixar JSON completo</button><button type="button" data-save-action="protect">Proteger armazenamento</button></div>'
      +'<p id="hhSaveProtection" class="hh-save-note"></p>'
      +'<div id="hhSaveProblems"></div><h3>Histórico e recuperação</h3><p class="hh-save-note">Cópias automáticas por minuto, além da versão anterior a importações, exclusões e restaurações. As artes acompanham cada versão.</p><div id="hhSaveHistory">Carregando versões…</div>'
      +'<p class="hh-save-note">O save fica neste navegador e aparelho. Baixe um JSON para levar suas fichas a outro dispositivo ou guardar uma cópia fora do navegador.</p></div>';
    document.body.append(button,blocker,alertBox,dialog);
    let currentStatus=store?.status()||{},loading=true,busy=false;
    const time=value=>value?new Date(value).toLocaleString('pt-BR'):'Ainda sem gravação confirmada';
    const text=(tag,content,className)=>{const el=document.createElement(tag);el.textContent=content;if(className)el.className=className;return el;};
    function setLoading(value){
      loading=value;blocker.hidden=!value;
      const locked=value||currentStatus.halted;
      document.getElementById('app').inert=!!locked;
      document.querySelector('.topbar').inert=!!locked;
    }
    function statusLabel(s){
      if(!s.ready)return 'Recuperando save…';
      if(s.halted)return 'Save pausado · abrir';
      if(s.conflict)return 'Conferir duas versões';
      if(s.error)return 'Falha ao salvar · abrir';
      if(s.saving)return 'Salvando…';
      if(s.dirty)return 'Alterações pendentes…';
      return s.savedAt?'Salvo às '+new Date(s.savedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Save local pronto';
    }
    function action(label,fn){const el=text('button',label);el.type='button';el.addEventListener('click',()=>run(fn));return el;}
    function renderStatus(s){
      currentStatus=s;
      button.querySelector('span').textContent=statusLabel(s);
      button.dataset.status=s.halted||s.conflict||s.error?'error':s.dirty||s.saving?'pending':'saved';
      const footer=document.getElementById('localSaveStatus');if(footer)footer.textContent=statusLabel(s);
      dialog.querySelector('#hhSaveSummary').textContent=(s.basic?'Modo básico de salvamento. ':'Save automático com imagens. ')+(s.savedAt?'Última gravação confirmada: '+time(s.savedAt)+'.':'Aguardando a primeira gravação confirmada.');
      alertBox.replaceChildren();
      alertBox.hidden=!(s.conflict||s.halted||s.error);
      if(!alertBox.hidden){
        alertBox.append(text('strong',s.conflict?'Existem duas versões da ficha':s.halted?'A recuperação do save precisa de atenção':'O save ainda não foi confirmado'));
        alertBox.append(text('p',s.error||'Abra a central de save para conferir suas versões.'));
        alertBox.append(action('Ver saves',open));
        if(s.conflict){alertBox.append(action('Carregar versão salva',loadOther),action('Manter esta aba',keepHere));}
        else if(s.halted){alertBox.append(action('Tentar novamente',config.retry));}
        else alertBox.append(action('Tentar salvar',saveNow));
      }
      const problems=dialog.querySelector('#hhSaveProblems');problems.replaceChildren();
      if(s.conflict){
        problems.append(text('p','Outra aba tem uma versão diferente. Você pode carregar a versão salva ou continuar com esta aba; a outra versão fica no histórico.'));
        problems.append(action('Carregar versão salva',loadOther),action('Manter esta aba',keepHere));
      }else if(s.halted){
        problems.append(text('p',s.error));
        problems.append(action('Tentar recuperar novamente',config.retry),action('Usar modo básico',async()=>{
          if(!confirm('O modo básico tem menos espaço para imagens. As cópias existentes serão preservadas. Continuar com as fichas disponíveis nesta tela?'))return;
          store.continueBasic();setLoading(false);await saveNow();
        }));
      }else if(s.error)problems.append(text('p',s.error));
      setLoading(loading);
    }
    async function run(fn){
      if(busy)return;busy=true;dialog.classList.add('hh-save-busy');
      try{await fn();}catch(error){config.notify(error.message||'Não foi possível concluir a operação.');}
      finally{busy=false;dialog.classList.remove('hh-save-busy');if(dialog.open)await history();}
    }
    async function saveNow(){
      const ok=await config.flush({reason:'Save manual'});
      config.notify(ok?'✓ Save completo confirmado neste navegador.':'O save ainda precisa de atenção. Baixe um JSON para guardar suas alterações.');
    }
    async function loadOther(){
      config.cancelPending();const value=await store.loadLatest(config.getState());config.applyState(value);config.notify('✓ Versão salva carregada. A cópia desta aba ficou no histórico.');
    }
    async function keepHere(){
      config.cancelPending();
      if(await store.saveNow(config.getState(),{force:true,reason:'Versão escolhida nesta aba'}))config.notify('✓ Esta versão foi salva. A versão da outra aba permanece no histórico.');
    }
    async function history(){
      const list=dialog.querySelector('#hhSaveHistory');list.replaceChildren();
      if(!store){list.textContent='O módulo de save não carregou. Recarregue a página com internet e mantenha seu JSON de backup.';return;}
      const records=await store.list();
      if(!records.length){list.textContent='O primeiro save aparecerá aqui depois de uma gravação confirmada.';return;}
      for(const record of records){
        const row=document.createElement('article');row.className='hh-save-version';
        const info=document.createElement('div');
        info.append(text('strong',time(record.savedAt)),text('small',(record.reason==='autosave'?'Save automático':record.reason||'Save')+' · '+record.pokemonCount+' Pokémon'));
        info.append(text('p',(Array.isArray(record.names)?record.names:[]).join(', ')));
        const controls=document.createElement('div');controls.className='hh-save-version-actions';
        controls.append(action('Restaurar',async()=>{
          const selected=await store.getVersion(record.id);
          if(!confirm('Restaurar esta versão? Sua ficha atual será guardada no histórico antes da troca.'))return;
          if(!await config.flush({reason:'Antes de restaurar uma versão',force:true}))throw new Error('Não foi possível preservar a ficha atual antes de restaurar.');
          if(!await store.saveNow(selected.state,{reason:'Restauração de versão'}))throw new Error('A restauração não foi gravada. A ficha atual foi preservada.');
          config.cancelPending();config.applyState(selected.state);config.notify('✓ Versão restaurada com as imagens. A anterior continua no histórico.');
        }),action('Baixar',async()=>{
          const selected=await store.getVersion(record.id);
          const blob=new Blob([JSON.stringify(selected.state,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
          a.href=url;a.download='pokemon-v5-save-'+new Date(record.savedAt).toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
        }));
        row.append(info,controls);list.append(row);
      }
    }
    async function protection(){
      const line=dialog.querySelector('#hhSaveProtection');
      try{line.textContent=await navigator.storage?.persisted?.()?'Armazenamento protegido contra limpeza automática por falta de espaço.':'Você pode pedir ao navegador que preserve os saves quando faltar espaço.';}catch{line.textContent='A proteção depende das opções deste navegador.';}
    }
    async function open(){if(!dialog.open)dialog.showModal();await history();await protection();}
    button.addEventListener('click',()=>run(open));
    dialog.querySelector('.hh-save-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.querySelector('[data-save-action="save"]').addEventListener('click',()=>run(saveNow));
    dialog.querySelector('[data-save-action="export"]').addEventListener('click',()=>run(config.export));
    dialog.querySelector('[data-save-action="protect"]').addEventListener('click',()=>run(async()=>{
      if(!navigator.storage?.persist){config.notify('Este navegador não oferece a proteção de armazenamento. Seus saves locais continuam disponíveis.');return;}
      const granted=await navigator.storage.persist();await protection();config.notify(granted?'✓ O navegador aprovou a proteção dos saves.':'O navegador não aprovou a proteção. Você ainda pode guardar um JSON completo.');
    }));
    if(store)store.subscribe(renderStatus);
    else renderStatus({ready:true,basic:true,error:'O módulo de save não carregou. Recarregue com internet ou baixe um JSON completo.'});
    setLoading(true);
    return {setLoading,open,refresh:history};
  }};
})();
