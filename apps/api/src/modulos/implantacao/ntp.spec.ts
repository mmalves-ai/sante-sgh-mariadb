// W0-09 (M2): o cliente SNTP contra um servidor NTP falso local (127.0.0.1, porta efêmera): sem rede externa.
import { createSocket } from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { carimboNtpMs, consultarNtp, deslocamentoSntp, pedidoSntp } from './ntp.js';

const EPOCA = 2_208_988_800;
function escrever(b: Buffer, pos: number, ms: number) {
  const s = Math.floor(ms / 1000);
  b.writeUInt32BE(s + EPOCA, pos);
  b.writeUInt32BE(Math.round(((ms - s * 1000) / 1000) * 0x1_0000_0000), pos + 4);
}

describe('W0-09 (M2): cliente SNTP', () => {
  it('carimbo e deslocamento', () => {
    const b = Buffer.alloc(48);
    escrever(b, 32, Date.UTC(2026, 10, 18, 12, 0, 0, 500));
    expect(Math.round(carimboNtpMs(b, 32))).toBe(Date.UTC(2026, 10, 18, 12, 0, 0, 500));
    expect(deslocamentoSntp(1000, 3010, 3020, 1030)).toBe(2000);
    expect(pedidoSntp()[0]).toBe(0x23);
  });

  it('servidor falso adiantado 2 s: o deslocamento sai ~2000 ms; sem resposta, nulo', async () => {
    const srv = createSocket('udp4');
    srv.on('message', (msg, de) => {
      if (msg[0] !== 0x23) return;
      const r = Buffer.alloc(48);
      r[0] = (0 << 6) | (4 << 3) | 4;
      r[1] = 1;
      const agora = Date.now() + 2_000;
      escrever(r, 32, agora);
      escrever(r, 40, agora);
      srv.send(r, de.port, de.address);
    });
    await new Promise<void>((ok) => srv.bind(0, '127.0.0.1', ok));
    const porta = srv.address().port;
    try {
      const d = await consultarNtp({ prazoMs: 1_000, porta })('127.0.0.1');
      expect(d).not.toBeNull();
      expect(Math.abs((d ?? 0) - 2_000)).toBeLessThan(200);
      // Ninguém responde: o prazo vence e sai nulo ('sem referência').
      srv.removeAllListeners('message');
      expect(await consultarNtp({ prazoMs: 200, porta })('127.0.0.1')).toBeNull();
    } finally {
      srv.close();
    }
  });
});
