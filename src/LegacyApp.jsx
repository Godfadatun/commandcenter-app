import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar as RBar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, LineChart, Line, ComposedChart, Area } from "recharts";
/* ─── Storage ─── */
const load = async (k, fb) => { try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : fb; } catch { return fb; } };
const save = async (k, v) => { try { await window.storage.set(k, JSON.stringify(v)); } catch {} };
/* ─── PROXY API ─── */
const PROXY = import.meta.env.VITE_PROXY_URL || (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:3456" : "");
const proxyPost = async (path, body) => {
  try {
    const r = await fetch(PROXY + path, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    return await r.json();
  } catch(e) { return {ok:false, error:e.message}; }
};
const proxyPatch = async (path, body) => {
  try {
    const r = await fetch(PROXY + path, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    return await r.json();
  } catch(e) { return {ok:false, error:e.message}; }
};
const proxyGet = async (path) => {
  try {
    const r = await fetch(PROXY + path);
    return await r.json();
  } catch(e) { return {ok:false, error:e.message}; }
};
const NOTION_TASKS_DS = "2dbbf02b-7870-8054-afe4-000bef3847f5";
const NOTION_DAILY_DS = "2dbbf02b-7870-81a7-8edf-000bea950a5a";
const NOTION_EXPENSE_DS = "2f4bf02b-7870-80c4-a28c-000b8c87713a";
/* ─── Date ─── */
const fmt = d => d.toISOString().split("T")[0];
const DAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const weekDates = d => { const s = new Date(d); s.setDate(s.getDate()-s.getDay()+1); return Array.from({length:7},(_,i)=>{const x=new Date(s);x.setDate(s.getDate()+i);return x;}); };
const getQ = d => Math.floor(d.getMonth()/3)+1;
const tomorrow = () => { const t = new Date(); t.setDate(t.getDate()+1); return fmt(t); };
const relDate = (dateStr) => {
  if(!dateStr) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr+"T00:00:00"); d.setHours(0,0,0,0);
  const diff = Math.round((d-today)/(86400000));
  if(diff===0) return "Today";
  if(diff===1) return "Tomorrow";
  if(diff===-1) return "Yesterday";
  if(diff===2) return "Day after tomorrow";
  if(diff>2&&diff<=7) return DAY[d.getDay()];
  return `${MON[d.getMonth()]} ${d.getDate()}`;
};
/* ─── Models ─── */
const emptyDay = date => ({
  date, exercise:"ns", sleep:"ns", calendar:"ns", scheduling:"ns", docPrep:"ns",
  spendLog: [], noiseLog: [],
  reviewed: false,
  wakeUp:"", sleepTime:"",
  notionPageId:"",
});
const emptyTask = () => ({
  id:"t"+Date.now()+Math.random().toString(36).slice(2,6),
  name:"", description:"",
  priority:"", taskType:"", effortLevel:"", type:"",
  dueDate:"", dueTime:"",
  startedAt:null, timerActive:false, elapsedMs:0,
  timeline:"", impactPoints:"",
  rail:"", parentTask:"",
  status:"Not started", completedOn:"",
  score:0, noiseFactor:"", resultSatisfaction:"", notes:"", hrs:"",
  notionPageId:"",
  recurring:"",
});
/* ─── Awake hours from wake/sleep times ─── */
const parseTime = (t) => { if(!t) return null; const [h,m]=(t.includes(":")?t:`${t}:00`).split(":").map(Number); return h+(m||0)/60; };
const calcAwakeHrs = (wakeUp, sleepTime) => {
  const w = parseTime(wakeUp), s = parseTime(sleepTime);
  if(w!==null && s!==null) return s>w ? s-w : (24-w)+s; // handles past midnight
  if(w!==null) { const now=new Date(); return (now.getHours()+now.getMinutes()/60)-w; } // still awake
  return 16; // default
};
const SLEEP_TARGET = 6; // minimum hours
/* ─── Auto-compute day metrics ─── */
const computeDay = (tasks, dayData, date) => {
  const nm = dayData.notionMetrics;
  // If Notion has pre-computed metrics for this day, use them as source of truth
  if (nm && (nm.totalTasks > 0 || nm.tasksDone > 0 || nm.impactExpected > 0)) {
    const awakeHrs = nm.awakeTime || calcAwakeHrs(dayData.wakeUp, dayData.sleepTime);
    const sleepHrs = dayData.wakeUp && dayData.sleepTime ? 24 - calcAwakeHrs(dayData.wakeUp, dayData.sleepTime) : 0;
    const rituals = [dayData.exercise, dayData.sleep, dayData.calendar, dayData.scheduling, dayData.docPrep];
    const ritualsDone = rituals.filter(s => s === "done").length;
    return {
      totalTasks: nm.totalTasks,
      tasksDone: nm.tasksDone,
      impactExpected: nm.impactExpected,
      impactAchieved: nm.impactAchieved,
      noiseHrs: nm.noiseHrs,
      signalHrs: 0,
      awakeHrs,
      sleepHrs,
      sleepMet: sleepHrs >= SLEEP_TARGET,
      spend: nm.spend || (dayData.spendLog || []).reduce((s,e) => s + (e.amount||0), 0),
      signal: nm.signalScore || 0,
      noise: nm.noiseScore || 0,
      snr: nm.snr || 0,
      ritualsDone,
      rituals: 5,
      distractedPct: nm.distractedPct || 0,
    };
  }
  // Fallback: compute locally from task data (for today / days without Notion metrics)
  const todayTasks = tasks.filter(t => t.dueDate === date || t.completedOn === date);
  const totalTasks = todayTasks.length;
  const completedToday = tasks.filter(t => t.completedOn === date);
  const tasksDone = completedToday.length;
  const impactExpected = todayTasks.reduce((s,t) => s + (parseFloat(t.impactPoints)||0), 0);
  const impactAchieved = completedToday.reduce((s,t) => s + (parseFloat(t.impactPoints)||0), 0);
  const taskNoiseHrs = completedToday.filter(t => (t.type||"").toLowerCase().includes("noise")).reduce((s,t) => s + (parseFloat(t.hrs)||t.elapsedMs/3600000||0), 0);
  const logNoiseHrs = (dayData.noiseLog || []).reduce((s,e) => s + (e.hours||0) + ((e.minutes||0)/60), 0);
  const noiseHrs = taskNoiseHrs + logNoiseHrs;
  const signalHrs = completedToday.filter(t => (t.type||"").toLowerCase().includes("signal")).reduce((s,t) => s + (parseFloat(t.hrs)||t.elapsedMs/3600000||0), 0);
  const awakeHrs = calcAwakeHrs(dayData.wakeUp, dayData.sleepTime);
  const sleepHrs = dayData.wakeUp && dayData.sleepTime ? 24 - awakeHrs : 0;
  const sleepMet = sleepHrs >= SLEEP_TARGET;
  const rituals = [dayData.exercise, dayData.sleep, dayData.calendar, dayData.scheduling, dayData.docPrep];
  const ritualsDone = rituals.filter(s => s === "done").length;
  const spend = (dayData.spendLog || []).reduce((s,e) => s + (e.amount||0), 0);
  const signal = impactExpected > 0 ? (impactAchieved / impactExpected) * 10 : 0;
  const noise = awakeHrs > 0 ? (noiseHrs / awakeHrs) * 10 : 0;
  const snr = noise === 0 ? 9.9 : signal / noise;
  const distractedPct = awakeHrs > 0 ? Math.round((noiseHrs/awakeHrs)*100) : 0;
  return { totalTasks, tasksDone, impactExpected, impactAchieved, noiseHrs, signalHrs, awakeHrs, sleepHrs, sleepMet, spend, signal, noise, snr, ritualsDone, rituals:5, distractedPct };
};
const PRIO = ["High","Medium","Low"];
const TTYPES = ["Work-WRemit","Work-Moni","Personal","Side Project","Admin"];
const EFFORT = ["Tiny","Small","Medium","Large","XL"];
const SIGTYPES = ["Signal \u2013 WORK:WRemits","Signal \u2013 WORK:Moni","Signal \u2013 PERSONAL","Signal \u2013 SIDE PROJECT","Noise \u2013 Distraction","Noise \u2013 Admin","Noise \u2013 Unplanned"];
const TIMELINES = ["Q1","Q2","Q3","Q4"];
const STATUSES = ["Not started","Scheduled","In progress","Done","Deffered","Paused","Missed"];
const defaultRails = [
  {id:"r1",name:"Spiritual",hl:["Faith","Meaning","Values"],health:0},
  {id:"r2",name:"Financial",hl:["Income","Savings","Investments"],health:0},
  {id:"r3",name:"Family",hl:["Marriage","Parenting","Relationships"],health:0},
  {id:"r4",name:"Career",hl:["Role","Impact","Progression"],health:0},
  {id:"r5",name:"Health",hl:["Fitness","Energy","Longevity"],health:0},
  {id:"r6",name:"Mental",hl:["Peace","Clarity","Resilience"],health:0},
  {id:"r7",name:"Discipline",hl:["Structure","Focus","Execution"],health:0},
  {id:"r8",name:"Lifestyle",hl:["Comfort","Joy","Balance"],health:0},
  {id:"r9",name:"Community",hl:["Connection","Brotherhood","Contribution"],health:0},
  {id:"r10",name:"Legacy",hl:["Purpose","Continuity","Stewardship"],health:0},
  {id:"r11",name:"Learning",hl:["Curiosity","Depth","Wisdom"],health:0},
];
const seedTasks = [
  {...emptyTask(),id:"t1",name:"Ship Moni v2 beta",status:"In progress",timeline:"Q1",rail:"Career",impactPoints:"9",dueDate:"2026-03-25",taskType:"Work-Moni",priority:"High",effortLevel:"Large",type:"Signal \u2013 WORK:Moni"},
  {...emptyTask(),id:"t2",name:"IELTS preparation",status:"Not started",timeline:"Q1",rail:"Learning",impactPoints:"8",dueDate:"2026-03-30",taskType:"Personal",priority:"High",effortLevel:"Large",type:"Signal \u2013 PERSONAL"},
  {...emptyTask(),id:"t3",name:"Emergency fund",status:"In progress",timeline:"Q1",rail:"Financial",impactPoints:"7",dueDate:"2026-03-31",taskType:"Personal",priority:"Medium",effortLevel:"Medium",type:"Signal \u2013 PERSONAL"},
];
/* ─── PRE-LOADED DATA ─── */
const PRELOADED_TASKS=[{...emptyTask(),id:"nt2dbbf027870802895d9c117f6e0ada0",name:"DO:Workouts",status:"Missed",priority:"Medium",type:"",taskType:"Personal",impactPoints:"8",effortLevel:"Medium",dueDate:"2026-01-02",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2dbbf027870802895d9c117f6e0ada0"},{...emptyTask(),id:"nt2e7bf027870a684fdf26e441d73a8",name:"Research and Note: Down M7 Type School in Canada and Apply",status:"Deffered",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2e7bf027870a684fdf26e441d73a8"},{...emptyTask(),id:"nt2e5bf027870b6ceed0bd907fb43",name:"Add Task Result to the dashboards",status:"Not started",priority:"Medium",type:"Signal - PERSONAL",taskType:"Personal",impactPoints:"5",effortLevel:"Small",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2e5bf027870b6ceed0bd907fb43"},{...emptyTask(),id:"nt2e5bf0278708088d34d2470e13ae71",name:"UPDATE: Task Board with all Notes",status:"Done",priority:"Medium",type:"Signal - PERSONAL",taskType:"Personal",impactPoints:"4",effortLevel:"Small",dueDate:"2026-01-12",hrs:"",noiseFactor:"",description:"Missed  & Re-Scheduled",resultSatisfaction:"",score:0,notionPageId:"2e5bf0278708088d34d2470e13ae71"},{...emptyTask(),id:"nt2dbbf027870d805fcb82842a3d23",name:"UPDATE: Task Board with all Notes",status:"Missed",priority:"Medium",type:"Signal - PERSONAL",taskType:"Personal",impactPoints:"4",effortLevel:"Small",dueDate:"2026-01-08",hrs:"",noiseFactor:"",description:"Missed  & Re-Scheduled",resultSatisfaction:"",score:0,notionPageId:"2dbbf027870d805fcb82842a3d23"},{...emptyTask(),id:"nt2eebf027870060bda9e3119924457b",name:"CHORES",status:"Not started",priority:"Low",type:"",taskType:"",impactPoints:"2",effortLevel:"Large",dueDate:"2026-01-23",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2eebf027870060bda9e3119924457b"},{...emptyTask(),id:"nt2dcbf027870166a6a4e22ae351bbdf",name:"Connect Google Task to my Task Tracker",status:"Paused",priority:"Medium",type:"Signal - PERSONAL",taskType:"Personal",impactPoints:"4",effortLevel:"",dueDate:"2026-01-03",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2dcbf027870166a6a4e22ae351bbdf"},{...emptyTask(),id:"nt2dfbf027870b0a82fd7789ff79b16",name:"DO:Squats",status:"Missed",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2dfbf027870b0a82fd7789ff79b16"},{...emptyTask(),id:"nt2dfbf027870f90e3d8df3437d5cf",name:"DO:Squats",status:"Missed",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2dfbf027870f90e3d8df3437d5cf"},{...emptyTask(),id:"nt2dfbf027870eaa50c60d477769f0",name:"DO:Squats",status:"Missed",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2dfbf027870eaa50c60d477769f0"},{...emptyTask(),id:"nt2e7bf0278080d98657f4b62eed3bc5",name:"DO:Squats",status:"Done",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-13",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2e7bf0278080d98657f4b62eed3bc5"},{...emptyTask(),id:"nt2eebf027870016af9efb158c1304f7",name:"DO:Squats",status:"Missed",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2eebf027870016af9efb158c1304f7"},{...emptyTask(),id:"nt2eebf027870fbdb8ef45c6de239e",name:"DO:Squats",status:"Done",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-22",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2eebf027870fbdb8ef45c6de239e"},{...emptyTask(),id:"nt2dfbf027870f8400cf91a0a394e2",name:"DO:Squats",status:"Done",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2dfbf027870f8400cf91a0a394e2"},{...emptyTask(),id:"nt2e6bf027870a282f4d9f913296fc0",name:"DO:Squats",status:"Done",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-10",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2e6bf027870a282f4d9f913296fc0"},{...emptyTask(),id:"nt2eebf0278000abb8bc28061056a1a",name:"Follow-Up",status:"Done",priority:"Medium",type:"Signal - WORK: RANK",taskType:"",impactPoints:"3",effortLevel:"Large",dueDate:"2026-01-20",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2eebf0278000abb8bc28061056a1a"},{...emptyTask(),id:"nt2f0bf027870dadaed6922500073a",name:"DO:Squats",status:"Done",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-20",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2f0bf027870dadaed6922500073a"},{...emptyTask(),id:"nt2eebf027870b8780cbdfb35e9493",name:"DO:Squats",status:"Done",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-13",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2eebf027870b8780cbdfb35e9493"},{...emptyTask(),id:"nt2dfbf027870daa643d99bba762e4c",name:"DO:Crunches",status:"Done",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2dfbf027870daa643d99bba762e4c"},{...emptyTask(),id:"nt2dfbf027870c94a3f0225fc7fbc1",name:"DO:Crunches",status:"Missed",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2dfbf027870c94a3f0225fc7fbc1"},{...emptyTask(),id:"nt2e7bf027870438a9be65438874056",name:"DO:Crunches",status:"Done",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-13",hrs:"",noiseFactor:"",description:"10-REPS X 2-SETS",resultSatisfaction:"",score:0,notionPageId:"2e7bf027870438a9be65438874056"},{...emptyTask(),id:"nt2ddbf027870f5a2deffe2f8c54ddd",name:"Side Project - Workremits",status:"Missed",priority:"High",type:"Signal",taskType:"Personal",impactPoints:"5",effortLevel:"",dueDate:"2026-01-04",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2ddbf027870f5a2deffe2f8c54ddd"},{...emptyTask(),id:"nt2eebf027870aad7bd5fa8c46ecc2",name:"Side Project - Work on Employee Confirmation - v1",status:"Not started",priority:"High",type:"Signal - WORK:WRemits",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-23",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2eebf027870aad7bd5fa8c46ecc2"},{...emptyTask(),id:"nt2e1bf027870069a7e7c7e205fcb08a",name:"Side Project - Work on Employee Confirmation - v1",status:"Done",priority:"High",type:"Signal - WORK:WRemits",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-08",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2e1bf027870069a7e7c7e205fcb08a"},{...emptyTask(),id:"nt2ddbf027870050a16eef2fdab904dd",name:"Side Project",status:"Missed",priority:"High",type:"",taskType:"Personal",impactPoints:"6",effortLevel:"",dueDate:"2026-01-03",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2ddbf027870050a16eef2fdab904dd"},{...emptyTask(),id:"nt2eebf027870ecadbbe324b3b1c9ba",name:"Create Job Application Automation",status:"Not started",priority:"High",type:"Signal - PERSONAL",taskType:"Personal",impactPoints:"8",effortLevel:"Large",dueDate:"2026-01-23",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2eebf027870ecadbbe324b3b1c9ba"},{...emptyTask(),id:"nt2e5bf027870119355fcb1d9e8dcd1",name:"Create Job Application Automation",status:"Not started",priority:"High",type:"Signal - PERSONAL",taskType:"Personal",impactPoints:"8",effortLevel:"Large",dueDate:"2026-01-14",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2e5bf027870119355fcb1d9e8dcd1"},{...emptyTask(),id:"nt2e5bf027870ee90d0f2eed878b66e",name:"Tax Calculator v3",status:"Done",priority:"High",type:"Signal - WORK:WRemits",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-11",hrs:"",noiseFactor:"",description:"- Workremits<br>- Ensure it comes with this domain tax.workremits.com",resultSatisfaction:"",score:0,notionPageId:"2e5bf027870ee90d0f2eed878b66e"},{...emptyTask(),id:"nt2e2bf027870008afa3dbd627ef4a8e",name:"Tax Calculator v3",status:"In progress",priority:"High",type:"Signal - WORK:WRemits",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-09",hrs:"",noiseFactor:"",description:"- Workremits<br>- Ensure it comes with this domain tax.workremits.com",resultSatisfaction:"",score:0,notionPageId:"2e2bf027870008afa3dbd627ef4a8e"},{...emptyTask(),id:"nt2eebf027870509d30f68a31eef8a2",name:"Execution Strategy",status:"Done",priority:"High",type:"Signal - WORK: RANK",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-20",hrs:"",noiseFactor:"",description:"How we will be executing the product Vision",resultSatisfaction:"",score:0,notionPageId:"2eebf027870509d30f68a31eef8a2"},{...emptyTask(),id:"nt2f0bf027870098a06ee58abe2fa4bc",name:"Execution Strategy v3",status:"Not started",priority:"High",type:"Signal - WORK:WRemits",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-22",hrs:"",noiseFactor:"",description:"How we will be executing the product Vision",resultSatisfaction:"",score:0,notionPageId:"2f0bf027870098a06ee58abe2fa4bc"},{...emptyTask(),id:"nt2e0bf027870eb4e0fdfcb2cc7f18",name:"Side Project WRemit",status:"Done",priority:"High",type:"Signal",taskType:"Education,Personal",impactPoints:"6",effortLevel:"",dueDate:"2026-01-06",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2e0bf027870eb4e0fdfcb2cc7f18"},{...emptyTask(),id:"nt2e5bf027870829197f2e667fe3eb7",name:"Execution Strategy",status:"Not started",priority:"High",type:"Signal - WORK:WRemits",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-14",hrs:"",noiseFactor:"",description:"How we will be executing the product Vision",resultSatisfaction:"",score:0,notionPageId:"2e5bf027870829197f2e667fe3eb7"},{...emptyTask(),id:"nt2e5bf027870d6a44de16a6046588e",name:"Execution Strategy",status:"Not started",priority:"High",type:"Signal - WORK: RANK",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-13",hrs:"",noiseFactor:"",description:"How we will be executing the product Vision",resultSatisfaction:"",score:0,notionPageId:"2e5bf027870d6a44de16a6046588e"},{...emptyTask(),id:"nt2eebf027870015bcd5d916f5ed48b5",name:"Execution Strategy v2",status:"Done",priority:"High",type:"Signal - WORK:WRemits",taskType:"Work-WRemit",impactPoints:"7",effortLevel:"Large",dueDate:"2026-01-21",hrs:"",noiseFactor:"",description:"How we will be executing the product Vision",resultSatisfaction:"",score:0,notionPageId:"2eebf027870015bcd5d916f5ed48b5"},{...emptyTask(),id:"nt2ddbf027870a5903ee51d5cc33330",name:"Side Project - Flumme",status:"Done",priority:"High",type:"Signal",taskType:"Personal",impactPoints:"5",effortLevel:"",dueDate:"2026-01-04",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:5,notionPageId:"2ddbf027870a5903ee51d5cc33330"},{...emptyTask(),id:"nt2dbbf027870df89ddf19082a9131c",name:"RESEARCH:Fire Number",status:"Not started",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-09",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2dbbf027870df89ddf19082a9131c"},{...emptyTask(),id:"nt2e0bf027870bf9953ddcba3a02385",name:"Weekly Personal Review",status:"Done",priority:"High",type:"Signal - PERSONAL",taskType:"Personal",impactPoints:"4",effortLevel:"",dueDate:"2026-01-06",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2e0bf027870bf9953ddcba3a02385"},{...emptyTask(),id:"nt2ddbf027870ea598fa367ee785cd",name:"Weekly Personal Review",status:"Missed",priority:"High",type:"Signal",taskType:"Personal",impactPoints:"4",effortLevel:"",dueDate:"2026-01-04",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2ddbf027870ea598fa367ee785cd"},{...emptyTask(),id:"nt2eebf027870086af73d6722dc379e6",name:"RESEARCH:Fire Number",status:"Not started",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"2026-01-06",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2eebf027870086af73d6722dc379e6"},{...emptyTask(),id:"nt2e0bf027870039b0cae865ffe7f330",name:"Commuting to Work",status:"Done",priority:"Low",type:"Noise",taskType:"",impactPoints:"0",effortLevel:"",dueDate:"2026-01-05",hrs:"4",noiseFactor:"2.22",description:"",resultSatisfaction:"",score:0,notionPageId:"2e0bf027870039b0cae865ffe7f330"},{...emptyTask(),id:"nt2eebf027870d8924ecad683b9fffc",name:"IELTS Study Questions 4 Research",status:"Not started",priority:"Medium",type:"Signal",taskType:"Education",impactPoints:"2",effortLevel:"Small",dueDate:"2026-01-23",hrs:"",noiseFactor:"",description:"Missed  & Re-Scheduled X 2",resultSatisfaction:"",score:0,notionPageId:"2eebf027870d8924ecad683b9fffc"},{...emptyTask(),id:"nt2dcbf027870010ca49bd56363ae9422",name:"IELTS Study Questions 4 Research",status:"Not started",priority:"Medium",type:"Signal",taskType:"Education",impactPoints:"2",effortLevel:"Small",dueDate:"2026-01-04",hrs:"",noiseFactor:"",description:"Missed  & Re-Scheduled X 2",resultSatisfaction:"",score:0,notionPageId:"2dcbf027870010ca49bd56363ae9422"},{...emptyTask(),id:"nt2e7bf027870068e33e19cdd48dfa4",name:"Buy/Order a printer",status:"Deffered",priority:"",type:"",taskType:"",impactPoints:"",effortLevel:"",dueDate:"",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2e7bf027870068e33e19cdd48dfa4"},{...emptyTask(),id:"nt2e5bf027870fb8f4fc93dd8f3b8d",name:"Update Calendar for Article Writing",status:"Not started",priority:"Medium",type:"Signal - PERSONAL",taskType:"Personal",impactPoints:"4",effortLevel:"Medium",dueDate:"2026-01-13",hrs:"",noiseFactor:"",description:"",resultSatisfaction:"",score:0,notionPageId:"2e5bf027870fb8f4fc93dd8f3b8d"}];
const PRELOADED_DAYS={"2026-01-01":{date:"2026-01-01",exercise:"ns",sleep:"ns",calendar:"ns",scheduling:"ns",docPrep:"ns",wakeUp:"",sleepTime:"",spendLog:[{id:"ns1",amount:6850,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[],reviewed:false,notionPageId:"2dbbf02b787080da96f6ced48898257d"},"2026-01-02":{date:"2026-01-02",exercise:"missed",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns2",amount:28350,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn2",type:"Imported",hours:3,minutes:0}],reviewed:false,notionPageId:"2dcbf02b7870807ae9288e439d6cb55df"},"2026-01-03":{date:"2026-01-03",exercise:"done",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns3",amount:72495,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn3",type:"Imported",hours:5,minutes:0}],reviewed:false,notionPageId:"2ddbf02b7870800d8112c8f079761694"},"2026-01-04":{date:"2026-01-04",exercise:"done",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns4",amount:81885,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn4",type:"Imported",hours:10,minutes:0}],reviewed:false,notionPageId:"2debf02b78708095a3c1eaf05fc7bbda"},"2026-01-05":{date:"2026-01-05",exercise:"done",sleep:"done",calendar:"done",scheduling:"missed",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns5",amount:104510,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn5",type:"Imported",hours:9,minutes:0}],reviewed:false,notionPageId:"2e0bf02b7870809590a4d2285df93bae"},"2026-01-06":{date:"2026-01-06",exercise:"missed",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[],noiseLog:[{id:"nn6",type:"Imported",hours:3,minutes:0}],reviewed:false,notionPageId:"2e0bf02b787080b9872bdad3c03108c1"},"2026-01-07":{date:"2026-01-07",exercise:"done",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns7",amount:5000,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn7",type:"Imported",hours:2,minutes:0}],reviewed:false,notionPageId:"2e1bf02b787080768548d7b1f54483b9"},"2026-01-08":{date:"2026-01-08",exercise:"done",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns8",amount:3000,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn8",type:"Imported",hours:3,minutes:0}],reviewed:false,notionPageId:"2e2bf02b7870802ea659cb8a3497e214"},"2026-01-09":{date:"2026-01-09",exercise:"missed",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns9",amount:50,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn9",type:"Imported",hours:12,minutes:0}],reviewed:false,notionPageId:"2e4bf02b787080e4b8f7dd507ceff015"},"2026-01-10":{date:"2026-01-10",exercise:"missed",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns10",amount:26800,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn10",type:"Imported",hours:12,minutes:0}],reviewed:false,notionPageId:"2e4bf02b78708052a24cfd114e85dd59"},"2026-01-10_day11":{date:"2026-01-10",exercise:"missed",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns11",amount:62650,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn11",type:"Imported",hours:7,minutes:0}],reviewed:false,notionPageId:"2e5bf02b7870807196e0d400569ccd62"},"2026-01-12":{date:"2026-01-12",exercise:"done",sleep:"missed",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[{id:"ns12",amount:27050,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn12",type:"Imported",hours:4,minutes:0}],reviewed:false,notionPageId:"2e6bf02b7870807499d3f03426f6bed9"},"2026-01-13":{date:"2026-01-13",exercise:"missed",sleep:"missed",calendar:"missed",scheduling:"missed",docPrep:"missed",wakeUp:"",sleepTime:"",spendLog:[{id:"ns13",amount:34350,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn13",type:"Imported",hours:16,minutes:0}],reviewed:false,notionPageId:"2e8bf02b787080f692e0f849b731dc1c"},"2026-01-14":{date:"2026-01-14",exercise:"missed",sleep:"ns",calendar:"missed",scheduling:"missed",docPrep:"missed",wakeUp:"06:27",sleepTime:"",spendLog:[{id:"ns14",amount:55050,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn14",type:"Imported",hours:16,minutes:0}],reviewed:false,notionPageId:"2e8bf02b7870804c8fa7cb90c84ff368"},"2026-01-15":{date:"2026-01-15",exercise:"missed",sleep:"ns",calendar:"missed",scheduling:"missed",docPrep:"missed",wakeUp:"",sleepTime:"",spendLog:[],noiseLog:[{id:"nn15",type:"Imported",hours:16,minutes:0}],reviewed:false,notionPageId:"2eebf02b787080829752f1caf9ce03dd"},"2026-01-16":{date:"2026-01-16",exercise:"missed",sleep:"ns",calendar:"missed",scheduling:"missed",docPrep:"missed",wakeUp:"",sleepTime:"",spendLog:[{id:"ns16",amount:35000,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn16",type:"Imported",hours:16,minutes:0}],reviewed:false,notionPageId:"2eebf02b787080928985ec6aa9e37b13"},"2026-01-17":{date:"2026-01-17",exercise:"missed",sleep:"ns",calendar:"missed",scheduling:"missed",docPrep:"missed",wakeUp:"",sleepTime:"",spendLog:[{id:"ns17",amount:72750,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn17",type:"Imported",hours:16,minutes:0}],reviewed:false,notionPageId:"2eebf02b787080c6b42cfc430e4c0b80"},"2026-01-18":{date:"2026-01-18",exercise:"missed",sleep:"ns",calendar:"missed",scheduling:"missed",docPrep:"missed",wakeUp:"",sleepTime:"",spendLog:[{id:"ns18",amount:22000,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn18",type:"Imported",hours:16,minutes:0}],reviewed:false,notionPageId:"2eebf02b78708090a231e6811a99f8b7"},"2026-01-19":{date:"2026-01-19",exercise:"missed",sleep:"done",calendar:"missed",scheduling:"missed",docPrep:"missed",wakeUp:"",sleepTime:"",spendLog:[{id:"ns19",amount:22600,note:"Notion import",category:"Other",time:"\u2014"}],noiseLog:[{id:"nn19",type:"Imported",hours:16,minutes:0}],reviewed:false,notionPageId:"2eebf02b7870805b9002dcb7282b0cf7"},"2026-01-20":{date:"2026-01-20",exercise:"done",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"",sleepTime:"",spendLog:[],noiseLog:[{id:"nn20",type:"Imported",hours:1,minutes:0}],reviewed:false,notionPageId:"2eebf02b787080d99d4bcdddfa25efbe"},"2026-01-21":{date:"2026-01-21",exercise:"done",sleep:"done",calendar:"done",scheduling:"done",docPrep:"done",wakeUp:"06:00",sleepTime:"23:00",spendLog:[],noiseLog:[{id:"nn21",type:"Imported",hours:2,minutes:0}],reviewed:false,notionPageId:"2efbf02b787080f2b825c5ac73998a20"},"2026-01-22":{date:"2026-01-22",exercise:"ns",sleep:"ns",calendar:"ns",scheduling:"ns",docPrep:"ns",wakeUp:"06:00",sleepTime:"23:00",spendLog:[],noiseLog:[{id:"nn22",type:"Imported",hours:2,minutes:0}],reviewed:false,notionPageId:"2f0bf02b787080158607fb331f2362b4"}};
const PRELOADED_EXPENSES=[{id:"ne2f5bf02b787080e8e86faef8eef37d8ed",name:"Personal Expense - february",amount:"0",status:"Not Paid",classification:"Personal",salaryPeriod:"",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080e8e86faef8eef37d8ed"},{id:"ne2f5bf02b787080b6a9fbd17c532ec0db",name:"Personal Expense - March",amount:"280000",status:"Not Paid",classification:"Personal",salaryPeriod:"March Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080b6a9fbd17c532ec0db"},{id:"ne2f5bf02b78708092bcf1e92f17545d6b",name:"Fruits",amount:"20000",status:"Not Paid",classification:"Family",salaryPeriod:"March Salary",datePaid:"",unit:"4 Week @ 5,000/Week",parentId:"",recurring:false,notionPageId:"2f5bf02b78708092bcf1e92f17545d6b"},{id:"ne2f4bf02b787080f7b092de41bae1c5ed",name:"Fruits",amount:"20000",status:"Not Paid",classification:"Family",salaryPeriod:"",datePaid:"",unit:"4 Week @ 5,000/Week",parentId:"",recurring:false,notionPageId:"2f4bf02b787080f7b092de41bae1c5ed"},{id:"ne2f5bf02b78708075b95ee95719003994",name:"Fruits",amount:"20000",status:"Not Paid",classification:"Family",salaryPeriod:"",datePaid:"",unit:"4 Week @ 5,000/Week",parentId:"",recurring:false,notionPageId:"2f5bf02b78708075b95ee95719003994"},{id:"ne2f5bf02b787080e0813fd104842bb4af",name:"Milk",amount:"81000",status:"Not Paid",classification:"Family",salaryPeriod:"",datePaid:"",unit:"9 Cans @ 9000/Can",parentId:"",recurring:false,notionPageId:"2f5bf02b787080e0813fd104842bb4af"},{id:"ne2f4bf02b78708058a738e39dbc435364",name:"Milk",amount:"81000",status:"Not Paid",classification:"Family",salaryPeriod:"",datePaid:"",unit:"9 Cans @ 9000/Can",parentId:"",recurring:false,notionPageId:"2f4bf02b78708058a738e39dbc435364"},{id:"ne2f5bf02b7870800dbe33e709c60cd394",name:"Milk",amount:"81000",status:"Not Paid",classification:"Family",salaryPeriod:"March Salary",datePaid:"",unit:"9 Cans @ 9000/Can",parentId:"",recurring:false,notionPageId:"2f5bf02b7870800dbe33e709c60cd394"},{id:"ne2f5bf02b7870808887bce3985b7eaa25",name:"Car Fix",amount:"190000",status:"Paid",classification:"Expenditure",salaryPeriod:"February Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b7870808887bce3985b7eaa25"},{id:"ne2f5bf02b7870800a9c24f140d540cc34",name:"Gideon - Payment 2",amount:"200000",status:"Paid",classification:"Debt",salaryPeriod:"February Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b7870800a9c24f140d540cc34"},{id:"ne2f5bf02b78708033a273df2450f7955e",name:"fair-Money",amount:"750000",status:"Paid",classification:"Debt",salaryPeriod:"February Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b78708033a273df2450f7955e"},{id:"ne2f5bf02b78708043b44add731625de56",name:"Wife - february",amount:"200000",status:"Not Paid",classification:"Family",salaryPeriod:"February Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b78708043b44add731625de56"},{id:"ne2f5bf02b787080468cc5e613758c08f6",name:"Tithe February",amount:"400000",status:"Paid",classification:"Obligation",salaryPeriod:"February Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080468cc5e613758c08f6"},{id:"ne2f5bf02b78708091b2f8de10e331c910",name:"Household - february",amount:"100000",status:"Paid",classification:"Family",salaryPeriod:"February Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b78708091b2f8de10e331c910"},{id:"ne2f5bf02b787080208f12caf693439c4e",name:"Rent 1st Payment",amount:"1000000",status:"Paid",classification:"Expenditure",salaryPeriod:"February Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080208f12caf693439c4e"},{id:"ne2f4bf02b787080ceb266f98da0320cea",name:"IELTS-Payment",amount:"300000",status:"Paid",classification:"Project",salaryPeriod:"Janruary Salary",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f4bf02b787080ceb266f98da0320cea"},{id:"ne2f4bf02b7870802aa142c3212bf79e88",name:"Household",amount:"120000",status:"Paid",classification:"Family",salaryPeriod:"Janruary Salary",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f4bf02b7870802aa142c3212bf79e88"},{id:"ne2f4bf02b78708075b2a3c54cb7b1c39e",name:"Subscription",amount:"200000",status:"Partial Payment",classification:"Family",salaryPeriod:"Janruary Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f4bf02b78708075b2a3c54cb7b1c39e"},{id:"ne2f5bf02b78708009a14bd07cf88d01b6",name:"Cleaner",amount:"40000",status:"Paid",classification:"Family",salaryPeriod:"",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b78708009a14bd07cf88d01b6"},{id:"ne2f5bf02b78708095a2affad33dda65e0",name:"Diaper",amount:"0",status:"Not Paid",classification:"Family",salaryPeriod:"",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b78708095a2affad33dda65e0"},{id:"ne2f5bf02b787080de982aeb005362293d",name:"Security",amount:"10000",status:"Paid",classification:"Family",salaryPeriod:"March Salary",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080de982aeb005362293d"},{id:"ne2f5bf02b787080ec8e47d2db565aa75e",name:"Security",amount:"10000",status:"Paid",classification:"Family",salaryPeriod:"",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080ec8e47d2db565aa75e"},{id:"ne2f4bf02b7870803e8ae3c6493f9092f2",name:"Security",amount:"10000",status:"Paid",classification:"Family",salaryPeriod:"",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f4bf02b7870803e8ae3c6493f9092f2"},{id:"ne2f5bf02b787080349381d32ab09a39e2",name:"Fuel",amount:"100000",status:"Partial Payment",classification:"Family",salaryPeriod:"Janruary Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080349381d32ab09a39e2"},{id:"ne2f5bf02b787080d68ddeebcc00a475d2",name:"Starlink Payment",amount:"200000",status:"Paid",classification:"Expenditure",salaryPeriod:"February Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080d68ddeebcc00a475d2"},{id:"ne2f4bf02b7870803e96d2d5ab9f38b6b0",name:"Tithe",amount:"400000",status:"Paid",classification:"Obligation",salaryPeriod:"Janruary Salary",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f4bf02b7870803e96d2d5ab9f38b6b0"},{id:"ne2f5bf02b78708072ac72d3069d01ed39",name:"Tithe - March",amount:"400000",status:"Not Paid",classification:"Obligation",salaryPeriod:"March Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b78708072ac72d3069d01ed39"},{id:"ne2f4bf02b787080dd9d8df7153c1ec563",name:"Wife",amount:"200000",status:"Paid",classification:"Family",salaryPeriod:"Janruary Salary",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f4bf02b787080dd9d8df7153c1ec563"},{id:"ne2f5bf02b7870807d97c7db8f6a0d2a65",name:"Wife - March",amount:"200000",status:"Not Paid",classification:"Family",salaryPeriod:"March Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b7870807d97c7db8f6a0d2a65"},{id:"ne2f4bf02b78708093b3b7d27938abf716",name:"Staff Salary",amount:"110000",status:"Paid",classification:"Family",salaryPeriod:"Janruary Salary",datePaid:"2026-01-26",unit:"",parentId:"",recurring:false,notionPageId:"2f4bf02b78708093b3b7d27938abf716"},{id:"ne2f5bf02b787080168501ee90ef6bd2e3",name:"Staff Salary - March",amount:"110000",status:"Not Paid",classification:"Family",salaryPeriod:"March Salary",datePaid:"",unit:"",parentId:"",recurring:false,notionPageId:"2f5bf02b787080168501ee90ef6bd2e3"}];
/* ─── SNR ─── */
const calcSig = (a,e) => e>0?(a/e)*10:0;
const calcNoi = (n,a) => a>0?(n/a)*10:0;
const calcSNR = (s,n) => n>0?s/n:s>0?99:0;
const snrLbl = v => v>10?"Exceptional":v>=5?"Strong Focus":v>=1?"Improve":v>0?"High Noise":"No Data";
const snrDesc = v => v>10?"High impact, minimal noise":v>=5?"Good signal, manageable noise":v>=1?"Balance impact and cut noise":v>0?"Noise drowning signal":"Log tasks to compute";
const snrClr = v => v>10?"#386A20":v>=5?"#8B5E3C":v>=1?"#7C6F00":"#BA1A1A";
/* ══ M3 DESIGN TOKENS ══ */
const M = {
  bg:"#FFF8F5", surface:"#FFFFFF", surfaceC:"#F5EFEC", surfaceCH:"#EDE6E3", surfaceCHi:"#E5DFDB",
  onSurface:"#201A17", onSurfaceV:"#52443D",
  outline:"#85746B", outlineV:"#D7C2B8",
  primary:"#8B5E3C", onPrimary:"#FFF", primaryC:"#FFDCC2", onPrimaryC:"#321200",
  secondary:"#755846", onSecondary:"#FFF", secondaryC:"#FFDCC2", onSecondaryC:"#2B1609",
  tertiary:"#586339", onTertiary:"#FFF", tertiaryC:"#DCE8B4", onTertiaryC:"#161F00",
  error:"#BA1A1A", onError:"#FFF", errorC:"#FFDAD6", onErrorC:"#410002",
  info:"#4A6490", infoC:"#D6E3FF", warn:"#7C6F00", warnC:"#F9E866",
};
const T = {
  headlineM:{fontSize:28,fontWeight:500,lineHeight:"36px"},
  headlineS:{fontSize:24,fontWeight:500,lineHeight:"32px"},
  titleL:{fontSize:22,fontWeight:500,lineHeight:"28px"},
  titleM:{fontSize:16,fontWeight:600,lineHeight:"24px",letterSpacing:"0.15px"},
  titleS:{fontSize:14,fontWeight:600,lineHeight:"20px",letterSpacing:"0.1px"},
  bodyL:{fontSize:16,fontWeight:400,lineHeight:"24px",letterSpacing:"0.5px"},
  bodyM:{fontSize:14,fontWeight:400,lineHeight:"20px",letterSpacing:"0.25px"},
  bodyS:{fontSize:12,fontWeight:400,lineHeight:"16px",letterSpacing:"0.4px"},
  labelL:{fontSize:14,fontWeight:600,lineHeight:"20px",letterSpacing:"0.1px"},
  labelM:{fontSize:12,fontWeight:600,lineHeight:"16px",letterSpacing:"0.5px"},
  labelS:{fontSize:11,fontWeight:600,lineHeight:"16px",letterSpacing:"0.5px"},
};
const elev = l => ["none","0 1px 3px 1px rgba(0,0,0,.15),0 1px 2px rgba(0,0,0,.3)","0 2px 6px 2px rgba(0,0,0,.15),0 1px 2px rgba(0,0,0,.3)","0 4px 8px 3px rgba(0,0,0,.15),0 1px 3px rgba(0,0,0,.3)"][l]||"none";
const font = "'Google Sans','Roboto','Segoe UI',system-ui,sans-serif";
const mono = "'Roboto Mono','SF Mono',monospace";
/* ─── Icon ─── */
const Ic = ({d,s=24,c="currentColor"}) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
const ic = {
  today:"M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  week:"M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  exec:"M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  rails:"M22 12h-4l-3 9L9 3l-3 9H2",
  check:"M20 6L9 17l-5-5",plus:"M12 5v14M5 12h14",
  chev:"M9 18l6-6-6-6",back:"M15 18l-6-6 6-6",
  x:"M18 6L6 18M6 6l12 12",down:"M6 9l6 6 6-6",
  sun:"M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 17a5 5 0 100-10 5 5 0 000 10z",
  play:"M5 3l14 9-14 9V3z",
  pause:"M6 4h4v16H6zM14 4h4v16h-4z",
  stop:"M6 4h12v16H6z",
  clock:"M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2",
  star:"M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  moon2:"M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z",
  resch:"M8 2v4M16 2v4M3 10h18M21 12.5V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h6M16 19l2 2 4-4",
  edit:"M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5Z",
  settings:"M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z M12 8a4 4 0 100 8 4 4 0 000-8z",
  repeat:"M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3",
  trash:"M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2",
};
/* ══ M3 COMPONENTS ══ */
const BtnFilled = ({label,onClick,icon,full,disabled,color=M.primary,tc=M.onPrimary}) => (
  <button onClick={disabled?undefined:onClick} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 24px",borderRadius:20,border:"none",background:disabled?M.surfaceCHi:color,color:disabled?M.outline:tc,...T.labelL,fontFamily:font,cursor:disabled?"default":"pointer",width:full?"100%":"auto",opacity:disabled?.5:1}}>
    {icon&&<Ic d={icon} s={18} c={disabled?M.outline:tc}/>}{label}
  </button>
);
const FilterChip = ({label,active,onClick,color}) => (
  <button onClick={onClick} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 16px",borderRadius:8,border:`1px solid ${active?(color||M.primary):M.outlineV}`,background:active?(color?color+"20":M.primaryC):"transparent",color:active?(color||M.onPrimaryC):M.onSurfaceV,...T.labelM,fontFamily:font,cursor:"pointer",transition:"all .2s"}}>
    {active&&<Ic d={ic.check} s={14} c={color||M.onPrimaryC}/>}{label}
  </button>
);
const StatusDot = ({status}) => {
  const map={"Done":M.tertiary,"In progress":M.primary,"Scheduled":M.warn,"Not started":M.outlineV,"Deffered":M.outline,"Paused":M.info,"Missed":M.error};
  return <span style={{width:8,height:8,borderRadius:4,background:map[status]||M.outlineV,display:"inline-block",flexShrink:0}}/>;
};
const Card = ({children,style={},onClick,elevated}) => (
  <div onClick={onClick} style={{background:M.surface,borderRadius:16,border:elevated?undefined:`1px solid ${M.outlineV}`,boxShadow:elevated?elev(1):elev(0),overflow:"hidden",cursor:onClick?"pointer":"default",boxSizing:"border-box",maxWidth:"100%",...style}}>{children}</div>
);
const Stat = ({label,value,sub,color}) => (
  <Card style={{padding:"14px 16px",flex:1,minWidth:0,boxSizing:"border-box"}}>
    <div style={{...T.labelS,color:M.onSurfaceV,textTransform:"uppercase",marginBottom:6}}>{label}</div>
    <div style={{fontSize:24,fontWeight:700,color:color||M.onSurface,fontFamily:mono,lineHeight:1}}>{value}</div>
    {sub&&<div style={{...T.bodyS,color:M.onSurfaceV,marginTop:4}}>{sub}</div>}
  </Card>
);
const Bar = ({value,max,color=M.primary,h=4}) => (
  <div style={{width:"100%",height:h,borderRadius:h,background:M.surfaceCH,overflow:"hidden"}}>
    <div style={{width:`${max>0?Math.min((value/max)*100,100):0}%`,height:"100%",borderRadius:h,background:color,transition:"width .4s ease"}}/>
  </div>
);
const PBadge = ({p}) => { if(!p) return null; const c=p==="High"?M.error:p==="Medium"?M.warn:M.info; return <span style={{...T.labelS,padding:"2px 8px",borderRadius:8,background:c+"18",color:c}}>{p}</span>; };
const TBadge = ({t}) => { if(!t) return null; const n=t.toLowerCase().includes("noise"); return <span style={{...T.labelS,padding:"2px 8px",borderRadius:8,background:n?M.errorC:M.tertiaryC,color:n?M.onErrorC:M.onTertiaryC}}>{t.replace("Signal – ","").replace("Noise – ","⚡")}</span>; };
const EBadge = ({e}) => e?<span style={{...T.labelS,padding:"2px 8px",borderRadius:8,background:M.surfaceCH,color:M.onSurfaceV}}>{e}</span>:null;
const RitualItem = ({label,status,onToggle}) => {
  const done=status==="done",missed=status==="missed";
  return (
    <button onClick={onToggle} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"14px 16px",background:done?M.tertiaryC:missed?M.errorC:M.surface,borderRadius:12,border:`1px solid ${done?M.tertiary+"40":missed?M.error+"40":M.outlineV}`,cursor:"pointer",fontFamily:font,transition:"all .2s"}}>
      <span style={{width:24,height:24,borderRadius:6,border:`2px solid ${done?M.tertiary:missed?M.error:M.outline}`,background:done?M.tertiary:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        {done&&<Ic d={ic.check} s={16} c="#FFF"/>}{missed&&<span style={{color:M.error,...T.labelL}}>×</span>}
      </span>
      <span style={{...T.titleS,color:done?M.onTertiaryC:missed?M.onErrorC:M.onSurface,textDecoration:done?"line-through":"none",opacity:done?.7:1}}>{label}</span>
    </button>
  );
};
/* ── Sheet ── */
const Sheet = ({open,onClose,title,children}) => {
  if(!open) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",justifyContent:"center"}}>
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.4)"}}/>
      <div style={{position:"relative",width:"100%",maxWidth:600,height:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
        <div style={{position:"relative",background:M.surfaceC,borderRadius:"28px 28px 0 0",padding:"0 24px 36px",maxHeight:"90vh",overflowY:"auto",boxShadow:elev(3),boxSizing:"border-box"}}>
          <div style={{padding:"12px 0 0",display:"flex",justifyContent:"center"}}><div style={{width:32,height:4,borderRadius:2,background:M.outlineV}}/></div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 0 16px"}}>
            <span style={{...T.titleL,color:M.onSurface}}>{title}</span>
            <button onClick={onClose} style={{background:M.surfaceCH,border:"none",cursor:"pointer",width:36,height:36,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={ic.x} s={18} c={M.onSurfaceV}/></button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};
/* ── Form Components ── */
const Field = ({label,value,onChange,type="text",ph="",half,req}) => (
  <div style={{marginBottom:16,flex:half?1:undefined,minWidth:half?"0":undefined}}>
    <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>{label}{req&&<span style={{color:M.error}}> *</span>}</label>
    <input value={value} onChange={e=>onChange(e.target.value)} type={type} placeholder={ph} style={{width:"100%",padding:"12px 16px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}} onFocus={e=>e.target.style.borderColor=M.primary} onBlur={e=>e.target.style.borderColor=M.outlineV}/>
  </div>
);
const TextArea = ({label,value,onChange,ph=""}) => (
  <div style={{marginBottom:16}}>
    <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>{label}</label>
    <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={ph} rows={3} style={{width:"100%",padding:"12px 16px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box",resize:"vertical"}}/>
  </div>
);
const Dropdown = ({label,value,onChange,options,ph="Select",req}) => {
  const [open,setOpen]=useState(false);
  return (
    <div style={{marginBottom:16,position:"relative"}}>
      <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>{label}{req&&<span style={{color:M.error}}> *</span>}</label>
      <button onClick={()=>setOpen(!open)} style={{width:"100%",padding:"12px 16px",borderRadius:12,border:`1px solid ${open?M.primary:M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:value?M.onSurface:M.outline,textAlign:"left",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",boxSizing:"border-box"}}>
        <span>{value||ph}</span><Ic d={ic.down} s={16} c={M.outline}/>
      </button>
      {open&&<div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:20,marginTop:4,background:M.surface,borderRadius:12,boxShadow:elev(2),maxHeight:200,overflowY:"auto",border:`1px solid ${M.outlineV}`,boxSizing:"border-box"}}>
        {options.map((o,idx)=><button key={o+idx} onClick={()=>{onChange(o);setOpen(false);}} style={{width:"100%",padding:"12px 16px",background:value===o?M.primaryC:"transparent",border:"none",borderBottom:`1px solid ${M.surfaceCH}`,fontFamily:font,...T.bodyM,color:value===o?M.onPrimaryC:M.onSurface,textAlign:"left",cursor:"pointer",boxSizing:"border-box"}}>{o}</button>)}
      </div>}
    </div>
  );
};
const SectionHead = ({label,icon}) => (
  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,marginTop:24,paddingBottom:10,borderBottom:`1px solid ${M.outlineV}`}}>
    {icon&&<span style={{fontSize:16}}>{icon}</span>}
    <span style={{...T.labelL,color:M.primary,textTransform:"uppercase",letterSpacing:"0.8px"}}>{label}</span>
  </div>
);
/* ══════════════════════════════════════════════════════════════
   SWIPE CARD
   ══════════════════════════════════════════════════════════════ */
const SwipeCard = ({task, onAccept, onSkip, onEdit}) => {
  const startX = useRef(0);
  const [offset, setOffset] = useState(0);
  const [decision, setDecision] = useState(null);
  const [exiting, setExiting] = useState(false);
  const threshold = 80;
  const onStart = e => { startX.current = e.touches?e.touches[0].clientX:e.clientX; };
  const onMove = e => {
    const x = e.touches?e.touches[0].clientX:e.clientX;
    const dx = x - startX.current;
    setOffset(dx);
    setDecision(dx>threshold?"yes":dx<-threshold?"no":null);
  };
  const onEnd = () => {
    if (Math.abs(offset)>threshold) {
      const dir = offset>0?"yes":"no";
      setExiting(true); setOffset(dir==="yes"?400:-400);
      setTimeout(()=>dir==="yes"?onAccept():onSkip(), 250);
    } else { setOffset(0); setDecision(null); }
  };
  const elapsed = task.elapsedMs||0;
  return (
    <div style={{position:"relative",width:"100%",minHeight:200,display:"flex",justifyContent:"center",marginBottom:12}}>
      <div style={{position:"absolute",inset:0,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 24px"}}>
        <div style={{opacity:decision==="no"?.9:.12,transition:"opacity .15s",textAlign:"center"}}>
          <div style={{width:44,height:44,borderRadius:22,background:M.errorC,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 4px"}}><Ic d={ic.x} s={22} c={M.error}/></div>
          <span style={{...T.labelS,color:M.error}}>Skip</span>
        </div>
        <div style={{opacity:decision==="yes"?.9:.12,transition:"opacity .15s",textAlign:"center"}}>
          <div style={{width:44,height:44,borderRadius:22,background:M.tertiaryC,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 4px"}}><Ic d={ic.check} s={22} c={M.tertiary}/></div>
          <span style={{...T.labelS,color:M.tertiary}}>Include</span>
        </div>
      </div>
      <div
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        onMouseDown={onStart} onMouseMove={e=>{if(e.buttons===1)onMove(e)}} onMouseUp={onEnd} onMouseLeave={()=>{if(offset)onEnd()}}
        style={{
          position:"relative",width:"88%",background:decision==="yes"?M.tertiaryC:decision==="no"?M.errorC:M.surface,
          borderRadius:20,padding:"18px 20px",boxShadow:elev(2),
          transform:`translateX(${offset}px) rotate(${Math.min(Math.max(offset*.04,-6),6)}deg)`,
          transition:exiting?"transform .25s ease":"transform .08s ease",
          cursor:"grab",userSelect:"none",zIndex:2,
          border:`2px solid ${decision==="yes"?M.tertiary:decision==="no"?M.error:M.outlineV}`,
          boxSizing:"border-box",
        }}
      >
        <div style={{...T.titleM,color:M.onSurface,marginBottom:6}}>{task.name}</div>
        {task.description&&<div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:8}}>{task.description}</div>}
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
          <PBadge p={task.priority}/><TBadge t={task.type}/><EBadge e={task.effortLevel}/>
          {task.rail&&<span style={{...T.labelS,padding:"2px 8px",borderRadius:6,background:M.primaryC,color:M.onPrimaryC}}>{task.rail}</span>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
          <div><div style={{...T.labelS,color:M.outline,textTransform:"uppercase"}}>Impact</div><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>{task.impactPoints?`×${task.impactPoints}`:"-"}</div></div>
          <div><div style={{...T.labelS,color:M.outline,textTransform:"uppercase"}}>Due</div><div style={{...T.titleS,color:M.onSurface}}>{task.dueDate?relDate(task.dueDate):"-"}</div></div>
          <div><div style={{...T.labelS,color:M.outline,textTransform:"uppercase"}}>Logged</div><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>{elapsed>0?fmtHrs(elapsed)+"h":"—"}</div></div>
        </div>
        {task.parentTask&&<div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:6}}>↳ {task.parentTask}</div>}
        <button onClick={e=>{e.stopPropagation();onEdit&&onEdit();}} style={{
          display:"flex",alignItems:"center",gap:6,margin:"8px auto 0",
          padding:"6px 14px",borderRadius:12,background:M.surfaceCH,border:"none",
          cursor:"pointer",...T.labelS,color:M.onSurfaceV,fontFamily:font,
        }}>Edit before deciding</button>
        <div style={{...T.bodyS,color:M.outline,marginTop:10,textAlign:"center"}}>← skip · include tomorrow →</div>
      </div>
    </div>
  );
};
/* ══ RITUAL SWIPE CARD ══ */
const RitualSwipeCard = ({ritual, onDone, onMissed, onLater}) => {
  const startPos = useRef({x:0,y:0});
  const [offX, setOffX] = useState(0);
  const [offY, setOffY] = useState(0);
  const [decision, setDecision] = useState(null);
  const [exiting, setExiting] = useState(false);
  const thresh = 70;
  const onS = e => {
    const pt = e.touches?e.touches[0]:e;
    startPos.current = {x:pt.clientX, y:pt.clientY};
  };
  const onM = e => {
    const pt = e.touches?e.touches[0]:e;
    const dx = pt.clientX - startPos.current.x;
    const dy = pt.clientY - startPos.current.y;
    if(Math.abs(dy) > Math.abs(dx) && dy < -thresh) {
      setOffX(0); setOffY(dy); setDecision("later");
    } else {
      setOffY(0); setOffX(dx);
      setDecision(dx>thresh?"done":dx<-thresh?"missed":null);
    }
  };
  const onE = () => {
    if(decision==="later") {
      setExiting(true); setOffY(-400);
      setTimeout(()=>onLater&&onLater(), 250);
    } else if(decision==="done"||decision==="missed") {
      setExiting(true); setOffX(decision==="done"?400:-400);
      setTimeout(()=>decision==="done"?onDone():onMissed(), 250);
    } else { setOffX(0); setOffY(0); setDecision(null); }
  };
  const bgC = decision==="done"?M.tertiaryC:decision==="missed"?M.errorC:decision==="later"?M.secondaryC:M.surface;
  const borderC = decision==="done"?M.tertiary:decision==="missed"?M.error:decision==="later"?M.secondary:M.outlineV;
  return (
    <div style={{position:"relative",width:"100%",minHeight:220,display:"flex",justifyContent:"center",alignItems:"center",marginBottom:16}}>
      <div style={{position:"absolute",inset:0,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 16px"}}>
        <div style={{opacity:decision==="missed"?.9:.08,transition:"opacity .15s",textAlign:"center"}}>
          <div style={{width:44,height:44,borderRadius:22,background:M.errorC,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 4px"}}><Ic d={ic.x} s={22} c={M.error}/></div>
          <span style={{...T.labelS,color:M.error}}>Missed</span>
        </div>
        <div style={{opacity:decision==="done"?.9:.08,transition:"opacity .15s",textAlign:"center"}}>
          <div style={{width:44,height:44,borderRadius:22,background:M.tertiaryC,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 4px"}}><Ic d={ic.check} s={22} c={M.tertiary}/></div>
          <span style={{...T.labelS,color:M.tertiary}}>Done</span>
        </div>
      </div>
      <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",opacity:decision==="later"?.9:.08,transition:"opacity .15s",textAlign:"center"}}>
        <div style={{width:44,height:44,borderRadius:22,background:M.secondaryC,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 4px"}}><Ic d={ic.clock} s={22} c={M.secondary}/></div>
        <span style={{...T.labelS,color:M.secondary}}>Later</span>
      </div>
      <div
        onTouchStart={onS} onTouchMove={onM} onTouchEnd={onE}
        onMouseDown={onS} onMouseMove={e=>{if(e.buttons===1)onM(e)}} onMouseUp={onE} onMouseLeave={()=>{if(offX||offY)onE()}}
        style={{
          position:"relative",width:"85%",
          background:bgC,borderRadius:24,padding:"32px 24px",boxShadow:elev(2),textAlign:"center",
          transform:`translateX(${offX}px) translateY(${offY}px) rotate(${Math.min(Math.max(offX*.04,-6),6)}deg)`,
          transition:exiting?"transform .25s ease":"transform .08s ease",
          cursor:"grab",userSelect:"none",zIndex:2,
          border:`2px solid ${borderC}`,boxSizing:"border-box",
        }}
      >
        <div style={{fontSize:48,marginBottom:12}}>{ritual.emoji}</div>
        <div style={{...T.titleL,color:M.onSurface,marginBottom:6}}>{ritual.label}</div>
        <div style={{...T.bodyM,color:M.onSurfaceV}}>{ritual.desc}</div>
        <div style={{...T.bodyS,color:M.outline,marginTop:16}}>← missed · done → · ↑ later</div>
      </div>
    </div>
  );
};
/* ══ NEXT DAY PLANNER ══ */
const NextDayPlanner = ({open, onClose, tasks, setTasks}) => {
  const active = tasks.filter(t=>t.status!=="Done");
  const [queue, setQueue] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  useEffect(()=>{ if(open){ setQueue([...active]); setScheduled([]); setSkipped([]); setEditingTask(null); } },[open]);
  const tmrw = tomorrow();
  const cur = queue[0];
  const accept = () => { setScheduled(s=>[...s,cur]); setQueue(q=>q.slice(1)); };
  const skip = () => { setSkipped(s=>[...s,cur]); setQueue(q=>q.slice(1)); };
  const saveEdit = (updated) => {
    const next = tasks.map(t=>t.id===updated.id?updated:t);
    setTasks(next); save("cc_tasks",next);
    setQueue(q=>q.map(t=>t.id===updated.id?updated:t));
    setEditingTask(null);
  };
  const finalize = () => {
    const ids = new Set(scheduled.map(t=>t.id));
    const next = tasks.map(t=>ids.has(t.id)?{...t,dueDate:tmrw,status:t.status==="Not started"?"Scheduled":t.status}:t);
    setTasks(next); save("cc_tasks",next); onClose();
  };
  if(!open) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",justifyContent:"center"}}>
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}}/>
      <div style={{position:"relative",width:"100%",maxWidth:600,height:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
        <div style={{position:"relative",background:M.bg,borderRadius:"28px 28px 0 0",padding:"0 20px 36px",maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:elev(3),boxSizing:"border-box"}}>
        <div style={{padding:"12px 0 0",display:"flex",justifyContent:"center"}}><div style={{width:32,height:4,borderRadius:2,background:M.outlineV}}/></div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 4px 8px"}}>
          <div>
            <div style={{...T.titleL,color:M.onSurface}}>Plan Tomorrow</div>
            <div style={{...T.bodyS,color:M.onSurfaceV,marginTop:2}}>Review each task, edit if needed, then swipe</div>
          </div>
          <button onClick={onClose} style={{background:M.surfaceCH,border:"none",cursor:"pointer",width:36,height:36,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={ic.x} s={18} c={M.onSurfaceV}/></button>
        </div>
        <div style={{display:"flex",gap:10,padding:"12px 4px 16px"}}>
          <span style={{...T.labelM,color:M.tertiary,background:M.tertiaryC,padding:"4px 12px",borderRadius:8}}>✓ {scheduled.length}</span>
          <span style={{...T.labelM,color:M.error,background:M.errorC,padding:"4px 12px",borderRadius:8}}>✗ {skipped.length}</span>
          <span style={{...T.labelM,color:M.onSurfaceV,background:M.surfaceCH,padding:"4px 12px",borderRadius:8}}>{queue.length} left</span>
        </div>
        <div style={{flex:1,overflow:"auto",minHeight:240}}>
          {editingTask ? (
            <div>
              <div style={{...T.titleM,color:M.onSurface,marginBottom:12}}>Edit before deciding</div>
              <Field label="Task Name" value={editingTask.name} onChange={v=>setEditingTask(t=>({...t,name:v}))} req/>
              <TextArea label="Description" value={editingTask.description||""} onChange={v=>setEditingTask(t=>({...t,description:v}))}/>
              <div style={{display:"flex",gap:12}}>
                <Dropdown label="Priority" value={editingTask.priority} onChange={v=>setEditingTask(t=>({...t,priority:v}))} options={PRIO}/>
                <Field label="Impact" value={editingTask.impactPoints} onChange={v=>setEditingTask(t=>({...t,impactPoints:v}))} type="number" ph="1-10" half/>
              </div>
              <Dropdown label="Type" value={editingTask.type} onChange={v=>setEditingTask(t=>({...t,type:v}))} options={SIGTYPES}/>
              <div style={{display:"flex",gap:10,marginTop:16}}>
                <BtnFilled label="Cancel" onClick={()=>setEditingTask(null)} color={M.surfaceCH} tc={M.onSurface}/>
                <BtnFilled label="Save & Back" onClick={()=>saveEdit(editingTask)} full/>
              </div>
            </div>
          ) : cur ? (
            <SwipeCard task={cur} onAccept={accept} onSkip={skip} onEdit={()=>setEditingTask({...cur})}/>
          ) : (
            <div style={{textAlign:"center",padding:"40px 20px"}}>
              <div style={{fontSize:48,marginBottom:16}}>🌙</div>
              <div style={{...T.titleM,color:M.onSurface,marginBottom:8}}>All reviewed</div>
              <div style={{...T.bodyM,color:M.onSurfaceV,marginBottom:24}}>{scheduled.length} task{scheduled.length!==1?"s":""} for tomorrow</div>
              <BtnFilled label="Confirm & Close" onClick={finalize} full/>
            </div>
          )}
        </div>
        {!editingTask&&cur&&<div style={{display:"flex",gap:16,padding:"12px 0 0",justifyContent:"center"}}>
          <button onClick={skip} style={{width:56,height:56,borderRadius:28,background:M.errorC,border:`2px solid ${M.error}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Ic d={ic.x} s={24} c={M.error}/></button>
          <button onClick={accept} style={{width:56,height:56,borderRadius:28,background:M.tertiaryC,border:`2px solid ${M.tertiary}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Ic d={ic.check} s={28} c={M.tertiary}/></button>
        </div>}
      </div>
      </div>
    </div>
  );
};
/* ─── Timer formatting ─── */
const fmtTimer = (ms) => {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
  const pad = n => String(n).padStart(2,"0");
  return h > 0 ? `${h}:${pad(m%60)}:${pad(s%60)}` : `${pad(m%60)}:${pad(s%60)}`;
};
const fmtHrs = (ms) => (ms/3600000).toFixed(1);
/* ══ TASK FORM ══ */
const TaskForm = ({task,setTask,onSave,saveLabel="Save",rails,onDelete,yearlyTasks=[]}) => {
  const t=task, s=f=>v=>setTask({...t,[f]:v});
  return (
    <div>
      <SectionHead label="What" icon="🎯"/>
      <Field label="Task Name" value={t.name} onChange={s("name")} ph="What needs to happen?" req/>
      <TextArea label="Description" value={t.description} onChange={s("description")} ph="Details, context..."/>
      <SectionHead label="Classification" icon="🏷"/>
      <Dropdown label="Priority" value={t.priority} onChange={s("priority")} options={PRIO} req/>
      <div style={{display:"flex",gap:12}}>
        <Dropdown label="Task Type" value={t.taskType} onChange={s("taskType")} options={TTYPES}/>
        <Dropdown label="Effort Level" value={t.effortLevel} onChange={s("effortLevel")} options={EFFORT}/>
      </div>
      <Dropdown label="Signal / Noise" value={t.type} onChange={s("type")} options={SIGTYPES}/>
      <SectionHead label="When" icon="⏱"/>
      <Field label="Due Date" value={t.dueDate} onChange={s("dueDate")} type="date"/>
      <div style={{marginBottom:16}}><label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:8,textTransform:"uppercase"}}>Timeline</label><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{TIMELINES.map(q=><FilterChip key={q} label={q} active={t.timeline===q} onClick={()=>s("timeline")(t.timeline===q?"":q)}/>)}</div></div>
      <SectionHead label="Value" icon="📊"/>
      <Field label="Impact Points (1-10)" value={t.impactPoints} onChange={s("impactPoints")} type="number" ph="How much does this matter?"/>
      <SectionHead label="Connections" icon="🔗"/>
      <Dropdown label="Rail" value={t.rail} onChange={s("rail")} options={rails.map(r=>r.name)} ph="Life rail"/>
      <Dropdown label="Parent Task" value={t.parentTask} onChange={s("parentTask")} options={yearlyTasks.length>0?yearlyTasks:["No yearly tasks yet"]} ph="Links to annual plan"/>
      <Dropdown label="Status" value={t.status} onChange={s("status")} options={STATUSES}/>
      <div style={{display:"flex",gap:12,marginTop:24}}>
        {onDelete&&<button onClick={onDelete} style={{width:52,height:52,borderRadius:16,background:M.errorC,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={ic.x} s={22} c={M.error}/></button>}
        <BtnFilled label={saveLabel} onClick={onSave} full disabled={!t.name.trim()}/>
      </div>
    </div>
  );
};
/* ══ TASK DETAIL ══ */
const TaskDetail = ({task,onClose,onSave,onDelete,onDuplicate,rails,tasks}) => {
  const [editing,setEditing]=useState(false);
  const [t,setT]=useState({...task});
  const [now,setNow]=useState(Date.now());
  const [showReschedule,setShowReschedule]=useState(false);
  const [newDate,setNewDate]=useState(task.dueDate||"");
  const [newTime,setNewTime]=useState(task.dueTime||"");
  const yearlyTasks = [...new Set(tasks.filter(x=>x.id!==task.id).map(x=>x.name))];
  useEffect(()=>{
    if(!task.timerActive) return;
    const iv=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(iv);
  },[task.timerActive]);
  const elapsed = task.timerActive ? task.elapsedMs + (now - (task.startedAt||now)) : task.elapsedMs;
  const isDue = task.dueDate && new Date(task.dueDate+"T23:59:59") < new Date();
  const isDone = task.status === "Done";
  const startTimer = () => { onSave({...task, timerActive:true, startedAt:Date.now(), status:task.status==="Not started"?"In progress":task.status}); };
  const pauseTimer = () => { const el=task.elapsedMs+(Date.now()-(task.startedAt||Date.now())); onSave({...task, timerActive:false, elapsedMs:el, startedAt:null, hrs:fmtHrs(el)}); };
  const completeTask = () => {
    const el = task.timerActive ? task.elapsedMs+(Date.now()-(task.startedAt||Date.now())) : task.elapsedMs;
    onSave({...task, timerActive:false, elapsedMs:el, startedAt:null, hrs:fmtHrs(el), status:"Done", completedOn:fmt(new Date()), score:1});
  };
  const markDone = () => { onSave({...task, timerActive:false, status:"Done", completedOn:fmt(new Date()), score:1}); };
  const reschedule = () => { if(newDate) { onSave({...task, dueDate:newDate, dueTime:newTime||""}); setShowReschedule(false); } };
  const quickReschedule = (offset) => {
    const d=new Date(); d.setDate(d.getDate()+offset);
    onSave({...task, dueDate:fmt(d), dueTime:""}); setShowReschedule(false);
  };
  if(editing) return (
    <Sheet open={true} onClose={onClose} title="Edit Task">
      <TaskForm task={t} setTask={setT} onSave={()=>{onSave(t);setEditing(false);}} saveLabel="Save" rails={rails} onDelete={onDelete} yearlyTasks={yearlyTasks}/>
    </Sheet>
  );
  return (
    <Sheet open={true} onClose={onClose} title="Task">
      <div style={{...T.headlineS,color:M.onSurface,marginBottom:4}}>{task.name}</div>
      {task.description&&<div style={{...T.bodyM,color:M.onSurfaceV,marginBottom:12}}>{task.description}</div>}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        <PBadge p={task.priority}/><TBadge t={task.type}/><EBadge e={task.effortLevel}/>
        {task.rail&&<span style={{...T.labelS,padding:"3px 10px",borderRadius:8,background:M.primaryC,color:M.onPrimaryC}}>{task.rail}</span>}
        {task.timeline&&<span style={{...T.labelS,padding:"3px 10px",borderRadius:8,background:M.secondaryC,color:M.onSecondaryC}}>{task.timeline}</span>}
        {task.recurring&&<span style={{...T.labelS,padding:"3px 10px",borderRadius:8,background:M.primaryC,color:M.onPrimaryC,display:"inline-flex",alignItems:"center",gap:4}}><Ic d={ic.repeat} s={12} c={M.onPrimaryC}/>{task.recurring}</span>}
      </div>
      {task.dueDate&&<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
        <Ic d={ic.clock} s={16} c={isDue?M.error:M.onSurfaceV}/>
        <span style={{...T.labelM,color:isDue?M.error:M.onSurfaceV}}>Due {relDate(task.dueDate)}{task.dueTime?` at ${task.dueTime}`:""}{isDue?" — overdue":""}</span>
        <button onClick={()=>setShowReschedule(!showReschedule)} style={{marginLeft:"auto",background:M.surfaceCH,border:"none",borderRadius:8,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
          <Ic d={ic.resch} s={14} c={M.onSurfaceV}/><span style={{...T.labelS,color:M.onSurfaceV}}>Reschedule</span>
        </button>
      </div>}
      {showReschedule&&<Card style={{padding:"16px",marginBottom:16,background:M.surfaceC,boxSizing:"border-box"}}>
        <div style={{...T.labelS,color:M.onSurfaceV,textTransform:"uppercase",marginBottom:10}}>Reschedule to</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          <FilterChip label="Today" active={false} onClick={()=>quickReschedule(0)}/>
          <FilterChip label="Tomorrow" active={false} onClick={()=>quickReschedule(1)}/>
          <FilterChip label="Day After" active={false} onClick={()=>quickReschedule(2)}/>
          <FilterChip label="Next Week" active={false} onClick={()=>quickReschedule(7)}/>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
          <Field label="Pick date" value={newDate} onChange={setNewDate} type="date" half/>
          <Field label="Time (opt)" value={newTime} onChange={setNewTime} type="time" half/>
        </div>
        <BtnFilled label="Set" onClick={reschedule} disabled={!newDate} full/>
      </Card>}
      {!isDone && (
        <Card style={{padding:"20px",marginBottom:16,background:task.timerActive?M.primaryC:M.surfaceC,textAlign:"center",boxSizing:"border-box"}}>
          <div style={{...T.labelS,color:M.onSurfaceV,textTransform:"uppercase",letterSpacing:"1px",marginBottom:8}}>
            {task.timerActive?"Working...":elapsed>0?"Paused":"Timer"}
          </div>
          <div style={{fontSize:36,fontWeight:700,fontFamily:mono,color:task.timerActive?M.onPrimaryC:M.onSurface,lineHeight:1,marginBottom:4}}>
            {fmtTimer(elapsed)}
          </div>
          {elapsed>0&&<div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:12}}>{fmtHrs(elapsed)}h logged</div>}
          <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            {task.timerActive ? (
              <>
                <BtnFilled label="Pause" onClick={pauseTimer} icon={ic.pause} color={M.secondary}/>
                <BtnFilled label="Complete" onClick={completeTask} icon={ic.check} color={M.tertiary} tc={M.onTertiary}/>
              </>
            ) : (
              <>
                <BtnFilled label={elapsed>0?"Resume":"Start Timer"} onClick={startTimer} icon={ic.play}/>
                <BtnFilled label="Mark Done" onClick={markDone} icon={ic.check} color={M.tertiary} tc={M.onTertiary}/>
              </>
            )}
          </div>
        </Card>
      )}
      {isDone && (
        <Card style={{padding:"16px",marginBottom:16,background:M.tertiaryC,textAlign:"center",boxSizing:"border-box"}}>
          <div style={{...T.labelM,color:M.onTertiaryC}}>✓ Completed {task.completedOn?relDate(task.completedOn):""}</div>
          {elapsed>0&&<div style={{...T.bodyS,color:M.onTertiaryC+"80",marginTop:4}}>{fmtHrs(elapsed)}h spent</div>}
        </Card>
      )}
      {/* Quick status actions */}
      {!isDone && (
        <div style={{marginBottom:16}}>
          <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:8}}>Set Status</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[
              {label:"Missed",status:"Missed",color:M.error,bg:M.errorC},
              {label:"Deferred",status:"Deffered",color:M.outline,bg:M.surfaceCH},
              {label:"Paused",status:"Paused",color:M.info,bg:M.infoC},
              {label:"Not Started",status:"Not started",color:M.onSurfaceV,bg:M.surfaceCH},
              {label:"Scheduled",status:"Scheduled",color:M.warn,bg:M.warnC},
            ].map(opt=>(
              <button key={opt.label} onClick={()=>onSave({...task,status:opt.status,completedOn:"",score:0})}
                style={{padding:"8px 14px",borderRadius:10,border:`1.5px solid ${task.status===opt.status?opt.color:M.outlineV}`,
                  background:task.status===opt.status?opt.bg:"transparent",
                  cursor:"pointer",fontFamily:font,...T.labelS,color:opt.color,
                  display:"flex",alignItems:"center",gap:5,opacity:task.status===opt.status?1:.7}}>
                {task.status===opt.status&&<Ic d={ic.check} s={12} c={opt.color}/>}{opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {isDone && (
        <div style={{marginBottom:16}}>
          <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:8}}>Change Status</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[
              {label:"Reopen",status:"In progress",color:M.primary,bg:M.primaryC},
              {label:"Missed",status:"Missed",color:M.error,bg:M.errorC},
              {label:"Not Started",status:"Not started",color:M.onSurfaceV,bg:M.surfaceCH},
            ].map(opt=>(
              <button key={opt.label} onClick={()=>onSave({...task,status:opt.status,completedOn:"",score:0})}
                style={{padding:"8px 14px",borderRadius:10,border:`1.5px solid ${opt.color}`,background:"transparent",
                  cursor:"pointer",fontFamily:font,...T.labelS,color:opt.color}}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1,background:M.outlineV,borderRadius:12,overflow:"hidden",marginBottom:16}}>
        {[
          ["Status",task.status],["Impact",task.impactPoints?`×${task.impactPoints}`:"-"],
          ["Effort",task.effortLevel||"-"],["Time Spent",elapsed>0?`${fmtHrs(elapsed)}h`:"-"],
          ["Due",task.dueDate?relDate(task.dueDate):"-"],["Parent",task.parentTask||"-"],
        ].map(([l,v],i)=>(
          <div key={i} style={{padding:"12px 14px",background:M.surface}}>
            <div style={{...T.labelS,color:M.onSurfaceV,textTransform:"uppercase",marginBottom:2}}>{l}</div>
            <div style={{...T.titleS,color:M.onSurface}}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {onDuplicate&&<button onClick={()=>{onDuplicate(task);onClose();}} style={{flex:1,padding:"12px",borderRadius:12,border:`1.5px solid ${M.info}`,background:"transparent",cursor:"pointer",fontFamily:font,...T.labelM,color:M.info,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Ic d={ic.plus} s={16} c={M.info}/>Duplicate</button>}
      </div>
      {/* Recurring */}
      <div style={{marginBottom:12}}>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:8}}>Make Recurring</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[{label:"Daily",days:1},{label:"Weekly",days:7},{label:"Monthly",days:30},{label:"Quarterly",days:90}].map(opt=>(
            <button key={opt.label} onClick={()=>{
              if(!onDuplicate) return;
              const now=new Date();
              const nextDate=new Date(now);
              nextDate.setDate(nextDate.getDate()+opt.days);
              const dup={...task,id:"t"+Date.now()+Math.random().toString(36).slice(2,6),dueDate:fmt(nextDate),status:"Not started",completedOn:"",timerActive:false,startedAt:null,elapsedMs:0,score:0,notionPageId:"",recurring:opt.label};
              onDuplicate(dup);
              onClose();
            }} style={{flex:1,padding:"10px 8px",borderRadius:12,border:`1.5px solid ${M.secondary}`,background:"transparent",cursor:"pointer",fontFamily:font,...T.labelM,color:M.secondary,display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:70}}>
              <Ic d={ic.repeat} s={16} c={M.secondary}/>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
      <BtnFilled label="Edit Task" onClick={()=>{setT({...task});setEditing(true);}} full/>
    </Sheet>
  );
};
/* ══ END-OF-DAY REVIEW ══ */
const EODReview = ({open,onClose,tasks,setTasks,days,setDays}) => {
  const today = fmt(new Date());
  const day = days?.[today]||emptyDay(today);
  const completed = tasks.filter(t=>t.completedOn===today);
  const [step, setStep] = useState(0);
  const [idx, setIdx] = useState(0);
  const [reviews, setReviews] = useState({});
  const [sleepAt, setSleepAt] = useState(day.sleepTime||"");
  const [dayNotes, setDayNotes] = useState("");
  const [wakeAlarm, setWakeAlarm] = useState("06:00");
  const m = computeDay(tasks, day, today);
  useEffect(()=>{
    if(open){
      setStep(0); setIdx(0); setSleepAt(day.sleepTime||""); setDayNotes(""); setWakeAlarm("06:00");
      const r = {};
      completed.forEach(t=>{ r[t.id] = {noiseFactor:t.noiseFactor||"", resultSatisfaction:t.resultSatisfaction||"", notes:t.notes||""}; });
      setReviews(r);
    }
  },[open]);
  const cur = completed[idx];
  const rev = cur ? (reviews[cur.id]||{}) : {};
  const setRev = (f,v) => setReviews(r=>({...r,[cur.id]:{...r[cur.id],[f]:v}}));
  const next = () => { if(idx<completed.length-1) setIdx(i=>i+1); };
  const prev = () => { if(idx>0) setIdx(i=>i-1); };
  const goToWindDown = () => {
    const updated = tasks.map(t=>{
      if(reviews[t.id]){ const r=reviews[t.id]; return {...t, noiseFactor:r.noiseFactor, resultSatisfaction:r.resultSatisfaction, notes:r.notes}; }
      return t;
    });
    setTasks(updated); save("cc_tasks",updated);
    setStep(1);
  };
  const finalize = () => {
    if(days && setDays) {
      const updated = {...days, [today]: {...day, sleepTime:sleepAt, eodNotes:dayNotes, wakeAlarm, reviewed:true}};
      setDays(updated); save("cc_days", updated);
    }
    onClose();
  };
  const taskPct = m.totalTasks>0?Math.round((m.tasksDone/m.totalTasks)*100):0;
  const impactPct = m.impactExpected>0?Math.round((m.impactAchieved/m.impactExpected)*100):0;
  const getGrade = () => {
    let score = 0;
    if(taskPct>=80) score+=3; else if(taskPct>=50) score+=2; else if(taskPct>0) score+=1;
    if(impactPct>=80) score+=3; else if(impactPct>=50) score+=2; else if(impactPct>0) score+=1;
    if(m.snr>=5) score+=3; else if(m.snr>=1) score+=2; else if(m.snr>0) score+=1;
    if(m.ritualsDone>=4) score+=2; else if(m.ritualsDone>=2) score+=1;
    if(m.sleepMet) score+=1;
    if(score>=11) return {grade:"A",emoji:"🔥",msg:"Outstanding day!"};
    if(score>=8) return {grade:"B",emoji:"💪",msg:"Solid performance."};
    if(score>=5) return {grade:"C",emoji:"📈",msg:"Decent day with room to grow."};
    if(score>=3) return {grade:"D",emoji:"⚠️",msg:"Challenging day. Tomorrow is fresh."};
    return {grade:"F",emoji:"🔄",msg:"Tough one. Reflect and reset."};
  };
  const perf = getGrade();
  const getAdvice = () => {
    const tips = [];
    if(taskPct<50) tips.push("Break tomorrow's tasks into smaller pieces.");
    if(m.noiseHrs>2) tips.push(`${m.noiseHrs.toFixed(1)}h of noise. Try time-blocking focus hours.`);
    if(m.ritualsDone<3) tips.push(`Only ${m.ritualsDone}/5 rituals. Stack them into your morning routine.`);
    if(!m.sleepMet&&m.sleepHrs>0) tips.push(`${m.sleepHrs.toFixed(1)}h sleep is below ${SLEEP_TARGET}h target.`);
    if(tips.length===0) tips.push("Keep this momentum going!");
    return tips;
  };
  const tmrw = tomorrow();
  const tmrwTasks = tasks.filter(t=>t.dueDate===tmrw&&t.status!=="Done");
  const calcSleepFromAlarm = () => {
    if(!sleepAt||!wakeAlarm) return 0;
    const sH=parseTime(sleepAt),wH=parseTime(wakeAlarm);
    if(sH===null||wH===null) return 0;
    return wH>sH ? wH-sH : (24-sH)+wH;
  };
  if(!open) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",justifyContent:"center"}}>
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}}/>
      <div style={{position:"relative",width:"100%",maxWidth:600,height:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
        <div style={{position:"relative",background:M.bg,borderRadius:"28px 28px 0 0",padding:"0 20px 36px",maxHeight:"90vh",overflowY:"auto",boxShadow:elev(3),boxSizing:"border-box"}}>
          <div style={{padding:"12px 0 0",display:"flex",justifyContent:"center"}}><div style={{width:32,height:4,borderRadius:2,background:M.outlineV}}/></div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 0 12px"}}>
            <div><div style={{...T.titleL,color:M.onSurface}}>End-of-Day Review</div><div style={{...T.bodyS,color:M.onSurfaceV,marginTop:2}}>Rate today's completed tasks</div></div>
            <button onClick={onClose} style={{background:M.surfaceCH,border:"none",cursor:"pointer",width:36,height:36,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={ic.x} s={18} c={M.onSurfaceV}/></button>
          </div>
          {step===0 ? (<>
          {completed.length===0 ? (
            <div style={{textAlign:"center",padding:"40px 20px"}}><div style={{fontSize:40,marginBottom:12}}>📭</div><div style={{...T.titleM,color:M.onSurface,marginBottom:8}}>No tasks completed today</div><BtnFilled label="Wind Down →" onClick={()=>setStep(1)} full/></div>
          ) : cur ? (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
                <Bar value={idx+1} max={completed.length} color={M.primary} h={4}/>
                <span style={{...T.labelM,color:M.onSurfaceV,whiteSpace:"nowrap"}}>{idx+1}/{completed.length}</span>
              </div>
              <Card style={{padding:"16px",marginBottom:16,boxSizing:"border-box"}}>
                <div style={{...T.titleM,color:M.onSurface,marginBottom:4}}>{cur.name}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}><PBadge p={cur.priority}/><TBadge t={cur.type}/></div>
              </Card>
              <div style={{marginBottom:16}}>
                <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:8,textTransform:"uppercase"}}>Result Satisfaction</label>
                <div style={{display:"flex",gap:6}}>
                  {[1,2,3,4,5].map(n=>(
                    <button key={n} onClick={()=>setRev("resultSatisfaction",String(n))} style={{width:48,height:48,borderRadius:12,border:`2px solid ${rev.resultSatisfaction===String(n)?M.primary:M.outlineV}`,background:rev.resultSatisfaction===String(n)?M.primaryC:M.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",...T.titleM,color:rev.resultSatisfaction===String(n)?M.onPrimaryC:M.onSurfaceV,fontFamily:font}}>{n}</button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:16}}>
                <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:8,textTransform:"uppercase"}}>Noise Factor (0-10)</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[0,1,2,3,4,5,6,7,8,9,10].map(n=>(
                    <button key={n} onClick={()=>setRev("noiseFactor",String(n))} style={{width:36,height:36,borderRadius:10,border:`1.5px solid ${rev.noiseFactor===String(n)?M.error:M.outlineV}`,background:rev.noiseFactor===String(n)?M.errorC:M.surface,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",...T.labelM,color:rev.noiseFactor===String(n)?M.onErrorC:M.onSurfaceV,fontFamily:font}}>{n}</button>
                  ))}
                </div>
              </div>
              <TextArea label="Notes" value={rev.notes||""} onChange={v=>setRev("notes",v)} ph="Anything to adjust next time?"/>
              <div style={{display:"flex",gap:10,marginTop:16}}>
                {idx>0&&<BtnFilled label="Back" onClick={prev} color={M.surfaceCH} tc={M.onSurface}/>}
                <div style={{flex:1}}/>
                {idx<completed.length-1 ? <BtnFilled label="Next" onClick={next}/> : <BtnFilled label="Wind Down →" onClick={goToWindDown} color={M.secondary} tc={M.onSecondary}/>}
              </div>
            </div>
          ) : null}
          </>) : (
            <div>
              <div style={{textAlign:"center",marginBottom:20}}>
                <span style={{fontSize:56}}>{perf.emoji}</span>
                <div style={{fontSize:48,fontWeight:800,fontFamily:mono,color:M.onSurface,marginTop:4}}>{perf.grade}</div>
                <div style={{...T.titleM,color:M.onSurface,marginTop:4}}>Day Complete</div>
                <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:4}}>{perf.msg}</div>
              </div>
              <Card style={{padding:"16px",marginBottom:12,boxSizing:"border-box"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
                  <div style={{textAlign:"center"}}><div style={{...T.headlineS,color:M.tertiary,fontFamily:mono}}>{taskPct}%</div><div style={{...T.labelS,color:M.onSurfaceV}}>Tasks</div><div style={{...T.bodyS,color:M.outline}}>{m.tasksDone}/{m.totalTasks}</div></div>
                  <div style={{textAlign:"center"}}><div style={{...T.headlineS,color:M.primary,fontFamily:mono}}>{impactPct}%</div><div style={{...T.labelS,color:M.onSurfaceV}}>Impact</div><div style={{...T.bodyS,color:M.outline}}>{m.impactAchieved}/{m.impactExpected}</div></div>
                  <div style={{textAlign:"center"}}><div style={{...T.headlineS,color:snrClr(m.snr),fontFamily:mono}}>{m.snr.toFixed(1)}</div><div style={{...T.labelS,color:M.onSurfaceV}}>SNR</div><div style={{...T.bodyS,color:snrClr(m.snr)}}>{snrLbl(m.snr)}</div></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
                  <div style={{textAlign:"center",padding:"8px 0",background:M.surfaceC,borderRadius:8}}><div style={{...T.titleS,fontFamily:mono,color:M.onSurface}}>{m.ritualsDone}/5</div><div style={{...T.labelS,color:M.outline,fontSize:9}}>Rituals</div></div>
                  <div style={{textAlign:"center",padding:"8px 0",background:M.surfaceC,borderRadius:8}}><div style={{...T.titleS,fontFamily:mono,color:M.error}}>{m.noiseHrs.toFixed(1)}h</div><div style={{...T.labelS,color:M.outline,fontSize:9}}>Noise</div></div>
                  <div style={{textAlign:"center",padding:"8px 0",background:M.surfaceC,borderRadius:8}}><div style={{...T.titleS,fontFamily:mono,color:M.onSurface}}>₦{(m.spend/1000).toFixed(0)}k</div><div style={{...T.labelS,color:M.outline,fontSize:9}}>Spend</div></div>
                  <div style={{textAlign:"center",padding:"8px 0",background:m.sleepMet?M.tertiaryC:M.errorC,borderRadius:8}}><div style={{...T.titleS,fontFamily:mono,color:m.sleepMet?M.onTertiaryC:M.onErrorC}}>{m.sleepHrs>0?m.sleepHrs.toFixed(1)+"h":"—"}</div><div style={{...T.labelS,color:m.sleepMet?M.tertiary:M.error,fontSize:9}}>Sleep</div></div>
                </div>
              </Card>
              <Card style={{padding:"16px",marginBottom:12,background:M.primaryC,boxSizing:"border-box"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><span style={{fontSize:20}}>💡</span><span style={{...T.titleS,color:M.onPrimaryC}}>Advice for tomorrow</span></div>
                {getAdvice().map((tip,i)=>(<div key={i} style={{display:"flex",gap:8,marginBottom:8}}><span style={{...T.bodyS,color:M.primary,flexShrink:0}}>→</span><span style={{...T.bodyS,color:M.onPrimaryC}}>{tip}</span></div>))}
              </Card>
              {tmrwTasks.length>0&&<Card style={{padding:"16px",marginBottom:12,boxSizing:"border-box"}}>
                <div style={{...T.titleS,color:M.onSurface,marginBottom:8}}>Tomorrow — {tmrwTasks.length} tasks</div>
                {tmrwTasks.slice(0,4).map(t=>(<div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${M.outlineV}`}}><PBadge p={t.priority}/><span style={{...T.bodyS,color:M.onSurface,flex:1}}>{t.name}</span>{t.impactPoints&&<span style={{...T.labelS,color:M.primary,fontFamily:mono}}>×{t.impactPoints}</span>}</div>))}
              </Card>}
              <Card style={{padding:"16px",marginBottom:12,boxSizing:"border-box",background:M.onSurface}}>
                <div style={{...T.titleS,color:"#FFF",marginBottom:12}}>🌙 Sleep Schedule</div>
                <div style={{display:"flex",gap:12,marginBottom:12}}>
                  <div style={{flex:1}}>
                    <div style={{...T.labelS,color:"rgba(255,255,255,.5)",textTransform:"uppercase",marginBottom:4}}>Sleep now</div>
                    <input type="time" value={sleepAt} onChange={e=>{setSleepAt(e.target.value);const sH=parseTime(e.target.value);if(sH!==null){const wake=(sH+SLEEP_TARGET)%24;setWakeAlarm(`${String(Math.floor(wake)).padStart(2,"0")}:${String(Math.round((wake%1)*60)).padStart(2,"0")}`);}}} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.1)",fontFamily:mono,...T.titleM,color:"#FFF",outline:"none",boxSizing:"border-box"}}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{...T.labelS,color:"rgba(255,255,255,.5)",textTransform:"uppercase",marginBottom:4}}>Wake up at</div>
                    <input type="time" value={wakeAlarm} onChange={e=>setWakeAlarm(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.1)",fontFamily:mono,...T.titleM,color:"#FFF",outline:"none",boxSizing:"border-box"}}/>
                  </div>
                </div>
                {sleepAt&&wakeAlarm&&(()=>{const hrs=calcSleepFromAlarm();const met=hrs>=SLEEP_TARGET;return(<div style={{textAlign:"center",padding:"10px",borderRadius:10,background:met?"rgba(168,219,143,.15)":"rgba(255,180,171,.15)"}}><div style={{...T.titleM,fontFamily:mono,color:met?"#A8DB8F":"#FFB4AB"}}>{hrs.toFixed(1)}h sleep</div><div style={{...T.bodyS,color:met?"#A8DB8F":"#FFB4AB",marginTop:2}}>{met?`✓ Meets ${SLEEP_TARGET}h target`:`⚠ ${(SLEEP_TARGET-hrs).toFixed(1)}h short`}</div></div>);})()}
                <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"center"}}>
                  {["05:00","05:30","06:00","06:30","07:00"].map(t=>(<button key={t} onClick={()=>setWakeAlarm(t)} style={{padding:"6px 10px",borderRadius:8,border:wakeAlarm===t?"2px solid #A8DB8F":"1px solid rgba(255,255,255,.15)",background:wakeAlarm===t?"rgba(168,219,143,.15)":"transparent",cursor:"pointer",fontFamily:mono,...T.labelS,color:"rgba(255,255,255,.7)"}}>{t}</button>))}
                </div>
              </Card>
              <TextArea label="Reflections (optional)" value={dayNotes} onChange={setDayNotes} ph="Wins, lessons, gratitude..."/>
              <BtnFilled label="Good Night 🌙" onClick={finalize} full color={M.secondary} tc={M.onSecondary}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
/* ══ TODAY ══ */
const TodayView = ({days,setDays,tasks,setTasks,openPlanner,rails,openEOD,settings}) => {
  const today=fmt(new Date()),day=days[today]||emptyDay(today);
  const [showSpend,setShowSpend]=useState(false);
  const [showNoise,setShowNoise]=useState(false);
  const [showQuickTask,setShowQuickTask]=useState(false);
  const [showMorning,setShowMorning]=useState(false);
  const [fabOpen,setFabOpen]=useState(false);
  const [snrExpanded,setSnrExpanded]=useState(false);
  const [secOpen,setSecOpen]=useState({rituals:true,dueToday:true,overdue:true,completed:true,noise:true,spend:true});
  const togSec=k=>setSecOpen(s=>({...s,[k]:!s[k]}));
  const [morningSlept,setMorningSlept]=useState("");
  const [morningWoke,setMorningWoke]=useState("");
  const [spendAmt,setSpendAmt]=useState("");
  const [spendNote,setSpendNote]=useState("");
  const [spendCat,setSpendCat]=useState("Food");
  const SPEND_CATS=["Food","Transport","Shopping","Bills","Entertainment","Health","Education","Other"];
  const [noiseHrs,setNoiseHrs]=useState("");
  const [noiseMin,setNoiseMin]=useState("");
  const [noiseNote,setNoiseNote]=useState("");
  const [noiseType,setNoiseType]=useState("Noise – Distraction");
  const [quickTask,setQuickTask]=useState(emptyTask());
  const [viewing,setViewing]=useState(null);
  const [tick,setTick]=useState(0);
  const upd=(f,v)=>{const n={...days,[today]:{...day,[f]:v}};setDays(n);save("cc_days",n);};
  const tog=f=>{const cy={ns:"done",done:"missed",missed:"ns"};upd(f,cy[day[f]]||"done");};
  const m = computeDay(tasks, day, today);
  useEffect(()=>{
    const hasActive = tasks.some(t=>t.timerActive);
    if(!hasActive) return;
    const iv=setInterval(()=>setTick(t=>t+1),1000);
    return ()=>clearInterval(iv);
  },[tasks]);
  const toggleTask = (id) => {
    const t = tasks.find(x=>x.id===id); if(!t) return;
    const wasDone = t.status==="Done";
    const el = t.timerActive ? t.elapsedMs+(Date.now()-(t.startedAt||Date.now())) : t.elapsedMs;
    const next = tasks.map(x => x.id===id ? {...x, status:wasDone?"In progress":"Done", completedOn:wasDone?"":today, timerActive:false, startedAt:null, elapsedMs:el, hrs:fmtHrs(el), score:wasDone?0:1} : x);
    setTasks(next); save("cc_tasks",next);
  };
  const updateTask = (u) => { const n=tasks.map(t=>t.id===u.id?u:t); setTasks(n); save("cc_tasks",n); setViewing(u); };
  const deleteTask = (id) => { const n=tasks.filter(t=>t.id!==id); setTasks(n); save("cc_tasks",n); setViewing(null); };
  const addSpend = () => {
    const amt=parseFloat(spendAmt); if(!amt||amt<=0) return;
    const entry = {id:"s"+Date.now(), amount:amt, note:spendNote, category:spendCat, time:new Date().toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"})};
    upd("spendLog", [...(day.spendLog||[]), entry]);
    setSpendAmt(""); setSpendNote("");
  };
  const removeSpend = (id) => { upd("spendLog", (day.spendLog||[]).filter(e=>e.id!==id)); };
  const logNoise = () => {
    const h=parseFloat(noiseHrs)||0, mn=parseFloat(noiseMin)||0;
    const totalHrs=h+(mn/60); if(totalHrs<=0) return;
    const nt={...emptyTask(), name:noiseNote||"Noise time", type:noiseType, hrs:String(+totalHrs.toFixed(2)), elapsedMs:totalHrs*3600000, status:"Done", completedOn:today, dueDate:today, taskType:"Admin", priority:"Low", impactPoints:"0", score:1};
    setTasks(p=>{const n=[...p,nt];save("cc_tasks",n);return n;});
    setNoiseHrs(""); setNoiseMin(""); setNoiseNote(""); setShowNoise(false);
  };
  const removeNoise = (id) => { setTasks(p=>{const n=p.filter(t=>t.id!==id);save("cc_tasks",n);return n;}); };
  const [morningStep,setMorningStep]=useState(0);
  const [ritualQueue,setRitualQueue]=useState([]);
  const ritualDefs=[
    {key:"exercise",label:"Exercise",emoji:"🏋️",desc:"Did you exercise today?"},
    {key:"sleep",label:"Sleep on time",emoji:"🛏️",desc:"Did you sleep on time last night?"},
    {key:"calendar",label:"Update Calendar",emoji:"📅",desc:"Is your calendar up to date?"},
    {key:"scheduling",label:"Next-day Scheduling",emoji:"📋",desc:"Did you plan tomorrow before bed?"},
    {key:"docPrep",label:"Document Prep",emoji:"📄",desc:"Documents ready for today?"},
  ];
  const saveMorning = () => {
    if(!morningSlept || !morningWoke) return;
    const updates = {...day, sleepTime:morningSlept, wakeUp:morningWoke};
    const n = {...days, [today]: updates};
    setDays(n); save("cc_days", n);
    setRitualQueue([...ritualDefs]);
    setMorningStep(1);
  };
  const ritualSwipe = (key, status) => {
    upd(key, status);
    setRitualQueue(q=>q.slice(1));
    if(ritualQueue.length<=1) { setShowMorning(false); setMorningStep(0); }
  };
  const quickNoise = (name, hrs) => {
    const nt={...emptyTask(), name, type:"Noise – Distraction", hrs:String(hrs), elapsedMs:hrs*3600000, status:"Done", completedOn:today, dueDate:today, taskType:"Admin", priority:"Low", impactPoints:"0", score:1};
    setTasks(p=>{const n=[...p,nt];save("cc_tasks",n);return n;});
  };
  const addQuickTask = () => {
    if(!quickTask.name.trim()) return;
    setTasks(p=>{const n=[...p,{...quickTask,dueDate:today}];save("cc_tasks",n);return n;});
    setQuickTask(emptyTask()); setShowQuickTask(false);
  };
  const active=tasks.filter(t=>t.status!=="Done");
  const doneToday=tasks.filter(t=>t.completedOn===today);
  const dueToday=active.filter(t=>t.dueDate===today);
  const overdue=active.filter(t=>t.dueDate&&t.dueDate<today);
  const d=new Date();
  const TI = ({t,accent}) => {
    const isDone = t.status==="Done";
    const elapsed = t.timerActive ? t.elapsedMs+(Date.now()-(t.startedAt||Date.now())) : t.elapsedMs;
    return (
      <Card onClick={()=>setViewing(t)} style={{padding:"14px 16px",marginBottom:8,borderLeft:`3px solid ${accent||M.outlineV}`,opacity:isDone?.55:1,boxSizing:"border-box"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span onClick={e=>{e.stopPropagation();toggleTask(t.id);}} style={{width:24,height:24,borderRadius:8,flexShrink:0,border:`2px solid ${isDone?M.tertiary:M.outline}`,background:isDone?M.tertiary:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
            {isDone&&<Ic d={ic.check} s={14} c="#FFF"/>}
          </span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{...T.titleS,color:M.onSurface,textDecoration:isDone?"line-through":"none"}}>{t.name}</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
              <PBadge p={t.priority}/><TBadge t={t.type}/><EBadge e={t.effortLevel}/>
              {t.recurring&&<span style={{...T.labelS,padding:"2px 8px",borderRadius:6,background:M.primaryC,color:M.onPrimaryC,display:"inline-flex",alignItems:"center",gap:3}}><Ic d={ic.repeat} s={10} c={M.onPrimaryC}/>{t.recurring}</span>}
              {t.timerActive&&<span style={{...T.labelS,color:M.primary,fontFamily:mono,background:M.primaryC,padding:"2px 8px",borderRadius:6}}>▶ {fmtTimer(elapsed)}</span>}
              {!t.timerActive&&elapsed>0&&!isDone&&<span style={{...T.labelS,color:M.onSurfaceV,fontFamily:mono}}>{fmtTimer(elapsed)}</span>}
            </div>
          </div>
          {t.impactPoints&&t.impactPoints!=="0"&&<span style={{...T.labelM,color:isDone?M.tertiary:M.primary,fontFamily:mono}}>×{t.impactPoints}</span>}
        </div>
      </Card>
    );
  };
  const fabItems = [
    {label:"Add Task",icon:ic.plus,color:M.primary,bg:M.primaryC,action:()=>{setFabOpen(false);setQuickTask({...emptyTask(),dueDate:today});setShowQuickTask(true);}},
    {label:"Log Noise",icon:"M13 2L3 14h9l-1 8 10-12h-9l1-8",color:M.error,bg:M.errorC,action:()=>{setFabOpen(false);setShowNoise(true);}},
    {label:"Add Spend",icon:"M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",color:M.secondary,bg:M.secondaryC,action:()=>{setFabOpen(false);setShowSpend(true);}},
  ];
  return (
    <div style={{paddingBottom:20}}>
      <div style={{marginBottom:24}}>
        <div style={{...T.labelL,color:M.primary,textTransform:"uppercase",letterSpacing:"0.8px"}}>{DAY[d.getDay()]}, {MON[d.getMonth()]} {d.getDate()}</div>
        <div style={{...T.headlineM,color:M.onSurface,marginTop:4}}>Today</div>
      </div>
      {/* SNR Card — tap to expand */}
      <Card elevated onClick={()=>setSnrExpanded(!snrExpanded)} style={{background:M.onSurface,marginBottom:16,boxSizing:"border-box",overflow:"hidden"}}>
        <div style={{padding:"20px 22px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{...T.labelS,color:"rgba(255,255,255,.45)",textTransform:"uppercase",letterSpacing:"1px"}}>Signal / Noise</div>
              <div style={{fontSize:40,fontWeight:700,color:"#FFF",fontFamily:mono,marginTop:4,lineHeight:1}}>{m.snr.toFixed(1)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{...T.bodyS,color:"rgba(255,255,255,.35)"}}>Tasks {m.tasksDone}/{m.totalTasks}</div>
              <div style={{...T.bodyS,color:"rgba(255,255,255,.35)",marginTop:2}}>Impact {m.impactAchieved}/{m.impactExpected}</div>
              <div style={{...T.bodyS,color:"#A8DB8F",marginTop:2}}>Signal {m.signal.toFixed(1)}</div>
              <div style={{...T.bodyS,color:m.noise>3?"#FFB4AB":"rgba(255,255,255,.35)",marginTop:2}}>Noise {m.noise.toFixed(1)}</div>
              <div style={{...T.bodyS,color:"rgba(255,255,255,.35)",marginTop:2}}>Rituals {m.ritualsDone}/5</div>
              {m.spend>0&&<div style={{...T.bodyS,color:"rgba(255,255,255,.35)",marginTop:2}}>₦{m.spend.toLocaleString()} spent</div>}
              {m.noiseHrs>0&&<div style={{...T.bodyS,color:"#FFB4AB",marginTop:2}}>{m.noiseHrs.toFixed(1)}h noise</div>}
              {m.sleepHrs>0&&<div style={{...T.bodyS,color:m.sleepMet?"#A8DB8F":"#FFB4AB",marginTop:2}}>{m.sleepMet?"😴":"⚠"} {m.sleepHrs.toFixed(1)}h sleep</div>}
            </div>
          </div>
          <div style={{marginTop:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{...T.labelM,color:m.snr>=5?"#A8DB8F":m.snr>=1?"#F9E866":"#FFB4AB"}}>{snrLbl(m.snr)}</span>
              <span style={{...T.bodyS,color:"rgba(255,255,255,.35)"}}>{snrDesc(m.snr)}</span>
            </div>
            <div style={{display:"flex",gap:3,height:8,borderRadius:4,overflow:"hidden"}}>
              <div style={{flex:1,borderRadius:"4px 0 0 4px",background:"#FFB4AB",opacity:m.snr<1?1:.2}}/>
              <div style={{flex:4,background:"#F9E866",opacity:m.snr>=1&&m.snr<5?1:.2}}/>
              <div style={{flex:5,background:"#A8DB8F",opacity:m.snr>=5&&m.snr<10?1:.2}}/>
              <div style={{flex:2,borderRadius:"0 4px 4px 0",background:"#FFD700",opacity:m.snr>=10?1:.2}}/>
            </div>
            <div style={{textAlign:"center",marginTop:12}}>
              <span style={{...T.bodyS,color:"rgba(255,255,255,.3)"}}>{snrExpanded?"Tap to collapse":"Tap for full breakdown"}</span>
              <div style={{transform:snrExpanded?"rotate(180deg)":"rotate(0deg)",transition:"transform .2s",display:"inline-block",marginLeft:6}}><Ic d={ic.down} s={14} c="rgba(255,255,255,.3)"/></div>
            </div>
          </div>
        </div>
        {/* Expanded section */}
        {snrExpanded&&<div style={{background:M.surface,borderTop:`1px solid ${M.outlineV}`}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
            {[
              ["Task Progress", m.totalTasks>0?Math.round((m.tasksDone/m.totalTasks)*100)+"%":"0%", m.tasksDone>0?M.tertiary:M.onSurfaceV],
              ["Total Tasks", `${m.tasksDone} / ${m.totalTasks}`, M.onSurface],
              ["Today's Impact", m.impactExpected.toFixed(0), M.primary],
              ["Achieved Impact", m.impactAchieved.toFixed(0), m.impactAchieved>=m.impactExpected?M.tertiary:M.warn],
              ["Signal Score", m.signal.toFixed(1), M.tertiary],
              ["Noise Score", m.noise.toFixed(1), m.noise>3?M.error:M.onSurface],
              ["Awake Time", m.awakeHrs.toFixed(1)+"h", M.onSurface],
              ["Distracted Time", m.noiseHrs>0?`${m.noiseHrs.toFixed(1)}h (${m.distractedPct}%)`:"0h", m.noiseHrs>2?M.error:M.onSurface],
              ["Spend (₦)", m.spend>0?"₦"+m.spend.toLocaleString():"₦0", M.onSurface],
              ["Wake / Sleep", `${day.wakeUp||"—"} → ${day.sleepTime||"—"}`, M.onSurface],
              ["Sleep Hours", m.sleepHrs>0?`${m.sleepHrs.toFixed(1)}h ${m.sleepMet?"✓":"⚠ <"+SLEEP_TARGET+"h"}`:"—", m.sleepMet?M.tertiary:m.sleepHrs>0?M.error:M.onSurfaceV],
            ].map(([label,value,color],i)=>(
              <div key={i} style={{padding:"12px 14px",borderBottom:`1px solid ${M.outlineV}`,borderRight:i%2===0?`1px solid ${M.outlineV}`:"none"}}>
                <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:3}}>{label}</div>
                <div style={{...T.titleS,color:color||M.onSurface,fontFamily:mono}}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"14px"}}>
            <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:8}}>Rituals</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {[["Exercise",day.exercise],["Sleep",day.sleep],["Calendar",day.calendar],["Scheduling",day.scheduling],["Doc Prep",day.docPrep]].map(([name,status])=>{
                const done=status==="done", missed=status==="missed";
                return <span key={name} style={{...T.labelS,padding:"4px 10px",borderRadius:8,background:done?M.tertiaryC:missed?M.errorC:M.surfaceCH,color:done?M.onTertiaryC:missed?M.onErrorC:M.outline}}>{done?"✓":missed?"✗":"○"} {name}</span>;
              })}
            </div>
          </div>
          {/* SNR Interpretation */}
          <div style={{padding:"12px 14px",borderBottom:`1px solid ${M.outlineV}`}}>
            <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:3}}>SNR Interpretation</div>
            <div style={{...T.titleS,color:snrClr(m.snr)}}>{snrLbl(m.snr)} — {snrDesc(m.snr)}</div>
          </div>
        </div>}
      </Card>
      {/* Plan Tomorrow + EOD Review */}
      <div style={{display:"flex",gap:10,marginBottom:20}}>
        <Card onClick={openPlanner} style={{flex:1,padding:"12px 14px",background:M.primaryC,border:`1px solid ${M.primary}30`,boxSizing:"border-box"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><Ic d={ic.sun} s={18} c={M.onPrimaryC}/><div><div style={{...T.titleS,color:M.onPrimaryC}}>Plan Tomorrow</div></div></div>
        </Card>
        <Card onClick={openEOD} style={{flex:1,padding:"12px 14px",background:doneToday.length>0?M.secondaryC:M.surfaceC,border:`1px solid ${doneToday.length>0?M.secondary:M.outlineV}30`,boxSizing:"border-box"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><Ic d={ic.moon2} s={18} c={doneToday.length>0?M.onSecondaryC:M.outline}/><div><div style={{...T.titleS,color:doneToday.length>0?M.onSecondaryC:M.outline}}>EOD Review</div></div></div>
        </Card>
      </div>
      {/* Morning Check-in */}
      {!day.wakeUp ? (
        <Card onClick={()=>{setMorningSlept(day.sleepTime||"");setMorningWoke("");setShowMorning(true);}} style={{padding:"16px 18px",marginBottom:16,background:M.infoC,border:`1px solid ${M.info}30`,boxSizing:"border-box",cursor:"pointer"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:28}}>🌅</span><div style={{flex:1}}><div style={{...T.titleS,color:M.onSurface}}>Morning Check-in</div><div style={{...T.bodyS,color:M.onSurfaceV}}>Log when you slept and woke up</div></div><Ic d={ic.chev} s={20} c={M.info}/></div>
        </Card>
      ) : (
        <Card style={{padding:"14px 16px",marginBottom:16,boxSizing:"border-box"}} onClick={()=>{setMorningSlept(day.sleepTime);setMorningWoke(day.wakeUp);setShowMorning(true);}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <span style={{fontSize:20}}>😴</span>
            <div style={{display:"flex",gap:16,flex:1,alignItems:"center"}}>
              <div><div style={{...T.labelS,color:M.outline,textTransform:"uppercase"}}>Slept</div><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>{day.sleepTime}</div></div>
              <div style={{...T.bodyS,color:M.outline}}>→</div>
              <div><div style={{...T.labelS,color:M.outline,textTransform:"uppercase"}}>Woke</div><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>{day.wakeUp}</div></div>
              <div style={{marginLeft:"auto",textAlign:"right"}}><div style={{...T.titleS,color:m.sleepMet?M.tertiary:M.error,fontFamily:mono}}>{m.sleepHrs.toFixed(1)}h</div><div style={{...T.labelS,color:m.sleepMet?M.tertiary:M.error}}>{m.sleepMet?"✓ on target":"⚠ low"}</div></div>
            </div>
          </div>
        </Card>
      )}
      {/* Quick Noise Bar */}
      <div style={{display:"flex",gap:8,marginBottom:16,overflowX:"auto",paddingBottom:4}}>
        {[["Scrolling",0.5],["Social media",1],["Unplanned chat",0.5],["Procrastinating",1],["Browsing",0.5]].map(([name,hrs])=>(
          <button key={name} onClick={()=>quickNoise(name,hrs)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:20,border:`1px solid ${M.error}30`,background:M.errorC+"20",cursor:"pointer",whiteSpace:"nowrap",fontFamily:font,...T.labelS,color:M.error,flexShrink:0}}><span>⚡</span>{name} ({hrs}h)</button>
        ))}
        <button onClick={()=>setShowNoise(true)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:20,border:`1.5px dashed ${M.error}50`,background:"transparent",cursor:"pointer",whiteSpace:"nowrap",fontFamily:font,...T.labelS,color:M.error,flexShrink:0}}><Ic d={ic.plus} s={14} c={M.error}/>Custom</button>
      </div>
      {/* Rituals — collapsible */}
      <div style={{marginBottom:24}}>
        <button onClick={()=>togSec("rituals")} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"0 0 12px",fontFamily:font}}>
          <div style={{transform:secOpen.rituals?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}><Ic d={ic.chev} s={16} c={M.onSurfaceV}/></div>
          <span style={{...T.labelL,color:M.onSurfaceV,textTransform:"uppercase",letterSpacing:".5px"}}>Daily Rituals</span>
          <span style={{...T.labelM,color:m.ritualsDone===5?M.tertiary:M.onSurfaceV,background:m.ritualsDone===5?M.tertiaryC:M.surfaceCH,padding:"2px 10px",borderRadius:10,fontFamily:mono}}>{m.ritualsDone}/5</span>
        </button>
        {secOpen.rituals&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
          <RitualItem label="Exercise" status={day.exercise} onToggle={()=>tog("exercise")}/>
          <RitualItem label="Sleep on time" status={day.sleep} onToggle={()=>tog("sleep")}/>
          <RitualItem label="Update Calendar" status={day.calendar} onToggle={()=>tog("calendar")}/>
          <RitualItem label="Next-day Scheduling" status={day.scheduling} onToggle={()=>{tog("scheduling");if(day.scheduling==="ns")setTimeout(openPlanner,400);}}/>
          <RitualItem label="Document Prep" status={day.docPrep} onToggle={()=>tog("docPrep")}/>
        </div>}
      </div>
      {/* Tasks — collapsible */}
      {dueToday.length>0&&<div style={{marginBottom:20}}>
        <button onClick={()=>togSec("dueToday")} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"0 0 10px",fontFamily:font}}>
          <div style={{transform:secOpen.dueToday?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}><Ic d={ic.chev} s={16} c={M.primary}/></div>
          <span style={{...T.labelL,color:M.onSurface,textTransform:"uppercase",letterSpacing:".5px"}}>Due Today</span>
          <span style={{...T.labelM,color:M.onPrimaryC,background:M.primaryC,padding:"2px 10px",borderRadius:10,fontFamily:mono}}>{dueToday.length}</span>
        </button>
        {secOpen.dueToday&&dueToday.map(t=><TI key={t.id} t={t} accent={M.primary}/>)}
      </div>}
      {overdue.length>0&&<div style={{marginBottom:20}}>
        <button onClick={()=>togSec("overdue")} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"0 0 10px",fontFamily:font}}>
          <div style={{transform:secOpen.overdue?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}><Ic d={ic.chev} s={16} c={M.error}/></div>
          <span style={{...T.labelL,color:M.error,textTransform:"uppercase",letterSpacing:".5px"}}>Overdue</span>
          <span style={{...T.labelM,color:M.onErrorC,background:M.errorC,padding:"2px 10px",borderRadius:10,fontFamily:mono}}>{overdue.length}</span>
        </button>
        {secOpen.overdue&&overdue.map(t=><TI key={t.id} t={t} accent={M.error}/>)}
      </div>}
      {/* Completed — collapsible */}
      {(()=>{
        const signalDone = doneToday.filter(t=>!(t.type||"").toLowerCase().includes("noise"));
        if(signalDone.length===0) return null;
        return (<div style={{marginBottom:20}}>
          <button onClick={()=>togSec("completed")} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"0 0 10px",fontFamily:font}}>
            <div style={{transform:secOpen.completed?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}><Ic d={ic.chev} s={16} c={M.tertiary}/></div>
            <span style={{...T.labelL,color:M.tertiary,textTransform:"uppercase",letterSpacing:".5px"}}>Completed Today</span>
            <span style={{...T.labelM,color:M.onTertiaryC,background:M.tertiaryC,padding:"2px 10px",borderRadius:10,fontFamily:mono}}>{signalDone.length}</span>
          </button>
          {secOpen.completed&&signalDone.map(t=><TI key={t.id} t={t} accent={M.tertiary}/>)}
        </div>);
      })()}
      {/* Noise + Spend — collapsible */}
      {(()=>{
        const noiseItems = doneToday.filter(t=>(t.type||"").toLowerCase().includes("noise"));
        const spendItems = day.spendLog || [];
        if(!noiseItems.length && !spendItems.length) return null;
        return (<div style={{marginBottom:20}}>
          {noiseItems.length>0 && <div style={{marginBottom:spendItems.length?16:0}}>
            <button onClick={()=>togSec("noise")} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"0 0 10px",fontFamily:font}}>
              <div style={{transform:secOpen.noise?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}><Ic d={ic.chev} s={16} c={M.error}/></div>
              <span style={{...T.labelL,color:M.error,textTransform:"uppercase",letterSpacing:".5px"}}>Noise Logged</span>
              <span style={{...T.labelS,color:M.onErrorC,background:M.errorC,padding:"2px 10px",borderRadius:10,fontFamily:mono}}>{m.noiseHrs.toFixed(1)}h · {noiseItems.length}</span>
            </button>
            {secOpen.noise&&noiseItems.map(t=>(
              <Card key={t.id} style={{padding:"12px 16px",marginBottom:8,borderLeft:`3px solid ${M.error}`,background:M.errorC+"30",boxSizing:"border-box"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <Ic d={"M13 2L3 14h9l-1 8 10-12h-9l1-8"} s={18} c={M.error}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{...T.titleS,color:M.onSurface}}>{t.name}</div>
                    <div style={{display:"flex",gap:6,marginTop:4,alignItems:"center"}}><TBadge t={t.type}/><span style={{...T.labelS,color:M.error,fontFamily:mono}}>{t.hrs||fmtHrs(t.elapsedMs||0)}h</span></div>
                  </div>
                  <button onClick={e=>{e.stopPropagation();removeNoise(t.id);}} style={{background:M.errorC,border:"none",borderRadius:8,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}><Ic d={ic.x} s={16} c={M.error}/></button>
                </div>
              </Card>
            ))}
          </div>}
          {spendItems.length>0 && <div>
            <button onClick={()=>togSec("spend")} style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",cursor:"pointer",padding:"0 0 10px",fontFamily:font}}>
              <div style={{transform:secOpen.spend?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}><Ic d={ic.chev} s={16} c={M.secondary}/></div>
              <span style={{...T.labelL,color:M.secondary,textTransform:"uppercase",letterSpacing:".5px"}}>Spend Today</span>
              <span style={{...T.labelS,color:M.onSecondaryC,background:M.secondaryC,padding:"2px 10px",borderRadius:10,fontFamily:mono}}>₦{m.spend.toLocaleString()} · {spendItems.length}</span>
            </button>
            {secOpen.spend&&spendItems.map((e,i)=>{
              const emojis={Food:"🍔",Transport:"🚗",Shopping:"🛍️",Bills:"📄",Entertainment:"🎬",Health:"💊",Education:"📚",Other:"📦"};
              return (<Card key={e.id||i} style={{padding:"10px 14px",marginBottom:6,borderLeft:`3px solid ${M.secondary}`,boxSizing:"border-box"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:16}}>{emojis[e.category]||"📦"}</span>
                  <div style={{flex:1,minWidth:0}}><div style={{...T.titleS,color:M.onSurface}}>{e.note||"Expense"}</div><span style={{...T.bodyS,color:M.outline}}>{e.time}</span></div>
                  <span style={{...T.titleS,color:M.onSurface,fontFamily:mono,flexShrink:0}}>₦{e.amount.toLocaleString()}</span>
                  <button onClick={()=>removeSpend(e.id)} style={{background:"none",border:"none",cursor:"pointer",padding:4,flexShrink:0}}><Ic d={ic.x} s={14} c={M.error}/></button>
                </div>
              </Card>);
            })}
          </div>}
        </div>);
      })()}
      {/* FAB */}
      {fabOpen&&<div style={{position:"fixed",inset:0,zIndex:90,display:"flex",justifyContent:"center"}}><div onClick={()=>setFabOpen(false)} style={{width:"100%",maxWidth:600,height:"100%",background:"rgba(0,0,0,.3)"}}/></div>}
      <div style={{position:"fixed",bottom:80,right:0,left:0,maxWidth:600,margin:"0 auto",pointerEvents:"none",zIndex:100,display:"flex",flexDirection:"column",alignItems:"flex-end",paddingRight:20,boxSizing:"border-box"}}>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12,alignItems:"flex-end",transition:"all .25s ease",opacity:fabOpen?1:0,transform:fabOpen?"translateY(0)":"translateY(20px)",pointerEvents:fabOpen?"auto":"none"}}>
          {fabItems.map((item,i)=>(<button key={i} onClick={item.action} style={{display:"flex",alignItems:"center",gap:10,pointerEvents:"auto",padding:"10px 16px 10px 12px",borderRadius:16,border:"none",background:M.surface,boxShadow:elev(2),cursor:"pointer",fontFamily:font}}>
            <div style={{width:36,height:36,borderRadius:10,background:item.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={item.icon} s={18} c={item.color}/></div>
            <span style={{...T.labelL,color:M.onSurface}}>{item.label}</span>
          </button>))}
        </div>
        <button onClick={()=>setFabOpen(!fabOpen)} style={{pointerEvents:"auto",width:56,height:56,borderRadius:16,background:fabOpen?M.onSurface:M.primary,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:elev(2),transition:"all .2s",transform:fabOpen?"rotate(45deg)":"rotate(0deg)"}}><Ic d={ic.plus} s={24} c="#FFF"/></button>
      </div>
      {/* Quick Task Sheet */}
      <Sheet open={showQuickTask} onClose={()=>setShowQuickTask(false)} title="Quick Task">
        <Field label="Task Name" value={quickTask.name} onChange={v=>setQuickTask(t=>({...t,name:v}))} ph="What needs to happen?" req/>
        <TextArea label="Description" value={quickTask.description||""} onChange={v=>setQuickTask(t=>({...t,description:v}))} ph="Context, details..."/>
        <div style={{display:"flex",gap:12}}><Dropdown label="Priority" value={quickTask.priority} onChange={v=>setQuickTask(t=>({...t,priority:v}))} options={PRIO} req/><Dropdown label="Task Type" value={quickTask.taskType} onChange={v=>setQuickTask(t=>({...t,taskType:v}))} options={TTYPES}/></div>
        <Dropdown label="Signal / Noise" value={quickTask.type} onChange={v=>setQuickTask(t=>({...t,type:v}))} options={SIGTYPES}/>
        <div style={{display:"flex",gap:12}}><Field label="Impact (1-10)" value={quickTask.impactPoints} onChange={v=>setQuickTask(t=>({...t,impactPoints:v}))} type="number" ph="5" half/><Field label="Due Date" value={quickTask.dueDate} onChange={v=>setQuickTask(t=>({...t,dueDate:v}))} type="date" half/></div>
        <Dropdown label="Rail" value={quickTask.rail} onChange={v=>setQuickTask(t=>({...t,rail:v}))} options={rails.map(r=>r.name)} ph="Life rail"/>
        <BtnFilled label="Add Task" onClick={addQuickTask} full disabled={!quickTask.name.trim()}/>
      </Sheet>
      {viewing&&<TaskDetail task={viewing} onClose={()=>setViewing(null)} onSave={u=>{updateTask(u);setViewing(u);}} onDelete={()=>deleteTask(viewing.id)} onDuplicate={dup=>{const n=[...tasks,{...emptyTask(),...dup,id:dup.id||"t"+Date.now()+Math.random().toString(36).slice(2,6)}];setTasks(n);save("cc_tasks",n);}} rails={rails} tasks={tasks}/>}
      {/* Morning Check-in */}
      {showMorning&&<div style={{position:"fixed",inset:0,zIndex:200,display:"flex",justifyContent:"center"}}>
        <div onClick={()=>{setShowMorning(false);setMorningStep(0);}} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}}/>
        <div style={{position:"relative",width:"100%",maxWidth:600,height:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
          <div style={{position:"relative",background:M.bg,borderRadius:"28px 28px 0 0",padding:"0 20px 36px",maxHeight:"92vh",overflowY:"auto",boxShadow:elev(3),boxSizing:"border-box"}}>
            <div style={{padding:"12px 0 0",display:"flex",justifyContent:"center"}}><div style={{width:32,height:4,borderRadius:2,background:M.outlineV}}/></div>
            {morningStep===0 ? (<div style={{padding:"20px 0 16px"}}>
              <div style={{textAlign:"center",marginBottom:20}}><span style={{fontSize:48}}>🌅</span><div style={{...T.titleL,color:M.onSurface,marginTop:8}}>Good morning</div><div style={{...T.bodyM,color:M.onSurfaceV,marginTop:4}}>When did you sleep and wake up?</div></div>
              <Field label="I slept at" value={morningSlept} onChange={setMorningSlept} type="time" req/>
              <Field label="I woke up at" value={morningWoke} onChange={setMorningWoke} type="time" req/>
              {morningSlept&&morningWoke&&(()=>{const wH=parseTime(morningWoke),sH=parseTime(morningSlept);const sleepCalc=wH!==null&&sH!==null?(wH>sH?wH-sH:(24-sH)+wH):0;const met=sleepCalc>=SLEEP_TARGET;return(<Card style={{padding:"16px",marginBottom:16,background:met?M.tertiaryC:M.errorC,boxSizing:"border-box",textAlign:"center"}}><div style={{fontSize:32,fontWeight:700,fontFamily:mono,color:met?M.onTertiaryC:M.onErrorC}}>{sleepCalc.toFixed(1)}h sleep</div><div style={{...T.bodyS,color:met?M.tertiary:M.error,marginTop:4}}>{met?`✓ Hit your ${SLEEP_TARGET}h target`:`⚠ ${(SLEEP_TARGET-sleepCalc).toFixed(1)}h short`}</div></Card>);})()}
              <BtnFilled label="Next — Check Rituals" onClick={saveMorning} full disabled={!morningSlept||!morningWoke}/>
            </div>) : (<div style={{padding:"20px 0 16px"}}>
              {ritualQueue.length > 0 ? (()=>{const cur=ritualQueue[0];const total=ritualDefs.length;const done=total-ritualQueue.length;return(<>
                <div style={{textAlign:"center",marginBottom:8}}><div style={{...T.labelM,color:M.onSurfaceV}}>{done+1} of {total}</div><Bar value={done} max={total} color={M.primary} h={4}/></div>
                <RitualSwipeCard key={cur.key} ritual={cur} onDone={()=>ritualSwipe(cur.key,"done")} onMissed={()=>ritualSwipe(cur.key,"missed")} onLater={()=>ritualSwipe(cur.key,"ns")}/>
                <div style={{display:"flex",gap:14,justifyContent:"center",alignItems:"center"}}>
                  <button onClick={()=>ritualSwipe(cur.key,"missed")} style={{width:52,height:52,borderRadius:26,background:M.errorC,border:`2px solid ${M.error}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Ic d={ic.x} s={22} c={M.error}/></button>
                  <button onClick={()=>ritualSwipe(cur.key,"ns")} style={{width:44,height:44,borderRadius:22,background:M.secondaryC,border:`2px solid ${M.secondary}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Ic d={ic.clock} s={18} c={M.secondary}/></button>
                  <button onClick={()=>ritualSwipe(cur.key,"done")} style={{width:52,height:52,borderRadius:26,background:M.tertiaryC,border:`2px solid ${M.tertiary}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Ic d={ic.check} s={24} c={M.tertiary}/></button>
                </div>
              </>);})() : (
                <div style={{textAlign:"center",padding:"40px 20px"}}><div style={{fontSize:48,marginBottom:16}}>☀️</div><div style={{...T.titleM,color:M.onSurface,marginBottom:8}}>You're all set!</div><div style={{...T.bodyM,color:M.onSurfaceV,marginBottom:4}}>{m.ritualsDone}/5 rituals done</div><div style={{...T.bodyM,color:M.onSurfaceV,marginBottom:24}}>{m.sleepHrs.toFixed(1)}h sleep · {m.awakeHrs.toFixed(1)}h awake</div><BtnFilled label="Start My Day" onClick={()=>{setShowMorning(false);setMorningStep(0);}} full/></div>
              )}
            </div>)}
          </div>
        </div>
      </div>}
      {/* Log Noise Sheet */}
      <Sheet open={showNoise} onClose={()=>setShowNoise(false)} title="Log Noise">
        <div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:16}}>Track time lost to noise — feeds your SNR.</div>
        <div style={{display:"flex",gap:12}}><Field label="Hours" value={noiseHrs} onChange={setNoiseHrs} type="number" ph="1" half/><Field label="Minutes" value={noiseMin} onChange={setNoiseMin} type="number" ph="30" half/></div>
        {(parseFloat(noiseHrs)||0)+(parseFloat(noiseMin)||0)>0&&<div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:8}}>= {((parseFloat(noiseHrs)||0)+(parseFloat(noiseMin)||0)/60).toFixed(1)}h total</div>}
        <Field label="What happened?" value={noiseNote} onChange={setNoiseNote} ph="Social media, unplanned meeting..."/>
        <Dropdown label="Noise Type" value={noiseType} onChange={setNoiseType} options={["Noise – Distraction","Noise – Admin","Noise – Unplanned"]}/>
        <BtnFilled label="Log Noise" onClick={logNoise} full disabled={!((parseFloat(noiseHrs)||0)+(parseFloat(noiseMin)||0)>0)} color={M.error} tc={M.onError}/>
      </Sheet>
      {/* Spend Sheet */}
      <Sheet open={showSpend} onClose={()=>setShowSpend(false)} title="Today's Spend">
        <Card style={{padding:"16px",marginBottom:16,background:M.surfaceC,boxSizing:"border-box"}}>
          <div style={{...T.labelM,color:M.onSurface,marginBottom:10}}>Add expense</div>
          <Field label="What did you spend on?" value={spendNote} onChange={setSpendNote} ph="e.g. Jollof rice, Bolt ride..." req/>
          <Field label="Amount (₦)" value={spendAmt} onChange={setSpendAmt} type="number" ph="1500" req/>
          <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6,marginTop:4}}>Category</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
            {SPEND_CATS.map(cat=>{const emojis={Food:"🍔",Transport:"🚗",Shopping:"🛍️",Bills:"📄",Entertainment:"🎬",Health:"💊",Education:"📚",Other:"📦"};return(
              <button key={cat} onClick={()=>setSpendCat(cat)} style={{display:"flex",alignItems:"center",gap:4,padding:"6px 12px",borderRadius:20,border:spendCat===cat?`2px solid ${M.primary}`:`1px solid ${M.outlineV}`,background:spendCat===cat?M.primaryC:"transparent",cursor:"pointer",fontFamily:font,...T.labelS,color:spendCat===cat?M.onPrimaryC:M.onSurfaceV}}><span>{emojis[cat]||"📦"}</span>{cat}</button>
            );})}
          </div>
          <BtnFilled label="+ Add to today" onClick={addSpend} full disabled={!spendAmt||!spendNote}/>
        </Card>
        {(day.spendLog||[]).length>0&&<div>
          <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",letterSpacing:".5px",marginBottom:10}}>Today's receipt</div>
          <div style={{borderTop:`2px dashed ${M.outlineV}`,paddingTop:12}}>
            {(day.spendLog||[]).map((e,i)=>{const emojis={Food:"🍔",Transport:"🚗",Shopping:"🛍️",Bills:"📄",Entertainment:"🎬",Health:"💊",Education:"📚",Other:"📦"};return(
              <div key={e.id||i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:`1px solid ${M.outlineV}`}}>
                <span style={{fontSize:20,flexShrink:0}}>{emojis[e.category]||"📦"}</span>
                <div style={{flex:1,minWidth:0}}><div style={{...T.titleS,color:M.onSurface}}>{e.note||"Expense"}</div><div style={{display:"flex",gap:8,alignItems:"center",marginTop:2}}>{e.category&&<span style={{...T.labelS,color:M.onSurfaceV,background:M.surfaceCH,padding:"1px 6px",borderRadius:4}}>{e.category}</span>}<span style={{...T.bodyS,color:M.outline}}>{e.time}</span></div></div>
                <div style={{textAlign:"right",flexShrink:0}}><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>₦{e.amount.toLocaleString()}</div></div>
                <button onClick={()=>removeSpend(e.id)} style={{background:"none",border:"none",cursor:"pointer",padding:4,flexShrink:0}}><Ic d={ic.x} s={16} c={M.error}/></button>
              </div>
            );})}
          </div>
          {/* Category breakdown */}
          {(()=>{const byCat={};(day.spendLog||[]).forEach(e=>{const c=e.category||"Other";byCat[c]=(byCat[c]||0)+e.amount;});const cats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);return cats.length>1?(<div style={{marginTop:12,padding:"12px 0",borderTop:`1px dashed ${M.outlineV}`}}>
            <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:8}}>By category</div>
            {cats.map(([cat,amt])=>{const pct=Math.round((amt/m.spend)*100);return(<div key={cat} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{...T.labelS,color:M.onSurfaceV,minWidth:80}}>{cat}</span><div style={{flex:1}}><Bar value={amt} max={m.spend} color={M.secondary} h={4}/></div><span style={{...T.labelS,color:M.onSurface,fontFamily:mono,minWidth:60,textAlign:"right"}}>₦{amt.toLocaleString()}</span><span style={{...T.labelS,color:M.outline,minWidth:30,textAlign:"right"}}>{pct}%</span></div>);})}
          </div>):null;})()}
          <div style={{borderTop:`2px dashed ${M.outlineV}`,marginTop:8,padding:"14px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{...T.titleM,color:M.onSurface}}>Total</div><div style={{...T.bodyS,color:M.onSurfaceV}}>{(day.spendLog||[]).length} item{(day.spendLog||[]).length!==1?"s":""}</div></div>
            <div style={{...T.headlineS,color:M.onSurface,fontFamily:mono}}>₦{m.spend.toLocaleString()}</div>
          </div>
        </div>}
        {(day.spendLog||[]).length===0&&<div style={{textAlign:"center",padding:"32px 20px"}}><div style={{fontSize:40,marginBottom:12}}>🧾</div><div style={{...T.bodyM,color:M.outline}}>No expenses logged today</div></div>}
      </Sheet>
    </div>
  );
};
/* ══ WEEK & INSIGHTS ══ */
const WeekView = ({days,tasks,budget,setBudget,settings}) => {
  const [off,setOff]=useState(0);
  const [showBudget,setShowBudget]=useState(false);
  const [showAddWkExp,setShowAddWkExp]=useState(false);
  const [sleepPeriod,setSleepPeriod]=useState("This Week");
  const [chartIdx,setChartIdx]=useState(0);
  const swipeStart=useRef(0);
  const chartLabels=["Noise Hours","Task Completion","Daily Spend","SNR Trend","Sleep Tracker"];
  const [budgetAmt,setBudgetAmt]=useState(String(budget||0));
  const [selectedDay,setSelectedDay]=useState(null);
  const [cumPeriod, setCumPeriod] = useState("all");
  const [cumFrom, setCumFrom] = useState("");
  const [cumTo, setCumTo] = useState("");
  // Weekly Planned Expense
  const [wkExpenses,setWkExpenses]=useState([]);
  const [wkLoaded,setWkLoaded]=useState(false);
  useEffect(()=>{(async()=>{setWkExpenses(await load("cc_wk_expenses",[]));setWkLoaded(true);})();},[]);
  const [editWk,setEditWk]=useState(null);
  const WK_SELECTS=["Home","Self"];
  const WK_DESTS=["House Card","Opay Account"];
  const WK_DURS=["Week 1","Week 2","Week 3","Week 4"];
  const WK_STATS=["Not-Locked","Locked","Un-Locked"];
  const resetWkForm=()=>({id:"",name:"",select:"Home",destination:"House Card",duration:["Week 1"],amount:"",status:"Not-Locked",recurring:false});
  const [wkForm,setWkForm]=useState(resetWkForm());
  const ref=new Date();ref.setDate(ref.getDate()+off*7);
  const week=weekDates(ref),today=fmt(new Date());
  const wd=week.map(d=>{const k=fmt(d),dy=days[k]||emptyDay(k);const mt=computeDay(tasks,dy,k);return{date:d,key:k,day:DAY[d.getDay()],m:mt,dy};});
  const avg=wd.reduce((s,d)=>s+d.m.snr,0)/7;
  const totalSpend=wd.reduce((s,d)=>s+d.m.spend,0);
  const totalDone=wd.reduce((s,d)=>s+d.m.tasksDone,0);
  // Cumulative
  const cumFilter = (dateStr) => {
    if(!dateStr) return false;
    const d = new Date(dateStr+"T00:00:00"); const now = new Date(); now.setHours(23,59,59);
    if(cumPeriod==="7d") { const c=new Date(now); c.setDate(c.getDate()-7); return d>=c; }
    if(cumPeriod==="30d") { const c=new Date(now); c.setDate(c.getDate()-30); return d>=c; }
    if(cumPeriod==="90d") { const c=new Date(now); c.setDate(c.getDate()-90); return d>=c; }
    if(cumPeriod==="ytd") { return d.getFullYear()===now.getFullYear(); }
    if(cumPeriod==="custom") {
      if(cumFrom && d < new Date(cumFrom+"T00:00:00")) return false;
      if(cumTo && d > new Date(cumTo+"T23:59:59")) return false;
      return true;
    }
    return true;
  };
  const cumDayKeys = Object.keys(days).filter(cumFilter);
  const cumSpend = cumDayKeys.reduce((s,k)=>{const dy=days[k];return s+(dy.spendLog||[]).reduce((a,e)=>a+(e.amount||0),0);},0);
  const cumNoise = tasks.filter(t=>(t.type||"").toLowerCase().includes("noise")&&t.completedOn&&cumFilter(t.completedOn)).reduce((s,t)=>s+(parseFloat(t.hrs)||t.elapsedMs/3600000||0),0);
  const cumTasksDone = tasks.filter(t=>t.completedOn&&cumFilter(t.completedOn)).length;
  const cumSignalHrs = tasks.filter(t=>(t.type||"").toLowerCase().includes("signal")&&t.completedOn&&cumFilter(t.completedOn)).reduce((s,t)=>s+(parseFloat(t.hrs)||t.elapsedMs/3600000||0),0);
  const cumSleepDays = cumDayKeys.filter(k=>{const dy=days[k];return dy&&dy.wakeUp&&dy.sleepTime;});
  const cumSleepAvg = cumSleepDays.length>0 ? cumSleepDays.reduce((s,k)=>{const dy=days[k];return s+(24-calcAwakeHrs(dy.wakeUp,dy.sleepTime));},0)/cumSleepDays.length : 0;
  const cumSleepMet = cumSleepDays.filter(k=>{const dy=days[k];return (24-calcAwakeHrs(dy.wakeUp,dy.sleepTime))>=SLEEP_TARGET;}).length;
  const cumPeriodLabel = {all:"All Time","7d":"Last 7 Days","30d":"Last 30 Days","90d":"Last 90 Days",ytd:"Year to Date"}[cumPeriod];
  const chartData = wd.map(w=>({day:w.day, noiseHrs:+(w.m.noiseHrs.toFixed(1)), tasksDone:w.m.tasksDone, totalTasks:w.m.totalTasks, spend:w.m.spend, snr:+(w.m.snr.toFixed(1)), sleepHrs:+(w.m.sleepHrs.toFixed(1)), signalHrs:+(w.m.signalHrs.toFixed(1))}));
  const chartH = 160;
  const tClr = {fontSize:11,fill:M.outline};
  const ttStyle={borderRadius:12,border:`1px solid ${M.outlineV}`,fontSize:12,fontFamily:font};
  const chartColors=[M.error,M.tertiary,M.secondary,M.primary,M.info];
  const prevChart=()=>setChartIdx(i=>Math.max(0,i-1));
  const nextChart=()=>setChartIdx(i=>Math.min(chartLabels.length-1,i+1));
  const onTS=e=>{swipeStart.current=e.touches[0].clientX;};
  const onTE=e=>{const dx=e.changedTouches[0].clientX-swipeStart.current;if(dx>50)prevChart();if(dx<-50)nextChart();};
  // Sleep period stats
  const sleepPeriods = (() => {
    const now = new Date();
    const ranges = {"This Week":7,"This Month":30,"Quarter":90,"Half Year":180,"Year":365};
    const results = {};
    for (const [label, numDays] of Object.entries(ranges)) {
      const dates = [];
      for (let i = 0; i < numDays; i++) { const d = new Date(now); d.setDate(d.getDate()-i); dates.push(fmt(d)); }
      const logged = dates.filter(k => days[k] && days[k].wakeUp && days[k].sleepTime);
      const sleeps = logged.map(k => { const dy=days[k]; return 24-calcAwakeHrs(dy.wakeUp, dy.sleepTime); });
      const avgS = sleeps.length>0 ? sleeps.reduce((a,b)=>a+b,0)/sleeps.length : 0;
      const met = sleeps.filter(s => s >= SLEEP_TARGET).length;
      const streak = (() => { let s=0; for(const k of dates){ const dy=days[k]; if(!dy||!dy.wakeUp||!dy.sleepTime) break; const sl=24-calcAwakeHrs(dy.wakeUp,dy.sleepTime); if(sl>=SLEEP_TARGET) s++; else break; } return s; })();
      results[label] = { avg:avgS, met, total:logged.length, min:sleeps.length?Math.min(...sleeps):0, max:sleeps.length?Math.max(...sleeps):0, streak };
    }
    return results;
  })();
  // Budget
  const curWeekNum = Math.min(4, Math.ceil(new Date().getDate()/7));
  const curWeekLabel = `Week ${curWeekNum}`;
  const dailyBudget = budget > 0 ? budget/7 : 0;
  const curWeekItems = wkExpenses.filter(e=>(e.duration||[]).includes(curWeekLabel));
  const curWeekPlanned = curWeekItems.reduce((s,e)=>s+(e.amount||0),0);
  const weeklyLimit = curWeekPlanned > 0 ? curWeekPlanned : budget;
  const budgetUsed = weeklyLimit > 0 ? Math.round((totalSpend/weeklyLimit)*100) : 0;
  const overBudget = totalSpend > weeklyLimit && weeklyLimit > 0;
  const saveBudget = () => { const v=parseFloat(budgetAmt)||0; setBudget(v); save("cc_budget",v); setShowBudget(false); };
  // Weekly Expense CRUD
  const saveWkExp = () => {
    if(!wkForm.name||!wkForm.amount) return;
    const entry = {...wkForm, id:wkForm.id||("wk"+Date.now()), amount:parseFloat(wkForm.amount)||0};
    const next = wkExpenses.some(e=>e.id===entry.id) ? wkExpenses.map(e=>e.id===entry.id?entry:e) : [...wkExpenses, entry];
    setWkExpenses(next); save("cc_wk_expenses",next);
    setShowAddWkExp(false); setEditWk(null); setWkForm(resetWkForm());
  };
  const removeWkExp = (id) => { const next=wkExpenses.filter(e=>e.id!==id); setWkExpenses(next); save("cc_wk_expenses",next); };
  const cycleWkStatus = (id) => {
    const cycle={"Not-Locked":"Locked","Locked":"Un-Locked","Un-Locked":"Not-Locked"};
    const next=wkExpenses.map(e=>e.id===id?{...e,status:cycle[e.status]||"Not-Locked"}:e);
    setWkExpenses(next); save("cc_wk_expenses",next);
  };
  const wkExpTotal = wkExpenses.reduce((s,e)=>s+(e.amount||0),0);
  const gRef=(chart,line,def)=>{const r=(settings?.refLines||{})[chart];return r?((r[line]??def)):def;};
  return (
    <div style={{paddingBottom:20}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <button onClick={()=>setOff(w=>w-1)} style={{background:M.surfaceC,border:"none",cursor:"pointer",padding:8,borderRadius:12}}><Ic d={ic.back} s={20} c={M.onSurfaceV}/></button>
        <div style={{textAlign:"center"}}><div style={{...T.labelL,color:M.primary,textTransform:"uppercase",letterSpacing:".8px"}}>{off===0?"This Week":off===-1?"Last Week":`${MON[week[0].getMonth()]} ${week[0].getDate()}–${week[6].getDate()}`}</div><div style={{...T.headlineM,color:M.onSurface,marginTop:4}}>Week</div></div>
        <button onClick={()=>setOff(w=>w+1)} style={{background:M.surfaceC,border:"none",cursor:"pointer",padding:8,borderRadius:12}}><Ic d={ic.chev} s={20} c={M.onSurfaceV}/></button>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <Stat label="Avg SNR" value={avg.toFixed(1)} sub={snrLbl(avg)} color={snrClr(avg)}/>
        <Stat label="Tasks" value={totalDone} sub="completed"/>
        <Stat label="Spend" value={`₦${(totalSpend/1000).toFixed(0)}k`} sub={overBudget?"Over budget!":weeklyLimit>0?`${budgetUsed}% of ₦${(weeklyLimit/1000).toFixed(0)}k`:""}/>
      </div>
      {/* Cumulative */}
      <Card style={{padding:"16px",marginBottom:16,boxSizing:"border-box"}}>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:10}}>Cumulative — {cumPeriodLabel}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {[["7d","7 Days"],["30d","30 Days"],["90d","90 Days"],["ytd","YTD"],["all","All"],["custom","Custom"]].map(([k,l])=>(<FilterChip key={k} label={l} active={cumPeriod===k} onClick={()=>setCumPeriod(k)}/>))}
          {cumPeriod==="custom"&&<div style={{display:"flex",gap:10,marginTop:8,width:"100%"}}><Field label="From" value={cumFrom} onChange={setCumFrom} type="date" half/><Field label="To" value={cumTo} onChange={setCumTo} type="date" half/></div>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><div style={{...T.bodyS,color:M.onSurfaceV}}>Total Spend</div><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>₦{cumSpend.toLocaleString()}</div></div>
          <div><div style={{...T.bodyS,color:M.onSurfaceV}}>Noise Hours</div><div style={{...T.titleS,color:M.error,fontFamily:mono}}>{cumNoise.toFixed(1)}h</div></div>
          <div><div style={{...T.bodyS,color:M.onSurfaceV}}>Tasks Done</div><div style={{...T.titleS,color:M.tertiary,fontFamily:mono}}>{cumTasksDone}</div></div>
          <div><div style={{...T.bodyS,color:M.onSurfaceV}}>Signal Hours</div><div style={{...T.titleS,color:M.primary,fontFamily:mono}}>{cumSignalHrs.toFixed(1)}h</div></div>
          <div><div style={{...T.bodyS,color:M.onSurfaceV}}>Avg Sleep</div><div style={{...T.titleS,color:cumSleepAvg>=SLEEP_TARGET?M.tertiary:cumSleepAvg>0?M.error:M.outline,fontFamily:mono}}>{cumSleepAvg>0?cumSleepAvg.toFixed(1)+"h":"—"}</div></div>
          <div><div style={{...T.bodyS,color:M.onSurfaceV}}>Sleep Target Met</div><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>{cumSleepDays.length>0?`${cumSleepMet}/${cumSleepDays.length} days`:"—"}</div></div>
        </div>
      </Card>
      {/* Chart Carousel */}
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:10}}>
          {chartLabels.map((l,i)=>(<button key={i} onClick={()=>setChartIdx(i)} style={{width:chartIdx===i?24:8,height:8,borderRadius:4,border:"none",cursor:"pointer",background:chartIdx===i?chartColors[i]:M.outlineV,transition:"all .2s"}}/>))}
        </div>
        <div onTouchStart={onTS} onTouchEnd={onTE}>
          {chartIdx===0&&<Card style={{padding:"16px",boxSizing:"border-box"}}><div style={{...T.labelL,color:M.error,textTransform:"uppercase",letterSpacing:".5px",marginBottom:10}}>Noise Hours</div><ResponsiveContainer width="100%" height={chartH}><ComposedChart data={chartData} margin={{top:5,right:5,left:-20,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={M.outlineV}/><XAxis dataKey="day" tick={tClr} axisLine={false}/><YAxis tick={tClr} axisLine={false}/><Tooltip contentStyle={ttStyle}/>{gRef("noise","danger",4)>0&&<ReferenceLine y={gRef("noise","danger",4)} stroke={M.error} strokeDasharray="4 4" label={{value:"Danger",fill:M.error,fontSize:10,position:"right"}}/>}{gRef("noise","ok",1.5)>0&&<ReferenceLine y={gRef("noise","ok",1.5)} stroke={M.warn} strokeDasharray="4 4" label={{value:"OK",fill:M.warn,fontSize:10,position:"right"}}/>}<RBar dataKey="noiseHrs" fill={M.errorC} stroke={M.error} radius={[4,4,0,0]} name="Noise hrs"/></ComposedChart></ResponsiveContainer></Card>}
          {chartIdx===1&&<Card style={{padding:"16px",boxSizing:"border-box"}}><div style={{...T.labelL,color:M.tertiary,textTransform:"uppercase",letterSpacing:".5px",marginBottom:10}}>Task Completion</div><ResponsiveContainer width="100%" height={chartH}><BarChart data={chartData} margin={{top:5,right:5,left:-20,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={M.outlineV}/><XAxis dataKey="day" tick={tClr} axisLine={false}/><YAxis tick={tClr} axisLine={false}/><Tooltip contentStyle={ttStyle}/><RBar dataKey="totalTasks" fill={M.surfaceCH} radius={[4,4,0,0]} name="Planned"/><RBar dataKey="tasksDone" fill={M.tertiaryC} stroke={M.tertiary} radius={[4,4,0,0]} name="Done"/></BarChart></ResponsiveContainer></Card>}
          {chartIdx===2&&<Card style={{padding:"16px",boxSizing:"border-box"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{...T.labelL,color:M.secondary,textTransform:"uppercase",letterSpacing:".5px"}}>Daily Spend</div><button onClick={()=>{setBudgetAmt(String(budget||0));setShowBudget(true);}} style={{background:M.secondaryC,border:"none",borderRadius:8,padding:"4px 10px",cursor:"pointer",...T.labelS,color:M.onSecondaryC,fontFamily:font}}>{weeklyLimit>0?`₦${weeklyLimit.toLocaleString()}/wk`:"Set Budget"}</button></div><ResponsiveContainer width="100%" height={chartH}><ComposedChart data={chartData} margin={{top:5,right:5,left:-20,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={M.outlineV}/><XAxis dataKey="day" tick={tClr} axisLine={false}/><YAxis tick={tClr} axisLine={false} tickFormatter={v=>`₦${(v/1000).toFixed(0)}k`}/><Tooltip contentStyle={ttStyle} formatter={v=>[`₦${v.toLocaleString()}`]}/>{dailyBudget>0&&<ReferenceLine y={dailyBudget} stroke={M.error} strokeDasharray="4 4" label={{value:"Daily limit",fill:M.error,fontSize:10,position:"right"}}/>}<RBar dataKey="spend" fill={M.secondaryC} stroke={M.secondary} radius={[4,4,0,0]} name="Spend"/></ComposedChart></ResponsiveContainer>{weeklyLimit>0&&<div style={{marginTop:10,padding:"10px 14px",borderRadius:10,background:overBudget?M.errorC:M.tertiaryC,boxSizing:"border-box"}}><div style={{display:"flex",justifyContent:"space-between",...T.labelM}}><span style={{color:overBudget?M.onErrorC:M.onTertiaryC}}>{overBudget?"⚠ Over":"✓ Within"}</span><span style={{fontFamily:mono,color:overBudget?M.error:M.tertiary}}>₦{totalSpend.toLocaleString()} / ₦{weeklyLimit.toLocaleString()}</span></div><Bar value={Math.min(totalSpend,weeklyLimit)} max={weeklyLimit} color={overBudget?M.error:M.tertiary} h={4}/>{overBudget&&<div style={{...T.bodyS,color:M.onErrorC,marginTop:4}}>Over by ₦{(totalSpend-weeklyLimit).toLocaleString()}</div>}</div>}</Card>}
          {chartIdx===3&&<Card style={{padding:"16px",boxSizing:"border-box"}}><div style={{...T.labelL,color:M.primary,textTransform:"uppercase",letterSpacing:".5px",marginBottom:10}}>SNR Trend</div><ResponsiveContainer width="100%" height={chartH}><LineChart data={chartData} margin={{top:5,right:5,left:-20,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={M.outlineV}/><XAxis dataKey="day" tick={tClr} axisLine={false}/><YAxis tick={tClr} axisLine={false}/><Tooltip contentStyle={ttStyle}/>{gRef("snr","exceptional",10)>0&&<ReferenceLine y={gRef("snr","exceptional",10)} stroke="#386A20" strokeDasharray="4 4" label={{value:"Exceptional",fill:"#386A20",fontSize:10,position:"right"}}/>}{gRef("snr","strong",5)>0&&<ReferenceLine y={gRef("snr","strong",5)} stroke={M.tertiary} strokeDasharray="4 4" label={{value:"Strong",fill:M.tertiary,fontSize:10,position:"right"}}/>}{gRef("snr","improve",1)>0&&<ReferenceLine y={gRef("snr","improve",1)} stroke={M.warn} strokeDasharray="4 4" label={{value:"Improve",fill:M.warn,fontSize:10,position:"right"}}/>}<Line type="monotone" dataKey="snr" stroke={M.primary} strokeWidth={2.5} dot={{fill:M.primary,r:4}} name="SNR"/></LineChart></ResponsiveContainer></Card>}
          {chartIdx===4&&<Card style={{padding:"16px",boxSizing:"border-box"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{...T.labelL,color:M.info,textTransform:"uppercase",letterSpacing:".5px"}}>Sleep Tracker</div><span style={{...T.labelS,color:M.info,background:M.infoC,padding:"3px 10px",borderRadius:8}}>Target: {SLEEP_TARGET}h</span></div>
            <ResponsiveContainer width="100%" height={chartH}><ComposedChart data={chartData} margin={{top:5,right:5,left:-20,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={M.outlineV}/><XAxis dataKey="day" tick={tClr} axisLine={false}/><YAxis tick={tClr} axisLine={false} domain={[0,10]}/><Tooltip contentStyle={ttStyle} formatter={v=>[`${v}h`]}/>{gRef("sleep","target",SLEEP_TARGET)>0&&<ReferenceLine y={gRef("sleep","target",SLEEP_TARGET)} stroke={M.info} strokeDasharray="4 4" label={{value:`${gRef("sleep","target",SLEEP_TARGET)}h`,fill:M.info,fontSize:10,position:"right"}}/>}{gRef("sleep","ideal",8)>0&&<ReferenceLine y={gRef("sleep","ideal",8)} stroke={M.tertiary} strokeDasharray="4 4" label={{value:"Ideal",fill:M.tertiary,fontSize:10,position:"right"}}/>}<RBar dataKey="sleepHrs" radius={[4,4,0,0]} name="Sleep">{chartData.map((entry,i)=>(<Cell key={i} fill={entry.sleepHrs>=SLEEP_TARGET?M.infoC:M.errorC} stroke={entry.sleepHrs>=SLEEP_TARGET?M.info:M.error}/>))}</RBar></ComposedChart></ResponsiveContainer>
            {/* Sleep period selector + stats */}
            <div style={{marginTop:14}}>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>{Object.keys(sleepPeriods).map(label=>(<FilterChip key={label} label={label} active={sleepPeriod===label} onClick={()=>setSleepPeriod(label)} color={M.info}/>))}</div>
              {(()=>{const s=sleepPeriods[sleepPeriod];if(!s||s.total===0) return <div style={{...T.bodyM,color:M.outline,textAlign:"center",padding:"12px 0"}}>No sleep data for {sleepPeriod.toLowerCase()}</div>;return(
                <Card style={{padding:"16px",boxSizing:"border-box",background:M.surfaceC}}>
                  <div style={{display:"flex",alignItems:"flex-end",gap:10,marginBottom:12}}>
                    <div style={{fontSize:36,fontWeight:700,fontFamily:mono,color:s.avg>=SLEEP_TARGET?M.tertiary:M.error,lineHeight:1}}>{s.avg.toFixed(1)}</div>
                    <div style={{paddingBottom:2}}><div style={{...T.labelM,color:M.onSurfaceV}}>hrs avg</div><div style={{...T.bodyS,color:s.avg>=SLEEP_TARGET?M.tertiary:M.error}}>{s.avg>=SLEEP_TARGET?"✓ On target":"⚠ Below target"}</div></div>
                  </div>
                  <Bar value={s.avg} max={10} color={s.avg>=SLEEP_TARGET?M.info:M.error} h={6}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginTop:14}}>
                    <div><div style={{...T.labelS,color:M.outline,textTransform:"uppercase"}}>Met</div><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>{s.met}/{s.total}</div></div>
                    <div><div style={{...T.labelS,color:M.outline,textTransform:"uppercase"}}>Range</div><div style={{...T.titleS,color:M.onSurface,fontFamily:mono}}>{s.min.toFixed(1)}–{s.max.toFixed(1)}</div></div>
                    <div><div style={{...T.labelS,color:M.outline,textTransform:"uppercase"}}>Streak</div><div style={{...T.titleS,color:s.streak>0?M.tertiary:M.outline,fontFamily:mono}}>{s.streak>0?`🔥${s.streak}d`:"—"}</div></div>
                  </div>
                </Card>
              );})()}
            </div>
          </Card>}
        </div>
        <div style={{textAlign:"center",marginTop:8}}><span style={{...T.bodyS,color:M.outline}}>{chartLabels[chartIdx]} · {chartIdx+1}/{chartLabels.length} — swipe</span></div>
      </div>
      {/* Day cards */}
      <div style={{...T.labelL,color:M.onSurfaceV,textTransform:"uppercase",letterSpacing:".5px",marginBottom:10}}>Day Breakdown</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {wd.map(w=>{const isT=w.key===today;return(<Card key={w.key} onClick={()=>setSelectedDay(w)} style={{background:isT?M.onSurface:M.surface,padding:"14px 16px",cursor:"pointer"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
            <div style={{width:40,textAlign:"center",flexShrink:0}}><div style={{...T.labelS,color:isT?"rgba(255,255,255,.45)":M.outline,textTransform:"uppercase"}}>{w.day}</div><div style={{fontSize:20,fontWeight:700,color:isT?"#FFF":M.onSurface,fontFamily:mono,lineHeight:1.3}}>{w.date.getDate()}</div></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{...T.labelM,color:isT?"#FFF":M.onSurface,fontFamily:mono}}>SNR {w.m.snr.toFixed(1)}</span><span style={{...T.labelS,padding:"2px 6px",borderRadius:4,background:snrClr(w.m.snr)+"25",color:snrClr(w.m.snr),fontSize:9}}>{snrLbl(w.m.snr)}</span></div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}><span style={{...T.labelS,color:isT?"rgba(255,255,255,.5)":M.onSurfaceV}}>{w.m.tasksDone}/{w.m.totalTasks} tasks</span>{w.m.noiseHrs>0&&<span style={{...T.labelS,color:isT?"#FFB4AB":M.error}}>{w.m.noiseHrs.toFixed(1)}h noise</span>}{w.m.spend>0&&<span style={{...T.labelS,color:isT?"rgba(255,255,255,.5)":M.secondary}}>₦{(w.m.spend/1000).toFixed(0)}k</span>}<span style={{...T.labelS,color:isT?"rgba(255,255,255,.35)":M.outline}}>{w.m.ritualsDone}/5 rituals</span>{w.m.sleepHrs>0&&<span style={{...T.labelS,color:isT?(w.m.sleepMet?"#A8DB8F":"#FFB4AB"):(w.m.sleepMet?M.info:M.error)}}>{w.m.sleepMet?"😴":"⚠"}{w.m.sleepHrs.toFixed(1)}h</span>}</div>
              <div style={{marginTop:6}}><Bar value={w.m.tasksDone} max={Math.max(w.m.totalTasks,1)} color={isT?"rgba(255,255,255,.4)":M.tertiary} h={3}/></div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}><div style={{...T.labelS,color:isT?"rgba(255,255,255,.35)":M.outline}}>Impact</div><div style={{...T.titleS,color:isT?"#FFF":M.primary,fontFamily:mono}}>{w.m.impactAchieved}/{w.m.impactExpected}</div></div>
          </div>
        </Card>);})}
      </div>
      {/* ═══ WEEKLY PLANNED EXPENSE ═══ */}
      <div style={{marginTop:20,marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div><div style={{...T.labelL,color:M.secondary,textTransform:"uppercase",letterSpacing:".5px"}}>Weekly Planned Expense</div><div style={{...T.bodyS,color:M.onSurfaceV,marginTop:2}}>SUM ₦{wkExpTotal.toLocaleString()}</div></div>
          <BtnFilled label="+ Add" onClick={()=>{setWkForm({...resetWkForm(),duration:[curWeekLabel]});setEditWk(null);setShowAddWkExp(true);}} icon={ic.plus}/>
        </div>
        {curWeekPlanned>0&&<Card style={{padding:"14px 16px",marginBottom:14,background:M.secondaryC,boxSizing:"border-box"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{...T.titleS,color:M.onSecondaryC}}>{curWeekLabel} — Actual vs Planned</span></div>
          <div style={{display:"flex",justifyContent:"space-between",...T.bodyS,color:M.onSecondaryC+"80",marginBottom:6}}><span>Spent: ₦{totalSpend.toLocaleString()}</span><span>Planned: ₦{curWeekPlanned.toLocaleString()}</span></div>
          <Bar value={Math.min(totalSpend,curWeekPlanned)} max={curWeekPlanned} color={totalSpend>curWeekPlanned?M.error:M.tertiary} h={5}/>
          {totalSpend>curWeekPlanned&&<div style={{...T.bodyS,color:M.error,marginTop:4}}>⚠ Over by ₦{(totalSpend-curWeekPlanned).toLocaleString()}</div>}
          {totalSpend<=curWeekPlanned&&<div style={{...T.bodyS,color:M.onSecondaryC+"80",marginTop:4}}>₦{(curWeekPlanned-totalSpend).toLocaleString()} remaining</div>}
        </Card>}
        {WK_DURS.map(wk=>{
          const items = wkExpenses.filter(e=>(e.duration||[]).includes(wk));
          if(items.length===0) return null;
          const wkTotal = items.reduce((s,e)=>s+(e.amount||0),0);
          const isCur = wk===curWeekLabel;
          const statusC={"Not-Locked":M.outline,"Locked":M.info,"Un-Locked":M.tertiary};
          const statusE={"Not-Locked":"🔓","Locked":"🔒","Un-Locked":"✅"};
          return (<div key={wk} style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><span style={{...T.labelM,color:isCur?M.primary:M.onSurfaceV,fontWeight:isCur?700:500}}>{wk}{isCur?" ← current":""}</span><span style={{...T.labelM,color:M.onSurface,fontFamily:mono}}>₦{wkTotal.toLocaleString()}</span></div>
            {items.map(e=>(<Card key={e.id} style={{padding:"12px 14px",marginBottom:6,boxSizing:"border-box",borderLeft:`3px solid ${statusC[e.status]||M.outline}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...T.titleS,color:M.onSurface}}>{e.name}</div>
                  <div style={{display:"flex",gap:5,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
                    <span style={{...T.labelS,padding:"2px 7px",borderRadius:6,background:e.select==="Home"?M.primaryC:M.secondaryC,color:e.select==="Home"?M.onPrimaryC:M.onSecondaryC}}>{e.select}</span>
                    <span style={{...T.labelS,padding:"2px 7px",borderRadius:6,background:M.surfaceCH,color:M.onSurfaceV}}>{e.destination}</span>
                    <button onClick={()=>cycleWkStatus(e.id)} style={{...T.labelS,padding:"2px 7px",borderRadius:6,background:(statusC[e.status]||M.outline)+"20",color:statusC[e.status]||M.outline,border:"none",cursor:"pointer",fontFamily:font,display:"flex",alignItems:"center",gap:3}}>{statusE[e.status]} {e.status}</button>
                    {e.recurring&&<span style={{...T.labelS,padding:"2px 7px",borderRadius:6,background:M.primaryC,color:M.onPrimaryC}}>↻ Recurring</span>}
                  </div>
                </div>
                <span style={{...T.titleS,fontFamily:mono,color:M.onSurface,flexShrink:0}}>₦{(e.amount||0).toLocaleString()}</span>
                <button onClick={()=>{setWkForm({...e,amount:String(e.amount)});setEditWk(e.id);setShowAddWkExp(true);}} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><Ic d={ic.edit} s={14} c={M.onSurfaceV}/></button>
                <button onClick={()=>removeWkExp(e.id)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><Ic d={ic.x} s={14} c={M.error}/></button>
              </div>
            </Card>))}
          </div>);
        })}
        {wkExpenses.length===0&&<Card style={{padding:"32px 20px",textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>📊</div><div style={{...T.bodyM,color:M.outline}}>No weekly expenses yet</div></Card>}
      </div>
      <Sheet open={showBudget} onClose={()=>setShowBudget(false)} title="Weekly Budget"><Field label="Weekly Budget (₦)" value={budgetAmt} onChange={setBudgetAmt} type="number" ph="15000" req/><BtnFilled label="Save Budget" onClick={saveBudget} full/></Sheet>
      {/* Add/Edit Weekly Expense Sheet */}
      <Sheet open={showAddWkExp} onClose={()=>{setShowAddWkExp(false);setEditWk(null);}} title={editWk?"Edit Expense":"New Weekly Expense"}>
        <Field label="Name" value={wkForm.name} onChange={v=>setWkForm(f=>({...f,name:v}))} ph="Shopping - Week 1" req/>
        <Field label="Amount (₦)" value={wkForm.amount} onChange={v=>setWkForm(f=>({...f,amount:v}))} type="number" ph="30000" req/>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6}}>Category</div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>{WK_SELECTS.map(s=><FilterChip key={s} label={s} active={wkForm.select===s} onClick={()=>setWkForm(f=>({...f,select:s}))}/>)}</div>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6}}>Destination</div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>{WK_DESTS.map(d=><FilterChip key={d} label={d} active={wkForm.destination===d} onClick={()=>setWkForm(f=>({...f,destination:d}))}/>)}</div>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6}}>Duration (weeks)</div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>{WK_DURS.map(w=><FilterChip key={w} label={w} active={(wkForm.duration||[]).includes(w)} onClick={()=>setWkForm(f=>({...f,duration:(f.duration||[]).includes(w)?(f.duration||[]).filter(x=>x!==w):[...(f.duration||[]),w]}))}/>)}</div>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6}}>Status</div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>{WK_STATS.map(s=>{const c={"Not-Locked":M.outline,"Locked":M.info,"Un-Locked":M.tertiary}[s];return <FilterChip key={s} label={s} active={wkForm.status===s} onClick={()=>setWkForm(f=>({...f,status:s}))} color={c}/>;})}</div>
        <button onClick={()=>setWkForm(f=>({...f,recurring:!f.recurring}))} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"12px 14px",marginBottom:16,borderRadius:12,border:`1px solid ${wkForm.recurring?M.primary:M.outlineV}`,background:wkForm.recurring?M.primaryC:"transparent",cursor:"pointer",fontFamily:font}}>
          <Ic d={ic.repeat} s={20} c={wkForm.recurring?M.onPrimaryC:M.outline}/><div style={{flex:1,textAlign:"left"}}><div style={{...T.titleS,color:wkForm.recurring?M.onPrimaryC:M.onSurface}}>Recurring expense</div></div>
          <div style={{width:44,height:24,borderRadius:12,background:wkForm.recurring?M.primary:M.outlineV,display:"flex",alignItems:"center",padding:"0 2px",transition:"all .2s"}}><div style={{width:20,height:20,borderRadius:10,background:"#FFF",transform:wkForm.recurring?"translateX(20px)":"translateX(0)",transition:"transform .2s"}}/></div>
        </button>
        <BtnFilled label={editWk?"Save Changes":"Add Expense"} onClick={saveWkExp} full disabled={!wkForm.name||!wkForm.amount}/>
        {editWk&&<button onClick={()=>{removeWkExp(editWk);setShowAddWkExp(false);setEditWk(null);}} style={{width:"100%",padding:"12px",marginTop:10,background:M.errorC,border:"none",borderRadius:12,cursor:"pointer",fontFamily:font,...T.labelM,color:M.error}}>Delete Expense</button>}
      </Sheet>
      {/* ═══ DAY DETAIL MODAL ═══ */}
      {selectedDay&&(()=>{
        const w=selectedDay;
        const dateStr=w.key;
        const dy=w.dy;
        const mt=w.m;
        const dayTasks=tasks.filter(t=>t.dueDate===dateStr||t.completedOn===dateStr);
        const doneTasks=dayTasks.filter(t=>t.status==="Done"||t.completedOn===dateStr);
        const activeTasks=dayTasks.filter(t=>t.status!=="Done"&&t.completedOn!==dateStr);
        const noiseTasks=dayTasks.filter(t=>(t.type||"").toLowerCase().includes("noise"));
        const spendItems=dy.spendLog||[];
        const noiseItems=dy.noiseLog||[];
        const ritualList=[["Exercise",dy.exercise],["Sleep",dy.sleep],["Calendar",dy.calendar],["Scheduling",dy.scheduling],["Doc Prep",dy.docPrep]];
        const emojis={Food:"🍔",Transport:"🚗",Shopping:"🛍️",Bills:"📄",Entertainment:"🎬",Health:"💊",Education:"📚",Other:"📦"};
        return <Sheet open={true} onClose={()=>setSelectedDay(null)} title={`${w.day}, ${MON[w.date.getMonth()]} ${w.date.getDate()}`}>
          {/* Metrics summary */}
          <Card style={{padding:"16px",marginBottom:14,background:M.onSurface,boxSizing:"border-box"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
              <div style={{textAlign:"center"}}><div style={{...T.headlineS,color:"#FFF",fontFamily:mono}}>{mt.snr.toFixed(1)}</div><div style={{...T.labelS,color:"rgba(255,255,255,.5)"}}>SNR</div></div>
              <div style={{textAlign:"center"}}><div style={{...T.headlineS,color:"#A8DB8F",fontFamily:mono}}>{mt.tasksDone}/{mt.totalTasks}</div><div style={{...T.labelS,color:"rgba(255,255,255,.5)"}}>Tasks</div></div>
              <div style={{textAlign:"center"}}><div style={{...T.headlineS,color:M.primaryC,fontFamily:mono}}>{mt.impactAchieved}/{mt.impactExpected}</div><div style={{...T.labelS,color:"rgba(255,255,255,.5)"}}>Impact</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
              <div style={{textAlign:"center",padding:"6px 0",background:"rgba(255,255,255,.08)",borderRadius:6}}><div style={{...T.labelM,fontFamily:mono,color:"#FFF"}}>{mt.ritualsDone}/5</div><div style={{...T.labelS,color:"rgba(255,255,255,.4)",fontSize:9}}>Rituals</div></div>
              <div style={{textAlign:"center",padding:"6px 0",background:"rgba(255,255,255,.08)",borderRadius:6}}><div style={{...T.labelM,fontFamily:mono,color:"#FFB4AB"}}>{mt.noiseHrs.toFixed(1)}h</div><div style={{...T.labelS,color:"rgba(255,255,255,.4)",fontSize:9}}>Noise</div></div>
              <div style={{textAlign:"center",padding:"6px 0",background:"rgba(255,255,255,.08)",borderRadius:6}}><div style={{...T.labelM,fontFamily:mono,color:"#FFF"}}>₦{(mt.spend/1000).toFixed(0)}k</div><div style={{...T.labelS,color:"rgba(255,255,255,.4)",fontSize:9}}>Spend</div></div>
              <div style={{textAlign:"center",padding:"6px 0",background:mt.sleepMet?"rgba(168,219,143,.15)":"rgba(255,180,171,.15)",borderRadius:6}}><div style={{...T.labelM,fontFamily:mono,color:mt.sleepMet?"#A8DB8F":"#FFB4AB"}}>{mt.sleepHrs>0?mt.sleepHrs.toFixed(1)+"h":"—"}</div><div style={{...T.labelS,color:mt.sleepMet?"#A8DB8F":"#FFB4AB",fontSize:9}}>Sleep</div></div>
            </div>
          </Card>
          {/* Rituals */}
          <div style={{marginBottom:14}}>
            <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:8}}>Rituals</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {ritualList.map(([name,status])=>{
                const done=status==="done",missed=status==="missed";
                return <span key={name} style={{...T.labelS,padding:"5px 10px",borderRadius:8,background:done?M.tertiaryC:missed?M.errorC:M.surfaceCH,color:done?M.onTertiaryC:missed?M.onErrorC:M.outline}}>{done?"✓":missed?"✗":"○"} {name}</span>;
              })}
            </div>
          </div>
          {/* Completed Tasks */}
          {doneTasks.length>0&&<div style={{marginBottom:14}}>
            <div style={{...T.labelS,color:M.tertiary,textTransform:"uppercase",marginBottom:8}}>Completed ({doneTasks.length})</div>
            {doneTasks.map(t=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${M.outlineV}`}}>
                <span style={{width:18,height:18,borderRadius:5,background:M.tertiary,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic d={ic.check} s={11} c="#FFF"/></span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...T.bodyS,color:M.onSurface}}>{t.name}</div>
                  <div style={{display:"flex",gap:4,marginTop:3}}><PBadge p={t.priority}/><TBadge t={t.type}/></div>
                </div>
                {t.impactPoints&&t.impactPoints!=="0"&&<span style={{...T.labelS,color:M.primary,fontFamily:mono,flexShrink:0}}>×{t.impactPoints}</span>}
              </div>
            ))}
          </div>}
          {/* Active / Incomplete Tasks */}
          {activeTasks.length>0&&<div style={{marginBottom:14}}>
            <div style={{...T.labelS,color:M.warn,textTransform:"uppercase",marginBottom:8}}>Incomplete ({activeTasks.length})</div>
            {activeTasks.map(t=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${M.outlineV}`}}>
                <span style={{width:18,height:18,borderRadius:5,border:`1.5px solid ${M.outline}`,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...T.bodyS,color:M.onSurface}}>{t.name}</div>
                  <div style={{display:"flex",gap:4,marginTop:3}}><PBadge p={t.priority}/><TBadge t={t.type}/></div>
                </div>
                {t.impactPoints&&t.impactPoints!=="0"&&<span style={{...T.labelS,color:M.outline,fontFamily:mono,flexShrink:0}}>×{t.impactPoints}</span>}
              </div>
            ))}
          </div>}
          {/* Noise */}
          {(noiseTasks.length>0||noiseItems.length>0)&&<div style={{marginBottom:14}}>
            <div style={{...T.labelS,color:M.error,textTransform:"uppercase",marginBottom:8}}>Noise ({mt.noiseHrs.toFixed(1)}h)</div>
            {noiseTasks.map(t=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${M.outlineV}`}}>
                <span style={{fontSize:14}}>⚡</span>
                <div style={{flex:1}}><div style={{...T.bodyS,color:M.onSurface}}>{t.name}</div></div>
                <span style={{...T.labelS,color:M.error,fontFamily:mono}}>{t.hrs||fmtHrs(t.elapsedMs||0)}h</span>
              </div>
            ))}
            {noiseItems.map(n=>(
              <div key={n.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${M.outlineV}`}}>
                <span style={{fontSize:14}}>⚡</span>
                <div style={{flex:1}}><div style={{...T.bodyS,color:M.onSurface}}>{n.type||"Noise"}</div></div>
                <span style={{...T.labelS,color:M.error,fontFamily:mono}}>{(n.hours||0)+(n.minutes||0)/60}h</span>
              </div>
            ))}
          </div>}
          {/* Spend */}
          {spendItems.length>0&&<div style={{marginBottom:14}}>
            <div style={{...T.labelS,color:M.secondary,textTransform:"uppercase",marginBottom:8}}>Spend (₦{mt.spend.toLocaleString()})</div>
            {spendItems.map((e,i)=>(
              <div key={e.id||i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${M.outlineV}`}}>
                <span style={{fontSize:16}}>{emojis[e.category]||"📦"}</span>
                <div style={{flex:1}}>
                  <div style={{...T.bodyS,color:M.onSurface}}>{e.note||"Expense"}</div>
                  {e.category&&<span style={{...T.labelS,color:M.onSurfaceV}}>{e.category}</span>}
                </div>
                <span style={{...T.labelS,color:M.onSurface,fontFamily:mono}}>₦{e.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>}
          {/* Empty state */}
          {dayTasks.length===0&&spendItems.length===0&&noiseItems.length===0&&<div style={{textAlign:"center",padding:"32px 20px"}}><div style={{fontSize:40,marginBottom:12}}>📭</div><div style={{...T.bodyM,color:M.outline}}>No data for this day</div></div>}
        </Sheet>;
      })()}
    </div>
  );
};
/* ══ EXECUTE ══ */
const ExecView = ({tasks,setTasks,rails,expenses,setExpenses}) => {
  const [filter,setFilter]=useState("all"),[showAdd,setShowAdd]=useState(false),[newTask,setNewTask]=useState(emptyTask()),[viewing,setViewing]=useState(null),[scope,setScope]=useState("month");
  const [expanded,setExpanded]=useState({});
  const [expExpanded,setExpExpanded]=useState({});
  const now=new Date(), qtr=getQ(now), curMonth=now.getMonth(), curYear=now.getFullYear();
  const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const EXP_CLASS=["Family","Personal","Expenditure","Debt","Obligation","Project"];
  const EXP_STAT=["Not Paid","Paid","Partial Payment","Reserved","Reversed"];
  const [expMonth,setExpMonth]=useState(MONTHS[curMonth]);
  const [expYear,setExpYear]=useState(String(curYear));
  const [showAddExp,setShowAddExp]=useState(false);
  const [editingExp,setEditingExp]=useState(null);
  const salaryPeriod=`${expMonth} Salary`;
  const emptyExp=()=>({id:"ex"+Date.now()+Math.random().toString(36).slice(2,5),name:"",amount:"",status:"Not Paid",classification:"Family",salaryPeriod,datePaid:"",unit:"",parentId:"",recurring:false});
  const [expForm,setExpForm]=useState(emptyExp());
  const today=fmt(new Date());
  // Task scope filter
  const scoped=tasks.filter(t=>{
    if(scope==="month"){ const d=t.dueDate?new Date(t.dueDate+"T00:00:00"):null; if(d&&(d.getMonth()!==curMonth||d.getFullYear()!==curYear)) return false; }
    if(scope==="quarter"&&!t.timeline?.includes(`Q${qtr}`)) return false;
    if(filter==="active") return t.status!=="Done";
    if(filter==="done") return t.status==="Done";
    return true;
  });
  const doneN=tasks.filter(t=>t.status==="Done").length;
  const addTask=()=>{if(!newTask.name.trim())return;setTasks(p=>{const n=[...p,{...newTask}];save("cc_tasks",n);return n;});setNewTask(emptyTask());setShowAdd(false);};
  const updateTask=u=>{setTasks(p=>{const n=p.map(t=>t.id===u.id?u:t);save("cc_tasks",n);return n;});setViewing(null);};
  const deleteTask=id=>{setTasks(prev=>prev.filter(t=>t.id!==id));setViewing(null);};
  const toggleDone=(id,e)=>{e.stopPropagation();setTasks(p=>p.map(t=>{if(t.id!==id)return t;const wasDone=t.status==="Done";const el=t.timerActive?t.elapsedMs+(Date.now()-(t.startedAt||Date.now())):t.elapsedMs;return{...t,status:wasDone?"Not started":"Done",completedOn:wasDone?"":today,timerActive:false,startedAt:null,elapsedMs:el,hrs:fmtHrs(el),score:wasDone?0:1};}));};
  const tog=id=>{setExpanded(e=>({...e,[id]:!e[id]}));};
  // Duplicate task
  const duplicateTask = (t) => {
    const dup = {...t, id:"t"+Date.now()+Math.random().toString(36).slice(2,6), status:"Not started", completedOn:"", timerActive:false, startedAt:null, elapsedMs:0, score:0, notionPageId:""};
    setTasks(p=>{const n=[...p,dup];save("cc_tasks",n);return n;});
  };
  // Parent-child grouping — match by parentTask field (which stores parent name)
  const parentTasks = scoped.filter(t=>!t.parentTask);
  const childrenOf = (name) => scoped.filter(t=>t.parentTask===name);
  const allNames = new Set(scoped.map(t=>t.name));
  const orphans = scoped.filter(t=>t.parentTask && !allNames.has(t.parentTask));
  // Expense CRUD
  const saveExp=(exp)=>{const next=expenses.some(e=>e.id===exp.id)?expenses.map(e=>e.id===exp.id?exp:e):[...expenses,exp];setExpenses(next);save("cc_expenses",next);setShowAddExp(false);setEditingExp(null);setExpForm(emptyExp());};
  const removeExp=(id)=>{const next=expenses.filter(e=>e.id!==id&&e.parentId!==id);setExpenses(next);save("cc_expenses",next);};
  const cycleExpStatus=(id)=>{const cycle={"Not Paid":"Paid","Paid":"Reserved","Reserved":"Partial Payment","Partial Payment":"Reversed","Reversed":"Not Paid"};const next=expenses.map(e=>e.id===id?{...e,status:cycle[e.status]||"Not Paid"}:e);setExpenses(next);save("cc_expenses",next);};
  const periodExp=expenses.filter(e=>(e.salaryPeriod||"")===salaryPeriod);
  const parentExp=periodExp.filter(e=>!e.parentId);
  const childrenOfExp=(id)=>periodExp.filter(e=>e.parentId===id);
  const periodTotal=parentExp.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const periodPaid=periodExp.filter(e=>e.status==="Paid"||e.status==="Reserved").reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const statusC={"Not Paid":M.error,"Paid":M.tertiary,"Partial Payment":M.warn,"Reserved":M.info,"Reversed":M.outline};
  const TaskRow = ({t,indent=false}) => {
    const isDone=t.status==="Done";
    const kids=childrenOf(t.name);
    const hasKids=kids.length>0;
    const isExp=expanded[t.id]!==false;
    const kidsDone=kids.filter(k=>k.status==="Done").length;
    return (<>
      <Card onClick={()=>setViewing(t)} style={{opacity:isDone?.55:1,marginLeft:indent?24:0}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"12px 14px"}}>
          <span onClick={e=>toggleDone(t.id,e)} style={{width:22,height:22,borderRadius:7,marginTop:1,flexShrink:0,border:`2px solid ${isDone?M.tertiary:M.outline}`,background:isDone?M.tertiary:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>{isDone&&<Ic d={ic.check} s={13} c="#FFF"/>}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {hasKids&&<button onClick={e=>{e.stopPropagation();tog(t.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:0,transform:isExp?"rotate(90deg)":"rotate(0deg)",transition:"transform .15s"}}><Ic d={ic.chev} s={14} c={M.outline}/></button>}
              <span style={{...T.titleS,color:M.onSurface,textDecoration:isDone?"line-through":"none"}}>{t.name}</span>
            </div>
            {t.description&&<div style={{...T.bodyS,color:M.onSurfaceV,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</div>}
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
              <PBadge p={t.priority}/><TBadge t={t.type}/><EBadge e={t.effortLevel}/>
              {t.recurring&&<span style={{...T.labelS,padding:"2px 6px",borderRadius:6,background:M.primaryC,color:M.onPrimaryC,display:"inline-flex",alignItems:"center",gap:3}}><Ic d={ic.repeat} s={10} c={M.onPrimaryC}/>{t.recurring}</span>}
              {t.dueDate&&<span style={{...T.labelS,color:M.outline}}>{relDate(t.dueDate)}</span>}
              {t.timerActive&&<span style={{...T.labelS,color:M.primary,fontFamily:mono,background:M.primaryC,padding:"2px 6px",borderRadius:6}}>▶</span>}
              {hasKids&&<span style={{...T.labelS,color:M.onSurfaceV,background:M.surfaceCH,padding:"2px 6px",borderRadius:6}}>{kidsDone}/{kids.length}</span>}
              {t.rail&&<span style={{...T.labelS,color:M.onPrimaryC,background:M.primaryC,padding:"2px 6px",borderRadius:6}}>{t.rail}</span>}
            </div>
          </div>
          {t.impactPoints&&<span style={{...T.labelM,color:M.primary,fontFamily:mono,marginTop:2}}>×{t.impactPoints}</span>}
          <button onClick={e=>{e.stopPropagation();deleteTask(t.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:4,marginTop:1,flexShrink:0,opacity:.4}}><Ic d={ic.trash} s={14} c={M.error}/></button>
        </div>
      </Card>
      {hasKids&&isExp&&kids.sort((a,b)=>(a.dueDate||"z").localeCompare(b.dueDate||"z")).map(k=><TaskRow key={k.id} t={k} indent/>)}
    </>);
  };
  return (
    <div style={{paddingBottom:20}}>
      <div style={{marginBottom:16}}><div style={{...T.labelL,color:M.primary,textTransform:"uppercase",letterSpacing:".8px"}}>{MON[now.getMonth()]} {now.getFullYear()} · Q{qtr}</div><div style={{...T.headlineM,color:M.onSurface,marginTop:4}}>Execution</div></div>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}><FilterChip label="This Month" active={scope==="month"} onClick={()=>setScope("month")}/><FilterChip label={`Q${qtr} Quarter`} active={scope==="quarter"} onClick={()=>setScope("quarter")}/><FilterChip label="All" active={scope==="all"} onClick={()=>setScope("all")}/></div>
      <Card style={{padding:"14px 16px",marginBottom:16,boxSizing:"border-box"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8,...T.titleS}}><span>{doneN} of {tasks.length}</span><span style={{fontFamily:mono,color:M.primary}}>{tasks.length>0?Math.round((doneN/tasks.length)*100):0}%</span></div><Bar value={doneN} max={tasks.length}/></Card>
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <FilterChip label="All" active={filter==="all"} onClick={()=>setFilter("all")}/>
        <FilterChip label="Active" active={filter==="active"} onClick={()=>setFilter("active")} color={M.info}/>
        <FilterChip label="Done" active={filter==="done"} onClick={()=>setFilter("done")} color={M.tertiary}/>
        <div style={{flex:1}}/><BtnFilled label="New" onClick={()=>{setNewTask(emptyTask());setShowAdd(true);}} icon={ic.plus}/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {parentTasks.sort((a,b)=>(a.dueDate||"z").localeCompare(b.dueDate||"z")).map(t=><TaskRow key={t.id} t={t}/>)}
        {orphans.length>0&&orphans.map(t=><TaskRow key={t.id} t={t}/>)}
        {scoped.length===0&&<Card style={{padding:"40px 20px",textAlign:"center"}}><div style={{...T.bodyM,color:M.outline}}>No tasks here yet</div></Card>}
      </div>
      {/* ═══ MONTHLY EXPENSE & DEBT ═══ */}
      <div style={{marginTop:24,marginBottom:20}}>
        <div style={{...T.labelL,color:M.secondary,textTransform:"uppercase",letterSpacing:".5px",marginBottom:12}}>Expense & Debt</div>
        <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center"}}>
          <select value={expMonth} onChange={e=>setExpMonth(e.target.value)} style={{flex:1,padding:"10px 14px",borderRadius:12,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:font,...T.titleS,color:M.onSurface,outline:"none"}}>{MONTHS.map(m=><option key={m} value={m}>{m}</option>)}</select>
          <select value={expYear} onChange={e=>setExpYear(e.target.value)} style={{padding:"10px 14px",borderRadius:12,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:font,...T.titleS,color:M.onSurface,outline:"none",width:90}}>{[2025,2026,2027,2028].map(y=><option key={y} value={String(y)}>{y}</option>)}</select>
        </div>
        <Card style={{padding:"14px 16px",marginBottom:14,background:M.secondaryC,boxSizing:"border-box"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{...T.titleS,color:M.onSecondaryC}}>{salaryPeriod}</span><span style={{...T.headlineS,fontFamily:mono,color:M.onSecondaryC}}>₦{periodTotal.toLocaleString()}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",...T.bodyS,color:M.onSecondaryC+"80"}}><span>Paid: ₦{periodPaid.toLocaleString()}</span><span>Unpaid: ₦{(periodTotal-periodPaid).toLocaleString()}</span></div>
          <div style={{marginTop:8}}><Bar value={periodPaid} max={periodTotal||1} color={M.tertiary} h={5}/></div>
        </Card>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}><BtnFilled label="+ New Expense" onClick={()=>{setExpForm({...emptyExp(),salaryPeriod});setEditingExp(null);setShowAddExp(true);}} icon={ic.plus}/></div>
        {parentExp.map(e=>{const kids=childrenOfExp(e.id);const hasKids=kids.length>0;const isOpen=expExpanded[e.id]!==false;const kidsPaid=kids.filter(k=>k.status==="Paid"||k.status==="Reserved").length;return(<div key={e.id}>
          <Card style={{padding:"12px 14px",marginBottom:6,boxSizing:"border-box",borderLeft:`3px solid ${statusC[e.status]||M.outline}`}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {hasKids&&<button onClick={()=>setExpExpanded(s=>({...s,[e.id]:!isOpen}))} style={{background:"none",border:"none",cursor:"pointer",padding:0,transform:isOpen?"rotate(90deg)":"rotate(0)",transition:"transform .15s"}}><Ic d={ic.chev} s={14} c={M.outline}/></button>}
                  <span style={{...T.titleS,color:M.onSurface,textDecoration:e.status==="Paid"?"line-through":"none"}}>{e.name}</span>
                </div>
                <div style={{display:"flex",gap:5,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
                  {e.classification&&<span style={{...T.labelS,padding:"2px 7px",borderRadius:5,background:M.surfaceCH,color:M.onSurfaceV}}>{e.classification}</span>}
                  <button onClick={()=>cycleExpStatus(e.id)} style={{...T.labelS,padding:"2px 7px",borderRadius:5,background:(statusC[e.status]||M.outline)+"20",color:statusC[e.status]||M.outline,border:"none",cursor:"pointer",fontFamily:font}}>{e.status==="Paid"?"●":"○"} {e.status}</button>
                  {e.unit&&<span style={{...T.labelS,color:M.onSurfaceV,fontStyle:"italic"}}>{e.unit}</span>}
                  {e.recurring&&<span style={{...T.labelS,padding:"2px 7px",borderRadius:5,background:M.primaryC,color:M.onPrimaryC}}>↻ Recurring</span>}
                  {hasKids&&<span style={{...T.labelS,color:M.onSurfaceV,background:M.surfaceCH,padding:"2px 6px",borderRadius:5}}>{kidsPaid}/{kids.length}</span>}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                {(parseFloat(e.amount)||0)>0&&<span style={{...T.titleS,fontFamily:mono,color:M.onSurface}}>₦{parseFloat(e.amount).toLocaleString()}</span>}
                <button onClick={()=>{setExpForm({...e});setEditingExp(e.id);setShowAddExp(true);}} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><Ic d={ic.edit} s={14} c={M.onSurfaceV}/></button>
                <button onClick={()=>removeExp(e.id)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><Ic d={ic.x} s={14} c={M.error}/></button>
              </div>
            </div>
          </Card>
          {hasKids&&isOpen&&kids.map(k=>(<Card key={k.id} style={{padding:"10px 12px",marginBottom:4,marginLeft:20,boxSizing:"border-box",borderLeft:`3px solid ${statusC[k.status]||M.outline}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{flex:1,minWidth:0}}><span style={{...T.bodyS,color:M.onSurface,textDecoration:k.status==="Paid"?"line-through":"none"}}>{k.name}</span></div>
              <button onClick={()=>cycleExpStatus(k.id)} style={{...T.labelS,padding:"2px 6px",borderRadius:4,background:(statusC[k.status]||M.outline)+"20",color:statusC[k.status]||M.outline,border:"none",cursor:"pointer",fontFamily:font,fontSize:10}}>{k.status}</button>
              {(parseFloat(k.amount)||0)>0&&<span style={{...T.labelS,fontFamily:mono,color:M.onSurface}}>₦{parseFloat(k.amount).toLocaleString()}</span>}
              <button onClick={()=>removeExp(k.id)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><Ic d={ic.x} s={12} c={M.error}/></button>
            </div>
          </Card>))}
          {hasKids&&isOpen&&<button onClick={()=>{setExpForm({...emptyExp(),salaryPeriod,parentId:e.id});setEditingExp(null);setShowAddExp(true);}} style={{marginLeft:20,marginBottom:10,background:"none",border:`1px dashed ${M.outlineV}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:font,...T.bodyS,color:M.outline}}>+ Add sub-item</button>}
        </div>);})}
        {parentExp.length===0&&<Card style={{padding:"32px 20px",textAlign:"center"}}><div style={{...T.bodyM,color:M.outline}}>No expenses for {salaryPeriod}</div></Card>}
        {periodExp.length>0&&<div style={{display:"flex",justifyContent:"flex-end",padding:"12px 0",borderTop:`2px dashed ${M.outlineV}`,marginTop:8}}><span style={{...T.labelM,color:M.outline,marginRight:8}}>SUM</span><span style={{...T.titleM,fontFamily:mono,color:M.onSurface}}>₦{periodTotal.toLocaleString()}</span></div>}
      </div>
      <Sheet open={showAdd} onClose={()=>setShowAdd(false)} title="New Task"><TaskForm task={newTask} setTask={setNewTask} onSave={addTask} saveLabel="Create Task" rails={rails}/></Sheet>
      {viewing&&<TaskDetail task={viewing} onClose={()=>setViewing(null)} onSave={updateTask} onDelete={()=>deleteTask(viewing.id)} onDuplicate={dup=>{const n=[...tasks,{...emptyTask(),...dup,id:dup.id||"t"+Date.now()+Math.random().toString(36).slice(2,6)}];setTasks(n);save("cc_tasks",n);}} rails={rails} tasks={tasks}/>}
      <Sheet open={showAddExp} onClose={()=>{setShowAddExp(false);setEditingExp(null);}} title={editingExp?"Edit Expense":"New Expense"}>
        <Field label="Name" value={expForm.name} onChange={v=>setExpForm(f=>({...f,name:v}))} ph="Wife - February, Rent, etc." req/>
        <Field label="Amount (₦)" value={expForm.amount} onChange={v=>setExpForm(f=>({...f,amount:v}))} type="number" ph="200,000" req/>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6}}>Classification</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>{EXP_CLASS.map(c=><FilterChip key={c} label={c} active={expForm.classification===c} onClick={()=>setExpForm(f=>({...f,classification:c}))}/>)}</div>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6}}>Status</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>{EXP_STAT.map(s=>{const c=statusC[s];return <FilterChip key={s} label={s} active={expForm.status===s} onClick={()=>setExpForm(f=>({...f,status:s}))} color={c}/>;})}</div>
        <Field label="Unit (optional)" value={expForm.unit} onChange={v=>setExpForm(f=>({...f,unit:v}))} ph="9 Cans @ 9000/Can"/>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6}}>Salary Period</div>
        <div style={{display:"flex",gap:10,marginBottom:14}}>
          <select value={expForm.salaryPeriod?.replace(" Salary","")||expMonth} onChange={e=>setExpForm(f=>({...f,salaryPeriod:e.target.value+" Salary"}))} style={{flex:1,padding:"10px 14px",borderRadius:12,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:font,...T.bodyM,color:M.onSurface,outline:"none"}}>{MONTHS.map(m=><option key={m} value={m}>{m}</option>)}</select>
        </div>
        <Field label="Date Paid (optional)" value={expForm.datePaid} onChange={v=>setExpForm(f=>({...f,datePaid:v}))} type="date"/>
        {parentExp.length>0&&<>
          <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:6}}>Parent item (optional)</div>
          <select value={expForm.parentId||""} onChange={e=>setExpForm(f=>({...f,parentId:e.target.value}))} style={{width:"100%",padding:"10px 14px",borderRadius:12,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:font,...T.bodyM,color:M.onSurface,outline:"none",marginBottom:16,boxSizing:"border-box"}}>
            <option value="">None (top-level)</option>
            {parentExp.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>}
        <button onClick={()=>setExpForm(f=>({...f,recurring:!f.recurring}))} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"12px 14px",marginBottom:16,borderRadius:12,border:`1px solid ${expForm.recurring?M.primary:M.outlineV}`,background:expForm.recurring?M.primaryC:"transparent",cursor:"pointer",fontFamily:font}}>
          <Ic d={ic.repeat} s={20} c={expForm.recurring?M.onPrimaryC:M.outline}/><div style={{flex:1,textAlign:"left"}}><div style={{...T.titleS,color:expForm.recurring?M.onPrimaryC:M.onSurface}}>Recurring expense</div></div>
          <div style={{width:44,height:24,borderRadius:12,background:expForm.recurring?M.primary:M.outlineV,display:"flex",alignItems:"center",padding:"0 2px",transition:"all .2s"}}><div style={{width:20,height:20,borderRadius:10,background:"#FFF",transform:expForm.recurring?"translateX(20px)":"translateX(0)",transition:"transform .2s"}}/></div>
        </button>
        <BtnFilled label={editingExp?"Save Changes":"Add Expense"} onClick={()=>saveExp(expForm)} full disabled={!expForm.name||!expForm.amount}/>
        {editingExp&&<button onClick={()=>{removeExp(editingExp);setShowAddExp(false);setEditingExp(null);}} style={{width:"100%",padding:"12px",marginTop:10,background:M.errorC,border:"none",borderRadius:12,cursor:"pointer",fontFamily:font,...T.labelM,color:M.error}}>Delete Expense</button>}
      </Sheet>
    </div>
  );
};
/* ══ RAILS ══ */
const RailsView = ({rails,setRails,tasks}) => {
  const [sel,setSel]=useState(null);
  const rh=rails.map(r=>{const rt=tasks.filter(t=>t.rail===r.name),d=rt.filter(t=>t.status==="Done").length,tot=rt.length;return{...r,health:tot>0?Math.round((d/tot)*100):r.health,tasksDone:d,taskTotal:tot,relTasks:rt};}).sort((a,b)=>a.health-b.health);
  const hc=h=>h>=70?M.tertiary:h>=40?M.warn:M.error;
  const uh=(id,v)=>{const n=rails.map(r=>r.id===id?{...r,health:v}:r);setRails(n);save("cc_rails",n);};
  return (
    <div style={{paddingBottom:20}}>
      <div style={{marginBottom:20}}><div style={{...T.labelL,color:M.primary,textTransform:"uppercase",letterSpacing:".8px"}}>Life Rails</div><div style={{...T.headlineM,color:M.onSurface,marginTop:4}}>Health Snapshot</div></div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {rh.map(r=>(
          <Card key={r.id} onClick={()=>setSel(sel===r.id?null:r.id)} style={{padding:"16px 18px",border:sel===r.id?`1.5px solid ${M.primary}`:`1px solid ${M.outlineV}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}><span style={{...T.titleM,color:M.onSurface}}>{r.name}</span><span style={{...T.labelL,fontFamily:mono,color:hc(r.health)}}>{r.health}%</span></div>
            <Bar value={r.health} max={100} color={hc(r.health)}/>
            <div style={{display:"flex",gap:4,marginTop:8,flexWrap:"wrap"}}>{r.hl.map(h=><span key={h} style={{...T.labelS,color:M.onSurfaceV,padding:"2px 8px",background:M.surfaceCH,borderRadius:8}}>{h}</span>)}</div>
            {sel===r.id&&<div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${M.outlineV}`}}>
              <div style={{...T.labelM,color:M.onSurfaceV,marginBottom:8}}>{r.taskTotal>0?`${r.tasksDone}/${r.taskTotal} done`:"No linked tasks"}</div>
              <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{...T.bodyS,color:M.onSurfaceV}}>Adjust:</span><input type="range" min={0} max={100} value={r.health} onChange={e=>{e.stopPropagation();uh(r.id,+e.target.value)}} onClick={e=>e.stopPropagation()} style={{flex:1,accentColor:M.primary}}/></div>
              {r.relTasks.length>0&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>{r.relTasks.slice(0,5).map(t=><div key={t.id} style={{display:"flex",alignItems:"center",gap:8,...T.bodyS}}><StatusDot status={t.status}/><span style={{flex:1,color:M.onSurface}}>{t.name}</span><PBadge p={t.priority}/></div>)}</div>}
            </div>}
          </Card>
        ))}
      </div>
    </div>
  );
};
/* ══ SETTINGS ══ */
const SettingsView = ({settings,setSettings,onBack,tasks,setTasks,days,setDays,expenses,setExpenses}) => {
  const [s,setS]=useState({...settings});
  const [showLogout,setShowLogout]=useState(false);
  const [showGuide,setShowGuide]=useState(false);
  const [notionStatus,setNotionStatus]=useState({});
  const [proxyOk,setProxyOk]=useState(null);
  const [syncMsg,setSyncMsg]=useState("");
  const [syncing,setSyncing]=useState(false);
  const [syncLog,setSyncLog]=useState([]);
  const [calEvents,setCalEvents]=useState([]);
  const addLog=(msg,type="info")=>setSyncLog(l=>[...l,{msg,type,t:new Date().toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}]);
  const checkProxy = async () => { const r=await proxyGet("/api/health"); setProxyOk(r.ok||false); return r; };
  const configProxy = async () => {
    if(!s.notionToken) { setSyncMsg("⚠ Enter your Notion Integration Token first"); return false; }
    const r = await proxyPost("/api/config", {
      notionToken: s.notionToken,
      tasksDb: s.notionTasksDb,
      dailyDb: s.notionDailyDb,
      expenseDb: s.notionExpenseDb,
      wkExpDb: s.notionWkExpDb,
    });
    if(r.ok && r.hasNotion) { setProxyOk(true); return true; }
    setSyncMsg("⚠ Could not configure proxy. Is the server running?"); return false;
  };
  const testAll = async () => {
    setNotionStatus({}); setSyncMsg("Testing proxy connection...");
    // Step 1: Check if proxy server is running
    const h = await checkProxy();
    if(!h.ok) { setSyncMsg("⚠ Proxy server not running on localhost:3456. Start it with: cd backend && npm start"); return; }
    // Step 2: Send token + all 4 DB IDs to configure the proxy
    const configOk = await configProxy();
    if(!configOk) return;
    // Step 3: Mark all DBs as "loading" (only if they have an ID)
    const dbMap = {tasks:"notionTasksDb", daily:"notionDailyDb", expense:"notionExpenseDb", wkExp:"notionWkExpDb"};
    for(const [key, settingsKey] of Object.entries(dbMap)) {
      setNotionStatus(p=>({...p, [key]: s[settingsKey] ? "loading" : "empty"}));
    }
    setSyncMsg("Querying Notion databases...");
    // Step 4: Actually query each DB via proxy → Notion API
    const r = await proxyPost("/api/test-dbs", {});
    if(r.error) {
      // Token is probably wrong
      for(const key of Object.keys(dbMap)) setNotionStatus(p=>({...p,[key]:s[dbMap[key]]?"failed":"empty"}));
      setSyncMsg("⚠ " + r.error);
      return;
    }
    // Step 5: Update status from real results
    const results = r.results || {};
    const errors = r.errors || {};
    for(const [key, settingsKey] of Object.entries(dbMap)) {
      setNotionStatus(p=>({...p, [key]: results[key] || (s[settingsKey] ? "failed" : "empty")}));
    }
    // Step 6: Show summary
    const okCount = Object.values(results).filter(v=>v==="ok").length;
    const failedCount = Object.values(results).filter(v=>v==="failed").length;
    const emptyCount = Object.values(results).filter(v=>v==="empty").length;
    const failedNames = Object.entries(results).filter(([,v])=>v==="failed").map(([k])=>k);
    if(failedCount > 0) {
      const errMsgs = failedNames.map(k => `${k}: ${errors[k]||"unknown error"}`).join("; ");
      setSyncMsg(`⚠ ${failedCount} failed: ${errMsgs}`);
    } else if(okCount > 0) {
      setSyncMsg(`✓ ${okCount} database${okCount>1?"s":""} connected!${emptyCount>0?` (${emptyCount} not configured)`:""}`);
    } else {
      setSyncMsg("⚠ No databases configured. Enter your database IDs above.");
    }
  };
  const fetchCalendarEvents = async () => {
    const r = await proxyGet("/api/calendar/events");
    if(r.ok) setCalEvents(r.events||[]);
  };
  const syncData = async () => {
    setSyncing(true); setSyncLog([]); setSyncMsg("Connecting...");
    const h = await checkProxy();
    if(!h.ok) { setSyncMsg("⚠ Start the proxy server first (node server.js)"); setSyncing(false); return; }
    if(!h.hasNotion) { const ok=await configProxy(); if(!ok){setSyncing(false);return;} }
    addLog("🔄 Pulling latest from Notion via proxy...");
    setSyncMsg("Syncing from Notion...");
    try {
      const r = await proxyPost("/api/sync", {});
      if(r.error) { addLog("⚠ "+r.error,"error"); setSyncMsg("⚠ "+r.error); setSyncing(false); return; }
      let tc=0, dc=0, ec=0;
      if(r.tasks?.length>0) {
        // Deduplicate by notionPageId — Notion is the source of truth
        const seen = new Set();
        const deduped = r.tasks.filter(t => {
          if (t.notionPageId) {
            if (seen.has(t.notionPageId)) return false;
            seen.add(t.notionPageId);
          }
          return true;
        });
        const merged = deduped.map(t=>({...emptyTask(),...t}));
        setTasks(merged); save("cc_tasks",merged); tc=merged.length;
        addLog("✓ "+tc+" tasks synced ("+r.tasks.length+" from Notion, "+tc+" unique)","success");
      }
      if(r.days && Object.keys(r.days).length>0) { const nd={}; Object.entries(r.days).forEach(([k,v])=>{ nd[k]={...emptyDay(k),...v}; }); setDays(nd); save("cc_days",nd); dc=Object.keys(nd).length; addLog("✓ "+dc+" daily records synced","success"); }
      if(r.expenses?.length>0) { setExpenses(r.expenses); save("cc_expenses",r.expenses); ec=r.expenses.length; addLog("✓ "+ec+" expenses synced","success"); }
      setSyncMsg(`✓ Done! ${tc} tasks · ${dc} daily · ${ec} expenses`);
      addLog("🎉 Live sync complete!","success");
    } catch(e) { setSyncMsg("⚠ Error: "+e.message); addLog("Fatal: "+e.message,"error"); }
    setSyncing(false);
  };
  const upd=(k,v)=>{const n={...s,[k]:v};setS(n);setSettings(n);save("cc_settings",n);};
  const updRef=(chart,field,v)=>{const refs={...(s.refLines||{})};if(!refs[chart])refs[chart]={};refs[chart][field]=v;upd("refLines",refs);};
  const charts=[
    {key:"noise",label:"Noise Hours",lines:[{key:"danger",label:"Danger Zone",def:4},{key:"ok",label:"Accepted Noise",def:1.5}]},
    {key:"snr",label:"SNR Trend",lines:[{key:"exceptional",label:"Exceptional",def:10},{key:"strong",label:"Strong Focus",def:5},{key:"improve",label:"Improve",def:1}]},
    {key:"sleep",label:"Sleep Tracker",lines:[{key:"target",label:"Min Target",def:6},{key:"ideal",label:"Ideal",def:8}]},
  ];
  const getRef=(chart,line,def)=>(s.refLines||{})[chart]?((s.refLines||{})[chart][line]??def):def;
  return (
    <div style={{paddingBottom:20}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button onClick={onBack} style={{background:M.surfaceCH,border:"none",cursor:"pointer",width:36,height:36,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={ic.back} s={20} c={M.onSurfaceV}/></button>
        <div><div style={{...T.labelL,color:M.primary,textTransform:"uppercase",letterSpacing:".8px"}}>Settings</div><div style={{...T.headlineM,color:M.onSurface,marginTop:4}}>Configuration</div></div>
      </div>
      {/* Check-in Schedule */}
      <Card style={{padding:"16px",marginBottom:12,boxSizing:"border-box"}}>
        <div style={{...T.titleS,color:M.onSurface,marginBottom:14}}>Check-in Schedule</div>
        {[{key:"morningCheckin",label:"🌅 Morning Check-in",desc:"Sleep/wake log + ritual swipe",timeKey:"morningTime",def:"06:00"},{key:"eodCheckin",label:"🌙 End-of-Day Check-in",desc:"Review tasks, log bedtime, set alarm",timeKey:"eodTime",def:"21:00"},{key:"weeklyCheckin",label:"📊 Weekly Check-in",desc:"Review week metrics and plan ahead",timeKey:"weeklyTime",def:"18:00"}].map(ci=>(
          <div key={ci.key} style={{padding:"12px 0",borderBottom:`1px solid ${M.outlineV}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div><div style={{...T.titleS,color:M.onSurface}}>{ci.label}</div><div style={{...T.bodyS,color:M.onSurfaceV}}>{ci.desc}</div></div>
              <div style={{width:44,height:24,borderRadius:12,background:s[ci.key]?M.primary:M.outlineV,display:"flex",alignItems:"center",padding:"0 2px",transition:"all .2s",flexShrink:0,cursor:"pointer"}} onClick={()=>upd(ci.key,!s[ci.key])}><div style={{width:20,height:20,borderRadius:10,background:"#FFF",transform:s[ci.key]?"translateX(20px)":"translateX(0)",transition:"transform .2s"}}/></div>
            </div>
            {s[ci.key]&&<div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              {ci.key==="weeklyCheckin"&&<><span style={{...T.labelS,color:M.outline}}>Every</span><select value={s.weeklyDay||"Sunday"} onChange={e=>upd("weeklyDay",e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:font,...T.bodyM,color:M.onSurface,outline:"none"}}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(d=><option key={d} value={d}>{d}</option>)}</select><span style={{...T.labelS,color:M.outline}}>at</span></>}
              {ci.key!=="weeklyCheckin"&&<span style={{...T.labelS,color:M.outline}}>Remind at</span>}
              <input type="time" value={s[ci.timeKey]||ci.def} onChange={e=>upd(ci.timeKey,e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:mono,...T.bodyM,color:M.onSurface,outline:"none"}}/>
            </div>}
          </div>
        ))}
      </Card>
      {/* Notion Integration */}
      <Card style={{padding:"16px",marginBottom:12,boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
          <div style={{...T.titleS,color:M.onSurface}}>Notion Integration</div>
          <button onClick={()=>setShowGuide(true)} style={{background:M.primaryC,border:"none",borderRadius:8,padding:"4px 10px",cursor:"pointer",...T.labelS,color:M.onPrimaryC,fontFamily:font,display:"flex",alignItems:"center",gap:4}}><span>📖</span> Setup Guide</button>
        </div>
        <div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:14}}>Connect to sync data with your Notion workspace</div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"8px 12px",background:M.surfaceC,borderRadius:10}}>
          <div style={{width:8,height:8,borderRadius:4,background:proxyOk?"#4CAF50":proxyOk===false?"#F44336":"#999"}}/>
          <span style={{...T.bodyS,color:M.onSurfaceV,flex:1}}>{proxyOk?"Proxy server connected":"Proxy server not detected"}</span>
          <button onClick={checkProxy} style={{background:"none",border:"none",cursor:"pointer",...T.labelS,color:M.info}}>Check</button>
        </div>
        {[{key:"notionWorkspace",label:"Workspace URL",ph:"https://neon-sauce-c4f.notion.site/...",pw:false,mono:false,sKey:null},{key:"notionToken",label:"Integration Token",ph:"ntn_...",pw:true,mono:true,sKey:null},{key:"notionTasksDb",label:"Tasks DB",ph:"2dbbf02b-...",pw:false,mono:true,sKey:"tasks"},{key:"notionDailyDb",label:"Daily Summary DB",ph:"2dbbf02b-...",pw:false,mono:true,sKey:"daily"},{key:"notionExpenseDb",label:"Expense & Debt DB",ph:"2f4bf02b-...",pw:false,mono:true,sKey:"expense"},{key:"notionWkExpDb",label:"Weekly Expense DB",ph:"2f4bf02b-...",pw:false,mono:true,sKey:"wkExp"}].map(f=>(
          <div key={f.key} style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{...T.labelS,color:M.outline,textTransform:"uppercase",flex:1}}>{f.label}</span>
              {f.sKey&&notionStatus[f.sKey]&&(
                <span style={{...T.labelS,padding:"2px 8px",borderRadius:6,
                  background:notionStatus[f.sKey]==="ok"?M.tertiaryC:notionStatus[f.sKey]==="loading"?M.primaryC:notionStatus[f.sKey]==="empty"?M.surfaceCH:M.errorC,
                  color:notionStatus[f.sKey]==="ok"?M.tertiary:notionStatus[f.sKey]==="loading"?M.primary:notionStatus[f.sKey]==="empty"?M.outline:M.error,
                }}>
                  {notionStatus[f.sKey]==="ok"?"✓ Connected":notionStatus[f.sKey]==="loading"?"Testing...":notionStatus[f.sKey]==="empty"?"No ID":"✗ Failed"}
                </span>
              )}
            </div>
            <input value={s[f.key]||""} onChange={e=>upd(f.key,e.target.value)} placeholder={f.ph} type={f.pw?"password":"text"} style={{width:"100%",padding:"10px 14px",borderRadius:12,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:f.mono===false?font:mono,...T.bodyS,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
          </div>
        ))}
        {syncMsg&&<div style={{...T.bodyS,color:syncMsg.includes("✓")?M.tertiary:syncMsg.includes("⚠")?M.error:M.onSurfaceV,padding:"8px 12px",background:M.surfaceC,borderRadius:8,marginBottom:12,textAlign:"center"}}>{syncMsg}</div>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={testAll} style={{flex:1,padding:"12px",borderRadius:12,border:`1.5px solid ${M.info}`,background:"transparent",cursor:"pointer",fontFamily:font,...T.labelM,color:M.info}}>Test</button>
          <button onClick={syncData} disabled={syncing} style={{flex:1,padding:"12px",borderRadius:12,border:"none",background:M.primary,cursor:"pointer",fontFamily:font,...T.labelM,color:M.onPrimary,opacity:syncing?.5:1}}>{syncing?"Syncing...":"Sync Now"}</button>
          <button onClick={()=>{save("cc_settings",s);setSyncMsg("✓ Settings saved!");setTimeout(()=>setSyncMsg(""),2000);}} style={{flex:1,padding:"12px",borderRadius:12,border:`1.5px solid ${M.tertiary}`,background:"transparent",cursor:"pointer",fontFamily:font,...T.labelM,color:M.tertiary,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Ic d={ic.check} s={16} c={M.tertiary}/>Save</button>
        </div>
      </Card>
      {/* Sync Log */}
      {syncLog.length>0&&<Card style={{padding:"12px",marginBottom:12,boxSizing:"border-box",maxHeight:200,overflowY:"auto"}}>
        <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:8}}>Sync Log</div>
        {syncLog.map((l,i)=>(
          <div key={i} style={{display:"flex",gap:8,marginBottom:4,...T.bodyS}}>
            <span style={{color:M.outline,fontFamily:mono,fontSize:9,flexShrink:0}}>{l.t}</span>
            <span style={{color:l.type==="success"?M.tertiary:l.type==="error"?M.error:l.type==="warn"?M.warn:M.onSurfaceV}}>{l.msg}</span>
          </div>
        ))}
      </Card>}
      {/* Google Calendar */}
      <Card style={{padding:"16px",marginBottom:12,boxSizing:"border-box"}}>
        <div style={{...T.titleS,color:M.onSurface,marginBottom:4}}>Google Calendar</div>
        <div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:14}}>View upcoming events alongside tasks</div>
        <div style={{marginBottom:12}}>
          <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:4}}>API Key</div>
          <input value={s.googleCalKey||""} onChange={e=>upd("googleCalKey",e.target.value)} placeholder="AIza..." type="password" style={{width:"100%",padding:"10px 14px",borderRadius:12,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:mono,...T.bodyS,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:4}}>Calendar ID</div>
          <input value={s.googleCalId||"primary"} onChange={e=>upd("googleCalId",e.target.value)} placeholder="primary or your@gmail.com" style={{width:"100%",padding:"10px 14px",borderRadius:12,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:font,...T.bodyS,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <button onClick={async()=>{
          if(!s.googleCalKey) { setSyncMsg("⚠ Enter Google Calendar API key first"); return; }
          await proxyPost("/api/calendar/config",{apiKey:s.googleCalKey,calId:s.googleCalId||"primary"});
          await fetchCalendarEvents();
          setSyncMsg("✓ Calendar events loaded!");
        }} style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:"#1A73E8",cursor:"pointer",fontFamily:font,...T.labelM,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><span>📅</span> Connect Calendar</button>
        {calEvents.length>0&&<div style={{marginTop:12}}>
          <div style={{...T.labelS,color:M.outline,textTransform:"uppercase",marginBottom:8}}>Upcoming Events</div>
          {calEvents.slice(0,5).map(ev=>(<div key={ev.id} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:8,padding:"8px 10px",background:M.surfaceCH,borderRadius:8}}>
            <span style={{...T.bodyS,fontFamily:mono,color:M.info,flexShrink:0}}>{ev.allDay?"All day":new Date(ev.start).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"})}</span>
            <div><div style={{...T.bodyS,color:M.onSurface}}>{ev.title}</div>{ev.location&&<div style={{...T.bodyS,color:M.onSurfaceV,fontSize:10}}>{ev.location}</div>}</div>
          </div>))}
        </div>}
      </Card>
      {/* Graph Reference Lines */}
      <Card style={{padding:"16px",marginBottom:12,boxSizing:"border-box",overflow:"hidden"}}>
        <div style={{...T.titleS,color:M.onSurface,marginBottom:4}}>Graph Reference Lines</div>
        <div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:14}}>Adjust or remove threshold lines on charts</div>
        {charts.map(chart=>(
          <div key={chart.key} style={{marginBottom:16}}>
            <div style={{...T.labelM,color:M.primary,textTransform:"uppercase",marginBottom:8}}>{chart.label}</div>
            {chart.lines.map(line=>(
              <div key={line.key} style={{marginBottom:10}}>
                <div style={{...T.labelS,color:M.onSurfaceV,marginBottom:4}}>{line.label}</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <input type="number" step="0.5" value={getRef(chart.key,line.key,line.def)} onChange={e=>updRef(chart.key,line.key,parseFloat(e.target.value)||0)} style={{flex:1,padding:"8px 10px",borderRadius:8,border:`1px solid ${M.outlineV}`,background:M.surface,fontFamily:mono,...T.bodyM,color:M.onSurface,outline:"none",minWidth:0,boxSizing:"border-box"}}/>
                  <button onClick={()=>updRef(chart.key,line.key,0)} style={{background:M.errorC,border:"none",borderRadius:6,padding:"6px 10px",cursor:"pointer",...T.labelS,color:M.error,fontFamily:font,flexShrink:0}}>Off</button>
                  <button onClick={()=>updRef(chart.key,line.key,line.def)} style={{background:M.surfaceCH,border:"none",borderRadius:6,padding:"6px 10px",cursor:"pointer",...T.labelS,color:M.outline,fontFamily:font,flexShrink:0}}>Reset</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </Card>
      {/* Account */}
      <Card style={{padding:"16px",marginBottom:12,boxSizing:"border-box"}}>
        <div style={{...T.titleS,color:M.onSurface,marginBottom:14}}>Account</div>
        <button onClick={()=>{window.location.href="/change-password";}} style={{width:"100%",padding:"12px",marginBottom:8,background:M.surfaceCH,border:"none",borderRadius:12,cursor:"pointer",fontFamily:font,...T.labelM,color:M.onSurface,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <Ic d={ic.lock} s={16} c={M.onSurfaceV}/>Change Password
        </button>
        <button onClick={()=>setShowLogout(true)} style={{width:"100%",padding:"12px",background:M.errorC,border:"none",borderRadius:12,cursor:"pointer",fontFamily:font,...T.labelM,color:M.error,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <Ic d={ic.back} s={16} c={M.error}/>Log Out
        </button>
      </Card>
      {/* Data */}
      <Card style={{padding:"16px",boxSizing:"border-box"}}>
        <div style={{...T.titleS,color:M.onSurface,marginBottom:14}}>Data Management</div>
        <div style={{...T.bodyS,color:M.onSurfaceV,marginBottom:14}}>All data stored locally.</div>
        <button onClick={async()=>{if(confirm("Reset ALL data? Cannot be undone.")){for(const k of["cc_days","cc_tasks","cc_rails","cc_budget","cc_settings","cc_expenses","cc_wk_expenses"])try{await window.storage.delete(k)}catch{};location.reload();}}} style={{width:"100%",padding:"12px",background:M.errorC,border:"none",borderRadius:12,cursor:"pointer",fontFamily:font,...T.labelM,color:M.error}}>Reset All Data</button>
      </Card>
      {/* ═══ NOTION SETUP GUIDE ═══ */}
      {showGuide&&<div style={{position:"fixed",inset:0,zIndex:250,display:"flex",justifyContent:"center"}}>
        <div onClick={()=>setShowGuide(false)} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}}/>
        <div style={{position:"relative",width:"100%",maxWidth:600,height:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
          <div style={{position:"relative",background:M.bg,borderRadius:"28px 28px 0 0",padding:"0 20px 36px",maxHeight:"95vh",overflowY:"auto",boxShadow:elev(3),boxSizing:"border-box"}}>
            <div style={{padding:"12px 0 0",display:"flex",justifyContent:"center"}}><div style={{width:32,height:4,borderRadius:2,background:M.outlineV}}/></div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 0 16px"}}><div style={{...T.titleL,color:M.onSurface}}>Notion Setup Guide</div><button onClick={()=>setShowGuide(false)} style={{background:M.surfaceCH,border:"none",cursor:"pointer",width:36,height:36,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={ic.x} s={18} c={M.onSurfaceV}/></button></div>
            {/* Step 1 */}
            <div style={{marginBottom:24}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><div style={{width:28,height:28,borderRadius:14,background:M.primary,display:"flex",alignItems:"center",justifyContent:"center",...T.labelM,color:M.onPrimary}}>1</div><div style={{...T.titleS,color:M.onSurface}}>Get Your Workspace URL</div></div>
              <svg viewBox="0 0 380 160" style={{width:"100%",borderRadius:12,marginBottom:10}}><rect width="380" height="160" rx="12" fill="#1E1E1E"/><rect x="0" y="0" width="380" height="36" rx="12" fill="#2D2D2D"/><rect x="40" y="10" width="260" height="16" rx="4" fill="#3A3A3A"/><text x="50" y="22" fill="#999" fontSize="9" fontFamily="monospace">https://neon-sauce-c4f.notion.site/Weekly-Comma...</text><rect x="40" y="10" width="260" height="16" rx="4" fill="none" stroke="#D4A574" strokeWidth="2" strokeDasharray="4,2"/><text x="310" y="22" fill="#D4A574" fontSize="8" fontFamily="sans-serif">← Copy this!</text><rect x="20" y="52" width="120" height="16" rx="3" fill="#333"/><text x="30" y="63" fill="#AAA" fontSize="9" fontFamily="sans-serif">Weekly Command Center</text><rect x="20" y="80" width="80" height="12" rx="3" fill="#444"/><text x="28" y="89" fill="#888" fontSize="8">📋 Tasks</text><rect x="20" y="100" width="100" height="12" rx="3" fill="#444"/><text x="28" y="109" fill="#888" fontSize="8">📊 Daily Summary</text><rect x="20" y="120" width="90" height="12" rx="3" fill="#444"/><text x="28" y="129" fill="#888" fontSize="8">💰 Expense & Debt</text></svg>
              <div style={{...T.bodyS,color:M.onSurfaceV,lineHeight:1.6}}>Open your <strong>Weekly Command Center</strong> page in Notion. Copy the full URL from your browser's address bar.</div>
            </div>
            {/* Step 2 */}
            <div style={{marginBottom:24}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><div style={{width:28,height:28,borderRadius:14,background:M.primary,display:"flex",alignItems:"center",justifyContent:"center",...T.labelM,color:M.onPrimary}}>2</div><div style={{...T.titleS,color:M.onSurface}}>Find Database IDs</div></div>
              <svg viewBox="0 0 380 200" style={{width:"100%",borderRadius:12,marginBottom:10}}><rect width="380" height="200" rx="12" fill="#1E1E1E"/><rect x="0" y="0" width="140" height="200" rx="12" fill="#252525"/><text x="16" y="28" fill="#999" fontSize="10" fontFamily="sans-serif">Weekly Command Center</text><rect x="16" y="40" width="110" height="14" rx="3" fill="#333"/><text x="24" y="50" fill="#AAA" fontSize="8" fontFamily="sans-serif">📋 Tasks</text><rect x="16" y="60" width="110" height="14" rx="3" fill="#3A3A3A" stroke="#D4A574" strokeWidth="1.5"/><text x="24" y="70" fill="#DDD" fontSize="8" fontFamily="sans-serif">📊 Daily Summary Records</text><text x="16" y="90" fill="#D4A574" fontSize="7" fontFamily="sans-serif">← Click on a database</text><rect x="250" y="60" width="120" height="90" rx="8" fill="#333" stroke="#444"/><text x="266" y="78" fill="#AAA" fontSize="8">Edit view</text><text x="266" y="94" fill="#AAA" fontSize="8">Filter</text><rect x="258" y="118" width="104" height="14" rx="3" fill="#444"/><text x="266" y="128" fill="#FFF" fontSize="8">Copy link to view</text><rect x="258" y="118" width="104" height="14" rx="3" fill="none" stroke="#D4A574" strokeWidth="1.5" strokeDasharray="4,2"/><text x="262" y="148" fill="#D4A574" fontSize="7">← This gives you the URL!</text></svg>
              <div style={{...T.bodyS,color:M.onSurfaceV,lineHeight:1.6}}>For each database, click the ••• menu and select "Copy link to view".</div>
            </div>
            {/* Step 3 */}
            <div style={{marginBottom:24}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><div style={{width:28,height:28,borderRadius:14,background:M.primary,display:"flex",alignItems:"center",justifyContent:"center",...T.labelM,color:M.onPrimary}}>3</div><div style={{...T.titleS,color:M.onSurface}}>Extract the Database ID</div></div>
              <svg viewBox="0 0 380 100" style={{width:"100%",borderRadius:12,marginBottom:10}}><rect width="380" height="100" rx="12" fill="#1E1E1E"/><text x="14" y="24" fill="#888" fontSize="8" fontFamily="sans-serif">The URL you copied looks like:</text><rect x="14" y="34" width="352" height="22" rx="4" fill="#2A2A2A"/><text x="20" y="48" fill="#888" fontSize="7" fontFamily="monospace">https://notion.so/</text><text x="118" y="48" fill="#D4A574" fontSize="7" fontFamily="monospace" fontWeight="bold">2dbbf02b787080dd87de...</text><text x="280" y="48" fill="#888" fontSize="7" fontFamily="monospace">?v=2dbb...</text><rect x="115" y="34" width="162" height="22" rx="0" fill="none" stroke="#D4A574" strokeWidth="2" strokeDasharray="4,2"/><text x="136" y="82" fill="#D4A574" fontSize="8" fontFamily="sans-serif">↑ This is your Database ID</text></svg>
              <div style={{...T.bodyS,color:M.onSurfaceV,lineHeight:1.6}}>The database ID is the long string after <code style={{background:M.surfaceCH,padding:"1px 4px",borderRadius:3}}>notion.so/</code> and before <code style={{background:M.surfaceCH,padding:"1px 4px",borderRadius:3}}>?v=</code>.</div>
            </div>
            {/* Step 4 */}
            <div style={{marginBottom:24}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><div style={{width:28,height:28,borderRadius:14,background:M.primary,display:"flex",alignItems:"center",justifyContent:"center",...T.labelM,color:M.onPrimary}}>4</div><div style={{...T.titleS,color:M.onSurface}}>Share Your Pages</div></div>
              <svg viewBox="0 0 380 140" style={{width:"100%",borderRadius:12,marginBottom:10}}><rect width="380" height="140" rx="12" fill="#1E1E1E"/><text x="14" y="24" fill="#CCC" fontSize="10" fontFamily="sans-serif">Share menu</text><rect x="14" y="36" width="352" height="30" rx="8" fill="#2D2D2D"/><text x="26" y="55" fill="#888" fontSize="9">Invite people, emails, groups</text><rect x="14" y="76" width="180" height="20" rx="4" fill="#333"/><text x="24" y="89" fill="#AAA" fontSize="8">🌐 Share to web</text><rect x="206" y="76" width="50" height="20" rx="10" fill="#D4A574"/><text x="216" y="89" fill="#1E1E1E" fontSize="8" fontWeight="bold">Enable</text><rect x="14" y="76" width="252" height="20" rx="4" fill="none" stroke="#D4A574" strokeWidth="2" strokeDasharray="4,2"/><text x="14" y="118" fill="#D4A574" fontSize="8" fontFamily="sans-serif">↑ Enable "Share to web" so the app can read your data</text></svg>
              <div style={{...T.bodyS,color:M.onSurfaceV,lineHeight:1.6}}>Click <strong>Share</strong> at the top right, then enable <strong>"Share to web"</strong>.</div>
            </div>
            <Card style={{padding:"14px",background:M.primaryC,boxSizing:"border-box",marginBottom:16}}><div style={{display:"flex",gap:8}}><span style={{fontSize:16}}>💡</span><div style={{...T.bodyS,color:M.onPrimaryC,lineHeight:1.5}}><strong>Quick tip:</strong> You only need to do this once. After entering your IDs, the app will remember them.</div></div></Card>
            <BtnFilled label="Got it!" onClick={()=>setShowGuide(false)} full/>
          </div>
        </div>
      </div>}
      {/* ═══ LOGOUT CONFIRMATION ═══ */}
      {showLogout&&<div style={{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={()=>setShowLogout(false)} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.5)"}}/>
        <div style={{position:"relative",width:"100%",maxWidth:340,background:M.surface,borderRadius:28,padding:"32px 24px 24px",boxShadow:elev(3),textAlign:"center"}}>
          <div style={{fontSize:48,marginBottom:12}}>👋</div>
          <div style={{...T.titleL,color:M.onSurface,marginBottom:8}}>Log out?</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginBottom:24}}>You'll need to sign in again to access your Command Center.</div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setShowLogout(false)} style={{flex:1,padding:"12px",borderRadius:16,border:`1.5px solid ${M.outlineV}`,background:"transparent",cursor:"pointer",fontFamily:font,...T.labelL,color:M.onSurface}}>Cancel</button>
            <button onClick={()=>{localStorage.removeItem("cc_token");localStorage.removeItem("cc_user");window.location.href="/login";}} style={{flex:1,padding:"12px",borderRadius:16,border:"none",background:M.error,cursor:"pointer",fontFamily:font,...T.labelL,color:M.onError}}>Log Out</button>
          </div>
        </div>
      </div>}
    </div>
  );
};
/* ══ APP ══ */
export default function App({ forcedTab }) {
  const [tab,setTab]=useState(forcedTab||"today"),[days,setDays]=useState(PRELOADED_DAYS),[tasks,setTasks]=useState(PRELOADED_TASKS),[rails,setRails]=useState(defaultRails),[loaded,setLoaded]=useState(false);
  // Sync tab with route
  useEffect(()=>{ if(forcedTab && forcedTab!==tab) setTab(forcedTab); },[forcedTab]);
  const [plannerOpen,setPlannerOpen]=useState(false);
  const [eodOpen,setEodOpen]=useState(false);
  const [budget,setBudget]=useState(0);
  const [expenses,setExpenses]=useState(PRELOADED_EXPENSES);
  const [settings,setSettings]=useState({morningCheckin:true,morningTime:"06:00",eodCheckin:true,eodTime:"21:00",weeklyCheckin:false,weeklyDay:"Sunday",weeklyTime:"18:00",refLines:{},notionWorkspace:"",notionTasksDb:"",notionDailyDb:"",notionExpenseDb:""});
  useEffect(()=>{(async()=>{setDays(await load("cc_days",PRELOADED_DAYS));setTasks(await load("cc_tasks",PRELOADED_TASKS));setRails(await load("cc_rails",defaultRails));setBudget(await load("cc_budget",0));setExpenses(await load("cc_expenses",PRELOADED_EXPENSES));const st=await load("cc_settings",{});setSettings(s=>{const merged={...s};Object.entries(st).forEach(([k,v])=>{if(v!==""&&v!==null&&v!==undefined) merged[k]=v;});return merged;});setLoaded(true);})();},[]);
  if(!loaded) return <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:M.bg,fontFamily:font}}><div style={{textAlign:"center"}}><div style={{...T.headlineM,color:M.onSurface}}>Command Center</div><div style={{...T.bodyM,color:M.onSurfaceV,marginTop:8}}>Loading...</div></div></div>;
  // Notion write-back
  const notionUpdateTask = (task) => {
    if(!task.notionPageId) return;
    proxyPatch("/api/tasks/"+task.notionPageId, {
      name:task.name, status:task.status, priority:task.priority, type:task.type,
      taskType:task.taskType, impactPoints:task.impactPoints, effortLevel:task.effortLevel,
      dueDate:task.dueDate, description:task.description, resultSatisfaction:task.resultSatisfaction,
      noiseFactor:task.noiseFactor, hrs:task.hrs, score:task.score, timeline:task.timeline,
      rail:task.rail, parentTask:task.parentTask,
    });
  };
  const notionCreateTask = async (task) => { const r = await proxyPost("/api/tasks", {name:task.name,status:task.status||"Not started",priority:task.priority,type:task.type,impactPoints:task.impactPoints,effortLevel:task.effortLevel,dueDate:task.dueDate,taskType:task.taskType}); return r.pageId || ""; };
  const notionUpdateExpense = (exp) => {
    if(!exp.notionPageId) return;
    proxyPatch("/api/expenses/"+exp.notionPageId, {
      name:exp.name, amount:exp.amount, status:exp.status, classification:exp.classification,
      unit:exp.unit, salaryPeriod:exp.salaryPeriod, datePaid:exp.datePaid,
    });
  };
  const notionCreateExpense = async (exp) => { const r = await proxyPost("/api/expenses", {name:exp.name,amount:exp.amount,status:exp.status||"Not Paid",classification:exp.classification||"Family",unit:exp.unit,salaryPeriod:exp.salaryPeriod,datePaid:exp.datePaid}); return r.pageId || ""; };
  const updateTaskWithNotion = (updater) => {
    setTasks(prev => {
      const next = typeof updater==="function" ? updater(prev) : updater;
      save("cc_tasks", next);
      // Sync changes to Notion (fire-and-forget, non-blocking)
      setTimeout(() => {
        next.forEach(t => {
          const old = prev.find(p=>p.id===t.id);
          if(!old) {
            // New task — only create in Notion if it's not a noise/local-only task
            const isNoise = (t.type||"").toLowerCase().includes("noise");
            if(!isNoise) {
              notionCreateTask(t).then(pgId => {
                if(pgId) setTasks(cur => { const up=cur.map(x=>x.id===t.id?{...x,notionPageId:pgId}:x); save("cc_tasks",up); return up; });
              }).catch(()=>{});
            }
          } else if(t.notionPageId && JSON.stringify(old)!==JSON.stringify(t)) {
            notionUpdateTask(t);
          }
        });
      }, 0);
      return next;
    });
  };
  const updateExpensesWithNotion = (updater) => {
    setExpenses(prev => {
      const next = typeof updater==="function" ? updater(prev) : updater;
      save("cc_expenses", next);
      setTimeout(() => {
        next.forEach(e => {
          const old = prev.find(p=>p.id===e.id);
          if(!old) {
            notionCreateExpense(e).then(pgId => { if(pgId) setExpenses(cur => { const up=cur.map(x=>x.id===e.id?{...x,notionPageId:pgId}:x); save("cc_expenses",up); return up; }); }).catch(()=>{});
          } else if(e.notionPageId && JSON.stringify(old)!==JSON.stringify(e)) {
            notionUpdateExpense(e);
          }
        });
      }, 0);
      return next;
    });
  };
  return (
    <>
      {tab==="today"&&<TodayView days={days} setDays={setDays} tasks={tasks} setTasks={updateTaskWithNotion} openPlanner={()=>setPlannerOpen(true)} openEOD={()=>setEodOpen(true)} rails={rails} settings={settings}/>}
      {tab==="week"&&<WeekView days={days} tasks={tasks} budget={budget} setBudget={setBudget} settings={settings}/>}
      {tab==="exec"&&<ExecView tasks={tasks} setTasks={updateTaskWithNotion} rails={rails} expenses={expenses} setExpenses={updateExpensesWithNotion}/>}
      {tab==="rails"&&<RailsView rails={rails} setRails={setRails} tasks={tasks}/>}
      {tab==="settings"&&<SettingsView settings={settings} setSettings={setSettings} onBack={()=>setTab("today")} tasks={tasks} setTasks={setTasks} days={days} setDays={setDays} expenses={expenses} setExpenses={setExpenses}/>}
      <NextDayPlanner open={plannerOpen} onClose={()=>setPlannerOpen(false)} tasks={tasks} setTasks={updateTaskWithNotion}/>
      <EODReview open={eodOpen} onClose={()=>setEodOpen(false)} tasks={tasks} setTasks={updateTaskWithNotion} days={days} setDays={setDays}/>
    </>
  );
}
