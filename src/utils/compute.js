import { calcAwakeHrs, SLEEP_TARGET } from "./date";

export const computeDay = (tasks, dayData, date) => {
  const nm = dayData.notionMetrics;
  if (nm && (nm.totalTasks > 0 || nm.tasksDone > 0 || nm.impactExpected > 0)) {
    const awakeHrs = nm.awakeTime || calcAwakeHrs(dayData.wakeUp, dayData.sleepTime);
    const sleepHrs = dayData.wakeUp && dayData.sleepTime ? 24 - calcAwakeHrs(dayData.wakeUp, dayData.sleepTime) : 0;
    const rituals = [dayData.exercise, dayData.sleep, dayData.calendar, dayData.scheduling, dayData.docPrep];
    const ritualsDone = rituals.filter(s => s === "done").length;
    return {
      totalTasks: nm.totalTasks, tasksDone: nm.tasksDone,
      impactExpected: nm.impactExpected, impactAchieved: nm.impactAchieved,
      noiseHrs: nm.noiseHrs, signalHrs: 0, awakeHrs, sleepHrs,
      sleepMet: sleepHrs >= SLEEP_TARGET,
      spend: nm.spend || (dayData.spendLog || []).reduce((s,e) => s + (e.amount||0), 0),
      signal: nm.signalScore || 0, noise: nm.noiseScore || 0, snr: nm.snr || 0,
      ritualsDone, rituals: 5,
      distractedPct: nm.distractedPct || 0,
    };
  }
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

export const snrLbl = v => v>10?"Exceptional":v>=5?"Strong Focus":v>=1?"Improve":v>0?"High Noise":"No Data";
export const snrDesc = v => v>10?"High impact, minimal noise":v>=5?"Good signal, manageable noise":v>=1?"Balance impact and cut noise":v>0?"Noise drowning signal":"Log tasks to compute";
export const snrClr = v => v>10?"#386A20":v>=5?"#8B5E3C":v>=1?"#7C6F00":"#BA1A1A";
