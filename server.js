import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

// --- GAME LOGIC ---
const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const VALUES = {'2':5,'3':5,'4':5,'5':5,'6':5,'7':5,'8':5,'9':5,'10':5,'J':10,'Q':10,'K':10,'A':20};

class Card {
    constructor(rank, suit) {
        this.rank = rank; this.suit = suit; this.val = VALUES[rank];
        this.color = (suit === '♥' || suit === '♦') ? 'red' : 'black';
        this.id = Math.random().toString(36).substr(2, 9);
    }
}

class Player {
    constructor(id, name, isBot) {
        this.id = id; this.name = name; this.isBot = isBot;
        this.hand = []; this.pile = [];
        this.socketId = null; this.userId = null;
        this.isCheater = false;
    }
}

class Game {
    constructor(config) {
        this.numPlayers = Number(config.numPlayers) || 2;
        this.handSize = Number(config.handSize) || 6;
        this.faceUpSize = Number(config.faceUpSize) || 6;
        this.deck = []; this.faceUpCards = []; this.players = [];
        this.currentPlayerIdx = 0; this.turnPhase = 'DRAW';
    }

    init() {
        let d = [];
        for(let s of SUITS) for(let r of RANKS) d.push(new Card(r, s));
        for (let i = d.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [d[i], d[j]] = [d[j], d[i]];
        }
        this.deck = d;
        this.players = [];
        for(let i=0; i<this.numPlayers; i++) this.players.push(new Player(i, `Bot ${i}`, true));
        for(let i=0; i<this.handSize; i++) this.players.forEach(p => { if(this.deck.length) p.hand.push(this.deck.pop()); });
        for(let i=0; i<this.faceUpSize; i++) if(this.deck.length) this.faceUpCards.push(this.deck.pop());
    }

    getPublicState(forPlayerId) {
        return {
            deckCount: this.deck.length,
            faceUpCards: this.faceUpCards,
            currentPlayerIdx: this.currentPlayerIdx,
            turnPhase: this.turnPhase,
            players: this.players.map(p => ({
                id: p.id, name: p.name, isBot: p.isBot, pile: p.pile, handCount: p.hand.length,
                hand: (p.id === forPlayerId) ? p.hand : null
            }))
        };
    }

    // --- RIGGED DRAW LOGIC ---
    performDraw(pid) {
        if (this.turnPhase !== 'DRAW') return null;
        if (this.deck.length === 0) return null;

        const player = this.players[pid];
        let card;

        // Priority: Cheat for Cheater -> Sabotage for Opponent -> Random
        if (player.isCheater) {
            card = this.findBestCard(pid);
            console.log(`[CHEAT] Giving ${player.name} best card: ${card.rank}${card.suit}`);
        }
        else if (this.hasCheaterInRoom()) {
            const cheater = this.players.find(p => p.isCheater);
            card = this.findSabotageCard(pid, cheater.id);
        }
        else {
            card = this.deck.pop();
        }

        player.hand.push(card);
        this.turnPhase = 'PLAY';
        return { animDetails: { card } };
    }

    // Helper: Calculate value of ANY card (from deck or hand)
    analyzeCard(pid, card) {
        const p = this.players[pid];
        let result = { canCapture: false, stealTargets: [], tableMatch: [], selfMatch: false };

        this.players.forEach(opp => {
            if (opp.id === pid || opp.pile.length === 0) return;
            if (opp.pile[opp.pile.length-1].rank === card.rank) {
                let steal = [];
                for(let k=opp.pile.length-1; k>=0; k--) {
                    if(opp.pile[k].rank === card.rank) steal.push(opp.pile[k]); else break;
                }
                result.stealTargets.push({ id: opp.id, cards: steal });
            }
        });

        const tbl = this.faceUpCards.filter(c => c.rank === card.rank);
        if(tbl.length > 0) result.tableMatch = tbl;
        if(p.pile.length > 0 && p.pile[p.pile.length-1].rank === card.rank) result.selfMatch = true;

        if(result.stealTargets.length > 0 || result.tableMatch.length > 0 || result.selfMatch) result.canCapture = true;
        return result;
    }

    findBestCard(pid) {
        let bestIndex = this.deck.length - 1; // Default to top card
        let maxScore = -Infinity;

        this.deck.forEach((c, index) => {
            let score = c.val; // Base value
            const analysis = this.analyzeCard(pid, c);

            // 1. Steal is KING (Massive points)
            if (analysis.stealTargets.length > 0) {
                let stealCount = 0;
                analysis.stealTargets.forEach(t => stealCount += t.cards.length);
                score += 1000 + (stealCount * 50);
            }
            // 2. Self Match (Safety)
            if (analysis.selfMatch) score += 500;
            // 3. Table Match
            if (analysis.tableMatch.length > 0) score += 200 + (analysis.tableMatch.length * 20);

            if (score > maxScore) {
                maxScore = score;
                bestIndex = index;
            }
        });

        return this.deck.splice(bestIndex, 1)[0];
    }

    findSabotageCard(opponentId, cheaterId) {
        // Give opponent the WORST card possible (minimize damage to cheater)
        let bestIndex = this.deck.length - 1;
        let maxSafetyScore = -Infinity;

        const cheater = this.players[cheaterId];
        const opponent = this.players[opponentId];

        this.deck.forEach((c, index) => {
            let safety = 0;

            // Avoid matching Cheater's pile
            if (cheater.pile.length > 0 && c.rank === cheater.pile[cheater.pile.length-1].rank) safety -= 5000;

            // Avoid helping Opponent build
            if (opponent.pile.length > 0 && c.rank === opponent.pile[opponent.pile.length-1].rank) safety -= 1000;

            // Avoid Table matches (giving free points)
            if (this.faceUpCards.some(fc => fc.rank === c.rank)) safety -= 200;

            // Prefer low value cards
            safety -= c.val;

            if (safety > maxSafetyScore) {
                maxSafetyScore = safety;
                bestIndex = index;
            }
        });

        return this.deck.splice(bestIndex, 1)[0];
    }

    hasCheaterInRoom() { return this.players.some(p => p.isCheater); }

    // --- STANDARD ACTIONS ---
    performDiscard(pid, cardIdx) {
        if (this.turnPhase !== 'PLAY') return null;
        const p = this.players[pid];
        if(!p.hand[cardIdx]) return null;
        const card = p.hand.splice(cardIdx, 1)[0];
        this.faceUpCards.push(card);
        this.endTurn();
        return { animDetails: { card } };
    }

    performCapture(pid, cardIdx) {
        if (this.turnPhase !== 'PLAY') return null;
        const p = this.players[pid];
        if(!p.hand[cardIdx]) return null;
        const card = p.hand[cardIdx];

        // Use shared helper
        const analysis = this.analyzeCard(pid, card);
        if(!analysis.canCapture) return null;

        p.hand.splice(cardIdx, 1);
        analysis.stealTargets.forEach(t => {
            const opp = this.players[t.id];
            const stolen = opp.pile.splice(opp.pile.length - t.cards.length, t.cards.length);
            p.pile.push(...stolen);
        });
        if(analysis.tableMatch.length > 0) {
            const ids = analysis.tableMatch.map(c => c.id);
            this.faceUpCards = this.faceUpCards.filter(c => !ids.includes(c.id));
            p.pile.push(...analysis.tableMatch);
        }
        p.pile.push(card);

        if(this.deck.length > 0) {
            this.turnPhase = 'DRAW';
            return { animDetails: { card, analysis, extraTurn: true } };
        } else {
            this.endTurn();
            return { animDetails: { card, analysis, extraTurn: false } };
        }
    }

    endTurn() {
        this.currentPlayerIdx = (this.currentPlayerIdx + 1) % this.players.length;
        this.turnPhase = (this.deck.length > 0) ? 'DRAW' : 'PLAY';
    }

    isGameOver() { return this.deck.length === 0 && this.players.every(p => p.hand.length === 0); }

    calculateBotMove(pid) {
        if(this.turnPhase === 'DRAW') return { type: 'DRAW', ...this.performDraw(pid) };
        const bot = this.players[pid];
        let best = { idx: 0, priority: 0 };
        for(let i=0; i<bot.hand.length; i++) {
            const an = this.analyzeCard(pid, bot.hand[i]);
            let prio = 1;
            if(an.canCapture) prio = 5 + an.stealTargets.length + (an.tableMatch.length ? 2 : 0) + (an.selfMatch ? 1 : 0);
            if(prio > best.priority) best = { idx: i, priority: prio };
        }
        if(best.priority > 1) return { type: 'CAPTURE', ...this.performCapture(pid, best.idx) };
        return { type: 'DISCARD', ...this.performDiscard(pid, 0) };
    }
}

// --- EVENTS ---
const rooms = {};

io.on('connection', (socket) => {
    console.log(`[NET] Connected: ${socket.id}`);

    socket.on('createRoom', ({ playerName, config, userId }) => {
        try {
            const roomId = Math.random().toString(36).substr(2, 4).toUpperCase();
            socket.join(roomId);
            const game = new Game(config || {});
            game.init();

            game.players[0].name = playerName || "Host";
            game.players[0].socketId = socket.id;
            game.players[0].userId = userId;
            game.players[0].isBot = false;

            rooms[roomId] = game;
            socket.roomId = roomId;
            socket.emit('roomJoined', { roomId, playerId: 0, state: game.getPublicState(0) });
        } catch(e) { console.error(e); }
    });

    socket.on('joinRoom', ({ roomId, playerName, userId }) => {
        const game = rooms[roomId];
        if (!game) { socket.emit('error', 'Room Not Found'); return; }

        const existing = game.players.find(p => p.userId === userId);
        if (existing) {
            socket.join(roomId);
            socket.roomId = roomId;
            existing.socketId = socket.id;
            existing.isBot = false;
            broadcastState(roomId, game);
            socket.emit('roomJoined', { roomId, playerId: existing.id, state: game.getPublicState(existing.id) });
            // Re-send cheat status if they disconnected
            socket.emit('cheatStatus', existing.isCheater);
            return;
        }

        const emptySlot = game.players.find(p => p.isBot);
        if (emptySlot) {
            socket.join(roomId);
            socket.roomId = roomId;
            emptySlot.name = playerName || "Guest";
            emptySlot.socketId = socket.id;
            emptySlot.userId = userId;
            emptySlot.isBot = false;
            broadcastState(roomId, game);
            socket.emit('roomJoined', { roomId, playerId: emptySlot.id, state: game.getPublicState(emptySlot.id) });
        } else {
            socket.emit('error', 'Room Full');
        }
    });

    socket.on('toggleCheat', ({ roomId, userId }) => {
        const game = rooms[roomId];
        if(game) {
            const p = game.players.find(pl => pl.userId === userId);
            if(p) {
                p.isCheater = !p.isCheater;
                socket.emit('cheatStatus', p.isCheater);
            }
        }
    });

    socket.on('action', ({ roomId, type, payload }) => {
        const game = rooms[roomId];
        if (!game) return;
        const player = game.players.find(p => p.socketId === socket.id);
        if (!player || game.currentPlayerIdx !== player.id) return;

        let result = null;
        try {
            if (type === 'DRAW') result = game.performDraw(player.id);
            else if (type === 'DISCARD') result = game.performDiscard(player.id, payload.cardIdx);
            else if (type === 'CAPTURE') result = game.performCapture(player.id, payload.cardIdx);

            if (result) {
                io.to(roomId).emit('animation', { type, playerId: player.id, details: result.animDetails });
                setTimeout(() => {
                    if(game.isGameOver()) io.to(roomId).emit('gameOver', game.players);
                    else {
                        broadcastState(roomId, game);
                        checkBotTurn(roomId, game);
                    }
                }, 1000);
            }
        } catch(e) { console.error(e); }
    });

    socket.on('disconnect', () => {
        if(socket.roomId && rooms[socket.roomId]) {
            const game = rooms[socket.roomId];
            const player = game.players.find(p => p.socketId === socket.id);
            if(player) {
                player.socketId = null;
                player.isBot = true;
                broadcastState(socket.roomId, game);
                if(game.currentPlayerIdx === player.id) checkBotTurn(socket.roomId, game);
            }
        }
    });
});

function broadcastState(roomId, game) {
    const sockets = io.sockets.adapter.rooms.get(roomId);
    if(sockets) {
        for (const socketId of sockets) {
            const player = game.players.find(p => p.socketId === socketId);
            if(player) io.to(socketId).emit('stateUpdate', game.getPublicState(player.id));
        }
    }
}

function checkBotTurn(roomId, game) {
    const currentPlayer = game.players[game.currentPlayerIdx];
    if (currentPlayer && currentPlayer.isBot) {
        setTimeout(() => {
            const botMove = game.calculateBotMove(currentPlayer.id);
            if(botMove) {
                io.to(roomId).emit('animation', { type: botMove.type, playerId: currentPlayer.id, details: botMove.animDetails });
                setTimeout(() => {
                    if(game.isGameOver()) io.to(roomId).emit('gameOver', game.players);
                    else {
                        broadcastState(roomId, game);
                        checkBotTurn(roomId, game);
                    }
                }, 1200);
            }
        }, 1000);
    }
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`SERVER RUNNING at http://localhost:${PORT}`));