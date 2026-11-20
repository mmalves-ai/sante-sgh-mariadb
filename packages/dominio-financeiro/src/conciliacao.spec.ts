// Conciliação por regra (M32; ficha, seções 6 e 10): sugestão por valor e data, documento ou janela; nunca baixa sozinha.
import { describe, expect, it } from 'vitest';
import {
  type Candidato,
  creditosSemCasamento,
  lerCsv,
  lerExtrato,
  lerOfx,
  sugerirConciliacao,
} from './index.js';

const linhas = [
  { id: 1, data: '2026-03-10', valor: -150.25, historico: 'TARIFA', documento: '' },
  { id: 2, data: '2026-03-11', valor: 1_000, historico: 'TED RECEBIDA DOC 4455', documento: '' },
  { id: 3, data: '2026-03-12', valor: 300, historico: 'PIX', documento: '' },
  { id: 4, data: '2026-03-13', valor: 77.7, historico: 'CREDITO', documento: '' },
];
const cand: Candidato[] = [
  { tipo: 'movimento', id: 10, data: '2026-03-10', valor: -150.25, documento: '' },
  { tipo: 'titulo-receber', id: 20, data: '2026-03-05', valor: 1_000, documento: '4455' },
  { tipo: 'titulo-receber', id: 30, data: '2026-03-10', valor: 300, documento: '' },
  { tipo: 'titulo-receber', id: 31, data: '2026-03-12', valor: 300, documento: '' },
];

describe('conciliação por regra', () => {
  it('valor e data (forte), documento no histórico, valor na janela; um candidato por linha', () => {
    const s = sugerirConciliacao(linhas, cand);
    expect(s.map((x) => [x.linha, x.candidato.id, x.regra])).toEqual([
      [1, 10, 'valor-data'],
      [3, 31, 'valor-data'],
      [2, 20, 'documento'],
    ]);
    expect(creditosSemCasamento(linhas, s).map((l) => l.id)).toEqual([4]);
  });
  it('fora da janela de 3 dias e sem documento não sugere', () => {
    expect(sugerirConciliacao([{ ...linhas[2]!, data: '2026-03-20' }], [cand[2]!])).toEqual([]);
    expect(sugerirConciliacao([{ ...linhas[2]!, data: '2026-03-12' }], [cand[2]!])[0]?.regra).toBe(
      'valor-janela',
    );
  });
});

describe('extrato', () => {
  it('OFX (SGML) e CSV (data;valor;histórico;documento)', () => {
    const ofx =
      '<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260310120000<TRNAMT>-150.25<FITID>A1<MEMO>TARIFA\n</STMTTRN><STMTTRN><DTPOSTED>20260311<TRNAMT>1000.00<CHECKNUM>4455<NAME>TED\n</STMTTRN></OFX>';
    expect(lerOfx(ofx)).toEqual([
      { data: '2026-03-10', valor: -150.25, historico: 'TARIFA', documento: 'A1' },
      { data: '2026-03-11', valor: 1_000, historico: 'TED', documento: '4455' },
    ]);
    expect(lerCsv('data;valor;historico\n10/03/2026;-1.150,25;TARIFA;9\n2026-03-11;300;PIX')).toEqual([
      { data: '2026-03-10', valor: -1_150.25, historico: 'TARIFA', documento: '9' },
      { data: '2026-03-11', valor: 300, historico: 'PIX', documento: '' },
    ]);
    expect(lerExtrato('csv', '2026-03-11;1;X')).toHaveLength(1);
    expect(lerExtrato('ofx', ofx)).toHaveLength(2);
  });
  it('recusa arquivo sem lançamento, valor ou data inválidos', () => {
    expect(() => lerOfx('<OFX></OFX>')).toThrow('STMTTRN');
    expect(() => lerCsv('data;valor')).toThrow('lançamentos');
    expect(() => lerCsv('2026-03-11;abc;X')).toThrow('Valor');
    expect(() => lerCsv('11-03-26;1;X')).toThrow('Data');
  });
});
