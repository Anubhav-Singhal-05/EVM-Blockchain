// src/App.jsx
import React, { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Database, Lock, Box, Download, LogOut, Activity, Map, Search, GitCompare, ChevronRight, ServerCrash } from 'lucide-react';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('analytics');

  // Database State
  const [votersData, setVotersData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dbError, setDbError] = useState('');
  const [blockchainData, setBlockchainData] = useState([]); // <-- Add this

  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResult, setSearchResult] = useState(null);

  // Comparison State
  const [compareDist1, setCompareDist1] = useState('New Delhi');
  const [compareDist2, setCompareDist2] = useState('Gurugram');

  // Geographic Drill-Down State
  const [selectedState, setSelectedState] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState(null);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === 'admin' && password === 'admin123') {
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Invalid credentials. Use admin / admin123');
    }
  };

  // --- FETCH DATA FROM GLOBAL MONGODB ---
  useEffect(() => {
    if (isAuthenticated) {
      const fetchAllData = async () => {
        setIsLoading(true);
        try {
          // 1. Fetch Global DB
          const dbResponse = await fetch('http://localhost:3000/api/voters');
          if (!dbResponse.ok) throw new Error('Global DB Failed');
          const globalData = await dbResponse.json();
          setVotersData(globalData);

          // 2. Fetch Blockchain API
          const bcResponse = await fetch('http://localhost:4000/api/votes');
          if (!bcResponse.ok) throw new Error('Blockchain API Failed');
          const bcJson = await bcResponse.json();

          // Map blockchain format to frontend UI format
          const mappedBcData = bcJson.votes.map(v => ({
            voterId: v.vid,
            txHash: v.e1 ? `0x${v.e1.substring(0, 16)}...` : 'Verified On-Chain', 
            timestamp: v.ts2 || v.ts1, 
            partyVoted: v.vote
          }));
          setBlockchainData(mappedBcData);
        } catch (err) {
          setDbError(err.message);
        } finally {
          setIsLoading(false);
        }
      };
      fetchAllData();
    }
  }, [isAuthenticated]);

  // --- RENDER LOGIN SCREEN ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-appBg flex items-center justify-center">
        <div className="bg-cardBg p-8 rounded-xl border border-cardBorder w-96 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <Box className="w-8 h-8 text-textMuted" />
            <h1 className="text-2xl font-bold text-white">Admin Login</h1>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-textMuted text-sm block mb-1">Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-appBg border border-cardBorder rounded px-3 py-2 text-white focus:outline-none focus:border-accentBlue" />
            </div>
            <div>
              <label className="text-textMuted text-sm block mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-appBg border border-cardBorder rounded px-3 py-2 text-white focus:outline-none focus:border-accentBlue" />
            </div>
            {error && <p className="text-accentRed text-sm">{error}</p>}
            <button type="submit" className="w-full bg-blue-600/20 text-accentBlue border border-accentBlue/50 py-2 rounded hover:bg-blue-600/30 transition">
              Login to System
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- RENDER LOADING SCREEN ---
  if (isLoading) {
    return (
      <div className="min-h-screen bg-appBg flex flex-col items-center justify-center gap-4">
        <Activity className="w-12 h-12 text-accentBlue animate-pulse" />
        <h2 className="text-xl font-bold text-white">Syncing with Global MongoDB...</h2>
        <p className="text-textMuted">Fetching eligible voter registry securely.</p>
      </div>
    );
  }

  // --- RENDER ERROR SCREEN ---
  if (dbError) {
    return (
      <div className="min-h-screen bg-appBg flex flex-col items-center justify-center gap-4">
        <ServerCrash className="w-16 h-16 text-accentRed" />
        <h2 className="text-2xl font-bold text-white">Database Connection Failed</h2>
        <p className="text-textMuted">{dbError}</p>
        <p className="text-sm text-gray-500">Ensure your Node.js backend is running on port 3000.</p>
        <button onClick={() => window.location.reload()} className="mt-4 bg-cardBg border border-cardBorder hover:bg-gray-800 text-white px-6 py-2 rounded-md transition font-medium">
          Retry Connection
        </button>
      </div>
    );
  }

  // --- Core Tally Logic ---
  const totalVoters = votersData.length;
  // Prevent division by zero if DB is empty
  const totalVotesCast = blockchainData.length;
  const turnoutPercentage = totalVoters > 0 ? ((totalVotesCast / totalVoters) * 100).toFixed(1) : 0;
  const unmatchedVotes = 0; // Mock

  // Merge Data for Table
  const mergedData = votersData.map(voter => {
    const voteRecord = blockchainData.find(b => b.voterId === voter.voterId);
    return {
      ...voter,
      fullName: `${voter.firstName} ${voter.lastName}`,
      location: `${voter.ward}, ${voter.district}`,
      txHash: voteRecord ? voteRecord.txHash : '—',
      timeFormatted: voteRecord ? new Date(voteRecord.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
      status: voteRecord ? 'Voted' : 'Did Not Vote'
    };
  });

  // --- Search Logic ---
  const handleSearch = () => {
    if (!searchTerm) return setSearchResult(null);
    const term = searchTerm.toLowerCase();
    
    const voter = votersData.find(v => v.voterId.toLowerCase() === term);
    if (voter) {
      const voteRecord = blockchainData.find(b => b.voterId === voter.voterId);
      setSearchResult({ type: 'voter', data: { ...voter, voted: !!voteRecord, txHash: voteRecord?.txHash } });
      return;
    }

    const wardVoters = votersData.filter(v => v.ward.toLowerCase() === term);
    if (wardVoters.length > 0) {
      const voted = wardVoters.filter(v => blockchainData.some(b => b.voterId === v.voterId)).length;
      setSearchResult({ type: 'ward', data: { name: wardVoters[0].ward, eligible: wardVoters.length, voted, percent: ((voted/wardVoters.length)*100).toFixed(1) } });
      return;
    }

    setSearchResult({ type: 'not_found' });
  };

  // --- Global Analytics Data ---
  const partyCounts = {};
  blockchainData.forEach(v => {
    partyCounts[v.partyVoted] = (partyCounts[v.partyVoted] || 0) + 1;
  });
  const partyChartData = Object.keys(partyCounts).map(key => ({ name: key, value: partyCounts[key] }));
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  const hourlyCounts = { '08:00': 0, '09:00': 0, '10:00': 0, '11:00': 0, '12:00': 0, '13:00': 0, '14:00': 0, '15:00': 0, '16:00': 0, '17:00': 0 };
  blockchainData.forEach(v => {
    const hour = new Date(v.timestamp).getHours();
    const timeKey = `${hour < 10 ? '0' : ''}${hour}:00`;
    if (hourlyCounts[timeKey] !== undefined) hourlyCounts[timeKey]++;
  });
  const timelineData = Object.keys(hourlyCounts).map(time => ({ time, votes: hourlyCounts[time] }));

  const ageGroups = { '18-30': 0, '31-45': 0, '46+': 0 };
  blockchainData.forEach(v => {
    const govRecord = votersData.find(g => g.voterId === v.voterId);
    if (govRecord) {
      if (govRecord.age <= 30) ageGroups['18-30']++;
      else if (govRecord.age <= 45) ageGroups['31-45']++;
      else ageGroups['46+']++;
    }
  });
  const ageChartData = Object.keys(ageGroups).map(key => ({ name: key, count: ageGroups[key] }));

  // --- Geographic Analytics Logic ---
  const getGeoStats = (level, filterKey = null, filterValue = null) => {
    const stats = {};
    votersData.forEach(voter => {
      if (filterKey && voter[filterKey] !== filterValue) return;

      const key = voter[level];
      if (!stats[key]) stats[key] = { name: key, eligible: 0, voted: 0 };
      stats[key].eligible++;
      if (blockchainData.some(b => b.voterId === voter.voterId)) stats[key].voted++;
    });
    return Object.values(stats).map(stat => ({
      ...stat,
      TurnoutPercent: parseFloat(((stat.voted / stat.eligible) * 100).toFixed(1))
    })).sort((a, b) => b.TurnoutPercent - a.TurnoutPercent);
  };

  const displayedStats = !selectedState 
    ? getGeoStats('state') 
    : !selectedDistrict 
      ? getGeoStats('district', 'state', selectedState)
      : getGeoStats('ward', 'district', selectedDistrict);

  const allDistricts = getGeoStats('district');

  const getHeatmapColor = (percent) => {
    if (percent < 50) return '#ef4444'; 
    if (percent < 75) return '#f59e0b'; 
    return '#10b981'; 
  };

  const handleGridClick = (name) => {
    if (!selectedState) {
      setSelectedState(name);
    } else if (!selectedDistrict) {
      setSelectedDistrict(name);
    }
  };

  // --- Comparative Logic ---
  const getDemographicsForDistrict = (districtName) => {
    const voters = votersData.filter(v => v.district === districtName);
    const votedIds = blockchainData.map(b => b.voterId);
    const votedList = voters.filter(v => votedIds.includes(v.voterId));
    
    const gender = { Male: 0, Female: 0 };
    const age = { '18-30': 0, '31-45': 0, '46+': 0 };

    votedList.forEach(v => {
      if (gender[v.gender] !== undefined) gender[v.gender]++;
      if (v.age <= 30) age['18-30']++;
      else if (v.age <= 45) age['31-45']++;
      else age['46+']++;
    });

    return {
      turnout: voters.length ? ((votedList.length / voters.length) * 100).toFixed(1) : 0,
      genderData: Object.keys(gender).map(k => ({ name: k, value: gender[k] })),
      ageData: Object.keys(age).map(k => ({ name: k, count: age[k] }))
    };
  };

  const dist1Data = getDemographicsForDistrict(compareDist1);
  const dist2Data = getDemographicsForDistrict(compareDist2);

  return (
    <div className="min-h-screen p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <Box className="w-8 h-8 text-textMuted" />
            <div>
              <h1 className="text-xl font-bold text-white">Post-Election Analysis Software</h1>
              <p className="text-xs text-textMuted">Administrator Panel</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-cardBg border border-cardBorder px-3 py-1.5 rounded-full">
              <Lock className="w-4 h-4 text-accentBlue" />
              <span className="text-sm">admin</span>
              <span className="bg-blue-600/20 text-accentBlue text-xs px-2 py-0.5 rounded-full border border-blue-500/30">Admin</span>
            </div>
            <button onClick={() => setIsAuthenticated(false)} className="flex items-center gap-2 bg-cardBg border border-cardBorder hover:bg-cardBorder px-4 py-1.5 rounded-md text-sm transition">
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </header>

        {/* Search Bar */}
        <div className="bg-cardBg border border-cardBorder rounded-xl p-4 flex gap-4 items-center shadow-lg">
          <Search className="w-5 h-5 text-textMuted" />
          <input 
            type="text" 
            placeholder="Search for a Voter ID (e.g., VOTER001) or Ward (e.g., Ward 3)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-transparent border-none text-white focus:outline-none"
          />
          <button onClick={handleSearch} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md transition font-medium">
            Search
          </button>
        </div>

        {/* Search Results */}
        {searchResult && (
          <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-xl flex items-center justify-between">
            {searchResult.type === 'voter' && (
              <div>
                <span className="text-sm text-blue-300 font-bold uppercase tracking-wider">Voter Record Found</span>
                <p className="text-lg text-white mt-1">{searchResult.data.firstName} {searchResult.data.lastName} ({searchResult.data.voterId})</p>
                <p className="text-sm text-textMuted">Location: {searchResult.data.ward}, {searchResult.data.district}, {searchResult.data.state}</p>
              </div>
            )}
            {searchResult.type === 'ward' && (
              <div>
                <span className="text-sm text-blue-300 font-bold uppercase tracking-wider">Ward Record Found</span>
                <p className="text-lg text-white mt-1">{searchResult.data.name}</p>
                <p className="text-sm text-textMuted">Eligible: {searchResult.data.eligible} | Voted: {searchResult.data.voted}</p>
              </div>
            )}
            {searchResult.type === 'not_found' && (
              <p className="text-accentRed font-semibold">No records found matching your query.</p>
            )}
            
            {searchResult.type !== 'not_found' && (
              <div className="text-right">
                <span className={`inline-block px-4 py-2 rounded-lg font-bold border ${
                  (searchResult.type === 'voter' && searchResult.data.voted) || (searchResult.type === 'ward' && searchResult.data.percent > 50) 
                  ? 'bg-green-500/20 text-accentGreen border-green-500/40' 
                  : 'bg-red-500/20 text-accentRed border-red-500/40'
                }`}>
                  {searchResult.type === 'voter' ? (searchResult.data.voted ? 'VOTED (Verified on Chain)' : 'DID NOT VOTE') : `${searchResult.data.percent}% Turnout`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* System Overview */}
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-bold text-white">Final Election Results</h2>
            <p className="text-sm text-textMuted mt-1">Data synced from Blockchain and cross-referenced with Government Voter List.</p>
          </div>
          <button className="flex items-center gap-2 bg-cardBg border border-cardBorder hover:bg-cardBorder px-4 py-2 rounded-md text-sm transition">
            <Download className="w-4 h-4 text-accentBlue" /> Export Final Report
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-cardBg border border-cardBorder rounded-lg p-6 text-center shadow-lg">
            <p className="text-xs text-textMuted font-semibold mb-2 uppercase tracking-wider">Eligible Voters</p>
            <p className="text-4xl font-bold text-accentBlue">{totalVoters}</p>
          </div>
          <div className="bg-cardBg border border-cardBorder rounded-lg p-6 text-center shadow-lg">
            <p className="text-xs text-textMuted font-semibold mb-2 uppercase tracking-wider">Total Votes Cast</p>
            <p className="text-4xl font-bold text-accentGreen">{totalVotesCast}</p>
          </div>
          <div className="bg-cardBg border border-cardBorder rounded-lg p-6 text-center shadow-lg">
            <p className="text-xs text-textMuted font-semibold mb-2 uppercase tracking-wider">Overall Turnout</p>
            <p className="text-4xl font-bold text-white">{turnoutPercentage}%</p>
          </div>
          <div className="bg-cardBg border border-cardBorder rounded-lg p-6 text-center shadow-lg">
            <p className="text-xs text-textMuted font-semibold mb-2 uppercase tracking-wider">Anomalies</p>
            <p className="text-4xl font-bold text-accentRed">{unmatchedVotes}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('analytics')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'analytics' ? 'bg-blue-600/20 text-accentBlue border border-blue-500/30' : 'bg-cardBg border border-cardBorder hover:bg-cardBorder'}`}>
            <Activity className="w-4 h-4" /> Global Analytics
          </button>
          <button onClick={() => setActiveTab('geography')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'geography' ? 'bg-blue-600/20 text-accentBlue border border-blue-500/30' : 'bg-cardBg border border-cardBorder hover:bg-cardBorder'}`}>
            <Map className="w-4 h-4" /> Geography Heatmap
          </button>
          <button onClick={() => setActiveTab('compare')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'compare' ? 'bg-blue-600/20 text-accentBlue border border-blue-500/30' : 'bg-cardBg border border-cardBorder hover:bg-cardBorder'}`}>
            <GitCompare className="w-4 h-4" /> Compare Districts
          </button>
          <button onClick={() => setActiveTab('records')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'records' ? 'bg-blue-600/20 text-accentBlue border border-blue-500/30' : 'bg-cardBg border border-cardBorder hover:bg-cardBorder'}`}>
            <Database className="w-4 h-4" /> Voter Registry List
          </button>
        </div>

        {/* Dynamic Tab Content */}
        <div className="bg-cardBg border border-cardBorder rounded-xl p-6 shadow-xl min-h-[400px]">
          
          {/* TAB 1: Global Analytics */}
          {activeTab === 'analytics' && (
            <>
              <h3 className="text-lg font-bold text-white mb-6">Global Blockchain Tally & Analytics</h3>
              
              <div className="bg-appBg border border-cardBorder p-4 rounded-lg mb-8">
                  <h4 className="text-sm font-semibold text-textMuted mb-4">Voting Timeline (Peak Hours)</h4>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timelineData}>
                        <defs>
                          <linearGradient id="colorVotes" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d40" vertical={false} />
                        <XAxis dataKey="time" stroke="#94a3b8" tick={{fill: '#94a3b8'}} />
                        <YAxis stroke="#94a3b8" tick={{fill: '#94a3b8'}} allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e2130', borderColor: '#2a2d40', color: '#fff' }} />
                        <Area type="monotone" dataKey="votes" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorVotes)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div className="bg-appBg border border-cardBorder p-4 rounded-lg">
                  <h4 className="text-sm font-semibold text-textMuted mb-4 text-center">Vote Share by Party</h4>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={partyChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                          {partyChartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#1e2130', borderColor: '#2a2d40', color: '#fff' }} />
                        <Legend wrapperStyle={{ color: '#94a3b8' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-appBg border border-cardBorder p-4 rounded-lg">
                  <h4 className="text-sm font-semibold text-textMuted mb-4 text-center">Turnout by Age Group</h4>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ageChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d40" vertical={false} />
                        <XAxis dataKey="name" stroke="#94a3b8" tick={{fill: '#94a3b8'}} />
                        <YAxis stroke="#94a3b8" tick={{fill: '#94a3b8'}} allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e2130', borderColor: '#2a2d40', color: '#fff' }} cursor={{fill: '#2a2d40'}} />
                        <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: Geography Heatmap */}
          {activeTab === 'geography' && (
            <>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-bold text-white mb-2">Geographical Turnout Heatmap</h3>
                  <div className="flex items-center gap-2 text-sm font-bold text-textMuted">
                    <button 
                      onClick={() => { setSelectedState(null); setSelectedDistrict(null); }} 
                      className={`transition ${!selectedState ? 'text-accentBlue' : 'hover:text-white'}`}
                    >
                      India (All States)
                    </button>
                    {selectedState && (
                      <>
                        <ChevronRight className="w-4 h-4" />
                        <button 
                          onClick={() => setSelectedDistrict(null)} 
                          className={`transition ${!selectedDistrict ? 'text-accentBlue' : 'hover:text-white'}`}
                        >
                          {selectedState}
                        </button>
                      </>
                    )}
                    {selectedDistrict && (
                      <>
                        <ChevronRight className="w-4 h-4" />
                        <span className="text-accentBlue">{selectedDistrict}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 text-xs font-semibold text-textMuted bg-appBg p-3 rounded-md border border-cardBorder">
                  <span className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded-full"></div> &lt; 50% (Cold)</span>
                  <span className="flex items-center gap-2"><div className="w-3 h-3 bg-yellow-500 rounded-full"></div> 50% - 75%</span>
                  <span className="flex items-center gap-2"><div className="w-3 h-3 bg-green-500 rounded-full"></div> &gt; 75% (Hot)</span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                {displayedStats.map((stat, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => handleGridClick(stat.name)}
                    className={`relative p-5 rounded-lg border border-cardBorder overflow-hidden bg-appBg transition-all 
                      ${selectedDistrict ? 'cursor-default' : 'cursor-pointer hover:-translate-y-1 hover:shadow-xl hover:border-gray-500'}`}
                  >
                    <div className="absolute top-0 left-0 w-2 h-full" style={{ backgroundColor: getHeatmapColor(stat.TurnoutPercent) }}></div>
                    <div className="pl-4">
                      <p className="font-bold text-gray-200 text-lg truncate" title={stat.name}>{stat.name}</p>
                      <p className="text-3xl font-black mt-2" style={{ color: getHeatmapColor(stat.TurnoutPercent) }}>{stat.TurnoutPercent}%</p>
                      <div className="mt-4 flex justify-between text-xs text-textMuted bg-cardBg p-2 rounded border border-cardBorder">
                        <span><span className="text-white font-bold">{stat.voted}</span> Voted</span>
                        <span><span className="text-white font-bold">{stat.eligible}</span> Total</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {displayedStats.length === 0 && (
                <div className="text-center text-textMuted py-12">
                  No data available for this selection.
                </div>
              )}
            </>
          )}

          {/* TAB 3: Comparative Mode */}
          {activeTab === 'compare' && (
            <>
              <h3 className="text-lg font-bold text-white mb-6">Compare District Demographics</h3>
              
              <div className="grid grid-cols-2 gap-8">
                {/* District 1 Selector */}
                <div className="bg-appBg border border-cardBorder rounded-xl p-5">
                  <select 
                    value={compareDist1} 
                    onChange={(e) => setCompareDist1(e.target.value)}
                    className="w-full bg-cardBg border border-cardBorder text-white p-3 rounded-md mb-6 focus:outline-none focus:border-accentBlue"
                  >
                    {allDistricts.map(d => <option key={`d1-${d.name}`} value={d.name}>{d.name}</option>)}
                  </select>
                  
                  <div className="text-center mb-6">
                    <p className="text-sm text-textMuted uppercase">Turnout</p>
                    <p className="text-4xl font-black text-accentBlue">{dist1Data.turnout}%</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="h-40">
                      <p className="text-xs text-center text-textMuted mb-2">Gender Split</p>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={dist1Data.genderData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value">
                            {dist1Data.genderData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ backgroundColor: '#1e2130', borderColor: '#2a2d40', color: '#fff' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="h-40">
                      <p className="text-xs text-center text-textMuted mb-2">Age Groups</p>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dist1Data.ageData}>
                          <XAxis dataKey="name" tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{fill: '#2a2d40'}} contentStyle={{ backgroundColor: '#1e2130', borderColor: '#2a2d40', color: '#fff' }} />
                          <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* District 2 Selector */}
                <div className="bg-appBg border border-cardBorder rounded-xl p-5">
                  <select 
                    value={compareDist2} 
                    onChange={(e) => setCompareDist2(e.target.value)}
                    className="w-full bg-cardBg border border-cardBorder text-white p-3 rounded-md mb-6 focus:outline-none focus:border-accentGreen"
                  >
                    {allDistricts.map(d => <option key={`d2-${d.name}`} value={d.name}>{d.name}</option>)}
                  </select>
                  
                  <div className="text-center mb-6">
                    <p className="text-sm text-textMuted uppercase">Turnout</p>
                    <p className="text-4xl font-black text-accentGreen">{dist2Data.turnout}%</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="h-40">
                      <p className="text-xs text-center text-textMuted mb-2">Gender Split</p>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={dist2Data.genderData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value">
                            {dist2Data.genderData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ backgroundColor: '#1e2130', borderColor: '#2a2d40', color: '#fff' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="h-40">
                      <p className="text-xs text-center text-textMuted mb-2">Age Groups</p>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dist2Data.ageData}>
                          <XAxis dataKey="name" tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{fill: '#2a2d40'}} contentStyle={{ backgroundColor: '#1e2130', borderColor: '#2a2d40', color: '#fff' }} />
                          <Bar dataKey="count" fill="#10b981" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 4: Voter Registry Table */}
          {activeTab === 'records' && (
            <>
              <h3 className="text-lg font-bold text-white mb-1">Voter Status Registry</h3>
              <p className="text-sm text-textMuted mb-6">Cross-referencing the public eligible voter list with verified blockchain transactions.</p>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-cardBorder text-textMuted uppercase text-xs">
                      <th className="pb-3 font-semibold w-24">Voter ID</th>
                      <th className="pb-3 font-semibold w-40">Name</th>
                      <th className="pb-3 font-semibold w-40">Location</th>
                      <th className="pb-3 font-semibold">TxHash (Blockchain)</th>
                      <th className="pb-3 font-semibold w-24">Time</th>
                      <th className="pb-3 font-semibold text-right w-28">Final Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cardBorder/50">
                    {mergedData.map((row, index) => (
                      <tr key={index} className="hover:bg-cardBorder/30 transition-colors group">
                        <td className="py-4 font-mono text-xs text-accentBlue">{row.voterId}</td>
                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-blue-600/20 text-accentBlue flex items-center justify-center text-xs font-bold border border-blue-500/30">
                              {row.firstName.charAt(0)}
                            </div>
                            <span className="text-gray-200">{row.fullName}</span>
                          </div>
                        </td>
                        <td className="py-4 text-xs text-gray-400">
                          {row.location}
                          <div className="text-[10px] text-gray-500">{row.state}</div>
                        </td>
                        <td className={`py-4 font-mono text-xs ${row.txHash === '—' ? 'text-textMuted' : 'text-gray-300'}`}>
                          {row.txHash}
                        </td>
                        <td className={`py-4 text-xs ${row.timeFormatted === '—' ? 'text-textMuted' : 'text-gray-300'}`}>
                          {row.timeFormatted}
                        </td>
                        <td className="py-4 text-right">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${row.status === 'Voted' ? 'bg-green-500/10 text-accentGreen border-green-500/20' : 'bg-red-500/10 text-accentRed border-red-500/20'}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}