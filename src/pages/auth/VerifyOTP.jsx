import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authAPI } from "../../services/api";
import { M, T, font, mono } from "../../theme/tokens";

export default function VerifyOTP() {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);
  const refs = useRef([]);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || "";

  useEffect(() => {
    if (!email) navigate("/signup");
    refs.current[0]?.focus();
  }, []);

  const handleChange = (idx, val) => {
    if (val.length > 1) val = val[val.length - 1];
    if (val && !/\d/.test(val)) return;
    const next = [...otp];
    next[idx] = val;
    setOtp(next);
    if (val && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !otp[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      setOtp(text.split(""));
      refs.current[5]?.focus();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) { setError("Enter the full 6-digit code"); return; }
    setError(""); setLoading(true);
    const r = await authAPI.verify({ email, otp: code });
    setLoading(false);
    if (r.ok) {
      login(r.token, r.user);
      navigate("/");
    } else {
      setError(r.error || "Verification failed");
    }
  };

  const handleResend = async () => {
    const r = await authAPI.register({ email, firstName: ".", lastName: ".", password: "resend" });
    setResent(true);
    setTimeout(() => setResent(false), 30000);
  };

  return (
    <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
      <div style={{width:"100%",maxWidth:400,textAlign:"center"}}>
        <div style={{fontSize:56,marginBottom:16}}>📧</div>
        <div style={{...T.headlineM,color:M.onSurface}}>Verify your email</div>
        <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:8,marginBottom:32}}>
          We sent a 6-digit code to<br/><strong style={{color:M.onSurface}}>{email}</strong>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div style={{...T.bodyS,color:M.error,background:M.errorC,padding:"10px 14px",borderRadius:12,marginBottom:16}}>{error}</div>}

          <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:32}} onPaste={handlePaste}>
            {otp.map((digit, i) => (
              <input key={i} ref={el => refs.current[i] = el} value={digit} onChange={e => handleChange(i, e.target.value)} onKeyDown={e => handleKeyDown(i, e)}
                type="text" inputMode="numeric" maxLength={1}
                style={{width:48,height:56,borderRadius:12,border:`2px solid ${digit?M.primary:M.outlineV}`,background:M.surface,textAlign:"center",
                  fontSize:24,fontWeight:700,fontFamily:mono,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
            ))}
          </div>

          <button type="submit" disabled={loading} style={{width:"100%",padding:"14px",borderRadius:16,border:"none",background:M.primary,color:M.onPrimary,...T.labelL,fontFamily:font,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
            {loading ? "Verifying..." : "Verify Email"}
          </button>
        </form>

        <div style={{marginTop:24,...T.bodyM,color:M.onSurfaceV}}>
          Didn't receive a code?{" "}
          <button onClick={handleResend} disabled={resent} style={{background:"none",border:"none",color:resent?M.outline:M.primary,fontWeight:600,cursor:resent?"default":"pointer",fontFamily:font,...T.bodyM}}>
            {resent ? "Sent! Check your inbox" : "Resend"}
          </button>
        </div>

        <div style={{marginTop:16}}>
          <Link to="/login" style={{...T.bodyS,color:M.outline,textDecoration:"none"}}>Back to login</Link>
        </div>
      </div>
    </div>
  );
}
