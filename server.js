import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
// IMPORT LOGIC FROM PUBLIC FOLDER
import { Game } from './public/game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`[NET] Connected: ${socket.id}`);

    socket.on('createRoom', ({ playerName, config }) => {
        try {
            const roomId = Math.random().toString(36).substr(2, 4).toUpperCase();
            socket.join(roomId);
            const game = new Game(config);
            game.init();
            
            game.players[0].name = playerName || "Host";
            game.players[0].socketId = socket.id;
            game.players[0].isBot = false;
            
            rooms[roomId] = game;
            socket.emit('roomJoined', { roomId, playerId: 0, state: game.getPublicState(0) });
            console.log(`Room ${roomId} created.`);
        } catch(e) { console.error(e); }
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const game = rooms[roomId];
        if (!game) { socket.emit('error', 'Room Not Found'); return; }
        const emptySlot = game.players.find(p => p.isBot && p.socketId === null);
        if (emptySlot) {
            socket.join(roomId);
            emptySlot.name = playerName || "Guest";
            emptySlot.socketId = socket.id;
            emptySlot.isBot = false;
            broadcastState(roomId, game);
            socket.emit('roomJoined', { roomId, playerId: emptySlot.id, state: game.getPublicState(emptySlot.id) });
        } else {
            socket.emit('error', 'Room Full');
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

// The 'process.env.PORT' is what Render uses. 3000 is just a fallback.
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`SERVER RUNNING on port ${PORT}`));