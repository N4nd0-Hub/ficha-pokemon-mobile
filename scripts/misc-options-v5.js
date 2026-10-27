(function(){
  "use strict";
  const STORAGE_KEY="pokemon_hh_v5_misc_options_ui";
  function readState(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");
      return parsed&&typeof parsed==="object"?parsed:{};
    }catch(error){return {};}
  }
  function writeState(value){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(value||{}));}catch(error){}
  }
  function initialize(){
    const page=document.getElementById("page3");
    if(!page)return;
    const stored=readState();
    page.querySelectorAll(".misc-option-panel").forEach(function(panel){
      if(panel.dataset.miscCollapseBound==="true")return;
      const key=panel.dataset.miscKey||"";
      const body=panel.querySelector(":scope > .panel-body");
      const button=panel.querySelector(":scope > .panel-head .misc-option-toggle");
      if(!key||!body||!button)return;
      panel.dataset.miscCollapseBound="true";
      function apply(collapsed){
        panel.classList.toggle("collapsed",collapsed);
        body.hidden=collapsed;
        button.setAttribute("aria-expanded",String(!collapsed));
        button.innerHTML=collapsed
          ? "<span>＋</span><small>EXPANDIR</small>"
          : "<span>−</span><small>RECOLHER</small>";
      }
      apply(!!stored[key]);
      button.addEventListener("click",function(event){
        event.preventDefault();
        event.stopPropagation();
        const next=!panel.classList.contains("collapsed");
        const state=readState();
        state[key]=next;
        writeState(state);
        apply(next);
      });
    });
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",initialize,{once:true});
  }else{
    initialize();
  }
})();