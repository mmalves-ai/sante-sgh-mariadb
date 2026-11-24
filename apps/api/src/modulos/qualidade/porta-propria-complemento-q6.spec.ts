// Regras puras do complemento Q6 da gestão da qualidade (F3.9-Q2): o plano com dono da análise do indicador, o
// checklist do contrato nas linhas do banco e a comparação do item gravado (só o item que mudou é regravado). A
// conformidade da auditoria é a do domínio (resultadoChecklist), que a API passa pronta.
import { describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import {
  itemIgual,
  itensDoChecklist,
  planoComDono,
  resultadoDoPeriodo,
} from './porta-propria-complemento-q6.js';

const codigo = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'outro') : 'outro';
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

describe('itemIgual', () => {
  const [item] = itensDoChecklist(
    JSON.stringify([
      {
        requisito: 'Dupla checagem',
        secao: 'Medicamentos',
        resultado: 'naoConforme',
        evidencia: 'Sem registro',
      },
    ]),
  );
  const gravado = {
    pergunta: 'Dupla checagem',
    secao: 'Medicamentos',
    resultado: 'nao_conforme',
    evidencia: 'Sem registro',
    justificativa: 'Sem registro',
    exige_acao: 1,
  };
  it('o item com o mesmo conteúdo é igual (o banco devolve a ação como 0/1)', () => {
    expect(itemIgual(gravado, item!)).toBe(true);
  });
  it('qualquer campo do conteúdo que muda torna o item diferente', () => {
    expect(itemIgual({ ...gravado, resultado: 'parcial' }, item!)).toBe(false);
    expect(itemIgual({ ...gravado, evidencia: 'Outro achado' }, item!)).toBe(false);
    expect(itemIgual({ ...gravado, secao: null }, item!)).toBe(false);
    expect(itemIgual({ ...gravado, exige_acao: 0 }, item!)).toBe(false);
  });
});
