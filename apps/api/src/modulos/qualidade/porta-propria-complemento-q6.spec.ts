// Regras puras do complemento Q6 da gestão da qualidade (F3.9-Q2): o plano com dono da análise do indicador, o
// percentual de conformidade da auditoria e o checklist do contrato nas linhas do banco.
import { describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import {
  itensDoChecklist,
  percentualConformidade,
  planoComDono,
  resultadoDoPeriodo,
} from './porta-propria-complemento-q6.js';

const codigo = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? e.problema.codigo : 'outro';
  }
};

describe('planoComDono', () => {
  it('sem responsável nem prazo: a análise não abre plano', () => {
    expect(planoComDono({ responsavel: null, prazo: null })).toBeNull();
    expect(planoComDono({ responsavel: '   ', prazo: null })).toBeNull();
  });
  it('responsável e prazo juntos abrem o plano', () => {
    expect(planoComDono({ responsavel: ' QUALIDADE01 ', prazo: '2026-12-20' })).toEqual({
      responsavel: 'QUALIDADE01',
      prazo: '2026-12-20',
    });
  });
  it('um sem o outro recusa', () => {
    expect(codigo(() => planoComDono({ responsavel: 'QUALIDADE01', prazo: null }))).toBe('plano-incompleto');
    expect(codigo(() => planoComDono({ responsavel: null, prazo: '2026-12-20' }))).toBe('plano-incompleto');
  });
});

describe('percentualConformidade', () => {
  it('conformes mais metade dos parciais sobre os avaliados', () => {
    expect(percentualConformidade({ conformes: 3, parciais: 1, naoConformes: 1 })).toBe(70);
    expect(percentualConformidade({ conformes: 1, parciais: 0, naoConformes: 2 })).toBe(33.3333);
  });
  it('sem avaliado (só não aplicáveis) fica nulo', () => {
    expect(percentualConformidade({ conformes: 0, parciais: 0, naoConformes: 0 })).toBeNull();
  });
});

describe('itensDoChecklist', () => {
  it('converte o vocabulário, guarda a seção e a evidência como justificativa fora de conforme', () => {
    const itens = itensDoChecklist(
      JSON.stringify([
        {
          requisito: 'Pulseira de identificação',
          secao: 'Identificação',
          resultado: 'conforme',
          evidencia: null,
        },
        {
          requisito: 'Dupla checagem',
          secao: null,
          resultado: 'naoConforme',
          evidencia: 'Sem registro na prescrição',
        },
        { requisito: 'Bomba de infusão', secao: '', resultado: 'naoAplicavel', evidencia: null },
        { requisito: 'Escala de risco', secao: 'Quedas', resultado: 'parcial', evidencia: 'Feita em metade' },
      ]),
    );
    expect(itens.map((i) => [i.sequencia, i.resultado, i.secao, i.justificativa, i.exigeAcao])).toEqual([
      [1, 'conforme', 'Identificação', null, false],
      [2, 'nao_conforme', null, 'Sem registro na prescrição', true],
      [3, 'nao_se_aplica', null, 'Não se aplica ao escopo da auditoria.', false],
      [4, 'parcial', 'Quedas', 'Feita em metade', true],
    ]);
  });
  it('checklist vazio, ilegível ou com resultado fora do contrato recusa', () => {
    expect(codigo(() => itensDoChecklist('[]'))).toBe('checklist-invalido');
    expect(codigo(() => itensDoChecklist('{'))).toBe('checklist-invalido');
    expect(
      codigo(() => itensDoChecklist(JSON.stringify([{ requisito: 'Item válido', resultado: 'talvez' }]))),
    ).toBe('checklist-invalido');
  });
});

describe('resultadoDoPeriodo', () => {
  it('a situação da meta no vocabulário do banco', () => {
    expect(resultadoDoPeriodo('na-meta')).toBe('na_meta');
    expect(resultadoDoPeriodo('fora-da-meta')).toBe('fora_da_meta');
    expect(resultadoDoPeriodo('sem-meta')).toBe('sem_meta');
  });
});
