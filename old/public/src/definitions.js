// Enums and Constants
export const SUITS = ['♠', '♥', '♣', '♦'];
export const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
export const VALUES = {
    '2': 5, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5, '8': 5, '9': 5, '10': 5,
    'J': 10, 'Q': 10, 'K': 10, 'A': 20
};

export const GamePhase = {
    DRAW: 'DRAW',
    PLAY: 'PLAY',
    GAME_OVER: 'GAME_OVER'
};