import { M, T, elev, font, mono } from "../theme/tokens";
import { Ic, ic } from "./Icon";

export const BtnFilled = ({label,onClick,icon,full,disabled,color=M.primary,tc=M.onPrimary}) => (
  <button onClick={disabled?undefined:onClick} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 24px",borderRadius:20,border:"none",background:disabled?M.surfaceCHi:color,color:disabled?M.outline:tc,...T.labelL,fontFamily:font,cursor:disabled?"default":"pointer",width:full?"100%":"auto",opacity:disabled?.5:1}}>
    {icon&&<Ic d={icon} s={18} c={disabled?M.outline:tc}/>}{label}
  </button>
);

export const FilterChip = ({label,active,onClick,color}) => (
  <button onClick={onClick} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 16px",borderRadius:8,border:`1px solid ${active?(color||M.primary):M.outlineV}`,background:active?(color?color+"20":M.primaryC):"transparent",color:active?(color||M.onPrimaryC):M.onSurfaceV,...T.labelM,fontFamily:font,cursor:"pointer",transition:"all .2s"}}>
    {active&&<Ic d={ic.check} s={14} c={color||M.onPrimaryC}/>}{label}
  </button>
);

export const StatusDot = ({status}) => {
  const map={"Done":M.tertiary,"In progress":M.primary,"Scheduled":M.warn,"Not started":M.outlineV,"Deffered":M.outline,"Paused":M.info,"Missed":M.error};
  return <span style={{width:8,height:8,borderRadius:4,background:map[status]||M.outlineV,display:"inline-block",flexShrink:0}}/>;
};

export const Card = ({children,style={},onClick,elevated}) => (
  <div onClick={onClick} style={{background:M.surface,borderRadius:16,border:elevated?undefined:`1px solid ${M.outlineV}`,boxShadow:elevated?elev(1):elev(0),overflow:"hidden",cursor:onClick?"pointer":"default",boxSizing:"border-box",maxWidth:"100%",...style}}>{children}</div>
);

export const Stat = ({label,value,sub,color}) => (
  <Card style={{padding:"14px 16px",flex:1,minWidth:0,boxSizing:"border-box"}}>
    <div style={{...T.labelS,color:M.onSurfaceV,textTransform:"uppercase",marginBottom:6}}>{label}</div>
    <div style={{fontSize:24,fontWeight:700,color:color||M.onSurface,fontFamily:mono,lineHeight:1}}>{value}</div>
    {sub&&<div style={{...T.bodyS,color:M.onSurfaceV,marginTop:4}}>{sub}</div>}
  </Card>
);

export const Bar = ({value,max,color=M.primary,h=4}) => (
  <div style={{width:"100%",height:h,borderRadius:h,background:M.surfaceCH,overflow:"hidden"}}>
    <div style={{width:`${max>0?Math.min((value/max)*100,100):0}%`,height:"100%",borderRadius:h,background:color,transition:"width .4s ease"}}/>
  </div>
);

export const PBadge = ({p}) => { if(!p) return null; const c=p==="High"?M.error:p==="Medium"?M.warn:M.info; return <span style={{...T.labelS,padding:"2px 8px",borderRadius:8,background:c+"18",color:c}}>{p}</span>; };
export const TBadge = ({t}) => { if(!t) return null; const n=t.toLowerCase().includes("noise"); return <span style={{...T.labelS,padding:"2px 8px",borderRadius:8,background:n?M.errorC:M.tertiaryC,color:n?M.onErrorC:M.onTertiaryC}}>{t.replace("Signal – ","").replace("Noise – ","⚡")}</span>; };
export const EBadge = ({e}) => e?<span style={{...T.labelS,padding:"2px 8px",borderRadius:8,background:M.surfaceCH,color:M.onSurfaceV}}>{e}</span>:null;
