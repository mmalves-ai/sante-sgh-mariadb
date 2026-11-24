// F3.6 (05-SUP linha 14): etiqueta de identificação (DataMatrix GS1 e código linear) e leitura pelo padrão configurado,
// resolvida contra a etiqueta do hospital e o código de barras do item.
import { describe, expect, it } from 'vitest';
import {
  type CodigoBarrasConhecido,
  conferirEtiqueta,
  dataPeloFormato,
  digitoGs1,
  type EtiquetaConhecida,
  gtin14,
  identificadorEtiqueta,
  identificadorValido,
  lerCodigo,
  lerPeloPadrao,
  montarEtiqueta,
  type PadraoLeitura,
  resolverLeitura,
} from '@sgh/contratos/regras-suprimentos';

const GS = '\u001d';
const EAN = '4006381333931';
const GTIN = '04006381333931';

describe('GTIN e identificador', () => {
  it('confere o dígito verificador e normaliza para GTIN-14', () => {
    expect(digitoGs1('400638133393')).toBe(1);
    expect(gtin14(EAN)).toBe(GTIN);
    expect(gtin14(GTIN)).toBe(GTIN);
    expect(gtin14('4006381333932')).toBeNull();
    expect(gtin14('ABC')).toBeNull();
  });

  it('gera identificador único com conferência e recusa o adulterado', () => {
    const a = identificadorEtiqueta(1);
    const b = identificadorEtiqueta(2);
    expect(a).toMatch(/^E[0-9A-Z]{7}$/);
    expect(a).not.toBe(b);
    expect(identificadorValido(a)).toBe(true);
    expect(identificadorValido(a.toLowerCase())).toBe(true);
    const trocado = `${a.slice(0, 6)}${a[6] === 'Z' ? 'Y' : 'Z'}${a.slice(7)}`;
    expect(identificadorValido(trocado)).toBe(false);
    expect(() => identificadorEtiqueta(0)).toThrow(RangeError);
  });
});

describe('etiqueta', () => {
  const id = identificadorEtiqueta(46656);

  it('monta o DataMatrix GS1 (fixos primeiro, variáveis com GS) e o código linear', () => {
    const m = montarEtiqueta({ identificador: id, gtin: EAN, lote: 'L123', validade: '2027-05-31' });
    expect(m.datamatrix).toBe(`01${GTIN}17270531` + `10L123${GS}21${id}`);
    expect(m.barras).toBe(id);
    expect(m.legivel).toBe(`(01)${GTIN}(17)270531(10)L123(21)${id}`);
  });

  it('sem GTIN nem lote leva só o identificador; a leitura GS1 devolve o que foi gravado', () => {
    expect(montarEtiqueta({ identificador: id }).datamatrix).toBe(`21${id}`);
    const m = montarEtiqueta({ identificador: id, gtin: EAN, lote: 'L123', validade: '2027-05-31' });
    const l = lerCodigo(m.datamatrix, []);
    expect(l).toEqual({ produto: GTIN, lote: 'L123', serie: id, validade: '2027-05-31', padraoId: null });
  });

  it('recusa identificador, GTIN, lote e validade inválidos, cada um com o campo', () => {
    const r = conferirEtiqueta({
      identificador: 'X1',
      gtin: '4006381333932',
      lote: 'lote com espaço',
      validade: '2027-02-30',
    });
    expect(r.map((x) => x.codigo)).toEqual([
      'identificador-invalido',
      'gtin-invalido',
      'lote-etiqueta-invalido',
      'validade-invalida',
    ]);
    expect(r.map((x) => x.campos?.[0])).toEqual(['identificador', 'gtin', 'lote', 'validade']);
    expect(() => montarEtiqueta({ identificador: 'X1' })).toThrow(/identificador-invalido/);
  });
});

describe('leitura pelo padrão configurado', () => {
  const base: PadraoLeitura = {
    id: 7,
    ativo: true,
    expressao: null,
    campos: {},
    formatoData: null,
    zerosEsquerda: false,
  };

  it('converte a data por formato; mês sem dia vira o último dia', () => {
    expect(dataPeloFormato('270531', 'AAMMDD')).toBe('2027-05-31');
    expect(dataPeloFormato('31052027', 'DDMMAAAA')).toBe('2027-05-31');
    expect(dataPeloFormato('0228', 'MMAA')).toBe('2028-02-29');
    expect(dataPeloFormato('270500', null)).toBe('2027-05-31');
    expect(dataPeloFormato('271331', 'AAMMDD')).toBeNull();
    expect(dataPeloFormato('270230', 'AAMMDD')).toBeNull();
  });

  it('lê por prefixo, posição e tamanho (fixo e faixa com GS), com zeros à esquerda tirados', () => {
    const p: PadraoLeitura = {
      ...base,
      zerosEsquerda: true,
      formatoData: 'DDMMAAAA',
      campos: {
        produto: { prefixo: 'P', ordem: 1, tamanho: '8' },
        validade: { prefixo: 'V', ordem: 2, tamanho: '8' },
        lote: { prefixo: 'L', ordem: 3, tamanho: '1-10' },
        serie: { prefixo: 'S', ordem: 4, tamanho: '1-12' },
      },
    };
    expect(lerPeloPadrao(`P00012345V31052027LAB12${GS}SX9`, p)).toEqual({
      produto: '12345',
      validade: '2027-05-31',
      lote: 'AB12',
      serie: 'X9',
      padraoId: 7,
    });
    expect(lerPeloPadrao('Q00012345V31052027LAB12', p)).toBeNull();
    expect(lerPeloPadrao(`P00012345V31132027LAB12${GS}SX9`, p)).toBeNull();
    expect(lerPeloPadrao(`P00012345V31052027LAB12${GS}SX9SOBRA-DEMAIS-AQUI`, p)).toBeNull();
    expect(lerPeloPadrao(`P00012345V31052027LAB12${GS}SX9`, { ...p, ativo: false })).toBeNull();
  });

  it('lê pela expressão com grupos nomeados; expressão inválida não reconhece', () => {
    const p: PadraoLeitura = {
      ...base,
      expressao: '^(?<produto>\\d{13})-(?<lote>[A-Z0-9]+)-(?<validade>\\d{4})$',
      formatoData: 'MMAA',
    };
    expect(lerPeloPadrao(`${EAN}-K77-1227`, p)).toEqual({
      produto: EAN,
      lote: 'K77',
      serie: null,
      validade: '2027-12-31',
      padraoId: 7,
    });
    expect(lerPeloPadrao('outra coisa', p)).toBeNull();
    expect(lerPeloPadrao('x', { ...p, expressao: '(' })).toBeNull();
  });

  it('o primeiro padrão que reconhece vence; sem padrão, GS1; sem GS1, o texto como código simples', () => {
    const a: PadraoLeitura = { ...base, id: 1, expressao: '^A(?<produto>\\d+)$' };
    const b: PadraoLeitura = { ...base, id: 2, expressao: '^(?<produto>\\d+)$' };
    expect(lerCodigo('A123', [a, b]).padraoId).toBe(1);
    expect(lerCodigo('123', [a, b]).padraoId).toBe(2);
    expect(lerCodigo(`(01)${GTIN}(10)Z9`, [a]).lote).toBe('Z9');
    expect(lerCodigo(' 7891 ', [])).toEqual({
      produto: '7891',
      lote: null,
      serie: null,
      validade: null,
      padraoId: null,
    });
    // EAN-13 que começa com "10" é o código do item, não lote GS1.
    const ean10 = `101234567890${digitoGs1('101234567890')}`;
    expect(lerCodigo(ean10, [])).toMatchObject({ produto: ean10, lote: null });
  });
});

describe('resolução contra o cadastro', () => {
  const id = identificadorEtiqueta(99);
  const etiquetas = new Map<string, EtiquetaConhecida>([
    [
      id,
      {
        identificador: id,
        insumoId: 10,
        lote: 'L1',
        validade: '2027-01-31',
        quantidade: 1,
        situacao: 'ativa',
      },
    ],
  ]);
  const codigos = new Map<string, CodigoBarrasConhecido>([
    [GTIN, { codigo: GTIN, insumoId: 20, quantidadeRepresentada: 12 }],
    ['INT-55', { codigo: 'INT-55', insumoId: 30, quantidadeRepresentada: 1 }],
  ]);
  const cad = {
    etiqueta: (i: string) => etiquetas.get(i),
    codigoItem: (c: string) => codigos.get(c),
  };

  it('a etiqueta do hospital resolve item, lote, validade e quantidade (lida inteira ou na série GS1)', () => {
    const r = resolverLeitura(lerCodigo(id, []), cad);
    expect(r).toMatchObject({ ok: true, insumoId: 10, lote: 'L1', identificador: id, origem: 'etiqueta' });
    const dm = montarEtiqueta({ identificador: id, lote: 'L1', validade: '2027-01-31' }).datamatrix;
    expect(resolverLeitura(lerCodigo(dm, []), cad)).toMatchObject({ ok: true, insumoId: 10 });
  });

  it('recusa etiqueta desconhecida, inativa e divergente', () => {
    const outro = identificadorEtiqueta(100);
    expect(resolverLeitura(lerCodigo(outro, []), cad)).toMatchObject({
      ok: false,
      recusa: { codigo: 'etiqueta-desconhecida' },
    });
    const consumida = {
      ...cad,
      etiqueta: (i: string) => ({
        ...(etiquetas.get(i) as EtiquetaConhecida),
        situacao: 'consumida' as const,
      }),
    };
    expect(resolverLeitura(lerCodigo(id, []), consumida)).toMatchObject({
      ok: false,
      recusa: { codigo: 'etiqueta-inativa' },
    });
    const dm = montarEtiqueta({ identificador: id, lote: 'OUTRO' }).datamatrix;
    expect(resolverLeitura(lerCodigo(dm, []), cad)).toMatchObject({
      ok: false,
      recusa: { codigo: 'etiqueta-divergente' },
    });
  });

  it('o código do item resolve pelo GTIN-14 (EAN-13 lido), com a quantidade da embalagem e o lote lido', () => {
    expect(resolverLeitura(lerCodigo(EAN, []), cad)).toMatchObject({
      ok: true,
      insumoId: 20,
      quantidade: 12,
      origem: 'codigo-item',
    });
    expect(resolverLeitura(lerCodigo(`01${GTIN}17270531` + `10LX`, []), cad)).toMatchObject({
      ok: true,
      insumoId: 20,
      lote: 'LX',
      validade: '2027-05-31',
    });
    expect(resolverLeitura(lerCodigo('INT-55', []), cad)).toMatchObject({ ok: true, insumoId: 30 });
  });

  it('recusa código vazio e desconhecido', () => {
    expect(resolverLeitura(lerCodigo('  ', []), cad)).toMatchObject({
      ok: false,
      recusa: { codigo: 'codigo-vazio' },
    });
    expect(resolverLeitura(lerCodigo('999', []), cad)).toMatchObject({
      ok: false,
      recusa: { codigo: 'codigo-desconhecido' },
    });
  });
});
