import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
// Import the shared game logic
import { Game } from './public/game.js';

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// Stability: Increase ping timeout to prevent random disconnects
const io = new Server(httpServer, {
    pingTimeout: 60000,
    pingInterval: 25000
});

// Serve the public folder
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`[NET] Connected: ${socket.id}`);

    // CREATE ROOM
    socket.on('createRoom', ({ playerName, config, userId }) => {
        try {
            const roomId = Math.random().toString(36).substr(2, 4).toUpperCase();
            socket.join(roomId);

            // Initialize Game using Shared Logic
            const game = new Game(config || {});
            game.init();

            // Host setup
            if (game.players[0]) {
                game.players[0].name = playerName || "Host";
                game.players[0].socketId = socket.id;
                game.players[0].userId = userId;
                game.players[0].isBot = false;

                rooms[roomId] = game;
                socket.roomId = roomId;

                socket.emit('roomJoined', { roomId, playerId: 0, state: game.getPublicState(0) });
                console.log(`Room ${roomId} created by ${playerName}`);
            }
        } catch(e) {
            console.error(e);
            socket.emit('error', "Server Error creating room");
        }
    });

    // JOIN ROOM
    socket.on('joinRoom', ({ roomId, playerName, userId }) => {
        const game = rooms[roomId];
        if (!game) { socket.emit('error', 'Room Not Found'); return; }

        // 1. Reconnect
        const existing = game.players.find(p => p.userId === userId);
        if (existing) {
            console.log(`[RECONNECT] ${playerName} -> ${roomId}`);
            socket.join(roomId);
            socket.roomId = roomId;
            existing.socketId = socket.id;
            existing.isBot = false;
            broadcastState(roomId, game);
            socket.emit('roomJoined', { roomId, playerId: existing.id, state: game.getPublicState(existing.id) });
            return;
        }

        // 2. New Joiner
        const emptySlot = game.players.find(p => p.isBot);
        if (emptySlot) {
            socket.join(roomId);
            socket.roomId = roomId;
            emptySlot.name = playerName || "Guest";
            emptySlot.socketId = socket.id;
            emptySlot.userId = userId;
            emptySlot.isBot = false;

            console.log(`[JOIN] ${playerName} joined ${roomId}`);
            broadcastState(roomId, game);
            socket.emit('roomJoined', { roomId, playerId: emptySlot.id, state: game.getPublicState(emptySlot.id) });
        } else {
            socket.emit('error', 'Room Full');
        }
    });

    // ACTIONS
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

    // DISCONNECT
    socket.on('disconnect', () => {
        if(socket.roomId && rooms[socket.roomId]) {
            const game = rooms[socket.roomId];
            const player = game.players.find(p => p.socketId === socket.id);
            if(player) {
                console.log(`[DISCONNECT] ${player.name} (Bot Mode)`);
                player.socketId = null;
                player.isBot = true;
                broadcastState(socket.roomId, game);
                if(game.currentPlayerIdx === player.id) {
                    checkBotTurn(socket.roomId, game);
                }
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

// Use dynamic port for hosting
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`SERVER RUNNING at http://localhost:${PORT}`));