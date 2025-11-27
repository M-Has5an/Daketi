import { VALUES } from './definitions.js';

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
    }

    getScore() {
        return this.pile.reduce((acc, c) => acc + c.val, 0);
    }
}