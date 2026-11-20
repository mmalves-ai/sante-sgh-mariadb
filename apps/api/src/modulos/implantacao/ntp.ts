// W0-09 (M2): cliente SNTP mínimo (RFC 4330) para a hora confiável. Uma consulta UDP à porta 123 do servidor do
// parâmetro (NTP.br por padrão), com prazo curto; devolve o deslocamento do relógio local para o do NTP (ms, o
// `offset` do SNTP) ou nulo quando não há resposta (sem acesso de rede: o painel mostra 'sem referência'). Só leitura.
import { createSocket } from 'node:dgram';

/** Segundos entre 1900-01-01 (época do NTP) e 1970-01-01 (época Unix). */
const EPOCA_NTP_S = 2_208_988_800;
const PRAZO_PADRAO_MS = 1_500;

export type ConsultaNtp = (servidor: string) => Promise<number | null>;

/** Lê um carimbo NTP de 64 bits (segundos + fração) do pacote, em ms Unix. */
export function carimboNtpMs(b: Buffer, pos: number): number {
  const s = b.readUInt32BE(pos);
  const f = b.readUInt32BE(pos + 4);
  return (s - EPOCA_NTP_S) * 1000 + (f / 0x1_0000_0000) * 1000;
}

/** O deslocamento do SNTP: ((T2 − T1) + (T3 − T4)) / 2. */
export function deslocamentoSntp(t1: number, t2: number, t3: number, t4: number): number {
  return (t2 - t1 + (t3 - t4)) / 2;
}

/** Monta o pedido do cliente (LI=0, VN=4, modo 3); o carimbo de saída fica zerado (o T1 é medido localmente). */
export function pedidoSntp(): Buffer {
  const b = Buffer.alloc(48);
  b[0] = (0 << 6) | (4 << 3) | 3;
  return b;
}

export interface OpcoesNtp {
  readonly prazoMs?: number;
  /** Porta UDP do servidor (123; o teste usa um servidor falso local). */
  readonly porta?: number;
  readonly agora?: () => number;
}

export function consultarNtp(o: OpcoesNtp = {}): ConsultaNtp {
  const prazoMs = o.prazoMs ?? PRAZO_PADRAO_MS;
  const porta = o.porta ?? 123;
  const agora = o.agora ?? (() => Date.now());
  return (servidor) =>
    new Promise<number | null>((resolve) => {
      const sock = createSocket('udp4');
      let feito = false;
      const fim = (v: number | null) => {
        if (feito) return;
        feito = true;
        clearTimeout(t);
        try {
          sock.close();
        } catch {
          /* já fechado */
        }
        resolve(v);
      };
      const t = setTimeout(() => fim(null), prazoMs);
      sock.on('error', () => fim(null));
      let t1 = 0;
      sock.on('message', (msg) => {
        const t4 = agora();
        if (msg.length < 48 || (msg[0]! & 0x07) !== 4 || msg[1] === 0) return fim(null);
        fim(deslocamentoSntp(t1, carimboNtpMs(msg, 32), carimboNtpMs(msg, 40), t4));
      });
      t1 = agora();
      sock.send(pedidoSntp(), porta, servidor, (erro) => {
        if (erro) fim(null);
      });
    });
}
