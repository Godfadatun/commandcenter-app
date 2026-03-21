import { useLocation, useNavigate } from "react-router-dom";
import { M, T } from "../theme/tokens";
import { Ic, ic } from "./Icon";

const nav = [
  { path: "/", label: "Today", icon: ic.today },
  { path: "/week", label: "Week", icon: ic.week },
  { path: "/execute", label: "Execute", icon: ic.exec },
  { path: "/rails", label: "Rails", icon: ic.rails },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:600,background:M.surfaceC,padding:"0 8px 8px",display:"flex",justifyContent:"space-around",zIndex:40,boxShadow:"0 -1px 3px rgba(0,0,0,.08)"}}>
      {nav.map(n => {
        const active = location.pathname === n.path;
        return (
          <button key={n.path} onClick={() => navigate(n.path)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:"none",border:"none",cursor:"pointer",padding:"12px 16px 8px"}}>
            <div style={{padding:"4px 20px",borderRadius:16,background:active?M.primaryC:"transparent",transition:"all .2s"}}><Ic d={n.icon} s={24} c={active?M.onPrimaryC:M.onSurfaceV}/></div>
            <span style={{...T.labelS,color:active?M.onSurface:M.onSurfaceV,fontWeight:active?700:500}}>{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
