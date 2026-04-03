import { useState, useEffect, useRef } from "react";
import axios from "axios";

const API = "/api/voters";

export default function AdminPanel({ user, onLogout }) {
  const [voters, setVoters]                   = useState([]);
  const [hashRecords, setHashRecords]         = useState([]);
  const [message, setMessage]                 = useState({ text: "", type: "" });
  const [loading, setLoading]                 = useState(false);
  const [activeTab, setActiveTab]             = useState("db1");
  const [seeded, setSeeded]                   = useState(false);
  const [blockchainResult, setBlockchainResult] = useState(null);
  const [uploading, setUploading]             = useState(false);
  const pollRef                               = useRef(null);

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  const fetchAll = async () => {
    try {
      const [v, h] = await Promise.all([axios.get(API), axios.get(`${API}/hash-records`)]);
      setVoters(v.data);
      setHashRecords(h.data);
      if (v.data.length > 0) setSeeded(true);
    } catch { }
  };

  const showMsg = (text, type = "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  };

  const handleSeed = async () => {
    if (seeded) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API}/seed`);
      showMsg(res.data.message, "success");
      setSeeded(true);
      fetchAll();
    } catch { showMsg("Seed failed or already seeded", "error"); }
    setLoading(false);
  };

  const handleClear = async () => {
    if (!window.confirm("Delete ALL voters and hash records? This cannot be undone.")) return;
    setLoading(true);
    try {
      await axios.delete(`${API}/clear`);
      showMsg("All data cleared", "success");
      setSeeded(false);
      setBlockchainResult(null);
      fetchAll();
    } catch { showMsg("Clear failed", "error"); }
    setLoading(false);
  };

  const handleUploadToBlockchain = async () => {
    if (!window.confirm(
      "Upload all completed votes to the blockchain?\n\n" +
      "Make sure Ganache is running and the contract is deployed before proceeding."
    )) return;

    setUploading(true);
    setBlockchainResult(null);
    try {
      const res = await axios.post(`${API}/upload-to-blockchain`);
      setBlockchainResult(res.data);
      showMsg(res.data.message, res.data.errored > 0 ? "error" : "success");
      setActiveTab("blockchain");
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      showMsg(`Blockchain upload failed: ${msg}`, "error");
      setBlockchainResult({ error: msg });
      setActiveTab("blockchain");
    }
    setUploading(false);
  };

  const totalVoters   = voters.length;
  const initiated     = voters.filter((v) => v.hardwareInitiated).length;
  const voteProcessed = voters.filter((v) => v.voteProcessed).length;
  const pending       = totalVoters - voteProcessed;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🗳️</span>
            <div><h1>Voting Middle Software</h1><p>Administrator Panel</p></div>
          </div>
          <div className="header-right">
            <div className="user-pill">
              <span className="user-pill-icon">🛡️</span>
              <span>{user.username}</span>
              <span className="user-role-badge admin">Admin</span>
            </div>
            <button className="logout-btn" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      {message.text && <div className={`toast ${message.type}`}>{message.text}</div>}

      <main className="main">
        <div className="welcome-bar">
          <div>
            <h2>System Overview</h2>
            <p>Monitor all voters and encrypted records. Auto-refreshes every 3 seconds.</p>
          </div>
          <div className="admin-actions">
            {!seeded && <button className="seed-btn" onClick={handleSeed} disabled={loading}>📥 Load Voters</button>}
            <button
              className="seed-btn"
              onClick={handleUploadToBlockchain}
              disabled={uploading || voteProcessed === 0}
              title={voteProcessed === 0 ? "No processed votes to upload" : "Upload all completed votes to Ganache blockchain"}
            >
              {uploading ? "⏳ Uploading…" : "📤 Upload to Blockchain"}
            </button>
            <button className="clear-btn" onClick={handleClear} disabled={loading}>🗑️ Clear All Data</button>
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-card"><p className="stat-label">Total Voters</p><p className="stat-value">{totalVoters}</p></div>
          <div className="stat-card"><p className="stat-label">Hardware Initiated</p><p className="stat-value" style={{ color: "#f6e05e" }}>{initiated}</p></div>
          <div className="stat-card"><p className="stat-label">Votes Processed</p><p className="stat-value" style={{ color: "#68d391" }}>{voteProcessed}</p></div>
          <div className="stat-card"><p className="stat-label">Pending</p><p className="stat-value" style={{ color: "#fc8181" }}>{pending}</p></div>
        </div>

        <div className="tabs">
          <button className={activeTab === "db1"        ? "tab active" : "tab"} onClick={() => setActiveTab("db1")}>🗄️ Database 1 — Voters</button>
          <button className={activeTab === "db2"        ? "tab active" : "tab"} onClick={() => setActiveTab("db2")}>
            🔐 Database 2 — Encrypted
            {hashRecords.length > 0 && (
              <span style={{ marginLeft: 8, background: "#2c5282", color: "#90cdf4", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20 }}>
                {hashRecords.length}
              </span>
            )}
          </button>
          <button className={activeTab === "blockchain" ? "tab active" : "tab"} onClick={() => setActiveTab("blockchain")}>
            ⛓️ Blockchain Upload
            {blockchainResult?.uploaded > 0 && (
              <span style={{ marginLeft: 8, background: "#22543d", color: "#9ae6b4", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20 }}>
                {blockchainResult.uploaded} ✓
              </span>
            )}
          </button>
        </div>

        {/* ── Database 1 tab ─────────────────────────────────────────── */}
        {activeTab === "db1" && (
          <div className="card">
            <h2>Database 1 — Voter Records</h2>
            <p className="subtitle">Live voter registration data. H1 and T2 are populated after hardware completes.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>UID</th><th>Name</th><th>H1 — Encrypted Vote</th><th>T2 — Received At</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {voters.length === 0 ? (
                    <tr><td colSpan={5} className="empty">No voters — click "Load Voters" to seed data</td></tr>
                  ) : voters.map((v) => (
                    <tr key={v.uid}>
                      <td className="mono bold">{v.uid}</td>
                      <td><div className="table-name-cell"><div className="table-avatar">{v.name[0]}</div><span>{v.name}</span></div></td>
                      <td className="mono small">{v.hash1 ? <span className="break">{v.hash1.substring(0, 32)}…</span> : <span className="null">null</span>}</td>
                      <td className="small">{v.timestamp2 ? new Date(v.timestamp2).toLocaleString() : <span className="null">null</span>}</td>
                      <td>
                        {v.voteProcessed ? <span className="badge green">Vote Stored</span>
                          : v.hardwareInitiated ? <span className="badge yellow">Waiting…</span>
                          : <span className="badge gray">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Database 2 tab ─────────────────────────────────────────── */}
        {activeTab === "db2" && (
          <div className="card">
            <h2>Database 2 — Hash Records</h2>
            <p className="subtitle">hash2 = RSA( uid ‖ H1 ‖ T2 ) encoded as Base64. Ready for transfer to Blockchain.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>UID</th><th>Hash2 — RSA Encrypted</th><th>Stored At</th></tr>
                </thead>
                <tbody>
                  {hashRecords.length === 0 ? (
                    <tr><td colSpan={3} className="empty">No records yet — process a vote first</td></tr>
                  ) : hashRecords.map((r) => (
                    <tr key={r.uid}>
                      <td className="mono bold">{r.uid}</td>
                      <td className="mono small break">{r.hash2}</td>
                      <td className="small">{new Date(r.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Blockchain Upload tab ──────────────────────────────────── */}
        {activeTab === "blockchain" && (
          <div className="card">
            <h2>⛓️ Blockchain Upload Results</h2>

            {!blockchainResult && (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#718096" }}>
                <p style={{ fontSize: 48, marginBottom: 12 }}>📤</p>
                <p>No upload has been run yet.</p>
                <p className="subtitle">Click <strong>"📤 Upload to Blockchain"</strong> above to push completed votes to Ganache.</p>
                <p className="subtitle" style={{ marginTop: 8 }}>
                  Make sure Ganache is running on <code>127.0.0.1:7545</code> and the contract is deployed first.
                </p>
              </div>
            )}

            {blockchainResult?.error && (
              <div style={{ background: "#742a2a", color: "#feb2b2", padding: "16px", borderRadius: "8px", marginBottom: 16 }}>
                <strong>❌ Upload failed:</strong> {blockchainResult.error}
              </div>
            )}

            {blockchainResult && !blockchainResult.error && (
              <>
                {/* Summary row */}
                <div className="stats-row" style={{ marginBottom: 24 }}>
                  <div className="stat-card">
                    <p className="stat-label">Uploaded ✓</p>
                    <p className="stat-value" style={{ color: "#68d391" }}>{blockchainResult.uploaded}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">FP Rejected ✗</p>
                    <p className="stat-value" style={{ color: "#fc8181" }}>{blockchainResult.rejected ?? 0}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Already On-Chain</p>
                    <p className="stat-value" style={{ color: "#f6e05e" }}>{blockchainResult.skipped}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">Errors</p>
                    <p className="stat-value" style={{ color: "#fc8181" }}>{blockchainResult.errored}</p>
                  </div>
                  <div className="stat-card">
                    <p className="stat-label">On-Chain Total</p>
                    <p className="stat-value">{blockchainResult.tally?.total ?? "—"}</p>
                  </div>
                  {blockchainResult.fpThreshold && (
                    <div className="stat-card">
                      <p className="stat-label">FP Threshold</p>
                      <p className="stat-value" style={{ fontSize: 18 }}>{blockchainResult.fpThreshold}%</p>
                    </div>
                  )}
                </div>

                {/* Contract address */}
                {blockchainResult.contractAddress && (
                  <p className="subtitle" style={{ marginBottom: 16 }}>
                    Contract: <code className="mono">{blockchainResult.contractAddress}</code>
                  </p>
                )}

                {/* Tally */}
                {blockchainResult.tally && Object.keys(blockchainResult.tally.candidates).length > 0 && (
                  <>
                    <h3 style={{ marginBottom: 8 }}>On-Chain Vote Tally</h3>
                    <div className="table-wrap" style={{ marginBottom: 24 }}>
                      <table>
                        <thead><tr><th>Candidate</th><th>Votes</th></tr></thead>
                        <tbody>
                          {Object.entries(blockchainResult.tally.candidates).map(([c, cnt]) => (
                            <tr key={c}>
                              <td className="bold">{c}</td>
                              <td>
                                <span style={{ color: "#68d391", fontWeight: 700 }}>{cnt}</span>
                                <span style={{ marginLeft: 8, color: "#4a5568" }}>{"█".repeat(cnt)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* Per-vote details */}
                {blockchainResult.details?.length > 0 && (
                  <>
                    <h3 style={{ marginBottom: 8 }}>Per-Voter Details</h3>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>UID</th>
                            <th>Status</th>
                            <th>Vote (V)</th>
                            <th>FP Score F1</th>
                            <th>FP Score F2</th>
                            <th>Tx Hash / Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {blockchainResult.details.map((d) => (
                            <tr key={d.uid}>
                              <td className="mono bold">{d.uid}</td>
                              <td>
                                {d.status === "uploaded"
                                  ? <span className="badge green">Uploaded ✓</span>
                                  : d.status === "skipped"
                                  ? <span className="badge yellow">Already on-chain</span>
                                  : d.status === "rejected"
                                  ? <span className="badge" style={{ background: "#744210", color: "#fbd38d" }}>FP Rejected ✗</span>
                                  : <span className="badge" style={{ background: "#742a2a", color: "#feb2b2" }}>Error</span>}
                              </td>
                              <td className="mono">{d.vote || <span className="null">—</span>}</td>
                              <td className="small">
                                {d.fpScore1 != null
                                  ? <span style={{ color: d.fpScore1 > (blockchainResult.fpThreshold ?? 80) ? "#68d391" : "#fc8181" }}>
                                      {d.fpScore1.toFixed(1)}%
                                    </span>
                                  : <span className="null">—</span>}
                              </td>
                              <td className="small">
                                {d.fpScore2 != null
                                  ? <span style={{ color: d.fpScore2 > (blockchainResult.fpThreshold ?? 80) ? "#68d391" : "#fc8181" }}>
                                      {d.fpScore2.toFixed(1)}%
                                    </span>
                                  : <span className="null">—</span>}
                              </td>
                              <td className="mono small">
                                {d.txHash
                                  ? <span className="break">{d.txHash.substring(0, 20)}…</span>
                                  : <span style={{ color: d.status === "rejected" ? "#fbd38d" : "#fc8181" }}>{d.reason?.slice(0, 55)}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
