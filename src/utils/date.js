export const fmt = d => d.toISOString().split("T")[0];
export const DAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const weekDates = d => { const s = new Date(d); s.setDate(s.getDate()-s.getDay()+1); return Array.from({length:7},(_,i)=>{const x=new Date(s);x.setDate(s.getDate()+i);return x;}); };
export const getQ = d => Math.floor(d.getMonth()/3)+1;
export const tomorrow = () => { const t = new Date(); t.setDate(t.getDate()+1); return fmt(t); };
export const relDate = (dateStr) => {
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
export const parseTime = (t) => { if(!t) return null; const [h,m]=(t.includes(":")?t:`${t}:00`).split(":").map(Number); return h+(m||0)/60; };
export const calcAwakeHrs = (wakeUp, sleepTime) => {
  const w = parseTime(wakeUp), s = parseTime(sleepTime);
  if(w!==null && s!==null) return s>w ? s-w : (24-w)+s;
  if(w!==null) { const now=new Date(); return (now.getHours()+now.getMinutes()/60)-w; }
  return 16;
};
export const SLEEP_TARGET = 6;
export const fmtTimer = (ms) => {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
  const pad = n => String(n).padStart(2,"0");
  return h > 0 ? `${h}:${pad(m%60)}:${pad(s%60)}` : `${pad(m%60)}:${pad(s%60)}`;
};
export const fmtHrs = (ms) => (ms/3600000).toFixed(1);
