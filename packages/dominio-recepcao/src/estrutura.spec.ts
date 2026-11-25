// 02-REC linha 33: regras do cadastro da estrutura da recepção.
import { describe, expect, it } from 'vitest';
import {
  bloqueioDesativar,
  codigoSugerido,
  ordenarBotoes,
  prefixoSugerido,
  proximoGuiche,
  recusasDoGuiche,
  recusasDoPonto,
  recusasDoServico,
  type ServicoProposto,
} from './estrutura.js';

const codigos = (r: readonly { codigo: string }[]) => r.map((x) => x.codigo);
const servico = (x: Partial<ServicoProposto> = {}): ServicoProposto => ({
  prefixo: 'CO',
  descricao: 'Consultas',
  tipo: 'geral',
  prioritaria: false,
  grupoPrioridade: null,
  limiteDia: null,
  ordemBotao: null,
  ...x,
});

describe('ponto de recepção', () => {
  const existentes = [{ id: 1, codigo: 'CENTRAL', descricao: 'Recepção Central' }];
  it('aceita o ponto novo válido e a alteração do próprio ponto', () => {
    expect(
      recusasDoPonto({ codigo: 'PA', descricao: 'Pronto atendimento', textoSenha: null }, existentes),
    ).toEqual([]);
    expect(
      recusasDoPonto(
        { codigo: 'CENTRAL', descricao: 'Recepção Central', textoSenha: 'Aguarde' },
        existentes,
        1,
      ),
    ).toEqual([]);
  });
  it('recusa código e nome repetidos sem olhar acento nem caixa', () => {
    expect(
      codigos(
        recusasDoPonto({ codigo: 'central', descricao: 'RECEPCAO CENTRAL', textoSenha: null }, existentes),
      ),
    ).toEqual(['codigo-repetido', 'descricao-repetida']);
  });
  it('recusa código fora do formato, nome curto e texto longo', () => {
    expect(
      codigos(recusasDoPonto({ codigo: 'a b', descricao: 'ab', textoSenha: 'x'.repeat(501) }, existentes)),
    ).toEqual(['codigo-invalido', 'descricao-invalida', 'texto-longo']);
  });
  it('sugere o código pelo nome, único', () => {
    expect(codigoSugerido('Recepção Central', [])).toBe('RECEPCAO-CENTRAL');
    expect(codigoSugerido('Recepção Central', ['recepcao-central'])).toBe('RECEPCAO-CENTRAL-2');
    expect(codigoSugerido('  ', [])).toBe('RECEPCAO');
  });
});

describe('guichê', () => {
  const existentes = [
    { id: 10, numero: 1 },
    { id: 11, numero: 2 },
  ];
  it('recusa número repetido no ponto (o inativo também conta) e fora da faixa', () => {
    expect(codigos(recusasDoGuiche({ numero: 2, descricao: null }, existentes))).toEqual(['numero-repetido']);
    expect(codigos(recusasDoGuiche({ numero: 0, descricao: null }, existentes))).toEqual(['numero-invalido']);
    expect(codigos(recusasDoGuiche({ numero: 1000, descricao: null }, existentes))).toEqual([
      'numero-invalido',
    ]);
    expect(recusasDoGuiche({ numero: 2, descricao: 'Preferencial' }, existentes, 11)).toEqual([]);
  });
  it('sugere o menor número livre', () => {
    expect(proximoGuiche([1, 2, 4])).toBe(3);
    expect(proximoGuiche([])).toBe(1);
  });
});

describe('serviço de senha (botão do totem)', () => {
  const existentes = [{ id: 5, prefixo: 'CO', descricao: 'Consultas' }];
  const grupos = ['gestante', 'idoso_80'];
  it('aceita o serviço válido e a alteração do próprio serviço', () => {
    expect(recusasDoServico(servico({ prefixo: 'EX', descricao: 'Exames' }), existentes, grupos)).toEqual([]);
    expect(recusasDoServico(servico(), existentes, grupos, 5)).toEqual([]);
  });
  it('recusa prefixo e nome repetidos na recepção', () => {
    expect(codigos(recusasDoServico(servico({ descricao: 'CONSULTAS' }), existentes, grupos))).toEqual([
      'prefixo-repetido',
      'descricao-repetida',
    ]);
  });
  it('recusa prefixo fora do formato, tipo desconhecido, limite e posição inválidos', () => {
    expect(
      codigos(
        recusasDoServico(
          servico({ prefixo: 'c1', descricao: 'Exames', tipo: 'agenda', limiteDia: 0, ordemBotao: 1000 }),
          existentes,
          grupos,
        ),
      ),
    ).toEqual(['prefixo-invalido', 'tipo-invalido', 'limite-invalido', 'ordem-invalida']);
  });
  it('o grupo de prioridade legal precisa existir, estar ativo e o botão ser prioritário', () => {
    const base = { prefixo: 'PR', descricao: 'Preferencial' };
    expect(
      codigos(
        recusasDoServico(servico({ ...base, prioritaria: true, grupoPrioridade: 'x' }), existentes, grupos),
      ),
    ).toEqual(['grupo-inexistente']);
    expect(
      codigos(
        recusasDoServico(
          servico({ ...base, prioritaria: false, grupoPrioridade: 'gestante' }),
          existentes,
          grupos,
        ),
      ),
    ).toEqual(['grupo-sem-prioridade']);
    expect(
      recusasDoServico(
        servico({ ...base, prioritaria: true, grupoPrioridade: 'gestante' }),
        existentes,
        grupos,
      ),
    ).toEqual([]);
    // Prioritário sem grupo vale: a prioridade legal genérica.
    expect(recusasDoServico(servico({ ...base, prioritaria: true }), existentes, grupos)).toEqual([]);
  });
  it('sugere o prefixo pelas iniciais, sem repetir o usado', () => {
    expect(prefixoSugerido('Marcação de consulta', [])).toBe('MC');
    expect(prefixoSugerido('Marcação de consulta', ['MC'])).toBe('MA');
    expect(prefixoSugerido('Exames', ['EX', 'E'])).toBe('EXA');
    expect(prefixoSugerido('', ['A'])).toBe('B');
  });
  it('ordena os botões: posicionados primeiro, os demais pelo nome', () => {
    const b = (id: number, descricao: string, ordemBotao: number | null) => ({ id, descricao, ordemBotao });
    expect(
      ordenarBotoes([b(1, 'Exames', null), b(2, 'Consultas', 2), b(3, 'Água', null), b(4, 'Retorno', 1)]).map(
        (x) => x.id,
      ),
    ).toEqual([4, 2, 3, 1]);
  });
});

describe('desativar em vez de apagar', () => {
  it('guichê aberto impede desativar o guichê e a recepção', () => {
    expect(bloqueioDesativar('guiche', { guichesAbertos: 1, senhasEmAberto: 9 })?.codigo).toBe(
      'guiche-aberto',
    );
    expect(bloqueioDesativar('ponto', { guichesAbertos: 1, senhasEmAberto: 0 })?.codigo).toBe(
      'guiche-aberto',
    );
  });
  it('senha de hoje sem conclusão impede desativar o serviço e a recepção', () => {
    expect(bloqueioDesativar('servico', { guichesAbertos: 3, senhasEmAberto: 2 })?.codigo).toBe(
      'senha-em-aberto',
    );
    expect(bloqueioDesativar('ponto', { guichesAbertos: 0, senhasEmAberto: 2 })?.codigo).toBe(
      'senha-em-aberto',
    );
  });
  it('sem uso em curso, pode', () => {
    for (const item of ['ponto', 'guiche', 'servico'] as const)
      expect(bloqueioDesativar(item, { guichesAbertos: 0, senhasEmAberto: 0 })).toBeNull();
    expect(bloqueioDesativar('guiche', { guichesAbertos: 0, senhasEmAberto: 5 })).toBeNull();
  });
});
