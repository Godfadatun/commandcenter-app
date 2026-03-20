import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authAPI } from "../../services/api";
import { M, T, font } from "../../theme/tokens";
import { Ic, ic } from "../../components/Icon";

export default function Signup() {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", confirmPassword: "" });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || !form.password) { setError("All fields required"); return; }
    if (form.password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (form.password !== form.confirmPassword) { setError("Passwords don't match"); return; }
    setError(""); setLoading(true);
    const r = await authAPI.register(form);
    setLoading(false);
    if (r.ok) {
      navigate("/verify", { state: { email: form.email } });
    } else {
      setError(r.error || "Registration failed");
    }
  };

  const fields = [
    { key: "firstName", label: "First Name", icon: ic.user, ph: "Daniel", type: "text" },
    { key: "lastName", label: "Last Name", icon: ic.user, ph: "Adegoke", type: "text" },
    { key: "email", label: "Email", icon: ic.mail, ph: "you@example.com", type: "email" },
  ];

  return (
    <div style={{minHeight:"100vh",background:M.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:font}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <img src="/logo-192.png" alt="Command Center" style={{width:72,height:72,borderRadius:16,marginBottom:16}}/>
          <div style={{...T.headlineM,color:M.onSurface}}>Create Account</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:4}}>Start tracking your signal</div>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div style={{...T.bodyS,color:M.error,background:M.errorC,padding:"10px 14px",borderRadius:12,marginBottom:16,textAlign:"center"}}>{error}</div>}

          {fields.map(f => (
            <div key={f.key} style={{marginBottom:16}}>
              <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>{f.label}</label>
              <div style={{position:"relative"}}>
                <input value={form[f.key]} onChange={set(f.key)} type={f.type} placeholder={f.ph}
                  style={{width:"100%",padding:"12px 16px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
                <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={f.icon} s={18} c={M.outline}/></div>
              </div>
            </div>
          ))}

          <div style={{marginBottom:16}}>
            <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Password</label>
            <div style={{position:"relative"}}>
              <input value={form.password} onChange={set("password")} type={showPw?"text":"password"} placeholder="Min 6 characters"
                style={{width:"100%",padding:"12px 44px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
              <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.lock} s={18} c={M.outline}/></div>
              <button type="button" onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:0}}><Ic d={showPw?ic.eyeOff:ic.eye} s={18} c={M.outline}/></button>
            </div>
          </div>

          <div style={{marginBottom:24}}>
            <label style={{...T.labelS,color:M.onSurfaceV,display:"block",marginBottom:6,textTransform:"uppercase"}}>Confirm Password</label>
            <div style={{position:"relative"}}>
              <input value={form.confirmPassword} onChange={set("confirmPassword")} type={showPw?"text":"password"} placeholder="Re-enter password"
                style={{width:"100%",padding:"12px 16px 12px 40px",borderRadius:12,border:`1px solid ${M.outlineV}`,fontFamily:font,...T.bodyM,background:M.surface,color:M.onSurface,outline:"none",boxSizing:"border-box"}}/>
              <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={ic.lock} s={18} c={M.outline}/></div>
            </div>
          </div>

          <button type="submit" disabled={loading} style={{width:"100%",padding:"14px",borderRadius:16,border:"none",background:M.primary,color:M.onPrimary,...T.labelL,fontFamily:font,cursor:loading?"wait":"pointer",opacity:loading?.7:1}}>
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <div style={{textAlign:"center",marginTop:24,...T.bodyM,color:M.onSurfaceV}}>
          Already have an account? <Link to="/login" style={{color:M.primary,fontWeight:600,textDecoration:"none"}}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
