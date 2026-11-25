import { describe, expect, it } from 'vitest';
import {
  type AnalitoCatalogo,
  calcularFormula,
  planejarProcedimentoOperacional,
  type ProcedimentoOperacional,
  validarAnalito,
} from './analito-pop.js';

const analito: AnalitoCatalogo = {
  codigo: 'GLI',
  nome: 'Glicose',
  sigla: 'GLI',
  tipoResultado: 'numerico',
  casasDecimais: 0,
  unidadeResultadoId: 1,
  limiteMinimoAceito: 1,
  limiteMaximoAceito: 2000,
  pulaNaDigitacao: false,
};
const campos = (f: readonly { campo: string }[]) => f.map((x) => x.campo);

describe('validarAnalito', () => {
  it('aceita o analito numérico completo', () => {
    expect(validarAnalito(analito)).toEqual([]);
  });
  it('recusa código com espaço, nome curto e tipo desconhecido', () => {
    expect(campos(validarAnalito({ ...analito, codigo: 'G L', nome: 'G', tipoResultado: 'x' }))).toEqual([
      'codigo',
      'nome',
      'tipoResultado',
      'casasDecimais',
      'limiteMinimoAceito',
    ]);
  });
  it('recusa limite mínimo acima do máximo e casas acima de 6', () => {
    expect(
      campos(validarAnalito({ ...analito, limiteMinimoAceito: 10, limiteMaximoAceito: 5, casasDecimais: 7 })),
    ).toEqual(['casasDecimais', 'limiteMaximoAceito']);
  });
  it('texto não leva casas decimais nem limite aceito', () => {
    expect(campos(validarAnalito({ ...analito, tipoResultado: 'texto' }))).toEqual([
      'casasDecimais',
      'limiteMinimoAceito',
    ]);
    expect(
      validarAnalito({
        ...analito,
        tipoResultado: 'texto',
        casasDecimais: null,
        limiteMinimoAceito: null,
        limiteMaximoAceito: null,
      }),
    ).toEqual([]);
  });
  it('o calculado não para na digitação', () => {
    expect(campos(validarAnalito({ ...analito, tipoResultado: 'calculado' }))).toEqual(['pulaNaDigitacao']);
    expect(validarAnalito({ ...analito, tipoResultado: 'calculado', pulaNaDigitacao: true })).toEqual([]);
  });
});

const pop: ProcedimentoOperacional = {
  id: null,
  codigoDocumento: 'POP-LAB-001',
  titulo: 'Dosagem de glicose',
  versaoDocumento: 1,
  situacao: 'rascunho',
  aprovadoPorProfissionalId: null,
  aprovadoEm: null,
  vigenciaInicio: null,
  vigenciaFim: null,
  proximaRevisaoEm: null,
};
const HOJE = '2026-11-24';

describe('planejarProcedimentoOperacional', () => {
  it('nasce em rascunho, na versão seguinte e sem outra versão aberta', () => {
    expect(planejarProcedimentoOperacional(pop, null, [], true, HOJE).falhas).toEqual([]);
    expect(
      campos(planejarProcedimentoOperacional({ ...pop, situacao: 'aprovado' }, null, [], true, HOJE).falhas),
    ).toContain('situacao');
    const outras = [
      { id: 1, versaoDocumento: 1, situacao: 'rascunho' as const, vigenciaInicio: null, vigenciaFim: null },
    ];
    expect(
      campos(
        planejarProcedimentoOperacional({ ...pop, versaoDocumento: 2 }, null, outras, true, HOJE).falhas,
      ),
    ).toEqual(['versaoDocumento']);
    expect(
      planejarProcedimentoOperacional({ ...pop, versaoDocumento: 3 }, null, [], true, HOJE).falhas[0]
        ?.mensagem,
    ).toBe('A próxima versão do documento é a 1.');
  });
  it('não pula a revisão nem volta do aprovado', () => {
    const atual = { ...pop, id: 5 };
    expect(
      campos(
        planejarProcedimentoOperacional(
          {
            ...atual,
            situacao: 'aprovado',
            aprovadoPorProfissionalId: 1,
            aprovadoEm: HOJE,
            vigenciaInicio: HOJE,
          },
          atual,
          [],
          false,
          HOJE,
        ).falhas,
      ),
    ).toEqual(['situacao']);
    const aprovado = {
      ...atual,
      situacao: 'aprovado' as const,
      aprovadoPorProfissionalId: 1,
      aprovadoEm: HOJE,
      vigenciaInicio: HOJE,
    };
    expect(
      campos(
        planejarProcedimentoOperacional({ ...aprovado, situacao: 'rascunho' }, aprovado, [], false, HOJE)
          .falhas,
      ),
    ).toEqual(['situacao']);
    expect(
      campos(
        planejarProcedimentoOperacional({ ...aprovado, titulo: 'Outro título' }, aprovado, [], true, HOJE)
          .falhas,
      ),
    ).toEqual(['situacao']);
    expect(
      planejarProcedimentoOperacional(
        { ...aprovado, situacao: 'obsoleto', vigenciaFim: '2026-12-01' },
        aprovado,
        [],
        false,
        HOJE,
      ).falhas,
    ).toEqual([]);
  });
  it('a aprovação exige quem aprova, a data e a vigência que não começa no passado', () => {
    const revisao = { ...pop, id: 5, situacao: 'em_revisao' as const };
    expect(
      campos(
        planejarProcedimentoOperacional({ ...revisao, situacao: 'aprovado' }, revisao, [], false, HOJE)
          .falhas,
      ),
    ).toEqual(['aprovadoPorProfissionalId', 'aprovadoEm', 'vigenciaInicio']);
    expect(
      campos(
        planejarProcedimentoOperacional(
          {
            ...revisao,
            situacao: 'aprovado',
            aprovadoPorProfissionalId: 1,
            aprovadoEm: HOJE,
            vigenciaInicio: '2026-11-01',
            proximaRevisaoEm: '2026-10-01',
          },
          revisao,
          [],
          false,
          HOJE,
        ).falhas,
      ),
    ).toEqual(['vigenciaInicio', 'proximaRevisaoEm']);
  });
  it('aprovar a versão 2 torna obsoleta a 1 aprovada, com a vigência encerrada na véspera', () => {
    const v2 = { ...pop, id: 6, versaoDocumento: 2, situacao: 'em_revisao' as const };
    const outras = [
      {
        id: 5,
        versaoDocumento: 1,
        situacao: 'aprovado' as const,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      },
    ];
    const r = planejarProcedimentoOperacional(
      {
        ...v2,
        situacao: 'aprovado',
        aprovadoPorProfissionalId: 1,
        aprovadoEm: HOJE,
        vigenciaInicio: '2026-12-01',
      },
      v2,
      outras,
      false,
      HOJE,
    );
    expect(r.falhas).toEqual([]);
    expect(r.plano.obsoletar).toEqual([{ id: 5, vigenciaFim: '2026-11-30' }]);
  });
});

describe('calcularFormula', () => {
  it('calcula com precedência, potência à direita, menos unário e funções', () => {
    expect(calcularFormula('A + B * 2', { A: 1, B: 3 })).toEqual({ ok: true, valor: 7 });
    expect(calcularFormula('(A + B) * 2', { A: 1, B: 3 })).toEqual({ ok: true, valor: 8 });
    expect(calcularFormula('2 ^ 3 ^ 2', {})).toEqual({ ok: true, valor: 512 });
    expect(calcularFormula('-2 ^ 2', {})).toEqual({ ok: true, valor: -4 });
    expect(calcularFormula('max(A, B, 10) + raiz(16) + pot(2, 3)', { A: 1, B: 3 })).toEqual({
      ok: true,
      valor: 22,
    });
    expect(calcularFormula('arred(A / 3, 2)', { A: 10 })).toEqual({ ok: true, valor: 3.33 });
  });
  it('LDL de Friedewald com casas decimais', () => {
    expect(calcularFormula('CT - HDL - TG / 5', { CT: 200, HDL: 50, TG: 151 }, 1)).toEqual({
      ok: true,
      valor: 119.8,
    });
  });
  it('não calcula sem valor, com divisão por zero, raiz de negativo ou expressão quebrada', () => {
    expect(calcularFormula('A + B', { A: 1, B: null })).toEqual({ ok: false, motivo: 'Falta o valor de B.' });
    expect(calcularFormula('A / B', { A: 1, B: 0 })).toEqual({ ok: false, motivo: 'Divisão por zero.' });
    expect(calcularFormula('raiz(A)', { A: -1 })).toEqual({ ok: false, motivo: 'Raiz de número negativo.' });
    expect(calcularFormula('(A + 1', { A: 1 }).ok).toBe(false);
    expect(calcularFormula('A 1', { A: 1 }).ok).toBe(false);
    expect(calcularFormula('A; 1', { A: 1 }).ok).toBe(false);
    expect(calcularFormula('', {}).ok).toBe(false);
  });
});
