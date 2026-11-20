// Regra 6 da ficha do M15: conferência cruzada respostas × formulário gravado (título e valor).
import { describe, expect, it } from 'vitest';
import type { CampoFormulario, ItemResposta } from '@sgh/contratos';
import {
  conferirRegistro,
  marcarDivergencias,
  NOTA_DIVERGENTE,
  normalizarComparacao,
  somarConferencias,
  taxaIgualdade,
} from './conferencia.js';

function campo(titulo: string, valor: string, secao = false): CampoFormulario {
  return {
    nome: titulo,
    classe: 'TfRespEdit',
    titulo,
    secao,
    valor: valor ? { tipo: 'texto', texto: valor } : { tipo: 'vazio' },
    topo: 0,
    esquerda: 0,
    colunas: 12,
    autopreenchido: false,
    naoMapeado: false,
  };
}
function resp(titulo: string, valores: string[]): ItemResposta {
  return {
    ordem: '01',
    titulo,
    tipo: 'Texto',
    valores,
    grade: null,
    autopreenchido: false,
    aConfirmar: null,
    itens: [],
  };
}

describe('conferência cruzada', () => {
  it('conta iguais, valor diferente e sem par; seções e vazios não contam', () => {
    const r = conferirRegistro(
      [
        campo('PA:', '120x80'),
        campo('FC', '80'),
        campo('Peso', '70'),
        campo('SEÇÃO', '', true),
        campo('Vazio', ''),
      ],
      [resp('PA', ['120X80']), resp('FC', ['82'])],
    );
    expect(r).toEqual({ comparados: 3, iguais: 1, valorDiferente: 1, semPar: 1, ignorados: 0 });
    expect(taxaIgualdade(r)).toBeCloseTo(1 / 3);
    expect(taxaIgualdade(somarConferencias([]))).toBe(1);
  });
  it('alergias ficam fora da conta (não gravam resposta estruturada)', () => {
    const r = conferirRegistro([campo('Alergias', 'dipirona'), campo('PA', '1')], [resp('PA', ['1'])], {
      ignorarTitulos: new Set(['Alergias']),
    });
    expect(r).toMatchObject({ comparados: 1, iguais: 1, ignorados: 1 });
    expect(somarConferencias([r, r]).ignorados).toBe(2);
  });

  it('lista marcada em linhas vs. itens separados: as mesmas palavras em qualquer ordem', () => {
    expect(
      conferirRegistro([campo('S', 'Tosse\nFebre alta')], [resp('S', ['Febre alta', 'Tosse'])]).iguais,
    ).toBe(1);
  });

  it('lista em outra ordem é igual; acento e espaço não contam', () => {
    const r = conferirRegistro([campo('Sintomas', 'Tosse; Febre')], [resp('sintomas', ['Febre', 'Tosse'])]);
    expect(r.iguais).toBe(1);
    expect(normalizarComparacao('  Ação   Rápida: ')).toBe('acao rapida');
    expect(somarConferencias([r, r]).comparados).toBe(2);
  });

  it('marca "a confirmar" a resposta que difere do formulário gravado (DP-28)', () => {
    const filho = resp('FC', ['82']);
    const pai = { ...resp('Sinais', []), itens: [filho, resp('PA', ['120x80'])] };
    const r = marcarDivergencias([pai], [campo('FC', '80'), campo('PA', '120x80'), campo('SEÇÃO', '', true)]);
    expect(r.divergentes).toBe(1);
    expect(r.itens[0]!.itens[0]!.aConfirmar).toBe(NOTA_DIVERGENTE);
    expect(r.itens[0]!.itens[1]!.aConfirmar).toBeNull();
    expect(r.itens[0]!.aConfirmar).toBeNull();
  });
});
