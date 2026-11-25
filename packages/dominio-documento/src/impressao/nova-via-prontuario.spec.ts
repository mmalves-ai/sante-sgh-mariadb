import { describe, expect, it } from 'vitest';
import { MENSAGEM_NOVA_VIA, planoNovaViaProntuario } from './nova-via-prontuario.js';

const perda = { ativo: true, exigeComplemento: false, descricao: 'Perda da via anterior' };
const outro = { ativo: true, exigeComplemento: true, descricao: 'Outro motivo' };

describe('planoNovaViaProntuario (01-ADM L79: um só caminho de motivo)', () => {
  it('documento nunca impresso não tem nova via', () => {
    expect(planoNovaViaProntuario({ viasAnteriores: 0, motivoInformado: true, motivo: perda })).toEqual({
      recusa: 'documento-nunca-impresso',
    });
  });

  it('sem motivo do catálogo a nova via é recusada, com a mensagem própria', () => {
    expect(planoNovaViaProntuario({ viasAnteriores: 1, motivoInformado: false, motivo: null })).toEqual({
      recusa: 'motivo-obrigatorio',
    });
    expect(MENSAGEM_NOVA_VIA['motivo-obrigatorio']).toMatch(/motivo da reimpressão/);
  });

  it('motivo inexistente ou inativo no catálogo é recusado', () => {
    expect(planoNovaViaProntuario({ viasAnteriores: 1, motivoInformado: true, motivo: null })).toEqual({
      recusa: 'motivo-inexistente',
    });
    expect(
      planoNovaViaProntuario({
        viasAnteriores: 1,
        motivoInformado: true,
        motivo: { ...perda, ativo: false },
      }),
    ).toEqual({ recusa: 'motivo-inativo' });
  });

  it('motivo que pede complemento exige o texto mínimo', () => {
    expect(
      planoNovaViaProntuario({
        viasAnteriores: 2,
        motivoInformado: true,
        motivo: outro,
        complemento: ' abc ',
      }),
    ).toEqual({ recusa: 'complemento-obrigatorio' });
  });

  it('via crescente e o texto da emissão com a descrição e o complemento', () => {
    expect(planoNovaViaProntuario({ viasAnteriores: 1, motivoInformado: true, motivo: perda })).toEqual({
      via: 2,
      complemento: null,
      textoEmissao: 'Perda da via anterior',
    });
    expect(
      planoNovaViaProntuario({
        viasAnteriores: 3,
        motivoInformado: true,
        motivo: outro,
        complemento: ' pedido do convênio ',
      }),
    ).toEqual({
      via: 4,
      complemento: 'pedido do convênio',
      textoEmissao: 'Outro motivo: pedido do convênio',
    });
  });

  it('o texto da emissão cabe no registro da emissão (200)', () => {
    const p = planoNovaViaProntuario({
      viasAnteriores: 1,
      motivoInformado: true,
      motivo: outro,
      complemento: 'x'.repeat(400),
    });
    expect('textoEmissao' in p && p.textoEmissao.length).toBe(200);
    expect('complemento' in p && p.complemento?.length).toBe(400);
  });
});
