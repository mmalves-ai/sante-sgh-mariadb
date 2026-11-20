// Redação do log (ficha do M05 §10): senha, CPF, token CSRF e cookie nunca saem no log do pino. Valores
// sintéticos.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { criarLogger } from './logger.js';

describe('log redigido (pino)', () => {
  it('oculta senha, CPF, CSRF e cookie', () => {
    const linhas: string[] = [];
    const destino = new Writable({
      write(chunk: Buffer, _enc, feito) {
        linhas.push(chunk.toString('utf8'));
        feito();
      },
    });
    const log = criarLogger(destino, 'info');
    log.info(
      {
        corpo: { login: 'SINT.USUARIO', senha: 'Sintetico#2026', cpf: '00000000000', csrf: 'tok-sintetico' },
        req: { headers: { cookie: 'sgh_sessao=abc', 'x-csrf': 'tok-sintetico' } },
      },
      'entrada',
    );
    const saida = linhas.join('');
    expect(saida).toContain('SINT.USUARIO');
    for (const proibido of ['Sintetico#2026', '00000000000', 'tok-sintetico', 'sgh_sessao=abc']) {
      expect(saida).not.toContain(proibido);
    }
    expect(saida).toContain('[oculto]');
  });
});
