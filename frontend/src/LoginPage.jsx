import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/* Demo credentials */
const USERS = [
  { username: 'admin',    password: 'facenetra', role: 'Administrator', avatar: '👁' },
  { username: 'analyst',  password: 'analyst123', role: 'Face Analyst',  avatar: '🔬' },
  { username: 'demo',     password: 'demo',       role: 'Demo User',     avatar: '🎯' },
];

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    await new Promise(r => setTimeout(r, 900)); // simulate auth

    const user = USERS.find(
      u => u.username === username.trim().toLowerCase() &&
           u.password === password
    );

    if (user) {
      localStorage.setItem('fn_user', JSON.stringify({ username: user.username, role: user.role, avatar: user.avatar }));
      navigate('/app');
    } else {
      setError('Invalid credentials. Try: admin / facenetra');
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      {/* Animated particle background layer */}
      <div className="login-particles" aria-hidden="true">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="particle" style={{
            left:  `${Math.random() * 100}%`,
            top:   `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 6}s`,
            animationDuration: `${6 + Math.random() * 8}s`,
            width:  `${2 + Math.random() * 4}px`,
            height: `${2 + Math.random() * 4}px`,
          }} />
        ))}
      </div>

      {/* Left: Wallpaper / Branding */}
      <div className="login-left">
        <div className="login-brand-overlay">
          <div className="login-brand">
            <img src="/logo.png" alt="FaceNetra Logo" className="login-logo-img" />
            <h1 className="login-brand-name">FaceNetra</h1>
            <p className="login-brand-tagline">Advanced AI Face Analysis Suite</p>
            <div className="login-features">
              {[
                { icon: '🎯', label: 'Face Detection'       },
                { icon: '🧠', label: 'Emotion Recognition'  },
                { icon: '⚧️', label: 'Gender Classification' },
                { icon: '📊', label: 'Age Estimation'        },
                { icon: '📜', label: 'Analysis History'      },
              ].map(f => (
                <div key={f.label} className="login-feature-chip">
                  <span>{f.icon}</span>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="login-tech-stack">
            <span className="tech-badge">UniFace 3.5</span>
            <span className="tech-badge">ONNX Runtime</span>
            <span className="tech-badge">FastAPI</span>
            <span className="tech-badge">React</span>
          </div>
        </div>
      </div>

      {/* Right: Login Form */}
      <div className="login-right">
        <div className="login-card">
          {/* Logo on mobile */}
          <div className="login-card-top">
            <img src="/logo.png" alt="FaceNetra" className="login-card-logo" />
            <h2 className="login-card-title">Welcome Back</h2>
            <p className="login-card-subtitle">Sign in to your FaceNetra account</p>
          </div>

          <form className="login-form" onSubmit={handleLogin} id="login-form">
            <div className="form-group">
              <label htmlFor="username-input" className="form-label">Username</label>
              <div className="input-wrapper">
                <span className="input-icon">👤</span>
                <input
                  id="username-input"
                  type="text"
                  className="form-input"
                  placeholder="admin"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password-input" className="form-label">Password</label>
              <div className="input-wrapper">
                <span className="input-icon">🔒</span>
                <input
                  id="password-input"
                  type={showPw ? 'text' : 'password'}
                  className="form-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="input-eye-btn"
                  id="toggle-password-btn"
                  onClick={() => setShowPw(p => !p)}
                  tabIndex={-1}
                  aria-label="Toggle password visibility"
                >
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {error && (
              <div className="login-error" role="alert">
                <span>⚠️</span> {error}
              </div>
            )}

            <button
              type="submit"
              id="login-btn"
              className="btn btn-primary btn-full login-submit"
              disabled={loading}
            >
              {loading ? (
                <><div className="spinner" style={{width:18,height:18}} /> Authenticating…</>
              ) : (
                <><span>🚀</span> Sign In</>
              )}
            </button>
          </form>

          <div className="login-demo-hint">
            <span className="demo-hint-label">Demo credentials</span>
            {USERS.map(u => (
              <button
                key={u.username}
                className="demo-cred-btn"
                id={`demo-${u.username}-btn`}
                onClick={() => { setUsername(u.username); setPassword(u.password); setError(''); }}
              >
                {u.avatar} {u.username}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
