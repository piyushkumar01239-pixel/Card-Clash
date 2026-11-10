import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ArrowLeft,
  BarChart3,
  Copy,
  Gamepad2,
  LogIn,
  LogOut,
  Play,
  Plus,
  Shield,
  Trophy,
  Users,
  Volume2,
  Zap,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const socket = io(API, { autoConnect: false });
const guestId = localStorage.getItem('cc_guest') || crypto.randomUUID();
localStorage.setItem('cc_guest', guestId);
const colorMap = {
  red: '#ff4e68',
  blue: '#4ca7ff',
  green: '#43d99a',
  yellow: '#ffd34e',
  wild: '#24243a',
};
const label = value => ({
  skip: '⊘',
  reverse: '⇄',
  draw2: '+2',
  draw4: '+4',
  wild: '✦',
}[value] || value);

function Card({ card, onClick, small = false, back = false, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`playing-card ${small ? 'small' : ''} ${back ? 'back' : ''}`}
      style={!back ? { '--card': colorMap[card.color] || '#fff' } : {}}
      aria-label={back ? 'Draw a card' : `${card.color} ${card.value}`}
    >
      {back ? <span>✦</span> : (
        <>
          <b>{label(card.value)}</b>
          <i>{label(card.value)}</i>
          <small>{card.color === 'wild' ? 'CLASH' : card.color.toUpperCase()}</small>
        </>
      )}
    </button>
  );
}

function canPlay(card, room) {
  return card.color === 'wild'
    || card.color === room.activeColor
    || card.value === room.discard?.value;
}

export default function App() {
  const [screen, setScreen] = useState('home');
  const [name, setName] = useState(localStorage.getItem('cc_name') || '');
  const [roomCode, setRoomCode] = useState(
    new URLSearchParams(window.location.search).get('room')?.toUpperCase() || '',
  );
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(localStorage.getItem('cc_token') || '');
  const [leaderboard, setLeaderboard] = useState([]);
  const [profile, setProfile] = useState(null);
  const [showColor, setShowColor] = useState(false);
  const [wildCardId, setWildCardId] = useState(null);
  const sorted = useMemo(() => room?.players || [], [room]);
  const me = room?.players?.find(player => player.id === room.selfId);
  const isHost = me?.host;
  const isTurn = room?.isYourTurn;

  useEffect(() => {
    socket.auth = { token: localStorage.getItem('cc_token') || '' };
    const handleRoomUpdate = next => {
      setRoom(next);
      if (next.status === 'playing' || next.status === 'finished') setScreen('game');
    };
    socket.on('room:update', handleRoomUpdate);
    socket.connect();
    return () => {
      socket.off('room:update', handleRoomUpdate);
      socket.disconnect();
    };
  }, []);

  function call(event, payload = {}) {
    return new Promise(resolve => {
      socket.emit(event, payload, response => resolve(
        response || { ok: false, error: 'No response from server.' },
      ));
    });
  }

  async function enter(mode) {
    setError('');
    if (!name.trim()) {
      setError('Enter a player name first.');
      return;
    }
    if (mode === 'join' && roomCode.trim().length !== 5) {
      setError('Enter the five-character room code.');
      return;
    }
    setBusy(true);
    try {
      localStorage.setItem('cc_name', name.trim());
      const response = await call(mode === 'create' ? 'room:create' : 'room:join', {
        name: name.trim(),
        guestId,
        code: roomCode.trim().toUpperCase(),
      });
      if (!response.ok) throw new Error(response.error);
      setRoom(response.room);
      setScreen('lobby');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const response = await call('game:start');
    if (!response.ok) setError(response.error);
  }

  async function play(card) {
    if (card.color === 'wild') {
      setWildCardId(card.id);
      setShowColor(true);
      return;
    }
    const response = await call('game:play', { cardId: card.id });
    if (!response.ok) setError(response.error);
  }

  async function chooseWild(color) {
    setShowColor(false);
    const response = await call('game:play', { cardId: wildCardId, color });
    setWildCardId(null);
    if (!response.ok) setError(response.error);
  }

  async function draw() {
    const response = await call('game:draw');
    if (!response.ok) setError(response.error);
  }

  async function leaveRoom() {
    await call('room:leave');
    setRoom(null);
    setScreen('home');
    window.history.replaceState({}, '', window.location.pathname);
  }

  async function copyInvite() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', room.code);
      await navigator.clipboard.writeText(url.toString());
      setError('Invite link copied.');
    } catch {
      setError(`Room code: ${room.code}`);
    }
  }

  async function auth() {
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not sign in.');
      setToken(data.token);
      localStorage.setItem('cc_token', data.token);
      socket.auth = { token: data.token };
      socket.disconnect().connect();
      setName(data.user.name);
      localStorage.setItem('cc_name', data.user.name);
      setError('Signed in. Your account is ready.');
      setScreen('home');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem('cc_token');
    setToken('');
    setProfile(null);
    socket.auth = {};
    socket.disconnect().connect();
    setError('You are signed out. Guest play is still available.');
  }

  async function showLeaderboard() {
    setError('');
    try {
      const response = await fetch(`${API}/api/leaderboard`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load leaderboard.');
      setLeaderboard(data);
      setScreen('leaderboard');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function showProfile() {
    setError('');
    try {
      const response = await fetch(`${API}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load profile.');
      setProfile(data);
      setScreen('profile');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setScreen('home')}>
          <span className="brand-mark"><Zap /></span>
          <span>CARD<span className="accent">CLASH</span><small>PLAY • MATCH • WIN</small></span>
        </button>
        <nav>
          <button type="button" onClick={showLeaderboard}><Trophy size={16} /> Leaderboard</button>
          {token && <button type="button" onClick={showProfile}><BarChart3 size={16} /> Stats</button>}
          <button
            type="button"
            className="profile-pill"
            onClick={() => (token ? showProfile() : setScreen('auth'))}
          >
            {token ? 'PLAYER ACCOUNT' : 'SIGN IN'}
          </button>
        </nav>
      </header>

      {screen === 'home' && (
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span /> REAL-TIME MULTIPLAYER CARD ARENA</div>
            <h1>YOUR CARDS.<br />YOUR STRATEGY.<br /><em>YOUR VICTORY.</em></h1>
            <p>Challenge your friends in an exciting real-time multiplayer card battle.</p>
            <div className="hero-actions">
              <button className="primary" type="button" onClick={() => { setError(''); setScreen('lobbySetup'); }}>
                <Play size={17} fill="currentColor" /> PLAY NOW
              </button>
              <button className="secondary" type="button" onClick={() => setScreen('how')}>
                HOW TO PLAY <ArrowLeft size={15} />
              </button>
            </div>
            <div className="stats">
              <div><b>2–8</b><span>PLAYERS</span></div>
              <div><b>7</b><span>STARTING CARDS</span></div>
              <div><b>∞</b><span>REMATCHES</span></div>
            </div>
          </div>
          <div className="hero-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-card c-red"><b>7</b><small>RED</small></div>
            <div className="floating-card c-blue"><b>⇄</b><small>BLUE</small></div>
            <div className="floating-card c-yellow"><b>+2</b><small>YELLOW</small></div>
            <div className="floating-card c-wild"><b>✦</b><small>WILD</small></div>
            <div className="center-chip">CC</div>
            <div className="art-caption">YOUR MOVE. YOUR MOMENT.</div>
          </div>
          <div className="hero-bottom">
            <span><Shield size={14} /> SERVER-AUTHORITATIVE GAMEPLAY</span>
            <span><Users size={14} /> ROOMS FOR YOUR CREW</span>
            <span><Volume2 size={14} /> BUILT FOR THE COMPETITIVE</span>
          </div>
        </section>
      )}

      {screen === 'lobbySetup' && (
        <section className="panel-wrap">
          <div className="panel">
            <button className="back-link" type="button" onClick={() => setScreen('home')}>
              <ArrowLeft size={15} /> BACK
            </button>
            <div className="eyebrow">CREATE YOUR GAME</div>
            <h2>READY TO <em>CLASH?</em></h2>
            <label htmlFor="player-name">YOUR PLAYER NAME</label>
            <input id="player-name" value={name} onChange={event => setName(event.target.value)} placeholder="Enter your name" maxLength={18} />
            <button className="primary full" type="button" disabled={busy} onClick={() => enter('create')}>
              <Plus size={17} /> {busy ? 'CONNECTING…' : 'CREATE A ROOM'}
            </button>
            <div className="or"><span /> OR JOIN AN EXISTING ROOM <span /></div>
            <label htmlFor="room-code">ROOM CODE</label>
            <input id="room-code" value={roomCode} onChange={event => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} placeholder="e.g. A7K2P" maxLength={5} />
            <button className="secondary full" type="button" disabled={busy} onClick={() => enter('join')}>
              <LogIn size={17} /> JOIN ROOM
            </button>
            {error && <p className="error">{error}</p>}
            <p className="hint">Guest play is available instantly. Sign in to save your stats when MongoDB is configured.</p>
          </div>
        </section>
      )}

      {screen === 'lobby' && room && (
        <section className="panel-wrap">
          <div className="panel wide">
            <button className="back-link" type="button" onClick={leaveRoom}><ArrowLeft size={15} /> LEAVE ROOM</button>
            <div className="eyebrow">ROOM LOBBY • {room.status.toUpperCase()}</div>
            <h2>YOUR TABLE IS <em>OPEN.</em></h2>
            <button className="room-code" type="button" onClick={copyInvite}>
              <small>INVITE LINK • ROOM CODE</small>
              <b>{room.code}</b>
              <Copy size={18} />
            </button>
            <div className="player-grid">
              {sorted.map(player => (
                <div className="player-tile" key={player.id}>
                  <div className="avatar">{player.name.slice(0, 1).toUpperCase()}</div>
                  <b>{player.name}</b>
                  <small>{player.host ? 'HOST' : 'PLAYER'} {player.id === room.selfId ? '• YOU' : ''}</small>
                </div>
              ))}
              {Array.from({ length: Math.max(0, 8 - sorted.length) }).map((_, index) => (
                <div className="player-tile empty" key={index}>
                  <div className="avatar">?</div><b>Waiting…</b><small>OPEN SEAT</small>
                </div>
              ))}
            </div>
            {isHost ? (
              <button className="primary full" type="button" disabled={sorted.length < 2} onClick={start}>
                <Play size={17} fill="currentColor" /> START GAME ({sorted.length}/8)
              </button>
            ) : (
              <p className="hint">Waiting for the host to start. Share the invite link with your friends.</p>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </section>
      )}

      {screen === 'game' && room && (
        <section className="game-screen">
          <div className="game-head">
            <div>
              <div className="eyebrow">LIVE MATCH • ROOM {room.code}</div>
              <h2>CARD <em>CLASH</em></h2>
            </div>
            <div className="turn-pill">{isTurn ? 'YOUR TURN' : 'OPPONENT TURN'}</div>
          </div>
          <div className="arena">
            <div className="opponents">
              {sorted.filter(player => player.id !== room.selfId).map(player => (
                <div className={`opponent ${room.currentPlayer === player.id ? 'active' : ''}`} key={player.id}>
                  <div className="avatar">{player.name.slice(0, 1)}</div>
                  <b>{player.name}{player.connected === false ? ' • RECONNECTING' : ''}</b>
                  <small>{player.cardCount} CARDS</small>
                  <div className="mini-hand">
                    {Array.from({ length: Math.min(player.cardCount, 5) }).map((_, index) => (
                      <Card key={index} back small disabled />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="table-center">
              <div className="pile draw-pile">
                <Card back disabled={!isTurn} onClick={draw} />
                <small>DRAW PILE</small>
              </div>
              <div className="pile discard-pile">
                <Card card={room.discard} disabled />
                <small>DISCARD • {room.activeColor?.toUpperCase()}</small>
              </div>
              <div className="table-message">{room.message}</div>
              <div className="table-message">DIRECTION • {room.direction === 1 ? 'CLOCKWISE ↻' : 'COUNTERCLOCKWISE ↺'}</div>
            </div>
            <div className="my-area">
              <div className="my-label"><span>YOUR HAND</span><b>{room.hand?.length || 0} CARDS</b></div>
              <div className="my-hand">
                {room.hand?.map(card => (
                  <Card
                    key={card.id}
                    card={card}
                    disabled={!isTurn || !canPlay(card, room)}
                    onClick={() => play(card)}
                  />
                ))}
              </div>
              <div className="hand-actions">
                <button className="secondary" type="button" disabled={!isTurn} onClick={draw}>DRAW A CARD</button>
                <span>{isTurn ? 'Play a matching card or draw. Drawing passes your turn.' : 'Wait for your turn.'}</span>
              </div>
            </div>
          </div>
          {room.status === 'finished' && (
            <div className="winner-overlay">
              <div className="panel">
                <div className="eyebrow">MATCH COMPLETE</div>
                <h2>{room.players.find(player => player.id === room.winner)?.name || 'MATCH'} <em>{room.winner ? 'WINS!' : 'ENDED'}</em></h2>
                <button className="primary full" type="button" onClick={leaveRoom}>BACK TO HOME</button>
              </div>
            </div>
          )}
          {showColor && (
            <div className="modal-scrim">
              <div className="panel">
                <h2>CHOOSE A <em>COLOR</em></h2>
                <div className="color-options">
                  {['red', 'blue', 'green', 'yellow'].map(color => (
                    <button key={color} type="button" aria-label={color} style={{ background: colorMap[color] }} onClick={() => chooseWild(color)} />
                  ))}
                </div>
              </div>
            </div>
          )}
          {error && <button className="toast" type="button" onClick={() => setError('')}>{error} ×</button>}
        </section>
      )}

      {screen === 'leaderboard' && (
        <section className="panel-wrap">
          <div className="panel wide">
            <button className="back-link" type="button" onClick={() => setScreen('home')}><ArrowLeft size={15} /> BACK</button>
            <div className="eyebrow">THE CLASH RANKINGS</div>
            <h2>TOP <em>PLAYERS</em></h2>
            {leaderboard.length ? (
              <div className="rank-list">
                {leaderboard.map(player => (
                  <div className="rank-row" key={player.id}>
                    <b>#{player.rank}</b><span>{player.name}</span>
                    <small>{player.wins} WINS • {player.winRate}% WIN RATE • {player.games} GAMES</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">No ranked players yet. Sign in and win matches to appear here.</p>
            )}
          </div>
        </section>
      )}

      {screen === 'profile' && (
        <section className="panel-wrap">
          <div className="panel wide">
            <button className="back-link" type="button" onClick={() => setScreen('home')}><ArrowLeft size={15} /> BACK</button>
            <div className="eyebrow">PLAYER DASHBOARD</div>
            <h2>{profile?.profile?.name || name || 'PLAYER'} <em>STATS</em></h2>
            {profile ? (
              <>
                <div className="stats profile-stats">
                  <div><b>{profile.profile.games}</b><span>MATCHES</span></div>
                  <div><b>{profile.profile.wins}</b><span>WINS</span></div>
                  <div><b>{profile.profile.winRate}%</b><span>WIN RATE</span></div>
                </div>
                <h3>RECENT MATCHES</h3>
                {profile.recentMatches.length ? (
                  <div className="rank-list">
                    {profile.recentMatches.map(match => (
                      <div className="rank-row" key={match._id}>
                        <b>{match.winner?.name === profile.profile.name ? 'WIN' : 'PLAYED'}</b>
                        <span>Room {match.roomCode}</span>
                        <small>{match.durationSeconds}s</small>
                      </div>
                    ))}
                  </div>
                ) : <p className="hint">Your completed matches will appear here.</p>}
              </>
            ) : <p className="hint">Loading your saved player profile…</p>}
            <button className="secondary full" type="button" onClick={logout}><LogOut size={16} /> SIGN OUT</button>
            {error && <p className="error">{error}</p>}
          </div>
        </section>
      )}

      {screen === 'auth' && (
        <section className="panel-wrap">
          <div className="panel">
            <button className="back-link" type="button" onClick={() => setScreen('home')}><ArrowLeft size={15} /> BACK</button>
            <div className="eyebrow">PLAYER ID</div>
            <h2>JOIN THE <em>RANKS.</em></h2>
            <div className="tabs">
              <button type="button" className={authMode === 'register' ? 'selected' : ''} onClick={() => setAuthMode('register')}>REGISTER</button>
              <button type="button" className={authMode === 'login' ? 'selected' : ''} onClick={() => setAuthMode('login')}>LOGIN</button>
            </div>
            {authMode === 'register' && (
              <>
                <label htmlFor="account-name">PLAYER NAME</label>
                <input id="account-name" value={name} onChange={event => setName(event.target.value)} placeholder="Your name" maxLength={18} />
              </>
            )}
            <label htmlFor="account-email">EMAIL</label>
            <input id="account-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
            <label htmlFor="account-password">PASSWORD</label>
            <input id="account-password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" />
            <button className="primary full" type="button" disabled={busy} onClick={auth}>
              {busy ? 'PLEASE WAIT…' : authMode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}
            </button>
            {error && <p className="error">{error}</p>}
            <p className="hint">Guests can play without registering. Account creation requires MongoDB to be configured.</p>
          </div>
        </section>
      )}

      {screen === 'how' && (
        <section className="panel-wrap">
          <div className="panel wide">
            <button className="back-link" type="button" onClick={() => setScreen('home')}><ArrowLeft size={15} /> BACK</button>
            <div className="eyebrow">QUICK RULES</div>
            <h2>HOW TO <em>CLASH.</em></h2>
            <div className="rules">
              <p><b>01 / DEAL</b><span>Every player starts with seven cards.</span></p>
              <p><b>02 / MATCH</b><span>Play a card matching the top discard by color or value.</span></p>
              <p><b>03 / SPECIALS</b><span>Skip, Reverse, Draw Two, Wild and Draw Four change the game.</span></p>
              <p><b>04 / DRAW</b><span>Drawing a card ends your turn; a newly drawn card cannot be played immediately.</span></p>
              <p><b>05 / WIN</b><span>First player to empty their hand wins the round.</span></p>
            </div>
            <p className="hint">This is an original, UNO-inspired shedding-card game.</p>
            <button className="primary full" type="button" onClick={() => setScreen('lobbySetup')}>LET'S PLAY <Play size={16} /></button>
          </div>
        </section>
      )}

      <footer><span>© 2026 CARD CLASH</span><span>BUILT FOR THE NEXT MOVE <Gamepad2 size={14} /></span></footer>
      {error && screen !== 'game' && <button className="toast" type="button" onClick={() => setError('')}>{error} ×</button>}
    </main>
  );
}
