import { createAlertQueue } from './alert-queue.js';

const socket = window.io();
const leftScore = document.querySelector('#left-score');
const rightScore = document.querySelector('#right-score');
const eventFeed = document.querySelector('#event-feed');
const liveStatus = document.querySelector('#live-status');
const connectionNote = document.querySelector('#connection-note');
const startLiveDialog = document.querySelector('#start-live-dialog');
const startLivePassword = document.querySelector('#start-live-password');
const startLiveError = document.querySelector('#start-live-error');
const roseAlert = document.querySelector('#rose-alert');
let lastEventId = null;
let hasInitialState = false;

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

function showRoseAlert(event) {
  const isRedRose = event.team === 'left';
  roseAlert.classList.remove('is-visible', 'is-hiding', 'rose-alert--left', 'rose-alert--right');
  roseAlert.classList.add(isRedRose ? 'rose-alert--left' : 'rose-alert--right');
  document.querySelector('#rose-alert-title').textContent = isRedRose ? 'ROSA VERMELHA' : 'ROSA BRANCA';
  document.querySelector('#rose-alert-team').textContent = `${isRedRose ? 'ESQUERDA' : 'DIREITA'} +${event.quantity}`;
  document.querySelector('#rose-alert-sender').textContent = `${event.username} enviou uma rosa ${isRedRose ? 'vermelha' : 'branca'}`;
  roseAlert.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => roseAlert.classList.add('is-visible'));
}

function hideRoseAlert() {
  roseAlert.classList.add('is-hiding');
  roseAlert.setAttribute('aria-hidden', 'true');
}

function clearRoseAlert() {
  roseAlert.classList.remove('is-visible', 'is-hiding');
}

const roseAlertQueue = createAlertQueue({ show: showRoseAlert, hide: hideRoseAlert, clear: clearRoseAlert, displayMs: 2000, exitMs: 380 });

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
  if (!hasInitialState) {
    [...(score.events ?? [])].reverse().slice(-4).forEach(addEvent);
    lastEventId = newest?.id ?? null;
    hasInitialState = true;
    return;
  }
  if (newest && newest.id !== lastEventId) {
    addEvent(newest);
    animateTeam(newest.team, newest.quantity);
    lastEventId = newest.id;
  }
}

fetch('/api/state').then(response => response.json()).then(state => {
  render(state);
}).catch(() => { connectionNote.textContent = 'Não foi possível carregar o placar.'; });
socket.on('state', render);
socket.on('gift', event => roseAlertQueue.enqueue(event));
socket.on('connect_error', () => { connectionNote.textContent = 'Atualização em tempo real indisponível.'; });
socket.on('connect', () => { if (socket.connected) connectionNote.textContent = ''; });

async function requestConnection(path, password) {
  const token = window.adminToken || window.prompt('Informe o token ADMIN_TOKEN para controlar a conexão:');
  if (!token) return;
  window.adminToken = token;
  const buttons = [...document.querySelectorAll('.topbar button')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'x-admin-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(password === undefined ? {} : { password })
    });
    const state = await response.json();
    if (!response.ok) {
      if (response.status === 401 && state.error !== 'Senha incorreta.') window.adminToken = '';
      throw new Error(state.error || 'Falha na solicitação.');
    }
    render(state);
    if (path === '/api/connect') startLiveDialog.close();
  } catch (error) {
    if (path === '/api/connect') {
      startLiveError.textContent = error.message;
      if (error.message === 'Senha incorreta.') startLivePassword.value = '';
      startLivePassword.focus();
    } else {
      connectionNote.textContent = error.message;
    }
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

document.querySelector('#connect-button').addEventListener('click', () => {
  startLiveError.textContent = '';
  startLivePassword.value = '';
  startLiveDialog.showModal();
  startLivePassword.focus();
});
document.querySelector('#start-live-form').addEventListener('submit', event => {
  event.preventDefault();
  requestConnection('/api/connect', startLivePassword.value);
});
document.querySelector('#cancel-start-live').addEventListener('click', () => startLiveDialog.close());
document.querySelector('#disconnect-button').addEventListener('click', () => requestConnection('/api/disconnect'));