import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "../../services/api";
import { M, T, font } from "../../theme/tokens";
import { Ic, ic } from "../../components/Icon";

export default function ResetPassword() {
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !otp) { setError("Email and reset code required"); return; }
    if (!password || password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords don't match"); return; }
    setError(""); setLoading(true);
    const r = await api.post("/api/auth/reset-password", { email, otp, password });
    setLoading(false);
    if (r.ok) {
      setSuccess(true);
      setTimeout(() => navigate("/login"), 3000);
    } else {
      setError(r.error || "Reset failed. Code may have expired.");
    }
  };

  if (success) {
    return (
      <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
        <div style={{width:"100%",maxWidth:400,textAlign:"center"}}>
          <div style={{fontSize:56,marginBottom:16}}>✅</div>
          <div style={{...T.headlineM,color:M.onSurface}}>Password reset!</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:8}}>Redirecting to login...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:56,marginBottom:16}}>🔒</div>
          <div style={{...T.headlineM,color:M.onSurface}}>Reset password</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:4}}>Enter the code sent to your email</div>
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

          <div style={{marginBottom:16}}>
            <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Reset Code</label>
            <input value={otp} onChange={e=>setOtp(e.target.value)} type="text" inputMode="numeric" placeholder="6-digit code" maxLength={6}
              style={{width:"100%",padding:"12px 16px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box",textAlign:"center",letterSpacing:"4px",fontSize:20}}/>
          </div>

          <div style={{marginBottom:16}}>
            <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>New Password</label>
            <div style={{position:"relative"}}>
              <input value={password} onChange={e=>setPassword(e.target.value)} type={showPw?"text":"password"} placeholder="Min 6 characters"
                style={{width:"100%",padding:"12px 44px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
              <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.lock} s={18} c={M.outline}/></div>
              <button type="button" onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:0}}><Ic d={showPw?ic.eyeOff:ic.eye} s={18} c={M.outline}/></button>
            </div>
          </div>

          <div style={{marginBottom:24}}>
            <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Confirm Password</label>
            <div style={{position:"relative"}}>
              <input value={confirm} onChange={e=>setConfirm(e.target.value)} type={showPw?"text":"password"} placeholder="Re-enter password"
                style={{width:"100%",padding:"12px 16px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
              <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.lock} s={18} c={M.outline}/></div>
            </div>
          </div>

          <button type="submit" disabled={loading} style={{width:"100%",padding:"14px",borderRadius:16,border:"none",background:M.primary,color:M.onPrimary,...T.labelL,fontFamily:font,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>

        <div style={{textAlign:"center",marginTop:24}}>
          <Link to="/login" style={{...T.bodyM,color:M.outline,textDecoration:"none"}}>Back to login</Link>
        </div>
      </div>
    </div>
  );
}
