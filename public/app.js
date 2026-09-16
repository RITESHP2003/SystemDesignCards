/**
 * SystemDesignCards v8 — All 10 gamification improvements
 */
(function(){
"use strict";
const $=s=>document.getElementById(s);
const XP_RANKS=[{min:0,name:"Novice"},{min:50,name:"Apprentice"},{min:200,name:"Engineer"},{min:500,name:"Architect"},{min:1200,name:"Principal"},{min:3000,name:"Fellow"}];
const STREAK_MILESTONES=[7,14,30,60,100,200,365];
const LEVEL_THRESHOLDS={2:20,3:50,4:100};
const XP_MAP={1:0,2:1,3:2,4:3};

let allCards=[],cardState={},gam={xp:0,streak:0,lastStudyDate:null,unlockedLevels:[1,2],seenMilestones:[]},settings={theme:"dark",newPerDay:10};
let studyQueue=[],studyIndex=0,sessionStats={reviewed:0,correct:0,xpEarned:0},selectedLevel="all",savedCards=new Set();
let readBook="vol1",readPage=1,readManifests={},readInit=false;

// ═══ PERSISTENCE ═══
function loadState(){try{
  const s=localStorage.getItem("sdc-state");if(s)cardState=JSON.parse(s);
  const g=localStorage.getItem("sdc-gam");if(g)gam={...gam,...JSON.parse(g)};
  const st=localStorage.getItem("sdc-settings");if(st)settings={...settings,...JSON.parse(st)};
  const sv=localStorage.getItem("sdc-saved");if(sv)savedCards=new Set(JSON.parse(sv));
}catch{}}
function save(){
  localStorage.setItem("sdc-state",JSON.stringify(cardState));
  localStorage.setItem("sdc-gam",JSON.stringify(gam));
  localStorage.setItem("sdc-settings",JSON.stringify(settings));
  localStorage.setItem("sdc-saved",JSON.stringify([...savedCards]));
}

// ═══ SM-2 ═══
function sm2(st,rating){
  let{ef,interval:iv,repetitions:r}=st;ef=ef||2.5;iv=iv||0;r=r||0;
  if(rating<2){r=0;iv=0}else{iv=r===0?1:r===1?3:Math.round(iv*ef);r++}
  const q=rating+1;ef=Math.max(1.3,ef+(0.1-(5-q)*(0.08+(5-q)*0.02)));
  const d=new Date();d.setDate(d.getDate()+Math.max(iv,0));
  return{ef,interval:iv,repetitions:r,nextReview:d.toISOString(),status:r>=3&&iv>=7?"mastered":r>0?"learning":"new"};
}

// ═══ GAMIFICATION ═══
function getRank(){return[...XP_RANKS].reverse().find(r=>gam.xp>=r.min)||XP_RANKS[0]}
function updateStreak(){
  const t=new Date().toISOString().split("T")[0],y=new Date(Date.now()-864e5).toISOString().split("T")[0];
  if(gam.lastStudyDate===t)return;
  gam.streak=gam.lastStudyDate===y?gam.streak+1:1;
  gam.lastStudyDate=t;save();
  checkStreakMilestone();
}
function checkStreakMilestone(){
  for(const m of STREAK_MILESTONES){
    if(gam.streak>=m&&!gam.seenMilestones.includes(m)){
      gam.seenMilestones.push(m);save();
      showMilestone(m);return;
    }
  }
}
function showMilestone(days){
  const icons={7:"🔥",14:"⚡",30:"🏆",60:"💎",100:"👑",200:"🌟",365:"🎯"};
  $("milestone-icon").textContent=icons[days]||"🏆";
  $("milestone-text").textContent=`${days}-Day Streak!`;
  $("milestone-toast").classList.remove("dismissed");
  if(navigator.vibrate)navigator.vibrate([100,50,100]);
  setTimeout(()=>$("milestone-toast").classList.add("dismissed"),3000);
}
function addXP(rating){
  const xp=XP_MAP[rating]||0;if(!xp)return 0;
  gam.xp+=xp;save();
  $("xp-popup").textContent=`+${xp} XP`;$("xp-popup").classList.remove("dismissed");
  setTimeout(()=>$("xp-popup").classList.add("dismissed"),600);
  return xp;
}
function checkLevelUnlock(){
  const mastered=Object.values(cardState).filter(s=>s.status==="mastered").length;
  for(const[lv,th] of Object.entries(LEVEL_THRESHOLDS)){
    const n=parseInt(lv);
    if(mastered>=th&&!gam.unlockedLevels.includes(n)){
      gam.unlockedLevels.push(n);save();
      const names={2:"Core Patterns",3:"Real Systems",4:"Expert"};
      $("toast-text").textContent=`🎉 Level ${n}: ${names[n]}!`;
      $("level-toast").classList.remove("dismissed");
      setTimeout(()=>$("level-toast").classList.add("dismissed"),3000);
    }
  }
}
function getDailyCount(){const k=`sdc-today-${new Date().toISOString().split("T")[0]}`;return parseInt(localStorage.getItem(k)||"0",10)}
function incDailyCount(){const k=`sdc-today-${new Date().toISOString().split("T")[0]}`;localStorage.setItem(k,String(getDailyCount()+1))}
function updateDailyGoal(){
  const done=getDailyCount(),goal=settings.newPerDay;
  const pct=Math.min(100,Math.round(done/goal*100));
  $("daily-goal-fill").style.width=pct+"%";
  $("daily-goal-text").textContent=`${done}/${goal}`;
}

// ═══ CONFETTI ═══
function fireConfetti(){
  const canvas=$("confetti"),ctx=canvas.getContext("2d");
  canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  const pieces=[];const colors=["#6c5ce7","#00d2a0","#ffd93d","#ff8c42","#ff5252","#a29bfe"];
  for(let i=0;i<80;i++)pieces.push({x:canvas.width/2,y:canvas.height/2,vx:(Math.random()-.5)*12,vy:Math.random()*-14-4,color:colors[i%colors.length],size:Math.random()*6+3,life:1});
  let frame=0;
  function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);let alive=false;
    for(const p of pieces){if(p.life<=0)continue;alive=true;p.x+=p.vx;p.y+=p.vy;p.vy+=.4;p.life-=.015;
      ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}
    ctx.globalAlpha=1;if(alive&&frame++<120)requestAnimationFrame(draw);else ctx.clearRect(0,0,canvas.width,canvas.height);}
  draw();
}

// ═══ ONBOARDING ═══
function showOnboarding(){
  if(localStorage.getItem("sdc-onboarded"))return false;
  $("onboarding").classList.remove("hidden");$("loader").style.opacity="0";$("loader").style.pointerEvents="none";
  let slide=0;
  function goSlide(n){
    document.querySelectorAll(".onboard-slide").forEach(s=>s.classList.add("hidden"));
    document.querySelector(`[data-slide="${n}"]`).classList.remove("hidden");
    document.querySelectorAll(".dot").forEach((d,i)=>d.classList.toggle("active",i===n));
    $("onboard-next").textContent=n===2?"Let's Go!":"Next";
  }
  $("onboard-next").addEventListener("click",()=>{if(slide<2){slide++;goSlide(slide)}else finishOnboarding()});
  $("onboard-skip").addEventListener("click",finishOnboarding);
  return true;
}
function finishOnboarding(){localStorage.setItem("sdc-onboarded","1");$("onboarding").classList.add("hidden");startApp()}

// ═══ DATA LOADING ═══
async function loadCards(){
  $("loader").style.opacity="1";$("loader").style.pointerEvents="auto";$("loader").style.display="flex";
  const fill=$("loader").querySelector(".loader-fill");fill.style.width="30%";
  try{const r=await fetch("cards.json");allCards=await r.json()}catch{allCards=[]}
  fill.style.width="70%";loadState();
  for(const c of allCards)if(!cardState[c.id])cardState[c.id]={ef:2.5,interval:0,repetitions:0,nextReview:null,status:"new"};
  fill.style.width="100%";
}

// ═══ STUDY MODE ═══
function getStudyQueue(){
  const now=new Date(),maxNew=settings.newPerDay,usedNew=getDailyCount();
  let eligible=selectedLevel==="all"?allCards:allCards.filter(c=>c.level===parseInt(selectedLevel));
  eligible=eligible.filter(c=>gam.unlockedLevels.includes(c.level));
  const due=eligible.filter(c=>{const s=cardState[c.id];return s&&s.nextReview&&new Date(s.nextReview)<=now&&s.status!=="new"});
  const fresh=eligible.filter(c=>cardState[c.id]?.status==="new").slice(0,Math.max(0,maxNew-usedNew));
  return[...due,...fresh];
}
function startStudy(){
  studyQueue=getStudyQueue();
  if(!studyQueue.length){alert("No cards due! Come back later.");return}
  studyIndex=0;sessionStats={reviewed:0,correct:0,xpEarned:0};
  $("study-summary").classList.add("hidden");$("card-area").classList.remove("hidden");$("session-complete").classList.add("hidden");
  showCard();
}
function showCard(){
  if(studyIndex>=studyQueue.length){finishSession();return}
  const c=studyQueue[studyIndex],fc=$("flashcard");fc.classList.remove("flipped");
  fc.setAttribute("data-card-level",c.level);
  $("card-level-tag").textContent=`L${c.level}`;$("card-level-tag-back").textContent=`L${c.level}`;
  $("card-category").textContent=c.category;$("card-question").textContent=c.front;
  $("card-answer").textContent=c.back;$("card-source").textContent=c.source||"";
  const dEl=$("card-diagram");
  dEl.innerHTML=c.diagram_svg?`<img src="${c.diagram_svg}" alt="Diagram" class="diagram-img">`:c.diagram?`<pre>${esc(c.diagram)}</pre>`:"";
  $("rating-buttons").classList.add("hidden");
  $("card-counter").textContent=`${studyIndex+1}/${studyQueue.length}`;
  $("card-progress-fill").style.setProperty("--progress",`${studyIndex/studyQueue.length*100}%`);
}
function flipCard(){const f=$("flashcard");f.classList.toggle("flipped");$("rating-buttons").classList.toggle("hidden",!f.classList.contains("flipped"))}
function rateCard(rating){
  const c=studyQueue[studyIndex];cardState[c.id]=sm2(cardState[c.id],rating);
  sessionStats.reviewed++;if(rating>=3)sessionStats.correct++;sessionStats.xpEarned+=addXP(rating);
  incDailyCount();updateStreak();checkLevelUnlock();save();updateDailyGoal();
  if(navigator.vibrate&&rating>=3)navigator.vibrate(30);
  studyIndex++;showCard();
}
function finishSession(){
  $("card-area").classList.add("hidden");$("session-complete").classList.remove("hidden");
  $("session-stats").innerHTML=`Cards: ${sessionStats.reviewed}<br>Correct: ${sessionStats.correct}/${sessionStats.reviewed}<br>XP: ⚡${sessionStats.xpEarned}`;
  fireConfetti();updateAll();
}

// ═══ REELS MODE ═══
let reelFilter="all",reelBatch=0;
function initReels(){
  const container=$("reels-container");container.innerHTML="";reelBatch=0;
  buildReelFilters();loadMoreReels();
  container.addEventListener("scroll",()=>{
    if(container.scrollTop+container.clientHeight>=container.scrollHeight-200)loadMoreReels();
  },{passive:true});
}
function buildReelFilters(){
  const cats=["all",...new Set(allCards.filter(c=>gam.unlockedLevels.includes(c.level)).map(c=>c.category))].sort((a,b)=>a==="all"?-1:b==="all"?1:a.localeCompare(b));
  $("reels-filters").innerHTML=cats.map(c=>`<button class="filter-chip${c===reelFilter?" active":""}" data-cat="${c}">${c==="all"?"All":c}</button>`).join("");
  $("reels-filters").querySelectorAll(".filter-chip").forEach(btn=>btn.addEventListener("click",()=>{
    reelFilter=btn.dataset.cat;document.querySelectorAll(".filter-chip").forEach(b=>b.classList.remove("active"));btn.classList.add("active");
    $("reels-container").innerHTML="";reelBatch=0;loadMoreReels();
  }));
}
function loadMoreReels(){
  let eligible=allCards.filter(c=>gam.unlockedLevels.includes(c.level));
  if(reelFilter!=="all")eligible=eligible.filter(c=>c.category===reelFilter);
  const shuffled=[...eligible].sort(()=>Math.random()-.5);
  const batch=shuffled.slice(reelBatch*20,(reelBatch+1)*20);reelBatch++;
  for(const card of batch){
    const el=document.createElement("div");el.className="reel-card";
    const isNew=cardState[card.id]?.status==="new";const isSaved=savedCards.has(card.id);
    el.innerHTML=`<div class="reel-flashcard" data-card-level="${card.level}">
      ${isNew?'<div class="reel-new-badge">NEW</div>':""}
      <button class="reel-save-btn${isSaved?" saved":""}" data-id="${card.id}">${isSaved?"❤️":"🤍"}</button>
      <div class="card-level-tag">${"🟢🟡🟠🔴"[card.level-1]} L${card.level}</div>
      <div class="card-category" style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:4px 0 10px">${esc(card.category)}</div>
      <div class="card-question" style="font-size:.95rem;font-weight:600;line-height:1.5">${esc(card.front)}</div>
      <div class="card-hint" style="font-size:.7rem;color:var(--text-dim);text-align:center;margin-top:12px">Tap to reveal</div>
      <div class="card-answer">${esc(card.back)}${card.diagram_svg?`<img src="${card.diagram_svg}" alt="Diagram" class="diagram-img" style="margin-top:10px;max-width:100%;border-radius:8px;background:#fff">`:card.diagram?`<pre style="margin-top:10px;font-size:.65rem;color:var(--text-muted)">${esc(card.diagram)}</pre>`:""}</div>
    </div><div class="reel-page-label">${esc(card.source||"")}</div>`;
    el.querySelector(".reel-flashcard").addEventListener("click",function(e){if(!e.target.closest(".reel-save-btn"))this.classList.toggle("revealed")});
    el.querySelector(".reel-save-btn").addEventListener("click",function(e){
      e.stopPropagation();const id=this.dataset.id;
      if(savedCards.has(id)){savedCards.delete(id);this.textContent="🤍";this.classList.remove("saved")}
      else{savedCards.add(id);this.textContent="❤️";this.classList.add("saved");if(navigator.vibrate)navigator.vibrate(30)}
      save();
    });
    $("reels-container").appendChild(el);
  }
}

// ═══ SEARCH ═══
function initSearch(){
  const input=$("search-input"),results=$("search-results");
  let debounce;
  input.addEventListener("input",()=>{clearTimeout(debounce);debounce=setTimeout(()=>{
    const q=input.value.trim().toLowerCase();
    if(q.length<2){results.innerHTML="<p style='color:var(--text-dim);text-align:center;padding:2rem'>Type 2+ characters</p>";return}
    const matches=allCards.filter(c=>(c.front+c.back+c.category).toLowerCase().includes(q)).slice(0,30);
    results.innerHTML=matches.length?matches.map(c=>`<div class="search-result" data-id="${c.id}">
      <div class="sr-cat">${"🟢🟡🟠🔴"[c.level-1]} L${c.level} · ${esc(c.category)}</div>
      <div class="sr-q">${esc(c.front)}</div>
      <div class="sr-a">${esc(c.back)}</div></div>`).join(""):"<p style='color:var(--text-dim);text-align:center;padding:2rem'>No matches</p>";
  },200)});
  results.addEventListener("click",e=>{const r=e.target.closest(".search-result");if(r){$("search-panel").classList.add("hidden")}});
}

// ═══ READ MODE ═══
async function initRead(){
  const img=$("read-page-img"),slider=$("read-slider"),pn=$("read-page-num");
  async function manifest(b){if(readManifests[b])return readManifests[b];try{const r=await fetch(`book/${b}/manifest.json`);const m=await r.json();readManifests[b]=m;return m}catch{return null}}
  async function show(){const m=await manifest(readBook);if(!m)return;const t=m.total_pages;readPage=Math.max(1,Math.min(t,readPage));
    slider.max=t;slider.value=readPage;pn.textContent=`${readPage}/${t}`;
    img.classList.add("loading");img.onload=()=>img.classList.remove("loading");
    img.src=`book/${readBook}/page-${String(readPage).padStart(3,"0")}.webp`;
    localStorage.setItem(`sdc-read-${readBook}`,String(readPage))}
  if(!readInit){readInit=true;
    $("book-select").addEventListener("change",()=>{readBook=$("book-select").value;readPage=parseInt(localStorage.getItem(`sdc-read-${readBook}`)||"1",10);show()});
    $("read-prev").addEventListener("click",()=>{readPage--;show()});$("read-next").addEventListener("click",()=>{readPage++;show()});
    slider.addEventListener("input",()=>{pn.textContent=`${slider.value}/${slider.max}`});
    slider.addEventListener("change",()=>{readPage=parseInt(slider.value,10);show()});
    pn.addEventListener("click",async()=>{const m=await manifest(readBook);const p=prompt(`Go to page (1-${m?.total_pages||999}):`);if(p){const n=parseInt(p,10);if(n>=1)readPage=n;show()}});
  }
  readPage=parseInt(localStorage.getItem(`sdc-read-${readBook}`)||"1",10);show();
}

// ═══ UI UPDATES ═══
function updateAll(){updateSummary();updateTopBar();updateDailyGoal()}
function updateSummary(){
  const total=allCards.filter(c=>gam.unlockedLevels.includes(c.level)).length;
  const mastered=Object.values(cardState).filter(s=>s.status==="mastered").length;
  const q=getStudyQueue(),newC=allCards.filter(c=>cardState[c.id]?.status==="new"&&gam.unlockedLevels.includes(c.level)).length;
  const pct=total>0?Math.round(mastered/total*100):0;
  $("ring-pct").textContent=pct+"%";$("ring-progress").style.strokeDashoffset=327*(1-pct/100);
  $("stat-due").textContent=q.length;$("stat-new").textContent=newC;$("stat-mastered").textContent=mastered;
  document.querySelectorAll(".level-btn[data-level]").forEach(b=>{const l=b.dataset.level;if(l==="all")return;b.classList.toggle("locked",!gam.unlockedLevels.includes(parseInt(l)))});
  $("total-cards-count").textContent=allCards.length;
}
function updateTopBar(){
  $("streak-badge").textContent=`🔥 ${gam.streak}`;$("rank-badge").textContent=getRank().name;
}
function renderStats(){
  const mastered=Object.values(cardState).filter(s=>s.status==="mastered").length;
  const learning=Object.values(cardState).filter(s=>s.status==="learning").length;
  let h=`<div class="stat-grid">
    <div class="stat-card"><span class="stat-num">${gam.streak}</span><span class="stat-label">Day Streak</span></div>
    <div class="stat-card"><span class="stat-num">${gam.xp}</span><span class="stat-label">XP · ${getRank().name}</span></div>
    <div class="stat-card"><span class="stat-num">${mastered}</span><span class="stat-label">Mastered</span></div>
    <div class="stat-card"><span class="stat-num">${learning}</span><span class="stat-label">Learning</span></div></div>
    <h3 style="margin:12px 0 8px;font-size:.85rem">Level Progress</h3><div class="level-progress">`;
  const ln={1:"Foundations",2:"Core Patterns",3:"Real Systems",4:"Expert"},lc={1:"var(--green)",2:"var(--yellow)",3:"var(--orange)",4:"var(--red)"},li={1:"🟢",2:"🟡",3:"🟠",4:"🔴"};
  for(let l=1;l<=4;l++){const cards=allCards.filter(c=>c.level===l),m=cards.filter(c=>cardState[c.id]?.status==="mastered").length,p=cards.length?Math.round(m/cards.length*100):0;
    h+=`<div class="level-row"${gam.unlockedLevels.includes(l)?"":" style='opacity:.4'"}><span class="level-icon">${li[l]}</span><span style="font-size:.78rem;min-width:85px">${ln[l]}</span><div class="level-bar"><div class="level-bar-fill" style="width:${p}%;background:${lc[l]}"></div></div><span class="level-pct">${m}/${cards.length}</span></div>`}
  h+="</div>";$("stats-section").innerHTML=h;
  // Badges
  const badges=STREAK_MILESTONES.map(d=>({label:`${d}d 🔥`,earned:gam.seenMilestones.includes(d)}));
  $("badges-section").innerHTML=`<h3 style="margin:16px 0 8px;font-size:.85rem">🏅 Badges</h3><div class="badges-row">${badges.map(b=>`<span class="badge${b.earned?" earned":""}">${b.label}</span>`).join("")}</div>`;
}

// ═══ EVENTS ═══
function setupEvents(){
  $("flashcard").addEventListener("click",e=>{if(!e.target.closest(".flip-back-btn"))flipCard()});
  $("btn-flip-back").addEventListener("click",e=>{e.stopPropagation();$("flashcard").classList.remove("flipped");$("rating-buttons").classList.add("hidden")});
  $("btn-prev-card").addEventListener("click",()=>{if(studyIndex>0){studyIndex--;showCard()}});
  document.querySelectorAll(".rate-btn").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();rateCard(parseInt(b.dataset.rating))}));
  $("btn-start-study").addEventListener("click",startStudy);
  $("btn-more-cards").addEventListener("click",startStudy);
  $("btn-back-home").addEventListener("click",()=>{$("session-complete").classList.add("hidden");$("card-area").classList.add("hidden");$("study-summary").classList.remove("hidden");updateAll()});
  document.querySelectorAll(".mode-tab").forEach(t=>t.addEventListener("click",()=>{
    document.querySelectorAll(".mode-tab").forEach(x=>x.classList.remove("active"));t.classList.add("active");
    const m=t.dataset.mode;$("study-view").classList.toggle("hidden",m!=="study");$("reels-view").classList.toggle("hidden",m!=="reels");$("read-view").classList.toggle("hidden",m!=="read");
    if(m==="reels")initReels();if(m==="study")updateAll();if(m==="read")initRead();
  }));
  document.querySelectorAll(".level-btn").forEach(b=>b.addEventListener("click",()=>{if(b.classList.contains("locked"))return;document.querySelectorAll(".level-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");selectedLevel=b.dataset.level;updateSummary()}));
  $("btn-profile").addEventListener("click",()=>{renderStats();$("profile-panel").classList.remove("hidden");$("overlay").classList.remove("dismissed");$("theme-select").value=settings.theme;$("daily-new-select").value=settings.newPerDay});
  $("close-profile").addEventListener("click",closePanels);
  $("theme-select").addEventListener("change",()=>{settings.theme=$("theme-select").value;document.body.className=`theme-${settings.theme}`;save()});
  $("daily-new-select").addEventListener("change",()=>{settings.newPerDay=parseInt($("daily-new-select").value,10);save();updateAll()});
  $("btn-reset").addEventListener("click",()=>{if(confirm("Reset ALL progress?")){localStorage.clear();location.reload()}});
  $("overlay").addEventListener("click",closePanels);
  $("btn-search").addEventListener("click",()=>{$("search-panel").classList.remove("hidden");$("search-input").focus()});
  $("close-search").addEventListener("click",()=>$("search-panel").classList.add("hidden"));
  initSearch();
}
function closePanels(){$("profile-panel").classList.add("hidden");$("overlay").classList.add("dismissed")}
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}

// ═══ INIT ═══
async function startApp(){
  $("loader").style.opacity="1";$("loader").style.pointerEvents="auto";$("loader").style.display="flex";await loadCards();
  document.body.className=`theme-${settings.theme}`;updateAll();setupEvents();
  setTimeout(()=>{$("loader").style.opacity="0";$("loader").style.pointerEvents="none"},300);
}
async function init(){
  await loadCards();
  if(showOnboarding())return; // onboarding will call startApp when done
  document.body.className=`theme-${settings.theme}`;updateAll();setupEvents();
  setTimeout(()=>{$("loader").style.opacity="0";$("loader").style.pointerEvents="none"},300);
}
init();
})();
