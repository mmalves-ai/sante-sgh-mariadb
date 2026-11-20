// Regra 13 (domínio): o retorno do laboratório de apoio casado pelo de-para, o valor numérico ou texto, a conferência
// e uma interface por vez.
import { describe, expect, it } from 'vitest';
import {
  casarResultado,
  conectorPodeLigar,
  nomeComparavel,
  podeAprovar,
  valorDoLaboratorio,
} from './apoio.js';

describe('retorno do laboratório de apoio (regra 13)', () => {
  it('nome comparável e valor do laboratório', () => {
    expect(nomeComparavel('  Hemoglobina   glicada (A1c) ')).toBe('HEMOGLOBINA GLICADA A1C');
    expect(nomeComparavel('Ácido úrico')).toBe('ACIDO URICO');
    expect(valorDoLaboratorio('NM', '1,25')).toEqual({ numerico: 1.25, alfa: null });
    expect(valorDoLaboratorio('NM', 'inferior a 0,5')).toEqual({ numerico: null, alfa: 'inferior a 0,5' });
    expect(valorDoLaboratorio('ST', ' ')).toEqual({ numerico: null, alfa: null });
  });

  it('casa pelo código do laboratório → nome do de-para → elemento do exame; o que não casa fica de fora', () => {
    const r = casarResultado(
      [
        { codigo: 'HB', nome: 'Hb', tipo: 'NM', valor: '13,2', unidade: 'g/dL', referencia: '12 a 16' },
        { codigo: 'HT', nome: 'Ht', tipo: 'NM', valor: '40', unidade: '%', referencia: '' },
        { codigo: 'XX', nome: 'Desconhecido', tipo: 'ST', valor: 'a', unidade: '', referencia: '' },
      ],
      [
        { codigoLaboratorio: 'hb', nome: 'Hemoglobina' },
        { codigoLaboratorio: 'HT', nome: 'Hematócrito' },
      ],
      [
        { elemento: 2, nome: 'HEMATOCRITO' },
        { elemento: 1, nome: 'Hemoglobina' },
      ],
    );
    expect(r.elementos.map((e) => [e.elemento, e.numerico, e.unidade])).toEqual([
      [1, 13.2, 'g/dL'],
      [2, 40, '%'],
    ]);
    expect(r.semDePara).toEqual(['XX']);
  });

  it('exame de um elemento com um valor casa direto; elemento repetido não grava duas vezes', () => {
    expect(
      casarResultado(
        [{ codigo: 'Q', nome: 'q', tipo: 'NM', valor: '5', unidade: '', referencia: '' }],
        [],
        [{ elemento: 0, nome: 'Resultado' }],
      ).elementos[0]?.elemento,
    ).toBe(0);
    const dup = casarResultado(
      [
        { codigo: 'A', nome: 'a', tipo: 'NM', valor: '1', unidade: '', referencia: '' },
        { codigo: 'B', nome: 'b', tipo: 'NM', valor: '2', unidade: '', referencia: '' },
      ],
      [
        { codigoLaboratorio: 'A', nome: 'Glicose' },
        { codigoLaboratorio: 'B', nome: 'Glicose' },
      ],
      [
        { elemento: 1, nome: 'Glicose' },
        { elemento: 2, nome: 'Outro' },
      ],
    );
    expect(dup.elementos).toHaveLength(1);
    expect(dup.semDePara).toEqual(['B']);
  });

  it('a conferência aprova só com tudo casado e quem confere habilitado', () => {
    expect(podeAprovar({ elementos: 2, semDePara: 0, habilitado: true })).toEqual({
      pode: true,
      motivo: null,
    });
    expect(podeAprovar({ elementos: 2, semDePara: 0, habilitado: false }).motivo).toMatch(
      /responsável técnico/,
    );
    expect(podeAprovar({ elementos: 0, semDePara: 0, habilitado: true }).motivo).toMatch(/nenhum valor/);
    expect(podeAprovar({ elementos: 2, semDePara: 1, habilitado: true }).motivo).toMatch(/de-para/);
  });

  it('uma interface por estabelecimento de cada vez', () => {
    expect(conectorPodeLigar(true).pode).toBe(false);
    expect(conectorPodeLigar(false).pode).toBe(true);
  });
});
