// W0-02 (D-CRUD-SNAP): o retrato da linha inteira (com BLOB) e o registro do evento, sobre o banco por roteiro.
import { describe, expect, it } from 'vitest';
import { BancoRoteiro } from '../banco-roteiro.spec-util.js';
import { gravarEventoCrud, gravarRetrato, retratarLinha } from './retrato.js';

describe('retrato e evento do motor do CRUD genérico (W0-02)', () => {
  it('a linha inteira com o BLOB em base64; linha inexistente: null; tabela inválida recusada', async () => {
    const b = new BancoRoteiro().quando(/SELECT \* FROM TBDOM WHERE ID = \?/, (p) =>
      p[0] === 1
        ? [{ ID: 1, NOME: 'Á', TEXTO: Buffer.from('ção'), QUANDO: new Date(Date.UTC(2026, 0, 1)) }]
        : [],
    );
    const r = await retratarLinha(b.tx(), 'TBDOM', 'ID = ?', [1], '1'.repeat(200));
    expect(r?.chave).toHaveLength(120);
    expect(r?.linha).toEqual({
      ID: 1,
      NOME: 'Á',
      TEXTO: { $b: Buffer.from('ção').toString('base64') },
      QUANDO: { $d: '2026-01-01T00:00:00.000Z' },
    });
    expect(await retratarLinha(b.tx(), 'TBDOM', 'ID = ?', [2], '2')).toBeNull();
    await expect(retratarLinha(b.tx(), 'tb x', 'ID = ?', [1], '1')).rejects.toThrow(/inválida/);
  });

  it('grava o retrato e o evento (só inclusão); nenhuma linha afetada é erro', async () => {
    const b = new BancoRoteiro();
    await gravarRetrato(
      b.tx(),
      { tabela: 'TBDOM', chave: '1', linha: { NOME: 'Ç' } },
      {
        hospital: 'pc',
        operacao: 'x.excluirY',
        motivo: 'm'.repeat(300),
        usuario: 'U',
      },
    );
    const [ins] = b.de(/INSERT INTO SGH_HIST_EXCLUSAO/);
    expect(String(ins?.parametros[4])).toBe('{"NOME":"\\u00c7"}');
    expect(String(ins?.parametros[5])).toHaveLength(200);
    await gravarEventoCrud(b.tx(), {
      hospital: 'pc',
      operacao: 'x.reativarY',
      recurso: 'x.y',
      evento: 'reativado',
      tabela: 'TBDOM',
      chave: '1',
      motivo: 'voltou',
      valorAnterior: null,
      idempotencia: 'k',
      estacao: null,
      usuario: 'U',
    });
    expect(b.de(/INSERT INTO SGH_CRUD_EVENTO/)[0]?.parametros[7]).toBeNull();
    const zero = new BancoRoteiro().quando(/INSERT INTO SGH_/, 0);
    await expect(
      gravarRetrato(
        zero.tx(),
        { tabela: 'T', chave: '1', linha: {} },
        { hospital: 'pc', operacao: 'o', motivo: 'm', usuario: 'u' },
      ),
    ).rejects.toThrow(/retrato não foi gravado/);
    await expect(
      gravarEventoCrud(zero.tx(), {
        hospital: 'pc',
        operacao: 'o',
        recurso: 'r',
        evento: 'excluido',
        tabela: 'T',
        chave: '1',
        motivo: 'm',
        valorAnterior: { a: 1 },
        idempotencia: 'k',
        estacao: 'E',
        usuario: 'u',
      }),
    ).rejects.toThrow(/evento não foi gravado/);
  });
});
