import { io } from 'socket.io-client';
import './styles.css';

const COLORS = [
  '#111827', '#ffffff', '#ef4444', '#f97316', '#f59e0b', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#78716c', '#9ca3af'
];

const socket = io();

const state = {
  view: 'home',
  name: localStorage.getItem('skribble:name') || 'Player',
  joinCode: initialRoomCode(),
  roomCode: '',
  roomSettings: {
    players: 8,
    language: 'English',
    drawTime: 80,
    rounds: 3,
    mode: 'Normal',
    wordCount: 3,
    hints: 2,
    customWords: '',
    customOnly: false
  },
  players: [],
  messages: [],
  round: 1,
  drawerId: '',
  drawerIndex: 0,
  myId: '',
  currentWord: '',
  wordHint: 'Waiting for word',
  wordChoices: [],
  seconds: 80,
  phase: 'lobby',
  selectedColor: '#111827',
  selectedSize: 12,
  tool: 'brush',
  strokes: [],
  previewStroke: null,
  modal: null,
  error: ''
};

let canvasContext = null;
let isDrawing = false;
let currentStroke = null;
let previewEmitAt = 0;

socket.on('connect', () => {
  state.error = '';
  render();
});

socket.on('disconnect', () => {
  state.error = 'Disconnected from the live room server. Reconnecting...';
  render();
});

socket.on('room:error', (message) => {
  state.error = message;
  render();
});

socket.on('room:state', (roomState) => {
  Object.assign(state, roomState, {
    view: 'room',
    modal: state.modal,
    error: '',
    previewStroke: null
  });
  window.history.replaceState(null, '', `?${state.roomCode}`);
  render();
});

socket.on('drawing:preview', (stroke) => {
  state.previewStroke = stroke;
  redrawCanvas();
});

socket.on('drawing:commit', (stroke) => {
  state.previewStroke = null;
  state.strokes.push(stroke);
  redrawCanvas();
});

function initialRoomCode() {
  const query = location.search.replace('?', '').replace(/=/g, '');
  return query ? query.toUpperCase().slice(0, 8) : '';
}

function render() {
  const app = document.querySelector('#app');
  app.innerHTML = state.view === 'room' ? roomTemplate() : homeTemplate();

  bindCommon();
  if (state.view === 'room') {
    bindRoom();
    requestAnimationFrame(() => {
      setupCanvas();
      redrawCanvas();
    });
  }
}

function homeTemplate() {
  return `
    <main class="home-shell">
      <section class="home-hero">
        <div class="brand-lockup" aria-label="Skribble clone">
          <svg class="brand-mark" viewBox="0 0 120 72" role="img" aria-label="Drawing cloud">
            <path d="M21 49C9 47 4 38 7 29c3-9 12-13 20-10C32 8 43 2 55 4c11 1 20 8 24 18 9-2 20 3 24 12 5 11-3 25-17 27H22Z" fill="#fff" stroke="#111827" stroke-width="4"/>
            <path d="M34 36c14-11 26-12 36-2 8 8 15 7 22 0" fill="none" stroke="#ef4444" stroke-width="6" stroke-linecap="round"/>
          </svg>
          <h1>skribble</h1>
        </div>

        <div class="join-panel">
          ${state.error ? `<p class="error-banner">${escapeHtml(state.error)}</p>` : ''}
          <label for="player-name">Nickname</label>
          <input id="player-name" value="${escapeHtml(state.name)}" maxlength="18" autocomplete="off" />
          <label for="room-code">Room code</label>
          <input id="room-code" value="${escapeHtml(state.joinCode)}" maxlength="8" autocomplete="off" placeholder="Optional invite code" />
          <div class="home-actions">
            <button class="primary" data-action="quick-play">Play!</button>
            <button class="secondary" data-action="join-room">Join Room</button>
          </div>
          <button class="secondary full" data-action="private-room">Create Private Room</button>
          <select id="language-select" aria-label="Language">
            ${['English', 'German', 'Spanish', 'French', 'Japanese', 'Portuguese', 'Turkish'].map((language) => `
              <option ${language === state.roomSettings.language ? 'selected' : ''}>${language}</option>
            `).join('')}
          </select>
        </div>
      </section>

      <section class="info-band">
        <article>
          <h2>Live Rooms</h2>
          <p>Create a room, copy the invite link, and open it in another browser or device on the same network to play together.</p>
        </article>
        <article>
          <h2>How to play</h2>
          <ol>
            <li>The active drawer chooses a word.</li>
            <li>Strokes sync live to everyone in the room.</li>
            <li>Guessers score points by typing the exact word first.</li>
          </ol>
        </article>
        <article>
          <h2>Realtime scope</h2>
          <p>Rooms, chat, drawing, turns, scoring, timers, settings, and invite joins are coordinated over Socket.IO.</p>
        </article>
      </section>
    </main>

    ${state.view === 'home-private' ? privateRoomModal() : ''}
  `;
}

function roomTemplate() {
  const drawer = state.players.find((player) => player.id === state.drawerId);
  const isUserDrawing = isDrawer() && state.phase === 'draw';
  const isOwner = state.players.find((player) => player.id === state.myId)?.owner;
  const wordDisplay = state.phase === 'draw' ? state.wordHint : 'Waiting for word';

  return `
    <main class="game-shell">
      <header class="game-topbar">
        <button class="icon-button" data-action="home" aria-label="Home" title="Home">⌂</button>
        <div>
          <span class="muted">Room</span>
          <strong>${state.roomCode}</strong>
        </div>
        <div class="round-chip">Round ${state.round}/${state.roomSettings.rounds}</div>
        <div class="word-chip">${escapeHtml(wordDisplay)}</div>
        <div class="timer" aria-label="Timer">${state.seconds}s</div>
        <button class="icon-button" data-action="invite" aria-label="Invite" title="Invite">↗</button>
        <button class="icon-button" data-action="settings" aria-label="Settings" title="Settings" ${isOwner ? '' : 'disabled'}>⚙</button>
      </header>

      <section class="game-grid">
        <aside class="players-panel" aria-label="Players">
          <h2>Players</h2>
          <div class="players-list">
            ${state.players.map((player) => `
              <div class="player-row ${player.id === state.drawerId ? 'active' : ''}">
                <div class="avatar" style="--avatar:${player.color}">${escapeHtml(player.name.slice(0, 1))}</div>
                <div class="player-meta">
                  <strong>${escapeHtml(player.name)} ${player.owner ? '<span title="Owner">★</span>' : ''}</strong>
                  <span>${player.score} pts</span>
                </div>
                ${player.guessed ? '<span class="guessed">✓</span>' : ''}
              </div>
            `).join('')}
          </div>
        </aside>

        <section class="board-panel">
          ${state.phase === 'choose' && isDrawer() ? wordChooser() : ''}
          <div class="drawer-banner">
            <span>${drawer ? `${escapeHtml(drawer.name)} ${state.phase === 'choose' ? 'is choosing' : 'is drawing'}` : 'Waiting for players'}</span>
            <strong>${bannerText(isUserDrawing)}</strong>
          </div>
          <div class="canvas-wrap">
            <canvas id="drawing-board" width="980" height="620"></canvas>
          </div>
          <div class="toolstrip" aria-label="Drawing tools">
            <button class="tool ${state.tool === 'brush' ? 'selected' : ''}" data-tool="brush" title="Brush" aria-label="Brush" ${isUserDrawing ? '' : 'disabled'}>✎</button>
            <button class="tool ${state.tool === 'eraser' ? 'selected' : ''}" data-tool="eraser" title="Eraser" aria-label="Eraser" ${isUserDrawing ? '' : 'disabled'}>⌫</button>
            <button class="tool" data-action="undo" title="Undo" aria-label="Undo" ${isUserDrawing ? '' : 'disabled'}>↶</button>
            <button class="tool" data-action="clear" title="Clear" aria-label="Clear" ${isUserDrawing ? '' : 'disabled'}>×</button>
            <input type="range" min="3" max="34" value="${state.selectedSize}" id="brush-size" aria-label="Brush size" ${isUserDrawing ? '' : 'disabled'} />
            <div class="swatches">
              ${COLORS.map((color) => `
                <button class="swatch ${state.selectedColor === color ? 'selected' : ''}" style="--swatch:${color}" data-color="${color}" aria-label="Color ${color}" ${isUserDrawing ? '' : 'disabled'}></button>
              `).join('')}
            </div>
          </div>
        </section>

        <aside class="chat-panel" aria-label="Chat">
          <div class="chat-log" id="chat-log">
            ${state.messages.map((message) => `
              <p class="${message.kind || ''}"><strong>${escapeHtml(message.name)}:</strong> ${escapeHtml(message.text)}</p>
            `).join('')}
          </div>
          <form class="chat-form" data-action="chat">
            <input id="chat-input" placeholder="${isUserDrawing ? 'You are drawing' : 'Type your guess'}" autocomplete="off" ${isUserDrawing || state.phase !== 'draw' ? 'disabled' : ''} />
            <button aria-label="Send" ${isUserDrawing || state.phase !== 'draw' ? 'disabled' : ''}>➤</button>
          </form>
        </aside>
      </section>
    </main>

    ${state.modal === 'settings' ? settingsModal() : ''}
    ${state.modal === 'invite' ? inviteModal() : ''}
  `;
}

function bannerText(isUserDrawing) {
  if (state.phase === 'choose') return isDrawer() ? 'Choose a word to start' : 'Waiting for word choice';
  if (state.phase === 'gameover') return 'Game over';
  return isUserDrawing ? `Draw: ${escapeHtml(state.currentWord)}` : 'Guess the word';
}

function privateRoomModal() {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-label="Private room settings">
        <button class="close-button" data-action="close-modal" aria-label="Close">×</button>
        <h2>Create Private Room</h2>
        ${settingsForm()}
        <button class="primary full" data-action="start-private">Start!</button>
      </section>
    </div>
  `;
}

function settingsModal() {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-label="Room settings">
        <button class="close-button" data-action="close-modal" aria-label="Close">×</button>
        <h2>Room Settings</h2>
        ${settingsForm()}
        <button class="primary full" data-action="apply-settings">Apply</button>
      </section>
    </div>
  `;
}

function inviteModal() {
  const link = `${location.origin}${location.pathname}?${state.roomCode}`;
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal invite-modal" role="dialog" aria-modal="true" aria-label="Invite">
        <button class="close-button" data-action="close-modal" aria-label="Close">×</button>
        <h2>Invite your friends!</h2>
        <p class="invite-link">${escapeHtml(link)}</p>
        <button class="primary full" data-action="copy-invite" data-link="${escapeHtml(link)}">Copy</button>
      </section>
    </div>
  `;
}

function settingsForm() {
  const settings = state.roomSettings;
  return `
    <form class="settings-form" id="settings-form">
      ${numberSelect('Players', 'players', settings.players, [2,3,4,5,6,7,8,9,10,12,16,20])}
      ${numberSelect('Drawtime', 'drawTime', settings.drawTime, [30,40,50,60,70,80,90,100,120,150,180])}
      ${numberSelect('Rounds', 'rounds', settings.rounds, [1,2,3,4,5,6,7,8,9,10])}
      ${textSelect('Game Mode', 'mode', settings.mode, ['Normal','Hidden','Combination'])}
      ${numberSelect('Word Count', 'wordCount', settings.wordCount, [1,2,3,4,5])}
      ${numberSelect('Hints', 'hints', settings.hints, [0,1,2,3,4,5])}
      <label class="wide">Custom words
        <textarea name="customWords" placeholder="comma, separated, words">${escapeHtml(settings.customWords)}</textarea>
      </label>
      <label class="checkbox wide">
        <input type="checkbox" name="customOnly" ${settings.customOnly ? 'checked' : ''} />
        Use custom words only
      </label>
    </form>
  `;
}

function numberSelect(label, name, value, options) {
  return textSelect(label, name, String(value), options.map(String));
}

function textSelect(label, name, value, options) {
  return `
    <label>${label}
      <select name="${name}">
        ${options.map((option) => `<option value="${option}" ${String(value) === String(option) ? 'selected' : ''}>${option}</option>`).join('')}
      </select>
    </label>
  `;
}

function wordChooser() {
  return `
    <div class="word-chooser">
      <h2>Choose a word</h2>
      <div>
        ${state.wordChoices.map((word) => `<button class="word-option" data-word="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join('')}
      </div>
    </div>
  `;
}

function bindCommon() {
  document.querySelector('#player-name')?.addEventListener('input', (event) => {
    state.name = event.target.value;
    localStorage.setItem('skribble:name', state.name);
  });
  document.querySelector('#room-code')?.addEventListener('input', (event) => {
    state.joinCode = event.target.value.toUpperCase();
  });
  document.querySelector('#language-select')?.addEventListener('change', (event) => {
    state.roomSettings.language = event.target.value;
  });
  document.onclick = handleClick;
}

function bindRoom() {
  document.querySelector('#brush-size')?.addEventListener('input', (event) => {
    state.selectedSize = Number(event.target.value);
  });
  document.querySelector('.chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitGuess();
  });
  const chatLog = document.querySelector('#chat-log');
  if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
}

function handleClick(event) {
  const actionTarget = event.target.closest('[data-action]');
  const toolTarget = event.target.closest('[data-tool]');
  const colorTarget = event.target.closest('[data-color]');
  const wordTarget = event.target.closest('[data-word]');
  const backdrop = event.target.classList.contains('modal-backdrop');

  if (toolTarget && isDrawer()) {
    state.tool = toolTarget.dataset.tool;
    render();
    return;
  }
  if (colorTarget && isDrawer()) {
    state.selectedColor = colorTarget.dataset.color;
    state.tool = 'brush';
    render();
    return;
  }
  if (wordTarget) {
    socket.emit('game:chooseWord', wordTarget.dataset.word);
    return;
  }
  if (!actionTarget) return;
  if (actionTarget.closest('.modal') && backdrop) return;

  const action = actionTarget.dataset.action;
  if (action === 'quick-play') createRoom(false);
  if (action === 'join-room') joinRoom();
  if (action === 'private-room') {
    state.view = 'home-private';
    render();
  }
  if (action === 'start-private') createRoom(true);
  if (action === 'home') resetHome();
  if (action === 'settings') {
    state.modal = 'settings';
    render();
  }
  if (action === 'invite') {
    state.modal = 'invite';
    render();
  }
  if (action === 'close-modal') {
    state.modal = null;
    state.view = state.view === 'home-private' ? 'home' : state.view;
    render();
  }
  if (action === 'apply-settings') {
    readSettings();
    socket.emit('room:updateSettings', state.roomSettings);
    state.modal = null;
    render();
  }
  if (action === 'copy-invite') {
    navigator.clipboard?.writeText(actionTarget.dataset.link);
    state.modal = null;
    render();
  }
  if (action === 'undo') socket.emit('drawing:undo');
  if (action === 'clear') socket.emit('drawing:clear');
}

function createRoom(fromPrivate) {
  if (fromPrivate) readSettings();
  socket.emit('room:create', {
    name: state.name,
    settings: state.roomSettings
  });
}

function joinRoom() {
  const code = state.joinCode || initialRoomCode();
  if (!code) {
    state.error = 'Paste a room code or invite link code first.';
    render();
    return;
  }
  socket.emit('room:join', {
    code,
    name: state.name
  });
}

function resetHome() {
  state.view = 'home';
  state.modal = null;
  state.joinCode = '';
  window.history.replaceState(null, '', location.pathname);
  render();
}

function readSettings() {
  const form = document.querySelector('#settings-form');
  if (!form) return;
  const data = new FormData(form);
  state.roomSettings = {
    players: Number(data.get('players')),
    language: state.roomSettings.language,
    drawTime: Number(data.get('drawTime')),
    rounds: Number(data.get('rounds')),
    mode: data.get('mode'),
    wordCount: Number(data.get('wordCount')),
    hints: Number(data.get('hints')),
    customWords: data.get('customWords') || '',
    customOnly: data.get('customOnly') === 'on'
  };
}

function submitGuess() {
  const input = document.querySelector('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  socket.emit('chat:message', text);
}

function setupCanvas() {
  const canvas = document.querySelector('#drawing-board');
  if (!canvas) return;
  canvasContext = canvas.getContext('2d');
  canvas.onpointerdown = beginStroke;
  canvas.onpointermove = moveStroke;
  canvas.onpointerup = finishStroke;
  canvas.onpointerleave = finishStroke;
}

function beginStroke(event) {
  if (state.phase !== 'draw' || !isDrawer()) return;
  isDrawing = true;
  currentStroke = {
    tool: state.tool,
    color: state.tool === 'eraser' ? '#ffffff' : state.selectedColor,
    size: state.selectedSize,
    points: [canvasPoint(event)]
  };
}

function moveStroke(event) {
  if (!isDrawing || !currentStroke) return;
  currentStroke.points.push(canvasPoint(event));
  state.previewStroke = currentStroke;
  redrawCanvas();
  const now = Date.now();
  if (now - previewEmitAt > 45) {
    previewEmitAt = now;
    socket.emit('drawing:preview', currentStroke);
  }
}

function finishStroke() {
  if (!isDrawing || !currentStroke) return;
  socket.emit('drawing:commit', currentStroke);
  state.previewStroke = null;
  isDrawing = false;
  currentStroke = null;
  redrawCanvas();
}

function canvasPoint(event) {
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height
  };
}

function redrawCanvas() {
  const canvas = document.querySelector('#drawing-board');
  if (!canvasContext || !canvas) return;
  canvasContext.fillStyle = '#ffffff';
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  drawPaperTexture(canvas);
  state.strokes.forEach(drawStroke);
  if (state.previewStroke) drawStroke(state.previewStroke);
}

function drawStroke(stroke) {
  if (!canvasContext || !stroke?.points?.length) return;
  canvasContext.lineCap = 'round';
  canvasContext.lineJoin = 'round';
  canvasContext.strokeStyle = stroke.color;
  canvasContext.lineWidth = stroke.size;
  canvasContext.beginPath();
  canvasContext.moveTo(stroke.points[0].x, stroke.points[0].y);
  stroke.points.slice(1).forEach((point) => canvasContext.lineTo(point.x, point.y));
  canvasContext.stroke();
}

function drawPaperTexture(canvas) {
  canvasContext.strokeStyle = 'rgba(17, 24, 39, 0.035)';
  canvasContext.lineWidth = 1;
  for (let y = 38; y < canvas.height; y += 38) {
    canvasContext.beginPath();
    canvasContext.moveTo(0, y);
    canvasContext.lineTo(canvas.width, y);
    canvasContext.stroke();
  }
}

function isDrawer() {
  return state.drawerId === state.myId;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

if (state.joinCode) {
  state.error = `Invite detected: ${state.joinCode}. Enter a nickname and press Join Room.`;
}

render();
