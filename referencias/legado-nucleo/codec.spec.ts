// Regras 2 e 3 da ficha do M02: grava-se o que o SPDATA gravaria (sentinela, HHMM, letra da coluna) e
// 1899-12-30 nunca vira NULL nem 00:00:28. Tabela de casos por convenção do cap-10 (dados sintéticos).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  codePageRtf,
  conferirDominio,
  conferirFusoFixo,
  conferirRegravacao,
  conferirRtf,
  contemUtf8Multibyte,
  civilDoBanco,
  instanteDoBanco,
  deCivil,
  ehRtf,
  ehSentinelaVazio,
  exibirDinheiro,
  fusoFixo,
  lerBlobTexto,
  lerBooleano,
  lerData,
  lerHoraHHMM,
  lerTexto,
  paraCivil,
  prepararBlobTexto,
  prepararBooleano,
  prepararData,
  prepararDinheiro,
  prepararHoraHHMM,
  prepararTexto,
  RELOGIO_DO_BANCO,
  SENTINELA_VAZIO,
} from './codec.js';
import { colunaUtf8, COLUNAS_UTF8 } from './colunas-utf8.js';
import {
  BYTES_INDEFINIDOS_CP1252,
  CODIFICACAO_NONE,
  caractereCp1252,
  codificarCp1252,
  decodificarCp1252,
  foraDoCp1252,
  registrarCodificacaoNone,
  TABELA_CP1252,
} from './cp1252.js';
import iconv from 'iconv-lite';

describe('CP1252 sem perda', () => {
  const todos = Uint8Array.from({ length: 256 }, (_, i) => i);

  it('os 256 bytes vão e voltam iguais, inclusive os 5 indefinidos', () => {
    expect(TABELA_CP1252).toHaveLength(256);
    expect(codificarCp1252(decodificarCp1252(todos))).toEqual(Buffer.from(todos));
    for (const b of BYTES_INDEFINIDOS_CP1252) expect(TABELA_CP1252.charCodeAt(b)).toBe(b);
  });

  it('registra no iconv-lite a codificação usada pelo driver em charSetForNONE (idempotente)', () => {
    expect(registrarCodificacaoNone()).toBe(CODIFICACAO_NONE);
    expect(registrarCodificacaoNone()).toBe(CODIFICACAO_NONE);
    const s = iconv.decode(Buffer.from(todos), CODIFICACAO_NONE);
    expect(Buffer.compare(iconv.encode(s, CODIFICACAO_NONE), Buffer.from(todos))).toBe(0);
    // O 'win1252' do iconv-lite perde os bytes indefinidos (por isso não é usado).
    const w = iconv.encode(iconv.decode(Buffer.from(todos), 'win1252'), 'win1252');
    expect(Buffer.compare(w, Buffer.from(todos))).not.toBe(0);
  });

  it('acentos, € e aspas curvas existem; emoji e ≥ não', () => {
    expect(codificarCp1252('ção€“”…—')).toEqual(
      Buffer.from([0xe7, 0xe3, 0x6f, 0x80, 0x93, 0x94, 0x85, 0x97]),
    );
    expect(caractereCp1252('é')).toBe(true);
    expect(foraDoCp1252('ok ≥ 1')).toBe('≥');
    expect(foraDoCp1252('😊')).toBe('😊');
    expect(foraDoCp1252('João')).toBeNull();
    expect(() => codificarCp1252('≥')).toThrow(/fora do CP1252/);
  });
});

describe('texto', () => {
  it.each([
    ['CHAR tira o preenchimento', 'ABC   ', { tipo: 'CHAR' as const }, 'ABC'],
    ['VARCHAR mantém espaço final', 'ABC ', { tipo: 'VARCHAR' as const }, 'ABC '],
    ['acento CP1252', 'São José', { tipo: 'VARCHAR' as const }, 'São José'],
  ])('%s', (_, valor, coluna, esperado) => {
    expect(lerTexto(valor, coluna)).toEqual({ texto: esperado, misto: false });
  });

  it('NULL continua NULL', () => {
    expect(lerTexto(null, { tipo: 'VARCHAR' })).toBeNull();
  });

  it('texto UTF-8 gravado por integração é reconhecido e marcado, e nunca regravado', () => {
    const misto = decodificarCp1252(Buffer.from('Conceição Á', 'utf8'));
    const lido = lerTexto(misto, { tipo: 'VARCHAR' });
    expect(lido?.misto).toBe(true);
    expect(() => conferirRegravacao(lido as never)).toThrow(/não o regrava/);
    expect(() => conferirRegravacao({ texto: 'ok', misto: false })).not.toThrow();
  });

  it('detecção de UTF-8 multibyte: só sequências válidas', () => {
    expect(contemUtf8Multibyte(Buffer.from('ação', 'utf8'))).toBe(true);
    expect(contemUtf8Multibyte(Buffer.from('€', 'utf8'))).toBe(true);
    expect(contemUtf8Multibyte(Buffer.from('😊', 'utf8'))).toBe(true);
    expect(contemUtf8Multibyte(codificarCp1252('NÃO AÇÃO'))).toBe(false);
    expect(contemUtf8Multibyte(Uint8Array.from([0xc3]))).toBe(false);
    expect(contemUtf8Multibyte(Uint8Array.from([0xed, 0xa0, 0x80]))).toBe(false); // substituto codificado
  });

  it('coluna UTF-8 catalogada lê e grava UTF-8', () => {
    expect(colunaUtf8('prcontevol', 'evolucao_xml')).toBe(true);
    expect(colunaUtf8('RICADPAC', 'NOME')).toBe(false);
    expect([...COLUNAS_UTF8]).toEqual(['PRCONTEVOL.EVOLUCAO_XML', 'RPMATRIZ_GUT_DESCRICAO.NOME']);
    const gravado = prepararTexto('<x>ação ≥ 1</x>', { tipo: 'BLOB', utf8: true });
    expect(codificarCp1252(gravado)).toEqual(Buffer.from('<x>ação ≥ 1</x>', 'utf8'));
    expect(lerTexto(gravado, { tipo: 'BLOB', utf8: true })).toEqual({
      texto: '<x>ação ≥ 1</x>',
      misto: false,
    });
    expect(lerTexto(decodificarCp1252(Uint8Array.from([0xff])), { tipo: 'BLOB', utf8: true })?.misto).toBe(
      true,
    );
  });

  it('gravação recusa fora do CP1252 (sem troca silenciosa) e confere o limite em bytes', () => {
    expect(prepararTexto('Conceição', { tipo: 'VARCHAR', tamanhoBytes: 9 })).toBe('Conceição');
    expect(() => prepararTexto('Conceição!', { tipo: 'VARCHAR', tamanhoBytes: 9 })).toThrow(/10 bytes/);
    expect(() => prepararTexto('≥', { tipo: 'VARCHAR' })).toThrow(/U\+2265/);
    expect(() => prepararTexto('a'.repeat(3), { tipo: 'VARCHAR', tamanhoBytes: 2, utf8: true })).toThrow(
      /bytes/,
    );
  });

  it('BLOB de texto: CP1252 nos dois sentidos, UTF-8 na coluna catalogada', () => {
    const bytes = prepararBlobTexto('Evolução: estável');
    expect(bytes).toEqual(codificarCp1252('Evolução: estável'));
    expect(lerBlobTexto(bytes)).toEqual({ texto: 'Evolução: estável', misto: false });
    expect(prepararBlobTexto('ação', { utf8: true })).toEqual(Buffer.from('ação', 'utf8'));
    expect(lerBlobTexto(Buffer.from('ação', 'utf8'), { utf8: true })).toEqual({
      texto: 'ação',
      misto: false,
    });
  });
});

describe('RTF', () => {
  const rtf = '{\\rtf1\\ansi\\ansicpg1252\\deff0 Evolução}';
  it('reconhece e lê a code page', () => {
    expect(ehRtf(rtf)).toBe(true);
    expect(ehRtf('texto')).toBe(false);
    expect(codePageRtf(rtf)).toBe(1252);
    expect(codePageRtf('{\\rtf1 x}')).toBeNull();
  });
  it('gravação: só \\ansicpg1252 e só CP1252', () => {
    expect(() => conferirRtf(rtf)).not.toThrow();
    expect(() => conferirRtf('{\\rtf1 sem declaração}')).not.toThrow();
    expect(() => conferirRtf('{\\rtf1\\ansicpg65001 x}')).toThrow(/65001/);
    expect(() => conferirRtf('{\\rtf1 ≥}')).toThrow(/fora do CP1252/);
    expect(() => conferirRtf('não é rtf')).toThrow(/RTF/);
  });
});

describe('datas e sentinelas (TZ de São Paulo: LMT antes de 1914)', () => {
  const tzOriginal = process.env['TZ'];
  beforeAll(() => {
    process.env['TZ'] = 'America/Sao_Paulo';
  });
  afterAll(() => {
    if (tzOriginal === undefined) delete process.env['TZ'];
    else process.env['TZ'] = tzOriginal;
  });

  it('o fuso local de 1899 tem segundos (o motivo do 00:00:28)', () => {
    expect(new Date(1899, 11, 30).getTimezoneOffset()).not.toBe(180);
  });

  it('1899-12-30 lido = vazio; gravado a partir de vazio = 1899-12-30 00:00:00 exata, nunca NULL', () => {
    const sentinela = new Date(1899, 11, 30, 0, 0, 0);
    expect(lerData(sentinela)).toEqual({ tipo: 'vazio' });
    const gravada = prepararData(null);
    expect(gravada).not.toBeNull();
    expect(paraCivil(gravada)).toEqual({
      ...SENTINELA_VAZIO,
      hora: 0,
      minuto: 0,
      segundo: 0,
      milissegundo: 0,
    });
    expect(ehSentinelaVazio(paraCivil(gravada))).toBe(true);
  });

  it('início do horário de verão: 2017-10-15 00:30 não existe no fuso; deCivil recusa (nunca grava 01:30)', () => {
    expect(paraCivil(new Date(2017, 9, 15, 0, 30)).hora).toBe(1); // o buraco do fuso
    expect(() => deCivil({ ano: 2017, mes: 10, dia: 15, hora: 0, minuto: 30 })).toThrow(/horário de verão/);
    expect(fusoFixo()).toBe(false);
    expect(() => conferirFusoFixo()).toThrow(/TZ=UTC/);
  });

  it('00:00:28 não é a sentinela', () => {
    const deslocada = new Date(1899, 11, 30, 0, 0, 28);
    expect(lerData(deslocada).tipo).toBe('invalida');
  });

  it.each([
    [new Date(2099, 11, 31), 'sem-data'],
    [new Date(2099, 0, 1, 10, 30), 'sem-data'],
    [new Date(1850, 0, 1), 'invalida'],
    [new Date(2150, 0, 1), 'invalida'],
    [new Date(2026, 9, 19, 8, 30), 'data'],
  ] as const)('%s → %s', (d, tipo) => {
    expect(lerData(d).tipo).toBe(tipo);
  });

  it('NULL do banco é nulo (distinto de vazio)', () => {
    expect(lerData(null)).toEqual({ tipo: 'nulo' });
  });

  it('ida e volta civil exata, inclusive ano < 100 e data inexistente recusada', () => {
    const c = { ano: 2026, mes: 2, dia: 28, hora: 23, minuto: 59, segundo: 58, milissegundo: 5 };
    expect(paraCivil(deCivil(c))).toEqual(c);
    expect(paraCivil(deCivil({ ano: 50, mes: 1, dia: 1 })).ano).toBe(50);
    expect(() => deCivil({ ano: 2026, mes: 2, dia: 30 })).toThrow(/inexistente/);
  });

  it('data de controle usa o relógio do banco', () => {
    expect(RELOGIO_DO_BANCO).toBe('CURRENT_TIMESTAMP');
  });
});

describe('hora HHMM', () => {
  it.each([
    ['0830', { hora: 8, minuto: 30 }],
    ['2359', { hora: 23, minuto: 59 }],
    ['0000', { hora: 0, minuto: 0 }],
  ])('lê %s', (v, h) => {
    expect(lerHoraHHMM(v)).toEqual(h);
  });
  it('vazio é null; formato errado é erro', () => {
    expect(lerHoraHHMM(null)).toBeNull();
    expect(lerHoraHHMM('    ')).toBeNull();
    expect(() => lerHoraHHMM('8:30')).toThrow(/HHMM/);
    expect(() => lerHoraHHMM('2460')).toThrow(/HHMM/);
  });
  it.each([
    [{ hora: 8, minuto: 5 }, '0805'],
    ['08:30', '0830'],
    ['8:30', '0830'],
    ['0830', '0830'],
  ])('grava %o como %s (quatro dígitos, sem dois-pontos)', (v, s) => {
    expect(prepararHoraHHMM(v)).toBe(s);
  });
  it('hora inválida é recusada', () => {
    expect(() => prepararHoraHHMM('25:00')).toThrow();
    expect(() => prepararHoraHHMM({ hora: 1.5, minuto: 0 })).toThrow();
    expect(() => prepararHoraHHMM('abc')).toThrow();
  });
});

describe('booleano em letra, por coluna', () => {
  it.each([
    ['T', 'T/F', true],
    ['F', 'T/F', false],
    ['S', 'S/N', true],
    ['N', 'S/N', false],
  ] as const)('%s em %s → %s, e volta à mesma letra', (letra, conv, valor) => {
    expect(lerBooleano(letra, conv)).toBe(valor);
    expect(prepararBooleano(valor, conv)).toBe(letra);
  });
  it('letra de outra convenção é erro; vazio é null', () => {
    expect(() => lerBooleano('S', 'T/F')).toThrow(/T\/F/);
    expect(lerBooleano(null, 'S/N')).toBeNull();
    expect(lerBooleano(' ', 'S/N')).toBeNull();
  });
});

describe('domínio e dinheiro', () => {
  it('valor nunca visto é recusado', () => {
    expect(conferirDominio('A', new Set(['A', 'B']))).toBe('A');
    expect(() => conferirDominio('Z', new Set(['A']))).toThrow(/nunca visto/);
  });
  it('DOUBLE como veio; NUMERIC na escala da coluna', () => {
    expect(prepararDinheiro(10.005, { tipo: 'DOUBLE' })).toBe(10.005);
    expect(prepararDinheiro(10.005, { tipo: 'NUMERIC', escala: 2 })).toBe(10.01);
    expect(prepararDinheiro(-2.675, { tipo: 'NUMERIC', escala: 2 })).toBe(-2.68);
    expect(() => prepararDinheiro(Number.NaN, { tipo: 'DOUBLE' })).toThrow();
    expect(exibirDinheiro(1234.5)).toBe('1.234,50');
  });
});

describe('datas no fuso do processo (UTC, tools/ambiente.sh)', () => {
  const tzOriginal = process.env['TZ'];
  beforeAll(() => {
    process.env['TZ'] = 'UTC';
  });
  afterAll(() => {
    if (tzOriginal === undefined) delete process.env['TZ'];
    else process.env['TZ'] = tzOriginal;
  });

  it('fuso fixo: o núcleo aceita a partida', () => {
    expect(fusoFixo()).toBe(true);
    expect(() => conferirFusoFixo()).not.toThrow();
  });

  it.each([
    { ano: 2017, mes: 10, dia: 15, hora: 0, minuto: 30, segundo: 0, milissegundo: 0 },
    { ano: 1990, mes: 10, dia: 21, hora: 0, minuto: 0, segundo: 0, milissegundo: 0 },
    { ano: 1899, mes: 12, dia: 30, hora: 0, minuto: 0, segundo: 0, milissegundo: 0 },
  ])('ida e volta exata de $ano-$mes-$dia $hora:$minuto', (c) => {
    expect(paraCivil(deCivil(c))).toEqual(c);
  });
});

describe('hora civil do banco × instante (relógio do banco em -03:00)', () => {
  it('a hora civil lida vira o instante real e volta igual', () => {
    const civil = deCivil({
      ano: 2026,
      mes: 10,
      dia: 20,
      hora: 18,
      minuto: 20,
      segundo: 1,
      milissegundo: 439,
    });
    const instante = instanteDoBanco(civil);
    expect(instante.toISOString()).toBe('2026-10-20T21:20:01.439Z');
    expect(paraCivil(civilDoBanco(instante))).toEqual(paraCivil(civil));
  });

  it('uma sessão aberta agora por 60 min não vence na abertura (defeito de 20/10/2026)', () => {
    const agora = new Date('2026-10-20T21:20:01.000Z');
    const expiraCivil = civilDoBanco(new Date(agora.getTime() + 60 * 60_000));
    expect(instanteDoBanco(expiraCivil).getTime()).toBeGreaterThan(agora.getTime());
  });
});
