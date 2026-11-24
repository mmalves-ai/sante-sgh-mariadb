// F3.6 (05-SUP linha 7): regra de integração prescrição × estoque e grade de horários padrão de medicação.
import { describe, expect, it } from 'vitest';
import {
  chaveRegraIntegracao,
  conferirHorariosPadrao,
  conferirRegraIntegracao,
  diasDoTexto,
  diasParaTexto,
  type RegraIntegracaoConferida,
} from '@sgh/contratos/regras-suprimentos';

const base: RegraIntegracaoConferida = {
  centroCusto: 1,
  setor: null,
  unidade: null,
  grupo: null,
  subgrupo: null,
  item: null,
  localAtendente: 10,
  localSubstituto: null,
  tipoIntegracao: 'requisicao_automatica',
  momento: 'na_prescricao',
  antecedenciaMinutos: null,
  geraManipulacao: false,
};
const codigos = (r: Partial<RegraIntegracaoConferida>) =>
  conferirRegraIntegracao({ ...base, ...r }).map((x) => x.codigo);

describe('regra de integração prescrição × estoque', () => {
  it('a regra completa passa', () => {
    expect(codigos({})).toEqual([]);
    expect(codigos({ momento: 'antes_do_horario', antecedenciaMinutos: 60, localSubstituto: 20 })).toEqual(
      [],
    );
  });
  it('exige o escopo (centro, setor ou unidade)', () => {
    expect(codigos({ centroCusto: null })).toEqual(['escopo-obrigatorio']);
    expect(codigos({ centroCusto: null, unidade: 3 })).toEqual([]);
  });
  it('substituto diferente do local que atende', () => {
    expect(codigos({ localSubstituto: 10 })).toEqual(['mesmo-local']);
  });
  it('antecedência só e sempre com o momento "antes do horário"', () => {
    expect(codigos({ momento: 'antes_do_horario' })).toEqual(['antecedencia-obrigatoria']);
    expect(codigos({ antecedenciaMinutos: 30 })).toEqual(['antecedencia-sem-uso']);
  });
  it('exceção por item não se mistura com grupo; subgrupo exige grupo', () => {
    expect(codigos({ item: 5, grupo: 2 })).toEqual(['item-e-grupo']);
    expect(codigos({ subgrupo: 4 })).toEqual(['subgrupo-sem-grupo']);
  });
  it('sem integração não gera manipulação', () => {
    expect(codigos({ tipoIntegracao: 'sem_integracao', geraManipulacao: true })).toEqual([
      'manipulacao-sem-integracao',
    ]);
  });
  it('a chave de ambiguidade considera escopo, filtros e prioridade', () => {
    const k = (p: number, tipoItem: number | null = null) =>
      chaveRegraIntegracao({ ...base, tipoItem, prioridade: p });
    expect(k(100)).toBe(k(100));
    expect(k(100)).not.toBe(k(50));
    expect(k(100)).not.toBe(k(100, 7));
  });
});

describe('grade de horários padrão', () => {
  const h = (...horas: string[]) => horas.map((hora) => ({ hora, dias: [] as number[] }));
  it('aceita a grade com o número de doses da frequência, inclusive virando o dia', () => {
    expect(conferirHorariosPadrao(h('22:00', '06:00', '14:00'), 3)).toEqual([]);
    expect(conferirHorariosPadrao(h('08:00'), null)).toEqual([]);
  });
  it('recusa grade vazia, horário inválido ou repetido', () => {
    expect(conferirHorariosPadrao([], 2).map((r) => r.codigo)).toEqual(['sem-horario']);
    expect(conferirHorariosPadrao(h('24:00'), null).map((r) => r.codigo)).toEqual(['hora-invalida']);
    expect(conferirHorariosPadrao(h('08:00', '08:00'), null).map((r) => r.codigo)).toEqual([
      'horario-repetido',
    ]);
  });
  it('recusa o número de horários diferente das doses por dia', () => {
    expect(conferirHorariosPadrao(h('08:00', '20:00'), 3).map((r) => r.codigo)).toEqual([
      'doses-da-frequencia',
    ]);
  });
  it('dias de 1 a 7 sem repetir; todos os dias gravam nulo', () => {
    expect(conferirHorariosPadrao([{ hora: '08:00', dias: [1, 8] }], null).map((r) => r.codigo)).toEqual([
      'dia-invalido',
    ]);
    expect(conferirHorariosPadrao([{ hora: '08:00', dias: [2, 2] }], null).map((r) => r.codigo)).toEqual([
      'dia-invalido',
    ]);
    expect(diasParaTexto([])).toBeNull();
    expect(diasParaTexto([1, 2, 3, 4, 5, 6, 7])).toBeNull();
    expect(diasParaTexto([6, 2, 4])).toBe('2,4,6');
    expect(diasDoTexto('2,4,6')).toEqual([2, 4, 6]);
    expect(diasDoTexto(null)).toEqual([]);
  });
});
