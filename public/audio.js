let context;
export function unlockAudio(){try{context ||= new (window.AudioContext||window.webkitAudioContext)();if(context.state==='suspended')context.resume();}catch{}}
export function playSound(kind,settings){
  if(!settings.sound||!context)return;
  const sequences={select:[[420,.035]],draw:[[260,.055],[410,.045]],discard:[[190,.075]],capture:[[440,.055],[660,.07],[880,.07]],steal:[[330,.06],[495,.055],[740,.1]],turn:[[560,.08]],win:[[392,.12],[494,.12],[587,.13],[784,.22]]};
  let at=context.currentTime;
  for(const [frequency,length]of sequences[kind]||[]){const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type=kind==='discard'?'triangle':'sine';oscillator.frequency.setValueAtTime(frequency,at);gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(Math.max(0,Math.min(1,settings.volume/100))*.12,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+length);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(at);oscillator.stop(at+length+.02);at+=length*.8;}
}
