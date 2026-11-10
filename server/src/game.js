import { randomUUID } from 'node:crypto';

export const COLORS = ['red', 'blue', 'green', 'yellow'];
const ACTIONS = ['skip', 'reverse', 'draw2'];

export function createDeck() {
  const deck = [];

  for (const color of COLORS) {
    deck.push({ id: randomUUID(), color, value: '0' });
    for (let number = 1; number <= 9; number += 1) {
      for (let copy = 0; copy < 2; copy += 1) {
        deck.push({ id: randomUUID(), color, value: String(number) });
      }
    }
    for (const value of ACTIONS) {
      for (let copy = 0; copy < 2; copy += 1) {
        deck.push({ id: randomUUID(), color, value });
      }
    }
  }

  for (let copy = 0; copy < 4; copy += 1) {
    deck.push({ id: randomUUID(), color: 'wild', value: 'wild' });
    deck.push({ id: randomUUID(), color: 'wild', value: 'draw4' });
  }

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

function topCard(room) {
  return room.discard[room.discard.length - 1];
}

function drawFromDeck(room, player, count = 1) {
  for (let index = 0; index < count; index += 1) {
    if (!room.deck.length) {
      if (room.discard.length <= 1) break;
      const top = room.discard.pop();
      room.deck = room.discard;
      room.discard = [top];
      for (let cardIndex = room.deck.length - 1; cardIndex > 0; cardIndex -= 1) {
        const swapIndex = Math.floor(Math.random() * (cardIndex + 1));
        [room.deck[cardIndex], room.deck[swapIndex]] = [room.deck[swapIndex], room.deck[cardIndex]];
      }
    }

    const card = room.deck.pop();
    if (card) player.hand.push(card);
  }
}

function nextIndex(room, steps = 1) {
  let index = room.turn;
  for (let step = 0; step < steps; step += 1) {
    index = (index + room.direction + room.players.length) % room.players.length;
  }
  return index;
}

export function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      cardCount: player.hand.length,
      host: player.host,
      connected: player.connected !== false,
    })),
    discard: room.discard.at(-1),
    activeColor: room.activeColor,
    turn: room.turn,
    currentPlayer: room.players[room.turn]?.id,
    direction: room.direction,
    message: room.message,
    winner: room.winner,
    startedAt: room.startedAt,
  };
}

export function roomForPlayer(room, id) {
  const player = room.players.find(candidate => candidate.id === id);
  return {
    ...publicRoom(room),
    selfId: player?.id,
    hand: player?.hand ?? [],
    isYourTurn: room.players[room.turn]?.id === id,
  };
}

export function createRoom(code, player) {
  return {
    code,
    players: [{ ...player, hand: [], host: true, connected: true }],
    status: 'waiting',
    deck: [],
    discard: [],
    turn: 0,
    direction: 1,
    activeColor: null,
    message: 'Waiting for players…',
    winner: null,
    startedAt: null,
  };
}

export function addPlayer(room, player) {
  if (room.status !== 'waiting') throw new Error('Game already started');
  if (room.players.length >= 8) throw new Error('Room is full');
  if (room.players.some(existing => existing.id === player.id)) {
    throw new Error('This player is already in the room');
  }
  room.players.push({ ...player, hand: [], host: false, connected: true });
}

function deal(room) {
  const deck = createDeck();
  for (const player of room.players) player.hand = deck.splice(0, 7);

  let first = deck.shift();
  while (first.color === 'wild' || ACTIONS.includes(first.value) || first.value === 'draw4') {
    deck.push(first);
    first = deck.shift();
  }

  room.deck = deck;
  room.discard = [first];
  room.turn = 0;
  room.direction = 1;
  room.activeColor = first.color;
  room.status = 'playing';
  room.startedAt = Date.now();
  room.message = 'Game started. Match the color or number.';
}

export function startRoom(room) {
  if (room.status !== 'waiting') throw new Error('Game has already started');
  if (room.players.length < 2) throw new Error('At least 2 players are required');
  if (room.players.length > 8) throw new Error('A room can have at most 8 players');
  deal(room);
}

export function playCard(room, playerId, cardId, color) {
  if (room.status !== 'playing') throw new Error('Game is not active');
  const player = room.players[room.turn];
  if (!player || player.id !== playerId) throw new Error('Not your turn');

  const cardIndex = player.hand.findIndex(card => card.id === cardId);
  if (cardIndex < 0) throw new Error('Card not in your hand');

  const card = player.hand[cardIndex];
  const last = topCard(room);
  if (card.color !== 'wild' && card.color !== room.activeColor && card.value !== last.value) {
    throw new Error('That card does not match');
  }
  if (card.color === 'wild' && !COLORS.includes(color)) {
    throw new Error('Choose a valid color for a wild card');
  }

  player.hand.splice(cardIndex, 1);
  room.discard.push(card);
  room.activeColor = card.color === 'wild' ? color : card.color;
  const cardName = card.value === 'draw2'
    ? 'Draw Two'
    : card.value === 'draw4'
      ? 'Wild Draw Four'
      : card.value.toUpperCase();
  room.message = `${player.name} played ${cardName}.`;

  if (!player.hand.length) {
    room.status = 'finished';
    room.winner = player.id;
    room.message = `${player.name} wins Card Clash!`;
    return;
  }

  let steps = 1;
  if (card.value === 'reverse') {
    room.direction *= -1;
    if (room.players.length === 2) steps = 2;
  } else if (card.value === 'skip') {
    steps = 2;
  } else if (card.value === 'draw2' || card.value === 'draw4') {
    const target = room.players[nextIndex(room)];
    drawFromDeck(room, target, card.value === 'draw2' ? 2 : 4);
    steps = 2;
  }

  room.turn = nextIndex(room, steps);
}

export function drawCard(room, playerId) {
  if (room.status !== 'playing' || room.players[room.turn]?.id !== playerId) {
    throw new Error('Not your turn');
  }
  const player = room.players[room.turn];
  drawFromDeck(room, player);
  room.message = `${player.name} drew a card.`;
  room.turn = nextIndex(room);
}
