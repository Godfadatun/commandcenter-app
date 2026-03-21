import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authAPI } from "../../services/api";
import { M, T, font } from "../../theme/tokens";
import { Ic, ic } from "../../components/Icon";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError("All fields required"); return; }
    setError(""); setLoading(true);
    const r = await authAPI.login({ email, password });
    setLoading(false);
    if (r.ok) {
      login(r.token, r.user);
      navigate("/");
    } else {
      setError(r.error || "Login failed");
    }
  };

  return (
    <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:40}}>
          <img src="/logo-192.png" alt="Command Center" style={{width:72,height:72,borderRadius:16,marginBottom:16}}/>
          <div style={{...T.headlineM,color:M.onSurface}}>Welcome back</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:4}}>Sign in to your Command Center</div>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div style={{...T.bodyS,color:M.error,background:M.errorC,padding:"10px 14px",borderRadius:12,marginBottom:16,textAlign:"center"}}>{error}</div>}

          <div style={{marginBottom:16}}>
            <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Email</label>
            <div style={{position:"relative"}}>
              <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com"
                style={{width:"100%",padding:"12px 16px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
              <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.mail} s={18} c={M.outline}/></div>
            </div>
          </div>

          <div style={{marginBottom:8}}>
            <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Password</label>
            <div style={{position:"relative"}}>
              <input value={password} onChange={e=>setPassword(e.target.value)} type={showPw?"text":"password"} placeholder="Enter password"
                style={{width:"100%",padding:"12px 44px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
              <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.lock} s={18} c={M.outline}/></div>
              <button type="button" onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:0}}>
                <Ic d={showPw?ic.eyeOff:ic.eye} s={18} c={M.outline}/>
              </button>
            </div>
          </div>

          <div style={{textAlign:"right",marginBottom:24}}>
            <Link to="/forgot-password" style={{...T.labelS,color:M.primary,textDecoration:"none"}}>Forgot password?</Link>
          </div>

          <button type="submit" disabled={loading} style={{width:"100%",padding:"14px",borderRadius:16,border:"none",background:M.primary,color:M.onPrimary,...T.labelL,fontFamily:font,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{textAlign:"center",marginTop:24,...T.bodyM,color:M.onSurfaceV}}>
          Don't have an account? <Link to="/signup" style={{color:M.primary,fontWeight:600,textDecoration:"none"}}>Sign up</Link>
        </div>
      </div>
    </div>
  );
}
