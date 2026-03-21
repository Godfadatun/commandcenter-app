import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";

// Auth pages
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import VerifyOTP from "./pages/auth/VerifyOTP";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import ChangePassword from "./pages/auth/ChangePassword";

// App pages — temporarily import from LegacyApp
import LegacyApp from "./LegacyApp";

// Wrapper that renders the legacy app's views inside the new layout
// Each page will be split into its own file in a follow-up
import { LegacyToday, LegacyWeek, LegacyExecute, LegacyRails, LegacySettings } from "./pages/LegacyPages";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public auth routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify" element={<VerifyOTP />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Protected full-screen routes (no bottom nav) */}
          <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />

          {/* Protected app routes with layout */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<LegacyToday />} />
            <Route path="/week" element={<LegacyWeek />} />
            <Route path="/execute" element={<LegacyExecute />} />
            <Route path="/rails" element={<LegacyRails />} />
            <Route path="/settings" element={<LegacySettings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
