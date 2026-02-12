import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, RefreshCw, Copy, AlertCircle, Hash, Trash2, 
  CheckCircle2, Sparkles, LayoutGrid, History, Image as ImageIcon, 
  Camera, Save, X, ChevronRight, Clock, FileText, Download, 
  Heart, Star, Cloud, Moon, Flower, ScanLine, Upload, Plus,
  FilePlus, FolderOpen, Play, Info, Eye, ChevronDown, AlertTriangle,
  List, Type, EyeOff, Clipboard, Combine, Check, Radio, Link as LinkIcon,
  Wifi, Globe, Send, MessageCircle, Eraser, Search
} from 'lucide-react';
import html2canvas from 'html2canvas';
import Tesseract from 'tesseract.js';
import { Peer } from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';

// Electron access
const isElectron = window && window.process && window.process.type;
const remote = isElectron ? window.require('@electron/remote') : null;
const fs = isElectron ? window.require('fs') : null;
const path = isElectron ? window.require('path') : null;
const { dialog, app } = remote || { dialog: null, app: null };

const GAMES_DIR = isElectron ? path.join(app.getPath('userData'), 'nexus_games') : '';
const REMOTE_APP_URL = "https://unboundangel.github.io/Co-Op-Games/"; 

export default function App() {
  // --- STATE ---
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('ng_config');
    return saved ? JSON.parse(saved) : { min: 1, max: 100, count: 5, allowRepeats: false, autoSave: true };
  });

  const [activeGame, setActiveGame] = useState({ id: 'default', name: 'New Game', questions: {}, history: [], type: 'Manual' });
  const [savedGamesList, setSavedGamesList] = useState([]);
  const [results, setResults] = useState([]);
  const [view, setView] = useState('create');
  
  // Remote & Chat
  const [peerId, setPeerId] = useState('');
  const [connections, setConnections] = useState([]);
  const [isRemoteEnabled, setIsRemoteEnabled] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  
  // QoL & Filters
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [revealMode, setRevealMode] = useState(false);
  const [revealedCards, setRevealedCards] = useState(new Set());
  const [manualNum, setManualNum] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // UI Modals
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [importTextModal, setImportTextModal] = useState(false);
  const [combineModal, setCombineModal] = useState(false);
  const [importModal, setImportModal] = useState(null); 
  const [selectedForMerge, setSelectedGamesToMerge] = useState(new Set());
  const [megaGameName, setMegaGameName] = useState('Mega Mashup');
  
  const [rawTextToImport, setRawTextToImport] = useState('');
  const [hoveredItem, setHoveredItem] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showGameSelector, setShowGameSelector] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  
  const resultsRef = useRef(null);
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const selectorRef = useRef(null);
  const chatEndRef = useRef(null);
  const peerRef = useRef(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (isElectron) {
      if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR);
      const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
      const games = files.map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf-8'));
          return { id: f.replace('.json', ''), name: d.name || 'Untitled', mtime: fs.statSync(path.join(GAMES_DIR, f)).mtimeMs };
        } catch (e) { return null; }
      }).filter(Boolean).sort((a,b) => b.mtime - a.mtime);
      setSavedGamesList(games);

      const lastId = localStorage.getItem('last_active_game');
      if (lastId && lastId !== 'default') {
        const filePath = path.join(GAMES_DIR, `${lastId}.json`);
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          setActiveGame(data);
          setView('generator');
        }
      }
    }
  }, []);

  // --- EVENT LISTENERS ---
  useEffect(() => {
    const handleClickOutside = (e) => { if (selectorRef.current && !selectorRef.current.contains(e.target)) setShowGameSelector(false); };
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && view === 'generator' && !editingQuestion && !importModal) { e.preventDefault(); handleGenerate(); }
      if (e.code === 'Escape') { setEditingQuestion(null); setImportModal(null); setShowGameSelector(false); setImportTextModal(false); setCombineModal(false); }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("mousedown", handleClickOutside); document.removeEventListener("keydown", handleKeyDown); };
  }, [view, editingQuestion, importModal, results, activeGame]); // Correct dependencies for the logic used in handleGenerate if needed

  useEffect(() => { localStorage.setItem('ng_config', JSON.stringify(config)); }, [config]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // --- REMOTE SYNC ---
  const broadcast = (data) => connections.forEach(c => c.open && c.send(data));
  useEffect(() => { broadcast({ type: 'SYNC_RESULTS', data: results }); }, [results, connections]);
  useEffect(() => { 
    broadcast({ type: 'SYNC_GAME', data: { name: activeGame.name, questions: activeGame.questions, history: activeGame.history } }); 
    const nums = Object.keys(activeGame.questions).map(Number);
    if (nums.length > 0) {
      const min = Math.min(...nums), max = Math.max(...nums);
      if (config.min !== min || config.max !== max) {
        setConfig(prev => ({ ...prev, min, max }));
      }
    }
  }, [activeGame, connections]);

  useEffect(() => {
    if (isRemoteEnabled && !peerRef.current) {
      const p = new Peer(`nexus-${Math.random().toString(36).substr(2, 9)}`);
      p.on('open', (id) => setPeerId(id));
      p.on('connection', (conn) => {
        conn.on('open', () => {
          setConnections(prev => [...prev, conn]);
          conn.send({ type: 'SYNC_GAME', data: { name: activeGame.name, questions: activeGame.questions, history: activeGame.history } });
          conn.send({ type: 'SYNC_RESULTS', data: results });
          conn.send({ type: 'SYNC_CHAT', data: messages });
        });
        conn.on('data', (d) => {
          if (d.type === 'DRAW_REQUEST') handleGenerate();
          if (d.type === 'CHAT') {
            const m = { sender: d.sender || 'Friend', text: d.text, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) };
            setMessages(prev => [...prev, m]);
            broadcast({ type: 'CHAT_MSG', data: m });
          }
        });
        conn.on('close', () => setConnections(prev => prev.filter(c => c !== conn)));
      });
      peerRef.current = p;
    }
    return () => { if (!isRemoteEnabled && peerRef.current) { peerRef.current.destroy(); peerRef.current = null; setPeerId(''); setConnections([]); } };
  }, [isRemoteEnabled]);

  // --- HELPERS ---
  const refreshGamesList = () => {
    if (!fs) return;
    const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
    const games = files.map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf-8'));
        return { id: f.replace('.json', ''), name: d.name || 'Untitled', mtime: fs.statSync(path.join(GAMES_DIR, f)).mtimeMs };
      } catch (e) { return null; }
    }).filter(Boolean).sort((a,b) => b.mtime - a.mtime);
    setSavedGamesList(games);
  };

  const loadGameById = (id) => {
    if (id === 'default') return createNewGame();
    try {
      const data = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, `${id}.json`), 'utf-8'));
      setActiveGame(data); setResults([]); localStorage.setItem('last_active_game', id); setView('generator');
    } catch (e) { console.error(e); }
    setShowGameSelector(false);
  };

  const saveGameData = (d) => { if (fs) fs.writeFileSync(path.join(GAMES_DIR, `${d.id}.json`), JSON.stringify(d, null, 2)); refreshGamesList(); };
  const saveActiveGame = (jump = false) => {
    const id = activeGame.id === 'default' ? Date.now().toString() : activeGame.id;
    const g = { ...activeGame, id };
    saveGameData(g); setActiveGame(g); localStorage.setItem('last_active_game', id);
    if (jump) setView('generator'); else alert('Saved! ✨');
  };

  const deleteGame = (e, id) => { e.stopPropagation(); if (confirm('Delete?')) { fs.unlinkSync(path.join(GAMES_DIR, `${id}.json`)); if (activeGame.id === id) createNewGame(); refreshGamesList(); } };
  const createNewGame = () => { setActiveGame({ id: 'default', name: 'New Game', questions: {}, history: [], type: 'Manual' }); setResults([]); setView('create'); setShowGameSelector(false); };
  const resetHistory = () => { if (confirm('Clear history?')) { const g = { ...activeGame, history: [] }; setActiveGame(g); setResults([]); if (g.id !== 'default') saveGameData(g); } };

  // --- PARSING ---
  const parseRawText = (text) => {
    const qs = {};
    text.split('\n').forEach(line => {
      const segs = line.split(/(?=\b\d{1,3}[\.\)\-]\s+[A-Z])/);
      segs.forEach(s => {
        const m = s.match(/(\d{1,3})[\.\)\-\s]+\s*(.+)/);
        if (m) {
          const n = parseInt(m[1]), t = m[2].trim().replace(/\s+\d+$/, '').trim();
          if (n > 0 && t.length > 2) qs[n] = { text: t, image: '', category: 'Auto' };
        }
      });
    });
    return qs;
  };

  const handleOcr = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setIsScanning(true);
    try {
      const worker = await Tesseract.createWorker('eng');
      const { data: { text } } = await worker.recognize(f);
      await worker.terminate();
      const qs = parseRawText(text);
      if (Object.keys(qs).length) checkImportSafety({ questions: qs }, 'Scanned');
    } catch (err) { console.error(err); }
    finally { setIsScanning(false); fileInputRef.current.value = ''; }
  };

  const handleJsonImport = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (re) => {
      try {
        const d = JSON.parse(re.target.result);
        let qs = {};
        if (d.categories) Object.values(d.categories).forEach(c => c.questions?.forEach(q => { if (q.number && q.question) qs[q.number] = { text: q.question, category: c.label, image: '' }; }));
        else if (Array.isArray(d.questions)) d.questions.forEach(q => { if (q.number && q.question) qs[q.number] = { text: q.question, category: 'Imported', image: '' }; });
        checkImportSafety({ questions: qs }, d.title || f.name.replace('.json', ''));
      } catch (err) { console.error(err); }
    };
    reader.readAsText(f);
  };

  const performImport = (d, src, choice) => {
    let g = choice === 'new' ? { id: Date.now().toString(), name: src || 'Imported', questions: d.questions, history: [], type: 'Imported' } : { ...activeGame, questions: d.questions };
    if (choice === 'new' || activeGame.id !== 'default') saveGameData(g);
    setActiveGame(g); setResults([]); setImportModal(null); setView('generator');
  };
  const checkImportSafety = (d, src) => { if (activeGame.id === 'default' && !Object.keys(activeGame.questions).length) performImport(d, src, 'overwrite'); else setImportModal({ data: d, sourceName: src }); };

  const handleCombineGames = () => {
    if (selectedForMerge.size === 0) return;
    let mergedQs = {}; const seenTexts = new Set();
    Array.from(selectedForMerge).forEach(id => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, `${id}.json`), 'utf-8'));
        Object.entries(data.questions).forEach(([num, q]) => {
          const norm = q.text.trim().toLowerCase(); if (seenTexts.has(norm)) return;
          seenTexts.add(norm); let target = parseInt(num); while (mergedQs[target]) target++;
          mergedQs[target] = { ...q, category: q.category || data.name };
        });
      } catch (e) {}
    });
    const mega = { id: `mega_${Date.now()}`, name: megaGameName, questions: mergedQs, history: [], type: 'Merged' };
    saveGameData(mega); setActiveGame(mega); setCombineModal(false); setView('generator');
  };

  const copyQuestionsToClipboard = () => { const text = results.map(n => `${n}. ${activeGame.questions[n]?.text || ''}`).join('\n\n'); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const captureScreenshot = async () => { if (!resultsRef.current) return; const canvas = await html2canvas(resultsRef.current, { backgroundColor: '#0f0a1a', scale: 2 }); const link = document.createElement('a'); link.download = `draw-${Date.now()}.png`; link.href = canvas.toDataURL(); link.click(); };

  const handleGenerate = () => {
    if (isGenerating) return;
    setIsGenerating(true); setRevealedCards(new Set());
    setTimeout(() => {
      const min = parseInt(config.min), max = parseInt(config.max), qty = parseInt(config.count), hSet = new Set(activeGame.history);
      let pool = []; for (let i = min; i <= max; i++) { if (!hSet.has(i) && (selectedCategory === 'All' || activeGame.questions[i]?.category === selectedCategory)) pool.push(i); }
      if (pool.length < qty) { setError('Exhausted.'); setIsGenerating(false); return; }
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const draw = pool.slice(0, qty).sort((a,b) => a-b);
      setResults(draw);
      const updated = { ...activeGame, history: [...activeGame.history, ...draw] }; setActiveGame(updated);
      if (activeGame.id !== 'default') saveGameData(updated);
      setIsGenerating(false);
    }, 800);
  };

  const redrawCard = (idx) => {
    const min = parseInt(config.min), max = parseInt(config.max), hSet = new Set(activeGame.history), cSet = new Set(results);
    let pool = []; for (let i = min; i <= max; i++) { if (!hSet.has(i) && !cSet.has(i) && (selectedCategory === 'All' || activeGame.questions[i]?.category === selectedCategory)) pool.push(i); }
    if (pool.length > 0) {
      const n = pool[Math.floor(Math.random() * pool.length)], nr = [...results]; nr[idx] = n; setResults(nr);
      const updated = { ...activeGame, history: [...activeGame.history, n] }; setActiveGame(updated); if (activeGame.id !== 'default') saveGameData(updated);
    }
  };

  const handleManualDraw = (e) => {
    e.preventDefault(); const n = parseInt(manualNum);
    if (!isNaN(n) && activeGame.questions[n]) {
      setResults(prev => [...prev, n]); setManualNum('');
      if (!activeGame.history.includes(n)) { const u = { ...activeGame, history: [...activeGame.history, n] }; setActiveGame(u); if (u.id !== 'default') saveGameData(u); }
    }
  };

  const sendMsg = (e) => {
    e.preventDefault(); if (!chatInput.trim()) return;
    const m = { sender: 'Host', text: chatInput, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) };
    setMessages(prev => [...prev, m]); broadcast({ type: 'CHAT_MSG', data: m }); setChatInput('');
  };

  const filteredQs = Object.entries(activeGame.questions).filter(([n, q]) => n.includes(searchTerm) || q.text.toLowerCase().includes(searchTerm.toLowerCase())).sort((a,b) => parseInt(a[0])-parseInt(b[0]));
  const categories = ['All', ...new Set(Object.values(activeGame.questions).map(q => q.category).filter(Boolean))];

  return (
    <div className="min-h-screen bg-[#0f0a1a] text-[#f9a8d4] font-['Quicksand',_sans-serif] p-4 md:p-8 flex gap-8 no-scrollbar overflow-hidden" onMouseMove={e => setMousePos({x: e.clientX, y: e.clientY})}>
      <style dangerouslySetInnerHTML={{ __html: `
        body, html, #root { background-color: #0f0a1a !important; margin: 0; padding: 0; overflow: hidden; height: 100vh; width: 100vw; }
        *::-webkit-scrollbar { display: none !important; }
        * { -ms-overflow-style: none !important; scrollbar-width: none !important; }
        .kawaii-input { width: 100%; background: rgba(255,255,255,0.03); border: 2px solid rgba(255,255,255,0.05); border-radius: 1.5rem; padding: 1rem; color: #f9a8d4; font-weight: 700; outline: none; transition: 0.3s; }
        .kawaii-input:focus { border-color: #f472b6; box-shadow: 0 0 15px rgba(244,114,182,0.1); }
        .kawaii-btn { background: linear-gradient(135deg, #ec4899, #8b5cf6); color: white; font-weight: 900; padding: 1rem 2rem; border-radius: 2rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: 0.4s; text-transform: uppercase; letter-spacing: 0.1em; cursor: pointer; border: none; }
        .game-card { width: 220px; height: 320px; background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.1); border-radius: 2.5rem; display: flex; flex-direction: column; align-items: center; padding: 1.5rem; position: relative; transition: 0.5s; backdrop-blur: 30px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); animation: dealCard 0.8s backwards; }
        @keyframes dealCard { 0% { transform: translateY(100vh) rotate(45deg); opacity: 0; } 100% { transform: translateY(0) rotate(0); opacity: 1; } }
      ` }} />

      <div className="flex-1 flex flex-col gap-8 h-full overflow-y-auto no-scrollbar pb-32">
        <header className="flex flex-col lg:flex-row justify-between items-center bg-white/5 p-6 rounded-[2.5rem] border border-white/10 backdrop-blur-xl gap-6 shrink-0 relative z-50 shadow-2xl">
          <div className="flex items-center gap-4 group relative" ref={selectorRef}>
             <div className="bg-pink-500/20 p-3 rounded-2xl"><Star className="text-pink-400" /></div>
             <div className="flex flex-col">
               <button onClick={() => setShowGameSelector(!showGameSelector)} className="flex items-center gap-2 text-left"><span className="text-2xl font-black uppercase text-[#f9a8d4] truncate max-w-[200px]">{activeGame.name}</span><ChevronDown size={20} className="text-pink-300/40" /></button>
               <p className="text-[10px] font-bold text-pink-300/40 uppercase tracking-widest">{Object.keys(activeGame.questions).length} Items • {activeGame.history.length} Used</p>
             </div>
             {showGameSelector && (
               <div className="absolute top-full left-0 mt-4 w-80 bg-[#1a1329] border border-white/10 rounded-[2rem] shadow-2xl p-2 z-50 animate-in fade-in zoom-in duration-200">
                 <button onClick={() => loadGameById('default')} className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 font-bold text-sm text-pink-300 flex items-center gap-2 transition-colors"><Plus size={14} /> New Game</button>
                 <div className="h-px bg-white/10 my-1 mx-2" />
                 {savedGamesList.map(g => (
                   <div key={g.id} className="flex items-center justify-between hover:bg-white/5 rounded-xl group/item">
                     <button onClick={() => loadGameById(g.id)} className="flex-1 text-left px-4 py-3 font-bold text-sm text-slate-400 group-hover/item:text-white truncate">{g.name}</button>
                     <button onClick={(e) => deleteGame(e, g.id)} className="p-2 text-slate-600 hover:text-red-400 opacity-0 group-hover/item:opacity-100 transition-all"><Trash2 size={14} /></button>
                   </div>
                 ))}
               </div>
             )}
          </div>
          <nav className="flex gap-2 bg-black/20 p-1.5 rounded-2xl">
            <NavTab icon={FilePlus} label="Create" active={view === 'create'} onClick={() => setView('create')} />
            <NavTab icon={Play} label="Play" active={view === 'generator'} onClick={() => setView('generator')} />
            <NavTab icon={LayoutGrid} label="All" active={view === 'tracker'} onClick={() => setView('tracker')} />
            <NavTab icon={Wifi} label="Remote" active={view === 'remote'} onClick={() => setView('remote')} />
            <NavTab icon={History} label="Logs" active={view === 'history'} onClick={() => setView('history')} />
          </nav>
        </header>

        <main className="flex-1">
          {view === 'create' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in duration-500">
              <section className="bg-white/5 backdrop-blur-xl p-8 rounded-[3.5rem] border border-white/10 flex flex-col gap-6">
                <input value={activeGame.name} onChange={e => setActiveGame({...activeGame, name: e.target.value})} className="kawaii-input" placeholder="Name" />
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => fileInputRef.current.click()} className="p-8 border-2 border-dashed border-white/10 rounded-[2.5rem] hover:bg-pink-500/5 transition-all text-xs font-black uppercase">Scan Image</button>
                  <button onClick={() => jsonInputRef.current.click()} className="p-8 border-2 border-dashed border-white/10 rounded-[2.5rem] hover:bg-purple-500/5 transition-all text-xs font-black uppercase">JSON</button>
                  <button onClick={() => setImportTextModal(true)} className="p-8 border-2 border-dashed border-white/10 rounded-[2.5rem] hover:bg-cyan-500/5 transition-all text-xs font-black uppercase">Import Text</button>
                  <button onClick={() => setCombineModal(true)} className="p-8 border-2 border-dashed border-white/10 rounded-[2.5rem] hover:bg-emerald-500/5 transition-all text-xs font-black uppercase">Combine</button>
                </div>
                <button onClick={() => saveActiveGame(true)} className="kawaii-btn w-full !py-5">Save & Play ✨</button>
              </section>
              <section className="bg-white/5 backdrop-blur-xl p-8 rounded-[3.5rem] border border-white/10 flex flex-col gap-6">
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center"><h2>Items</h2><button onClick={() => setEditingQuestion('new')} className="p-3 bg-white/5 rounded-full"><Plus /></button></div>
                  <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={16} /><input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="kawaii-input !pl-12 !py-2 !text-xs" placeholder="Search..." /></div>
                </div>
                <div className="max-h-[400px] overflow-y-auto no-scrollbar flex flex-col gap-3">
                  {filteredQs.map(([n, q]) => (
                    <div key={n} className="bg-white/5 p-4 rounded-2xl flex justify-between items-center border border-white/5 group">
                      <div className="flex items-center gap-4 overflow-hidden"><span className="font-black text-pink-400 min-w-[40px]">#{n}</span><span className="text-xs truncate">{q.text}</span></div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => setEditingQuestion(n)} className="p-2 hover:text-pink-400"><Settings size={14}/></button></div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {view === 'generator' && (
            <div className="flex flex-col gap-8 items-center animate-in zoom-in duration-500">
               <h2 className="text-4xl font-black uppercase text-white/90 italic drop-shadow-2xl">{activeGame.name}</h2>
               <div className="w-full max-w-3xl bg-white/5 p-8 rounded-[3.5rem] border border-white/10 flex flex-wrap gap-6 items-center justify-center backdrop-blur-md">
                  <div className="flex gap-4 items-center border-r border-white/10 pr-6">
                    <div className="space-y-1 text-center text-[10px] uppercase font-black opacity-40">From<input type="number" value={config.min} onChange={e => setConfig({...config, min: e.target.value})} className="kawaii-input !p-2 !w-16 text-center block" /></div>
                    <div className="space-y-1 text-center text-[10px] uppercase font-black opacity-40">To<input type="number" value={config.max} onChange={e => setConfig({...config, max: e.target.value})} className="kawaii-input !p-2 !w-16 text-center block" /></div>
                    <div className="space-y-1 text-center text-[10px] uppercase font-black opacity-40">Draw<input type="number" value={config.count} onChange={e => setConfig({...config, count: e.target.value})} className="kawaii-input !p-2 !w-16 text-center block" /></div>
                  </div>
                  <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="kawaii-input !p-2 !w-32 bg-[#1a1329] border-none outline-none font-bold text-xs appearance-none cursor-pointer">
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button onClick={() => setRevealMode(!revealMode)} className={`p-3 rounded-2xl ${revealMode ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/20' : 'bg-white/5'}`}>{revealMode ? <Eye size={20}/> : <EyeOff size={20}/>}</button>
                  <form onSubmit={handleManualDraw} className="flex gap-2"><input value={manualNum} onChange={e => setManualNum(e.target.value)} placeholder="#" className="kawaii-input !p-2 !w-12 text-center" /><button type="submit" className="p-2 bg-white/5 hover:bg-pink-500 rounded-xl transition-all"><Hash size={16}/></button></form>
                  <button onClick={handleGenerate} disabled={isGenerating} className="kawaii-btn !py-6 !px-10 text-xl flex-1 shadow-2xl">Draw ✨</button>
               </div>
               {results.length > 0 && (
                 <div className="flex gap-2 animate-in fade-in slide-in-from-bottom-2">
                   <SoftBtn onClick={() => { navigator.clipboard.writeText(results.join(', ')); setCopied(true); setTimeout(()=>setCopied(false), 2000); }} icon={Copy}>Nums</SoftBtn>
                   <SoftBtn onClick={copyQuestionsToClipboard} icon={List}>Copy Qs</SoftBtn>
                   <SoftBtn onClick={captureScreenshot} icon={Camera}>Pic</SoftBtn>
                 </div>
               )}
               <div ref={resultsRef} className="w-full flex flex-wrap gap-12 justify-center p-12">
                  {results.map((n, i) => {
                    const q = activeGame.questions[n], rev = !revealMode || revealedCards.has(n);
                    return (
                      <div key={`${animationKey}-${i}`} className="game-card">
                        <button onClick={() => redrawCard(i)} className="absolute top-4 right-4 opacity-20 hover:opacity-100 transition-all"><RefreshCw size={14}/></button>
                        <span className="card-number">{n}</span>
                        <div className="h-px w-full bg-white/10 mb-4" />
                        <div className={`flex-1 flex flex-col items-center justify-between w-full transition-all duration-500 cursor-pointer ${!rev ? 'blur-lg opacity-20' : ''}`} onClick={() => { if(!rev) setRevealedCards(new Set([...revealedCards, n])); else setEditingQuestion(n); }}>
                          {q?.image && <img src={q.image} className="w-full h-24 object-cover rounded-2xl border border-white/10 shadow-lg" />}
                          <p className="text-xs font-bold text-pink-100/80 italic text-center leading-relaxed">"{q?.text || ''}"</p>
                          <span className="text-[8px] font-black uppercase opacity-20 tracking-widest">{q?.category}</span>
                        </div>
                        {!rev && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Sparkles className="text-pink-400 w-12 h-12 opacity-50" /></div>}
                      </div>
                    );
                  })}
               </div>
            </div>
          )}

          {view === 'remote' && (
            <div className="max-w-xl mx-auto flex flex-col items-center gap-8 text-center animate-in zoom-in duration-500">
               <div className="bg-white/5 p-10 rounded-[4rem] border border-white/10 backdrop-blur-xl w-full flex flex-col items-center gap-6 shadow-2xl">
                  <Globe size={48} className="text-pink-400" />
                  <h2 className="text-2xl font-black uppercase italic">Remote Play</h2>
                  <button onClick={() => setIsRemoteEnabled(!isRemoteEnabled)} className="kawaii-btn !py-4">{isRemoteEnabled ? 'Stop Remote' : 'Enable Remote'}</button>
                  {isRemoteEnabled && peerId && (
                    <>
                      <div className="bg-white p-6 rounded-[3rem] shadow-2xl border-8 border-pink-500/10"><QRCodeSVG value={`${REMOTE_APP_URL}?id=${peerId}`} size={180} /></div>
                      <code className="bg-black/40 px-6 py-3 rounded-full text-pink-400 font-black text-lg select-all">{peerId}</code>
                    </>
                  )}
               </div>
            </div>
          )}

          {view === 'tracker' && (
            <div className="flex flex-col gap-6">
              <button onClick={resetHistory} className="self-end px-4 py-2 bg-red-500/10 text-red-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-red-500/10 hover:bg-red-500/20 transition-all"><Eraser size={14} className="inline mr-2"/>Reset History</button>
              <div className="bg-white/5 p-10 rounded-[4rem] border border-white/10 grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-3 animate-in fade-in duration-500 no-scrollbar overflow-y-auto h-fit">
                {Array.from({length: Math.min(1000, config.max - config.min + 1)}).map((_, i) => {
                    const n = parseInt(config.min) + i, used = activeGame.history.includes(n), hasD = activeGame.questions[n];
                    return (
                      <button key={n} onMouseEnter={() => setHoveredItem(n)} onMouseLeave={() => setHoveredItem(null)} onClick={() => {
                        const nh = used ? activeGame.history.filter(x => x !== n) : [...activeGame.history, n]; const u = { ...activeGame, history: nh }; setActiveGame(u); if(u.id !== 'default') saveGameData(u);
                      }} className={`h-14 rounded-2xl font-black transition-all relative ${used ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/30' : 'bg-white/5 text-pink-900/40 hover:text-pink-300 hover:scale-110 hover:z-10'}`}>{n}{hasD && <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-pink-400 rounded-full shadow-[0_0_5px_#f472b6]" />}</button>
                    )
                })}
              </div>
            </div>
          )}

          {view === 'history' && (
            <div className="max-w-xl mx-auto flex flex-col gap-4 animate-in fade-in duration-500 no-scrollbar">
               {[...activeGame.history].reverse().slice(0, 100).map((n, i) => (
                 <div key={i} className="bg-white/5 p-4 rounded-[2.5rem] border border-white/5 flex justify-between items-center group hover:bg-white/10 shadow-sm transition-all">
                    <span className="text-2xl font-black italic text-pink-400 min-w-[60px]">#{n}</span><span className="text-xs font-bold text-pink-100/60 truncate">{activeGame.questions[n]?.text || '---'}</span>
                    <button onClick={() => { const nh = activeGame.history.filter(x => x !== n); const u = { ...activeGame, history: nh }; setActiveGame(u); saveGameData(u); }} className="p-2 text-pink-900/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={14}/></button>
                 </div>
               ))}
            </div>
          )}
        </main>
      </div>

      <div className="w-80 bg-white/5 rounded-[3.5rem] border border-white/10 backdrop-blur-3xl flex flex-col overflow-hidden shrink-0 relative z-50 shadow-2xl">
        <div className="p-6 bg-pink-500/10 border-b border-white/5 flex items-center gap-3"><MessageCircle className="text-pink-400" /><h3 className="font-black uppercase text-sm tracking-[0.2em]">Chat</h3></div>
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 no-scrollbar">
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.sender === 'Host' ? 'items-end' : 'items-start'}`}>
              <span className="text-[8px] font-black uppercase opacity-30 mb-1">{m.sender} • {m.time}</span>
              <p className={`px-4 py-2 rounded-2xl text-xs font-bold max-w-[90%] shadow-sm ${m.sender === 'Host' ? 'bg-pink-500 text-white rounded-tr-none' : 'bg-white/10 text-pink-100 rounded-tl-none'}`}>{m.text}</p>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <form onSubmit={sendMsg} className="p-4 bg-black/20 flex gap-2"><input value={chatInput} onChange={e => setChatInput(e.target.value)} className="flex-1 bg-white/5 border border-white/5 rounded-full px-4 py-2 text-xs outline-none focus:border-pink-500/50" placeholder="Chat..." /><button type="submit" className="p-2 bg-pink-500 rounded-full text-white hover:scale-110 transition-transform"><Send size={16}/></button></form>
      </div>

      {importModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[100] flex items-center justify-center p-6 text-center">
           <div className="bg-[#1a1329] w-full max-w-lg rounded-[4rem] border-2 border-pink-500/30 p-12 shadow-2xl animate-in zoom-in">
              <AlertTriangle size={48} className="text-pink-400 mx-auto mb-6" /><h3 className="text-3xl font-black uppercase text-white mb-4">Import</h3>
              <div className="flex flex-col gap-3">
                <button onClick={() => handleImportDecision('new')} className="kawaii-btn !bg-gradient-to-r !from-emerald-400 !to-cyan-500 !text-black">Create New ✨</button>
                <button onClick={() => handleImportDecision('overwrite')} className="kawaii-btn !bg-white/5 !text-pink-300">Overwrite</button>
                <button onClick={() => setImportModal(null)} className="py-4 text-[10px] font-black uppercase text-white/20">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {importTextModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
           <div className="bg-[#1a1329] w-full max-w-2xl rounded-[4rem] border border-white/10 p-12 relative animate-in zoom-in">
              <button onClick={() => setImportTextModal(false)} className="absolute top-10 right-10 text-pink-900 border-none bg-transparent cursor-pointer"><X size={32} /></button>
              <h3 className="text-center text-3xl font-black uppercase mb-8 italic">Import Text</h3>
              <textarea value={rawTextToImport} onChange={e => setRawTextToImport(e.target.value)} className="kawaii-input min-h-[300px] mb-8 font-medium text-sm" placeholder="1. Question..." />
              <button onClick={() => { const qs = parseRawText(rawTextToImport); if (Object.keys(qs).length) { checkImportSafety({ questions: qs }, 'Pasted'); setImportTextModal(false); } }} className="kawaii-btn w-full">Import ✨</button>
           </div>
        </div>
      )}

      {combineModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[100] flex items-center justify-center p-6 text-center">
           <div className="bg-[#1a1329] w-full max-w-2xl rounded-[4rem] border border-white/10 p-12 shadow-2xl animate-in zoom-in">
              <div className="flex justify-between items-center mb-8"><h3 className="text-3xl font-black uppercase italic">Combine</h3><button onClick={() => setCombineModal(false)} className="text-pink-900"><X size={32} /></button></div>
              <input value={megaGameName} onChange={e => setMegaGameName(e.target.value)} className="kawaii-input mb-6" placeholder="Combined Name" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 mb-8 no-scrollbar">
                {savedGamesList.map(g => (
                  <button key={g.id} onClick={() => { const n = new Set(selectedForMerge); n.has(g.id) ? n.delete(g.id) : n.add(g.id); setSelectedGamesToMerge(n); }} className={`p-4 rounded-2xl border transition-all flex items-center justify-between ${selectedForMerge.has(g.id) ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-white/5 border-white/5 text-pink-300/40'}`}>
                    <span className="font-bold text-sm truncate">{g.name}</span>{selectedForMerge.has(g.id) && <Check size={16}/>}
                  </button>
                ))}
              </div>
              <button onClick={handleCombineGames} className="kawaii-btn w-full !bg-gradient-to-r !from-emerald-400 !to-cyan-500 !text-black">Merge ✨</button>
           </div>
        </div>
      )}

      {hoveredItem && activeGame.questions[hoveredItem] && (
        <div className="fixed pointer-events-none z-[200] animate-in fade-in zoom-in duration-200" style={{ left: Math.min(window.innerWidth - 340, mousePos.x + 20), top: Math.min(window.innerHeight - 200, mousePos.y + 20) }}>
          <div className="bg-[#1a1329]/95 backdrop-blur-xl border border-pink-500/30 p-6 rounded-[2.5rem] shadow-2xl max-w-[320px] flex flex-col gap-4">
             <div className="flex justify-between items-center"><span className="text-4xl font-black italic text-pink-400">#{hoveredItem}</span><span className="text-[10px] font-black uppercase text-purple-400 bg-purple-500/10 px-3 py-1 rounded-full">{activeGame.questions[hoveredItem].category}</span></div>
             {activeGame.questions[hoveredItem].image && <img src={activeGame.questions[hoveredItem].image} className="w-full h-32 object-cover rounded-2xl border border-white/5" />}
             <p className="text-sm font-bold text-pink-100/90 italic leading-relaxed">"{activeGame.questions[hoveredItem].text}"</p>
          </div>
        </div>
      )}

      {editingQuestion !== null && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-2xl z-[100] flex items-center justify-center p-6 text-center">
           <div className="bg-[#1a1329] w-full max-w-md rounded-[4rem] border border-white/10 p-12 relative shadow-2xl">
              <button onClick={() => setEditingQuestion(null)} className="absolute top-10 right-10 text-pink-900 border-none bg-transparent cursor-pointer"><X size={32} /></button>
              <h3 className="text-3xl font-black uppercase mb-10 italic">Edit</h3>
              <form onSubmit={(e) => {
                e.preventDefault(); const fd = new FormData(e.target), n = editingQuestion === 'new' ? fd.get('num') : editingQuestion;
                setActiveGame(prev => ({ ...prev, questions: { ...prev.questions, [n]: { text: fd.get('txt'), image: fd.get('img'), category: fd.get('cat') } } }));
                setEditingQuestion(null);
              }} className="space-y-6">
                {editingQuestion === 'new' && <input name="num" type="number" required className="kawaii-input" placeholder="Number" />}
                <textarea name="txt" defaultValue={activeGame.questions[editingQuestion]?.text} className="kawaii-input min-h-[120px]" placeholder="Question..." />
                <input name="cat" defaultValue={activeGame.questions[editingQuestion]?.category} className="kawaii-input" placeholder="Category" />
                <input name="img" defaultValue={activeGame.questions[editingQuestion]?.image} className="kawaii-input" placeholder="Image URL" />
                <button type="submit" className="kawaii-btn w-full">Save</button>
              </form>
           </div>
        </div>
      )}

      <input type="file" ref={fileInputRef} hidden onChange={handleOcr} accept="image/*" />
      <input type="file" ref={jsonInputRef} hidden onChange={handleJsonImport} accept=".json" />
    </div>
  );
}

function NavTab({ icon: Icon, label, active, onClick }) {
  return <button onClick={onClick} className={`flex items-center gap-2 px-6 py-3 rounded-2xl transition-all font-black uppercase text-[10px] tracking-widest border-none cursor-pointer ${active ? 'bg-pink-500 text-white shadow-xl' : 'text-pink-300/60 hover:text-white hover:bg-white/5'}`}><Icon size={16} /> {label}</button>;
}

function SoftBtn({ onClick, icon: Icon, children }) {
  return <button onClick={onClick} className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-pink-300 transition-all shadow-xl"><Icon size={14} /> {children}</button>;
}
