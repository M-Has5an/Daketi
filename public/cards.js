import {RANKS,SUITS} from './shared/game.js';
const paths={
  '♥':'M0 8C-2 5-10 0-10-5C-10-12-2-13 0-7C2-13 10-12 10-5C10 0 2 5 0 8Z',
  '♦':'M0-12 9 0 0 12-9 0Z',
  '♠':'M0-12C-3-7-10-3-10 2C-10 8-3 9 0 4C-1 8-2 10-5 12H5C2 10 1 8 0 4C3 9 10 8 10 2C10-3 3-7 0-12Z',
  '♣':'M0-12C-6-12-8-5-3-1C-11-5-14 5-8 8C-5 10-1 8 0 5C-1 8-2 10-5 12H5C2 10 1 8 0 5C1 8 5 10 8 8C14 5 11-5 3-1C8-5 6-12 0-12Z'
};
const layouts={
  '2':[[36,28],[36,72]],'3':[[36,26],[36,50],[36,74]],
  '4':[[24,28],[48,28],[24,72],[48,72]],
  '5':[[24,28],[48,28],[36,50],[24,72],[48,72]],
  '6':[[24,27],[48,27],[24,50],[48,50],[24,73],[48,73]],
  '7':[[24,26],[48,26],[36,38],[24,50],[48,50],[24,74],[48,74]],
  '8':[[24,25],[48,25],[36,37],[24,50],[48,50],[36,63],[24,75],[48,75]],
  '9':[[24,25],[48,25],[24,41],[48,41],[36,50],[24,59],[48,59],[24,75],[48,75]],
  '10':[[24,24],[48,24],[36,32],[24,41],[48,41],[24,59],[48,59],[36,68],[24,76],[48,76]]
};
export const cardName=c=>`${({J:'Jack',Q:'Queen',K:'King',A:'Ace'})[c.rank]||c.rank} of ${({ '♠':'spades','♥':'hearts','♣':'clubs','♦':'diamonds'})[c.suit]}`;
const pip=(s,x,y,size=6,flip=false)=>`<path d="${paths[s]}" transform="translate(${x} ${y}) ${flip?'rotate(180) ':''}scale(${size/12})"/>`;
function court(rank,suit,color){
  const crown=rank==='K'?'<path d="M25 26 23 16 30 21 36 13 42 21 49 16 47 26Z" fill="#bc9655"/>':rank==='Q'?'<path d="M25 27 27 20 32 22 36 16 40 22 45 20 47 27Z" fill="#bc9655"/>':'<path d="M24 24Q35 13 48 25L46 28H25Z" fill="'+color+'"/>';
  const half=`<path d="M17 49Q22 35 36 36Q50 35 55 49Z" fill="${color}"/><path d="M27 39 36 46 45 39 41 50H31Z" fill="#bc9655"/><path d="M26 26Q25 41 36 42Q47 41 46 26Z" fill="#e8d6b9" stroke="#b49773" stroke-width=".6"/>${crown}<path d="M31 31h2m6 0h2M34 36q2 2 4 0" stroke="#5c4938" stroke-width="1" fill="none"/>${rank==='K'?'<path d="M29 36 31 44 36 48 41 44 43 36 38 40H34Z" fill="#b49773"/>':rank==='Q'?'<path d="M26 27Q18 32 24 41M46 27Q54 32 48 41" fill="none" stroke="#bc9655" stroke-width="3"/>':'<path d="M19 30V48M16 33h6" stroke="#bc9655" stroke-width="2"/>'}${pip(suit,52,31,4)}`;
  return `<rect x="17" y="17" width="38" height="66" rx="2" fill="#f4ead8" stroke="#bc9655" stroke-width=".8"/><g>${half}</g><g transform="rotate(180 36 50)">${half}</g><path d="M18 50H54" stroke="#bc9655" stroke-width="1"/>`;
}
export function cardSVG(card,back='noir'){
  if(!card){
    const colors=back==='ruby'?['#5e1b30','#c09861']:back==='classic'?['#123d39','#d3b775']:['#17212c','#b69761'];
    return `<svg viewBox="0 0 72 100" aria-hidden="true"><defs><pattern id="weave-${back}" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M4.5 0 9 4.5 4.5 9 0 4.5Z" fill="none" stroke="${colors[1]}" stroke-opacity=".24" stroke-width=".5"/></pattern></defs><rect x=".7" y=".7" width="70.6" height="98.6" rx="6" fill="${colors[0]}" stroke="#e8d6b9" stroke-width="1.4"/><rect x="5" y="5" width="62" height="90" rx="3" fill="url(#weave-${back})" stroke="${colors[1]}" stroke-width=".7"/><path d="M36 27 52 50 36 73 20 50Z" fill="${colors[0]}" stroke="${colors[1]}"/><path d="M36 37 45 50 36 63 27 50Z" fill="none" stroke="${colors[1]}" stroke-width=".7"/><path d="M31 49 36 44 41 49 36 56Z" fill="${colors[1]}"/></svg>`;
  }
  if(!RANKS.includes(card.rank)||!SUITS.includes(card.suit))return cardSVG(null,back);
  const color=card.color==='red'?'#b7354c':'#182a32';
  const corner=`<text x="9.5" y="15.5" text-anchor="middle" font-size="${card.rank==='10'?11:13}" font-family="Georgia,serif" font-weight="700">${card.rank}</text>${pip(card.suit,9.5,22,4)}`;
  const center=layouts[card.rank]?layouts[card.rank].map(([x,y])=>pip(card.suit,x,y,card.rank==='10'||card.rank==='9'?5:6,y>50)).join(''):card.rank==='A'?`${pip(card.suit,36,49,17)}<path d="M27 75H45M31 78H41" stroke="#b69761" stroke-width=".6"/>`:court(card.rank,card.suit,color);
  return `<svg viewBox="0 0 72 100" aria-hidden="true"><rect x=".5" y=".5" width="71" height="99" rx="6" fill="#fffaf0" stroke="#e4d9c8"/><g fill="${color}">${corner}<g transform="rotate(180 36 50)">${corner}</g>${center}</g></svg>`;
}
export function makeCard(card,{interactive=false,back='noir',className=''}={}){
  const element=document.createElement(interactive?'button':'div');
  element.className=`card ${card?'card-face':'card-back'} ${className}`.trim();
  if(card)element.dataset.cardId=card.id;
  element.innerHTML=cardSVG(card,back);
  element.setAttribute('aria-label',card?`${cardName(card)}, ${card.val} points`:'Face-down card');
  if(interactive)element.type='button';else element.setAttribute('role','img');
  return element;
}
