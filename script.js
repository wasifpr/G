// --- GLOBAL VARIABLES ---
let secretNumber, low, high, p1Hp, p2Hp, currentMode, aiLevel;
let maxGuesses = 7; 
let maxRange = 100; // Locked strictly to 1-100 per your instructions
let activePlayer = 1; 
let currentGuessString = "";
let pendingManualGuess = 0; 
let isMuted = false;

// Networking Variables
let peer = null; let conn = null; let isOnline = false; let myPlayerId = 1; 

// --- PROFILE SYSTEM ---
let userProfile = JSON.parse(localStorage.getItem('numbattle_profile')) || { username: "Player", avatar: "🧑", localWins: 0, onlineWins: 0, isMuted: false };
document.getElementById('username-input').value = userProfile.username; 
document.getElementById('avatar-input').value = userProfile.avatar;
document.getElementById('stat-local-win').innerText = userProfile.localWins; 
document.getElementById('stat-online-win').innerText = userProfile.onlineWins;

isMuted = userProfile.isMuted;
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
const gameCard = document.getElementById('game-card'); const diffSelect = document.getElementById('ai-algorithm');

// --- VIRTUAL NUMPAD & DESKTOP KEYBOARD ---
function numPress(val) { 
    if(currentGuessString.length < 3) { currentGuessString += val; inputDisp.innerText = currentGuessString; playSound('guess'); } 
}
function numDel() { currentGuessString = currentGuessString.slice(0, -1); inputDisp.innerText = currentGuessString; }
function clearNumpad() { currentGuessString = ""; inputDisp.innerText = ""; }

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    let isMyTurn = isOnline ? (activePlayer === myPlayerId) : (activePlayer === 1 || currentMode === 'pvp_manual');
    let inputVisible = document.getElementById('input-controls').style.display === 'flex';
    let feedbackVisible = document.getElementById('feedback-controls').style.display === 'grid';

    if (inputVisible && isMyTurn) {
        if (e.key >= '0' && e.key <= '9') numPress(e.key);
        else if (e.key === 'Backspace') numDel();
        else if (e.key === 'Enter') document.getElementById('submit-btn').click();
    } 
    else if (feedbackVisible && isMyTurn) {
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

// --- NETWORKING ---
function generateRoomCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
const peerConfig = { config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } };

function hostOnlineGame() {
    saveProfile(); aiLevel = diffSelect.value; currentMode = document.getElementById('game-mode').value;
    const rc = generateRoomCode(); document.getElementById('my-code').innerText = rc; document.getElementById('room-code-display').style.display = 'block';
    peer = new Peer('numbattle-' + rc, peerConfig);
    peer.on('connection', (c) => {
        conn = c; setupNet(); isOnline = true; myPlayerId = 1; 
        secretNumber = Math.floor(Math.random() * maxRange) + 1; 
        // We sync the exact game mode the Host chose so the Guest's UI matches perfectly
        conn.on('open', () => { conn.send({ type: 'START', secret: secretNumber, mode: currentMode, name: userProfile.username, av: userProfile.avatar }); initGame("Connected!"); });
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
            isOnline = true; myPlayerId = 2; secretNumber = d.secret; currentMode = d.mode; // Guest locks into Host's mode
            initGame("Connected!"); document.getElementById('p1-label').innerText = `${d.av} ${d.name}`; 
            conn.send({ type: 'SYNC', name: userProfile.username, av: userProfile.avatar }); 
        } 
        else if (d.type === 'GUESS') processGuess(d.p, d.val);
        else if (d.type === 'SYNC') { document.getElementById('p2-label').innerText = `${d.av} ${d.name}`; }
        // NEW: Network pipeline for True PvP Mode
        else if (d.type === 'MANUAL_GUESS') {
            pendingManualGuess = d.val;
            activePlayer = 1; // It is now Host's turn to judge
            document.getElementById('input-controls').style.display = 'none';
            document.getElementById('feedback-controls').style.display = 'grid';
            document.querySelectorAll('.feedback-controls button').forEach(b => b.disabled = false);
            msgEl.innerHTML = `Opponent guessed <span class="highlight">${d.val}</span>.<br><b>You:</b> Is this Too High, Too Low, or Correct?`;
        }
        else if (d.type === 'MANUAL_FEEDBACK') {
            applyManualFeedback(d.fb, d.val);
        }
    });
    conn.on('close', () => { alert("Disconnected!"); location.reload(); });
}

// --- GAME LOGIC INITIALIZATION ---
function startGame() {
    saveProfile(); aiLevel = diffSelect.value;
    currentMode = document.getElementById('game-mode').value; isOnline = false; myPlayerId = 1;
    secretNumber = Math.floor(Math.random() * maxRange) + 1; // Used for PvE
    initGame("Game Started!");
}

function initGame(msg) {
    setupMenu.style.display = 'none'; onlineLobby.style.display = 'none'; controlsEl.style.display = 'flex'; statusBd.style.display = 'flex'; healthSec.style.display = 'flex'; bLog.style.display = 'block';
    low = 1; high = maxRange; p1Hp = maxGuesses; p2Hp = maxGuesses; activePlayer = 1; clearNumpad();
    
    document.getElementById('p1-label').innerText = `${userProfile.avatar} ` + (isOnline && myPlayerId !== 1 ? "Opponent" : userProfile.username);
    
    if (currentMode === 'pvp_manual') document.getElementById('p2-label').innerText = "🧑 P2 (Guesser)";
    else document.getElementById('p2-label').innerText = (isOnline && myPlayerId === 2 ? `${userProfile.avatar} YOU` : "🤖 Robot");
    
    updateUI(); 

    // Specific UI setups based on the 3 modes
    if (currentMode === 'reverse') {
        msgEl.innerHTML = `Think of a number (1-${maxRange}). I will guess it!`;
        document.getElementById('input-controls').style.display = 'none';
        document.getElementById('feedback-controls').style.display = 'grid';
        activePlayer = 2; updateUI(); setTimeout(robotTurnReverse, 1500);
    } 
    else if (currentMode === 'pvp_manual') {
        activePlayer = 2; // P2 always acts first in True PvP
        updateUI();
        if (isOnline) {
            if (myPlayerId === 1) { // Host waits
                document.getElementById('input-controls').style.display = 'none';
                document.getElementById('feedback-controls').style.display = 'none';
                msgEl.innerHTML = `<b>Game Master:</b> Think of a number (1-${maxRange}). Waiting for opponent to guess...`;
            } else { // Guest guesses
                document.getElementById('input-controls').style.display = 'flex';
                document.getElementById('feedback-controls').style.display = 'none';
                msgEl.innerHTML = `<b>Player 2:</b> You are guessing! Enter a number.`;
            }
        } else { // Local play
            document.getElementById('input-controls').style.display = 'flex';
            document.getElementById('feedback-controls').style.display = 'none';
            msgEl.innerHTML = `<b>P1:</b> Think of a number.<br><b>P2:</b> Type your first guess!`;
        }
    }
    else {
        // Standard PvE or Standard Online Auto-PvP
        msgEl.innerHTML = msg;
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
}

// --- GUESSING LOGIC ---
function handleUserGuess() {
    let g = parseInt(currentGuessString); if (isNaN(g) || g < low || g > high) return alert(`Guess between ${low} and ${high}!`);
    clearNumpad(); playSound('guess');

    // Special interception for True PvP Mode
    if (currentMode === 'pvp_manual') {
        pendingManualGuess = g;
        if (isOnline) {
            conn.send({ type: 'MANUAL_GUESS', val: g });
            document.getElementById('input-controls').style.display = 'none';
            msgEl.innerHTML = `You guessed <span class="highlight">${g}</span>. Waiting for Host to judge...`;
            return;
        } else {
            // Local Pass-and-Play
            document.getElementById('input-controls').style.display = 'none';
            document.getElementById('feedback-controls').style.display = 'grid';
            document.querySelectorAll('.feedback-controls button').forEach(b => b.disabled = false);
            activePlayer = 1; updateUI();
            msgEl.innerHTML = `P2 guessed <span class="highlight">${g}</span>.<br><b>Player 1:</b> Is this Too High, Too Low, or Correct?`;
            return;
        }
    }

    // Standard Modes
    if (isOnline) conn.send({ type: 'GUESS', p: myPlayerId, val: g }); 
    processGuess(activePlayer, g);
}

// Automatic processing for Standard Modes
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

// --- TRUE PVP & REVERSE MANUAL JUDGING ---
function manualFeedback(t) {
    document.querySelectorAll('.feedback-controls button').forEach(b => b.disabled = true);
    
    if (currentMode === 'pvp_manual') {
        if (isOnline) {
            conn.send({ type: 'MANUAL_FEEDBACK', fb: t, val: pendingManualGuess });
            document.getElementById('feedback-controls').style.display = 'none';
            msgEl.innerHTML = "Feedback sent! Waiting for opponent's next guess...";
        }
        applyManualFeedback(t, pendingManualGuess);
    } 
    else if (currentMode === 'reverse') {
        // Reverse mode logic (You judge Robot)
        if (t === 'C') { triggerWin(2); return; }
        p1Hp--; updateUI(); triggerDamage();
        if (p1Hp <= 0) { triggerDraw(); return; }
        if (t === 'H') { high = robotGuess - 1; appendLog(`Robot: ${robotGuess} (HIGH)`, 'log-p2'); } 
        else if (t === 'L') { low = robotGuess + 1; appendLog(`Robot: ${robotGuess} (LOW)`, 'log-p2'); }
        updateUI(); setTimeout(robotTurnReverse, 1000);
    }
}

// Shared logic for applying manual PvP feedback
function applyManualFeedback(t, guessVal) {
    if (t === 'C') { triggerWin(2); return; } // P2 guessed correctly!
    
    p2Hp--; updateUI(); triggerDamage();
    if (p2Hp <= 0) { triggerWin(1); return; } // EXPERT FIX: If P2 runs out of HP, P1 wins!

    if (t === 'H') { high = guessVal - 1; appendLog(`P2: ${guessVal} (HIGH)`, 'log-p2'); } 
    else if (t === 'L') { low = guessVal + 1; appendLog(`P2: ${guessVal} (LOW)`, 'log-p2'); }
    
    activePlayer = 2; // Pass turn back to guesser
    updateUI();

    // Show input pad only to the local guesser OR the online Guest
    if (!isOnline || (isOnline && myPlayerId === 2)) {
        document.getElementById('input-controls').style.display = 'flex';
        document.getElementById('feedback-controls').style.display = 'none';
        msgEl.innerHTML = `<b>Player 2:</b> Enter your next guess!`;
    }
}

// --- ADVANCED AI ENGINE ---
function getAIGuess() {
    if (aiLevel === 'easy') return Math.floor(Math.random() * (high - low + 1)) + low;
    if (aiLevel === 'normal') return Math.floor((low + high) / 2);
    if (aiLevel === 'hard') return Math.floor(low + (high - low) * 0.618);
    if (aiLevel === 'expert') {
        let dyn = 0.3 + (Math.random() * 0.4); 
        let g = Math.floor(low + (high - low) * dyn);
        if (g <= low && low !== high) return low + 1; if (g >= high && low !== high) return high - 1;
        return g;
    }
    return Math.floor((low + high) / 2);
}

function robotTurn() {
    if (p2Hp <= 0) { activePlayer = 1; updateUI(); return; }
    document.getElementById('emoji-display').innerText = '🧠'; 
    setTimeout(() => { let g = getAIGuess(); if (g < low) g = low; if (g > high) g = high; processGuess(2, g); }, 1000); 
}

function robotTurnReverse() {
    if(low > high) { msgEl.innerHTML = "Hints crossed! You broke me!"; triggerDamage(); return; }
    robotGuess = getAIGuess(); if (robotGuess < low) robotGuess = low; if (robotGuess > high) robotGuess = high;
    document.getElementById('emoji-display').innerText = '🤔';
    msgEl.innerHTML = `Is your number <span class="highlight">${robotGuess}</span>?`;
    document.querySelectorAll('.feedback-controls button').forEach(b => b.disabled = false);
}

// --- GAME OVER ---
function triggerWin(id) { 
    playSound('win');
    let w = id === 1 ? "Player 1" : "Player 2";
    if (currentMode === 'reverse' || currentMode === 'pve') w = id === 1 ? "Player 1" : "Robot";
    if (isOnline && id === myPlayerId) w = "YOU";
    
    msgEl.innerHTML = `<b>${w} WINS!</b>`; document.getElementById('emoji-display').innerText = '🎉';
    if (id === 1 && currentMode !== 'pvp_manual') userProfile.localWins++; 
    if (isOnline && id === myPlayerId) userProfile.onlineWins++; 
    saveProfile(); startConfetti(); endGame(); 
}
function triggerDraw() { playSound('error'); document.getElementById('emoji-display').innerText = '☠️'; msgEl.innerHTML = `Health depleted. Game Over.`; endGame(); }
function endGame() { document.getElementById('input-controls').style.display = 'none'; document.getElementById('feedback-controls').style.display = 'none'; document.getElementById('menu-btn').style.display = 'block'; }

// --- CONFETTI ANIMATION ---
const canvas = document.getElementById("confetti"); const ctx = canvas.getContext("2d");
let particles = []; let confettiActive = false;
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener("resize", resizeCanvas); resizeCanvas();
function startConfetti() { confettiActive = true; particles = []; for(let i=0; i<100; i++) particles.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height-canvas.height, r: Math.random()*6+4, dx: Math.random()*4-2, dy: Math.random()*5+2, color: `hsl(${Math.random()*360}, 100%, 50%)`, tilt: Math.random()*10-10 }); requestAnimationFrame(drawConfetti); setTimeout(() => confettiActive=false, 4000); }
function drawConfetti() { ctx.clearRect(0,0,canvas.width,canvas.height); let active=0; particles.forEach((p) => { p.y+=p.dy; p.x+=p.dx; p.tilt+=0.1; if(p.y<canvas.height) active++; ctx.beginPath(); ctx.lineWidth=p.r; ctx.strokeStyle=p.color; ctx.moveTo(p.x+p.tilt+p.r, p.y); ctx.lineTo(p.x+p.tilt, p.y+p.tilt+p.r); ctx.stroke(); }); if(active>0 || confettiActive) requestAnimationFrame(drawConfetti); else ctx.clearRect(0,0,canvas.width,canvas.height); }
