// Handles saving/loading game settings
const KEY = 'robber_daketi_config';

export const Persistence = {
    saveConfig(config) {
        localStorage.setItem(KEY, JSON.stringify(config));
    },

    loadConfig() {
        const stored = localStorage.getItem(KEY);
        if (stored) return JSON.parse(stored);
        return {
            numPlayers: 2,
            handSize: 6,
            faceUpSize: 6,
            stealMode: 'single'
        };
    }
};