import { describe, expect, it } from 'vitest';
import {
  codigoNaoPadronizado,
  dosesDaFrequencia,
  type EntradaFrequencia,
  normalizarCodigoCatalogo,
  problemasDaCondicao,
  problemasDaFrequencia,
  problemasDaRegraSetor,
  problemasDoConflito,
  problemasDoNaoPadronizado,
  problemasDoSinonimo,
  proximaSequenciaSinonimo,
} from './cadastro-catalogo.js';

const freq = (x: Partial<EntradaFrequencia> = {}): EntradaFrequencia => ({
  codigo: '6/6H',
  descricao: 'De 6 em 6 horas',
  descricaoResumida: '6/6h',
  tipo: 'intervalo',
  intervaloMinutos: 360,
  dosesPorDia: null,
  limiteHoras: null,
  horarioFixo: true,
  uso: 'todos',
  dias: [],
  escopoSetor: 'todos',
  setores: [],
  ...x,
});
const cods = (p: readonly { codigo: string }[]) => p.map((x) => x.codigo);

describe('cadastro do catálogo da prescrição (03-PEP L106)', () => {
  it('frequência por intervalo coerente passa e as doses no dia saem do intervalo', () => {
    expect(problemasDaFrequencia(freq())).toEqual([]);
    expect(dosesDaFrequencia(freq())).toBe(4);
    expect(dosesDaFrequencia(freq({ intervaloMinutos: 420 }))).toBeNull();
    expect(dosesDaFrequencia(freq({ tipo: 'vezes_ao_dia', intervaloMinutos: null, dosesPorDia: 3 }))).toBe(3);
  });

  it('recusa intervalo ausente ou acima de uma semana e número que o tipo não usa', () => {
    expect(cods(problemasDaFrequencia(freq({ intervaloMinutos: null })))).toEqual(['intervalo-invalido']);
    expect(cods(problemasDaFrequencia(freq({ intervaloMinutos: 7 * 24 * 60 + 1 })))).toEqual([
      'intervalo-invalido',
    ]);
    expect(
      cods(
        problemasDaFrequencia(
          freq({ tipo: 'continuo', intervaloMinutos: 60, dosesPorDia: 2, horarioFixo: false }),
        ),
      ),
    ).toEqual(['intervalo-sem-uso', 'doses-sem-uso']);
    expect(
      cods(problemasDaFrequencia(freq({ tipo: 'vezes_ao_dia', intervaloMinutos: null, dosesPorDia: 49 }))),
    ).toEqual(['doses-invalidas']);
  });

  it('dias da semana pedem um dia; agora e dose única pedem validade; horário fixo só com doses', () => {
    const base = { intervaloMinutos: null, horarioFixo: false };
    expect(cods(problemasDaFrequencia(freq({ ...base, tipo: 'dias_semana' })))).toEqual([
      'dias-obrigatorios',
    ]);
    expect(
      problemasDaFrequencia(freq({ ...base, tipo: 'dias_semana', dias: ['segunda', 'quinta'] })),
    ).toEqual([]);
    expect(cods(problemasDaFrequencia(freq({ ...base, tipo: 'agora' })))).toEqual(['validade-obrigatoria']);
    expect(problemasDaFrequencia(freq({ ...base, tipo: 'dose_unica', limiteHoras: 24 }))).toEqual([]);
    expect(cods(problemasDaFrequencia(freq({ ...base, tipo: 'se_necessario', horarioFixo: true })))).toEqual([
      'horario-fixo-sem-doses',
    ]);
  });

  it('lista de setores só com escopo, sem repetir, e código e resumo conferidos', () => {
    expect(cods(problemasDaFrequencia(freq({ setores: [1] })))).toEqual(['setores-sem-escopo']);
    expect(cods(problemasDaFrequencia(freq({ escopoSetor: 'exceto_listados' })))).toEqual([
      'setores-obrigatorios',
    ]);
    expect(cods(problemasDaFrequencia(freq({ escopoSetor: 'somente_listados', setores: [2, 2] })))).toEqual([
      'setor-repetido',
    ]);
    expect(
      cods(problemasDaFrequencia(freq({ codigo: ' ', descricaoResumida: 'de seis em seis h' }))),
    ).toEqual(['codigo-obrigatorio', 'resumo-longo']);
    expect(normalizarCodigoCatalogo(' 6 em 6 horas ção')).toBe('6_EM_6_HORAS_CAO');
    expect(normalizarCodigoCatalogo('6/6h')).toBe('6/6H');
  });

  it('condição se necessário: parâmetro vital e limiar juntos', () => {
    const c = { codigo: 'FEBRE', descricao: 'Febre', parametroVital: 3, limiar: 37.8 };
    expect(problemasDaCondicao(c)).toEqual([]);
    expect(problemasDaCondicao({ ...c, parametroVital: null, limiar: null })).toEqual([]);
    expect(problemasDaCondicao({ ...c, limiar: null })).toEqual([
      { codigo: 'disparo-incompleto', campo: 'limiar' },
    ]);
    expect(cods(problemasDaCondicao({ ...c, parametroVital: null }))).toEqual(['disparo-incompleto']);
  });

  it('item não padronizado pede unidade, via sem repetir e justificativa; código NP sequencial', () => {
    const n = {
      descricao: 'Item X',
      tipoItem: 1,
      unidade: 2,
      principioAtivo: null,
      vias: [1],
      justificativa: 'Paciente em uso domiciliar',
    };
    expect(problemasDoNaoPadronizado(n)).toEqual([]);
    expect(
      cods(problemasDoNaoPadronizado({ ...n, unidade: null, vias: [], justificativa: 'curta' })),
    ).toEqual(['unidade-obrigatoria', 'via-obrigatoria', 'justificativa-curta']);
    expect(cods(problemasDoNaoPadronizado({ ...n, vias: [1, 1] }))).toEqual(['via-repetida']);
    expect(codigoNaoPadronizado(42)).toBe('NP-000042');
  });

  it('regra do item no setor: bloqueio com motivo, sala e restrito dentro do setor, quantidades positivas', () => {
    const r = {
      setor: 5,
      local: null,
      padronizado: true,
      usoRestrito: true,
      bloqueado: false,
      motivoBloqueio: null,
      via: null,
      frequencia: null,
      quantidadePadrao: 1,
      dosePadrao: null,
    };
    expect(problemasDaRegraSetor(r)).toEqual([]);
    expect(
      cods(problemasDaRegraSetor({ ...r, setor: null, local: 9, bloqueado: true, quantidadePadrao: 0 })),
    ).toEqual(['bloqueio-sem-motivo', 'local-sem-setor', 'restrito-sem-setor', 'quantidade-invalida']);
  });

  it('sinônimo não repete o nome nem outro termo (sem caixa e acento); sequência não reaproveita', () => {
    expect(problemasDoSinonimo('  Dipirona   gotas ', 'Metamizol', [])).toEqual([]);
    expect(cods(problemasDoSinonimo('METAMIZÓL', 'Metamizol', []))).toEqual(['termo-repetido']);
    expect(cods(problemasDoSinonimo('novalgina', 'Metamizol', ['Novalgina']))).toEqual(['termo-repetido']);
    expect(cods(problemasDoSinonimo('x', 'Metamizol', []))).toEqual(['termo-invalido']);
    expect(proximaSequenciaSinonimo([])).toBe(1);
    expect(proximaSequenciaSinonimo([1, 4, 2])).toBe(5);
  });

  it('conflito: não consigo, par simétrico único e motivo no impeditivo', () => {
    expect(cods(problemasDoConflito(1, 1, 'alerta', null, []))).toEqual(['conflito-consigo']);
    expect(cods(problemasDoConflito(1, 2, 'alerta', null, [[2, 1]]))).toEqual(['conflito-repetido']);
    expect(cods(problemasDoConflito(1, 2, 'impeditivo', ' ', []))).toEqual(['motivo-obrigatorio']);
    expect(problemasDoConflito(1, 2, 'impeditivo', 'Duplicidade terapêutica', [[1, 3]])).toEqual([]);
  });
});
