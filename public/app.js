const socket = io();
const leftScore = document.querySelector('#left-score');
const rightScore = document.querySelector('#right-score');
const eventFeed = document.querySelector('#event-feed');
const liveStatus = document.querySelector('#live-status');
const connectionNote = document.querySelector('#connection-note');
let lastEventId = null;

function addEvent(event) {
  const row = document.createElement('div');
  row.className = 'gift-event';
  const flower = document.createElement('span');
  flower.className = 'gift-event__flower';
  flower.textContent = '✳';
  const user = document.createElement('span');
  user.className = 'gift-event__user';
  user.textContent = `${event.username} enviou uma ${event.giftName}`;
  const team = document.createElement('span');
  team.className = 'gift-event__team';
  team.textContent = `${event.team === 'left' ? 'ESQUERDA' : 'DIREITA'} +${event.quantity}`;
  row.append(flower, user, team);
  eventFeed.prepend(row);
  while (eventFeed.children.length > 4) eventFeed.lastElementChild.remove();
}

function animateTeam(team, quantity) {
  const score = team === 'left' ? leftScore : rightScore;
  const pop = document.querySelector(`#${team}-pop`);
  score.classList.remove('is-bump');
  void score.offsetWidth;
  score.classList.add('is-bump');
  pop.textContent = `+${quantity}`;
  pop.classList.remove('is-visible');
  void pop.offsetWidth;
  pop.classList.add('is-visible');
  if (team === 'left') document.querySelector('.star').animate([{ filter: 'drop-shadow(0 0 18px rgba(255,228,92,.52)) scale(1)' }, { filter: 'drop-shadow(0 0 34px rgba(255,244,145,.95)) scale(1.18)' }, { filter: 'drop-shadow(0 0 18px rgba(255,228,92,.52)) scale(1)' }], { duration: 560 });
}

function render({ score, live }) {
  leftScore.textContent = score.left.toLocaleString('pt-BR');
  rightScore.textContent = score.right.toLocaleString('pt-BR');
  document.querySelector('#center-left').textContent = score.left.toLocaleString('pt-BR');
  document.querySelector('#center-right').textContent = score.right.toLocaleString('pt-BR');
  const total = score.left + score.right;
  const leftPercent = total ? Math.round((score.left / total) * 100) : 50;
  document.querySelector('#left-ratio').textContent = `${leftPercent}%`;
  document.querySelector('#right-ratio').textContent = `${100 - leftPercent}%`;
  document.querySelector('#ratio-fill').style.width = `${leftPercent}%`;
  document.querySelector('#account-name').textContent = live.username || 'quiz_azul';
  liveStatus.classList.toggle('is-connected', live.connected);
  document.querySelector('#live-label').textContent = live.connected ? 'LIVE CONECTADA' : live.connecting ? 'CONECTANDO LIVE' : 'LIVE DESCONECTADA';
  connectionNote.textContent = live.error ? `Conexão: ${live.error}` : '';

  const newest = score.events?.[0];
  if (newest && newest.id !== lastEventId) {
    lastEventId = newest.id;
    if (newest.id !== window.initialEventId) {
      addEvent(newest);
      animateTeam(newest.team, newest.quantity);
    }
  }
}

fetch('/api/state').then(response => response.json()).then(state => {
  window.initialEventId = state.score.events?.[0]?.id;
  render(state);
}).catch(() => { connectionNote.textContent = 'Não foi possível carregar o placar.'; });
socket.on('state', render);
socket.on('connect_error', () => { connectionNote.textContent = 'Atualização em tempo real indisponível.'; });
socket.on('connect', () => { if (socket.connected) connectionNote.textContent = ''; });

async function requestConnection(path) {
  const buttons = [...document.querySelectorAll('.topbar button')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await fetch(path, { method: 'POST' });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || 'Falha na solicitação.');
    render(state);
  } catch (error) {
    connectionNote.textContent = error.message;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

document.querySelector('#connect-button').addEventListener('click', () => requestConnection('/api/connect'));
document.querySelector('#disconnect-button').addEventListener('click', () => requestConnection('/api/disconnect'));