import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadServerHarness() {
  const code = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const handlers = {};
  const fakeIo = {
    on: (ev, fn) => {
      handlers[ev] = fn;
    },
    to: () => ({ emit: () => {} }),
  };
  const fakeApp = { use: () => {} };
  fakeApp.static = () => () => {};
  const fakeExpress = Object.assign(() => fakeApp, { static: () => () => {} });
  const fakeHttp = {
    createServer: () => ({
      listen: () => {},
    }),
  };

  const sandbox = {
    require: (mod) => {
      if (mod === 'express') return fakeExpress;
      if (mod === 'http') return fakeHttp;
      if (mod === 'socket.io') return { Server: function Server() { return fakeIo; } };
      throw new Error(`Unexpected module: ${mod}`);
    },
    process: { env: {} },
    console: { log: () => {} },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    Math,
    Object,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${code}\n;globalThis.__exports = { WORD_BANK, rooms, createRoom, shuffleArray, buildWordPool, getHint, handlers: null };`,
    sandbox,
    { filename: 'server.js' }
  );
  sandbox.__exports.connectionHandler = handlers.connection;
  return sandbox.__exports;
}

test('WORD_BANK and buildWordPool provide complete non-empty categories', () => {
  const { WORD_BANK, buildWordPool } = loadServerHarness();
  const categories = Object.keys(WORD_BANK);
  assert.equal(categories.length, 8);
  for (const cat of categories) {
    assert.ok(WORD_BANK[cat].length >= 10, `category ${cat} should have >=10 words`);
  }
  const pool = buildWordPool();
  assert.equal(pool.length, 120);
  assert.ok(pool.every((entry) => entry.category && entry.word));
});

test('getHint masks unrevealed Chinese and ASCII characters accurately', () => {
  const { getHint } = loadServerHarness();
  assert.equal(getHint('长颈鹿', 0), '⬜ ⬜ ⬜');
  assert.equal(getHint('长颈鹿', 1), '长 ⬜ ⬜');
  assert.equal(getHint('长颈鹿', 3), '长 颈 鹿');
  assert.equal(getHint('AI', 1), 'A _');
});

test('room lifecycle handles creation, joining, round config, and scoring', () => {
  const { rooms, connectionHandler } = loadServerHarness();

  const makeSocket = (id) => {
    const events = {};
    const emitted = [];
    return {
      id,
      events,
      emitted,
      join: () => {},
      to: () => ({ emit: () => {} }),
      on: (ev, fn) => {
        events[ev] = fn;
      },
      emit: (ev, payload) => {
        emitted.push({ ev, payload });
      },
    };
  };

  const host = makeSocket('sock-host');
  const guest = makeSocket('sock-guest');
  connectionHandler(host);
  connectionHandler(guest);

  host.events['create-room']({ roomId: 'R100', playerName: 'Alice' });
  assert.ok(rooms.R100);
  assert.equal(rooms.R100.players.length, 1);

  guest.events['join-room']({ roomId: 'R100', playerName: 'Bob' });
  assert.equal(rooms.R100.players.length, 2);

  host.events['set-rounds']({ rounds: 5 });
  host.events['set-time']({ seconds: 90 });
  assert.equal(rooms.R100.totalRounds, 5);
  assert.equal(rooms.R100.roundTime, 90);

  host.events['start-game']();
  assert.equal(rooms.R100.gameStarted, true);
  assert.equal(rooms.R100.currentRound, 1);
  assert.ok(rooms.R100.currentWord.length >= 1);

  // Clean up room interval timer so node --test exits immediately
  clearInterval(rooms.R100.timer);
});

test('client HTML provides mobile canvas and room controls', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<canvas\b/);
  assert.match(html, /你画我猜/);
});
