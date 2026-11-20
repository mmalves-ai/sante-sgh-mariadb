// Regras puras das telas do NIR (M44, etapa 2).
import type { SolicitacaoNir } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { acoesDaTela, dataCurta, destinoDaConclusao, horaCurta, tempoEscrito } from './regras-nir.js';

const base = {
  id: 9,
  origem: 'pa',
  estado: 'reservado',
  paciente: { id: 1003, nome: 'P', idade: 50, sexo: 'M' },
  atendimento: 77,
  internacao: null,
  reserva: {
    id: 3,
    solicitacao: 9,
    leito: { bloco: '1', acomodacao: 'ENF1', leito: '02' },
    chave: '1|ENF1|02',
    situacao: 'ativa',
  },
} as unknown as SolicitacaoNir;

describe('regras das telas do NIR', () => {
  it('o tempo, a hora e a data escritos', () => {
    expect(tempoEscrito(40)).toBe('40 min');
    expect(tempoEscrito(60)).toBe('1 h');
    expect(tempoEscrito(75)).toBe('1 h 15 min');
    expect(horaCurta('2026-10-24T14:30:00')).toBe('24/10 14:30');
    expect(horaCurta(null)).toBe('');
    expect(dataCurta('2026-10-24')).toBe('24/10/2026');
    expect(dataCurta('x')).toBe('x');
  });

  it('a conclusão: admissão com o PA, admissão eletiva e transferência do internado', () => {
    expect(destinoDaConclusao(base)).toBe(
      '/internacao/admissao?paciente=1003&leito=1%7CENF1%7C02&solicitacao=9&origem=pa&atendimento=77',
    );
    expect(destinoDaConclusao({ ...base, origem: 'eletiva', atendimento: null })).toBe(
      '/internacao/admissao?paciente=1003&leito=1%7CENF1%7C02&solicitacao=9',
    );
    expect(destinoDaConclusao({ ...base, origem: 'internado', internacao: 880001 })).toBe(
      '/leitos/transferencias?internacao=880001&destino=1%7CENF1%7C02&solicitacao=9',
    );
    expect(destinoDaConclusao({ ...base, reserva: null })).toBeNull();
  });

  it('as ações por estado', () => {
    expect(acoesDaTela({ estado: 'solicitado', reserva: null })).toEqual([
      'analisar',
      'escolherLeito',
      'priorizar',
      'encerrar',
    ]);
    expect(acoesDaTela(base)).toEqual(['confirmar', 'transito', 'concluir', 'priorizar', 'encerrar']);
    expect(
      acoesDaTela({ estado: 'reservado', reserva: { ...base.reserva!, situacao: 'confirmada' } }),
    ).toEqual(['transito', 'concluir', 'priorizar', 'encerrar']);
    expect(acoesDaTela({ estado: 'em_transito', reserva: null })).toEqual([
      'concluir',
      'priorizar',
      'encerrar',
    ]);
    expect(acoesDaTela({ estado: 'em_analise', reserva: null })).toEqual([
      'escolherLeito',
      'priorizar',
      'encerrar',
    ]);
    expect(acoesDaTela({ estado: 'internado', reserva: null })).toEqual([]);
  });
});
