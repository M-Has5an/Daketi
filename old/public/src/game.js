// Shared constants
export const SUITS = ['♠', '♥', '♣', '♦'];
export const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
export const VALUES = {
    '2': 5, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5, '8': 5, '9': 5, '10': 5,
    'J': 10, 'Q': 10, 'K': 10, 'A': 20
};

export class Card {
    constructor(rank, suit) {
        this.rank = rank;
        this.suit = suit;
        this.val = VALUES[rank];
        this.color = (suit === '♥' || suit === '♦') ? 'red' : 'black';
        this.id = Math.random().toString(36).substr(2, 9);
    }
}

export class Player {
    constructor(id, name, isBot) {
        this.id = id;
        this.name = name;
        this.isBot = isBot;
        this.hand = [];
        this.pile = [];
        this.socketId = null; // Used by server to track connection
    }
    getScore() { return this.pile.reduce((acc, c) => acc + c.val, 0); }
}

export class Game {
    constructor(config) {
        this.config = config;
        this.deck = [];
        this.faceUpCards = [];
        this.players = [];
        this.currentPlayerIdx = 0;
        this.turnPhase = 'DRAW';
    }

    init() {
        // Create Deck
        let d = [];
        for(let s of SUITS) for(let r of RANKS) d.push(new Card(r, s));
        // Shuffle
        for (let i = d.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [d[i], d[j]] = [d[j], d[i]];
        }
        this.deck = d;

        // Init Players (All bots initially, overwritten by Host later)
        this.players = [];
        for(let i=0; i<this.config.numPlayers; i++) {
            this.players.push(new Player(i, `Player ${i+1}`, true));
        }

        // Deal
        for(let i=0; i<this.config.handSize; i++) {
            this.players.forEach(p => { if(this.deck.length) p.hand.push(this.deck.pop()); });
        }
        for(let i=0; i<this.config.faceUpSize; i++) {
            if(this.deck.length) this.faceUpCards.push(this.deck.pop());
        }

        this.currentPlayerIdx = 0;
        this.turnPhase = 'DRAW';
    }

    getPlayerBySocket(socketId) {
        return this.players.find(p => p.socketId === socketId);
    }

    // Returns a sanitized state object for a specific client
    getPublicState(forPlayerId) {
        return {
            deckCount: this.deck.length,
            faceUpCards: this.faceUpCards,
            currentPlayerIdx: this.currentPlayerIdx,
            turnPhase: this.turnPhase,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
                pile: p.pile, // Visible
                handCount: p.hand.length,
                // ONLY show actual cards if it's the requesting player's hand
                hand: (p.id === forPlayerId) ? p.hand : null 
            }))
        };
    }

    // --- ACTIONS (Return result + Animation Details) ---

    performDraw(pid) {
        const p = this.players[pid];
        if(this.deck.length === 0) return null;
        
        const card = this.deck.pop();
        p.hand.push(card);
        
        this.turnPhase = 'PLAY';
        
        return {
            animDetails: { card: card } // Server sends card so drawer knows what it is
        };
    }

    performDiscard(pid, cardIdx) {
        const p = this.players[pid];
        const card = p.hand.splice(cardIdx, 1)[0];
        this.faceUpCards.push(card);
        this.endTurn();
        
        return {
            animDetails: { card: card }
        };
    }

    performCapture(pid, cardIdx) {
        const p = this.players[pid];
        const card = p.hand[cardIdx]; // Don't splice yet, need for analysis
        const analysis = this.analyzeMove(pid, cardIdx);
        
        if(!analysis.canCapture) return null;

        // EXECUTE LOGIC
        p.hand.splice(cardIdx, 1);
        
        // 1. Steal
        analysis.stealTargets.forEach(t => {
            const opp = this.players[t.id];
            const stolen = opp.pile.splice(opp.pile.length - t.cards.length, t.cards.length);
            p.pile.push(...stolen);
        });

        // 2. Table
        if(analysis.tableMatch.length > 0) {
            const ids = analysis.tableMatch.map(c => c.id);
            this.faceUpCards = this.faceUpCards.filter(c => !ids.includes(c.id));
            p.pile.push(...analysis.tableMatch);
        }

        p.pile.push(card);

        // Extra Turn Logic
        let extraTurn = false;
        if(this.deck.length > 0) {
            extraTurn = true;
            this.turnPhase = 'DRAW';
        } else {
            this.endTurn();
        }

        return {
            animDetails: {
                card: card,
                analysis: analysis, // Contains info on what was stolen/captured
                extraTurn: extraTurn
            }
        };
    }

    endTurn() {
        this.currentPlayerIdx = (this.currentPlayerIdx + 1) % this.players.length;
        this.turnPhase = (this.deck.length > 0) ? 'DRAW' : 'PLAY';
    }

    isGameOver() {
        return this.deck.length === 0 && this.players.every(p => p.hand.length === 0);
    }

    // --- AI LOGIC ---
    analyzeMove(pid, cardIdx) {
        const p = this.players[pid];
        const card = p.hand[cardIdx];
        let result = { canCapture: false, stealTargets: [], tableMatch: [], selfMatch: false };

        // Check Steal (Multi)
        this.players.forEach(opp => {
            if(opp.id === pid || opp.pile.length === 0) return;
            if(opp.pile[opp.pile.length-1].rank === card.rank) {
                let steal = [];
                for(let k=opp.pile.length-1; k>=0; k--) {
                    if(opp.pile[k].rank === card.rank) steal.push(opp.pile[k]); else break;
                }
                result.stealTargets.push({ id: opp.id, cards: steal });
            }
        });

        // Check Table
        const tbl = this.faceUpCards.filter(c => c.rank === card.rank);
        if(tbl.length > 0) result.tableMatch = tbl;

        // Check Self
        if(p.pile.length > 0 && p.pile[p.pile.length-1].rank === card.rank) result.selfMatch = true;

        if(result.stealTargets.length > 0 || result.tableMatch.length > 0 || result.selfMatch) result.canCapture = true;
        return result;
    }

    calculateBotMove(pid) {
        // Run Draw logic if phase is DRAW
        if(this.turnPhase === 'DRAW') {
            return { type: 'DRAW', ...this.performDraw(pid) };
        }

        // Run Play Logic
        const bot = this.players[pid];
        let best = { idx: 0, priority: 0 };

        for(let i=0; i<bot.hand.length; i++) {
            const an = this.analyzeMove(pid, i);
            let prio = 1;
            if(an.canCapture) {
                if(an.stealTargets.length > 0) prio = 5 + an.stealTargets.length;
                else if(an.tableMatch.length > 0) prio = 3;
                else if(an.selfMatch) prio = 2;
            }
            if(prio > best.priority) best = { idx: i, priority: prio };
        }

        if(best.priority > 1) {
            return { type: 'CAPTURE', ...this.performCapture(pid, best.idx) };
        } else {
            return { type: 'DISCARD', ...this.performDiscard(pid, 0) }; // Discard first card
        }
    }
}