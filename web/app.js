const STARTING_CASH = 100;
const MAX_HOLDINGS = 3;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "trendsy-demo-v1";

const instruments = [
  {id:"poland",name:"Polska",category:"Kraj",edition:"national",icon:"🇵🇱",price:12.4,change:8.2,owners:38,description:"Zainteresowanie Polską"},
  {id:"tusk",name:"Donald Tusk",category:"Osoba",edition:"national",icon:"👤",price:9.8,change:4.6,owners:24,description:"Polityka i życie publiczne"},
  {id:"gdansk",name:"Gdańsk",category:"Miejsce",edition:"national",icon:"🏙️",price:7.2,change:2.1,owners:9,description:"Miasto i region"},
  {id:"cop31",name:"COP31",category:"Wydarzenie",edition:"world",icon:"🌍",price:14.6,change:12.8,owners:31,description:"Szczyt klimatyczny"},
  {id:"taylor",name:"Taylor Swift",category:"Osoba",edition:"world",icon:"🎤",price:18.3,change:-1.4,owners:17,description:"Muzyka i popkultura"},
  {id:"japan",name:"Japonia",category:"Kraj",edition:"world",icon:"🇯🇵",price:11.1,change:3.7,owners:27,description:"Kraj i wydarzenia"},
  {id:"youth-olympics",name:"Młodzieżowe Igrzyska",category:"Wydarzenie",edition:"world",icon:"🏅",price:8.9,change:5.3,owners:14,description:"Sport międzynarodowy"},
  {id:"paris",name:"Paryż",category:"Miejsce",edition:"world",icon:"🗼",price:10.5,change:-2.2,owners:5,description:"Miasto i kultura"},
  {id:"lewandowski",name:"Robert Lewandowski",category:"Osoba",edition:"national",icon:"⚽",price:13.7,change:6.1,owners:21,description:"Sport i piłka nożna"}
];
const byId = id => instruments.find(item => item.id === id);
const money = value => value.toLocaleString("pl-PL",{minimumFractionDigits:2,maximumFractionDigits:2}) + " TR";
const initialState = () => ({cash:STARTING_CASH,holdings:[],lastExchangeAt:null,history:[]});
let invalidSavedState = false;
let state = loadState();
let activeFilter = "all";
let toastTimer;
let cooldownRefreshTimer;

function isValidSavedState(saved){
  if(!saved || typeof saved.cash !== "number" || !Number.isFinite(saved.cash) || saved.cash < 0) return false;
  if(!Array.isArray(saved.holdings) || saved.holdings.length > MAX_HOLDINGS) return false;
  if(saved.lastExchangeAt !== null && saved.lastExchangeAt !== undefined && (!Number.isFinite(saved.lastExchangeAt) || saved.lastExchangeAt < 0)) return false;
  if(saved.history !== undefined && !Array.isArray(saved.history)) return false;

  const ids = new Set();
  const categories = new Set();
  let nationalCount = 0;
  for(const holding of saved.holdings){
    const item = byId(holding?.id);
    if(!item || holding.units !== 1 || ids.has(holding.id)) return false;
    if(categories.has(item.category)) return false;
    ids.add(holding.id);
    categories.add(item.category);
    if(item.edition === "national") nationalCount++;
  }
  if(nationalCount > 1) return false;
  if(saved.holdings.length === MAX_HOLDINGS && nationalCount !== 1) return false;
  return true;
}

function loadState(){
  let raw;
  try{raw = localStorage.getItem(STORAGE_KEY);}catch{return initialState();}
  if(raw === null) return initialState();
  try{
    const saved = JSON.parse(raw);
    if(isValidSavedState(saved)) return {...initialState(),...saved,history:saved.history||[]};
  }catch{}
  invalidSavedState = true;
  try{localStorage.removeItem(STORAGE_KEY);}catch{}
  return initialState();
}
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{notify("Przeglądarka blokuje zapis. Zmiany pozostaną tylko do odświeżenia strony.");}}
function portfolioValue(){return state.cash + state.holdings.reduce((sum,h)=>sum+h.units*byId(h.id).price,0);}
function totalUnits(id){return state.holdings.find(h=>h.id===id)?.units||0;}
function hasNational(){return state.holdings.some(h=>byId(h.id).edition==="national");}
function hasOtherNational(exceptId){return state.holdings.some(h=>h.id!==exceptId && byId(h.id).edition==="national");}
function cooldownRemaining(){return state.lastExchangeAt ? Math.max(0,COOLDOWN_MS-(Date.now()-state.lastExchangeAt)) : 0;}
function scheduleCooldownRefresh(){
  clearTimeout(cooldownRefreshTimer);
  const remaining = cooldownRemaining();
  if(remaining > 0) cooldownRefreshTimer = setTimeout(()=>render(),remaining+50);
}
function formatRemaining(ms){const h=Math.floor(ms/3600000),m=Math.ceil((ms%3600000)/60000);return h+" godz. "+m+" min";}
function notify(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2600);}
function log(message,amount){state.history.unshift({message,amount,at:Date.now()});state.history=state.history.slice(0,8);}
function buy(id){
  const item=byId(id);
  if(state.holdings.length>=MAX_HOLDINGS){notify("Portfel jest pełny. Użyj opcji wymiany.");return;}
  if(state.holdings.length===MAX_HOLDINGS-1 && !hasNational() && item.edition!=="national"){notify("Ostatnie miejsce w portfelu musi zająć instrument edycji krajowej.");return;}
  if(item.edition==="national" && hasNational()){notify("Możesz mieć maksymalnie jeden instrument edycji krajowej.");return;}
  if(state.holdings.some(h=>byId(h.id).category===item.category)){notify("Możesz mieć tylko jeden instrument z kategorii: "+item.category+".");return;}
  if(state.cash<item.price){notify("Masz za mało wolnych środków.");return;}
  state.cash-=item.price;
  state.holdings.push({id,units:1});
  log("Kupiono "+item.name,-item.price);
  save();render();notify("Dodano "+item.name+" do portfela.");
}
function exchange(oldId,newId){
  if(state.holdings.length!==MAX_HOLDINGS){notify("Najpierw zbuduj pełny portfel z trzech instrumentów.");return;}
  const oldItem=byId(oldId),newItem=byId(newId);
  if(cooldownRemaining()>0){notify("Następna wymiana za "+formatRemaining(cooldownRemaining())+".");return;}
  if(oldId===newId){notify("Wybierz inny instrument.");return;}
  if(newItem.edition==="national" && hasOtherNational(oldId)){notify("Możesz mieć maksymalnie jeden instrument edycji krajowej.");return;}
  if(state.holdings.some(h=>h.id!==oldId && byId(h.id).category===newItem.category)){notify("Ta kategoria jest już w Twoim portfelu.");return;}
  const saleValue=totalUnits(oldId)*oldItem.price;
  const available=state.cash+saleValue;
  if(available<newItem.price){notify("Po sprzedaży nadal zabraknie środków.");return;}
  if(oldItem.edition==="national" && newItem.edition!=="national" && !state.holdings.some(h=>h.id!==oldId && byId(h.id).edition==="national")){notify("Musisz zachować co najmniej jeden instrument edycji krajowej.");return;}
  state.cash=available-newItem.price;
  state.holdings=state.holdings.filter(h=>h.id!==oldId);
  state.holdings.push({id:newId,units:1});
  state.lastExchangeAt=Date.now();
  log("Wymiana: "+oldItem.name+" → "+newItem.name,newItem.price-saleValue);
  save();render();notify("Wymieniono "+oldItem.name+" na "+newItem.name+".");
}
function startExchange(oldId){
  if(state.holdings.length!==MAX_HOLDINGS){notify("Wymiana będzie dostępna po zapełnieniu portfela.");return;}
  const oldItem=byId(oldId);
  if(cooldownRemaining()>0){notify("Następna wymiana za "+formatRemaining(cooldownRemaining())+".");return;}
  const candidates=instruments.filter(item=>item.id!==oldId && !state.holdings.some(h=>h.id!==oldId && byId(h.id).category===item.category) && !(item.edition==="national" && hasOtherNational(oldId)) && !(oldItem.edition==="national" && item.edition!=="national" && !state.holdings.some(h=>h.id!==oldId && byId(h.id).edition==="national")));
  const select=document.querySelector("#exchange-select");
  select.innerHTML=candidates.map(item=>'<option value="'+item.id+'">'+item.icon+' '+item.name+' · '+item.category+' · '+money(item.price)+'</option>').join("");
  document.querySelector("#exchange-description").textContent="Sprzedasz "+oldItem.name+" i kupisz wybrany instrument. Wymiana zablokuje kolejną zmianę składu portfela na 24 godziny.";
  const dialog=document.querySelector("#exchange-dialog");
  dialog.dataset.oldId=oldId;
  dialog.showModal();
}
document.querySelector("#cancel-exchange").addEventListener("click",()=>document.querySelector("#exchange-dialog").close());
document.querySelector("#exchange-form").addEventListener("submit",event=>{
  event.preventDefault();
  const dialog=document.querySelector("#exchange-dialog");
  const newId=document.querySelector("#exchange-select").value;
  const oldId=dialog.dataset.oldId;
  dialog.close();
  if(newId)exchange(oldId,newId);
});
function renderInstruments(){
  const list=document.querySelector("#instrument-list");
  const filtered=instruments.filter(item=>activeFilter==="all"||item.edition===activeFilter);
  list.innerHTML=filtered.map(item=>{
    const sameCategory=state.holdings.some(h=>byId(h.id).category===item.category);
    const full=state.holdings.length>=MAX_HOLDINGS;
    const needsNational=state.holdings.length===MAX_HOLDINGS-1 && !hasNational() && item.edition!=="national";
    const nationalLimit=item.edition==="national" && hasNational();
    const disabled=full||sameCategory||needsNational||nationalLimit||state.cash<item.price;
    const reason=full?"Portfel pełny":sameCategory?"Kategoria zajęta":needsNational?"Wymagany instrument krajowy":nationalLimit?"Limit: 1 krajowy":state.cash<item.price?"Za mało TR":"Kup 1 szt.";
    return '<article class="instrument"><div class="instrument-main"><span class="instrument-icon">'+item.icon+'</span><div><div class="instrument-name">'+item.name+'</div><div class="instrument-meta">'+item.category+' <span class="edition">· '+(item.edition==="national"?"Edycja krajowa":"Edycja światowa")+'</span></div></div></div><div class="price">'+money(item.price)+'<small>'+(item.change>=0?"+":"")+item.change.toFixed(1).replace(".",",")+'% · demo</small></div><button class="buy-button" data-buy="'+item.id+'" '+(disabled?'disabled title="'+reason+'"':'')+'>'+(disabled?reason:"Kup")+'</button></article>';
  }).join("");
  list.querySelectorAll("[data-buy]").forEach(button=>button.addEventListener("click",()=>buy(button.dataset.buy)));
}

function renderMarketRankings(){
  const lists=[
    {id:"fastest-risers",items:[...instruments].sort((x,y)=>y.change-x.change).slice(0,4),mode:"change"},
    {id:"most-held",items:[...instruments].sort((x,y)=>y.owners-x.owners).slice(0,4),mode:"owners"},
    {id:"biggest-falls",items:[...instruments].filter(x=>x.change<0).sort((x,y)=>x.change-y.change).slice(0,4),mode:"change"},
    {id:"least-held",items:[...instruments].sort((x,y)=>x.owners-y.owners).slice(0,4),mode:"owners"}
  ];
  for(const group of lists){
    const el=document.querySelector("#"+group.id);
    el.innerHTML=group.items.map((item,index)=>{
      const positive=item.change>=0;
      const metric=group.mode==="change"?(positive?"+":"")+item.change.toFixed(1).replace(".",",")+"%":item.owners+" graczy";
      const bar=group.mode==="change"?Math.min(100,Math.abs(item.change)/13*100):Math.min(100,item.owners/40*100);
      return '<div class="market-rank-row"><span class="market-rank-number">'+String(index+1).padStart(2,"0")+'</span><span class="market-rank-icon">'+item.icon+'</span><span class="market-rank-main"><b>'+item.name+'</b><span class="market-bar"><i style="width:'+bar+'%"></i></span></span><strong class="'+(group.mode==="change"?(positive?"positive":"negative"):"")+'">'+metric+'</strong></div>';
    }).join("")||'<p class="empty-small">Brak trendów w tej kategorii.</p>';
  }
}
function renderPortfolio(){
  const el=document.querySelector("#portfolio");
  if(!state.holdings.length){el.innerHTML='<div class="empty-state"><b>Twój portfel jest pusty.</b><br>Wybierz instrumenty z tablicy powyżej. Możesz kupić maksymalnie trzy instrumenty z różnych kategorii. Pełny portfel musi zawierać dokładnie jeden instrument edycji krajowej.</div>';return;}
  el.innerHTML=state.holdings.map(h=>{
    const item=byId(h.id),value=h.units*item.price;
    const previousValue=value/(1+item.change/100),delta=value-previousValue;
    const disabled=cooldownRemaining()>0;
    return '<article class="holding"><div class="instrument-main"><span class="instrument-icon">'+item.icon+'</span><div><div class="instrument-name">'+item.name+'</div><div class="instrument-meta">'+item.category+' · '+h.units+' szt.</div></div></div><div class="holding-value">'+money(value)+'<small>Wartość pozycji</small><em class="'+(delta>=0?'positive':'negative')+'">'+(delta>=0?'+':'−')+money(Math.abs(delta))+' ('+(delta>=0?'+':'')+item.change.toFixed(1).replace('.',',')+'%) / 24 h</em></div>'+(state.holdings.length===MAX_HOLDINGS?'<button class="exchange-button" data-exchange="'+item.id+'" '+(disabled?'disabled title="Wymiana dostępna za '+formatRemaining(cooldownRemaining())+'"':'')+'>Wymień ↗</button>':'<span class="muted">Zapełnij portfel</span>')+'</article>';
  }).join("");
  el.querySelectorAll("[data-exchange]").forEach(button=>button.addEventListener("click",()=>startExchange(button.dataset.exchange)));
}
function renderActivity(){
  const el=document.querySelector("#activity");
  if(!state.history.length){el.innerHTML='<p class="empty-small">Twoje transakcje pojawią się tutaj.</p>';return;}
  el.innerHTML=state.history.map(h=>'<div class="activity-item"><span>'+h.message+'<small>'+new Date(h.at).toLocaleString("pl-PL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+'</small></span><b>'+(h.amount>0?"+":"")+money(h.amount)+'</b></div>').join("");
}
function render(){
  const value=portfolioValue(),profit=value-STARTING_CASH,remaining=cooldownRemaining();
  document.querySelector("#total-value").innerHTML=money(value).replace(" TR",' <small>TR</small>');
  document.querySelector("#cash-value").innerHTML=money(state.cash).replace(" TR",' <small>TR</small>');
  document.querySelector("#holding-count").innerHTML=state.holdings.length+' <small>/ 3</small>';
  document.querySelector("#profit-value").innerHTML=(profit>=0?"+":"")+money(profit).replace(" TR",' <small>TR</small>');
  document.querySelector("#total-change").textContent=profit===0?"Twoje saldo początkowe":(profit>=0?"Wzrost wartości portfela":"Spadek wartości portfela");
  document.querySelector("#ranking-value").textContent=money(value);
  document.querySelector("#exchange-status").textContent=remaining>0?"Wymiana ponownie za "+formatRemaining(remaining):state.holdings.length?"Wymiana dostępna":"Możesz rozpocząć inwestowanie";
  renderMarketRankings();renderInstruments();renderPortfolio();renderActivity();
  scheduleCooldownRefresh();
}
document.querySelector("#filters").addEventListener("click",event=>{
  const button=event.target.closest("[data-filter]");if(!button)return;
  activeFilter=button.dataset.filter;
  document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===button));
  renderInstruments();
});
document.querySelector("#reset-button").addEventListener("click",()=>{
  if(confirm("Zresetować konto demo? Usunie to portfel i historię transakcji.")){state=initialState();save();render();notify("Konto demo zostało zresetowane.");}
});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)render();});
render();
if(invalidSavedState) notify("Poprzedni zapis nie spełnia aktualnych zasad gry. Konto demo zostało zresetowane.");
