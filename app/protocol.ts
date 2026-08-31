export type ReceiverReadyMessage = {
  type: 'READY';
  receiverMs: number;
  radioGroup: number;
  radioBand: number;
};

export type ReceiverWebMessage = {
  type: 'WEB';
  bootId: number;
  sequence: number;
  senderMs: number;
  rssi: number;
  receiverMs: number;
};

export type ReceiverHealthMessage = {
  type: 'HEARTBEAT' | 'STATUS';
  receiverMs: number;
  lastWebAgeMs: number;
  radioPackets: number;
  webLines: number;
  duplicates: number;
  invalid: number;
};

export type ReceiverPongMessage = {
  type: 'PONG';
  receiverMs: number;
};

export type ReceiverMessage =
  | ReceiverReadyMessage
  | ReceiverWebMessage
  | ReceiverHealthMessage
  | ReceiverPongMessage;

const integer = (value: string, min: number, max: number) => {
  if (!/^[-]?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

export function parseReceiverLine(raw: string): ReceiverMessage | null {
  const line = raw.replace(/\r$/, '').trim();

  // B4 stability protocol: deliberately tiny lines minimize USB CDC work.
  if (line === 'R') {
    return { type: 'READY', receiverMs: 0, radioGroup: 147, radioBand: 50 };
  }

  if (line === 'H') {
    return {
      type: 'HEARTBEAT',
      receiverMs: 0,
      lastWebAgeMs: -1,
      radioPackets: 0,
      webLines: 0,
      duplicates: 0,
      invalid: 0,
    };
  }

  const shortWeb = /^(W|T)\|(\d{1,3})$/.exec(line);
  if (shortWeb) {
    const sequence = integer(shortWeb[2], 0, 999);
    if (sequence === null) return null;
    return {
      type: 'WEB',
      bootId: shortWeb[1] === 'T' ? 0 : 1,
      sequence,
      senderMs: 0,
      rssi: 0,
      receiverMs: sequence,
    };
  }

  const fields = line.split('|');
  if (fields[0] !== 'WS1') return null;

  if (fields[1] === 'READY' && fields.length === 5) {
    const receiverMs = integer(fields[2], 0, 2_147_483_647);
    const radioGroup = integer(fields[3], 0, 255);
    const radioBand = integer(fields[4], 0, 83);
    if (receiverMs === null || radioGroup === null || radioBand === null) return null;
    return { type: 'READY', receiverMs, radioGroup, radioBand };
  }

  if (fields[1] === 'WEB' && fields.length === 7) {
    const bootId = integer(fields[2], 0, 255);
    const sequence = integer(fields[3], 0, 999);
    const senderMs = integer(fields[4], 0, 99_999_999);
    const rssi = integer(fields[5], -255, 0);
    const receiverMs = integer(fields[6], 0, 2_147_483_647);
    if (
      bootId === null ||
      sequence === null ||
      senderMs === null ||
      rssi === null ||
      receiverMs === null
    ) {
      return null;
    }
    return { type: 'WEB', bootId, sequence, senderMs, rssi, receiverMs };
  }

  if ((fields[1] === 'HEARTBEAT' || fields[1] === 'STATUS') && fields.length === 9) {
    const receiverMs = integer(fields[2], 0, 2_147_483_647);
    const lastWebAgeMs = integer(fields[3], -1, 2_147_483_647);
    const radioPackets = integer(fields[4], 0, 2_147_483_647);
    const webLines = integer(fields[5], 0, 2_147_483_647);
    const duplicates = integer(fields[6], 0, 2_147_483_647);
    const invalid = integer(fields[7], 0, 2_147_483_647);

    // Older receiver builds may append one reserved field. Ignore it after validation.
    const reserved = integer(fields[8], 0, 2_147_483_647);
    if (
      receiverMs === null ||
      lastWebAgeMs === null ||
      radioPackets === null ||
      webLines === null ||
      duplicates === null ||
      invalid === null ||
      reserved === null
    ) {
      return null;
    }
    return {
      type: fields[1],
      receiverMs,
      lastWebAgeMs,
      radioPackets,
      webLines,
      duplicates,
      invalid,
    };
  }

  // Current receiver firmware emits eight fields for health messages.
  if ((fields[1] === 'HEARTBEAT' || fields[1] === 'STATUS') && fields.length === 8) {
    const receiverMs = integer(fields[2], 0, 2_147_483_647);
    const lastWebAgeMs = integer(fields[3], -1, 2_147_483_647);
    const radioPackets = integer(fields[4], 0, 2_147_483_647);
    const webLines = integer(fields[5], 0, 2_147_483_647);
    const duplicates = integer(fields[6], 0, 2_147_483_647);
    const invalid = integer(fields[7], 0, 2_147_483_647);
    if (
      receiverMs === null ||
      lastWebAgeMs === null ||
      radioPackets === null ||
      webLines === null ||
      duplicates === null ||
      invalid === null
    ) {
      return null;
    }
    return {
      type: fields[1],
      receiverMs,
      lastWebAgeMs,
      radioPackets,
      webLines,
      duplicates,
      invalid,
    };
  }

  if (fields[1] === 'PONG' && fields.length === 3) {
    const receiverMs = integer(fields[2], 0, 2_147_483_647);
    return receiverMs === null ? null : { type: 'PONG', receiverMs };
  }

  return null;
}

export class ReceiverLineBuffer {
  private buffer = '';
  private dropping = false;

  push(text: string): ReceiverMessage[] {
    const messages: ReceiverMessage[] = [];

    for (const character of text) {
      if (this.dropping) {
        if (character === '\n') this.dropping = false;
        continue;
      }

      if (character === '\n') {
        const parsed = parseReceiverLine(this.buffer);
        this.buffer = '';
        if (parsed) messages.push(parsed);
        continue;
      }

      if (this.buffer.length >= 160) {
        this.buffer = '';
        this.dropping = true;
        continue;
      }

      this.buffer += character;
    }

    return messages;
  }

  reset() {
    this.buffer = '';
    this.dropping = false;
  }
}

export class ReceiverWebDeduper {
  private lastKey = '';
  private lastReceiverMs: number | null = null;

  accept(message: ReceiverMessage) {
    if (this.lastReceiverMs !== null && message.receiverMs + 1000 < this.lastReceiverMs) {
      this.lastKey = '';
    }
    this.lastReceiverMs = message.receiverMs;

    if (message.type !== 'WEB') return false;
    const key = `${message.bootId}:${message.sequence}`;
    if (key === this.lastKey) return false;
    this.lastKey = key;
    return true;
  }

  reset() {
    this.lastKey = '';
    this.lastReceiverMs = null;
  }
}
