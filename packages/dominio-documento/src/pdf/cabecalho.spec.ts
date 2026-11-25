// 03-PEP L131: regra de cabeçalho por tipo de documento. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  montarCabecalho,
  type RegraCabecalho,
  resolverCabecalho,
  validarRegraCabecalho,
} from './cabecalho.js';

const r = (p: Partial<RegraCabecalho>): RegraCabecalho => ({
  id: 1,
  estabelecimento: null,
  tipoDocumento: null,
  fonte: 'estabelecimento',
  cabecalho: null,
  rodape: null,
  exibeDadosPaciente: true,
  exibeAssinatura: true,
  ativo: true,
  ...p,
});
const est = {
  nome: 'Hospital Sintético',
  cnpj: '12345678000195',
  cnes: '1234567',
  endereco: 'Rua A, 1',
  telefone: null,
};

describe('regra de cabeçalho', () => {
  it('valida texto próprio, linhas e marcação', () => {
    expect(validarRegraCabecalho({ fonte: 'personalizado', cabecalho: null, rodape: null })[0]?.campo).toBe(
      'cabecalho',
    );
    expect(
      validarRegraCabecalho({ fonte: 'estabelecimento', cabecalho: 'Linha', rodape: null }),
    ).toHaveLength(1);
    expect(
      validarRegraCabecalho({
        fonte: 'personalizado',
        cabecalho: 'a\nb\nc\nd\ne\nf\ng',
        rodape: '<b>x</b>',
      }).map((f) => f.campo),
    ).toEqual(['cabecalho', 'rodape']);
    expect(
      validarRegraCabecalho({ fonte: 'personalizado', cabecalho: 'Hospital\nAla B', rodape: 'Fim' }),
    ).toEqual([]);
  });
  it('escolhe a regra mais específica entre as ativas', () => {
    const regras = [
      r({ id: 1 }),
      r({ id: 2, estabelecimento: 10 }),
      r({ id: 3, tipoDocumento: 7 }),
      r({ id: 4, estabelecimento: 10, tipoDocumento: 7 }),
      r({ id: 5, estabelecimento: 10, tipoDocumento: 8, ativo: false }),
    ];
    expect(resolverCabecalho(regras, 10, 7)?.id).toBe(4);
    expect(resolverCabecalho(regras, 11, 7)?.id).toBe(3);
    expect(resolverCabecalho(regras, 10, 8)?.id).toBe(2);
    expect(resolverCabecalho(regras, 11, 8)?.id).toBe(1);
    expect(resolverCabecalho(regras, 10, null)?.id).toBe(2);
    expect(resolverCabecalho([], 10, 7)).toBeNull();
  });
  it('monta as linhas pela fonte', () => {
    expect(montarCabecalho(null, est, null).linhas).toEqual([
      'Hospital Sintético',
      'CNPJ 12.345.678/0001-95 · CNES 1234567',
      'Rua A, 1',
    ]);
    const proprio = montarCabecalho(
      r({
        fonte: 'personalizado',
        cabecalho: 'Linha 1\n\nLinha 2',
        rodape: 'Rodapé',
        exibeAssinatura: false,
      }),
      est,
      null,
    );
    expect(proprio).toEqual({
      linhas: ['Linha 1', 'Linha 2'],
      rodape: ['Rodapé'],
      exibeDadosPaciente: true,
      exibeAssinatura: false,
    });
    expect(montarCabecalho(r({ fonte: 'mantenedora' }), est, { ...est, nome: 'Mantenedora' }).linhas[0]).toBe(
      'Mantenedora',
    );
  });
});
