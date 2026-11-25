import { describe, expect, it } from 'vitest';
import {
  desfechoDasOcorrencias,
  lerRetornoCnab240,
  retornoRecusado,
  type RetornoLido,
} from './retorno-pagamento.js';

/** Monta uma linha de 240 posições pondo cada trecho na posição FEBRABAN (1-based). */
function linha(trechos: Record<number, string>): string {
  const a = Array.from({ length: 240 }, () => ' ');
  for (const [pos, v] of Object.entries(trechos))
    for (let i = 0; i < v.length; i++) a[Number(pos) - 1 + i] = v[i] as string;
  return a.join('');
}
const n = (v: number, t: number) => String(v).padStart(t, '0');
const cabecalho = (banco = 1, codigo = '2', nsa = 7) =>
  linha({ 1: n(banco, 3), 8: '0', 143: codigo, 158: n(nsa, 6) });
const segA = (titulo: string, valorCent: number, ocorr: string, real?: { data: string; cent: number }) =>
  linha({
    1: '001',
    8: '3',
    14: 'A',
    74: titulo.padStart(20, '0'),
    94: '10122026',
    120: n(valorCent, 15),
    ...(real ? { 155: real.data, 163: n(real.cent, 15) } : {}),
    231: ocorr.padEnd(10, ' '),
  });
const rodape = (qtd: number) => linha({ 1: '001', 8: '9', 24: n(qtd, 6) });
const arquivo = (corpo: string[], qtd?: number) =>
  [cabecalho(), ...corpo, rodape(qtd ?? corpo.length + 2)].join('\r\n') + '\r\n';

describe('desfecho das ocorrências do banco', () => {
  it('"00" paga; agendamento aceito aguarda; qualquer outra rejeita com o motivo', () => {
    expect(desfechoDasOcorrencias(['00']).desfecho).toBe('pago');
    expect(desfechoDasOcorrencias(['BD']).desfecho).toBe('agendado');
    expect(desfechoDasOcorrencias(['BD', 'AG'])).toEqual({
      desfecho: 'rejeitado',
      motivo: 'Agência ou conta do favorecido inválidas',
    });
    expect(desfechoDasOcorrencias(['ZZ']).motivo).toBe('Ocorrência ZZ do banco');
    expect(desfechoDasOcorrencias([]).desfecho).toBe('rejeitado');
  });
});

describe('leitura do retorno CNAB 240 de pagamento', () => {
  it('lê cada título com a ocorrência, a data e o valor reais e soma só o pago', () => {
    const r = lerRetornoCnab240(
      arquivo([
        segA('101', 15050, '00', { data: '11122026', cent: 15000 }),
        segA('102', 9900, 'BD'),
        segA('103', 2000, 'AM'),
      ]),
      1,
    );
    expect(retornoRecusado(r)).toBe(false);
    const ok = r as RetornoLido;
    expect(ok.banco).toBe(1);
    expect(ok.sequencial).toBe(7);
    expect(ok.titulos.map((t) => [t.titulo, t.desfecho, t.dataPagamento, t.valorPago])).toEqual([
      [101, 'pago', '2026-12-11', 150],
      [102, 'agendado', '2026-12-10', 99],
      [103, 'rejeitado', '2026-12-10', 20],
    ]);
    expect(ok.titulos[2]?.motivo).toBe('Valor do pagamento inválido');
    // Total pago = 150,00 (só o título 101).
    expect(ok.totalPago).toBe(150);
  });
  it('aceita quebra de linha só com LF e ignora segmentos que não são A', () => {
    const b = linha({ 1: '001', 8: '3', 14: 'B' });
    const r = lerRetornoCnab240(
      [cabecalho(), segA('5', 100, '00'), b, rodape(4)].join('\n'),
      1,
    ) as RetornoLido;
    expect(r.titulos).toHaveLength(1);
    expect(r.totalPago).toBe(1);
  });
  it('recusa o arquivo inteiro quando não é retorno, é de outro banco, vem cortado ou o rodapé não fecha', () => {
    const cod = (c: string, b = 1) => {
      const r = lerRetornoCnab240(c, b);
      return retornoRecusado(r) ? r.codigo : 'lido';
    };
    expect(cod('')).toBe('arquivo-vazio');
    expect(cod(arquivo([segA('1', 100, '00')]).replace(/^.{240}/, cabecalho(1, '1')))).toBe('nao-e-retorno');
    expect(cod(arquivo([segA('1', 100, '00')]), 341)).toBe('banco-diferente');
    expect(cod(arquivo([segA('1', 100, '00').slice(0, 200)]))).toBe('linha-tamanho');
    expect(cod(arquivo([segA('1', 100, '00')], 9))).toBe('rodape-divergente');
    expect(cod(arquivo([segA('0', 100, '00')]))).toBe('titulo-invalido');
    expect(cod(arquivo([segA('1', 100, '00'), segA('1', 100, '00')]))).toBe('titulo-repetido');
  });
});
