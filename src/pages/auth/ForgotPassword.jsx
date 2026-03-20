import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../services/api";
import { M, T, font } from "../../theme/tokens";
import { Ic, ic } from "../../components/Icon";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) { setError("Enter your email"); return; }
    setError(""); setLoading(true);
    const r = await api.post("/api/auth/forgot-password", { email });
    setLoading(false);
    if (r.ok || r.error?.includes("not found")) {
      // Always show success to prevent email enumeration
      setSent(true);
    } else {
      setError(r.error || "Something went wrong");
    }
  };

  if (sent) {
    return (
      <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
        <div style={{width:"100%",maxWidth:400,textAlign:"center"}}>
          <div style={{fontSize:56,marginBottom:16}}>✉️</div>
          <div style={{...T.headlineM,color:M.onSurface}}>Check your email</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:8,marginBottom:32}}>
            If an account exists for <strong>{email}</strong>, we've sent password reset instructions.
          </div>
          <Link to="/login" style={{...T.labelL,color:M.primary,textDecoration:"none"}}>Back to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:56,marginBottom:16}}>🔑</div>
          <div style={{...T.headlineM,color:M.onSurface}}>Forgot password?</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:4}}>Enter your email and we'll send a reset link</div>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div style={{...T.bodyS,color:M.error,background:M.errorC,padding:"10px 14px",borderRadius:12,marginBottom:16,textAlign:"center"}}>{error}</div>}

          <div style={{marginBottom:24}}>
            <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Email</label>
            <div style={{position:"relative"}}>
              <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com"
                style={{width:"100%",padding:"12px 16px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
              <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.mail} s={18} c={M.outline}/></div>
            </div>
          </div>

          <button type="submit" disabled={loading} style={{width:"100%",padding:"14px",borderRadius:16,border:"none",background:M.primary,color:M.onPrimary,...T.labelL,fontFamily:font,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
            {loading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <div style={{textAlign:"center",marginTop:24}}>
          <Link to="/login" style={{...T.bodyM,color:M.outline,textDecoration:"none"}}>Back to login</Link>
        </div>
      </div>
    </div>
  );
}
