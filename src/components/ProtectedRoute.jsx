import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { M, T, font } from "../theme/tokens";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:M.bg,fontFamily:font}}>
        <div style={{textAlign:"center"}}>
          <div style={{...T.headlineM,color:M.onSurface}}>Command Center</div>
          <div style={{...T.bodyM,color:M.onSurfaceV,marginTop:8}}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
