import Brand from "../components/layout/Brand";
import ThemeToggle from "../components/ui/ThemeToggle";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Label } from "../components/ui/Label";
import { Lock, Mail, Eye, EyeOff, ArrowRight, ArrowUpRight, Check, CalendarDays, LoaderCircle } from "lucide-react";
import { userApi } from "../lib/api";
import { toast } from "react-hot-toast";
import { useAuthStore } from "../store/authStore";
import { useModuleStore } from "../store/moduleStore";

export default function Login() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { setModules } = useModuleStore();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Call the real authentication API
      const response = await userApi.login({
        email: formData.email,
        password: formData.password,
      });

      // Store token, user data and the organisation's enabled modules
      const { token, user, enabledModules } = response.data.data;

      // Store in auth store (this persists to localStorage automatically via zustand persist)
      setAuth(user, token);
      setModules(enabledModules || []);

      // Also store in localStorage for backward compatibility
      localStorage.setItem("token", token);
      localStorage.setItem("isAuthenticated", "true");
      localStorage.setItem("userRole", user.role.toLowerCase());
      localStorage.setItem("userName", user.name);
      localStorage.setItem("userEmail", user.email);

      toast.success("Login successful!");

      // Navigate based on role
      if (user.role === "MASTER") {
        navigate("/master");
      } else if (user.role === "ADMIN" || user.role === "MANAGER") {
        navigate("/dashboard");
      } else {
        navigate("/user");
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message || "Invalid email or password";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error when user starts typing
    if (error) setError("");
  };

  return (
    <div className="login-page">
      <header className="login-header"><Brand /><div className="login-header-right"><span>Your people. Your rhythm.</span><ThemeToggle /></div></header>
      <main className="login-main">
        <section className="login-story" aria-label="Welcome to Tapvera Scheduler">
          <div className="login-story-top"><span className="story-edition">THE WORKFORCE, WELL ORGANISED</span><ArrowUpRight size={22} strokeWidth={1.4} /></div>
          <h1>People in place.<br />Work in <em>motion.</em></h1>
          <p className="login-story-description">A little less organising.<br />A lot more getting things done.</p>
          <div className="schedule-illustration" aria-hidden="true">
            <div className="illustration-top"><span><CalendarDays size={15} /> A week, in balance</span><span className="illustration-badge"><span /> All in place</span></div>
            <div className="illustration-grid"><div className="illustration-days"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span></div>
              <div className="illustration-row"><div className="shift-block shift-a"><span className="mini-avatar">JL</span><span>Morning shift<small>08:00 — 16:00</small></span><Check size={14} /></div></div>
              <div className="illustration-row"><div className="shift-block shift-b"><span className="mini-avatar">AK</span><span>On-site team<small>09:00 — 17:00</small></span><Check size={14} /></div></div>
              <div className="illustration-row"><div className="shift-block shift-c"><span className="mini-avatar">MR</span><span>Evening shift<small>14:00 — 22:00</small></span><Check size={14} /></div></div>
            </div>
            <div className="illustration-foot"><span className="stacked-avatars"><i>JL</i><i>AK</i><i>MR</i></span><span>Good work starts with a good plan.</span></div>
          </div>
          <div className="login-story-footer"><span>Built for teams that keep things moving.</span><span>01 — 03</span></div>
        </section>
        <section className="login-form-section">
          <div className="login-form-inner">
            <span className="eyebrow">YOUR WORKSPACE AWAITS</span>
            <h2>Welcome back.</h2>
            <p className="login-subtitle">Sign in and pick up where your team left off.</p>
            <form onSubmit={handleSubmit} className="login-form">
              <div className="space-y-2"><Label htmlFor="email">Work email</Label><div className="relative"><Mail className="login-input-icon" size={17} /><Input id="email" name="email" type="email" placeholder="you@company.com" value={formData.email} onChange={handleChange} className="pl-11 h-12" required autoComplete="username" autoCapitalize="none" spellCheck={false} /></div></div>
              <div className="space-y-2"><Label htmlFor="password">Password</Label><div className="relative"><Lock className="login-input-icon" size={17} /><Input id="password" name="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" value={formData.password} onChange={handleChange} className="pl-11 pr-12 h-12" required autoComplete="current-password" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="login-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
              {error && <div className="login-error" role="alert">{error}</div>}
              <Button type="submit" size="lg" className="w-full justify-between" disabled={isLoading}>{isLoading ? "Signing you in…" : "Sign in to your workspace"}{isLoading ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowRight size={17} />}</Button>
            </form>
            <div className="login-help"><span>Need a hand signing in?</span><p>Contact your organisation administrator for access or a password reset.</p></div>
            <div className="login-security"><Lock size={12} /><span>Your team's workspace. Securely connected.</span></div>
          </div>
        </section>
      </main>
      <footer className="login-footer"><span>© {new Date().getFullYear()} Tapvera Scheduler</span><span>Make room for better work.</span></footer>
    </div>
  );
}
