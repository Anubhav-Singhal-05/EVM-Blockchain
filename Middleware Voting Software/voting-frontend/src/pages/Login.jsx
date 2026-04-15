import { useState } from "react";
import axios from "axios";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!username || !password) { setError("Please enter both username and password."); return; }
    setLoading(true);
    try {
      const res = await axios.post("/api/auth/login", { username, password });
      onLogin(res.data.user);
    } catch (err) {
      setError(err.response?.data?.error || "Invalid credentials. Try again.");
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      {/* <div className="login-left">
        <div className="login-left-content">
          <span className="login-logo-icon">🗳️</span>
          <h1 className="login-brand">Voting Middle Software</h1>
          <p className="login-brand-sub">
            Secure biometric voting middleware. Manage voter registration,
            hardware initiation, and encrypted vote storage.
          </p>
          <div className="login-features">
            <div className="login-feature"><span>🔐</span><p>RSA-encrypted vote hashing before DB storage</p></div>
            <div className="login-feature"><span>⚡</span><p>Real-time hardware initiation &amp; status polling</p></div>
            <div className="login-feature"><span>🗄️</span><p>Dual-database architecture — voters + encrypted hashes</p></div>
            <div className="login-feature"><span>👥</span><p>Role-based access: Admin and Registration Officer</p></div>
          </div>
        </div>
      </div> */}

      <div className="login-right">
        <div className="login-box">
          <div className="login-header">
            <h2>Sign In</h2>
            <p>Enter your credentials to access the panel</p>
          </div>

          {error && <div className="login-error">{error}</div>}

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="login-field">
              <label>Username</label>
              <input type="text" placeholder="Enter username" value={username}
                onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="login-field">
              <label>Password</label>
              <input type="password" placeholder="Enter password" value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign In →"}
            </button>
          </form>

          <div className="login-hint">
            <p className="hint-title">Demo Credentials</p>
            <div className="hint-row">
              <span className="hint-badge admin">Admin</span>
              <span className="hint-cred">admin / admin123</span>
            </div>
            <div className="hint-row">
              <span className="hint-badge officer">Officer</span>
              <span className="hint-cred">officer / officer123</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}