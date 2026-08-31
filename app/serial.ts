import {
  ReceiverLineBuffer,
  ReceiverWebDeduper,
  type ReceiverMessage,
  type ReceiverWebMessage,
} from './protocol';

export type SerialState =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'syncing'
  | 'ready'
  | 'stale'
  | 'error';

type SerialPortInfo = { usbVendorId?: number; usbProductId?: number };

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  open(options: {
    baudRate: number;
    dataBits: number;
    stopBits: number;
    parity: 'none';
    flowControl: 'none';
    bufferSize: number;
  }): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
};

type SerialApiLike = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: { filters?: Array<{ usbVendorId: number }> }): Promise<SerialPortLike>;
  addEventListener(type: 'connect' | 'disconnect', listener: EventListener): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: EventListener): void;
};

type NavigatorWithSerial = Navigator & { serial?: SerialApiLike };

export type SerialCallbacks = {
  onState: (state: SerialState, detail?: string) => void;
  onMessage: (message: ReceiverMessage) => void;
  onWeb: (message: ReceiverWebMessage) => void;
};

const MICROBIT_VENDOR_ID = 0x0d28;

export class WebShooterSerial {
  private readonly callbacks: SerialCallbacks;
  private readonly api?: SerialApiLike;
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
  private decoder = new TextDecoder();
  private lines = new ReceiverLineBuffer();
  private closing = false;
  private syncTimeout: number | null = null;
  private deduper = new ReceiverWebDeduper();

  private handleDisconnect = (event: Event) => {
    const serialEvent = event as Event & { port?: SerialPortLike };
    const disconnectedPort = serialEvent.port ?? serialEvent.target;
    if (this.port && disconnectedPort === this.port && !this.closing) {
      void this.handleConnectionLoss('USB 연결이 끊어졌습니다.');
    }
  };

  private handleConnect = () => {
    if (!this.port && !this.closing) void this.autoConnect();
  };

  constructor(callbacks: SerialCallbacks) {
    this.callbacks = callbacks;
    this.api = (navigator as NavigatorWithSerial).serial;

    if (!this.api) {
      this.callbacks.onState('unsupported');
      return;
    }

    this.callbacks.onState('disconnected');
    this.api.addEventListener('disconnect', this.handleDisconnect as EventListener);
    this.api.addEventListener('connect', this.handleConnect as EventListener);
  }

  get supported() {
    return Boolean(this.api);
  }

  get connected() {
    return Boolean(this.port && this.readTask);
  }

  async autoConnect() {
    if (!this.api || this.port || this.readTask || this.closing) return;
    try {
      const ports = (await this.api.getPorts()).filter(
        (port) => port.getInfo().usbVendorId === MICROBIT_VENDOR_ID,
      );
      if (ports.length === 1) await this.open(ports[0]);
    } catch {
      this.callbacks.onState('disconnected');
    }
  }

  async requestAndConnect() {
    if (!this.api) {
      this.callbacks.onState('unsupported');
      return;
    }

    if (this.port || this.readTask) await this.disconnect();

    try {
      this.callbacks.onState('connecting');
      const port = await this.api.requestPort({
        filters: [{ usbVendorId: MICROBIT_VENDOR_ID }],
      });
      await this.open(port);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        this.callbacks.onState('disconnected', '장치 선택을 취소했습니다.');
        return;
      }

      this.callbacks.onState('error', this.readableError(error));
    }
  }

  private async open(port: SerialPortLike) {
    this.callbacks.onState('connecting');
    await port.open({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      bufferSize: 1024,
    });

    this.port = port;
    this.closing = false;
    this.lines.reset();
    this.decoder = new TextDecoder();
    this.deduper.reset();
    this.callbacks.onState('syncing');

    this.syncTimeout = window.setTimeout(() => {
      this.callbacks.onState('error', 'USB는 연결됐지만 수신기 프로그램을 확인할 수 없습니다.');
    }, 2500);

    this.readTask = this.readLoop(port).finally(() => {
      this.readTask = null;
    });
  }

  private async readLoop(port: SerialPortLike) {
    if (!port.readable) {
      this.callbacks.onState('error', '수신기의 직렬 데이터 통로를 열 수 없습니다.');
      return;
    }

    const reader = port.readable.getReader();
    this.reader = reader;

    try {
      while (!this.closing) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const text = this.decoder.decode(value, { stream: true });
        const messages = this.lines.push(text);
        for (const message of messages) this.acceptMessage(message);
      }
    } catch (error) {
      if (!this.closing) this.callbacks.onState('error', this.readableError(error));
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // The lock may already be released during a physical disconnect.
      }
      if (this.reader === reader) this.reader = null;
      if (!this.closing) this.callbacks.onState('disconnected');
    }
  }

  private acceptMessage(message: ReceiverMessage) {
    if (this.syncTimeout !== null) {
      window.clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }

    const acceptedWeb = this.deduper.accept(message);
    this.callbacks.onState('ready');
    this.callbacks.onMessage(message);

    if (message.type === 'WEB' && acceptedWeb) this.callbacks.onWeb(message);
  }

  markStale() {
    if (this.port && !this.closing) this.callbacks.onState('stale', '수신기 응답을 기다리는 중입니다.');
  }

  async disconnect() {
    if (this.closing) return;
    this.closing = true;

    if (this.syncTimeout !== null) {
      window.clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }

    const port = this.port;
    this.port = null;

    try {
      await this.reader?.cancel();
    } catch {
      // A detached USB cable can make cancel reject; close still continues.
    }

    try {
      await this.readTask;
    } catch {
      // The state callback already explains read errors.
    }

    try {
      await port?.close();
    } catch {
      // The operating system may already have closed a detached device.
    }

    this.lines.reset();
    this.deduper.reset();
    this.closing = false;
    this.callbacks.onState('disconnected');
  }

  private async handleConnectionLoss(detail: string) {
    this.callbacks.onState('disconnected', detail);
    await this.disconnect();
  }

  destroy() {
    if (this.api) {
      this.api.removeEventListener('disconnect', this.handleDisconnect as EventListener);
      this.api.removeEventListener('connect', this.handleConnect as EventListener);
    }
    void this.disconnect();
  }

  private readableError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/open|busy|lock|already/i.test(message)) {
      return 'MakeCode 콘솔이나 다른 시리얼 프로그램이 장치를 사용 중인지 확인하세요.';
    }
    return '수신기 연결을 확인한 뒤 다시 시도하세요.';
  }
}
