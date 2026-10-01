const socket = io();
const content = document.querySelector('#admin-content');
const actionMessage = document.querySelector('#action-message');

function row(mainText, metaText = '', logRow = false) {
  const item = document.createElement('div');
  item.className = `admin-row${logRow ? ' admin-row--log' : ''}`;
  const main = document.createElement('span');
  main.className = 'admin-row__main';
  main.textContent = mainText;
  const meta = document.createElement('span');
  meta.className = 'admin-row__meta';
  meta.textContent = metaText;
  item.append(main, meta);
  return item;
}

function render({ score, live }) {
  document.querySelector('#admin-live').textContent = live.connected ? 'CONECTADA' : live.connecting ? 'CONECTANDO' : 'DESCONECTADA';
  document.querySelector('#admin-account').textContent = `@${live.username || 'quiz_azul'}`;
  document.querySelector('#admin-left').textContent = score.left.toLocaleString('pt-BR');
  document.querySelector('#admin-right').textContent = score.right.toLocaleString('pt-BR');
  const gifts = document.querySelector('#admin-gifts');
  gifts.replaceChildren(...score.events.map(event => row(`${event.username} enviou ${event.giftName} ×${event.quantity}`, `${event.team === 'left' ? 'ESQUERDA' : 'DIREITA'} · ${new Date(event.timestamp).toLocaleTimeString('pt-BR')}`)));
  if (!score.events.length) gifts.append(row('Nenhum presente recebido ainda.'));
  const logs = document.querySelector('#admin-logs');
  logs.replaceChildren(...score.logs.map(entry => row(entry.message, new Date(entry.timestamp).toLocaleTimeString('pt-BR'), true)));
  if (!score.logs.length) logs.append(row('Nenhum evento registrado.'));
}

async function loadState() {
  const response = await fetch('/api/admin/state');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha ao acessar o painel.');
  render(data);
}

socket.on('state', render);
socket.on('connect_error', () => { actionMessage.textContent = 'Tempo real desconectado.'; });

async function adminRequest(path, confirm = false) {
  if (confirm) {
    const dialog = document.querySelector('#reset-dialog');
    dialog.showModal();
    const result = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
    if (result !== 'confirm') return;
  }
  actionMessage.textContent = 'Processando...';
  try {
    const response = await fetch(path, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.errorSummary || data.error || 'Falha na solicitação.');
    render(data);
    actionMessage.textContent = 'Concluído.';
  } catch (error) {
    actionMessage.textContent = error.message;
  }
}

document.querySelector('#reset-button').addEventListener('click', () => adminRequest('/api/admin/reset', true));
document.querySelector('#reconnect-button').addEventListener('click', () => adminRequest('/api/admin/reconnect'));

loadState().catch(error => { actionMessage.textContent = error.message; });