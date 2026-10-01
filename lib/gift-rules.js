const normalizeGiftName = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const parseGiftIds = value => new Set(
  String(value ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
);

export function classifyGift({ name, id, redGiftIds = new Set(), whiteGiftIds = new Set() }) {
  const giftId = String(id ?? '');
  if (redGiftIds.has(giftId)) return 'left';
  if (whiteGiftIds.has(giftId)) return 'right';

  const normalizedName = normalizeGiftName(name);
  if (/^(white rose|rose blanche|rosa branca)$/.test(normalizedName)) return 'right';
  if (/^(red rose|rosa vermelha|rose|rosa)$/.test(normalizedName)) return 'left';
  return null;
}

export function createGiftHandler({ store, onUpdate = () => {}, log = console.log, redGiftIds, whiteGiftIds }) {
  const redIds = redGiftIds ?? parseGiftIds(process.env.TIKTOK_RED_ROSE_GIFT_IDS);
  const whiteIds = whiteGiftIds ?? parseGiftIds(process.env.TIKTOK_WHITE_ROSE_GIFT_IDS);

  return data => {
    const giftName = data.giftDetails?.giftName ?? data.giftName ?? data.name ?? 'desconhecido';
    const giftId = data.giftId ?? data.giftDetails?.giftId ?? 'desconhecido';
    const rawQuantity = Number(data.repeatCount);
    const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? Math.floor(rawQuantity) : 1;
    const username = data.user?.uniqueId ?? data.user?.displayId ?? data.user?.nickname ?? 'desconhecido';
    const giftType = Number(data.giftType ?? data.giftDetails?.giftType);
    const dedupeId = data.msgId ?? data.common?.msgId ?? data.common?.msg_id;

    log(`[GIFT] nome=${giftName} id=${giftId} quantity=${quantity} user=@${username}`);

    if (giftType === 1 && data.repeatEnd !== true) return { processed: false, reason: 'streak-in-progress' };

    const team = classifyGift({ name: giftName, id: giftId, redGiftIds: redIds, whiteGiftIds: whiteIds });
    if (!team) return { processed: false, reason: 'unmapped-gift' };
    if (dedupeId != null && store.hasProcessedGift(String(dedupeId))) {
      return { processed: false, reason: 'duplicate' };
    }

    const event = store.addGift({
      team,
      quantity,
      username,
      giftName,
      giftId: String(giftId),
      dedupeId: dedupeId == null ? null : String(dedupeId)
    });
    if (!event) return { processed: false, reason: 'duplicate' };
    const side = team === 'left' ? 'ESQUERDA' : 'DIREITA';
    const color = team === 'left' ? 'VERMELHA' : 'BRANCA';
    const message = `ROSA ${color} → ${side} +${quantity}`;
    store.addLog(message);
    log(message);
    onUpdate(event);
    return { processed: true, event };
  };
}

export { parseGiftIds };