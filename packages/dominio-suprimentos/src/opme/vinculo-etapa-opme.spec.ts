// C3-021 (05-SUP linha 25): o documento real a que cada etapa logística do OPME fica ligada — a remessa consignada do
// fornecedor com saldo do material e o recebimento na CME já liberado estéril. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  escolherRecebimentoCmeOpme,
  escolherRemessaConsignadaOpme,
  type RecebimentoCmeCandidatoOpme,
  type RemessaCandidataOpme,
} from '../index.js';

const rem = (o: Partial<RemessaCandidataOpme>): RemessaCandidataOpme => ({
  id: 1,
  fornecedor: 10,
  situacao: 'aberta',
  saldo: 2,
  recebidaEm: '2026-11-18T09:00',
  ...o,
});
const rec = (o: Partial<RecebimentoCmeCandidatoOpme>): RecebimentoCmeCandidatoOpme => ({
  id: 1,
  fornecedor: 10,
  situacao: 'disponivel',
  recebidoEm: '2026-11-19T07:00',
  ...o,
});
const codigo = (v: ReturnType<typeof escolherRemessaConsignadaOpme>) => (v.ok ? null : v.recusa.codigo);

describe('etapa de consignação: a remessa consignada', () => {
  it('escolhe a mais recente do fornecedor que cobre a quantidade', () => {
    const v = escolherRemessaConsignadaOpme(
      [
        rem({ id: 1, recebidaEm: '2026-11-10T09:00' }),
        rem({ id: 2, recebidaEm: '2026-11-15T09:00', saldo: 1 }),
        rem({ id: 3, recebidaEm: '2026-11-12T09:00', situacao: 'conferida' }),
        rem({ id: 4, fornecedor: 11, recebidaEm: '2026-11-17T09:00' }),
      ],
      10,
      2,
    );
    expect(v).toEqual({ ok: true, id: 3 });
  });
  it('recusa sem remessa viva do fornecedor e sem saldo', () => {
    expect(codigo(escolherRemessaConsignadaOpme([rem({ situacao: 'encerrada' })], 10, 1))).toBe(
      'sem-remessa-consignada',
    );
    expect(codigo(escolherRemessaConsignadaOpme([rem({ fornecedor: 11 })], 10, 1))).toBe(
      'sem-remessa-consignada',
    );
    expect(codigo(escolherRemessaConsignadaOpme([rem({ saldo: 0.5 })], 10, 1))).toBe('remessa-sem-saldo');
  });
});

describe('etapa de esterilização: o recebimento na CME', () => {
  it('liga só o disponível, o mais recente, do mesmo fornecedor', () => {
    expect(
      escolherRecebimentoCmeOpme(
        [
          rec({ id: 1, recebidoEm: '2026-11-18T07:00' }),
          rec({ id: 2, recebidoEm: '2026-11-19T07:00' }),
          rec({ id: 3, fornecedor: 11, recebidoEm: '2026-11-19T08:00' }),
          rec({ id: 4, situacao: 'devolvido', recebidoEm: '2026-11-19T09:00' }),
        ],
        10,
      ),
    ).toEqual({ ok: true, id: 2 });
    expect(escolherRecebimentoCmeOpme([rec({ id: 5, fornecedor: null })], 10)).toEqual({ ok: true, id: 5 });
  });
  it('recusa em processamento e sem recebimento', () => {
    expect(codigo(escolherRecebimentoCmeOpme([rec({ situacao: 'em_reprocessamento' })], 10))).toBe(
      'cme-em-processamento',
    );
    expect(codigo(escolherRecebimentoCmeOpme([rec({ situacao: 'conferido' })], 10))).toBe(
      'cme-em-processamento',
    );
    expect(codigo(escolherRecebimentoCmeOpme([rec({ situacao: 'divergente' })], 10))).toBe(
      'sem-recebimento-cme',
    );
    expect(codigo(escolherRecebimentoCmeOpme([rec({ fornecedor: 11 })], 10))).toBe('sem-recebimento-cme');
    expect(codigo(escolherRecebimentoCmeOpme([], null))).toBe('sem-recebimento-cme');
  });
});
