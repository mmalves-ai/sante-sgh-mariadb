// F3.1, 02-CAD linha 16: regras do complemento do profissional (fiscal, conta, RQE e assinatura). Documentos sintéticos.
import { describe, expect, it } from 'vitest';
import {
  assinaturaVigente,
  chavePixValida,
  type ContaBancaria,
  type DadoFiscal,
  errosAssinatura,
  errosContaBancaria,
  errosDadoFiscal,
  errosRqe,
  favorecidoTerceiro,
  pisValido,
  sobreposicaoFiscal,
  vespera,
} from './financeiro.js';

const CPF = '52998224725';
const CNPJ = '11222333000181';
const fiscal = (x: Partial<DadoFiscal> = {}): DadoFiscal => ({
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  tipoRecebedor: 'pessoa_fisica',
  pessoaJuridica: null,
  regime: 'autonomo',
  pisPasep: null,
  aliquotaIss: 5,
  percentualInss: 11,
  retemIss: true,
  retemInss: true,
  dependentesIrrf: 1,
  ...x,
});
const conta = (x: Partial<ContaBancaria> = {}): ContaBancaria => ({
  banco: 1,
  agencia: '1234',
  numeroConta: '998877',
  tipoChavePix: null,
  chavePix: null,
  favorecidoNome: 'FAVORECIDO TESTE',
  favorecidoTipo: 'fisica',
  favorecidoDocumento: CPF,
  ...x,
});

describe('dado fiscal do repasse', () => {
  it('aceita o autônomo completo e recusa cada inconsistência pelo código', () => {
    expect(errosDadoFiscal(fiscal())).toEqual([]);
    expect(errosDadoFiscal(fiscal({ vigenciaFim: '2025-12-31' }))).toContain('vigencia-invertida');
    expect(errosDadoFiscal(fiscal({ tipoRecebedor: 'pessoa_juridica', dependentesIrrf: 0 }))).toEqual([
      'recebedor-sem-empresa',
    ]);
    expect(errosDadoFiscal(fiscal({ pessoaJuridica: 3 }))).toContain('empresa-sem-recebedor-pj');
    expect(errosDadoFiscal(fiscal({ aliquotaIss: 101 }))).toContain('aliquota-iss-fora');
    expect(errosDadoFiscal(fiscal({ aliquotaIss: null }))).toContain('retencao-iss-sem-aliquota');
    expect(errosDadoFiscal(fiscal({ percentualInss: null }))).toContain('retencao-inss-sem-percentual');
    expect(
      errosDadoFiscal(fiscal({ tipoRecebedor: 'pessoa_juridica', pessoaJuridica: 3, dependentesIrrf: 2 })),
    ).toEqual(['dependentes-em-pj']);
    expect(errosDadoFiscal(fiscal({ regime: 'mei' }))).toContain('mei-sem-empresa');
    expect(errosDadoFiscal(fiscal({ pisPasep: '12345678900' }))).toContain('pis-invalido');
  });

  it('PIS pelo dígito verificador', () => {
    expect(pisValido('12056412547')).toBe(true);
    expect(pisValido('12056412548')).toBe(false);
    expect(pisValido('11111111111')).toBe(false);
  });

  it('um dado fiscal por dia e escopo: o aberto anterior encerra na véspera; o resto recusa', () => {
    const r = sobreposicaoFiscal(
      [
        { id: 1, estabelecimento: null, inicio: '2025-01-01', fim: null },
        { id: 2, estabelecimento: 7, inicio: '2025-01-01', fim: null },
        { id: 3, estabelecimento: null, inicio: '2024-01-01', fim: '2024-12-31' },
      ],
      { estabelecimento: null, inicio: '2026-03-01', fim: null },
    );
    expect(r).toEqual({ encerrar: [{ id: 1, fim: '2026-02-28' }], conflitos: [] });
    const c = sobreposicaoFiscal([{ id: 4, estabelecimento: null, inicio: '2026-06-01', fim: null }], {
      estabelecimento: null,
      inicio: '2026-03-01',
      fim: null,
    });
    expect(c.conflitos).toEqual([4]);
    expect(vespera('2026-03-01')).toBe('2026-02-28');
  });
});

describe('conta bancária e chave de pagamento instantâneo', () => {
  it('conta completa ou só a chave; a chave segue a forma do tipo', () => {
    expect(errosContaBancaria(conta())).toEqual([]);
    expect(
      errosContaBancaria(
        conta({ banco: null, agencia: null, numeroConta: null, tipoChavePix: 'cpf', chavePix: CPF }),
      ),
    ).toEqual([]);
    expect(errosContaBancaria(conta({ banco: null, agencia: null, numeroConta: null }))).toEqual([
      'sem-meio-pagamento',
    ]);
    expect(
      errosContaBancaria(conta({ numeroConta: null, tipoChavePix: 'email', chavePix: 'a@b.co' })),
    ).toEqual(['conta-incompleta']);
    expect(errosContaBancaria(conta({ tipoChavePix: 'email', chavePix: null }))).toContain('chave-sem-tipo');
    expect(errosContaBancaria(conta({ tipoChavePix: 'telefone', chavePix: '31999990000' }))).toContain(
      'chave-invalida',
    );
    expect(chavePixValida('telefone', '+5531999990000')).toBe(true);
    expect(chavePixValida('aleatoria', '123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(chavePixValida('cnpj', CNPJ)).toBe(true);
  });

  it('favorecido com documento válido e a chave de documento é a do próprio favorecido', () => {
    expect(errosContaBancaria(conta({ favorecidoDocumento: '52998224726' }))).toContain(
      'favorecido-documento-invalido',
    );
    expect(errosContaBancaria(conta({ favorecidoTipo: 'juridica', favorecidoDocumento: CPF }))).toContain(
      'favorecido-documento-invalido',
    );
    expect(errosContaBancaria(conta({ tipoChavePix: 'cnpj', chavePix: CNPJ }))).toContain(
      'chave-de-outro-favorecido',
    );
    expect(favorecidoTerceiro(CPF, CPF, [])).toBe(false);
    expect(favorecidoTerceiro(CNPJ, CPF, [CNPJ])).toBe(false);
    expect(favorecidoTerceiro(CNPJ, CPF, [])).toBe(true);
  });
});

describe('RQE e assinatura', () => {
  it('RQE só com dígitos e sem data futura', () => {
    expect(errosRqe({ numero: '12345', dataRegistro: '2020-01-01' }, '2026-11-24')).toEqual([]);
    expect(errosRqe({ numero: 'A1', dataRegistro: null }, '2026-11-24')).toEqual(['rqe-invalido']);
    expect(errosRqe({ numero: '1', dataRegistro: '2027-01-01' }, '2026-11-24')).toEqual(['rqe-data-futura']);
  });

  it('imagem pede o arquivo; certificado pede série, titular e impressão em SHA-256', () => {
    const base = {
      titular: null,
      numeroSerie: null,
      impressaoDigital: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    expect(errosAssinatura({ ...base, tipo: 'imagem', arquivo: 9 })).toEqual([]);
    expect(errosAssinatura({ ...base, tipo: 'imagem', arquivo: null })).toEqual(['imagem-sem-arquivo']);
    expect(
      errosAssinatura({
        ...base,
        tipo: 'certificado_digital',
        arquivo: null,
        titular: 'TITULAR TESTE',
        numeroSerie: '0A1B2C',
        impressaoDigital: 'a'.repeat(64),
      }),
    ).toEqual([]);
    expect(
      errosAssinatura({
        ...base,
        tipo: 'certificado_digital',
        arquivo: null,
        numeroSerie: 'xyz',
        impressaoDigital: 'b',
      }),
    ).toEqual(['serie-invalida', 'impressao-digital-invalida', 'certificado-sem-titular']);
  });

  it('uma assinatura vigente por tipo: a mais recente no dia', () => {
    const l = [
      { id: 1, tipo: 'imagem' as const, inicio: '2025-01-01', fim: '2025-12-31', ativo: true },
      { id: 2, tipo: 'imagem' as const, inicio: '2026-01-01', fim: null, ativo: true },
      { id: 3, tipo: 'certificado_digital' as const, inicio: '2026-01-01', fim: null, ativo: false },
    ];
    expect(assinaturaVigente(l, 'imagem', '2026-05-01')?.id).toBe(2);
    expect(assinaturaVigente(l, 'imagem', '2025-05-01')?.id).toBe(1);
    expect(assinaturaVigente(l, 'certificado_digital', '2026-05-01')).toBeNull();
  });
});
