// --- GLOBAL VARIABLES ---
let secretNumber, low, high, p1Hp, p2Hp, currentMode, aiLevel;
let maxGuesses = 7; let maxRange = 100; let activePlayer = 1; let currentGuessString = "";

// Networking Variables
let peer = null; let conn = null; let isOnline = false; let myPlayerId = 1; 

// --- PROFILE SYSTEM & SAVED MUTE ---
let userProfile = JSON.parse(localStorage.getItem('numbattle_profile')) || { username: "Player", avatar: "🧑", localWins: 0, onlineWins: 0, isMuted: false };
document.getElementById('username-input').value = userProfile.username; 
document.getElementById('avatar-input').value = userProfile.avatar;
document.getElementById('stat-local-win').innerText = userProfile.localWins; 
document.getElementById('stat-online-win').innerText = userProfile.onlineWins;

let isMuted = userProfile.isMuted;
document.getElementById('mute-btn').innerText = isMuted ? '🔇' : '🔊';

function saveProfile() {
    userProfile.username = document.getElementById('username-input').value.trim() || "Player";
    userProfile.avatar = document.getElementById('avatar-input').value;
    userProfile.isMuted = isMuted;
    localStorage.setItem('numbattle_profile', JSON.stringify(userProfile));
}

// --- AUDIO ENGINE ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function toggleMute() { isMuted = !isMuted; document.getElementById('mute-btn').innerText = isMuted ? '🔇' : '🔊'; saveProfile(); }
function playSound(type) {
    if (isMuted) return; if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    if (type === 'guess') { osc.type = 'square'; osc.frequency.setValueAtTime(300, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.1); gain.gain.setValueAtTime(0.05, audioCtx.currentTime); osc.start(); osc.stop(audioCtx.currentTime + 0.1); } 
    else if (type === 'error') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.5); gain.gain.setValueAtTime(0.1, audioCtx.currentTime); osc.start(); osc.stop(audioCtx.currentTime + 0.5); }
    else if (type === 'win') { osc.type = 'sine'; osc.frequency.setValueAtTime(400, audioCtx.currentTime); osc.frequency.setValueAtTime(600, audioCtx.currentTime + 0.1); osc.frequency.setValueAtTime(800, audioCtx.currentTime + 0.2); gain.gain.setValueAtTime(0.1, audioCtx.currentTime); osc.start(); osc.stop(audioCtx.currentTime + 0.4); }
}

// --- DOM ELEMENTS ---
const msgEl = document.getElementById('message'); const setupMenu = document.getElementById('setup-menu');
const onlineLobby = document.getElementById('online-lobby'); const controlsEl = document.getElementById('controls');
const healthSec = document.getElementById('health-section'); const statusBd = document.getElementById('status-board');
const bLog = document.getElementById('battle-log'); const inputDisp = document.getElementById('user-input-display');
const gameCard = document.getElementById('game-card'); const diffSelect = document.getElementById('difficulty');

// --- HACKER URL CIPHER ---
function encodeSecretInURL(targetNumber) {
    let date = new Date(); let lastDigit = date.getMinutes() % 10; 
    let cipherText = targetNumber + "" + lastDigit; 
    window.history.replaceState(null, '', `?cache=${cipherText}`);
}

// --- VIRTUAL NUMPAD & DESKTOP KEYBOARD ---
function numPress(val) { 
    if(currentGuessString.length < 4) { currentGuessString += val; inputDisp.innerText = currentGuessString; playSound('guess'); } 
}
function numDel() { currentGuessString = currentGuessString.slice(0, -1); inputDisp.innerText = currentGuessString; }
function clearNumpad() { currentGuessString = ""; inputDisp.innerText = ""; }

// Desktop Keyboard Listener
document.addEventListener('keydown', (e) => {
    // Ignore keypresses if user is typing their username or a room code
    if (e.target.tagName === 'INPUT') return;
    
    let isMyTurn = isOnline ? (activePlayer === myPlayerId) : (activePlayer === 1 || currentMode === 'pvp');
    let inputControlsVisible = document.getElementById('input-controls').style.display === 'flex';
    let feedbackVisible = document.getElementById('feedback-controls').style.display === 'grid';

    if (inputControlsVisible && isMyTurn) {
        if (e.key >= '0' && e.key <= '9') numPress(e.key);
        else if (e.key === 'Backspace') numDel();
        else if (e.key === 'Enter') document.getElementById('submit-btn').click();
    } 
    else if (feedbackVisible) {
        if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'h') manualFeedback('H');
        else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 'l') manualFeedback('L');
        else if (e.key === 'Enter' || e.key.toLowerCase() === 'c') manualFeedback('C');
    }
});

// --- UI HELPERS ---
function triggerDamage() { playSound('error'); gameCard.classList.remove('shake'); void gameCard.offsetWidth; gameCard.classList.add('shake'); document.body.classList.add('damage-flash'); setTimeout(() => document.body.classList.remove('damage-flash'), 150); }
function appendLog(txt, cls) { const el = document.createElement('div'); el.className = `log-entry ${cls}`; el.innerHTML = `> ${txt}`; bLog.appendChild(el); bLog.scrollTop = bLog.scrollHeight; }
function showOnlineLobby() { setupMenu.style.display = 'none'; onlineLobby.style.display = 'flex'; msgEl.innerHTML = "Host or Join!"; }
function cancelOnline() { if(peer) peer.destroy(); onlineLobby.style.display = 'none'; setupMenu.style.display = 'flex'; }

// --- NETWORKING WITH GRACEFUL RECONNECT ---
function generateRoomCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
const peerConfig = { config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } };

function hostOnlineGame() {
    saveProfile(); setDifficulty(); const rc = generateRoomCode(); document.getElementById('my-code').innerText = rc; document.getElementById('room-code-display').style.display = 'block';
    peer = new Peer('numbattle-' + rc, peerConfig);
    peer.on('connection', (c) => {
        conn = c; setupNet(); isOnline = true; currentMode = 'online'; myPlayerId = 1; 
        secretNumber = Math.floor(Math.random() * maxRange) + 1; encodeSecretInURL(secretNumber);
        conn.on('open', () => { conn.send({ type: 'START', secret: secretNumber, max: maxRange, hp: maxGuesses, name: userProfile.username, av: userProfile.avatar }); initGame("Connected!"); });
    });
}

function joinOnlineGame() {
    saveProfile(); let code = document.getElementById('join-code').value.toUpperCase(); if(code.length !== 4) return alert("Invalid Code");
    msgEl.innerHTML = "Connecting..."; peer = new Peer(null, peerConfig); 
    peer.on('open', () => { conn = peer.connect('numbattle-' + code); setupNet(); });
}

function setupNet() {
    conn.on('data', (d) => {
        if (d.type === 'START') { 
            isOnline = true; currentMode = 'online'; myPlayerId = 2; secretNumber = d.secret; maxRange = d.max; maxGuesses = d.hp; 
            initGame("Connected!"); document.getElementById('p1-label').innerText = `${d.av} ${d.name}`; 
            conn.send({ type: 'SYNC', name: userProfile.username, av: userProfile.avatar }); 
        } 
        else if (d.type === 'GUESS') processGuess(d.p, d.val);
        else if (d.type === 'SYNC') { document.getElementById('p2-label').innerText = `${d.av} ${d.name}`; }
    });
    
    // Graceful Reconnect Timer
    conn.on('close', () => { 
        document.getElementById('input-controls').style.display = 'none';
        let countdown = 10;
        let reconTimer = setInterval(() => {
            countdown--;
            if(conn.open) {
                clearInterval(reconTimer);
                msgEl.innerHTML = "Reconnected! Resuming game.";
                updateUI(); // restores the input controls based on turn
            } else if (countdown <= 0) {
                clearInterval(reconTimer);
                alert("Opponent permanently disconnected!");
                location.reload();
            } else {
                msgEl.innerHTML = `⚠️ Connection lost! Waiting ${countdown}s for opponent...`;
            }
        }, 1000);
    });
}

// --- GAME LOGIC ---
function setDifficulty() {
    aiLevel = diffSelect.value;
    if (aiLevel === 'easy') { maxRange = 50; maxGuesses = 6; }
    else if (aiLevel === 'normal') { maxRange = 100; maxGuesses = 7; }
    else if (aiLevel === 'hard') { maxRange = 500; maxGuesses = 10; }
    else if (aiLevel === 'expert') { maxRange = 1000; maxGuesses = 12; }
}

function startGame() {
    saveProfile(); setDifficulty();
    currentMode = document.getElementById('game-mode').value; isOnline = false; myPlayerId = 1;
    secretNumber = Math.floor(Math.random() * maxRange) + 1;
    if(currentMode !== 'reverse') encodeSecretInURL(secretNumber);
    initGame(currentMode === 'reverse' ? `Think of a number (1-${maxRange}). I will guess it!` : "Game Started!");
}

function initGame(msg) {
    setupMenu.style.display = 'none'; onlineLobby.style.display = 'none'; controlsEl.style.display = 'flex'; statusBd.style.display = 'flex'; healthSec.style.display = 'flex'; bLog.style.display = 'block';
    low = 1; high = maxRange; p1Hp = maxGuesses; p2Hp = maxGuesses; activePlayer = 1; clearNumpad();
    
    document.getElementById('p1-label').innerText = `${userProfile.avatar} ` + (isOnline && myPlayerId !== 1 ? "Opponent" : userProfile.username);
    document.getElementById('p2-label').innerText = currentMode === 'pvp' ? "🧑 P2" : (isOnline && myPlayerId === 2 ? `${userProfile.avatar} YOU` : "🤖 Robot");
    
    updateUI(); msgEl.innerHTML = msg;

    if (currentMode === 'reverse') {
        document.getElementById('input-controls').style.display = 'none';
        document.getElementById('feedback-controls').style.display = 'grid';
        activePlayer = 2; updateUI(); setTimeout(robotTurnReverse, 1500);
    } else {
        document.getElementById('input-controls').style.display = 'flex';
        document.getElementById('feedback-controls').style.display = 'none';
    }
}

function updateUI() {
    document.getElementById('min-display').innerText = low; document.getElementById('max-display').innerText = high;
    document.getElementById('p1-hp-text').innerText = p1Hp; document.getElementById('p2-hp-text').innerText = p2Hp;
    document.getElementById('p1-hp-bar').style.width = `${(p1Hp/maxGuesses)*100}%`; document.getElementById('p2-hp-bar').style.width = `${(p2Hp/maxGuesses)*100}%`;
    
    document.getElementById('p1-box').classList.remove('active-turn'); document.getElementById('p2-box').classList.remove('active-turn');
    if (activePlayer === 1) document.getElementById('p1-box').classList.add('active-turn'); else document.getElementById('p2-box').classList.add('active-turn');
    
    let isMyTurn = isOnline ? (activePlayer === myPlayerId) : (activePlayer === 1 || currentMode === 'pvp');
    document.querySelectorAll('.numpad button').forEach(b => b.disabled = !isMyTurn);
    
    if (currentMode !== 'reverse') {
        document.getElementById('input-controls').style.display = 'flex';
    }
}

function handleUserGuess() {
    let g = parseInt(currentGuessString); if (isNaN(g) || g < low || g > high) return alert(`Guess between ${low} and ${high}!`);
    clearNumpad(); if (isOnline) conn.send({ type: 'GUESS', p: myPlayerId, val: g }); processGuess(activePlayer, g);
}

function processGuess(p, g) {
    let n = p === 1 ? "P1" : "P2";
    if (g === secretNumber) { triggerWin(p); return; }
    if (p === 1) p1Hp--; else p2Hp--;
    updateUI(); triggerDamage();
    if (p1Hp <= 0 && p2Hp <= 0) { triggerDraw(); return; }

    if (g > secretNumber) { high = g - 1; msgEl.innerHTML = `${n} guessed ${g}. <b>TOO HIGH!</b>`; appendLog(`${n}: ${g} (HIGH)`, 'log-p1'); } 
    else { low = g + 1; msgEl.innerHTML = `${n} guessed ${g}. <b>TOO LOW!</b>`; appendLog(`${n}: ${g} (LOW)`, 'log-p1'); }
    
    activePlayer = activePlayer === 1 ? 2 : 1;
    if (activePlayer === 1 && p1Hp <= 0) activePlayer = 2; if (activePlayer === 2 && p2Hp <= 0) activePlayer = 1;
    updateUI(); if (currentMode === 'pve' && activePlayer === 2) setTimeout(robotTurn, 1000); 
}

// --- ADVANCED AI ENGINE ---
function getAIGuess() {
    if (aiLevel === 'easy') return Math.floor(Math.random() * (high - low + 1)) + low;
    if (aiLevel === 'normal') return Math.floor((low + high) / 2);
    if (aiLevel === 'hard') return Math.floor(low + (high - low) * 0.618);
    if (aiLevel === 'expert') {
        let dyn = 0.3 + (Math.random() * 0.4); 
        let g = Math.floor(low + (high - low) * dyn);
        if (g <= low && low !== high) return low + 1;
        if (g >= high && low !== high) return high - 1;
        return g;
    }
    return Math.floor((low + high) / 2);
}

function robotTurn() {
    if (p2Hp <= 0) { activePlayer = 1; updateUI(); return; }
    document.getElementById('emoji-display').innerText = '🧠'; 
    setTimeout(() => { 
        let g = getAIGuess();
        if (g < low) g = low; if (g > high) g = high; 
        processGuess(2, g); 
    }, 1000); 
}

// --- REVERSE MODE (YOU JUDGE) ---
let robotGuess = 0;
function robotTurnReverse() {
    if(low > high) { msgEl.innerHTML = "Hints crossed! You broke me!"; triggerDamage(); return; }
    robotGuess = getAIGuess();
    if (robotGuess < low) robotGuess = low; if (robotGuess > high) robotGuess = high;
    document.getElementById('emoji-display').innerText = '🤔';
    msgEl.innerHTML = `Is your number <span class="highlight">${robotGuess}</span>?`;
    document.querySelectorAll('.feedback-controls button').forEach(b => b.disabled = false);
}

function manualFeedback(t) {
    document.querySelectorAll('.feedback-controls button').forEach(b => b.disabled = true);
    if (t === 'C') { triggerWin(2); return; }
    p1Hp--; updateUI(); triggerDamage();
    if (p1Hp <= 0) { triggerDraw(); return; }
    if (t === 'H') { high = robotGuess - 1; appendLog(`Robot: ${robotGuess} (HIGH)`, 'log-p2'); } 
    else if (t === 'L') { low = robotGuess + 1; appendLog(`Robot: ${robotGuess} (LOW)`, 'log-p2'); }
    updateUI(); setTimeout(robotTurnReverse, 1000);
}

function triggerWin(id) { 
    playSound('win');
    let w = id === 1 ? "Player 1" : (currentMode === 'reverse' || currentMode === 'pve' ? "Robot" : "Player 2");
    if (isOnline && id === myPlayerId) w = "YOU";
    msgEl.innerHTML = `<b>${w} WINS!</b>`; document.getElementById('emoji-display').innerText = '🎉';
    if (id === 1) userProfile.localWins++; if (isOnline && id === myPlayerId) userProfile.onlineWins++; saveProfile(); 
    startConfetti(); endGame(); 
    window.history.replaceState(null, '', window.location.pathname); 
}
function triggerDraw() { playSound('error'); document.getElementById('emoji-display').innerText = '☠️'; msgEl.innerHTML = `Health depleted.`; endGame(); window.history.replaceState(null, '', window.location.pathname); }
function endGame() { document.getElementById('input-controls').style.display = 'none'; document.getElementById('feedback-controls').style.display = 'none'; document.getElementById('menu-btn').style.display = 'block'; }

// --- CONFETTI ANIMATION ---
const canvas = document.getElementById("confetti"); const ctx = canvas.getContext("2d");
let particles = []; let confettiActive = false;
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener("resize", resizeCanvas); resizeCanvas();
function startConfetti() {
    confettiActive = true; particles = [];
    for(let i=0; i<100; i++) particles.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height-canvas.height, r: Math.random()*6+4, dx: Math.random()*4-2, dy: Math.random()*5+2, color: `hsl(${Math.random()*360}, 100%, 50%)`, tilt: Math.random()*10-10 });
    requestAnimationFrame(drawConfetti); setTimeout(() => confettiActive=false, 4000);
}
function drawConfetti() {
    ctx.clearRect(0,0,canvas.width,canvas.height); let active=0;
    particles.forEach((p) => { p.y+=p.dy; p.x+=p.dx; p.tilt+=0.1; if(p.y<canvas.height) active++; ctx.beginPath(); ctx.lineWidth=p.r; ctx.strokeStyle=p.color; ctx.moveTo(p.x+p.tilt+p.r, p.y); ctx.lineTo(p.x+p.tilt, p.y+p.tilt+p.r); ctx.stroke(); });
    if(active>0 || confettiActive) requestAnimationFrame(drawConfetti); else ctx.clearRect(0,0,canvas.width,canvas.height);
}
