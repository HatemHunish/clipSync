import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// In dev, hit the backend directly; in prod, backend and frontend share the same origin
const SOCKET_URL = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : undefined);

export default function App() {
  const [view, setView] = useState('home');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [text, setText] = useState('');
  const [clientCount, setClientCount] = useState(1);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | synced
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef(null);
  const debounceRef = useRef(null);
  const syncIdleRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) setJoinCode(roomParam.toUpperCase().slice(0, 6));
  }, []);

  const setSyncIdle = useCallback(() => {
    if (syncIdleRef.current) clearTimeout(syncIdleRef.current);
    syncIdleRef.current = setTimeout(() => setSyncStatus('idle'), 1800);
  }, []);

  const connectToRoom = useCallback((code) => {
    const socket = SOCKET_URL ? io(SOCKET_URL) : io();
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join-room', code));

    socket.on('text-update', (newText) => {
      setText(newText);
      setSyncStatus('synced');
      setSyncIdle();
    });

    socket.on('client-count', (count) => setClientCount(count));

    socket.on('room-error', (msg) => {
      setError(msg);
      socket.disconnect();
      setView('home');
    });
  }, [setSyncIdle]);

  const createRoom = async () => {
    setError('');
    try {
      const res = await fetch('/api/create-room', { method: 'POST' });
      if (!res.ok) throw new Error();
      const { code } = await res.json();
      setRoomCode(code);
      setText('');
      connectToRoom(code);
      setView('clipboard');
    } catch {
      setError('Could not create room — is the server running?');
    }
  };

  const joinRoom = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) { setError('Enter a 6-character room code'); return; }
    setError('');
    try {
      const res = await fetch(`/api/room/${code}`);
      if (!res.ok) { setError('Room not found — check the code and try again'); return; }
      setRoomCode(code);
      connectToRoom(code);
      setView('clipboard');
    } catch {
      setError('Could not connect — is the server running?');
    }
  };

  const leaveRoom = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setRoomCode('');
    setText('');
    setJoinCode('');
    setClientCount(1);
    setSyncStatus('idle');
    setError('');
    setView('home');
    window.history.replaceState({}, '', '/');
  };

  const handleTextChange = (e) => {
    const newText = e.target.value;
    setText(newText);
    setSyncStatus('syncing');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      socketRef.current?.emit('update-text', newText);
      setSyncStatus('synced');
      setSyncIdle();
    }, 250);
  };

  const clearText = () => {
    setText('');
    socketRef.current?.emit('update-text', '');
  };

  const writeToClipboard = async (str) => {
    try {
      await navigator.clipboard.writeText(str);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  };

  const copyText = async () => {
    if (!text) return;
    await writeToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyShareLink = async () => {
    await writeToClipboard(`${window.location.origin}/?room=${roomCode}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (syncIdleRef.current) clearTimeout(syncIdleRef.current);
    };
  }, []);

  if (view === 'home') {
    return (
      <div className="app">
        <div className="home-card">
          <div className="logo">
            <ClipboardSvg />
          </div>
          <h1>ClipSync</h1>
          <p className="subtitle">Share text across your devices in real time</p>

          {error && <div className="error-msg">{error}</div>}

          <button className="btn-primary" onClick={createRoom}>
            Create New Room
          </button>

          <div className="divider"><span>or join with a code</span></div>

          <div className="join-group">
            <input
              className="code-input"
              placeholder="ABC123"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
              maxLength={6}
              spellCheck={false}
              autoFocus
            />
            <button className="btn-secondary" onClick={joinRoom}>Join</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app clip-view">
      <div className="clipboard-container">
        <header className="clip-header">
          <div className="header-left">
            <button className="back-btn" onClick={leaveRoom} title="Leave room">
              <BackSvg />
            </button>
            <div className="room-pill">
              <span className="room-label">Room</span>
              <span className="room-code">{roomCode}</span>
            </div>
          </div>
          <div className="header-right">
            <button className="share-btn" onClick={copyShareLink}>
              {linkCopied ? <><CheckSvg /> Link copied</> : <><ShareSvg /> Share</>}
            </button>
            <div className="device-count">
              <span className="dot" />
              {clientCount} {clientCount === 1 ? 'device' : 'devices'}
            </div>
            <span className={`sync-status sync-${syncStatus}`}>
              {syncStatus === 'syncing' && 'Syncing…'}
              {syncStatus === 'synced' && <><CheckSvg /> Synced</>}
            </span>
          </div>
        </header>

        <textarea
          className="clip-textarea"
          value={text}
          onChange={handleTextChange}
          placeholder="Paste or type text here — it syncs to all connected devices instantly."
          spellCheck={false}
          autoFocus
        />

        <footer className="clip-footer">
          <span className="char-count">{text.length.toLocaleString()} chars</span>
          <div className="footer-actions">
            <button className="btn-ghost" onClick={clearText} disabled={!text}>
              Clear
            </button>
            <button className="btn-copy" onClick={copyText} disabled={!text}>
              {copied ? <><CheckSvg /> Copied!</> : <><CopySvg /> Copy All</>}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ClipboardSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 4H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <rect x="8" y="2" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="2"/>
      <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function BackSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CopySvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2"/>
    </svg>
  );
}

function CheckSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ShareSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2"/>
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
      <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2"/>
      <path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49" stroke="currentColor" strokeWidth="2"/>
    </svg>
  );
}
