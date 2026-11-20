// Cliente Valkey mínimo sobre node:net (POL-4: sem dependência nova). Fala o protocolo RESP só com os
// comandos de que a sessão precisa (GET, GETDEL, SET com PX/NX, DEL, INCR, PEXPIRE). Uma conexão, com reconexão
// preguiçosa e fila de comandos. Só loopback (VALKEY_URL do .env.sante). Nenhum valor vai a log.
import { createConnection, type Socket } from 'node:net';
import type { ArmazemSessao } from './armazem.js';

type Resolver = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class ClienteValkey {
  private socket: Socket | null = null;
  private conectando: Promise<void> | null = null;
  private readonly fila: Resolver[] = [];
  private buffer = Buffer.alloc(0);
  private fechado = false;

  constructor(
    private readonly host: string,
    private readonly porta: number,
  ) {}

  private conectar(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.conectando) return this.conectando;
    this.conectando = new Promise<void>((resolve, reject) => {
      const s = createConnection({ host: this.host, port: this.porta });
      s.setNoDelay(true);
      s.on('connect', () => {
        this.socket = s;
        this.conectando = null;
        resolve();
      });
      s.on('data', (d) => this.aoReceber(d));
      s.on('error', (e) => {
        this.conectando = null;
        this.falharFila(e);
        reject(e);
      });
      s.on('close', () => {
        this.socket = null;
        // Resto de resposta da conexão antiga não pode corromper a análise depois da reconexão.
        this.buffer = Buffer.alloc(0);
        this.falharFila(new Error('Conexão Valkey fechada.'));
      });
    });
    return this.conectando;
  }

  private falharFila(e: Error): void {
    while (this.fila.length) this.fila.shift()!.reject(e);
  }

  private aoReceber(d: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, d]);
    let r = this.analisar();
    while (r) {
      this.buffer = this.buffer.subarray(r.consumido);
      const pedido = this.fila.shift();
      if (pedido) {
        if (r.valor instanceof Error) pedido.reject(r.valor);
        else pedido.resolve(r.valor);
      }
      r = this.analisar();
    }
  }

  /** Analisa UMA resposta RESP do início do buffer; null se ainda não chegou inteira. */
  private analisar(inicio = 0): { valor: unknown; consumido: number } | null {
    if (inicio >= this.buffer.length) return null;
    const tipo = String.fromCharCode(this.buffer[inicio]!);
    const fim = this.buffer.indexOf('\r\n', inicio);
    if (fim === -1) return null;
    const corpo = this.buffer.toString('utf8', inicio + 1, fim);
    const apos = fim + 2;
    if (tipo === '+') return { valor: corpo, consumido: apos };
    if (tipo === '-') return { valor: new Error(corpo), consumido: apos };
    if (tipo === ':') return { valor: Number(corpo), consumido: apos };
    if (tipo === '$') {
      const n = Number(corpo);
      if (n === -1) return { valor: null, consumido: apos };
      if (apos + n + 2 > this.buffer.length) return null;
      return { valor: this.buffer.toString('utf8', apos, apos + n), consumido: apos + n + 2 };
    }
    return { valor: null, consumido: apos };
  }

  private async comando(partes: (string | number)[]): Promise<unknown> {
    if (this.fechado) throw new Error('Cliente Valkey encerrado.');
    await this.conectar();
    const s = this.socket;
    if (!s) throw new Error('Sem conexão Valkey.');
    let pedido = `*${partes.length}\r\n`;
    for (const p of partes) {
      const v = String(p);
      pedido += `$${Buffer.byteLength(v)}\r\n${v}\r\n`;
    }
    return new Promise((resolve, reject) => {
      this.fila.push({ resolve, reject });
      s.write(pedido, (e) => {
        if (e) reject(e);
      });
    });
  }

  async get(chave: string): Promise<string | null> {
    return (await this.comando(['GET', chave])) as string | null;
  }
  /** GETDEL: lê e apaga atomicamente (Valkey/Redis 6.2+). */
  async getdel(chave: string): Promise<string | null> {
    return (await this.comando(['GETDEL', chave])) as string | null;
  }
  async setPx(chave: string, valor: string, ttlMs: number): Promise<void> {
    await this.comando(['SET', chave, valor, 'PX', ttlMs]);
  }
  /** Prazo restante em ms (-1 sem prazo, -2 inexistente). */
  async pttl(chave: string): Promise<number> {
    return (await this.comando(['PTTL', chave])) as number;
  }
  async del(chave: string): Promise<void> {
    await this.comando(['DEL', chave]);
  }
  async incrComTtl(chave: string, ttlMs: number): Promise<number> {
    const n = (await this.comando(['INCR', chave])) as number;
    // NX: só põe o prazo se a chave ainda não tem (a cada chamada, para nunca ficar sem prazo se o
    // processo cair entre o INCR e o PEXPIRE).
    await this.comando(['PEXPIRE', chave, ttlMs, 'NX']);
    return n;
  }
  async encerrar(): Promise<void> {
    this.fechado = true;
    this.socket?.end();
    this.socket = null;
  }
}

/** Adapta o cliente ao ArmazemSessao. VALKEY_URL no formato redis://host:porta (só loopback). */
export class ArmazemValkey implements ArmazemSessao {
  private readonly cliente: ClienteValkey;
  constructor(url: string) {
    const u = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) {
      throw new Error('VALKEY_URL fora do loopback (convencoes.md §10).');
    }
    this.cliente = new ClienteValkey(u.hostname, Number(u.port || 6379));
  }
  obter(chave: string): Promise<string | null> {
    return this.cliente.get(chave);
  }
  async gravar(chave: string, valor: string, ttlSegundos: number): Promise<void> {
    await this.cliente.setPx(chave, valor, ttlSegundos * 1000);
  }
  apagar(chave: string): Promise<void> {
    return this.cliente.del(chave);
  }
  consumir(chave: string): Promise<string | null> {
    return this.cliente.getdel(chave);
  }
  incrementar(chave: string, ttlSegundos: number): Promise<number> {
    return this.cliente.incrComTtl(chave, ttlSegundos * 1000);
  }
  encerrar(): Promise<void> {
    return this.cliente.encerrar();
  }
}
