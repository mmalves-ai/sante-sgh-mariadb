// 02-REC linha 33 (C2-005): regras do cadastro dos locais de atendimento e dos encaminhamentos entre locais.
import { describe, expect, it } from 'vitest';
import {
  bloqueioDesativarLocal,
  codigoDeLocalSugerido,
  diferencaDestinos,
  LIMITE_DESTINOS,
  type LocalProposto,
  recusasDoLocal,
  recusasDosDestinos,
} from './locais-atendimento.js';

const codigos = (r: readonly { codigo: string }[]) => r.map((x) => x.codigo);
const local = (x: Partial<LocalProposto> = {}): LocalProposto => ({
  codigo: 'CONS-01',
  descricao: 'Consultório 01',
  permiteEncaminhamento: false,
  baseTempoEspera: false,
  reavaliacaoMedica: false,
  canalAudio: null,
  ...x,
});
const ponto = { id: 1, ativo: true };
const existentes = [
  { id: 10, codigo: 'CONS-01', descricao: 'Consultório 01', ponto: 1 },
  { id: 11, codigo: 'OBS', descricao: 'Observação', ponto: 2 },
];

describe('local de atendimento', () => {
  it('aceita o local novo válido e a alteração do próprio local', () => {
    expect(
      recusasDoLocal(local({ codigo: 'CONS-02', descricao: 'Consultório 02' }), ponto, existentes),
    ).toEqual([]);
    expect(recusasDoLocal(local(), ponto, existentes, 10)).toEqual([]);
  });
  it('recusa código repetido (sem diferença de acento ou caixa) e código fora do formato', () => {
    expect(
      codigos(recusasDoLocal(local({ codigo: 'cons-01', descricao: 'Outro' }), ponto, existentes)),
    ).toEqual(['codigo-repetido']);
    expect(codigos(recusasDoLocal(local({ codigo: ' X', descricao: 'Outro' }), ponto, existentes))).toEqual([
      'codigo-invalido',
    ]);
  });
  it('o nome só não se repete na mesma recepção', () => {
    expect(
      codigos(recusasDoLocal(local({ codigo: 'C2', descricao: 'CONSULTORIO 01' }), ponto, existentes)),
    ).toEqual(['descricao-repetida']);
    expect(recusasDoLocal(local({ codigo: 'OBS-2', descricao: 'Observação' }), ponto, existentes)).toEqual(
      [],
    );
    expect(codigos(recusasDoLocal(local({ codigo: 'C3', descricao: 'ab' }), ponto, existentes))).toEqual([
      'descricao-invalida',
    ]);
  });
  it('recusa incluir em recepção desativada, mas deixa alterar o local que já existe nela', () => {
    expect(
      codigos(recusasDoLocal(local({ codigo: 'N1', descricao: 'Novo' }), { id: 1, ativo: false }, [])),
    ).toEqual(['ponto-inativo']);
    expect(recusasDoLocal(local(), { id: 1, ativo: false }, existentes, 10)).toEqual([]);
  });
  it('recusa canal de áudio longo demais', () => {
    expect(codigos(recusasDoLocal(local({ canalAudio: 'x'.repeat(41) }), ponto, existentes, 10))).toEqual([
      'canal-invalido',
    ]);
  });
  it('sugere o código pelo nome, sem acento e sem repetir', () => {
    expect(codigoDeLocalSugerido('Sala de Observação', [])).toBe('SALA-DE-OBSERVACAO');
    expect(codigoDeLocalSugerido('Consultório 01', ['CONSULTORIO-01'])).toBe('CONSULTORIO-01-2');
    expect(codigoDeLocalSugerido('  ', [])).toBe('LOCAL');
  });
});

describe('destinos de encaminhamento', () => {
  const locais = [
    { id: 1, ativo: true },
    { id: 2, ativo: true },
    { id: 3, ativo: false },
  ];
  const origem = { id: 1, permiteEncaminhamento: true };
  it('aceita destinos ativos do estabelecimento e a lista vazia', () => {
    expect(recusasDosDestinos(origem, [2], locais)).toEqual([]);
    expect(recusasDosDestinos({ id: 1, permiteEncaminhamento: false }, [], locais)).toEqual([]);
  });
  it('recusa destinos quando o local não encaminha', () => {
    expect(codigos(recusasDosDestinos({ id: 1, permiteEncaminhamento: false }, [2], locais))).toEqual([
      'local-nao-encaminha',
    ]);
  });
  it('recusa o próprio local, o repetido, o de fora e o desativado novo', () => {
    expect(codigos(recusasDosDestinos(origem, [1], locais))).toEqual(['destino-proprio']);
    expect(codigos(recusasDosDestinos(origem, [2, 2], locais))).toEqual(['destino-repetido']);
    expect(codigos(recusasDosDestinos(origem, [99], locais))).toEqual(['destino-inexistente']);
    expect(codigos(recusasDosDestinos(origem, [3], locais))).toEqual(['destino-inativo']);
  });
  it('o destino desativado que já estava na lista pode continuar', () => {
    expect(recusasDosDestinos(origem, [2, 3], locais, [3])).toEqual([]);
  });
  it('limita o tamanho da lista', () => {
    const muitos = Array.from({ length: LIMITE_DESTINOS + 1 }, (_, i) => i + 100);
    const todos = muitos.map((id) => ({ id, ativo: true }));
    expect(codigos(recusasDosDestinos(origem, muitos, todos))).toEqual(['destinos-demais']);
  });
  it('calcula só o que entra e o que sai', () => {
    expect(diferencaDestinos([2, 3], [3, 4])).toEqual({ entram: [4], saem: [2] });
    expect(diferencaDestinos([], [])).toEqual({ entram: [], saem: [] });
  });
});

describe('desativar local', () => {
  it('recusa com guichê aberto ou senha de hoje em aberto; libera sem uso', () => {
    expect(bloqueioDesativarLocal({ guichesAbertos: 1, senhasEmAberto: 0 })?.codigo).toBe('guiche-aberto');
    expect(bloqueioDesativarLocal({ guichesAbertos: 0, senhasEmAberto: 2 })?.codigo).toBe('senha-em-aberto');
    expect(bloqueioDesativarLocal({ guichesAbertos: 0, senhasEmAberto: 0 })).toBeNull();
  });
});
