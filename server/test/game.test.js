import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPlayer,
  createDeck,
  createRoom,
  drawCard,
  playCard,
  roomForPlayer,
  startRoom,
} from '../src/game.js';

function activeRoom(playerCount = 2) {
  const room = createRoom('ABCDE', { id: 'player-0', name: 'Player 0', socketId: 'socket-0' });
  for (let index = 1; index < playerCount; index += 1) {
    addPlayer(room, { id: `player-${index}`, name: `Player ${index}`, socketId: `socket-${index}` });
  }
  startRoom(room);
  return room;
}

test('creates a shuffled 108-card deck with unique card IDs', () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map(card => card.id)).size, 108);
});

test('deals seven cards to each player and only reveals the requesting hand', () => {
  const room = activeRoom(8);
  assert.ok(room.players.every(player => player.hand.length === 7));
  assert.equal(room.deck.length + room.discard.length + room.players.reduce((sum, player) => sum + player.hand.length, 0), 108);
  assert.equal(roomForPlayer(room, 'player-0').hand.length, 7);
  assert.equal(Object.hasOwn(roomForPlayer(room, 'player-0').players[1], 'hand'), false);
  assert.throws(() => startRoom(createRoom('MIN01', { id: 'solo', name: 'Solo' })), /At least 2/);
});

test('rejects out-of-turn and non-matching cards without changing the hand', () => {
  const room = activeRoom();
  room.discard = [{ id: 'top', color: 'red', value: '5' }];
  room.activeColor = 'red';
  room.players[0].hand = [{ id: 'match', color: 'red', value: '2' }];
  room.players[1].hand = [{ id: 'off-turn', color: 'blue', value: '5' }];

  assert.throws(() => playCard(room, 'player-1', 'off-turn'), /Not your turn/);
  assert.throws(() => playCard(room, 'player-0', 'missing'), /not in your hand/i);
  room.players[0].hand = [{ id: 'invalid', color: 'green', value: '8' }];
  assert.throws(() => playCard(room, 'player-0', 'invalid'), /does not match/);
  assert.equal(room.players[0].hand.length, 1);
});

test('wild cards require a valid color and apply the chosen color', () => {
  const room = activeRoom();
  room.discard = [{ id: 'top', color: 'red', value: '5' }];
  room.activeColor = 'red';
  room.players[0].hand = [
    { id: 'wild', color: 'wild', value: 'wild' },
    { id: 'extra', color: 'red', value: '1' },
  ];

  assert.throws(() => playCard(room, 'player-0', 'wild'), /valid color/);
  assert.throws(() => playCard(room, 'player-0', 'wild', 'purple'), /valid color/);
  playCard(room, 'player-0', 'wild', 'green');
  assert.equal(room.activeColor, 'green');
  assert.equal(room.turn, 1);
});

test('draw-two penalizes the next player and skips their turn', () => {
  const room = activeRoom(3);
  room.discard = [{ id: 'top', color: 'red', value: '5' }];
  room.activeColor = 'red';
  room.players[0].hand = [
    { id: 'draw-two', color: 'red', value: 'draw2' },
    { id: 'extra', color: 'blue', value: '1' },
  ];
  room.players[1].hand = [];
  room.players[2].hand = [{ id: 'last', color: 'green', value: '1' }];
  room.deck = [
    { id: 'penalty-1', color: 'blue', value: '2' },
    { id: 'penalty-2', color: 'yellow', value: '3' },
  ];

  playCard(room, 'player-0', 'draw-two');
  assert.equal(room.players[1].hand.length, 2);
  assert.equal(room.turn, 2);
});

test('drawing ends the active player turn and winning ends the match', () => {
  const room = activeRoom();
  room.discard = [{ id: 'top', color: 'red', value: '5' }];
  room.activeColor = 'red';
  room.players[0].hand = [{ id: 'match', color: 'red', value: '1' }];
  room.deck = [{ id: 'drawn', color: 'blue', value: '3' }];

  drawCard(room, 'player-0');
  assert.equal(room.turn, 1);
  assert.equal(room.players[0].hand.length, 2);
  assert.throws(() => drawCard(room, 'player-0'), /Not your turn/);

  room.turn = 0;
  room.players[0].hand = [{ id: 'winning', color: 'red', value: '5' }];
  playCard(room, 'player-0', 'winning');
  assert.equal(room.status, 'finished');
  assert.equal(room.winner, 'player-0');
});
