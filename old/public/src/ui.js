export const UI = {
    elements: {
        landing: document.getElementById('page-landing'),
        game: document.getElementById('page-game'),
        rules: document.getElementById('page-rules'),
        log: document.getElementById('game-log'),
        hand: document.getElementById('player-hand'),
        table: document.getElementById('face-up-area'),
        opponents: document.getElementById('opponents-zone'),
        playerPile: document.getElementById('player-pile'),
        deckCount: document.getElementById('deck-count'),
        drawPile: document.getElementById('draw-pile-visual'),
        modals: {
            pile: document.getElementById('modal-pile'),
            summary: document.getElementById('modal-summary')
        }
    },

    showPage(pageId) {
        document.querySelectorAll('section').forEach(el => {
            el.classList.remove('active-page');
            el.classList.add('hidden-page');
        });
        document.getElementById(pageId).classList.remove('hidden-page');
        document.getElementById(pageId).classList.add('active-page');
    },

    log(msg) {
        const div = document.createElement('div');
        div.innerText = `> ${msg}`;
        this.elements.log.prepend(div);
    },

    renderCard(card, onClick = null, isSelected = false) {
        const el = document.createElement('div');
        el.className = `card ${card.color} ${isSelected ? 'selected' : ''}`;
        // Store ID for lookup
        el.dataset.id = card.id;

        el.innerHTML = `
            <div style="font-size:0.9rem; align-self:flex-start">${card.rank}</div>
            <div style="font-size:1.5rem; align-self:center">${card.suit}</div>
            <div style="font-size:0.9rem; align-self:flex-end; transform:rotate(180deg)">${card.rank}</div>
        `;
        if (onClick) el.onclick = onClick;
        return el;
    },

    renderCardBack() {
        const el = document.createElement('div');
        el.className = 'card card-back';
        return el;
    },

    updateGameState(game, currentPlayerIdx, selectedHandIndex) {
        // 1. Deck
        this.elements.deckCount.innerText = game.deck.length;
        this.elements.drawPile.style.opacity = game.deck.length > 0 ? 1 : 0;

        // 2. Table
        this.elements.table.innerHTML = '';
        game.faceUpCards.forEach(c => {
            this.elements.table.appendChild(this.renderCard(c));
        });

        // 3. Opponents
        this.elements.opponents.innerHTML = '';
        game.players.forEach(p => {
            if (p.id === 0) return;
            const isActive = (p.id === currentPlayerIdx);

            let pileHtml = '<div class="card-pile empty"></div>';
            if(p.pile.length > 0) {
                const top = p.pile[p.pile.length-1];
                const cardEl = this.renderCard(top);
                const badge = document.createElement('div');
                badge.className = 'pile-count';
                badge.innerText = p.pile.length;

                const wrapper = document.createElement('div');
                wrapper.className = 'card-pile';
                wrapper.appendChild(cardEl);
                wrapper.appendChild(badge);
                pileHtml = wrapper.outerHTML;
            }

            const seat = document.createElement('div');
            seat.className = `seat ${isActive ? 'active' : ''}`;
            seat.innerHTML = `
                <div class="bot-avatar">🤖</div>
                <div style="font-size:0.8rem">${p.name}</div>
                <div style="font-size:0.7rem; color:#ccc">Hand: ${p.hand.length}</div>
                ${pileHtml}
            `;
            this.elements.opponents.appendChild(seat);
        });

        // 4. Player
        const p = game.players[0];
        document.getElementById('score-display').innerText = `Score: ${p.getScore()}`;
        document.getElementById('turn-indicator').innerText = (currentPlayerIdx === 0) ? "YOUR TURN" : "WAITING...";

        this.elements.playerPile.innerHTML = '';
        if(p.pile.length > 0) {
            const top = p.pile[p.pile.length-1];
            this.elements.playerPile.appendChild(this.renderCard(top));
            const badge = document.createElement('div');
            badge.className = 'pile-count';
            badge.innerText = p.pile.length;
            this.elements.playerPile.appendChild(badge);
        }

        this.elements.hand.innerHTML = '';
        p.hand.forEach((c, idx) => {
            const isSel = (idx === selectedHandIndex);
            this.elements.hand.appendChild(this.renderCard(c, () => window.dispatchEvent(new CustomEvent('card-select', { detail: idx })), isSel));
        });

        const btnDraw = document.getElementById('act-draw');
        const btnCap = document.getElementById('act-capture');
        const btnDisc = document.getElementById('act-discard');

        btnDraw.classList.remove('visible');
        btnCap.classList.remove('visible');
        btnDisc.classList.remove('visible');

        if(currentPlayerIdx === 0) {
            if(game.turnPhase === 'DRAW') {
                btnDraw.classList.add('visible');
            } else {
                if(selectedHandIndex > -1) {
                    btnDisc.classList.add('visible');
                    if(game.canCapture(0, selectedHandIndex)) {
                        btnCap.classList.add('visible');
                    }
                }
            }
        }
    },

    showPileContents(player) {
        const grid = document.getElementById('pile-grid');
        grid.innerHTML = '';
        player.pile.forEach(c => {
            grid.appendChild(this.renderCard(c));
        });
        this.elements.modals.pile.classList.remove('hidden');
    },

    showSummary(players) {
        const div = document.getElementById('summary-details');
        div.innerHTML = '';
        let max = -1;
        let winner = '';

        players.forEach(p => {
            const s = p.getScore();
            if(s > max) { max = s; winner = p.name; }
            div.innerHTML += `<p>${p.name}: <b>${s}</b> pts</p>`;
        });

        const wDiv = document.createElement('h2');
        wDiv.style.color = '#f1c40f';
        wDiv.innerText = `${winner} WINS!`;
        div.prepend(wDiv);

        this.elements.modals.summary.classList.remove('hidden');
    },

    // --- UPDATED ANIMATION SYSTEM ---
    async animateMove(card, startEl, endEl, showBack = false) {
        if (!startEl || !endEl) return;

        // Calculate Centers to prevent stretching
        const startRect = startEl.getBoundingClientRect();
        const endRect = endEl.getBoundingClientRect();

        const startX = startRect.left + (startRect.width / 2) - (75 / 2); // 75 = Card Width
        const startY = startRect.top + (startRect.height / 2) - (105 / 2); // 105 = Card Height

        const endX = endRect.left + (endRect.width / 2) - (75 / 2);
        const endY = endRect.top + (endRect.height / 2) - (105 / 2);

        // Create Flyer
        let flyer;
        if(showBack) {
            flyer = this.renderCardBack();
        } else {
            flyer = this.renderCard(card);
        }
        flyer.classList.add('flying-card');

        // Initial State (Standard Size, Centered on Start)
        flyer.style.width = '75px';
        flyer.style.height = '105px';
        flyer.style.left = `${startX}px`;
        flyer.style.top = `${startY}px`;
        flyer.style.transform = 'rotate(0deg)';

        document.body.appendChild(flyer);
        // Force Reflow
        flyer.offsetHeight;

        // Final State
        flyer.style.left = `${endX}px`;
        flyer.style.top = `${endY}px`;
        flyer.style.transform = 'rotate(180deg) scale(1.0)';

        // Wait
        await new Promise(resolve => setTimeout(resolve, 600));

        flyer.remove();
    },

    getHandCardEl(index) {
        return this.elements.hand.children[index];
    },

    getBotSeatEl(botId) {
        return document.getElementById('opponents-zone').children[botId - 1];
    },

    getPileEl(playerId) {
        if(playerId === 0) return document.getElementById('player-pile');
        const seat = document.getElementById('opponents-zone').children[playerId - 1];
        if(!seat) return null;
        return seat.querySelector('.card-pile') || seat;
    },

    getTableCardEl(cardId) {
        return document.querySelector(`#face-up-area .card[data-id="${cardId}"]`);
    }
};