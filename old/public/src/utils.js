import { SUITS, RANKS } from './definitions.js';
import { Card } from './entities.js';

export function createDeck() {
    let deck = [];
    for(let s of SUITS) {
        for(let r of RANKS) {
            deck.push(new Card(r, s));
        }
    }
    // Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}