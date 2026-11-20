// Regra 11 do M52: a marcação original nunca é alterada; o ajuste é registro novo com motivo e aprovador (quem pediu não
// aprova), e o período fechado não recebe ajuste. As marcações do espelho são as originais (as desconsideradas riscadas)
// mais as incluídas por ajuste aprovado.
import { describe, expect, it } from 'vitest';
import {
  type AjusteLido,
  type ContextoAjuste,
  conferirAjuste,
  conferirDecisao,
  justificativasAprovadas,
  marcacoesEfetivas,
} from './ajuste.js';

const ctx = (extra: Partial<ContextoAjuste> = {}): ContextoAjuste => ({
  hoje: '2026-10-10',
  admissao: '2026-01-01',
  desligamento: null,
  periodoFechado: false,
  originais: [
    { id: 11, instante: '2026-09-02T07:01' },
    { id: 12, instante: '2026-09-02T19:02' },
  ],
  ajustes: [],
  movimentos: [7, 8, 9],
  ...extra,
});
const aj = (x: Partial<AjusteLido>): AjusteLido => ({
  id: 1,
  tipo: 'inclusao',
  dia: '2026-09-02',
  marcacao: null,
  instante: null,
  movimento: null,
  minutos: null,
  situacao: 'pendente',
  pedidoPor: 'SINT.RH',
  ...x,
});
const inclusao = (instante: string) =>
  ({
    tipo: 'inclusao',
    dia: '2026-09-02',
    marcacao: null,
    instante,
    movimento: null,
    minutos: null,
  }) as const;

describe('ajuste (regra 11)', () => {
  it('inclusão: no dia ou na manhã seguinte (saída do plantão noturno), sem repetir marcação', () => {
    expect(conferirAjuste(inclusao('2026-09-02T12:00'), ctx())).toBeNull();
    expect(conferirAjuste(inclusao('2026-09-03T07:00'), ctx())).toBeNull();
    expect(conferirAjuste(inclusao('2026-09-03T12:00'), ctx())?.codigo).toBe('instante-fora-do-dia');
    expect(conferirAjuste(inclusao('2026-09-01T23:00'), ctx())?.codigo).toBe('instante-fora-do-dia');
    expect(conferirAjuste(inclusao('2026-09-02T07:01'), ctx())?.codigo).toBe('marcacao-existente');
    const pedida = ctx({ ajustes: [aj({ instante: '2026-09-02T12:00' })] });
    expect(conferirAjuste(inclusao('2026-09-02T12:00'), pedida)?.codigo).toBe('marcacao-existente');
    const recusada = ctx({ ajustes: [aj({ instante: '2026-09-02T12:00', situacao: 'recusado' })] });
    expect(conferirAjuste(inclusao('2026-09-02T12:00'), recusada)).toBeNull();
    expect(conferirAjuste({ ...inclusao('x'), instante: null }, ctx())?.codigo).toBe('instante');
  });

  it('desconsiderar: só marcação do colaborador, uma vez', () => {
    const d = {
      tipo: 'desconsiderar',
      dia: '2026-09-02',
      marcacao: 12,
      instante: null,
      movimento: null,
      minutos: null,
    } as const;
    expect(conferirAjuste(d, ctx())).toBeNull();
    expect(conferirAjuste({ ...d, marcacao: 99 }, ctx())?.codigo).toBe('marcacao-inexistente');
    expect(conferirAjuste({ ...d, marcacao: null }, ctx())?.codigo).toBe('marcacao-inexistente');
    const ja = ctx({ ajustes: [aj({ tipo: 'desconsiderar', marcacao: 12 })] });
    expect(conferirAjuste(d, ja)?.codigo).toBe('ja-desconsiderada');
  });

  it('justificativa: tipo do ramo, minutos de 1 a 1.440 ou o dia inteiro, uma vez o dia inteiro', () => {
    const j = {
      tipo: 'justificativa',
      dia: '2026-09-02',
      marcacao: null,
      instante: null,
      movimento: 7,
      minutos: null,
    } as const;
    expect(conferirAjuste(j, ctx())).toBeNull();
    expect(conferirAjuste({ ...j, movimento: 99 }, ctx())?.codigo).toBe('movimento');
    expect(conferirAjuste({ ...j, minutos: 0 }, ctx())?.codigo).toBe('minutos');
    const inteiro = ctx({ ajustes: [aj({ tipo: 'justificativa', movimento: 7, minutos: null })] });
    expect(conferirAjuste(j, inteiro)?.codigo).toBe('dia-ja-justificado');
  });

  it('período fechado, dia futuro, antes da admissão e depois do desligamento', () => {
    const i = inclusao('2026-09-02T12:00');
    expect(conferirAjuste(i, ctx({ periodoFechado: true }))?.codigo).toBe('periodo-fechado');
    expect(conferirAjuste(i, ctx({ hoje: '2026-09-01' }))?.codigo).toBe('dia-futuro');
    expect(conferirAjuste(i, ctx({ admissao: '2026-09-03' }))?.codigo).toBe('antes-da-admissao');
    expect(conferirAjuste(i, ctx({ desligamento: '2026-09-01' }))?.codigo).toBe('depois-do-desligamento');
  });

  it('decisão: só o pendente, por OUTRA pessoa, com o período aberto', () => {
    expect(conferirDecisao(aj({}), 'SINT.PONTO', false)).toBeNull();
    expect(conferirDecisao(aj({}), 'sint.rh', false)?.codigo).toBe('aprovador-e-solicitante');
    expect(conferirDecisao(aj({ situacao: 'aprovado' }), 'SINT.PONTO', false)?.codigo).toBe('ja-decidido');
    expect(conferirDecisao(aj({}), 'SINT.PONTO', true)?.codigo).toBe('periodo-fechado');
  });

  it('marcações efetivas: a original desconsiderada continua (riscada); a incluída aprovada entra; pendente não', () => {
    const r = marcacoesEfetivas(ctx().originais, [
      aj({ id: 5, tipo: 'desconsiderar', marcacao: 12, situacao: 'aprovado' }),
      aj({ id: 6, tipo: 'inclusao', instante: '2026-09-02T19:00', situacao: 'aprovado' }),
      aj({ id: 7, tipo: 'inclusao', instante: '2026-09-02T12:00', situacao: 'pendente' }),
    ]);
    expect(r).toEqual([
      { id: 11, instante: '2026-09-02T07:01', fonte: 'O', ajuste: null, desconsiderada: false },
      { id: null, instante: '2026-09-02T19:00', fonte: 'I', ajuste: 6, desconsiderada: false },
      { id: 12, instante: '2026-09-02T19:02', fonte: 'O', ajuste: 5, desconsiderada: true },
    ]);
    const empate = marcacoesEfetivas(
      [{ id: 1, instante: '2026-09-02T07:00' }],
      [aj({ id: 2, instante: '2026-09-02T07:00', situacao: 'aprovado' })],
    );
    expect(empate.map((x) => x.fonte)).toEqual(['I', 'O']);
  });

  it('justificativas aprovadas', () => {
    expect(
      justificativasAprovadas([
        aj({ tipo: 'justificativa', movimento: 7, minutos: 30, situacao: 'aprovado' }),
        aj({ tipo: 'justificativa', movimento: 8, situacao: 'pendente' }),
      ]),
    ).toEqual([{ dia: '2026-09-02', movimento: 7, minutos: 30 }]);
  });
});
