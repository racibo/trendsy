import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = window.TRENDSY_CONFIG?.url || "";
const SUPABASE_ANON_KEY = window.TRENDSY_CONFIG?.anonKey || "";
const client = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const money = value => Number(value || 0).toLocaleString("pl-PL",{minimumFractionDigits:2,maximumFractionDigits:2}) + " TR";
let instruments = [];
let state = {cash:100, holdings:[], lastExchangeAt:null, history:[]};
let activeFilter = "all";
let currentUser = null;
let toastTimer;

const byId = id => instruments.find(item => item.id === id);
const notify = message => {
  const el=document.querySelector("#toast");
  el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove("show"),3200);
};
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function showAuth(message="Zaloguj się linkiem wysłanym na e-mail.") {
  document.querySelector("#auth-panel").hidden=false;
  document.querySelector("#game-content").hidden=true;
  document.querySelector("#auth-message").textContent=message;
  document.querySelector("#account-label").textContent="NIEZALOGOWANY";
  document.querySelector("#logout-button").hidden=true;
}
function showGame() {
  document.querySelector("#auth-panel").hidden=true;
  document.querySelector("#game-content").hidden=false;
  document.querySelector("#account-label").textContent=currentUser?.email || "ZALOGOWANO";
  document.querySelector("#logout-button").hidden=false;
}
async function sendMagicLink(event) {
  event.preventDefault();
  if(!client){notify("Brakuje konfiguracji Supabase. Uzupełnimy ją przed testem logowania.");return;}
  const email=document.querySelector("#login-email").value.trim();
  const button=document.querySelector("#login-button");
  button.disabled=true;button.textContent="Wysyłanie…";
  try {
    const {error}=await client.auth.signInWithOtp({
      email,
      options:{emailRedirectTo:window.location.origin + window.location.pathname}
    });
    if(error) throw error;
    document.querySelector("#auth-message").textContent="Wysłaliśmy link logowania. Otwórz wiadomość e-mail i kliknij link na tym urządzeniu.";
  } catch(error) {
    notify(error.message || "Nie udało się wysłać linku.");
  } finally {button.disabled=false;button.textContent="Wyślij link logowania";}
}
async function loadGame() {
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError) throw authError;
  currentUser=user;
  if(!user){showAuth();return;}
  showGame();
  const [catalog,portfolio,holdings,transactions,leaderboard,profile]=await Promise.all([
    client.from("instruments").select("id,name,category,edition,icon,price,price_source").eq("is_active",true).order("name"),
    client.from("portfolios").select("cash,last_exchange_at").eq("user_id",user.id).single(),
    client.from("holdings").select("instrument_id,units,acquired_at").eq("user_id",user.id),
    client.from("transactions").select("transaction_type,sold_instrument_id,bought_instrument_id,cash_delta,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(8),
    client.rpc("get_leaderboard",{p_limit:10}),
    client.from("profiles").select("display_name").eq("id",user.id).maybeSingle()
  ]);
  for(const result of [catalog,portfolio,holdings,transactions,leaderboard,profile]) if(result.error) throw result.error;
  instruments=catalog.data || [];
  state.cash=Number(portfolio.data.cash);
  state.lastExchangeAt=portfolio.data.last_exchange_at ? new Date(portfolio.data.last_exchange_at).getTime() : null;
  state.holdings=(holdings.data || []).map(h=>({id:h.instrument_id,units:h.units}));
  state.history=(transactions.data || []).map(t=>{
    const bought=byId(t.bought_instrument_id), sold=byId(t.sold_instrument_id);
    return {message:t.transaction_type==="exchange" ? "Wymiana: "+(sold?.name||"instrument")+" → "+(bought?.name||"instrument") : "Kupiono "+(bought?.name||"instrument"),amount:Number(t.cash_delta),at:new Date(t.created_at).getTime()};
  });
  render(leaderboard.data || [],profile.data?.display_name || user.email);
}
function portfolioValue(){return state.cash+state.holdings.reduce((sum,h)=>sum+h.units*Number(byId(h.id)?.price||0),0);}
function cooldownRemaining(){return state.lastExchangeAt?Math.max(0,86400000-(Date.now()-state.lastExchangeAt)):0;}
function formatRemaining(ms){return Math.floor(ms/3600000)+" godz. "+Math.ceil(ms%3600000/60000)+" min";}
async function buy(id){
  const {error}=await client.rpc("buy_instrument",{p_instrument_id:id});
  if(error){notify(error.message);return;}
  await loadGame();notify("Zakup zapisany na koncie.");
}
async function exchange(oldId,newId){
  const {error}=await client.rpc("exchange_instrument",{p_sell_instrument_id:oldId,p_buy_instrument_id:newId});
  if(error){notify(error.message);return;}
  await loadGame();notify("Wymiana zapisana na koncie.");
}
function startExchange(oldId){
  if(state.holdings.length!==3){notify("Wymiana jest dostępna po zapełnieniu portfela.");return;}
  if(cooldownRemaining()>0){notify("Następna wymiana za "+formatRemaining(cooldownRemaining())+".");return;}
  const oldItem=byId(oldId);
  const candidates=instruments.filter(item=>item.id!==oldId&&!state.holdings.some(h=>h.id!==oldId&&byId(h.id)?.category===item.category)&&!(item.edition==="national"&&state.holdings.some(h=>h.id!==oldId&&byId(h.id)?.edition==="national"))&&!(oldItem.edition==="national"&&item.edition!=="national"&&!state.holdings.some(h=>h.id!==oldId&&byId(h.id)?.edition==="national")));
  const select=document.querySelector("#exchange-select");
  select.innerHTML=candidates.map(item=>'<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.icon)+' '+escapeHtml(item.name)+' · '+escapeHtml(item.category)+' · '+money(item.price)+'</option>').join("");
  document.querySelector("#exchange-description").textContent="Sprzedasz "+oldItem.name+" i kupisz wybrany instrument. Kolejna wymiana będzie możliwa po 24 godzinach.";
  const dialog=document.querySelector("#exchange-dialog");dialog.dataset.oldId=oldId;dialog.showModal();
}
function render(leaderboard=[],displayName="Gracz"){
  const value=portfolioValue(),profit=value-100,remaining=cooldownRemaining();
  document.querySelector("#total-value").innerHTML=money(value).replace(" TR",' <small>TR</small>');
  document.querySelector("#cash-value").innerHTML=money(state.cash).replace(" TR",' <small>TR</small>');
  document.querySelector("#holding-count").innerHTML=state.holdings.length+' <small>/ 3</small>';
  document.querySelector("#profit-value").innerHTML=(profit>=0?"+":"")+money(profit).replace(" TR",' <small>TR</small>');
  document.querySelector("#total-change").textContent=profit===0?"Twoje saldo początkowe":profit>=0?"Wzrost wartości portfela":"Spadek wartości portfela";
  document.querySelector("#ranking-value").textContent=money(value);
  document.querySelector("#exchange-status").textContent=remaining>0?"Wymiana ponownie za "+formatRemaining(remaining):state.holdings.length?"Wymiana dostępna":"Możesz rozpocząć inwestowanie";
  renderInstruments();renderPortfolio();renderActivity();
  const ranking=document.querySelector("#ranking-list");
  ranking.innerHTML=leaderboard.length?leaderboard.map((row,index)=>'<div class="rank-row '+(row.display_name===displayName?'you':'')+'"><span class="rank-number">'+String(index+1).padStart(2,"0")+'</span><span class="rank-avatar '+(["purple","blue","green"][index%3])+'">'+escapeHtml(row.display_name.slice(0,2).toUpperCase())+'</span><span class="rank-name">'+escapeHtml(row.display_name)+'<small>Wartość portfela</small></span><b>'+money(row.portfolio_value)+'</b></div>').join(""):'<p class="empty-small">Ranking pojawi się, gdy gracze dołączą do gry.</p>';
  document.querySelector("#ranking-caption").textContent="Ranking rzeczywistych portfeli graczy.";
}
function renderInstruments(){
  const list=document.querySelector("#instrument-list");
  const filtered=instruments.filter(item=>activeFilter==="all"||item.edition===activeFilter);
  list.innerHTML=filtered.map(item=>{
    const sameCategory=state.holdings.some(h=>byId(h.id)?.category===item.category);
    const full=state.holdings.length>=3;
    const hasNational=state.holdings.some(h=>byId(h.id)?.edition==="national");
    const needsNational=state.holdings.length===2&&!hasNational&&item.edition!=="national";
    const nationalLimit=item.edition==="national"&&hasNational;
    const disabled=full||sameCategory||needsNational||nationalLimit||state.cash<Number(item.price);
    const reason=full?"Portfel pełny":sameCategory?"Kategoria zajęta":needsNational?"Wymagany instrument krajowy":nationalLimit?"Limit: 1 krajowy":state.cash<Number(item.price)?"Za mało TR":"Kup 1 szt.";
    return '<article class="instrument"><div class="instrument-main"><span class="instrument-icon">'+escapeHtml(item.icon)+'</span><div><div class="instrument-name">'+escapeHtml(item.name)+'</div><div class="instrument-meta">'+escapeHtml(item.category)+' <span class="edition">· '+(item.edition==="national"?"Edycja krajowa":"Edycja światowa")+'</span></div></div></div><div class="price">'+money(item.price)+'<small>'+escapeHtml(item.price_source)+'</small></div><button class="buy-button" data-buy="'+escapeHtml(item.id)+'" '+(disabled?'disabled title="'+reason+'"':'')+'>'+(disabled?reason:"Kup")+'</button></article>';
  }).join("");
  list.querySelectorAll("[data-buy]").forEach(button=>button.addEventListener("click",()=>buy(button.dataset.buy)));
}
function renderPortfolio(){
  const el=document.querySelector("#portfolio");
  if(!state.holdings.length){el.innerHTML='<div class="empty-state"><b>Twój portfel jest pusty.</b><br>Wybierz instrumenty z tablicy powyżej. Możesz kupić maksymalnie trzy instrumenty z różnych kategorii. Pełny portfel musi zawierać dokładnie jeden instrument edycji krajowej.</div>';return;}
  el.innerHTML=state.holdings.map(h=>{
    const item=byId(h.id);if(!item)return "";
    const disabled=cooldownRemaining()>0;
    return '<article class="holding"><div class="instrument-main"><span class="instrument-icon">'+escapeHtml(item.icon)+'</span><div><div class="instrument-name">'+escapeHtml(item.name)+'</div><div class="instrument-meta">'+escapeHtml(item.category)+' · '+h.units+' szt.</div></div></div><div class="holding-value">'+money(h.units*item.price)+'<small>Wartość pozycji</small></div>'+(state.holdings.length===3?'<button class="exchange-button" data-exchange="'+escapeHtml(item.id)+'" '+(disabled?'disabled':'')+'>Wymień ↗</button>':'<span class="muted">Zapełnij portfel</span>')+'</article>';
  }).join("");
  el.querySelectorAll("[data-exchange]").forEach(button=>button.addEventListener("click",()=>startExchange(button.dataset.exchange)));
}
function renderActivity(){
  const el=document.querySelector("#activity");
  if(!state.history.length){el.innerHTML='<p class="empty-small">Twoje transakcje pojawią się tutaj.</p>';return;}
  el.innerHTML=state.history.map(h=>'<div class="activity-item"><span>'+escapeHtml(h.message)+'<small>'+new Date(h.at).toLocaleString("pl-PL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+'</small></span><b>'+(h.amount>0?"+":"")+money(h.amount)+'</b></div>').join("");
}

document.querySelector("#login-form").addEventListener("submit",sendMagicLink);
document.querySelector("#logout-button").addEventListener("click",async()=>{
  const {error}=await client.auth.signOut();if(error){notify(error.message);return;}
  currentUser=null;showAuth("Wylogowano.");
});
document.querySelector("#filters").addEventListener("click",event=>{
  const button=event.target.closest("[data-filter]");if(!button)return;
  activeFilter=button.dataset.filter;
  document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===button));
  renderInstruments();
});
document.querySelector("#cancel-exchange").addEventListener("click",()=>document.querySelector("#exchange-dialog").close());
document.querySelector("#exchange-form").addEventListener("submit",async event=>{
  event.preventDefault();const dialog=document.querySelector("#exchange-dialog");
  const newId=document.querySelector("#exchange-select").value,oldId=dialog.dataset.oldId;dialog.close();
  if(newId)await exchange(oldId,newId);
});

if(!client){
  showAuth("Aplikacja jest przygotowana do logowania e-mail, ale wymaga jeszcze publicznego klucza anon/publishable z ustawień Supabase.");
} else {
  client.auth.onAuthStateChange((_event)=>{loadGame().catch(error=>{console.error(error);notify(error.message||"Nie udało się pobrać danych gry.");});});
  loadGame().catch(error=>{console.error(error);showAuth("Błąd połączenia z Supabase: "+error.message);});
}
