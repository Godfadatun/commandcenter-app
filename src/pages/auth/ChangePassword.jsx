import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../services/api";
import { M, T, font, mono } from "../../theme/tokens";
import { Ic, ic } from "../../components/Icon";

export default function ChangePassword() {
  const [step, setStep] = useState(0); // 0=request OTP, 1=enter OTP + passwords
  const [currentPassword, setCurrentPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const requestOTP = async (e) => {
    e.preventDefault();
    if (!currentPassword) { setError("Enter your current password"); return; }
    setError(""); setLoading(true);
    // Verify current password is correct first by requesting OTP
    const r = await api.post("/api/auth/change-password/request", {});
    setLoading(false);
    if (r.ok) {
      setStep(1);
    } else {
      setError(r.error || "Failed to send OTP");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!otp) { setError("Enter the verification code"); return; }
    if (!newPassword || newPassword.length < 6) { setError("New password must be at least 6 characters"); return; }
    if (newPassword !== confirm) { setError("Passwords don't match"); return; }
    setError(""); setLoading(true);
    const r = await api.post("/api/auth/change-password", { currentPassword, otp, newPassword });
    setLoading(false);
    if (r.ok) {
      setSuccess(true);
      setTimeout(() => navigate("/settings"), 2000);
    } else {
      setError(r.error || "Failed to change password");
    }
  };

  if (success) {
    return (
      <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
        <div style={{width:"100%",maxWidth:400,textAlign:"center"}}>
          <div style={{fontSize:56,marginBottom:16}}>✅</div>
          <div style={{...T.headlineM,color:M.onSurface}}>Password changed!</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:8}}>Redirecting to settings...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:56,marginBottom:16}}>🔒</div>
          <div style={{...T.headlineM,color:M.onSurface}}>Change password</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:4}}>{step===0?"Verify your identity first":"Enter the code we sent you"}</div>
        </div>

        {step===0 ? (
          <form onSubmit={requestOTP}>
            {error && <div style={{...T.bodyS,color:M.error,background:M.errorC,padding:"10px 14px",borderRadius:12,marginBottom:16,textAlign:"center"}}>{error}</div>}

            <div style={{marginBottom:24}}>
              <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Current Password</label>
              <div style={{position:"relative"}}>
                <input value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} type={showPw?"text":"password"} placeholder="Enter current password"
                  style={{width:"100%",padding:"12px 44px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
                <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.lock} s={18} c={M.outline}/></div>
                <button type="button" onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:0}}><Ic d={showPw?ic.eyeOff:ic.eye} s={18} c={M.outline}/></button>
              </div>
            </div>

            <button type="submit" disabled={loading} style={{width:"100%",padding:"14px",borderRadius:16,border:"none",background:M.primary,color:M.onPrimary,...T.labelL,fontFamily:font,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
              {loading ? "Sending code..." : "Send Verification Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div style={{...T.bodyS,color:M.error,background:M.errorC,padding:"10px 14px",borderRadius:12,marginBottom:16,textAlign:"center"}}>{error}</div>}

            <div style={{padding:"12px 16px",background:M.tertiaryC,borderRadius:12,marginBottom:20,...T.bodyS,color:M.onTertiaryC,textAlign:"center"}}>
              Verification code sent to your email
            </div>

            <div style={{marginBottom:16}}>
              <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Verification Code</label>
              <input value={otp} onChange={e=>setOtp(e.target.value)} type="text" inputMode="numeric" placeholder="6-digit code" maxLength={6}
                style={{width:"100%",padding:"12px 16px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:mono,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box",textAlign:"center",letterSpacing:"4px",fontSize:20}}/>
            </div>

            <div style={{marginBottom:16}}>
              <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>New Password</label>
              <div style={{position:"relative"}}>
                <input value={newPassword} onChange={e=>setNewPassword(e.target.value)} type={showPw?"text":"password"} placeholder="Min 6 characters"
                  style={{width:"100%",padding:"12px 44px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
                <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.lock} s={18} c={M.outline}/></div>
                <button type="button" onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:0}}><Ic d={showPw?ic.eyeOff:ic.eye} s={18} c={M.outline}/></button>
              </div>
            </div>

            <div style={{marginBottom:24}}>
              <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Confirm New Password</label>
              <div style={{position:"relative"}}>
                <input value={confirm} onChange={e=>setConfirm(e.target.value)} type={showPw?"text":"password"} placeholder="Re-enter new password"
                  style={{width:"100%",padding:"12px 16px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
                <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.lock} s={18} c={M.outline}/></div>
              </div>
            </div>

            <button type="submit" disabled={loading} style={{width:"100%",padding:"14px",borderRadius:16,border:"none",background:M.primary,color:M.onPrimary,...T.labelL,fontFamily:font,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
              {loading ? "Changing..." : "Change Password"}
            </button>

            <div style={{textAlign:"center",marginTop:16}}>
              <button onClick={()=>{setStep(0);setError("");}} style={{background:"none",border:"none",...T.bodyS,color:M.primary,cursor:"pointer",fontFamily:font}}>Resend code</button>
            </div>
          </form>
        )}

        <div style={{textAlign:"center",marginTop:24}}>
          <button onClick={()=>navigate(-1)} style={{background:"none",border:"none",...T.bodyM,color:M.outline,cursor:"pointer",fontFamily:font}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
