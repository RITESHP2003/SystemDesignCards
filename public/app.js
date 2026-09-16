/**
 * SystemDesignCards v9 — 6 UX improvements
 * 1. Swipe gestures on study cards
 * 2. Category progress in study mode
 * 3. Better empty states
 * 4. Reels filter as dropdown
 * 5. Smooth page transitions (CSS)
 * 6. Better read mode — bottom controls + swipe
 */
(function(){
"use strict";
var $=function(s){return document.getElementById(s)};
var XP_RANKS=[{min:0,name:"Novice"},{min:50,name:"Apprentice"},{min:200,name:"Engineer"},{min:500,name:"Architect"},{min:1200,name:"Principal"},{min:3000,name:"Fellow"}];
var STREAK_MILESTONES=[7,14,30,60,100,200,365];
var LEVEL_THRESHOLDS={2:20,3:50,4:100};
var XP_MAP={1:0,2:1,3:2,4:3};
var MOTIVATIONAL_MESSAGES=[
  "🧘 Rest is part of the process. Your brain is consolidating what you learned!",
  "🌱 Great work today! Seeds planted now bloom in interviews.",
  "💪 Consistency beats intensity. See you tomorrow!",
  "🎯 You showed up and that's what matters. Keep the streak alive!",
  "🧠 Your spaced repetition is working. Trust the system!",
  "⭐ Another day of growth in the books. You're getting sharper!"
];

var allCards=[],cardState={},gam={xp:0,streak:0,lastStudyDate:null,unlockedLevels:[1,2],seenMilestones:[]},settings={theme:"dark",newPerDay:10};
var studyQueue=[],studyIndex=0,sessionStats={reviewed:0,correct:0,xpEarned:0},selectedLevel="all",savedCards=new Set();
var readBook="vol1",readPage=1,readManifests={},readInit=false;
var sessionSeenCategories={};

// ═══ PERSISTENCE ═══
function loadState(){try{
  var s=localStorage.getItem("sdc-state");if(s)cardState=JSON.parse(s);
  var g=localStorage.getItem("sdc-gam");if(g)gam=Object.assign({},gam,JSON.parse(g));
  var st=localStorage.getItem("sdc-settings");if(st)settings=Object.assign({},settings,JSON.parse(st));
  var sv=localStorage.getItem("sdc-saved");if(sv)savedCards=new Set(JSON.parse(sv));
}catch(e){/* ignore */}}
function save(){
  localStorage.setItem("sdc-state",JSON.stringify(cardState));
  localStorage.setItem("sdc-gam",JSON.stringify(gam));
  localStorage.setItem("sdc-settings",JSON.stringify(settings));
  localStorage.setItem("sdc-saved",JSON.stringify(Array.from(savedCards)));
}

// ═══ SM-2 ═══
function sm2(st,rating){
  var ef=st.ef||2.5,iv=st.interval||0,r=st.repetitions||0;
  if(rating<2){r=0;iv=0}else{iv=r===0?1:r===1?3:Math.round(iv*ef);r++}
  var q=rating+1;ef=Math.max(1.3,ef+(0.1-(5-q)*(0.08+(5-q)*0.02)));
  var d=new Date();d.setDate(d.getDate()+Math.max(iv,0));
  return{ef:ef,interval:iv,repetitions:r,nextReview:d.toISOString(),status:r>=3&&iv>=7?"mastered":r>0?"learning":"new"};
}

// ═══ GAMIFICATION ═══
function getRank(){var ranks=XP_RANKS.slice().reverse();for(var i=0;i<ranks.length;i++){if(gam.xp>=ranks[i].min)return ranks[i]}return XP_RANKS[0]}
function updateStreak(){
  var t=new Date().toISOString().split("T")[0],y=new Date(Date.now()-864e5).toISOString().split("T")[0];
  if(gam.lastStudyDate===t)return;
  gam.streak=gam.lastStudyDate===y?gam.streak+1:1;
  gam.lastStudyDate=t;save();
  checkStreakMilestone();
}
function checkStreakMilestone(){
  for(var i=0;i<STREAK_MILESTONES.length;i++){
    var m=STREAK_MILESTONES[i];
    if(gam.streak>=m&&gam.seenMilestones.indexOf(m)===-1){
      gam.seenMilestones.push(m);save();
      showMilestone(m);return;
    }
  }
}
function showMilestone(days){
  var icons={7:"🔥",14:"⚡",30:"🏆",60:"💎",100:"👑",200:"🌟",365:"🎯"};
  $("milestone-icon").textContent=icons[days]||"🏆";
  $("milestone-text").textContent=days+"-Day Streak!";
  $("milestone-toast").classList.remove("dismissed");
  if(navigator.vibrate)navigator.vibrate([100,50,100]);
  setTimeout(function(){$("milestone-toast").classList.add("dismissed")},3000);
}
function addXP(rating){
  var xp=XP_MAP[rating]||0;if(!xp)return 0;
  gam.xp+=xp;save();
  $("xp-popup").textContent="+"+xp+" XP";$("xp-popup").classList.remove("dismissed");
  setTimeout(function(){$("xp-popup").classList.add("dismissed")},600);
  return xp;
}
function checkLevelUnlock(){
  var mastered=0;var keys=Object.keys(cardState);for(var i=0;i<keys.length;i++){if(cardState[keys[i]].status==="mastered")mastered++}
  var entries=Object.entries(LEVEL_THRESHOLDS);
  for(var j=0;j<entries.length;j++){
    var n=parseInt(entries[j][0]);var th=entries[j][1];
    if(mastered>=th&&gam.unlockedLevels.indexOf(n)===-1){
      gam.unlockedLevels.push(n);save();
      var names={2:"Core Patterns",3:"Real Systems",4:"Expert"};
      $("toast-text").textContent="🎉 Level "+n+": "+names[n]+"!";
      $("level-toast").classList.remove("dismissed");
      setTimeout(function(){$("level-toast").classList.add("dismissed")},3000);
    }
  }
}
function getDailyCount(){var k="sdc-today-"+new Date().toISOString().split("T")[0];return parseInt(localStorage.getItem(k)||"0",10)}
function incDailyCount(){var k="sdc-today-"+new Date().toISOString().split("T")[0];localStorage.setItem(k,String(getDailyCount()+1))}
function updateDailyGoal(){
  var done=getDailyCount(),goal=settings.newPerDay;
  var pct=Math.min(100,Math.round(done/goal*100));
  $("daily-goal-fill").style.width=pct+"%";
  $("daily-goal-text").textContent=done+"/"+goal;
}

// ═══ STUDY HISTORY (for streak calendar) ═══
function recordStudyDay(){
  var dates=[];
  try{var d=localStorage.getItem("sdc-study-dates");if(d)dates=JSON.parse(d)}catch(e){/* ignore */}
  var today=new Date().toISOString().split("T")[0];
  if(dates.indexOf(today)===-1){dates.push(today);if(dates.length>90)dates=dates.slice(-90);localStorage.setItem("sdc-study-dates",JSON.stringify(dates))}
}
function getStudyDates(){
  try{var d=localStorage.getItem("sdc-study-dates");return d?JSON.parse(d):[]}catch(e){return[]}
}

// ═══ CONFETTI ═══
function fireConfetti(){
  var canvas=$("confetti"),ctx=canvas.getContext("2d");
  canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  var pieces=[];var colors=["#6c5ce7","#00d2a0","#ffd93d","#ff8c42","#ff5252","#a29bfe"];
  for(var i=0;i<80;i++)pieces.push({x:canvas.width/2,y:canvas.height/2,vx:(Math.random()-.5)*12,vy:Math.random()*-14-4,color:colors[i%colors.length],size:Math.random()*6+3,life:1});
  var frame=0;
  function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);var alive=false;
    for(var j=0;j<pieces.length;j++){var p=pieces[j];if(p.life<=0)continue;alive=true;p.x+=p.vx;p.y+=p.vy;p.vy+=.4;p.life-=.015;
      ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}
    ctx.globalAlpha=1;if(alive&&frame++<120)requestAnimationFrame(draw);else ctx.clearRect(0,0,canvas.width,canvas.height);}
  draw();
}

// ═══ ONBOARDING ═══
function showOnboarding(){
  if(localStorage.getItem("sdc-onboarded"))return false;
  $("onboarding").classList.remove("hidden");$("loader").style.opacity="0";$("loader").style.pointerEvents="none";
  var slide=0;
  function goSlide(n){
    var slides=document.querySelectorAll(".onboard-slide");for(var i=0;i<slides.length;i++)slides[i].classList.add("hidden");
    document.querySelector('[data-slide="'+n+'"]').classList.remove("hidden");
    var dots=document.querySelectorAll(".dot");for(var j=0;j<dots.length;j++)dots[j].classList.toggle("active",j===n);
    $("onboard-next").textContent=n===2?"Let's Go!":"Next";
  }
  $("onboard-next").addEventListener("click",function(){if(slide<2){slide++;goSlide(slide)}else finishOnboarding()});
  $("onboard-skip").addEventListener("click",finishOnboarding);
  return true;
}
function finishOnboarding(){localStorage.setItem("sdc-onboarded","1");$("onboarding").classList.add("hidden");startApp()}

// ═══ DATA LOADING ═══
function loadCards(){
  return new Promise(function(resolve){
    $("loader").style.opacity="1";$("loader").style.pointerEvents="auto";$("loader").style.display="flex";
    var fill=$("loader").querySelector(".loader-fill");fill.style.width="30%";
    fetch("cards.json").then(function(r){return r.json()}).then(function(data){allCards=data}).catch(function(){allCards=[]}).then(function(){
      fill.style.width="70%";loadState();
      for(var i=0;i<allCards.length;i++){var c=allCards[i];if(!cardState[c.id])cardState[c.id]={ef:2.5,interval:0,repetitions:0,nextReview:null,status:"new"}}
      fill.style.width="100%";resolve();
    });
  });
}

// ═══ STUDY MODE ═══
function getStudyQueue(){
  var now=new Date(),maxNew=settings.newPerDay,usedNew=getDailyCount();
  var eligible=selectedLevel==="all"?allCards:allCards.filter(function(c){return c.level===parseInt(selectedLevel)});
  eligible=eligible.filter(function(c){return gam.unlockedLevels.indexOf(c.level)!==-1});
  var due=eligible.filter(function(c){var s=cardState[c.id];return s&&s.nextReview&&new Date(s.nextReview)<=now&&s.status!=="new"});
  var fresh=eligible.filter(function(c){return cardState[c.id]&&cardState[c.id].status==="new"}).slice(0,Math.max(0,maxNew-usedNew));
  return due.concat(fresh);
}
function startStudy(){
  studyQueue=getStudyQueue();
  if(!studyQueue.length){alert("No cards due! Come back later.");return}
  studyIndex=0;sessionStats={reviewed:0,correct:0,xpEarned:0};sessionSeenCategories={};
  $("study-summary").classList.add("hidden");$("card-area").classList.remove("hidden");$("session-complete").classList.add("hidden");
  showCard();
}
function showCard(){
  if(studyIndex>=studyQueue.length){finishSession();return}
  var c=studyQueue[studyIndex],fc=$("flashcard");fc.classList.remove("flipped");
  fc.style.transform="";fc.style.opacity="";fc.classList.remove("fly-out","swipe-left","swipe-right","swipe-up","swiping");
  fc.setAttribute("data-card-level",c.level);
  $("card-level-tag").textContent="L"+c.level;$("card-level-tag-back").textContent="L"+c.level;
  $("card-category").textContent=c.category;$("card-question").textContent=c.front;
  $("card-answer").textContent=c.back;$("card-source").textContent=c.source||"";
  var dEl=$("card-diagram");
  dEl.innerHTML=c.diagram_svg?'<img src="'+c.diagram_svg+'" alt="Diagram" class="diagram-img">':c.diagram?'<pre>'+esc(c.diagram)+'</pre>':"";
  $("rating-buttons").classList.add("hidden");
  $("category-progress").classList.add("hidden");
  $("card-counter").textContent=(studyIndex+1)+"/"+studyQueue.length;
  $("card-progress-fill").style.setProperty("--progress",studyIndex/studyQueue.length*100+"%");
}
function flipCard(){
  var f=$("flashcard");
  f.classList.toggle("flipped");
  var isFlipped=f.classList.contains("flipped");
  $("rating-buttons").classList.toggle("hidden",!isFlipped);
  // Show category progress when flipped
  if(isFlipped){updateCategoryProgress()}else{$("category-progress").classList.add("hidden")}
}

// ── Category progress ──
function updateCategoryProgress(){
  var c=studyQueue[studyIndex];if(!c)return;
  var cat=c.category;
  var total=0,seen=0;
  for(var i=0;i<studyQueue.length;i++){
    if(studyQueue[i].category===cat){total++;if(i<studyIndex)seen++}
  }
  // Also count current as being viewed
  if(sessionSeenCategories[cat])seen=sessionSeenCategories[cat];
  var el=$("category-progress");
  el.textContent=cat+" "+(seen)+"/"+total+" seen";
  el.classList.remove("hidden");
}

function rateCard(rating){
  var c=studyQueue[studyIndex];cardState[c.id]=sm2(cardState[c.id],rating);
  // Track seen per category
  if(!sessionSeenCategories[c.category])sessionSeenCategories[c.category]=0;
  sessionSeenCategories[c.category]++;
  sessionStats.reviewed++;if(rating>=3)sessionStats.correct++;sessionStats.xpEarned+=addXP(rating);
  incDailyCount();updateStreak();recordStudyDay();checkLevelUnlock();save();updateDailyGoal();
  if(navigator.vibrate&&rating>=3)navigator.vibrate(30);
  studyIndex++;showCard();
}
function finishSession(){
  $("card-area").classList.add("hidden");$("session-complete").classList.remove("hidden");
  $("session-stats").innerHTML="Cards: "+sessionStats.reviewed+"<br>Correct: "+sessionStats.correct+"/"+sessionStats.reviewed+"<br>XP: ⚡"+sessionStats.xpEarned;
  fireConfetti();updateAll();
}

// ═══ SWIPE GESTURES ═══
function setupSwipeGestures(){
  var fc=$("flashcard");
  var startX=0,startY=0,dx=0,dy=0,isSwiping=false;
  var THRESHOLD=60;

  fc.addEventListener("touchstart",function(e){
    if(!fc.classList.contains("flipped"))return;
    var t=e.touches[0];startX=t.clientX;startY=t.clientY;dx=0;dy=0;isSwiping=true;
    fc.classList.add("swiping");
  },{passive:true});

  fc.addEventListener("touchmove",function(e){
    if(!isSwiping||!fc.classList.contains("flipped"))return;
    var t=e.touches[0];dx=t.clientX-startX;dy=t.clientY-startY;
    // Apply transform to card
    var rotate=dx*0.08;
    fc.style.transform="translateX("+dx+"px) translateY("+Math.min(dy,0)+"px) rotate("+rotate+"deg)";
    // Show indicators
    fc.classList.toggle("swipe-left",dx<-THRESHOLD/2);
    fc.classList.toggle("swipe-right",dx>THRESHOLD/2);
    fc.classList.toggle("swipe-up",dy<-THRESHOLD/2&&Math.abs(dy)>Math.abs(dx));
    e.preventDefault();
  },{passive:false});

  fc.addEventListener("touchend",function(){
    if(!isSwiping)return;
    isSwiping=false;
    fc.classList.remove("swiping");
    var absX=Math.abs(dx),absY=Math.abs(dy);
    // Determine swipe direction
    if(dy<-THRESHOLD&&absY>absX){
      // Swipe UP = Easy (4)
      flyOut(0,-1);rateCard(4);
    }else if(dx<-THRESHOLD&&absX>absY){
      // Swipe LEFT = Forgot (1)
      flyOut(-1,0);rateCard(1);
    }else if(dx>THRESHOLD&&absX>absY){
      // Swipe RIGHT = Good (3)
      flyOut(1,0);rateCard(3);
    }else{
      // Snap back
      fc.style.transform="";
      fc.classList.remove("swipe-left","swipe-right","swipe-up");
    }
  },{passive:true});

  function flyOut(dirX,dirY){
    fc.classList.add("fly-out");
    fc.style.transform="translateX("+(dirX*300)+"px) translateY("+(dirY*300)+"px) rotate("+(dirX*20)+"deg)";
    fc.classList.remove("swipe-left","swipe-right","swipe-up");
  }
}

// ═══ EMPTY STATE ═══
function showEmptyState(reviewed){
  var el=$("empty-state");el.classList.remove("hidden");
  // Motivational message
  var msgIdx=Math.floor(Math.random()*MOTIVATIONAL_MESSAGES.length);
  $("empty-message").textContent=MOTIVATIONAL_MESSAGES[msgIdx];
  // Streak calendar — last 7 days
  var studyDates=getStudyDates();
  var today=new Date();var calHtml="";
  var dayLabels=["S","M","T","W","T","F","S"];
  for(var i=6;i>=0;i--){
    var d=new Date(today);d.setDate(d.getDate()-i);
    var ds=d.toISOString().split("T")[0];
    var studied=studyDates.indexOf(ds)!==-1;
    var isToday=i===0;
    calHtml+='<div class="streak-dot'+(studied?" studied":"")+(isToday?" today":"")+'">'+dayLabels[d.getDay()]+'</div>';
  }
  $("streak-calendar").innerHTML=calHtml;
  // Tomorrow estimate
  var dueCount=0;var tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
  for(var j=0;j<allCards.length;j++){
    var s=cardState[allCards[j].id];
    if(s&&s.nextReview&&new Date(s.nextReview)<=tomorrow&&s.status!=="new")dueCount++;
  }
  $("empty-tomorrow").textContent="Come back tomorrow for ~"+dueCount+" review"+(dueCount!==1?"s":"");
}
function hideEmptyState(){$("empty-state").classList.add("hidden")}

// ═══ REELS MODE ═══
var reelFilter="all",reelBatch=0;
function initReels(){
  var container=$("reels-container");container.innerHTML="";reelBatch=0;
  buildReelFilters();loadMoreReels();
  container.addEventListener("scroll",function(){
    if(container.scrollTop+container.clientHeight>=container.scrollHeight-200)loadMoreReels();
  },{passive:true});
}
function buildReelFilters(){
  var catCounts={};
  var eligible=allCards.filter(function(c){return gam.unlockedLevels.indexOf(c.level)!==-1});
  for(var i=0;i<eligible.length;i++){
    var cat=eligible[i].category;
    catCounts[cat]=(catCounts[cat]||0)+1;
  }
  var cats=Object.keys(catCounts).sort();
  var sel=$("reels-filter-select");
  sel.innerHTML='<option value="all">All ('+eligible.length+')</option>';
  for(var j=0;j<cats.length;j++){
    var c=cats[j];
    var opt=document.createElement("option");
    opt.value=c;opt.textContent=c+" ("+catCounts[c]+")";
    if(c===reelFilter)opt.selected=true;
    sel.appendChild(opt);
  }
  sel.onchange=function(){
    reelFilter=sel.value;
    $("reels-container").innerHTML="";reelBatch=0;loadMoreReels();
  };
}
function loadMoreReels(){
  var eligible=allCards.filter(function(c){return gam.unlockedLevels.indexOf(c.level)!==-1});
  if(reelFilter!=="all")eligible=eligible.filter(function(c){return c.category===reelFilter});
  var shuffled=eligible.slice().sort(function(){return Math.random()-.5});
  var batch=shuffled.slice(reelBatch*20,(reelBatch+1)*20);reelBatch++;
  for(var i=0;i<batch.length;i++){
    var card=batch[i];
    var el=document.createElement("div");el.className="reel-card";
    var isNew=cardState[card.id]&&cardState[card.id].status==="new";var isSaved=savedCards.has(card.id);
    el.innerHTML='<div class="reel-flashcard" data-card-level="'+card.level+'">'+
      (isNew?'<div class="reel-new-badge">NEW</div>':"")+
      '<button class="reel-save-btn'+(isSaved?" saved":"")+'" data-id="'+card.id+'">'+(isSaved?"❤️":"🤍")+'</button>'+
      '<div class="card-level-tag">'+"🟢🟡🟠🔴"[card.level-1]+' L'+card.level+'</div>'+
      '<div class="card-category" style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:4px 0 10px">'+esc(card.category)+'</div>'+
      '<div class="card-question" style="font-size:.95rem;font-weight:600;line-height:1.5">'+esc(card.front)+'</div>'+
      '<div class="card-hint" style="font-size:.7rem;color:var(--text-dim);text-align:center;margin-top:12px">Tap to reveal</div>'+
      '<div class="card-answer">'+esc(card.back)+(card.diagram_svg?'<img src="'+card.diagram_svg+'" alt="Diagram" class="diagram-img" style="margin-top:10px;max-width:100%;border-radius:8px;background:#fff">':card.diagram?'<pre style="margin-top:10px;font-size:.65rem;color:var(--text-muted)">'+esc(card.diagram)+'</pre>':"")+'</div>'+
      '</div><div class="reel-page-label">'+esc(card.source||"")+'</div>';
    el.querySelector(".reel-flashcard").addEventListener("click",function(e){if(!e.target.closest(".reel-save-btn"))this.classList.toggle("revealed")});
    el.querySelector(".reel-save-btn").addEventListener("click",function(e){
      e.stopPropagation();var id=this.dataset.id;
      if(savedCards.has(id)){savedCards.delete(id);this.textContent="🤍";this.classList.remove("saved")}
      else{savedCards.add(id);this.textContent="❤️";this.classList.add("saved");if(navigator.vibrate)navigator.vibrate(30)}
      save();
    });
    $("reels-container").appendChild(el);
  }
}

// ═══ SEARCH ═══
function initSearch(){
  var input=$("search-input"),results=$("search-results");
  var debounce;
  input.addEventListener("input",function(){clearTimeout(debounce);debounce=setTimeout(function(){
    var q=input.value.trim().toLowerCase();
    if(q.length<2){results.innerHTML='<p style="color:var(--text-dim);text-align:center;padding:2rem">Type 2+ characters</p>';return}
    var matches=allCards.filter(function(c){return(c.front+c.back+c.category).toLowerCase().indexOf(q)!==-1}).slice(0,30);
    results.innerHTML=matches.length?matches.map(function(c){return'<div class="search-result" data-id="'+c.id+'">'+
      '<div class="sr-cat">'+"🟢🟡🟠🔴"[c.level-1]+' L'+c.level+' · '+esc(c.category)+'</div>'+
      '<div class="sr-q">'+esc(c.front)+'</div>'+
      '<div class="sr-a">'+esc(c.back)+'</div></div>'}).join(""):'<p style="color:var(--text-dim);text-align:center;padding:2rem">No matches</p>';
  },200)});
  results.addEventListener("click",function(e){var r=e.target.closest(".search-result");if(r){$("search-panel").classList.add("hidden")}});
}

// ═══ READ MODE ═══
function initRead(){
  var img=$("read-page-img"),slider=$("read-slider"),pn=$("read-page-num");
  function manifest(b){
    return new Promise(function(resolve){
      if(readManifests[b]){resolve(readManifests[b]);return}
      fetch("book/"+b+"/manifest.json").then(function(r){return r.json()}).then(function(m){readManifests[b]=m;resolve(m)}).catch(function(){resolve(null)});
    });
  }
  function show(){
    manifest(readBook).then(function(m){
      if(!m)return;var t=m.total_pages;readPage=Math.max(1,Math.min(t,readPage));
      slider.max=t;slider.value=readPage;pn.textContent=readPage+"/"+t;
      img.classList.add("loading");img.onload=function(){img.classList.remove("loading")};
      img.src="book/"+readBook+"/page-"+String(readPage).padStart(3,"0")+".webp";
      localStorage.setItem("sdc-read-"+readBook,String(readPage));
    });
  }
  if(!readInit){readInit=true;
    $("book-select").addEventListener("change",function(){readBook=$("book-select").value;readPage=parseInt(localStorage.getItem("sdc-read-"+readBook)||"1",10);show()});
    $("read-prev").addEventListener("click",function(){readPage--;show()});
    $("read-next").addEventListener("click",function(){readPage++;show()});
    slider.addEventListener("input",function(){pn.textContent=slider.value+"/"+slider.max});
    slider.addEventListener("change",function(){readPage=parseInt(slider.value,10);show()});
    pn.addEventListener("click",function(){
      manifest(readBook).then(function(m){var p=prompt("Go to page (1-"+(m?m.total_pages:999)+"):");if(p){var n=parseInt(p,10);if(n>=1)readPage=n;show()}});
    });
    // Swipe on read page image
    setupReadSwipe(img,function(){readPage--;show()},function(){readPage++;show()});
  }
  readPage=parseInt(localStorage.getItem("sdc-read-"+readBook)||"1",10);show();
}

// Read mode swipe helper
function setupReadSwipe(el,onPrev,onNext){
  var startX=0,dx=0,active=false;
  el.addEventListener("touchstart",function(e){startX=e.touches[0].clientX;dx=0;active=true},{passive:true});
  el.addEventListener("touchmove",function(e){if(!active)return;dx=e.touches[0].clientX-startX},{passive:true});
  el.addEventListener("touchend",function(){
    if(!active)return;active=false;
    if(dx>50)onPrev();
    else if(dx<-50)onNext();
  },{passive:true});
}

// ═══ UI UPDATES ═══
function updateAll(){updateSummary();updateTopBar();updateDailyGoal()}
function updateSummary(){
  var total=allCards.filter(function(c){return gam.unlockedLevels.indexOf(c.level)!==-1}).length;
  var mastered=0,learning=0;var keys=Object.keys(cardState);
  for(var i=0;i<keys.length;i++){var s=cardState[keys[i]];if(s.status==="mastered")mastered++;if(s.status==="learning")learning++}
  var q=getStudyQueue();
  var newC=allCards.filter(function(c){return cardState[c.id]&&cardState[c.id].status==="new"&&gam.unlockedLevels.indexOf(c.level)!==-1}).length;
  var reviewed=getDailyCount();
  var pct=total>0?Math.round((mastered+learning*.3)/total*100):0;
  $("ring-pct").textContent=pct+"%";$("ring-progress").style.strokeDashoffset=327*(1-pct/100);
  $("stat-due").textContent=q.length;$("stat-learning").textContent=learning;$("stat-new").textContent=newC;$("stat-mastered").textContent=mastered;
  var levelBtns=document.querySelectorAll(".level-btn[data-level]");
  for(var j=0;j<levelBtns.length;j++){var b=levelBtns[j];var l=b.dataset.level;if(l==="all")continue;b.classList.toggle("locked",gam.unlockedLevels.indexOf(parseInt(l))===-1)}
  $("total-cards-count").textContent=allCards.length;

  var info=$("study-info");
  hideEmptyState();
  if(reviewed>0&&q.length===0){
    info.innerHTML='✅ You reviewed <b>'+reviewed+' cards</b> today! Cards move to "Learning" and come back for review in 1-7 days.';
    $("btn-start-study").classList.add("hidden");
    $("btn-extra-study").classList.remove("hidden");
    showEmptyState(reviewed);
  }else if(q.length>0){
    info.textContent=q.length+" card"+(q.length>1?"s":"")+" ready to study";
    $("btn-start-study").classList.remove("hidden");
    $("btn-extra-study").classList.add("hidden");
  }else{
    info.textContent="";
    $("btn-start-study").classList.add("hidden");
    $("btn-extra-study").classList.remove("hidden");
    showEmptyState(0);
  }
}
function updateTopBar(){
  $("streak-badge").textContent="🔥 "+gam.streak;$("rank-badge").textContent=getRank().name;
}
function renderStats(){
  var mastered=0,learning=0;var keys=Object.keys(cardState);
  for(var i=0;i<keys.length;i++){var s=cardState[keys[i]];if(s.status==="mastered")mastered++;if(s.status==="learning")learning++}
  var h='<div class="stat-grid">'+
    '<div class="stat-card"><span class="stat-num">'+gam.streak+'</span><span class="stat-label">Day Streak</span></div>'+
    '<div class="stat-card"><span class="stat-num">'+gam.xp+'</span><span class="stat-label">XP · '+getRank().name+'</span></div>'+
    '<div class="stat-card"><span class="stat-num">'+mastered+'</span><span class="stat-label">Mastered</span></div>'+
    '<div class="stat-card"><span class="stat-num">'+learning+'</span><span class="stat-label">Learning</span></div></div>'+
    '<h3 style="margin:12px 0 8px;font-size:.85rem">Level Progress</h3><div class="level-progress">';
  var ln={1:"Foundations",2:"Core Patterns",3:"Real Systems",4:"Expert"},lc={1:"var(--green)",2:"var(--yellow)",3:"var(--orange)",4:"var(--red)"},li={1:"🟢",2:"🟡",3:"🟠",4:"🔴"};
  for(var l=1;l<=4;l++){var cards=allCards.filter(function(c){return c.level===l});var m=cards.filter(function(c){return cardState[c.id]&&cardState[c.id].status==="mastered"}).length;var p=cards.length?Math.round(m/cards.length*100):0;
    h+='<div class="level-row"'+(gam.unlockedLevels.indexOf(l)!==-1?"":" style=\"opacity:.4\"")+"><span class=\"level-icon\">"+li[l]+"</span><span style=\"font-size:.78rem;min-width:85px\">"+ln[l]+"</span><div class=\"level-bar\"><div class=\"level-bar-fill\" style=\"width:"+p+"%;background:"+lc[l]+"\"></div></div><span class=\"level-pct\">"+m+"/"+cards.length+"</span></div>"}
  h+="</div>";$("stats-section").innerHTML=h;
  var badges=STREAK_MILESTONES.map(function(d){return{label:d+"d 🔥",earned:gam.seenMilestones.indexOf(d)!==-1}});
  $("badges-section").innerHTML='<h3 style="margin:16px 0 8px;font-size:.85rem">🏅 Badges</h3><div class="badges-row">'+badges.map(function(b){return'<span class="badge'+(b.earned?" earned":"")+'">'+b.label+'</span>'}).join("")+'</div>';
}

// ═══ EVENTS ═══
function setupEvents(){
  $("flashcard").addEventListener("click",function(e){if(!e.target.closest(".flip-back-btn")&&!e.target.closest(".swipe-indicator"))flipCard()});
  $("btn-flip-back").addEventListener("click",function(e){e.stopPropagation();$("flashcard").classList.remove("flipped");$("rating-buttons").classList.add("hidden");$("category-progress").classList.add("hidden")});
  $("btn-prev-card").addEventListener("click",function(){if(studyIndex>0){studyIndex--;showCard()}});
  var rateBtns=document.querySelectorAll(".rate-btn");for(var i=0;i<rateBtns.length;i++){(function(b){b.addEventListener("click",function(e){e.stopPropagation();rateCard(parseInt(b.dataset.rating))})})(rateBtns[i])}
  $("btn-start-study").addEventListener("click",startStudy);
  $("btn-more-cards").addEventListener("click",startStudy);
  $("btn-extra-study").addEventListener("click",function(){
    var eligible=selectedLevel==="all"?allCards:allCards.filter(function(c){return c.level===parseInt(selectedLevel)});
    eligible=eligible.filter(function(c){return gam.unlockedLevels.indexOf(c.level)!==-1&&cardState[c.id]&&cardState[c.id].status==="new"});
    studyQueue=eligible.slice(0,10);
    if(!studyQueue.length){alert("No new cards available!");return}
    studyIndex=0;sessionStats={reviewed:0,correct:0,xpEarned:0};sessionSeenCategories={};
    $("study-summary").classList.add("hidden");$("card-area").classList.remove("hidden");$("session-complete").classList.add("hidden");
    showCard();
  });
  $("btn-back-home").addEventListener("click",function(){$("session-complete").classList.add("hidden");$("card-area").classList.add("hidden");$("study-summary").classList.remove("hidden");updateAll()});

  $("streak-badge").addEventListener("click",function(){alert("🔥 "+gam.streak+"-Day Streak\n\nStudy at least 1 card every day to keep your streak. Miss a day and it resets to 0.\n\nMilestones: 7, 14, 30, 60, 100, 200, 365 days")});
  $("rank-badge").addEventListener("click",function(){
    var ranks=XP_RANKS.map(function(r){return(gam.xp>=r.min?"✅":"⬜")+" "+r.name+" ("+r.min+" XP)"}).join("\n");
    alert("⚡ "+gam.xp+" XP — "+getRank().name+"\n\nEarn XP by rating cards:\n• Hard = 1 XP\n• Good = 2 XP\n• Easy = 3 XP\n• Forgot = 0 XP\n\nRanks:\n"+ranks);
  });
  var modeTabs=document.querySelectorAll(".mode-tab");
  for(var j=0;j<modeTabs.length;j++){(function(t){t.addEventListener("click",function(){
    for(var k=0;k<modeTabs.length;k++)modeTabs[k].classList.remove("active");t.classList.add("active");
    var m=t.dataset.mode;
    // Re-trigger fade-in by removing and re-adding the view
    var views=["study-view","reels-view","read-view"];
    for(var v=0;v<views.length;v++){
      var vEl=$(views[v]);
      var shouldShow=(views[v]===m+"-view");
      vEl.classList.toggle("hidden",!shouldShow);
      if(shouldShow){
        // Force re-trigger CSS animation
        vEl.style.animation="none";
        vEl.offsetHeight; // force reflow
        vEl.style.animation="";
      }
    }
    if(m==="reels")initReels();if(m==="study")updateAll();if(m==="read")initRead();
  })})(modeTabs[j])}
  var levelBtns=document.querySelectorAll(".level-btn");
  for(var lb=0;lb<levelBtns.length;lb++){(function(b){b.addEventListener("click",function(){if(b.classList.contains("locked"))return;var all=document.querySelectorAll(".level-btn");for(var x=0;x<all.length;x++)all[x].classList.remove("active");b.classList.add("active");selectedLevel=b.dataset.level;updateSummary()})})(levelBtns[lb])}
  $("btn-profile").addEventListener("click",function(){renderStats();$("profile-panel").classList.remove("hidden");$("overlay").classList.remove("dismissed");$("theme-select").value=settings.theme;$("daily-new-select").value=settings.newPerDay});
  $("close-profile").addEventListener("click",closePanels);
  $("theme-select").addEventListener("change",function(){settings.theme=$("theme-select").value;document.body.className="theme-"+settings.theme;save()});
  $("daily-new-select").addEventListener("change",function(){settings.newPerDay=parseInt($("daily-new-select").value,10);save();updateAll()});
  $("btn-reset").addEventListener("click",function(){if(confirm("Reset ALL progress?")){localStorage.clear();location.reload()}});
  $("overlay").addEventListener("click",closePanels);
  $("btn-search").addEventListener("click",function(){$("search-panel").classList.remove("hidden");$("search-input").focus()});
  $("close-search").addEventListener("click",function(){$("search-panel").classList.add("hidden")});
  initSearch();
  setupSwipeGestures();
}
function closePanels(){$("profile-panel").classList.add("hidden");$("overlay").classList.add("dismissed")}
function esc(s){var d=document.createElement("div");d.textContent=s;return d.innerHTML}

// ═══ INIT ═══
function startApp(){
  $("loader").style.opacity="1";$("loader").style.pointerEvents="auto";$("loader").style.display="flex";
  loadCards().then(function(){
    document.body.className="theme-"+settings.theme;updateAll();setupEvents();
    setTimeout(function(){$("loader").style.opacity="0";$("loader").style.pointerEvents="none"},300);
  });
}
function init(){
  loadCards().then(function(){
    if(showOnboarding())return;
    document.body.className="theme-"+settings.theme;updateAll();setupEvents();
    setTimeout(function(){$("loader").style.opacity="0";$("loader").style.pointerEvents="none"},300);
  });
}
init();
})();
