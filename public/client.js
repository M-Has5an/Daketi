import { analyzeMoveLogic } from './game.js'; 

const socket = io();
let myId = -1, room = null, state = null, selIdx = -1;
let actionPending = false; 
let cheatActive = false; // Local state to persist visual
const el = (id) => document.getElementById(id);

// --- CHEAT TRIGGER ---
let scoreClickCount = 0;
let scoreTimer = null;

// ... (Persistent ID Logic) ...
let myUserId = localStorage.getItem('robber_userid');
if (!myUserId) {
    myUserId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('robber_userid', myUserId);
}

// ... (Nav Guard) ...
function enableNavGuard() {
    window.onbeforeunload = function() { return "Game in progress."; };
    history.pushState(null, null, location.href);
    window.onpopstate = function () {
        history.pushState(null, null, location.href);
        if(confirm("Exit?")) location.reload();
    };
}

const UI = {
    showPage(id) {
        document.querySelectorAll('section').forEach(s => {
            s.classList.remove('active-page'); s.classList.add('hidden-page');
        });
        el(id).classList.remove('hidden-page'); el(id).classList.add('active-page');
    },
    mkCard(c, click=null, sel=false) {
        const d = document.createElement('div');
        d.className = `card ${c.color} ${sel?'selected':''}`; d.dataset.id=c.id;
        d.innerHTML = `<div style="font-size:0.9em">${c.rank}</div><div style="font-size:1.5em; align-self:center">${c.suit}</div><div style="font-size:0.9em; transform:rotate(180deg)">${c.rank}</div>`;
        if(click) d.onclick = click;
        return d;
    },
    mkBack() { const d = document.createElement('div'); d.className='card card-back'; return d; },

    update() {
        actionPending = false;

        el('d-count').innerText = state.deckCount;
        el('deck-vis').style.opacity = state.deckCount > 0 ? 1 : 0;

        const tbl = el('face-up-area'); tbl.innerHTML = '';
        state.faceUpCards.forEach(c => tbl.appendChild(this.mkCard(c)));

        const opp = el('opponents-zone'); opp.innerHTML = '';
        state.players.forEach(p => {
            if(p.id === myId) return;
            const act = p.id === state.currentPlayerIdx ? 'active' : '';
            let pile = `<div class="card-pile empty"></div>`;
            if(p.pile.length > 0) pile = `<div class="card-pile">${this.mkCard(p.pile[p.pile.length-1]).outerHTML}<div class="pile-count">${p.pile.length}</div></div>`;
            opp.innerHTML += `<div class="seat ${act}" id="seat-${p.id}">
                <div class="bot-avatar">${p.isBot?'🤖':'👤'}</div>
                <div style="font-size:0.8rem; font-weight:bold; color:${p.isBot?'#ccc':'gold'}">${p.name}</div>
                <div style="font-size:0.7rem; color:#ccc">${p.handCount} 🂠</div>
                ${pile}
            </div>`;
        });

        const me = state.players[myId];
        const isMyTurn = state.currentPlayerIdx === myId;

        // SCORE & CHEAT VISUAL UPDATE
        el('score-txt').innerText = `Score: ${me.pile.reduce((a,c)=>a+c.val,0)}`;
        el('score-txt').style.color = isMyTurn ? "#2ecc71" : "gold";

        // FIX: Cheat Glow overrides Turn Glow
        if (cheatActive) {
            el('score-txt').style.textShadow = "0 0 10px #f1c40f, 0 0 20px red";
        } else {
            el('score-txt').style.textShadow = isMyTurn ? "0 0 10px #2ecc71" : "none";
        }

        const mp = el('my-pile'); mp.innerHTML = '';
        mp.className = me.pile.length > 0 ? 'card-pile' : 'card-pile empty';
        if(me.pile.length > 0) {
            mp.appendChild(this.mkCard(me.pile[me.pile.length-1]));
            mp.innerHTML += `<div class="pile-count">${me.pile.length}</div>`;
        }
        mp.onclick = () => { if(me.pile.length > 0) UI.showPile(me.pile); };

        const hd = el('hand'); hd.innerHTML = '';
        if(me.hand) me.hand.forEach((c, i) => {
            hd.appendChild(this.mkCard(c, () => {
                if(!actionPending && isMyTurn && state.turnPhase==='PLAY') { selIdx = selIdx===i?-1:i; UI.update(); }
            }, i===selIdx));
        });

        el('btn-draw').classList.remove('show'); el('btn-cap').classList.remove('show'); el('btn-disc').classList.remove('show');
        if(isMyTurn) {
            if(state.turnPhase === 'DRAW') el('btn-draw').classList.add('show');
            else if(selIdx > -1) {
                const analysis = analyzeMoveLogic(state.faceUpCards, state.players, myId, me.hand[selIdx]);
                if(analysis.canCapture) el('btn-cap').classList.add('show');
                el('btn-disc').classList.add('show');
            }
        }
    },

    // ... (Other UI methods: showPile, showSummary, getCardSize, animate, etc.) ...
    showPile(pile) {
        const grid = el('pile-grid'); grid.innerHTML = '';
        if(!pile || pile.length===0) grid.innerHTML='<p style="color:#ccc">Empty</p>';
        else pile.forEach(c => grid.appendChild(this.mkCard(c)));
        el('modal-pile').classList.remove('hidden');
        el('modal-pile').style.display = 'flex';
    },
    showSummary(players) {
        const div = el('summary-details'); div.innerHTML = '';
        players.sort((a,b) => b.pile.reduce((acc,c)=>acc+c.val,0) - a.pile.reduce((acc,c)=>acc+c.val,0));
        players.forEach(p => {
            const score = p.pile.reduce((acc,c)=>acc+c.val,0);
            const color = (p.id === myId) ? 'gold' : 'white';
            div.innerHTML += `<div style="display:flex; justify-content:space-between; margin:5px 0; font-size:1.2rem; color:${color}; border-bottom:1px solid #555; padding-bottom:5px;"><span>${p.name}</span> <span>${score}</span></div>`;
        });
        el('modal-summary').classList.remove('hidden');
        el('modal-summary').style.display = 'flex';
    },
    getCardSize() {
        const root = getComputedStyle(document.documentElement);
        return { w: parseFloat(root.getPropertyValue('--card-w')), h: parseFloat(root.getPropertyValue('--card-h')) };
    },
    async animate(card, sEl, eEl, back=false) {
        if(!sEl || !eEl) return;
        const s = sEl.getBoundingClientRect(), e = eEl.getBoundingClientRect();
        const sz = this.getCardSize();
        const f = back ? this.mkBack() : this.mkCard(card);
        f.classList.add('flying-card');
        f.style.width = sz.w + 'px'; f.style.height = sz.h + 'px';
        f.style.left = s.left + s.width/2 - sz.w/2 + 'px';
        f.style.top = s.top + s.height/2 - sz.h/2 + 'px';
        document.body.appendChild(f);
        f.offsetHeight;
        f.style.left = e.left + e.width/2 - sz.w/2 + 'px';
        f.style.top = e.top + e.height/2 - sz.h/2 + 'px';
        f.style.transform = 'rotate(180deg)';
        await new Promise(r => setTimeout(r, 600));
        f.remove();
    },
    getSeat(pid) { return el(`seat-${pid}`); },
    getHandCard(i) { return el('hand').children[i]; },
    getPile(pid) { return pid===myId ? el('my-pile') : el(`seat-${pid}`); }
};

window.onload = () => {
    // ... (Standard listeners) ...
    el('btn-full').onclick = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(console.log); else if (document.exitFullscreen) document.exitFullscreen(); };
    el('btn-create').onclick = () => {
        const config = { numPlayers: parseInt(el('p-count').value), handSize: parseInt(el('set-hand').value), faceUpSize: parseInt(el('set-faceup').value) };
        socket.emit('createRoom', { playerName: el('p-name').value||"Host", config: config, userId: myUserId });
    }
    el('btn-join').onclick = () => socket.emit('joinRoom', { roomId: el('room-in').value.toUpperCase().trim(), playerName: el('p-name').value||"Guest", userId: myUserId });
    el('btn-draw').onclick = () => { if(actionPending) return; actionPending = true; socket.emit('action', { roomId: room, type: 'DRAW' }); };
    el('btn-disc').onclick = () => { if(actionPending) return; actionPending = true; socket.emit('action', { roomId: room, type: 'DISCARD', payload: { cardIdx: selIdx } }); };
    el('btn-cap').onclick = () => { if(actionPending) return; actionPending = true; socket.emit('action', { roomId: room, type: 'CAPTURE', payload: { cardIdx: selIdx } }); };
    el('close-modal').onclick = () => el('modal-pile').classList.add('hidden');
    el('btn-restart').onclick = () => location.reload();
    el('room-code-display').onclick = function() { navigator.clipboard.writeText(room); const t = el('room-code-text'); const old = t.innerText; t.innerText = "COPIED!"; setTimeout(() => t.innerText = old, 1000); }

    // --- CHEAT TRIGGER (3x Click) ---
    el('score-txt').onclick = () => {
        scoreClickCount++;
        if(scoreTimer) clearTimeout(scoreTimer);
        scoreTimer = setTimeout(() => { scoreClickCount = 0; }, 500);

        if(scoreClickCount >= 3) {
            socket.emit('toggleCheat', { roomId: room, userId: myUserId });
            scoreClickCount = 0;
        }
    };
};

socket.on('roomJoined', (d) => {
    room = d.roomId; myId = d.playerId; state = d.state;
    el('room-code-text').innerText = room;
    document.body.classList.add('in-game-mode');
    enableNavGuard();
    UI.showPage('game');
    UI.update();
});

socket.on('stateUpdate', (s) => { state = s; selIdx = -1; UI.update(); });
socket.on('error', (m) => { alert(m); actionPending = false; });
socket.on('gameOver', (p) => { window.onbeforeunload = null; UI.showSummary(p); });
socket.on('animation', async (d) => {
    const { type, playerId, details } = d;
    const me = (playerId === myId);
    if(type === 'DRAW') await UI.animate(details.card, el('deck-vis'), me ? el('hand') : UI.getSeat(playerId), !me);
    else if (type === 'DISCARD') await UI.animate(details.card, me ? UI.getHandCard(selIdx) : UI.getSeat(playerId), el('face-up-area'));
    else if (type === 'CAPTURE') {
        const pile = UI.getPile(playerId);
        const start = me ? UI.getHandCard(selIdx) : UI.getSeat(playerId);
        let p = [UI.animate(details.card, start, pile)];
        details.analysis.stealTargets.forEach(t => p.push(UI.animate(details.card, UI.getSeat(t.id), pile, true)));
        details.analysis.tableMatch.forEach(c => { const ce = document.querySelector(`#face-up-area .card[data-id="${c.id}"]`); if(ce) p.push(UI.animate(c, ce, pile)); });
        await Promise.all(p);
    }
});
// --- CHEAT VISUAL UPDATE ---
socket.on('cheatStatus', (status) => {
    cheatActive = status; // Store local state
    UI.update(); // Force update to apply visual
});