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
        this.isCheater = false; // Hidden switch
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

        // 1. CHEAT MODE: Giving cards to the Cheater (Maximize Benefit)
        if (player.isCheater) {
            card = this.findBestCard(pid);
        } 
        // 2. SABOTAGE MODE: Giving cards to Opponents (Minimize Cheater's Loss)
        else if (this.hasCheaterInRoom()) {
            // Only rig if there is a cheater to protect
            const cheaterId = this.players.find(p => p.isCheater).id;
            card = this.findSabotageCard(pid, cheaterId);
        } 
        // 3. NORMAL MODE
        else {
            card = this.deck.pop();
        }

        player.hand.push(card);
        this.turnPhase = 'PLAY';
        return { animDetails: { card } };
    }

    // Find the perfect card for the cheater
    findBestCard(pid) {
        let bestIndex = this.deck.length - 1;
        let maxScore = -Infinity;

        this.deck.forEach((c, index) => {
            // Base score: Value of card (prefer Aces/Faces)
            let score = c.val; 

            // Check Matches using game logic
            const analysis = this.analyzeMoveLogic(pid, c);

            // Priority 1: STEAL (Massive points + Deny opponent)
            if (analysis.stealTargets.length > 0) {
                // Calculate points gained from steal
                let stealPoints = 0;
                analysis.stealTargets.forEach(t => {
                    const victim = this.players[t.id];
                    // Heuristic: Stealing a big pile is better
                    stealPoints += (victim.pile.length * 5); 
                });
                score += 1000 + stealPoints;
            }

            // Priority 2: SELF BUILD (Defense - Lock 4th card)
            if (analysis.selfMatch) {
                // If I have 3 cards of this rank, getting the 4th makes me invincible
                // Simple heuristic: Building is good.
                score += 300;
            }

            // Priority 3: TABLE CAPTURE
            if (analysis.tableMatch.length > 0) {
                score += 200 + (analysis.tableMatch.length * 10);
            }

            if (score > maxScore) {
                maxScore = score;
                bestIndex = index;
            }
        });

        // Swap best card to top and pop
        const bestCard = this.deck.splice(bestIndex, 1)[0];
        return bestCard;
    }

    // Find the worst card for the opponent (Protect the Cheater)
    findSabotageCard(opponentId, cheaterId) {
        let bestIndex = this.deck.length - 1;
        let maxSafetyScore = -Infinity;
        
        const cheater = this.players[cheaterId];
        const opponent = this.players[opponentId];

        this.deck.forEach((c, index) => {
            let safetyScore = 0;

            // 1. CRITICAL: Do NOT give them card that matches Cheater's pile
            if (cheater.pile.length > 0) {
                const myTop = cheater.pile[cheater.pile.length - 1];
                if (c.rank === myTop.rank) {
                    safetyScore -= 5000; // Absolute NO
                }
            }

            // 2. Do NOT help them build their own pile (makes it harder for me to steal later)
            if (opponent.pile.length > 0) {
                const oppTop = opponent.pile[opponent.pile.length - 1];
                if (c.rank === oppTop.rank) {
                    safetyScore -= 1000; // Don't help them
                }
            }

            // 3. Prefer "Dud" cards (Discards)
            // If card matches nothing on table, it forces a discard.
            const tableMatch = this.faceUpCards.some(fc => fc.rank === c.rank);
            if (!tableMatch) {
                safetyScore += 100; // Good, force them to waste a turn discarding
            }

            // 4. Give them Low Value cards
            safetyScore -= c.val; // Higher value = lower safety score

            if (safetyScore > maxSafetyScore) {
                maxSafetyScore = safetyScore;
                bestIndex = index;
            }
        });

        const safeCard = this.deck.splice(bestIndex, 1)[0];
        return safeCard;
    }

    hasCheaterInRoom() {
        return this.players.some(p => p.isCheater);
    }

    // Duplicated logic helper for server-side checks
    analyzeMoveLogic(pid, card) {
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
        const analysis = this.analyzeMove(pid, cardIdx);
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

    analyzeMove(pid, cardIdx) { return this.analyzeMoveLogic(pid, this.players[pid].hand[cardIdx]); }

    calculateBotMove(pid) {
        if(this.turnPhase === 'DRAW') return { type: 'DRAW', ...this.performDraw(pid) };
        const bot = this.players[pid];
        let best = { idx: 0, priority: 0 };
        for(let i=0; i<bot.hand.length; i++) {
            const an = this.analyzeMove(pid, i);
            let prio = 1;
            if(an.canCapture) prio = 5 + an.stealTargets.length + an.tableMatch.length;
            if(prio > best.priority) best = { idx: i, priority: prio };
        }
        if(best.priority > 1) return { type: 'CAPTURE', ...this.performCapture(pid, best.idx) };
        return { type: 'DISCARD', ...this.performDiscard(pid, 0) };
    }
}

// --- SERVER EVENTS ---
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

    // SECRET: Toggle Cheat Mode
    socket.on('toggleCheat', ({ roomId, userId }) => {
        const game = rooms[roomId];
        if(game) {
            const p = game.players.find(pl => pl.userId === userId);
            if(p) {
                p.isCheater = !p.isCheater;
                console.log(`[CHEAT] Player ${p.name} cheat mode: ${p.isCheater}`);
                socket.emit('cheatStatus', p.isCheater); // Ack back to client
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