/**
 * SystemDesignCards v14 — Quiz Mode
 * 1. Swipe gestures on study cards (LEFT=Forgot, DOWN=Hard, RIGHT=Good, UP=Easy)
 * 2. Category progress in study mode
 * 3. Better empty states
 * 4. Reels filter as dropdown
 * 5. Smooth page transitions (CSS)
 * 6. Better read mode — bottom controls + swipe
 * 7. IndexedDB persistence (migrated from localStorage)
 * 8. Export / Import progress
 * 9. Quiz Mode: Practice MCQ + Timed Test with level unlocking
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

var allCards=[],cardState={},gam={xp:0,streak:0,lastStudyDate:null,unlockedLevels:[1,2],seenMilestones:[],quizUnlockedLevels:[1]},settings={theme:"dark",newPerDay:10};
var studyQueue=[],studyIndex=0,sessionStats={reviewed:0,correct:0,xpEarned:0},selectedLevel="all",savedCards=new Set();
var readBook="vol1",readPage=1,readManifests={},readInit=false;
var sessionSeenCategories={};
var db=null;
var DB_NAME="SystemDesignCardsDB";
var DB_VERSION=1;

// ═══ QUIZ STATE ═══
var quizLevel=1,quizMode="practice",quizQuestions=[],quizIndex=0,quizCorrect=0,quizXP=0,quizWrong=[],quizAnswered=false;
var quizTimerInterval=null,quizTimeLeft=60,quizTimeTaken=0,quizStartTime=0;

// ═══ INDEXEDDB WRAPPER ═══
function openDB(){
  return new Promise(function(resolve,reject){
    var req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=function(e){
      var d=e.target.result;
      if(!d.objectStoreNames.contains("cardState"))d.createObjectStore("cardState",{keyPath:"id"});
      if(!d.objectStoreNames.contains("gamification"))d.createObjectStore("gamification");
      if(!d.objectStoreNames.contains("settings"))d.createObjectStore("settings");
      if(!d.objectStoreNames.contains("savedCards"))d.createObjectStore("savedCards");
      if(!d.objectStoreNames.contains("dailyCounts"))d.createObjectStore("dailyCounts");
    };
    req.onsuccess=function(e){db=e.target.result;resolve(db)};
    req.onerror=function(e){reject(e.target.error)};
  });
}
function dbGet(store,key){
  return new Promise(function(resolve,reject){
    var tx=db.transaction(store,"readonly");
    var req=tx.objectStore(store).get(key);
    req.onsuccess=function(){resolve(req.result)};
    req.onerror=function(){reject(req.error)};
  });
}
function dbPut(store,key,value){
  return new Promise(function(resolve,reject){
    var tx=db.transaction(store,"readwrite");
    var s=tx.objectStore(store);
    // For stores with keyPath, put value directly; otherwise use key
    if(s.keyPath){s.put(value)}else{s.put(value,key)}
    tx.oncomplete=function(){resolve()};
    tx.onerror=function(){reject(tx.error)};
  });
}
function dbGetAll(store){
  return new Promise(function(resolve,reject){
    var tx=db.transaction(store,"readonly");
    var req=tx.objectStore(store).getAll();
    req.onsuccess=function(){resolve(req.result)};
    req.onerror=function(){reject(req.error)};
  });
}
function dbGetAllKeys(store){
  return new Promise(function(resolve,reject){
    var tx=db.transaction(store,"readonly");
    var req=tx.objectStore(store).getAllKeys();
    req.onsuccess=function(){resolve(req.result)};
    req.onerror=function(){reject(req.error)};
  });
}
function dbDelete(store,key){
  return new Promise(function(resolve,reject){
    var tx=db.transaction(store,"readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete=function(){resolve()};
    tx.onerror=function(){reject(tx.error)};
  });
}
function dbClear(store){
  return new Promise(function(resolve,reject){
    var tx=db.transaction(store,"readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete=function(){resolve()};
    tx.onerror=function(){reject(tx.error)};
  });
}

// ═══ MIGRATION FROM LOCALSTORAGE ═══
function migrateFromLocalStorage(){
  return new Promise(function(resolve){
    var hadData=false;
    var promises=[];
    // Migrate card state
    var s=localStorage.getItem("sdc-state");
    if(s){
      hadData=true;
      try{
        var parsed=JSON.parse(s);
        var keys=Object.keys(parsed);
        for(var i=0;i<keys.length;i++){
          var id=keys[i];
          var val=parsed[id];
          val.id=id;
          promises.push(dbPut("cardState",id,val));
        }
      }catch(e){/* ignore bad data */}
    }
    // Migrate gamification
    var g=localStorage.getItem("sdc-gam");
    if(g){
      hadData=true;
      try{promises.push(dbPut("gamification","main",JSON.parse(g)))}catch(e){}
    }
    // Migrate settings
    var st=localStorage.getItem("sdc-settings");
    if(st){
      hadData=true;
      try{promises.push(dbPut("settings","main",JSON.parse(st)))}catch(e){}
    }
    // Migrate saved cards
    var sv=localStorage.getItem("sdc-saved");
    if(sv){
      hadData=true;
      try{
        var arr=JSON.parse(sv);
        for(var j=0;j<arr.length;j++){
          promises.push(dbPut("savedCards",arr[j],{id:arr[j]}));
        }
      }catch(e){}
    }
    // Migrate daily counts (sdc-today-YYYY-MM-DD keys)
    for(var k=0;k<localStorage.length;k++){
      var key=localStorage.key(k);
      if(key&&key.indexOf("sdc-today-")===0){
        hadData=true;
        var dateStr=key.replace("sdc-today-","");
        var count=parseInt(localStorage.getItem(key)||"0",10);
        promises.push(dbPut("dailyCounts",dateStr,{date:dateStr,count:count}));
      }
    }
    // Migrate study dates into dailyCounts (ensure presence)
    var sd=localStorage.getItem("sdc-study-dates");
    if(sd){
      hadData=true;
      try{
        var dates=JSON.parse(sd);
        for(var d=0;d<dates.length;d++){
          // Only add if not already migrated from sdc-today-
          promises.push(
            dbGet("dailyCounts",dates[d]).then(function(dateVal){
              return function(existing){
                if(!existing)return dbPut("dailyCounts",dateVal,{date:dateVal,count:0,studied:true});
                if(!existing.studied){existing.studied=true;return dbPut("dailyCounts",dateVal,existing)}
              };
            }(dates[d]))
          );
        }
      }catch(e){}
    }
    Promise.all(promises).then(function(){
      if(hadData){
        // Remove old localStorage keys
        localStorage.removeItem("sdc-state");
        localStorage.removeItem("sdc-gam");
        localStorage.removeItem("sdc-settings");
        localStorage.removeItem("sdc-saved");
        localStorage.removeItem("sdc-study-dates");
        // Remove daily count keys
        var toRemove=[];
        for(var r=0;r<localStorage.length;r++){
          var rk=localStorage.key(r);
          if(rk&&rk.indexOf("sdc-today-")===0)toRemove.push(rk);
        }
        for(var ri=0;ri<toRemove.length;ri++)localStorage.removeItem(toRemove[ri]);
      }
      resolve();
    }).catch(function(){resolve()});
  });
}

// ═══ PERSISTENCE (IndexedDB) ═══
function loadState(){
  return Promise.all([
    dbGetAll("cardState").then(function(rows){
      cardState={};
      for(var i=0;i<rows.length;i++)cardState[rows[i].id]=rows[i];
    }),
    dbGet("gamification","main").then(function(g){
      if(g)gam=Object.assign({},gam,g);
    }),
    dbGet("settings","main").then(function(st){
      if(st)settings=Object.assign({},settings,st);
    }),
    dbGetAllKeys("savedCards").then(function(keys){
      savedCards=new Set(keys);
    })
  ]);
}
function save(){
  // Save cardState, gamification, settings, savedCards to IndexedDB
  var promises=[];
  var keys=Object.keys(cardState);
  // Batch card state writes in a single transaction
  var csTx=db.transaction("cardState","readwrite");
  var csStore=csTx.objectStore("cardState");
  for(var i=0;i<keys.length;i++){
    var val=cardState[keys[i]];
    val.id=keys[i];
    csStore.put(val);
  }
  promises.push(new Promise(function(resolve,reject){csTx.oncomplete=resolve;csTx.onerror=reject}));
  promises.push(dbPut("gamification","main",Object.assign({},gam)));
  promises.push(dbPut("settings","main",Object.assign({},settings)));
  // Saved cards
  var svTx=db.transaction("savedCards","readwrite");
  var svStore=svTx.objectStore("savedCards");
  svStore.clear();
  savedCards.forEach(function(id){svStore.put({id:id})});
  promises.push(new Promise(function(resolve,reject){svTx.oncomplete=resolve;svTx.onerror=reject}));
  // Fire and forget — don't block UI
  Promise.all(promises).catch(function(e){console.error("save error",e)});
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
function getDailyCount(){
  // Sync read from in-memory cache updated by incDailyCount
  return getDailyCount._cache||0;
}
function loadDailyCount(){
  var today=new Date().toISOString().split("T")[0];
  return dbGet("dailyCounts",today).then(function(rec){
    getDailyCount._cache=rec?rec.count:0;
  });
}
function incDailyCount(){
  var today=new Date().toISOString().split("T")[0];
  var current=getDailyCount._cache||0;
  current++;
  getDailyCount._cache=current;
  dbPut("dailyCounts",today,{date:today,count:current,studied:true}).catch(function(){});
}
function updateDailyGoal(){
  var done=getDailyCount(),goal=settings.newPerDay;
  var pct=Math.min(100,Math.round(done/goal*100));
  $("daily-goal-fill").style.width=pct+"%";
  $("daily-goal-text").textContent=done+"/"+goal;
}

// ═══ STUDY HISTORY (for streak calendar) ═══
function recordStudyDay(){
  var today=new Date().toISOString().split("T")[0];
  dbGet("dailyCounts",today).then(function(rec){
    if(rec){
      if(!rec.studied){rec.studied=true;dbPut("dailyCounts",today,rec).catch(function(){})}
    }else{
      dbPut("dailyCounts",today,{date:today,count:0,studied:true}).catch(function(){});
    }
  }).catch(function(){});
}
function getStudyDates(){
  return dbGetAll("dailyCounts").then(function(rows){
    var dates=[];
    for(var i=0;i<rows.length;i++){
      if(rows[i].studied)dates.push(rows[i].date);
    }
    return dates;
  }).catch(function(){return[]});
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
      fill.style.width="70%";
      return loadState();
    }).then(function(){
      return loadDailyCount();
    }).then(function(){
      for(var i=0;i<allCards.length;i++){var c=allCards[i];if(!cardState[c.id])cardState[c.id]={id:c.id,ef:2.5,interval:0,repetitions:0,nextReview:null,status:"new"}}
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
  fc.style.transform="";fc.style.opacity="";fc.classList.remove("fly-out","swipe-left","swipe-right","swipe-up","swipe-down","swiping");
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
  if(sessionSeenCategories[cat])seen=sessionSeenCategories[cat];
  var el=$("category-progress");
  el.textContent=cat+" "+(seen)+"/"+total+" seen";
  el.classList.remove("hidden");
}

function rateCard(rating){
  var c=studyQueue[studyIndex];
  var st=cardState[c.id];
  st.id=c.id;
  cardState[c.id]=Object.assign(st,sm2(st,rating));
  cardState[c.id].id=c.id;
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

// ═══ SWIPE GESTURES (LEFT=Forgot, DOWN=Hard, RIGHT=Good, UP=Easy) ═══
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
    var rotate=dx*0.08;
    fc.style.transform="translateX("+dx+"px) translateY("+dy+"px) rotate("+rotate+"deg)";
    // Show indicators based on direction
    var absX=Math.abs(dx),absY=Math.abs(dy);
    fc.classList.toggle("swipe-left",dx<-THRESHOLD/2&&absX>absY);
    fc.classList.toggle("swipe-right",dx>THRESHOLD/2&&absX>absY);
    fc.classList.toggle("swipe-up",dy<-THRESHOLD/2&&absY>absX);
    fc.classList.toggle("swipe-down",dy>THRESHOLD/2&&absY>absX);
    e.preventDefault();
  },{passive:false});

  fc.addEventListener("touchend",function(){
    if(!isSwiping)return;
    isSwiping=false;
    fc.classList.remove("swiping");
    var absX=Math.abs(dx),absY=Math.abs(dy);
    if(dy<-THRESHOLD&&absY>absX){
      // Swipe UP = Easy (4)
      flyOut(0,-1);rateCard(4);
    }else if(dy>THRESHOLD&&absY>absX){
      // Swipe DOWN = Hard (2)
      flyOut(0,1);rateCard(2);
    }else if(dx<-THRESHOLD&&absX>absY){
      // Swipe LEFT = Forgot (1)
      flyOut(-1,0);rateCard(1);
    }else if(dx>THRESHOLD&&absX>absY){
      // Swipe RIGHT = Good (3)
      flyOut(1,0);rateCard(3);
    }else{
      fc.style.transform="";
      fc.classList.remove("swipe-left","swipe-right","swipe-up","swipe-down");
    }
  },{passive:true});

  function flyOut(dirX,dirY){
    fc.classList.add("fly-out");
    fc.style.transform="translateX("+(dirX*300)+"px) translateY("+(dirY*300)+"px) rotate("+(dirX*20)+"deg)";
    fc.classList.remove("swipe-left","swipe-right","swipe-up","swipe-down");
  }
}

// ═══ EXPORT / IMPORT ═══
function setupExportImport(){
  $("btn-export").addEventListener("click",function(){
    Promise.all([
      dbGetAll("cardState"),
      dbGet("gamification","main"),
      dbGet("settings","main"),
      dbGetAll("savedCards"),
      dbGetAll("dailyCounts")
    ]).then(function(results){
      var data={
        version:1,
        exportDate:new Date().toISOString(),
        cardState:results[0],
        gamification:results[1]||{},
        settings:results[2]||{},
        savedCards:results[3],
        dailyCounts:results[4]
      };
      var blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
      var url=URL.createObjectURL(blob);
      var a=document.createElement("a");
      a.href=url;a.download="systemdesigncards-backup-"+new Date().toISOString().split("T")[0]+".json";
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  });
  $("btn-import").addEventListener("click",function(){
    $("import-file").click();
  });
  $("import-file").addEventListener("change",function(e){
    var file=e.target.files[0];if(!file)return;
    var reader=new FileReader();
    reader.onload=function(ev){
      try{
        var data=JSON.parse(ev.target.result);
        if(!data.cardState&&!data.gamification){alert("Invalid backup file.");return}
        if(!confirm("This will replace all your current progress. Continue?"))return;
        var promises=[];
        // Clear existing stores
        promises.push(dbClear("cardState"));
        promises.push(dbClear("gamification"));
        promises.push(dbClear("settings"));
        promises.push(dbClear("savedCards"));
        promises.push(dbClear("dailyCounts"));
        Promise.all(promises).then(function(){
          var imports=[];
          if(data.cardState){
            for(var i=0;i<data.cardState.length;i++){
              imports.push(dbPut("cardState",data.cardState[i].id,data.cardState[i]));
            }
          }
          if(data.gamification)imports.push(dbPut("gamification","main",data.gamification));
          if(data.settings)imports.push(dbPut("settings","main",data.settings));
          if(data.savedCards){
            for(var j=0;j<data.savedCards.length;j++){
              imports.push(dbPut("savedCards",data.savedCards[j].id,data.savedCards[j]));
            }
          }
          if(data.dailyCounts){
            for(var k=0;k<data.dailyCounts.length;k++){
              imports.push(dbPut("dailyCounts",data.dailyCounts[k].date,data.dailyCounts[k]));
            }
          }
          return Promise.all(imports);
        }).then(function(){
          location.reload();
        });
      }catch(err){alert("Error reading file: "+err.message)}
    };
    reader.readAsText(file);
    // Reset file input so same file can be re-imported
    e.target.value="";
  });
}

// ═══ EMPTY STATE ═══
function showEmptyState(reviewed){
  var el=$("empty-state");el.classList.remove("hidden");
  var msgIdx=Math.floor(Math.random()*MOTIVATIONAL_MESSAGES.length);
  $("empty-message").textContent=MOTIVATIONAL_MESSAGES[msgIdx];
  // Streak calendar — last 7 days
  getStudyDates().then(function(studyDates){
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
  });
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
    setupReadSwipe(img,function(){readPage--;show()},function(){readPage++;show()});
  }
  readPage=parseInt(localStorage.getItem("sdc-read-"+readBook)||"1",10);show();
}

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

// ═══ QUIZ MODE ═══
function initQuizHome(){
  $("quiz-home").classList.remove("hidden");$("quiz-area").classList.add("hidden");$("quiz-score").classList.add("hidden");
  updateQuizLevelButtons();
}
function updateQuizLevelButtons(){
  var btns=document.querySelectorAll(".quiz-level-btn");
  for(var i=0;i<btns.length;i++){
    var l=parseInt(btns[i].dataset.level);
    btns[i].classList.toggle("locked",gam.quizUnlockedLevels.indexOf(l)===-1);
    btns[i].classList.toggle("active",l===quizLevel&&gam.quizUnlockedLevels.indexOf(l)!==-1);
  }
}
function getKeySentence(text){
  if(!text)return"";
  var sentences=text.split(/[.!?]+/).map(function(s){return s.trim()}).filter(function(s){return s.length>10});
  return sentences.length?sentences[0]+".":text.substring(0,80)+"…";
}
function generateQuizQuestions(level){
  var pool=allCards.filter(function(c){return c.level===level});
  if(pool.length<4)return[];
  var shuffled=pool.slice().sort(function(){return Math.random()-.5});
  var picked=shuffled.slice(0,Math.min(10,pool.length));
  var questions=[];
  for(var i=0;i<picked.length;i++){
    var card=picked[i];
    var correctAnswer=getKeySentence(card.back);
    // Pick 3 distractors from other cards in same level
    var others=pool.filter(function(c){return c.id!==card.id}).sort(function(){return Math.random()-.5}).slice(0,3);
    var distractors=others.map(function(c){return getKeySentence(c.back)});
    // Ensure we have 3 unique distractors
    while(distractors.length<3)distractors.push("None of the above");
    var options=[correctAnswer].concat(distractors);
    // Shuffle options
    options.sort(function(){return Math.random()-.5});
    questions.push({card:card,question:card.front,correct:correctAnswer,options:options,explanation:card.back.substring(0,200)+(card.back.length>200?"…":"")});
  }
  return questions;
}
function startQuiz(mode){
  quizMode=mode;
  var questions=generateQuizQuestions(quizLevel);
  if(questions.length<4){alert("Not enough cards for level "+quizLevel+" (need at least 4).");return}
  quizQuestions=questions;quizIndex=0;quizCorrect=0;quizXP=0;quizWrong=[];quizAnswered=false;
  $("quiz-home").classList.add("hidden");$("quiz-area").classList.remove("hidden");$("quiz-score").classList.add("hidden");
  if(mode==="timed"){
    quizTimeLeft=60;quizStartTime=Date.now();
    $("quiz-timer").classList.remove("hidden");
    $("quiz-timer").classList.remove("urgent");
    $("quiz-timer").textContent="⏱ 60";
    quizTimerInterval=setInterval(function(){
      quizTimeLeft--;
      $("quiz-timer").textContent="⏱ "+quizTimeLeft;
      if(quizTimeLeft<=10)$("quiz-timer").classList.add("urgent");
      if(quizTimeLeft<=0){clearInterval(quizTimerInterval);quizTimerInterval=null;quizAutoAdvance()}
    },1000);
  }else{
    $("quiz-timer").classList.add("hidden");
    if(quizTimerInterval){clearInterval(quizTimerInterval);quizTimerInterval=null}
  }
  showQuizQuestion();
}
function quizAutoAdvance(){
  // Time ran out for current question — mark wrong and advance
  if(!quizAnswered){
    quizAnswered=true;
    var q=quizQuestions[quizIndex];
    quizWrong.push({question:q.question,correct:q.correct,cardId:q.card.id});
    // Show correct answer briefly then move on
    var btns=document.querySelectorAll(".quiz-option");
    for(var i=0;i<btns.length;i++){
      btns[i].classList.add("disabled");
      if(btns[i].textContent===q.correct)btns[i].classList.add("show-correct");
    }
  }
  quizIndex++;
  if(quizIndex>=quizQuestions.length){finishQuiz();return}
  quizAnswered=false;
  showQuizQuestion();
  // Restart timer for next question
  quizTimeLeft=60;quizStartTime=Date.now();
  $("quiz-timer").classList.remove("urgent");
  $("quiz-timer").textContent="⏱ 60";
  if(!quizTimerInterval){
    quizTimerInterval=setInterval(function(){
      quizTimeLeft--;
      $("quiz-timer").textContent="⏱ "+quizTimeLeft;
      if(quizTimeLeft<=10)$("quiz-timer").classList.add("urgent");
      if(quizTimeLeft<=0){clearInterval(quizTimerInterval);quizTimerInterval=null;quizAutoAdvance()}
    },1000);
  }
}
function showQuizQuestion(){
  if(quizIndex>=quizQuestions.length){finishQuiz();return}
  quizAnswered=false;
  var q=quizQuestions[quizIndex];
  $("quiz-counter").textContent=(quizIndex+1)+"/"+quizQuestions.length;
  $("quiz-score-live").textContent="⚡ "+quizXP;
  $("quiz-progress-fill").style.width=(quizIndex/quizQuestions.length*100)+"%";
  $("quiz-q-level").textContent="L"+q.card.level;
  $("quiz-q-level").className="quiz-q-level";
  var levelColors={1:"rgba(52,211,153,.12)",2:"rgba(251,191,36,.12)",3:"rgba(251,146,60,.12)",4:"rgba(248,113,113,.12)"};
  var levelTextColors={1:"var(--green)",2:"var(--yellow)",3:"var(--orange)",4:"var(--red)"};
  $("quiz-q-level").style.background=levelColors[q.card.level]||"";
  $("quiz-q-level").style.color=levelTextColors[q.card.level]||"";
  $("quiz-q-category").textContent=q.card.category;
  $("quiz-q-text").textContent=q.question;
  $("quiz-explanation").classList.add("hidden");
  $("quiz-next-btn").classList.add("hidden");
  var optContainer=$("quiz-options");optContainer.innerHTML="";
  for(var i=0;i<q.options.length;i++){
    var btn=document.createElement("button");
    btn.className="quiz-option";
    btn.textContent=q.options[i];
    btn.addEventListener("click",function(opt){return function(){selectQuizOption(opt)}}(q.options[i]));
    optContainer.appendChild(btn);
  }
}
function selectQuizOption(selected){
  if(quizAnswered)return;
  quizAnswered=true;
  var q=quizQuestions[quizIndex];
  var isCorrect=selected===q.correct;
  var btns=document.querySelectorAll(".quiz-option");
  for(var i=0;i<btns.length;i++){
    btns[i].classList.add("disabled");
    if(btns[i].textContent===q.correct)btns[i].classList.add("correct");
    if(btns[i].textContent===selected&&!isCorrect)btns[i].classList.add("wrong");
  }
  if(isCorrect){
    quizCorrect++;
    var xpGain=quizMode==="timed"?5:3;
    quizXP+=xpGain;
    gam.xp+=xpGain;save();
    $("xp-popup").textContent="+"+xpGain+" XP";$("xp-popup").classList.remove("dismissed");
    setTimeout(function(){$("xp-popup").classList.add("dismissed")},600);
    if(navigator.vibrate)navigator.vibrate(30);
  }else{
    quizWrong.push({question:q.question,correct:q.correct,cardId:q.card.id});
    if(navigator.vibrate)navigator.vibrate([50,30,50]);
  }
  // Show explanation
  $("quiz-explanation-text").textContent=q.explanation;
  $("quiz-explanation").classList.remove("hidden");
  $("quiz-score-live").textContent="⚡ "+quizXP;
  // In practice mode, show Next button. In timed, auto-advance after 2s
  if(quizMode==="practice"){
    $("quiz-next-btn").classList.remove("hidden");
  }else{
    setTimeout(function(){
      quizIndex++;
      if(quizIndex>=quizQuestions.length){finishQuiz()}else{showQuizQuestion()}
    },2000);
  }
}
function finishQuiz(){
  if(quizTimerInterval){clearInterval(quizTimerInterval);quizTimerInterval=null}
  $("quiz-area").classList.add("hidden");$("quiz-score").classList.remove("hidden");
  var total=quizQuestions.length;
  var pct=Math.round(quizCorrect/total*100);
  $("quiz-score-big").textContent=quizCorrect+"/"+total;
  var icon=pct>=90?"🏆":pct>=70?"🎉":pct>=50?"👍":"📚";
  $("quiz-score-icon").textContent=icon;
  var title=pct>=90?"Outstanding!":pct>=70?"Great Job!":pct>=50?"Good Effort!":"Keep Studying!";
  $("quiz-score-title").textContent=title;
  var details="Score: "+pct+"%<br>XP Earned: ⚡"+quizXP;
  if(quizMode==="timed"){
    var elapsed=Math.round((Date.now()-quizStartTime)/1000);
    details+="<br>Time: "+elapsed+"s";
  }
  $("quiz-score-details").innerHTML=details;
  // Wrong answers list
  var wHtml="";
  if(quizWrong.length>0){
    wHtml='<div style="font-size:.72rem;color:var(--text-muted);margin:8px 0 4px;font-weight:600">❌ Review these:</div>';
    for(var i=0;i<quizWrong.length;i++){
      wHtml+='<div class="quiz-wrong-item"><div class="qw-q">'+esc(quizWrong[i].question)+'</div><div class="qw-a">✓ '+esc(quizWrong[i].correct)+'</div></div>';
      // Feed wrong answers back to study loop
      if(cardState[quizWrong[i].cardId]){
        cardState[quizWrong[i].cardId].status="new";
        cardState[quizWrong[i].cardId].nextReview=null;
        cardState[quizWrong[i].cardId].repetitions=0;
      }
    }
    save();
  }
  $("quiz-wrong-list").innerHTML=wHtml;
  // Update streak and daily
  updateStreak();recordStudyDay();incDailyCount();updateDailyGoal();updateTopBar();
  // Check quiz level unlock: 7+/10 unlocks next level
  if(quizCorrect>=7){
    var nextLevel=quizLevel+1;
    if(nextLevel<=4&&gam.quizUnlockedLevels.indexOf(nextLevel)===-1){
      gam.quizUnlockedLevels.push(nextLevel);save();
      var names={2:"Core Patterns",3:"Real Systems",4:"Expert"};
      $("toast-text").textContent="🧪 Quiz Level "+nextLevel+": "+names[nextLevel]+" Unlocked!";
      $("level-toast").classList.remove("dismissed");
      setTimeout(function(){$("level-toast").classList.add("dismissed")},3000);
    }
  }
  if(pct>=70)fireConfetti();
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
    var views=["study-view","reels-view","quiz-view","read-view"];
    for(var v=0;v<views.length;v++){
      var vEl=$(views[v]);
      var shouldShow=(views[v]===m+"-view");
      vEl.classList.toggle("hidden",!shouldShow);
      if(shouldShow){
        vEl.style.animation="none";
        vEl.offsetHeight;
        vEl.style.animation="";
      }
    }
    if(m==="reels")initReels();if(m==="study")updateAll();if(m==="read")initRead();if(m==="quiz")initQuizHome();
  })})(modeTabs[j])}
  var levelBtns=document.querySelectorAll(".level-btn");
  for(var lb=0;lb<levelBtns.length;lb++){(function(b){b.addEventListener("click",function(){if(b.classList.contains("locked"))return;var all=document.querySelectorAll(".level-btn");for(var x=0;x<all.length;x++)all[x].classList.remove("active");b.classList.add("active");selectedLevel=b.dataset.level;updateSummary()})})(levelBtns[lb])}
  $("btn-profile").addEventListener("click",function(){renderStats();$("profile-panel").classList.remove("hidden");$("overlay").classList.remove("dismissed");$("theme-select").value=settings.theme;$("daily-new-select").value=settings.newPerDay});
  $("close-profile").addEventListener("click",closePanels);
  $("theme-select").addEventListener("change",function(){settings.theme=$("theme-select").value;document.body.className="theme-"+settings.theme;save()});
  $("daily-new-select").addEventListener("change",function(){settings.newPerDay=parseInt($("daily-new-select").value,10);save();updateAll()});
  $("btn-reset").addEventListener("click",function(){
    if(confirm("Reset ALL progress?")){
      // Clear IndexedDB and localStorage
      var req=indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess=function(){localStorage.clear();location.reload()};
      req.onerror=function(){localStorage.clear();location.reload()};
    }
  });
  $("overlay").addEventListener("click",closePanels);
  $("btn-search").addEventListener("click",function(){$("search-panel").classList.remove("hidden");$("search-input").focus()});
  $("close-search").addEventListener("click",function(){$("search-panel").classList.add("hidden")});
  initSearch();
  setupSwipeGestures();
  setupExportImport();

  // Quiz events
  $("btn-quiz-practice").addEventListener("click",function(){startQuiz("practice")});
  $("btn-quiz-timed").addEventListener("click",function(){startQuiz("timed")});
  $("quiz-next-btn").addEventListener("click",function(){quizIndex++;showQuizQuestion()});
  $("btn-quiz-retry").addEventListener("click",function(){startQuiz(quizMode)});
  $("btn-quiz-home").addEventListener("click",function(){initQuizHome()});
  var quizLevelBtns=document.querySelectorAll(".quiz-level-btn");
  for(var ql=0;ql<quizLevelBtns.length;ql++){(function(b){b.addEventListener("click",function(){
    if(b.classList.contains("locked"))return;
    var all=document.querySelectorAll(".quiz-level-btn");for(var x=0;x<all.length;x++)all[x].classList.remove("active");
    b.classList.add("active");quizLevel=parseInt(b.dataset.level);
  })})(quizLevelBtns[ql])}
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
  openDB().then(function(){
    return migrateFromLocalStorage();
  }).then(function(){
    return loadCards();
  }).then(function(){
    if(showOnboarding())return;
    document.body.className="theme-"+settings.theme;updateAll();setupEvents();
    setTimeout(function(){$("loader").style.opacity="0";$("loader").style.pointerEvents="none"},300);
  }).catch(function(err){
    console.error("Init error:",err);
    // Fallback: try to start anyway
    loadCards().then(function(){
      document.body.className="theme-"+settings.theme;updateAll();setupEvents();
      setTimeout(function(){$("loader").style.opacity="0";$("loader").style.pointerEvents="none"},300);
    });
  });
}
init();
})();
