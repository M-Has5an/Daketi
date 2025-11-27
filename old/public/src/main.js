import { UI } from './ui.js';

// --- DEBUG LOGGING ---
console.log("Main.js loaded successfully");

const socket = io();

socket.on('connect', () => {
    console.log("Socket Connected! ID:", socket.id);
});

socket.on('connect_error', (err) => {
    console.error("Socket Connection Failed:", err);
    alert("Could not connect to server. Is it running?");
});

let myPlayerId = -1;
let currentRoomId = null;
let localState = null;
let selectedHandIndex = -1;

window.onload = () => {
    console.log("Window loaded, attaching events...");

    document.getElementById('btn-create-room').onclick = createRoom;
    document.getElementById('btn-join-room').onclick = joinRoom;
    document.getElementById('btn-show-rules').onclick = () => UI.showPage('page-rules');
    document.getElementById('btn-back-home').onclick = () => UI.showPage('page-landing');

    document.getElementById('act-draw').onclick = () => sendAction('DRAW');
    document.getElementById('act-discard').onclick = () => sendAction('DISCARD', { cardIdx: selectedHandIndex });
    document.getElementById('act-capture').onclick = () => sendAction('CAPTURE', { cardIdx: selectedHandIndex });
    document.getElementById('btn-inspect-pile').onclick = () => UI.showPileContents(localState.players[myPlayerId]);
    document.getElementById('btn-restart').onclick = () => location.reload();

    document.getElementById('room-code-display').onclick = function() {
        const code = this.innerText.replace('ROOM: ', '');
        navigator.clipboard.writeText(code).then(() => {
            const original = this.innerText;
            this.innerText = "COPIED!";
            this.style.color = "#27ae60";
            setTimeout(() => {
                this.innerText = original;
                this.style.color = "";
            }, 1000);
        });
    };

    window.addEventListener('card-select', (e) => {
        if(isMyTurn() && localState.turnPhase === 'PLAY') {
            selectedHandIndex = (selectedHandIndex === e.detail) ? -1 : e.detail;
            UI.updateGameState(localState, localState.currentPlayerIdx, selectedHandIndex);
        }
    });
};

function createRoom() {
    console.log("Create Room Clicked");
    const name = document.getElementById('input-name').value || "Host";
    const config = {
        numPlayers: parseInt(document.getElementById('set-players').value),
        handSize: parseInt(document.getElementById('set-hand').value),
        faceUpSize: parseInt(document.getElementById('set-faceup').value),
        stealMode: 'multi'
    };
    socket.emit('createRoom', { playerName: name, config });
}

function joinRoom() {
    console.log("Join Room Clicked");
    const name = document.getElementById('input-name').value || "Guest";
    const roomId = document.getElementById('input-room-code').value.toUpperCase().trim();
    if(roomId.length < 4) { alert("Invalid Room Code"); return; }
    socket.emit('joinRoom', { roomId, playerName: name });
}

socket.on('roomJoined', (data) => {
    console.log("Room Joined Event Received:", data);
    currentRoomId = data.roomId;
    myPlayerId = data.playerId;
    localState = data.state;

    document.getElementById('room-code-display').innerText = `ROOM: ${currentRoomId}`;
    UI.showPage('page-game');
    UI.updateGameState(localState, localState.currentPlayerIdx, -1);
});

socket.on('stateUpdate', (newState) => {
    // console.log("State Updated"); // Uncomment for spammy logs
    localState = newState;
    selectedHandIndex = -1;
    UI.updateGameState(localState, localState.currentPlayerIdx, -1);
});

socket.on('gameOver', (finalPlayers) => UI.showSummary(finalPlayers));
socket.on('error', (msg) => {
    console.error("Server Error:", msg);
    alert(msg);
});

socket.on('animation', async (data) => {
    const pid = data.playerId;
    const details = data.details;
    const type = data.type;

    if(type === 'DRAW') {
        const startEl = document.getElementById('draw-pile-visual');
        const endEl = (pid === myPlayerId) ? document.getElementById('player-hand') : UI.getBotSeatEl(pid);
        const showBack = (pid !== myPlayerId);
        await UI.animateMove(details.card, startEl, endEl, showBack);

        const name = getPlayerName(pid);
        if(pid === myPlayerId) UI.log("You drew a card");
        else UI.log(`${name} drew a card`);
    }
    else if (type === 'DISCARD') {
        const startEl = (pid === myPlayerId) ? UI.getHandCardEl(selectedHandIndex) : UI.getBotSeatEl(pid);
        const endEl = document.getElementById('face-up-area');
        await UI.animateMove(details.card, startEl, endEl);
        UI.log(`${getPlayerName(pid)} discarded`);
    }
    else if (type === 'CAPTURE') {
        const analysis = details.analysis;
        const myPileEl = UI.getPileEl(pid);
        const startEl = (pid === myPlayerId) ? UI.getHandCardEl(selectedHandIndex) : UI.getBotSeatEl(pid);

        const promises = [UI.animateMove(details.card, startEl, myPileEl)];
        analysis.stealTargets.forEach(t => {
            const victimEl = UI.getPileEl(t.id);
            promises.push(UI.animateMove(details.card, victimEl, myPileEl));
        });
        analysis.tableMatch.forEach(c => {
            const el = UI.getTableCardEl(c.id);
            if(el) promises.push(UI.animateMove(c, el, myPileEl));
        });

        await Promise.all(promises);
        if(details.extraTurn) UI.log(`${getPlayerName(pid)} gets EXTRA TURN!`);
        else UI.log(`${getPlayerName(pid)} captured cards!`);
    }
});

function sendAction(type, payload = {}) {
    socket.emit('action', { roomId: currentRoomId, type, payload });
}
function isMyTurn() { return localState && localState.currentPlayerIdx === myPlayerId; }
function getPlayerName(id) { return localState.players.find(p => p.id === id).name; }