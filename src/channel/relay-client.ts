import { PROTOCOL_V, decodeMessage, encodeMessage } from '../protocol/protocol';
import type { DecodedMsg, EventMsg } from '../protocol/protocol';
import { RelayError } from '../protocol/relay-error';

interface Pending {
  readonly resolve: (ok: Readonly<Record<string, unknown>>) => void;
  readonly reject: (err: Readonly<RelayError>) => void;
}

export interface RelayClientOptions {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly reconnect?: boolean;
}

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

/**
 * A protocol connection to the relay: correlated request/response plus an
 * event callback. A dial counts as open only once the relay's welcome
 * arrives, which it sends after identifying the peer; a refusal before
 * that rejects the dial with the relay's code and reason, and the client
 * hangs up. With
 * `reconnect` on, a dropped socket is redialed with backoff and `onOpen`
 * fires again so the owner can repeat its hello.
 */
export class RelayClient {
  onEvent: (event: EventMsg) => void = () => {};

  onOpen: () => void = () => {};

  private socket: WebSocket | null = null;

  private nextID = 1;

  private readonly pending = new Map<number, Pending>();

  private readonly options: RelayClientOptions;

  private disposed = false;

  private backoff = BACKOFF_MIN_MS;

  private constructor(options: RelayClientOptions) {
    this.options = options;
  }

  // Resolves once the first connection is welcomed; rejects if that dial fails.
  static async open(options: RelayClientOptions): Promise<RelayClient> {
    const client = new RelayClient(options);

    await client.openSocket();

    return client;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendRequest(
    m: string,
    p?: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const socket = this.socket;

    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new RelayError('internal', 'relay connection is down'));
    }

    const id = this.nextID++;
    const resolvers = Promise.withResolvers<Readonly<Record<string, unknown>>>();

    this.pending.set(id, resolvers);
    socket.send(encodeMessage({ v: PROTOCOL_V, id, m, ...(p === undefined ? {} : { p }) }));

    return resolvers.promise;
  }

  dispose(): void {
    this.disposed = true;
    this.socket?.close(1000, 'client closed');
    this.drainPending('client closed');
  }

  private openSocket(): Promise<void> {
    const resolvers = Promise.withResolvers<void>();

    const socket = new WebSocket(this.options.url, { headers: this.options.headers ?? {} });

    let welcomed = false;

    socket.addEventListener('message', (event) => {
      const frame = typeof event.data === 'string' ? event.data : '';
      const decoded = decodeMessage(frame);

      if (decoded.kind === 'event' && decoded.msg.ev === 'Welcome') {
        this.backoff = BACKOFF_MIN_MS;
        welcomed = true;

        resolvers.resolve();
        this.onOpen();

        return;
      }

      if (decoded.kind === 'event' && decoded.msg.ev === 'Refused') {
        const code = typeof decoded.msg['code'] === 'number' ? decoded.msg['code'] : 0;
        const reason = typeof decoded.msg['reason'] === 'string' ? decoded.msg['reason'] : '';

        welcomed = true;

        resolvers.reject(new RelayError('internal', `could not connect: ${code} ${reason}`.trim()));
        socket.close(1000, 'refused');

        return;
      }

      this.applyDecoded(decoded);
    });

    socket.addEventListener('error', () => {});

    socket.addEventListener('close', (event) => {
      const detail = `${event.code} ${event.reason}`.trim();

      this.drainPending(`relay closed the connection (${detail})`);

      if (!welcomed) {
        welcomed = true;

        resolvers.reject(new RelayError('internal', `could not connect: ${detail}`));
      }

      if (this.options.reconnect === true && !this.disposed) {
        setTimeout(() => {
          void this.tryOpenSocket();
        }, this.backoff).unref();

        this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
      }
    });

    this.socket = socket;

    return resolvers.promise;
  }

  // A redial that fails schedules the next one itself through the close
  // handler, so a failure here is not an error to surface.
  private async tryOpenSocket(): Promise<void> {
    try {
      await this.openSocket();
    } catch {}
  }

  private applyDecoded(decoded: DecodedMsg): void {
    if (decoded.kind === 'event') {
      this.onEvent(decoded.msg);

      return;
    }

    if (decoded.kind !== 'response') {
      return;
    }

    const waiting = this.pending.get(decoded.msg.id);

    if (waiting === undefined) {
      return;
    }

    this.pending.delete(decoded.msg.id);

    if (decoded.msg.err === undefined) {
      waiting.resolve(decoded.msg.ok ?? {});
    } else {
      waiting.reject(new RelayError(decoded.msg.err.code, decoded.msg.err.msg));
    }
  }

  private drainPending(reason: string): void {
    for (const waiting of this.pending.values()) {
      waiting.reject(new RelayError('internal', reason));
    }

    this.pending.clear();
  }
}
