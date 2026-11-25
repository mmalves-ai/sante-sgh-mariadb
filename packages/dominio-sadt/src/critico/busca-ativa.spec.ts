import { describe, expect, it } from 'vitest';
import {
  casoAtrasado,
  conferirCancelamentoBuscaAtiva,
  conferirConclusaoBuscaAtiva,
  conferirContatoBuscaAtiva,
  motivoDaBuscaAtiva,
  motivoDoCaso,
  prazoDaBuscaAtiva,
  situacaoAposContato,
} from './busca-ativa.js';

const alta = new Date('2026-03-10T12:00:00Z');
const depois = new Date('2026-03-11T08:00:00Z');
const antes = new Date('2026-03-09T08:00:00Z');
const agora = new Date('2026-03-12T10:00:00Z');
const base = { critico: false, anormal: false, culturaPositiva: false, liberadoEm: depois, altaEm: alta };

describe('busca ativa: entrada na fila', () => {
  it('só entra o resultado liberado depois da alta', () => {
    expect(motivoDaBuscaAtiva({ ...base, critico: true })).toBe('resultado_critico');
    expect(motivoDaBuscaAtiva({ ...base, critico: true, liberadoEm: antes })).toBeNull();
    expect(motivoDaBuscaAtiva({ ...base, critico: true, liberadoEm: alta })).toBeNull();
    expect(motivoDaBuscaAtiva({ ...base, critico: true, altaEm: null })).toBeNull();
  });
  it('alterado e cultura positiva entram como alterado; o normal não entra', () => {
    expect(motivoDaBuscaAtiva({ ...base, anormal: true })).toBe('resultado_alterado');
    expect(motivoDaBuscaAtiva({ ...base, culturaPositiva: true })).toBe('resultado_alterado');
    expect(motivoDaBuscaAtiva(base)).toBeNull();
    expect(motivoDaBuscaAtiva({ ...base, critico: true, anormal: true })).toBe('resultado_critico');
  });
  it('o caso leva o motivo mais grave e o prazo pela gravidade', () => {
    expect(motivoDoCaso(['resultado_alterado', 'resultado_critico'])).toBe('resultado_critico');
    expect(motivoDoCaso(['resultado_alterado'])).toBe('resultado_alterado');
    expect(motivoDoCaso([])).toBeNull();
    expect(prazoDaBuscaAtiva('resultado_critico', depois).toISOString()).toBe('2026-03-12T08:00:00.000Z');
    expect(prazoDaBuscaAtiva('resultado_alterado', depois).toISOString()).toBe('2026-03-14T08:00:00.000Z');
    expect(casoAtrasado('aberto', new Date('2026-03-12T08:00:00Z'), agora)).toBe(true);
    expect(casoAtrasado('concluido', new Date('2026-03-12T08:00:00Z'), agora)).toBe(false);
    expect(casoAtrasado('em_contato', null, agora)).toBe(false);
  });
});

describe('busca ativa: contato', () => {
  const c = {
    resultado: 'contato_realizado' as const,
    orientacao: 'Retornar ao pronto atendimento',
    contatadoEm: agora,
    novaColetaEm: null,
  };
  it('contato feito exige a orientação; caso encerrado não recebe contato', () => {
    expect(conferirContatoBuscaAtiva('aberto', c, agora)).toEqual([]);
    expect(
      conferirContatoBuscaAtiva('aberto', { ...c, orientacao: '  ' }, agora).map((p) => p.campo),
    ).toEqual(['orientacao']);
    expect(conferirContatoBuscaAtiva('concluido', c, agora).map((p) => p.campo)).toEqual(['situacao']);
    expect(
      conferirContatoBuscaAtiva('aberto', { ...c, resultado: 'sem_resposta', orientacao: null }, agora),
    ).toEqual([]);
    expect(situacaoAposContato('aberto')).toBe('em_contato');
    expect(situacaoAposContato('cancelado')).toBe('cancelado');
  });
  it('contato no futuro e nova coleta passada ou sem contato feito são recusados', () => {
    const futuro = new Date(agora.getTime() + 3_600_000);
    expect(
      conferirContatoBuscaAtiva('aberto', { ...c, contatadoEm: futuro }, agora).map((p) => p.campo),
    ).toEqual(['contatadoEm']);
    expect(conferirContatoBuscaAtiva('aberto', { ...c, novaColetaEm: futuro }, agora)).toEqual([]);
    expect(
      conferirContatoBuscaAtiva('aberto', { ...c, novaColetaEm: antes }, agora).map((p) => p.campo),
    ).toEqual(['novaColetaEm']);
    expect(
      conferirContatoBuscaAtiva('aberto', { ...c, resultado: 'recado', novaColetaEm: futuro }, agora).map(
        (p) => p.campo,
      ),
    ).toEqual(['novaColetaEm']);
  });
});

describe('busca ativa: conclusão e cancelamento', () => {
  const sem = { resultado: 'sem_resposta' as const };
  const feito = { resultado: 'contato_realizado' as const };
  it('desfecho obrigatório; sem contato só após 3 tentativas sem sucesso', () => {
    expect(conferirConclusaoBuscaAtiva('aberto', null, []).map((p) => p.campo)).toEqual(['desfecho']);
    expect(conferirConclusaoBuscaAtiva('em_contato', 'sem_contato', [sem, sem])).toHaveLength(1);
    expect(conferirConclusaoBuscaAtiva('em_contato', 'sem_contato', [sem, sem, sem])).toEqual([]);
  });
  it('paciente orientado exige um contato feito; recusa exige contato com recusa', () => {
    expect(conferirConclusaoBuscaAtiva('em_contato', 'paciente_orientado', [sem])).toHaveLength(1);
    expect(conferirConclusaoBuscaAtiva('em_contato', 'paciente_orientado', [sem, feito])).toEqual([]);
    expect(conferirConclusaoBuscaAtiva('em_contato', 'recusou', [sem])).toHaveLength(1);
    expect(conferirConclusaoBuscaAtiva('em_contato', 'recusou', [{ resultado: 'recusou' }])).toEqual([]);
    expect(conferirConclusaoBuscaAtiva('em_contato', 'obito', [])).toEqual([]);
    expect(conferirConclusaoBuscaAtiva('concluido', 'obito', []).map((p) => p.campo)).toEqual(['situacao']);
  });
  it('cancelar exige o motivo e caso aberto', () => {
    expect(conferirCancelamentoBuscaAtiva('aberto', 'Aberto em duplicidade')).toEqual([]);
    expect(conferirCancelamentoBuscaAtiva('aberto', '')).toHaveLength(1);
    expect(conferirCancelamentoBuscaAtiva('cancelado', 'Aberto em duplicidade')).toHaveLength(1);
  });
});
