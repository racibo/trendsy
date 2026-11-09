const STARTING_CASH = 100;
const MAX_HOLDINGS = 3;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "trendsy-demo-v1";

const instruments = [
  {id:"poland",name:"Polska",category:"Kraj",edition:"national",icon:"🇵🇱",price:12.4,change:8.2,description:"Zainteresowanie Polską"},
  {id:"tusk",name:"Donald Tusk",category:"Osoba",edition:"national",icon:"👤",price:9.8,change:4.6,description:"Polityka i życie publiczne"},
  {id:"gdansk",name:"Gdańsk",category:"Miejsce",edition:"national",icon:"🏙️",price:7.2,change:2.1,description:"Miasto i region"},
  {id:"cop31",name:"COP31",category:"Wydarzenie",edition:"world",icon:"🌍",price:14.6,change:12.8,description:"Szczyt klimatyczny"},
  {id:"taylor",name:"Taylor Swift",category:"Osoba",edition:"world",icon:"🎤",price:18.3,change:-1.4,description:"Muzyka i popkultura"},
  {id:"japan",name:"Japonia",category:"Kraj",edition:"world",icon:"🇯🇵",price:11.1,change:3.7,description:"Kraj i wydarzenia"},
  {id:"youth-olympics",name:"Młodzieżowe Igrzyska",category:"Wydarzenie",edition:"world",icon:"🏅",price:8.9,change:5.3,description:"Sport międzynarodowy"},
  {id:"paris",name:"Paryż",category:"Miejsce",edition:"world",icon:"🗼",price:10.5,change:-2.2,description:"Miasto i kultura"},
  {id:"lewandowski",name:"Robert Lewandowski",category:"Osoba",edition:"national",icon:"⚽",price:13.7,change:6.1,description:"Sport i piłka nożna"}
];
const byId = id => instruments.find(item => item.id === id);
const money = value => value.toLocaleString("pl-PL",{minimumFractionDigits:2,maximumFractionDigits:2}) + " TR";
const initialState = () => ({cash:STARTING_CASH,holdings:[],lastExchangeAt:null,history:[]});
let state = loadState();
let activeFilter = "all";
let toastTimer;

function loadState(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(saved && typeof saved.cash === "number" && Array.isArray(saved.holdings)) return saved;
  }catch{}
  return initialState();
}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function portfolioValue(){return state.cash + state.holdings.reduce((sum,h)=>sum+h.units*byId(h.id).price,0);}
function totalUnits(id){return state.holdings.find(h=>h.id===id)?.units||0;}
function hasNational(){return state.holdings.some(h=>byId(h.id).edition==="national");}
function cooldownRemaining(){return state.lastExchangeAt ? Math.max(0,COOLDOWN_MS-(Date.now()-state.lastExchangeAt)) : 0;}
function formatRemaining(ms){const h=Math.floor(ms/3600000),m=Math.ceil((ms%3600000)/60000);return h+" godz. "+m+" min";}
function notify(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2600);}
function log(message,amount){state.history.unshift({message,amount,at:Date.now()});state.history=state.history.slice(0,8);}
function buy(id){
  const item=byId(id);
  if(state.holdings.length>=MAX_HOLDINGS){notify("Portfel jest pełny. Użyj opcji wymiany.");return;}
  if(state.holdings.length===MAX_HOLDINGS-1 && !hasNational() && item.edition!=="national"){notify("Ostatnie miejsce w portfelu musi zająć instrument edycji krajowej.");return;}
  if(state.holdings.some(h=>byId(h.id).category===item.category)){notify("Możesz mieć tylko jeden instrument z kategorii: "+item.category+".");return;}
  if(state.cash<item.price){notify("Masz za mało wolnych środków.");return;}
  state.cash-=item.price;
  state.holdings.push({id,units:1});
  log("Kupiono "+item.name,-item.price);
  save();render();notify("Dodano "+item.name+" do portfela.");
}
function exchange(oldId,newId){
  const oldItem=byId(oldId),newItem=byId(newId);
  if(cooldownRemaining()>0){notify("Następna wymiana za "+formatRemaining(cooldownRemaining())+".");return;}
  if(oldId===newId){notify("Wybierz inny instrument.");return;}
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
  const oldItem=byId(oldId);
  if(cooldownRemaining()>0){notify("Następna wymiana za "+formatRemaining(cooldownRemaining())+".");return;}
  const candidates=instruments.filter(item=>item.id!==oldId && !state.holdings.some(h=>h.id!==oldId && byId(h.id).category===item.category) && !(oldItem.edition==="national" && item.edition!=="national" && !state.holdings.some(h=>h.id!==oldId && byId(h.id).edition==="national")));
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
    const disabled=full||sameCategory||needsNational||state.cash<item.price;
    const reason=full?"Portfel pełny":sameCategory?"Kategoria zajęta":needsNational?"Wymagany instrument krajowy":state.cash<item.price?"Za mało TR":"Kup 1 szt.";
    return '<article class="instrument"><div class="instrument-main"><span class="instrument-icon">'+item.icon+'</span><div><div class="instrument-name">'+item.name+'</div><div class="instrument-meta">'+item.category+' <span class="edition">· '+(item.edition==="national"?"Edycja krajowa":"Edycja światowa")+'</span></div></div></div><div class="price">'+money(item.price)+'<small>'+(item.change>=0?"+":"")+item.change.toFixed(1).replace(".",",")+'% · demo</small></div><button class="buy-button" data-buy="'+item.id+'" '+(disabled?'disabled title="'+reason+'"':'')+'>'+(disabled?reason:"Kup")+'</button></article>';
  }).join("");
  list.querySelectorAll("[data-buy]").forEach(button=>button.addEventListener("click",()=>buy(button.dataset.buy)));
}
function renderPortfolio(){
  const el=document.querySelector("#portfolio");
  if(!state.holdings.length){el.innerHTML='<div class="empty-state"><b>Twój portfel jest pusty.</b><br>Wybierz instrumenty z tablicy powyżej. Możesz kupić maksymalnie trzy, każdy z innej kategorii. Pamiętaj o co najmniej jednym instrumencie edycji krajowej.</div>';return;}
  el.innerHTML=state.holdings.map(h=>{
    const item=byId(h.id),value=h.units*item.price;
    const disabled=cooldownRemaining()>0;
    return '<article class="holding"><div class="instrument-main"><span class="instrument-icon">'+item.icon+'</span><div><div class="instrument-name">'+item.name+'</div><div class="instrument-meta">'+item.category+' · '+h.units+' szt.</div></div></div><div class="holding-value">'+money(value)+'<small>Wartość pozycji</small></div><button class="exchange-button" data-exchange="'+item.id+'" '+(disabled?'disabled title="Wymiana dostępna za '+formatRemaining(cooldownRemaining())+'"':'')+'>Wymień ↗</button></article>';
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
  renderInstruments();renderPortfolio();renderActivity();
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
render();
