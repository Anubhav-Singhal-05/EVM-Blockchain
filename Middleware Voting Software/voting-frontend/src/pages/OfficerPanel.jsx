import { useState, useEffect, useRef } from "react";
import axios from "axios";

const API          = "/api/voters";
const TIMEOUT_SECS = 60;

function StatusBadge({ voter, timedOut, sessionActive }) {
  if (voter.voteProcessed) return <span className="badge green">✅ Vote Stored</span>;
  if (timedOut)            return <span className="badge gray">⏰ Timed Out</span>;
  if (sessionActive)       return <span className="badge yellow">⏳ Waiting…</span>;
  return <span className="badge gray">Pending</span>;
}

function TrackerStep({ num, label, done }) {
  return (
    <div className={`tracker-step ${done ? "done" : "pending"}`}>
      <div className="tracker-circle">{done ? "✓" : num}</div>
      <p>{label}</p>
    </div>
  );
}

export default function OfficerPanel({ user, onLogout }) {
  const [uid, setUid]             = useState("");
  const [voter, setVoter]         = useState(null);
  const [message, setMessage]     = useState({ text: "", type: "" });
  const [loading, setLoading]     = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [timedOut, setTimedOut]   = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const pollRef      = useRef(null);
  const countdownRef = useRef(null);

  const stopTimers = () => {
    clearInterval(pollRef.current);
    clearInterval(countdownRef.current);
  };

  // ── poll every 3s only when session is active ─────────────
  useEffect(() => {
    if (sessionActive && voter && !voter.voteProcessed && !timedOut) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await axios.get(`${API}/search?uid=${voter.uid}`);
          if (res.data.voteProcessed) {
            stopTimers();
            setCountdown(null);
            setSessionActive(false);
            setVoter(res.data);
            showMsg(`✅ Vote successfully stored for ${res.data.name}`, "success");
          }
        } catch { }
      }, 3000);
    }
    return () => clearInterval(pollRef.current);
  }, [sessionActive, voter?.uid, voter?.voteProcessed, timedOut]);

  // ── countdown only when session is active ─────────────────
  useEffect(() => {
    if (sessionActive && voter && !voter.voteProcessed && !timedOut) {

      // ── calculate remaining time from initiatedAt ──────────
      // this works whether session just started OR resumed after
      // coming back from another voter search
      let remaining = TIMEOUT_SECS;
      if (voter.initiatedAt) {
        const elapsed = Math.floor(
          (Date.now() - new Date(voter.initiatedAt).getTime()) / 1000
        );
        remaining = Math.max(0, TIMEOUT_SECS - elapsed);
      }

      // if already expired by the time we resume → timeout immediately
      if (remaining <= 0) {
        handleTimeoutExpired();
        return;
      }

      setCountdown(remaining);

      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            handleTimeoutExpired();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(countdownRef.current);
  }, [sessionActive]); // triggers when sessionActive flips to true

  const showMsg = (text, type = "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 5000);
  };

  // ── timeout: stop, erase, wait for officer to click ───────
  const handleTimeoutExpired = async () => {
    stopTimers();
    setSessionActive(false);
    setTimedOut(true);
    setCountdown(0);

    try {
      await axios.post(`${API}/timeout`, { uid: voter?.uid });
    } catch { }

    setVoter((v) => v ? ({
      ...v,
      hardwareInitiated: false,
      voteProcessed:     false,
      hash1:             null,
      timestamp2:        null,
      initiatedAt:       null,
    }) : v);

    showMsg(
      `⏰ Session expired for ${voter?.name}. All partial data cleared. Click Re-Initiate when ready.`,
      "error"
    );
  };

  // ── SEARCH ────────────────────────────────────────────────
  const handleSearch = async (e) => {
    e.preventDefault();
    const val = uid.trim().toUpperCase();
    if (!val) return;

    stopTimers();
    setSessionActive(false);
    setTimedOut(false);
    setCountdown(null);
    setVoter(null);

    setLoading(true);
    try {
      const res = await axios.get(`${API}/search?uid=${val}`);
      const v = res.data;
      setVoter(v);

      if (v.timedOut) {
        // backend found stale/timed-out data and already cleared it
        setTimedOut(true);
        showMsg(
          `⏰ Previous session for ${v.name} had timed out and was cleared.`,
          "error"
        );
      } else if (v.hardwareInitiated && !v.voteProcessed && v.initiatedAt) {
        // ── RESUME: voter is still actively voting ─────────────
        // check if already expired
        const elapsed = Math.floor(
          (Date.now() - new Date(v.initiatedAt).getTime()) / 1000
        );
        const remaining = TIMEOUT_SECS - elapsed;

        if (remaining <= 0) {
          // expired while officer was away → trigger timeout
          setTimedOut(true);
          try { await axios.post(`${API}/timeout`, { uid: v.uid }); } catch { }
          setVoter({ ...v, hardwareInitiated: false, initiatedAt: null });
          showMsg(`⏰ Session for ${v.name} already expired. Please Re-Initiate.`, "error");
        } else {
          // still time left → resume countdown from remaining seconds
          showMsg(`Resumed session for ${v.name}. ${remaining}s remaining.`, "success");
          setSessionActive(true); // ← this triggers the countdown useEffect
        }
      } else {
        showMsg(`Found: ${v.name}`, "success");
      }
    } catch (err) {
      setVoter(null);
      showMsg(err.response?.data?.error || "Voter not found", "error");
    }
    setLoading(false);
  };

  // ── INITIATE: only on manual click ────────────────────────
  const handleInitiate = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/initiate`, { uid: voter.uid });
      showMsg(res.data.message, "success");

      setTimedOut(false);
      setCountdown(TIMEOUT_SECS);

      setVoter((v) => ({
        ...v,
        hardwareInitiated: true,
        initiatedAt:       res.data.initiatedAt,
      }));

      setSessionActive(true); // only place this is set to true
    } catch (err) {
      showMsg(
        err.response?.data?.error || "Error initiating hardware",
        "error"
      );
    }
    setLoading(false);
  };

  const handleClear = () => {
    stopTimers();
    setVoter(null);
    setUid("");
    setCountdown(null);
    setTimedOut(false);
    setSessionActive(false);
  };

  const countdownColor =
    countdown > 30 ? "#68d391" :
    countdown > 10 ? "#f6e05e" : "#fc8181";

  return (
    <div className="app">

      {/* ── HEADER ── */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🗳️</span>
            <div>
              <h1>Voting Middle Software</h1>
              <p>Registration Officer Panel</p>
            </div>
          </div>
          <div className="header-right">
            <div className="user-pill">
              <span className="user-pill-icon">👤</span>
              <span>{user.username}</span>
              <span className="user-role-badge officer">Officer</span>
            </div>
            <button className="logout-btn" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      {message.text && (
        <div className={`toast ${message.type}`}>{message.text}</div>
      )}

      <main className="main">

        {/* ── SEARCH CARD ── */}
        <div className="card">
          <h2>Search Voter by UID</h2>
          <p className="subtitle">
            Search a voter first, then manually click Initiate to start their
            session. Only one voter can be active at a time.
          </p>
          <form className="search-form" onSubmit={handleSearch}>
            <input
              type="text"
              className="search-input"
              placeholder="e.g. UID001"
              value={uid}
              onChange={(e) => setUid(e.target.value.toUpperCase())}
            />
            <button
              type="submit"
              className="btn primary"
              disabled={loading || !uid}
            >
              {loading ? "Searching…" : "🔍 Search"}
            </button>
            {voter && (
              <button
                type="button"
                className="btn outline"
                onClick={handleClear}
              >
                ✕ Clear
              </button>
            )}
          </form>
        </div>

        {/* ── VOTER RESULT CARD ── */}
        {voter && (
          <div className="voter-result-card">

            {/* Info row */}
            <div className="voter-info-row">
              <div className="voter-avatar">{voter.name[0]}</div>
              <div className="voter-details">
                <h3>{voter.name}</h3>
                <p className="uid-text">UID: {voter.uid}</p>
              </div>
              <div className="voter-status-right">
                <StatusBadge
                  voter={voter}
                  timedOut={timedOut}
                  sessionActive={sessionActive}
                />
              </div>
            </div>

            {/* 3-step tracker */}
            <div className="status-tracker">
              <TrackerStep
                num="1"
                label="Voter Found"
                done={true}
              />
              <div className="tracker-line" />
              <TrackerStep
                num="2"
                label="Hardware Initiated"
                done={sessionActive || voter.voteProcessed}
              />
              <div className="tracker-line" />
              <TrackerStep
                num="3"
                label="Vote Encrypted & Stored"
                done={voter.voteProcessed}
              />
            </div>

            {/* ── COUNTDOWN (only when session active) ── */}
            {sessionActive && !voter.voteProcessed && countdown !== null && (
              <div style={{
                textAlign: "center",
                padding: "20px 16px",
                background: "#0f1117",
                borderRadius: 10,
                border: `2px solid ${countdownColor}`,
                transition: "border-color 0.5s",
              }}>
                <p style={{ fontSize: 12, color: "#718096", marginBottom: 8 }}>
                  ⏱ Session expires in
                </p>
                <p style={{
                  fontSize: 52,
                  fontWeight: 700,
                  color: countdownColor,
                  fontFamily: "monospace",
                  transition: "color 0.5s",
                  lineHeight: 1,
                }}>
                  {String(Math.floor(countdown / 60)).padStart(2, "0")}:
                  {String(countdown % 60).padStart(2, "0")}
                </p>
                <p style={{ fontSize: 11, color: "#718096", marginTop: 8 }}>
                  No other voter can be initiated until this session ends
                </p>
              </div>
            )}

            {/* ── TIMED OUT BANNER ── */}
            {timedOut && !voter.voteProcessed && (
              <div style={{
                background: "#742a2a22",
                border: "1px solid #9b2c2c",
                borderRadius: 10,
                padding: 16,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}>
                <span style={{ fontSize: 24, marginTop: 2 }}>⏰</span>
                <div>
                  <p className="status-title" style={{ color: "#fc8181", marginBottom: 6 }}>
                    Session Timed Out
                  </p>
                  <p className="status-desc">
                    The 60-second voting window expired. All partial data has
                    been cleared. Click <strong>Re-Initiate</strong> below to
                    start a fresh session for <strong>{voter.name}</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* ── ACTION AREA ── */}
            <div className="action-area">

              {/* Vote completed */}
              {voter.voteProcessed && (
                <div className="status-box green">
                  <span className="status-dot green-dot" />
                  <div>
                    <p className="status-title">Vote Received &amp; Encrypted</p>
                    <p className="status-desc">
                      H1 hash received. RSA encryption applied and forwarded
                      to Database 2. Process complete.
                    </p>
                    {voter.timestamp2 && (
                      <p className="status-desc" style={{ marginTop: 6 }}>
                        Received at:{" "}
                        <strong>
                          {new Date(voter.timestamp2).toLocaleString()}
                        </strong>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Session active — waiting for vote */}
              {sessionActive && !voter.voteProcessed && (
                <div className="status-box yellow">
                  <span className="status-dot yellow-dot" />
                  <div>
                    <p className="status-title">Hardware Active — Awaiting Vote</p>
                    <p className="status-desc">
                      Biometric machine is active for{" "}
                      <strong>{voter.name}</strong>. Voter must complete
                      within the countdown. No other voter can be initiated
                      until this session ends.
                    </p>
                  </div>
                </div>
              )}

              {/* Fresh voter — show Initiate button */}
              {!sessionActive && !voter.voteProcessed && !timedOut && (
                <>
                  <div className="status-box yellow">
                    <span className="status-dot yellow-dot" />
                    <div>
                      <p className="status-title">Ready to Initiate</p>
                      <p className="status-desc">
                        Voter found. Click the button below to unlock the
                        hardware voting machine for{" "}
                        <strong>{voter.name}</strong>. They will have 60
                        seconds to complete their vote.
                      </p>
                    </div>
                  </div>
                  <button
                    className="btn initiate"
                    onClick={handleInitiate}
                    disabled={loading}
                  >
                    ⚡ Initiate Hardware for {voter.name}
                  </button>
                </>
              )}

              {/* Timed out — officer must manually click Re-Initiate */}
              {timedOut && !voter.voteProcessed && (
                <button
                  className="btn initiate"
                  onClick={handleInitiate}
                  disabled={loading}
                  style={{
                    background: "linear-gradient(135deg, #c05621, #9c4221)",
                  }}
                >
                  ⚡ Re-Initiate Hardware for {voter.name}
                </button>
              )}

              <button className="btn outline" onClick={handleClear}>
                Search Another Voter
              </button>

            </div>
          </div>
        )}

      </main>
    </div>
  );
}
