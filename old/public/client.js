const socket = io();
let myPlayerId = -1;
let currentRoomId = null;
let localState = null;
let selectedHandIndex = -1;

const UI = {
    showPage(pageId) {
        document.querySelectorAll('section').forEach(el => {
            el.classList.remove('active-page');
            el.classList.add('hidden-page');
        });
        document.getElementById(pageId).classList.remove('hidden-page');
        document.getElementById(pageId).classList.add('active-page');
    },
    updateRoomCode(code) {
        const el = document.getElementById('room-code-text');
        if(el) el.innerText = code;
    },
    renderCard(card, onClick = null, isSelected = false) {
        const el = document.createElement('div');
        el.className = `card ${card.color} ${isSelected ? 'selected' : ''}`;
        el.dataset.id = card.id;
        el.innerHTML = `<div style="font-size:0.9rem; align-self:flex-start">${card.rank}</div><div style="font-size:1.5rem; align-self:center">${card.suit}</div><div style="font-size:0.9rem; align-self:flex-end; transform:rotate(180deg)">${card.rank}</div>`;
        if (onClick) el.onclick = onClick;
        return el;
    },
    renderCardBack() { const el = document.createElement('div'); el.className = 'card card-back'; return el; },

    update(state, myId, selIdx) {
        document.getElementById('deck-count').innerText = state.deckCount;
        const dPile = document.getElementById('draw-pile-visual');
        if(dPile) dPile.style.opacity = state.deckCount > 0 ? 1 : 0;

        const table = document.getElementById('face-up-area');
        table.innerHTML = '';
        state.faceUpCards.forEach(c => table.appendChild(this.renderCard(c)));

        const oppZone = document.getElementById('opponents-zone');
        oppZone.innerHTML = '';
        state.players.forEach(p => {
            if (p.id === myId) return;
            const isActive = (p.id === state.currentPlayerIdx);
            let pileHtml = '<div class="card-pile empty"></div>';
            if(p.pile.length > 0) {
                const top = p.pile[p.pile.length-1];
                pileHtml = `<div class="card-pile">${this.renderCard(top).outerHTML}<div class="pile-count">${p.pile.length}</div></div>`;
            }
            const avatar = p.isBot ? '🤖' : '👤';
            oppZone.innerHTML += `<div class="seat ${isActive?'active':''}" id="seat-${p.id}"><div class="bot-avatar">${avatar}</div><div>${p.name}</div><div style="font-size:0.7rem; color:#ccc">Cards: ${p.handCount}</div>${pileHtml}</div>`;
        });

        const p = state.players[myId];
        document.getElementById('score-display').innerText = `Score: ${p.pile.reduce((a,c)=>a+c.val,0)}`;
        document.getElementById('turn-indicator').innerText = (state.currentPlayerIdx === myId) ? "YOUR TURN" : "WAITING...";

        const myPile = document.getElementById('player-pile');
        myPile.innerHTML = '';
        if(p.pile.length > 0) {
            myPile.appendChild(this.renderCard(p.pile[p.pile.length-1]));
            myPile.innerHTML += `<div class="pile-count">${p.pile.length}</div>`;
        }

        const handDiv = document.getElementById('player-hand');
        handDiv.innerHTML = '';
        if(p.hand) {
            p.hand.forEach((c, idx) => {
                handDiv.appendChild(this.renderCard(c, () => window.dispatchEvent(new CustomEvent('card-select', { detail: idx })), idx === selIdx));
            });
        }

        const btns = ['act-draw','act-capture','act-discard'].map(id=>document.getElementById(id));
        btns.forEach(b=>b.classList.remove('visible'));
        if(state.currentPlayerIdx === myId) {
            if(state.turnPhase === 'DRAW') btns[0].classList.add('visible');
            else if (selIdx > -1) { btns[1].classList.add('visible'); btns[2].classList.add('visible'); }
        }
    },
    async animateMove(card, startEl, endEl, showBack) {
        if(!startEl || !endEl) return;
        const sRect = startEl.getBoundingClientRect();
        const eRect = endEl.getBoundingClientRect();
        const flyer = showBack ? this.renderCardBack() : this.renderCard(card);
        flyer.classList.add('flying-card');
        flyer.style.width = '75px'; flyer.style.height = '105px';
        flyer.style.left = `${sRect.left + sRect.width/2 - 37.5}px`;
        flyer.style.top = `${sRect.top + sRect.height/2 - 52.5}px`;
        document.body.appendChild(flyer);
        flyer.offsetHeight; // Reflow
        flyer.style.left = `${eRect.left + eRect.width/2 - 37.5}px`;
        flyer.style.top = `${eRect.top + eRect.height/2 - 52.5}px`;
        flyer.style.transform = 'rotate(180deg)';
        await new Promise(r => setTimeout(r, 600));
        flyer.remove();
    },
    getHandCardEl(idx) { return document.getElementById('player-hand').children[idx]; }
};

// --- EVENTS ---
window.onload = () => {
    // 1. Setup Buttons
    const el = (id) => document.getElementById(id);
    el('btn-create-room').onclick = () => {
        const config = {
            numPlayers: parseInt(el('set-players').value) || 2,
            handSize: parseInt(el('set-hand').value) || 6,
            faceUpSize: parseInt(el('set-faceup').value) || 6
        };
        socket.emit('createRoom', { playerName: el('input-name').value || "Host", config });
    };
    el('btn-join-room').onclick = () => socket.emit('joinRoom', { roomId: el('input-room-code').value.toUpperCase().trim(), playerName: el('input-name').value || "Guest" });
    el('act-draw').onclick = () => socket.emit('action', {roomId:currentRoomId, type:'DRAW'});
    el('act-discard').onclick = () => socket.emit('action', {roomId:currentRoomId, type:'DISCARD', payload:{cardIdx:selectedHandIndex}});
    el('act-capture').onclick = () => socket.emit('action', {roomId:currentRoomId, type:'CAPTURE', payload:{cardIdx:selectedHandIndex}});

    window.addEventListener('card-select', (e) => {
        if(localState && localState.currentPlayerIdx === myPlayerId && localState.turnPhase === 'PLAY') {
            selectedHandIndex = (selectedHandIndex === e.detail) ? -1 : e.detail;
            UI.update(localState, myPlayerId, selectedHandIndex);
        }
    });

    // Copy Logic
    el('room-code-display').onclick = function() {
        const txt = el('room-code-text');
        navigator.clipboard.writeText(txt.innerText);
        const old = txt.innerText; txt.innerText = "COPIED!";
        setTimeout(()=> txt.innerText = old, 1000);
    }
};

// --- SOCKETS ---
socket.on('roomJoined', (data) => {
    console.log("Room Joined:", data);
    currentRoomId = data.roomId; myPlayerId = data.playerId; localState = data.state;
    UI.updateRoomCode(currentRoomId);
    UI.showPage('page-game');
    UI.update(localState, myPlayerId, -1);
});

socket.on('stateUpdate', (s) => { localState = s; selectedHandIndex = -1; UI.update(s, myPlayerId, -1); });
socket.on('error', (msg) => alert("Error: " + msg));
socket.on('gameOver', (players) => {
    let msg = "GAME OVER!\n";
    players.forEach(p => msg += `${p.name}: ${p.pile.reduce((a,c)=>a+c.val,0)}\n`);
    alert(msg); location.reload();
});

socket.on('animation', async (data) => {
    const { type, playerId, details } = data;
    const isMe = (playerId === myPlayerId);
    if(type === 'DRAW') {
        const start = document.getElementById('draw-pile-visual');
        const end = isMe ? document.getElementById('player-hand') : document.getElementById(`seat-${playerId}`);
        await UI.animateMove(details.card, start, end, !isMe);
    } else if (type === 'DISCARD') {
        const start = isMe ? UI.getHandCardEl(selectedHandIndex) : document.getElementById(`seat-${playerId}`);
        await UI.animateMove(details.card, start, document.getElementById('face-up-area'));
    } else if (type === 'CAPTURE') {
        const pile = isMe ? document.getElementById('player-pile') : document.getElementById(`seat-${playerId}`);
        const handStart = isMe ? UI.getHandCardEl(selectedHandIndex) : document.getElementById(`seat-${playerId}`);

        let proms = [UI.animateMove(details.card, handStart, pile)];
        details.analysis.stealTargets.forEach(t => proms.push(UI.animateMove(details.card, document.getElementById(`seat-${t.id}`), pile, true)));
        details.analysis.tableMatch.forEach(c => {
             const el = document.querySelector(`#face-up-area .card[data-id="${c.id}"]`);
             if(el) proms.push(UI.animateMove(c, el, pile));
        });
        await Promise.all(proms);
    }
});