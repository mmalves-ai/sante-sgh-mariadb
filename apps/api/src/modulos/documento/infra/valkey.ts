// Fila `zpl` no Valkey do Compose (127.0.0.1:63718): reserva atômica da chave de idempotência
// (`SET chave valor NX PX validade`), liberação por comparar-e-apagar (EVAL) quando o envio falha, e a fila
// de verdade por estação (`RPUSH sgh:<rede>:<estabelecimento>:zpl:fila:<estacao>`), que o QZ Tray da estação
// consome. Cliente RESP mínimo (SET, GET, EVAL, RPUSH, LLEN, LPOP), sem dependência nova; a fila BullMQ
// completa entra com o outbox do M04. Só redis:// em loopback (trava de saídas). As respostas são lidas em
// bytes (o tamanho do bulk do RESP é em bytes, não em caracteres).
import { connect } from 'node:net';
import type { ArmazemIdempotencia, DestinoFila, TrabalhoZpl } from '@sgh/dominio-documento';

function comando(partes: readonly string[]): string {
  return `*${partes.length}\r\n${partes.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
}

/** Resposta RESP: texto (+OK, bulk), inteiro (:n) ou nulo ($-1). */
export type RespostaValkey = string | number | null;

/** Lê uma resposta RESP completa do buffer (em bytes); undefined se ainda falta chegar. */
export function lerResposta(buf: Buffer): { valor: RespostaValkey } | { erro: string } | undefined {
  const fimLinha = buf.indexOf('\r\n');
  if (fimLinha < 0) return undefined;
  const tipo = String.fromCharCode(buf[0] ?? 0);
  const linha = buf.subarray(1, fimLinha).toString('utf8');
  if (tipo === '+') return { valor: linha };
  if (tipo === '-') return { erro: linha };
  if (tipo === ':') return { valor: Number(linha) };
  if (tipo === '$') {
    const n = Number(linha);
    if (n < 0) return { valor: null };
    const ini = fimLinha + 2;
    if (buf.length < ini + n + 2) return undefined;
    return { valor: buf.subarray(ini, ini + n).toString('utf8') };
  }
  return { erro: `resposta RESP não suportada (${tipo})` };
}

/** Envia um comando e devolve a resposta (+OK, $n bulk, :n inteiro, $-1 nulo; -ERR vira erro). */
export function enviarComando(
  url: string,
  partes: readonly string[],
  tempoMs = 3_000,
): Promise<RespostaValkey> {
  const u = new URL(url);
  if (u.protocol !== 'redis:') return Promise.reject(new Error('VALKEY_URL: só redis://.'));
  return new Promise((ok, falha) => {
    const s = connect({ host: u.hostname, port: Number(u.port || 6379) });
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => {
      s.destroy();
      falha(new Error('Valkey não respondeu.'));
    }, tempoMs);
    s.on('error', (e) => {
      clearTimeout(t);
      falha(e);
    });
    s.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const r = lerResposta(buf);
      if (!r) return;
      clearTimeout(t);
      s.end();
      if ('erro' in r) falha(new Error(`Valkey: ${r.erro}`));
      else ok(r.valor);
    });
    s.write(comando(partes));
  });
}

const COMPARAR_E_APAGAR =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

export class ArmazemValkey implements ArmazemIdempotencia {
  private readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  async reservar(chave: string, valor: string, validadeMs: number): Promise<boolean> {
    return (await enviarComando(this.url, ['SET', chave, valor, 'NX', 'PX', String(validadeMs)])) === 'OK';
  }
  async ler(chave: string): Promise<string | null> {
    const v = await enviarComando(this.url, ['GET', chave]);
    return v === null ? null : String(v);
  }
  async liberar(chave: string, valor: string): Promise<void> {
    await enviarComando(this.url, ['EVAL', COMPARAR_E_APAGAR, '1', chave, valor]);
  }
}

/** Lista da fila zpl de uma estação (ARQ-2: com o código da rede). */
export function listaFilaZpl(t: Pick<TrabalhoZpl, 'rede' | 'estabelecimento' | 'estacao'>): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(t.estacao)) throw new Error('Estação inválida para a fila zpl.');
  return `sgh:${t.rede}:${t.estabelecimento}:zpl:fila:${t.estacao}`;
}

/** Destino real da fila zpl: um item JSON por trabalho na lista da estação. */
export class FilaZplValkey implements DestinoFila {
  private readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  async enviar(t: TrabalhoZpl & { readonly id: string }): Promise<void> {
    const item = JSON.stringify({ id: t.id, modelo: t.modelo, estacao: t.estacao, zpl: t.zpl });
    await enviarComando(this.url, ['RPUSH', listaFilaZpl(t), item]);
  }
  async tamanho(t: Pick<TrabalhoZpl, 'rede' | 'estabelecimento' | 'estacao'>): Promise<number> {
    return Number(await enviarComando(this.url, ['LLEN', listaFilaZpl(t)]));
  }
  /** Retira o próximo trabalho (o consumidor da estação; nos testes, a conferência). */
  async retirar(
    t: Pick<TrabalhoZpl, 'rede' | 'estabelecimento' | 'estacao'>,
  ): Promise<{ id: string; modelo: string; estacao: string; zpl: string } | null> {
    const v = await enviarComando(this.url, ['LPOP', listaFilaZpl(t)]);
    return v === null
      ? null
      : (JSON.parse(String(v)) as { id: string; modelo: string; estacao: string; zpl: string });
  }
}
