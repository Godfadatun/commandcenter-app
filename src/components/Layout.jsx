import { Outlet, useNavigate } from "react-router-dom";
import { M, elev, font } from "../theme/tokens";
import { Ic, ic } from "./Icon";
import BottomNav from "./BottomNav";

export default function Layout() {
  const navigate = useNavigate();

  return (
    <div style={{maxWidth:600,margin:"0 auto",minHeight:"100vh",background:M.bg,fontFamily:font,position:"relative",display:"flex",flexDirection:"column",overflow:"hidden",boxSizing:"border-box"}}>
      <button onClick={() => navigate("/settings")} style={{position:"absolute",top:20,right:18,zIndex:45,width:36,height:36,borderRadius:18,background:"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <Ic d={ic.settings} s={20} c={M.onSurfaceV}/>
      </button>
      <div style={{flex:1,padding:"20px 18px 100px",overflowY:"auto",overflowX:"hidden"}}>
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
