import { describe, expect, it } from 'vitest';
import {
  codigosNaUnificacao,
  errosDesfazerUnificacao,
  errosUnificacao,
  solicitanteVigente,
} from './unificacao.js';

const vivo = (id: number) => ({ id, ativo: true, sucessor: null });
const MOTIVO = 'mesmo médico digitado duas vezes';

describe('unificação de solicitante externo (02-CAD linha 20)', () => {
  it('aceita unificar um cadastro vivo ou inativo num cadastro vivo, com o motivo', () => {
    expect(errosUnificacao({ mantido: vivo(1), absorvido: vivo(2), motivo: MOTIVO })).toEqual([]);
    expect(
      errosUnificacao({
        mantido: vivo(1),
        absorvido: { id: 2, ativo: false, sucessor: null },
        motivo: MOTIVO,
      }),
    ).toEqual([]);
  });

  it('recusa o mesmo cadastro, o já unificado, o destino inativo ou unificado e o motivo curto', () => {
    expect(errosUnificacao({ mantido: vivo(1), absorvido: vivo(1), motivo: MOTIVO })).toEqual([
      'mesmo-cadastro',
    ]);
    expect(
      errosUnificacao({ mantido: vivo(1), absorvido: { id: 2, ativo: false, sucessor: 3 }, motivo: MOTIVO }),
    ).toEqual(['absorvido-ja-unificado']);
    expect(
      errosUnificacao({ mantido: { id: 1, ativo: false, sucessor: 9 }, absorvido: vivo(2), motivo: MOTIVO }),
    ).toEqual(['mantido-unificado']);
    expect(
      errosUnificacao({
        mantido: { id: 1, ativo: false, sucessor: null },
        absorvido: vivo(2),
        motivo: ' curto  ',
      }),
    ).toEqual(['mantido-inativo', 'motivo-curto']);
  });

  it('herda o código só na fonte em que o cadastro que continua não tem linha; aponta a divergência', () => {
    const r = codigosNaUnificacao(
      [
        { fonte: 10, codigo: 'AB-1', ativo: true },
        { fonte: 11, codigo: 'x9', ativo: true },
        { fonte: 12, codigo: 'ANTIGO', ativo: false },
      ],
      [
        { fonte: 10, codigo: 'AB-2', ativo: true }, // diverge: fica o do que continua
        { fonte: 11, codigo: ' X9 ', ativo: true }, // igual sem caixa nem espaço: nada a fazer
        { fonte: 12, codigo: 'NOVO', ativo: true }, // o que continua já tem linha (inativa): não herda
        { fonte: 13, codigo: 'H-1', ativo: true }, // herda
        { fonte: 14, codigo: 'H-2', ativo: false }, // inativo no absorvido: não herda
      ],
    );
    expect(r.herdar).toEqual([{ fonte: 13, codigo: 'H-1', ativo: true }]);
    expect(r.divergentes).toEqual([10]);
  });

  it('desfazer exige que o cadastro esteja unificado e o motivo', () => {
    expect(
      errosDesfazerUnificacao({ absorvido: { id: 2, ativo: false, sucessor: 1 }, motivo: MOTIVO }),
    ).toEqual([]);
    expect(errosDesfazerUnificacao({ absorvido: vivo(2), motivo: 'curto' })).toEqual([
      'nao-unificado',
      'motivo-curto',
    ]);
  });

  it('o cadastro que responde hoje segue o ponteiro até o fim e não gira em ciclo', () => {
    const m = new Map<number, number | null>([
      [1, null],
      [2, 1],
      [3, 2],
      [7, 8],
      [8, 7],
    ]);
    expect(solicitanteVigente(3, m)).toBe(1);
    expect(solicitanteVigente(1, m)).toBe(1);
    expect(solicitanteVigente(99, m)).toBe(99);
    expect(solicitanteVigente(7, m)).toBe(7);
  });
});
