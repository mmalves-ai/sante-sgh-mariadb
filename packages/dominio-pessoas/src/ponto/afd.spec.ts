// Regra 12 do M52: AFD com sequência quebrada, registro duplicado ou falha de integridade vai INTEIRO para a quarentena
// (nenhuma marcação entra); o relatório tem o motivo e a linha, nunca o conteúdo. Arquivos sintéticos montados aqui
// (os cinco com defeito do critério de aceite estão em @sgh/testes e no `pnpm ponto:afd-validar`). CPF sintético.
import { describe, expect, it } from 'vitest';
import {
  ASSINATURA_EM_ARQUIVO,
  cpfDoAfd,
  crc16,
  dataDoAfd,
  instanteDoAfd,
  linhaCabecalhoAfd,
  linhaEventoAfd,
  linhaMarcacaoAfd,
  linhaTrailerAfd,
  validarAfd,
} from './afd.js';

const CPF_A = '12345678909';
const CPF_B = '11144477735';
const cab = (extra: Partial<Parameters<typeof linhaCabecalhoAfd>[0]> = {}) =>
  linhaCabecalhoAfd({
    cnpj: '00000000000191',
    razaoSocial: 'HOSPITAL SINTETICO',
    numeroRep: '00004000000000123',
    dataInicial: '2026-09-01',
    dataFinal: '2026-09-30',
    geradoEm: '2026-10-01T08:00:00-0300',
    ...extra,
  });
const m = (nsr: number, quando: string, cpf = CPF_A) => linhaMarcacaoAfd(nsr, `${quando}:00-0300`, cpf);
function arquivo(linhas: string[], contagens?: Parameters<typeof linhaTrailerAfd>[0]): string {
  const c = contagens ?? { '3': linhas.length };
  return [cab(), ...linhas, linhaTrailerAfd(c)].join('\r\n');
}
const valido = () =>
  arquivo([
    m(1, '2026-09-02T06:58'),
    m(2, '2026-09-02T19:03'),
    m(3, '2026-09-02T07:00', CPF_B),
    m(4, '2026-09-02T19:00', CPF_B),
  ]);
const codigos = (c: string) => validarAfd(c).falhas.map((f) => f.codigo);

describe('AFD: arquivo válido', () => {
  it('lê o cabeçalho e as marcações (instante local, CPF do campo de 12 posições)', () => {
    const r = validarAfd(valido());
    expect(r.situacao).toBe('valido');
    expect(r.cabecalho).toMatchObject({
      tipoEmpregador: 'cnpj',
      cnpjEmpregador: '00000000000191',
      razaoSocial: 'HOSPITAL SINTETICO',
      numeroRep: '00004000000000123',
      dataInicial: '2026-09-01',
      dataFinal: '2026-09-30',
      geradoEm: '2026-10-01T08:00',
      leiaute: '003',
    });
    expect(r.marcacoes).toHaveLength(4);
    expect(r.marcacoes[0]).toMatchObject({
      nsr: 1,
      linha: 2,
      tipoRegistro: 3,
      instante: '2026-09-02T06:58',
      cpf: CPF_A,
    });
    expect(r.nsrInicial).toBe(1);
    expect(r.nsrFinal).toBe(4);
    expect(r.porTipo).toEqual({ '3': 4 });
  });

  it('aceita a linha da assinatura em arquivo depois do trailer, o evento sensível e a quebra de linha só com LF', () => {
    const c = [
      cab(),
      m(1, '2026-09-02T07:00'),
      linhaEventoAfd(2, '2026-09-02T08:00:00-0300', 1),
      linhaTrailerAfd({ '3': 1, '6': 1 }),
      ASSINATURA_EM_ARQUIVO,
      '',
    ].join('\n');
    expect(validarAfd(c).situacao).toBe('valido');
  });

  it('o relógio em outro fuso vira hora de Brasília', () => {
    const c = [
      cab(),
      linhaMarcacaoAfd(1, '2026-09-02T06:00:00-0400', CPF_A),
      linhaTrailerAfd({ '3': 1 }),
    ].join('\n');
    expect(validarAfd(c).marcacoes[0]?.instante).toBe('2026-09-02T07:00');
  });

  it('sem conferir o CRC (parâmetro), a linha com o CRC errado passa', () => {
    const errado = m(1, '2026-09-02T07:00').slice(0, -4) + '0000';
    const c = [cab(), errado, linhaTrailerAfd({ '3': 1 })].join('\n');
    expect(validarAfd(c).situacao).toBe('quarentena');
    expect(validarAfd(c, { conferirCrc: false }).situacao).toBe('valido');
  });
});

describe('AFD: quarentena do arquivo inteiro (regra 12)', () => {
  it('sequência quebrada', () => {
    expect(codigos(arquivo([m(1, '2026-09-02T07:00'), m(3, '2026-09-02T19:00')]))).toEqual([
      'sequencia-quebrada',
    ]);
  });

  it('registro duplicado (NSR repetido) e marcação repetida', () => {
    const r = validarAfd(arquivo([m(1, '2026-09-02T07:00'), m(1, '2026-09-02T19:00')]));
    expect(r.situacao).toBe('quarentena');
    expect(r.marcacoes).toEqual([]);
    expect(r.falhas).toEqual([{ codigo: 'nsr-duplicado', linha: 3 }]);
    expect(codigos(arquivo([m(1, '2026-09-02T07:00'), m(2, '2026-09-02T07:00')]))).toEqual([
      'marcacao-duplicada',
    ]);
  });

  it('falha de integridade: CRC, tamanho, trailer divergente, sem trailer, linha depois do trailer', () => {
    const l = m(1, '2026-09-02T07:00');
    expect(codigos(arquivo([`${l.slice(0, 20)}9${l.slice(21)}`]))).toContain('crc');
    expect(codigos(arquivo([`${l}X`]))).toEqual(['tamanho']);
    expect(codigos(arquivo([l], { '3': 2 }))).toEqual(['trailer-divergente']);
    expect(codigos([cab(), l].join('\n'))).toEqual(['sem-trailer']);
    expect(codigos([cab(), l, linhaTrailerAfd({ '3': 1 }), l].join('\n'))).toEqual(['depois-do-trailer']);
    expect(codigos([cab(), l, `${linhaTrailerAfd({ '3': 1 })}0`].join('\n'))).toEqual(['tamanho']);
  });

  it('cabeçalho ausente, inválido, de outro leiaute ou com o CRC errado; arquivo vazio', () => {
    expect(codigos(['x', linhaTrailerAfd({})].join('\n'))).toEqual(['sem-cabecalho']);
    expect(codigos(['000000000' + '1' + 'x'.repeat(10), linhaTrailerAfd({})].join('\n'))).toEqual([
      'tamanho',
    ]);
    expect(codigos([cab({ dataInicial: '2026-09-31' }), linhaTrailerAfd({})].join('\n'))).toEqual([
      'cabecalho-invalido',
    ]);
    expect(codigos([cab({ leiaute: '002' }), linhaTrailerAfd({})].join('\n'))).toEqual([
      'leiaute-nao-suportado',
    ]);
    const c = cab();
    expect(codigos([`${c.slice(0, -4)}0000`, linhaTrailerAfd({})].join('\n'))).toEqual(['crc']);
    expect(codigos('\n\n')).toEqual(['vazio']);
  });

  it('linha de tipo desconhecido, NSR não numérico, data inválida, CPF inválido e marcação fora do período', () => {
    expect(codigos(arquivo([`${'0'.repeat(8)}18${'0'.repeat(40)}`], {}))).toEqual(['tipo-desconhecido']);
    const semNsr = linhaMarcacaoAfd(1, '2026-09-02T07:00:00-0300', CPF_A).replace(/^000000001/, '00000000A');
    expect(codigos(arquivo([semNsr]))).toContain('sequencia-quebrada');
    expect(codigos(arquivo([linhaMarcacaoAfd(1, '2026-09-31T07:00:00-0300', CPF_A)]))).toEqual([
      'data-invalida',
    ]);
    expect(codigos(arquivo([m(1, '2026-09-02T07:00', '12345678900')]))).toEqual(['cpf-invalido']);
    expect(codigos(arquivo([m(1, '2026-10-02T07:00')]))).toEqual(['fora-do-periodo']);
  });

  it('REP-P não aceita marcação do tipo 3; a marcação do tipo 7 confere o hash', () => {
    expect(validarAfd(valido(), { tipoRep: 'REP-P' }).falhas.map((f) => f.codigo)).toEqual([
      'tipo-desconhecido',
    ]);
    const t7 = (hash: string) =>
      `000000001` +
      `7` +
      `2026-09-02T07:00:00-0300` +
      `0${CPF_A}` +
      `2026-09-02T07:00:05-0300` +
      `01` +
      `1` +
      hash;
    const ok = [cab(), t7('a'.repeat(64)), linhaTrailerAfd({ '7': 1 })].join('\n');
    expect(validarAfd(ok, { tipoRep: 'REP-P' }).situacao).toBe('valido');
    const ruim = [cab(), t7('z'.repeat(64)), linhaTrailerAfd({ '7': 1 })].join('\n');
    expect(validarAfd(ruim).falhas.map((f) => f.codigo)).toEqual(['hash-invalido']);
  });

  it('o relatório lista no máximo 50 falhas e conta todas', () => {
    const linhas = Array.from({ length: 60 }, (_, i) => m(i * 2 + 1, '2026-09-02T07:00'));
    const r = validarAfd(arquivo(linhas));
    expect(r.falhas).toHaveLength(50);
    expect(r.totalFalhas).toBeGreaterThan(60);
  });
});

describe('AFD: campos', () => {
  it('CRC-16/KERMIT conhecido', () => {
    expect(crc16('123456789')).toBe('2189');
  });
  it('CRC dos bytes CP1252: o travessão (0x96) decodificado como na tela ou como na linha de comando dá o mesmo', () => {
    expect(crc16('\u2013')).toBe(crc16('\u0096'));
    expect(crc16('\u20ac')).toBe(crc16('\u0080'));
    // O arquivo do relógio com o travessão na razão social, em bytes CP1252 (o CRC do relógio é sobre o byte 0x96).
    const texto = [
      cab({ razaoSocial: 'HOSPITAL \u2013 SINTETICO' }),
      m(1, '2026-09-02T06:58'),
      linhaTrailerAfd({ '3': 1 }),
    ].join('\r\n');
    const bytes = Uint8Array.from(texto, (c) => (c === '\u2013' ? 0x96 : c.charCodeAt(0)));
    const naTela = new TextDecoder('windows-1252').decode(bytes);
    const naLinhaDeComando = String.fromCharCode(...bytes); // latin1: um caractere por byte
    expect(naTela).toContain('\u2013');
    expect(codigos(naTela)).toEqual([]);
    expect(codigos(naLinhaDeComando)).toEqual([]);
  });
  it('data, data e hora e CPF', () => {
    expect(dataDoAfd('2026-02-29')).toBeNull();
    expect(dataDoAfd('2028-02-29')).toBe('2028-02-29');
    expect(dataDoAfd('29/02/2028')).toBeNull();
    expect(instanteDoAfd('2026-09-02T07:00:00+0000')?.instante).toBe('2026-09-02T04:00');
    expect(instanteDoAfd('2026-09-02T07:00:00-1500')).toBeNull();
    expect(instanteDoAfd('2026-02-30T07:00:00-0300')).toBeNull();
    expect(cpfDoAfd(`1${CPF_A}`)).toBeNull();
    expect(cpfDoAfd(`0${CPF_A}`)).toBe(CPF_A);
  });
});
