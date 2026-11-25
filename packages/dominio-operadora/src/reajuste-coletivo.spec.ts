// C1-086 (08-SGO L96): índice de reajuste com vigência, agrupamento do coletivo pequeno (RN ANS 565/2022) e regra por
// sinistralidade com faixas.
import { describe, expect, it } from 'vitest';
import {
  calcularReajustePorRegra,
  indiceVigente,
  type IndiceReajuste,
  periodoDeApuracao,
  problemasDaRegra,
  problemasDoAgrupamento,
  problemasDoContratoNoAgrupamento,
  problemasDoContratoPorSinistralidade,
  problemasDoIndice,
  problemasDoPassoAgrupamento,
  type RegraReajusteSinistralidade,
} from './reajuste-coletivo.js';

const cods = (p: readonly { codigo: string }[]) => p.map((x) => x.codigo);
const teto: IndiceReajuste = {
  codigo: 'ANS-2026',
  descricao: 'Teto individual 2026/2027',
  tipo: 'teto_individual_ans',
  vigenciaInicio: '2026-05-01',
  vigenciaFim: '2027-04-30',
  percentual: 6.06,
  protocolo: 'OF-123/2026',
};
const regra: RegraReajusteSinistralidade = {
  codigo: 'SIN-70',
  descricao: 'Coletivo grande, meta 70%',
  base: 'sinistralidade',
  meses: 12,
  meta: 70,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  faixas: [
    { de: 0, ate: 70, percentual: 3 },
    { de: 70, ate: 85, percentual: 10 },
    { de: 85, ate: null, percentual: 18.5 },
  ],
};

describe('índice de reajuste', () => {
  it('aceita o teto da ANS com protocolo e vigência no primeiro dia do mês', () => {
    expect(problemasDoIndice(teto, [])).toEqual([]);
  });
  it('recusa o teto sem protocolo, vigência no meio do mês, fim antes do início e percentual fora da faixa', () => {
    expect(cods(problemasDoIndice({ ...teto, protocolo: ' ' }, []))).toEqual(['indice-sem-protocolo']);
    expect(cods(problemasDoIndice({ ...teto, vigenciaInicio: '2026-05-10' }, []))).toContain(
      'indice-vigencia',
    );
    expect(cods(problemasDoIndice({ ...teto, vigenciaFim: '2026-04-30' }, []))).toContain('indice-vigencia');
    expect(cods(problemasDoIndice({ ...teto, percentual: 101 }, []))).toContain('indice-percentual');
    expect(cods(problemasDoIndice({ ...teto, codigo: 'x' }, []))).toContain('indice-codigo');
  });
  it('aceita teto negativo (redução) e o econômico sem protocolo', () => {
    expect(problemasDoIndice({ ...teto, percentual: -8.19 }, [])).toEqual([]);
    expect(problemasDoIndice({ ...teto, tipo: 'economico', codigo: 'IPCA', protocolo: null }, [])).toEqual(
      [],
    );
  });
  it('recusa vigência sobreposta do mesmo código e aceita a seguinte', () => {
    const ex = [{ codigo: 'ans-2026', vigenciaInicio: '2026-05-01', vigenciaFim: null }];
    expect(cods(problemasDoIndice(teto, ex))).toEqual(['indice-sobreposto']);
    const fechado = [{ codigo: 'ANS-2026', vigenciaInicio: '2025-05-01', vigenciaFim: '2026-04-30' }];
    expect(problemasDoIndice(teto, fechado)).toEqual([]);
  });
  it('acha o índice vigente do tipo na data (o início mais recente)', () => {
    const ant = { ...teto, id: 1, vigenciaInicio: '2025-05-01', vigenciaFim: '2026-04-30', percentual: 6.91 };
    const atual = { ...teto, id: 2 };
    const ipca = { ...teto, id: 3, tipo: 'economico' as const };
    expect(indiceVigente([ant, atual, ipca], 'teto_individual_ans', '2026-05-01')?.id).toBe(2);
    expect(indiceVigente([ant, atual, ipca], 'teto_individual_ans', '2026-04-01')?.id).toBe(1);
    expect(indiceVigente([ant, atual], 'teto_individual_ans', '2027-05-01')).toBeNull();
  });
});

describe('regra por sinistralidade', () => {
  it('aceita faixas contínuas a partir de zero', () => {
    expect(problemasDaRegra(regra)).toEqual([]);
  });
  it('recusa buraco, sobreposição, faixa aberta no meio, primeira acima de zero e meta fora', () => {
    const f = regra.faixas;
    expect(cods(problemasDaRegra({ ...regra, faixas: [f[0]!, { ...f[1]!, de: 75 }, f[2]!] }))).toEqual([
      'regra-faixa-continua',
    ]);
    expect(cods(problemasDaRegra({ ...regra, faixas: [{ ...f[0]!, ate: null }, f[2]!] }))).toContain(
      'regra-faixa-aberta',
    );
    expect(cods(problemasDaRegra({ ...regra, faixas: [{ ...f[0]!, de: 5 }, f[1]!, f[2]!] }))).toEqual([
      'regra-faixa-inicio',
    ]);
    expect(cods(problemasDaRegra({ ...regra, meta: 0 }))).toEqual(['regra-meta']);
    expect(cods(problemasDaRegra({ ...regra, meses: 40 }))).toEqual(['regra-meses']);
    expect(cods(problemasDaRegra({ ...regra, faixas: [] }))).toEqual(['regra-sem-faixa']);
  });
  it('apura os meses anteriores ao aniversário', () => {
    expect(periodoDeApuracao('2027-03', 12)).toEqual({ inicio: '2026-03-01', fim: '2027-02-28' });
  });
  it('calcula a sinistralidade com as parcelas e acha a faixa (limite inferior incluído)', () => {
    const r = calcularReajustePorRegra(regra, { receita: 120_000, despesa: 102_000 });
    expect(r.valorApurado).toBe(85);
    expect(r.percentual).toBe(18.5);
    expect(r.memoria).toContain('despesa 102000,00 / receita 120000,00');
    expect(r.problemas).toEqual([]);
    expect(calcularReajustePorRegra(regra, { receita: 1000, despesa: 699.9 }).percentual).toBe(3);
    expect(calcularReajustePorRegra(regra, { receita: 1000, despesa: 700 }).percentual).toBe(10);
  });
  it('sem receita no período, recusa; base mensalidade usa a média mensal', () => {
    expect(cods(calcularReajustePorRegra(regra, { receita: 0, despesa: 10 }).problemas)).toEqual([
      'apuracao-sem-receita',
    ]);
    const m = calcularReajustePorRegra(
      { base: 'mensalidade', meses: 12, faixas: [{ de: 0, ate: 500, percentual: 4 }] },
      { receita: 7_200, despesa: 0 },
    );
    expect(m.valorApurado).toBe(600);
    expect(cods(m.problemas)).toEqual(['apuracao-sem-faixa']);
  });
});

describe('agrupamento do coletivo pequeno (RN 565)', () => {
  it('limite mínimo de 29 vidas e período no primeiro dia do mês', () => {
    expect(
      problemasDoAgrupamento({ descricao: 'Pool 2026', vigencia: '2026-05-01', limiteVidas: 29 }),
    ).toEqual([]);
    expect(
      cods(problemasDoAgrupamento({ descricao: 'Pool', vigencia: '2026-05-02', limiteVidas: 20 })),
    ).toEqual(['agrupamento-vigencia', 'agrupamento-limite']);
  });
  it('só coletivo, não encerrado e até o limite de vidas', () => {
    const k = { situacao: 'ativo', tipoContratacao: 2, vidas: 29 };
    expect(problemasDoContratoNoAgrupamento(k, 29)).toEqual([]);
    expect(cods(problemasDoContratoNoAgrupamento({ ...k, vidas: 30 }, 29))).toEqual([
      'agrupamento-acima-do-limite',
    ]);
    expect(cods(problemasDoContratoNoAgrupamento({ ...k, tipoContratacao: 1 }, 29))).toEqual([
      'agrupamento-so-coletivo',
    ]);
  });
  it('sinistralidade só no coletivo acima do limite', () => {
    const k = { situacao: 'ativo', tipoContratacao: 3, vidas: 30 };
    expect(problemasDoContratoPorSinistralidade(k)).toEqual([]);
    expect(cods(problemasDoContratoPorSinistralidade({ ...k, vidas: 10 }))).toEqual([
      'sinistralidade-contrato-de-agrupamento',
    ]);
    expect(cods(problemasDoContratoPorSinistralidade({ ...k, tipoContratacao: 1 }))).toEqual([
      'sinistralidade-so-coletivo',
    ]);
  });
  it('passos: calcular com contratos, aplicar calculado dentro dos 12 meses, nada depois de cancelado', () => {
    const a = { situacao: 'aberto' as const, vigencia: '2026-05-01', contratos: 0 };
    expect(cods(problemasDoPassoAgrupamento(a, 'calcular'))).toEqual(['agrupamento-vazio']);
    expect(cods(problemasDoPassoAgrupamento({ ...a, contratos: 2 }, 'aplicar', '2026-06'))).toEqual([
      'agrupamento-sem-calculo',
    ]);
    const c = { ...a, situacao: 'calculado' as const, contratos: 2 };
    expect(problemasDoPassoAgrupamento(c, 'aplicar', '2027-04')).toEqual([]);
    expect(cods(problemasDoPassoAgrupamento(c, 'aplicar', '2027-05'))).toEqual([
      'agrupamento-fora-do-periodo',
    ]);
    expect(cods(problemasDoPassoAgrupamento({ ...c, situacao: 'aplicado' }, 'incluir'))).toEqual([
      'agrupamento-ja-aplicado',
    ]);
    expect(cods(problemasDoPassoAgrupamento({ ...c, situacao: 'cancelado' }, 'aplicar', '2026-06'))).toEqual([
      'agrupamento-cancelado',
    ]);
  });
});
