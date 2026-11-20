// Regras 3 e 4: parâmetros tipados com os relativos resolvidos, a máscara do dado de pessoa, os totais e a
// justificativa da exportação.
import { esquemaParametrosRelatorio, relatorioDoCatalogo, RELATORIOS_CATALOGO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  exportacaoExigeJustificativa,
  MASCARA,
  mascararLinhas,
  resolverDataRelativa,
  resolverMesRelativo,
  resolverParametros,
  textoCanonicoParametros,
  totaisDasLinhas,
} from './catalogo.js';

const contas = relatorioDoCatalogo('contasNaoFechadas')!;
const glosas = relatorioDoCatalogo('glosasPorConvenio')!;

describe('catálogo de relatórios: parâmetros, máscara e exportação', () => {
  it('datas e meses relativos no dia do envio', () => {
    expect(resolverDataRelativa('ontem', '2026-03-01')).toBe('2026-02-28');
    expect(resolverDataRelativa('inicioDoMes', '2026-03-15')).toBe('2026-03-01');
    expect(resolverDataRelativa('inicioDoMesAnterior', '2026-01-15')).toBe('2025-12-01');
    expect(resolverDataRelativa('fimDoMesAnterior', '2026-03-15')).toBe('2026-02-28');
    expect(resolverDataRelativa('2026-01-02', '2026-03-15')).toBe('2026-01-02');
    expect(resolverMesRelativo('mesAnterior', '2026-01-10')).toBe('2025-12');
    expect(resolverMesRelativo('mesAtual', '2026-01-10')).toBe('2026-01');
  });

  it('os padrões e relativos resolvidos passam no Zod do relatório; fora do tipo é recusado', () => {
    const v = resolverParametros(glosas, {}, '2026-07-10');
    expect(v).toEqual({ mesInicio: '2026-06', mesFim: '2026-06', regua: 'competencia' });
    expect(esquemaParametrosRelatorio(glosas).safeParse(v).success).toBe(true);
    expect(esquemaParametrosRelatorio(glosas).safeParse({ ...v, regua: 'caixa' }).success).toBe(false);
    expect(esquemaParametrosRelatorio(glosas).safeParse({ ...v, extra: 1 }).success).toBe(false);
    const c = resolverParametros(contas, { inicio: 'ontem', convenio: 3 }, '2026-07-10');
    expect(c).toEqual({ inicio: '2026-07-09', fim: '2026-07-10', tipo: 'todas', convenio: 3 });
    expect(esquemaParametrosRelatorio(contas).safeParse(c).success).toBe(true);
    expect(esquemaParametrosRelatorio(contas).safeParse({ ...c, inicio: '2026-02-30' }).success).toBe(false);
    expect(esquemaParametrosRelatorio(contas).safeParse({ ...c, inicio: '2026-08-01' }).success).toBe(false);
    expect(esquemaParametrosRelatorio(contas).safeParse({ ...c, inicio: '2025-01-01' }).success).toBe(false);
    for (const r of RELATORIOS_CATALOGO)
      expect(
        esquemaParametrosRelatorio(r).safeParse(resolverParametros(r, {}, '2026-07-10')).success,
        r.codigo,
      ).toBe(true);
  });

  it('a coluna de dado de pessoa sai mascarada sem a permissão; o vazio fica vazio', () => {
    const linhas = [
      { conta: 1, paciente: 'Paciente Fictício Um' },
      { conta: 2, paciente: null },
    ];
    const m = mascararLinhas(contas, linhas, false);
    expect(m.mascarado).toBe(true);
    expect(m.linhas).toEqual([
      { conta: 1, paciente: MASCARA },
      { conta: 2, paciente: null },
    ]);
    expect(mascararLinhas(contas, linhas, true)).toEqual({ linhas, mascarado: false });
    expect(mascararLinhas(glosas, [{ glosa: 1 }], false).mascarado).toBe(false);
  });

  it('exportar sem máscara com dado de pessoa exige justificativa; mascarado ou sem dado de pessoa, não', () => {
    expect(exportacaoExigeJustificativa(contas, false)).toBe(true);
    expect(exportacaoExigeJustificativa(contas, true)).toBe(false);
    expect(exportacaoExigeJustificativa(glosas, false)).toBe(false);
  });

  it('totais e o texto canônico dos parâmetros', () => {
    expect(
      totaisDasLinhas(glosas, [
        { glosa: 1.105, itensBaixados: 2 },
        { glosa: 2.2, itensBaixados: 1 },
      ]),
    ).toEqual({
      itensBaixados: 3,
      cobradoBaixado: 0,
      pagoBaixado: 0,
      glosa: 3.31,
    });
    expect(textoCanonicoParametros({ b: 1, a: 'x' })).toBe('{"a":"x","b":1}');
  });
});
