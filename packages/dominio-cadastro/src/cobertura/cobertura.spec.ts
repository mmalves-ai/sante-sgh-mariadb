import { describe, expect, it } from 'vitest';
import {
  type CoberturaProposta,
  coberturaProposta,
  conferirCobertura,
  type FontePagadoraRegra,
  situacaoDaCarteira,
} from './cobertura.js';

const fonte: FontePagadoraRegra = { id: 7, ativa: true, particular: false, exigeValidadeCarteira: true };
const base: CoberturaProposta = {
  paciente: 1,
  fontePagadora: fonte,
  plano: { id: 70, fontePagadora: 7, ativo: true },
  planoInformado: true,
  numeroCarteira: '123',
  validade: '2027-01-31',
  vigenciaInicio: '2026-01-01',
  titular: true,
};
const codigos = (c: CoberturaProposta) => conferirCobertura(c).map((r) => r.codigo);

describe('cobertura do paciente: conferência', () => {
  it('aceita a carteira completa do titular', () => expect(codigos(base)).toEqual([]));
  it('recusa fonte inativa ou inexistente', () => {
    expect(codigos({ ...base, fontePagadora: null })).toContain('fonte-pagadora-invalida');
    expect(codigos({ ...base, fontePagadora: { ...fonte, ativa: false } })).toContain(
      'fonte-pagadora-invalida',
    );
  });
  it('recusa plano de outra fonte e plano inativo', () => {
    expect(codigos({ ...base, plano: { id: 9, fontePagadora: 8, ativo: true } })).toEqual([
      'plano-de-outra-fonte',
    ]);
    expect(codigos({ ...base, plano: null })).toEqual(['plano-invalido']);
  });
  it('exige carteira fora do particular e validade quando a fonte pede', () => {
    expect(codigos({ ...base, numeroCarteira: ' ', validade: null })).toEqual([
      'carteira-obrigatoria',
      'validade-obrigatoria',
    ]);
    expect(
      codigos({
        ...base,
        fontePagadora: { ...fonte, particular: true, exigeValidadeCarteira: false },
        numeroCarteira: null,
        validade: null,
      }),
    ).toEqual([]);
  });
  it('recusa vigência invertida e data malformada', () => {
    expect(codigos({ ...base, vigenciaFim: '2025-12-31' })).toEqual(['vigencia-invertida']);
    expect(codigos({ ...base, validade: '31/01/2027' })).toEqual(['data-invalida']);
  });
  it('dependente pede titular e parentesco, e não pode ser titular de si mesmo', () => {
    expect(codigos({ ...base, titular: false })).toEqual(['titular-obrigatorio', 'parentesco-obrigatorio']);
    expect(codigos({ ...base, titular: false, titularPaciente: 1, parentesco: 3 })).toEqual([
      'titular-e-o-proprio',
    ]);
    expect(codigos({ ...base, titular: false, titularNome: 'MARIA', parentesco: 3 })).toEqual([]);
  });
});

describe('cobertura do paciente: situação no dia e proposta ao atendimento', () => {
  const c = { situacao: 'ativa', validade: '2026-12-31', vigenciaInicio: '2026-01-01', vigenciaFim: null };
  it('vigente, a vencer, vencida e encerrada', () => {
    expect(situacaoDaCarteira(c, '2026-06-01')).toBe('vigente');
    expect(situacaoDaCarteira(c, '2026-12-15')).toBe('a_vencer');
    expect(situacaoDaCarteira(c, '2027-01-01')).toBe('vencida');
    expect(situacaoDaCarteira({ ...c, situacao: 'cancelada' }, '2026-06-01')).toBe('encerrada');
    expect(situacaoDaCarteira({ ...c, vigenciaFim: '2026-05-31' }, '2026-06-01')).toBe('encerrada');
    expect(situacaoDaCarteira({ ...c, validade: null }, '2030-01-01')).toBe('vigente');
  });
  it('propõe a principal utilizável; nunca a vencida', () => {
    const lista = [
      { ...c, id: 1, principal: false, vigenciaInicio: '2026-03-01' },
      { ...c, id: 2, principal: true, validade: '2026-01-31' },
      { ...c, id: 3, principal: false },
    ];
    expect(coberturaProposta(lista, '2026-06-01')?.id).toBe(1);
    expect(coberturaProposta([{ ...lista[1]!, validade: null }, lista[0]!], '2026-06-01')?.id).toBe(2);
    expect(coberturaProposta([lista[1]!], '2026-06-01')).toBeNull();
  });
});
