import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ReceiverLineBuffer,
  ReceiverWebDeduper,
  parseReceiverLine,
  type ReceiverWebMessage,
} from '../app/protocol.ts';

test('parses receiver ready messages', () => {
  assert.deepEqual(parseReceiverLine('WS1|READY|18|71|7\r'), {
    type: 'READY',
    receiverMs: 18,
    radioGroup: 71,
    radioBand: 7,
  });
});

test('parses the B4/B5 short stability protocol', () => {
  assert.deepEqual(parseReceiverLine('R\r'), {
    type: 'READY',
    receiverMs: 0,
    radioGroup: 147,
    radioBand: 50,
  });
  assert.deepEqual(parseReceiverLine('H'), {
    type: 'HEARTBEAT',
    receiverMs: 0,
    lastWebAgeMs: -1,
    radioPackets: 0,
    webLines: 0,
    duplicates: 0,
    invalid: 0,
  });
  assert.deepEqual(parseReceiverLine('W|37'), {
    type: 'WEB',
    bootId: 1,
    sequence: 37,
    senderMs: 0,
    rssi: 0,
    receiverMs: 37,
  });
  assert.equal(parseReceiverLine('W|1000'), null);
});

test('parses web messages including RSSI', () => {
  assert.deepEqual(parseReceiverLine('WS1|WEB|42|17|8192|-61|9250'), {
    type: 'WEB',
    bootId: 42,
    sequence: 17,
    senderMs: 8192,
    rssi: -61,
    receiverMs: 9250,
  });
});

test('parses current heartbeat messages', () => {
  assert.deepEqual(parseReceiverLine('WS1|HEARTBEAT|12000|420|21|18|3|0'), {
    type: 'HEARTBEAT',
    receiverMs: 12000,
    lastWebAgeMs: 420,
    radioPackets: 21,
    webLines: 18,
    duplicates: 3,
    invalid: 0,
  });
});

test('rejects malformed or out-of-range messages', () => {
  assert.equal(parseReceiverLine('WEB'), null);
  assert.equal(parseReceiverLine('WS1|WEB|42|17|8192|12|9250'), null);
  assert.equal(parseReceiverLine('WS1|WEB|999|17|8192|-61|9250'), null);
  assert.equal(parseReceiverLine('WS2|WEB|42|17|8192|-61|9250'), null);
});

test('buffers fragmented lines and extracts multiple messages', () => {
  const buffer = new ReceiverLineBuffer();
  assert.deepEqual(buffer.push('WS1|W'), []);
  assert.deepEqual(buffer.push('EB|8|2|500|-55|530\r\nWS1|PONG|600\n'), [
    {
      type: 'WEB',
      bootId: 8,
      sequence: 2,
      senderMs: 500,
      rssi: -55,
      receiverMs: 530,
    },
    { type: 'PONG', receiverMs: 600 },
  ]);
});

test('drops an overlong line and recovers at the next newline', () => {
  const buffer = new ReceiverLineBuffer();
  const messages = buffer.push(`${'x'.repeat(240)}\nWS1|READY|9|71|7\n`);
  assert.deepEqual(messages, [
    { type: 'READY', receiverMs: 9, radioGroup: 71, radioBand: 7 },
  ]);
});

test('parses 500 web frames split across irregular USB chunks', () => {
  const source = Array.from(
    { length: 500 },
    (_, index) => `WS1|WEB|12|${index % 1000}|${1000 + index}|-58|${2000 + index}\r\n`,
  ).join('');
  const buffer = new ReceiverLineBuffer();
  const messages = [];

  for (let offset = 0; offset < source.length; ) {
    const size = (offset % 31) + 1;
    messages.push(...buffer.push(source.slice(offset, offset + size)));
    offset += size;
  }

  assert.equal(messages.length, 500);
  assert.equal(messages.every((message) => message.type === 'WEB'), true);
});

test('deduplicates retries and resets when receiver uptime restarts', () => {
  const deduper = new ReceiverWebDeduper();
  const message: ReceiverWebMessage = {
    type: 'WEB',
    bootId: 44,
    sequence: 3,
    senderMs: 900,
    rssi: -62,
    receiverMs: 1200,
  };

  assert.equal(deduper.accept(message), true);
  assert.equal(deduper.accept({ ...message, receiverMs: 1224 }), false);
  assert.equal(deduper.accept({ ...message, sequence: 4, receiverMs: 1260 }), true);
  assert.equal(deduper.accept({ ...message, receiverMs: 100 }), true);
});
