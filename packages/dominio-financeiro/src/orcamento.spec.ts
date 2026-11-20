// Regra 14 do M54 (manual m23): orçado × realizado por centro de custo e item gerencial, com o desvio absoluto e
// percentual e as parcelas. Dados sintéticos (centros 10, 20 e 30; itens 210.1.1 despesa e 100.1.1 receita).
import type { LinhaOrcamento, RealizadoOrcamentoLido } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  ajustar,
  chaveDaLinha,
  comparar,
  converterRealizado,
  desvioPercentual,
  distribuirPorPercentual,
  favoravel,
  gerarDoRealizado,
  motivoSemAprovar,
  planejarGravacao,
  recortar,
  somaMeses,
  totaisDaVersao,
  validarLinhas,
} from './orcamento.js';

const doze = (v: number): number[] => Array.from({ length: 12 }, () => v);
const linha = (
  natureza: LinhaOrcamento['natureza'],
  centro: number,
  item: [number, number, number],
  meses: number[],
): LinhaOrcamento => ({
  natureza,
  centro,
  grupo: item[0],
  subgrupo: item[1],
  item: item[2],
  meses,
  totalCentavos: somaMeses(meses),
  observacao: null,
});
const real = (
  natureza: RealizadoOrcamentoLido['natureza'],
  centro: number,
  item: [number, number, number],
  mes: number,
  centavos: number,
): RealizadoOrcamentoLido => ({
  natureza,
  centro,
  grupo: item[0],
  subgrupo: item[1],
  item: item[2],
  mes,
  centavos,
});

const DESP: [number, number, number] = [210, 1, 1];
const REC: [number, number, number] = [100, 1, 1];
const SEM: [number, number, number] = [0, 0, 0];
const rotulos = { centro: (id: number) => `C${id}`, item: (k: { grupo: number }) => `I${k.grupo}` };

describe('validarLinhas', () => {
  const ctx = {
    centros: new Set([10, 20]),
    itens: new Map<string, 'despesa' | 'receita'>([
      ['210.1.1', 'despesa'],
      ['100.1.1', 'receita'],
    ]),
  };
  it('aceita despesa, receita (com ou sem centro) e consumo por centro', () => {
    expect(
      validarLinhas(
        [
          { natureza: 'despesa', centro: 10, grupo: 210, subgrupo: 1, item: 1 },
          { natureza: 'receita', centro: 0, grupo: 100, subgrupo: 1, item: 1 },
          { natureza: 'consumo', centro: 20, grupo: 0, subgrupo: 0, item: 0 },
        ],
        ctx,
      ),
    ).toEqual([]);
  });
  it('recusa centro inexistente, consumo sem centro ou com item, item desconhecido, natureza trocada e repetida', () => {
    const p = validarLinhas(
      [
        { natureza: 'despesa', centro: 99, grupo: 210, subgrupo: 1, item: 1 },
        { natureza: 'consumo', centro: 0, grupo: 0, subgrupo: 0, item: 0 },
        { natureza: 'consumo', centro: 10, grupo: 210, subgrupo: 1, item: 1 },
        { natureza: 'despesa', centro: 10, grupo: 999, subgrupo: 1, item: 1 },
        { natureza: 'receita', centro: 10, grupo: 210, subgrupo: 1, item: 1 },
        { natureza: 'despesa', centro: 20, grupo: 210, subgrupo: 1, item: 1 },
        { natureza: 'despesa', centro: 20, grupo: 210, subgrupo: 1, item: 1 },
      ],
      ctx,
    );
    expect(p.map((x) => x.indice)).toEqual([0, 1, 2, 3, 4, 6]);
    expect(p[4]?.mensagem).toContain('é de despesa');
    expect(p[5]?.mensagem).toContain('duas vezes');
  });
});

describe('planejarGravacao', () => {
  const atuais = [linha('despesa', 10, DESP, doze(100)), linha('despesa', 20, DESP, doze(50))];
  it('inclui, altera, tira a linha zerada e conta as iguais, com os totais antes e depois', () => {
    const p = planejarGravacao(atuais, [
      { ...linha('despesa', 10, DESP, doze(100)), observacao: null },
      { ...linha('despesa', 20, DESP, doze(0)), observacao: null },
      { ...linha('consumo', 10, SEM, doze(10)), observacao: null },
      { ...linha('receita', 0, REC, doze(0)), observacao: null },
    ]);
    expect(p.incluir).toHaveLength(1);
    expect(p.alterar).toHaveLength(0);
    expect(p.remover).toHaveLength(1);
    expect(p.iguais).toBe(2);
    expect(p.linhasDepois).toBe(2);
    // 1200 + 600 antes; depois 1200 + 120 (a de 600 saiu).
    expect(p.totalAntes).toBe(1800);
    expect(p.totalDepois).toBe(1320);
  });
  it('alteração só da observação conta como alteração', () => {
    const p = planejarGravacao(atuais, [{ ...linha('despesa', 10, DESP, doze(100)), observacao: 'revisto' }]);
    expect(p.alterar).toHaveLength(1);
    expect(p.totalDepois).toBe(p.totalAntes);
  });
});

describe('motivoSemAprovar (segregação de funções)', () => {
  const v = { situacao: 'rascunho' as const, linhas: 3, criadoPor: 'ANA', alteradoPor: 'BETO' };
  it('outra pessoa aprova', () => expect(motivoSemAprovar(v, 'CAIO')).toBeNull());
  it('nem quem criou nem quem gravou por último (sem diferença de caixa)', () => {
    expect(motivoSemAprovar(v, 'ana')).toContain('outra pessoa');
    expect(motivoSemAprovar(v, 'BETO ')).toContain('outra pessoa');
  });
  it('só em elaboração e com linhas', () => {
    expect(motivoSemAprovar({ ...v, situacao: 'aprovado' }, 'CAIO')).toContain('elaboração');
    expect(motivoSemAprovar({ ...v, linhas: 0 }, 'CAIO')).toContain('nenhuma linha');
  });
});

describe('distribuirPorPercentual', () => {
  it('as parcelas somam o valor exato (maiores restos)', () => {
    const r = distribuirPorPercentual(100, [33.3333, 33.3333, 33.3334]);
    expect(r.parcelas).toEqual([33, 33, 34]);
    expect(r.parcelas.reduce((s, x) => s + x, 0)).toBe(100);
    expect(r.resto).toBe(0);
  });
  it('percentuais abaixo de 100: a sobra volta no resto', () => {
    const r = distribuirPorPercentual(1000, [60, 30]);
    expect(r.parcelas).toEqual([600, 300]);
    expect(r.resto).toBe(100);
  });
  it('recusa mais de 100%', () => expect(() => distribuirPorPercentual(10, [60, 50])).toThrow(RangeError));
});

describe('desvio e favorável', () => {
  it('desvio percentual com 2 casas, meio para cima, nulo com orçado zero', () => {
    expect(desvioPercentual(300, 400)).toBe(33.33);
    expect(desvioPercentual(300, 200)).toBe(-33.33);
    expect(desvioPercentual(800, 801)).toBe(0.13);
    expect(desvioPercentual(0, 10)).toBeNull();
  });
  it('despesa abaixo e receita acima são favoráveis', () => {
    expect(favoravel('despesa', 100, 90)).toBe(true);
    expect(favoravel('consumo', 100, 110)).toBe(false);
    expect(favoravel('receita', 100, 110)).toBe(true);
    expect(favoravel('receita', 100, 90)).toBe(false);
  });
});

describe('comparar (regra 14: orçado × realizado com as parcelas)', () => {
  const linhas = [
    linha('despesa', 10, DESP, doze(1000)),
    linha('despesa', 20, DESP, doze(500)),
    linha('receita', 0, REC, doze(3000)),
    linha('consumo', 30, SEM, doze(200)),
  ];
  const realizado = [
    real('despesa', 10, DESP, 1, 900),
    real('despesa', 10, DESP, 2, 1200),
    real('despesa', 10, DESP, 3, 800),
    real('despesa', 20, DESP, 1, 500),
    // Realizado sem rateio (sem centro) e fora do mês acumulado.
    real('despesa', 0, DESP, 2, 70),
    real('despesa', 10, DESP, 4, 5000),
    real('receita', 0, REC, 1, 3500),
    real('consumo', 30, SEM, 2, 250),
  ];
  it('por linha, até março: desvio absoluto e percentual, não orçado e totais = soma das parcelas', () => {
    const r = comparar({ linhas, realizado, mesAte: 3, visao: 'linha', rotulos });
    const c10 = r.linhas.find((l) => l.natureza === 'despesa' && l.centro === 10)!;
    expect(c10.orcadoCentavos).toBe(3000);
    expect(c10.realizadoCentavos).toBe(2900);
    expect(c10.desvioCentavos).toBe(-100);
    expect(c10.desvioPercentual).toBe(-3.33);
    expect(c10.favoravel).toBe(true);
    expect(c10.realizadoMeses).toEqual([900, 1200, 800]);
    const sem = r.linhas.find((l) => l.natureza === 'despesa' && l.centro === 0)!;
    expect(sem.naoOrcado).toBe(true);
    expect(sem.orcadoCentavos).toBe(0);
    expect(sem.desvioPercentual).toBeNull();
    const td = r.totais.find((t) => t.natureza === 'despesa')!;
    // Parcelas do orçado: 3000 (C10) + 1500 (C20) + 0 (sem centro) = 4500; realizado 2900 + 500 + 70 = 3470.
    expect(td.parcelasOrcado.map((p) => p.centavos)).toEqual([0, 3000, 1500]);
    expect(td.parcelasRealizado.map((p) => p.centavos)).toEqual([70, 2900, 500]);
    expect(td.orcadoCentavos).toBe(4500);
    expect(td.realizadoCentavos).toBe(3470);
    expect(td.desvioCentavos).toBe(-1030);
    expect(td.desvioPercentual).toBe(-22.89);
    expect(r.totais.map((t) => t.natureza)).toEqual(['receita', 'despesa', 'consumo']);
    const tr = r.totais.find((t) => t.natureza === 'receita')!;
    expect(tr.realizadoCentavos).toBe(3500);
    expect(tr.orcadoCentavos).toBe(9000);
    expect(tr.favoravel).toBe(false);
  });
  it('por item soma os centros; por centro soma os itens', () => {
    const porItem = comparar({ linhas, realizado, mesAte: 12, visao: 'item', rotulos });
    const d = porItem.linhas.find((l) => l.natureza === 'despesa')!;
    expect(d.centro).toBe(0);
    expect(d.orcadoCentavos).toBe(18_000);
    expect(d.realizadoCentavos).toBe(900 + 1200 + 800 + 500 + 70 + 5000);
    expect(d.naoOrcado).toBe(false);
    const porCentro = comparar({ linhas, realizado, mesAte: 12, visao: 'centro', rotulos });
    expect(porCentro.linhas.filter((l) => l.natureza === 'despesa').map((l) => l.centro)).toEqual([
      0, 10, 20,
    ]);
    expect(porCentro.linhas.every((l) => l.grupo === 0 && l.rotuloItem === 'Todos os itens')).toBe(true);
  });
  it('recorte por centro e por item: os totais e as parcelas são só os do recorte; o consumo sai com item', () => {
    const c10 = recortar(linhas, realizado, { centro: 10 });
    const r = comparar({ ...c10, mesAte: 3, visao: 'linha', rotulos });
    expect(r.linhas.map((l) => l.centro)).toEqual([10]);
    const td = r.totais.find((t) => t.natureza === 'despesa')!;
    expect(td.parcelasOrcado.map((p) => p.centavos)).toEqual([3000]);
    expect(td.parcelasRealizado.map((p) => p.centavos)).toEqual([2900]);
    expect(td.orcadoCentavos).toBe(3000);
    expect(td.realizadoCentavos).toBe(2900);
    expect(r.totais.find((t) => t.natureza === 'receita')).toBeUndefined();
    const doItem = recortar(linhas, realizado, { item: '210.1.1' });
    expect(doItem.linhas.map((l) => l.centro)).toEqual([10, 20]);
    expect(doItem.realizado.every((x) => x.natureza === 'despesa')).toBe(true);
    const doConsumo = recortar(linhas, realizado, { centro: 30, item: '0.0.0' });
    expect(doConsumo.linhas).toHaveLength(0);
    expect(doConsumo.realizado).toHaveLength(0);
    const ambos = recortar(linhas, realizado, { centro: 0, item: '210.1.1' });
    expect(ambos.linhas).toHaveLength(0);
    expect(ambos.realizado.map((x) => x.centavos)).toEqual([70]);
    expect(recortar(linhas, realizado, {}).linhas).toHaveLength(linhas.length);
  });
  it('recusa mês fora de 1 a 12', () => {
    expect(() => comparar({ linhas, realizado, mesAte: 13, visao: 'linha', rotulos })).toThrow(RangeError);
  });
});

describe('gerarDoRealizado', () => {
  it('mês a mês com o ajuste; estorno vira zero; linha sem valor fica fora', () => {
    const l = gerarDoRealizado(
      [
        real('despesa', 10, DESP, 1, 1000),
        real('despesa', 10, DESP, 1, 333),
        real('despesa', 10, DESP, 2, -50),
        real('receita', 0, REC, 5, -10),
      ],
      500,
    );
    expect(l).toHaveLength(1);
    expect(l[0]?.meses[0]).toBe(1400); // 1333 × 1,05 = 1399,65 → 1400
    expect(l[0]?.meses[1]).toBe(0);
    expect(chaveDaLinha(l[0]!)).toBe('despesa|10|210|1|1');
  });
  it('ajuste negativo', () => {
    expect(ajustar(1000, -1000)).toBe(900);
    expect(ajustar(1000, -20_000)).toBe(0);
  });
});

describe('totaisDaVersao', () => {
  it('o total é a soma das parcelas por natureza', () => {
    const t = totaisDaVersao([
      linha('despesa', 10, DESP, doze(100)),
      linha('receita', 0, REC, doze(10)),
      linha('consumo', 30, SEM, doze(1)),
    ]);
    expect(t.porNatureza).toEqual({ despesa: 1200, receita: 120, consumo: 12 });
    expect(t.total).toBe(1332);
  });
});

describe('converterRealizado', () => {
  const ids = new Map([
    [300100, 101],
    [300310, 102],
  ]);
  const id = (c: number) => ids.get(c) ?? null;
  it('código do centro vira o ID; sem centro e fora do cadastro vão ao centro 0; nada se perde', () => {
    const r = converterRealizado(
      [
        { natureza: 'despesa', codigoCentro: null, grupo: 210, subgrupo: 1, item: 1, mes: 1, centavos: 500 },
        { natureza: 'receita', codigoCentro: null, grupo: 100, subgrupo: 1, item: 1, mes: 1, centavos: 900 },
        { natureza: 'consumo', codigoCentro: 300100, grupo: 0, subgrupo: 0, item: 0, mes: 2, centavos: 70 },
        { natureza: 'consumo', codigoCentro: 999999, grupo: 0, subgrupo: 0, item: 0, mes: 2, centavos: 30 },
      ],
      [
        // Rateio 60/30: 1001 centavos → 601 + 300 e a sobra 100 sem centro (incompleto).
        {
          grupo: 210,
          subgrupo: 1,
          item: 1,
          mes: 3,
          centavos: 1001,
          centros: [
            { codigoCentro: 300100, percentual: 60 },
            { codigoCentro: 300310, percentual: 30 },
          ],
        },
      ],
      id,
    );
    expect(r.centroSemCadastro).toBe(1);
    expect(r.rateioIncompleto).toBe(1);
    expect(r.realizado.filter((x) => x.mes === 3).map((x) => [x.centro, x.centavos])).toEqual([
      [101, 601],
      [102, 300],
      [0, 100],
    ]);
    expect(r.realizado.reduce((s, x) => s + x.centavos, 0)).toBe(500 + 900 + 70 + 30 + 1001);
    expect(r.semCentro).toEqual({ despesa: 600, receita: 900 });
  });
});
