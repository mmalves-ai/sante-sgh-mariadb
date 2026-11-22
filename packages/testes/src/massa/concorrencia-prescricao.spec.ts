// Unidade da concorrência na prescrição e na checagem (sem banco): forma das gravações e das leituras.
import { describe, expect, it } from 'vitest';
import {
  checarEmOutraEstacao,
  horarioPendente,
  marcasContaEstoque,
  rastroDosHorarios,
  semContaNemEstoque,
  suspenderItemEmOutraEstacao,
  suspensaoDaPrescricao,
  suspensaoIncompleta,
  travarHorario,
  travarPrescricao,
} from './concorrencia-prescricao.js';
import { dubleEscritor, SINTAXE_ANTIGA } from './dubles-banco.spec-util.js';

describe('concorrência na prescrição e na checagem', () => {
  it('a outra estação suspende o item e só as doses pendentes, com evento e versão somada', async () => {
    const e = dubleEscritor(() => 1);
    expect(await suspenderItemEmOutraEstacao(e, 5, { profissional: 7, motivo: 'm', usuario: 9 })).toBe(1);
    expect(e.chamadas.map((c) => c.sql)).toEqual([
      expect.stringMatching(
        /UPDATE prescricao_item[\s\S]*suspensao_profissional_id[\s\S]*versao = versao \+ 1[\s\S]*excluido_em IS NULL/,
      ),
      expect.stringMatching(
        /INSERT INTO horario_administracao_evento[\s\S]*'suspensao'[\s\S]*administrado_em IS NULL/,
      ),
      expect.stringMatching(
        /UPDATE horario_administracao[\s\S]*versao = versao \+ 1[\s\S]*administrado_em IS NULL/,
      ),
    ]);
    expect(e.chamadas[0]?.parametros).toEqual([7, 'm', 9, 5]);
    // Item já não ativo: nenhum horário é tocado.
    const f = dubleEscritor(() => 0);
    expect(await suspenderItemEmOutraEstacao(f, 5, { profissional: 7, motivo: 'm' })).toBe(0);
    expect(f.chamadas).toHaveLength(1);
  });

  it('suspensão incompleta deixa o momento nulo (o CHECK do banco recusa)', async () => {
    const e = dubleEscritor(() => 1);
    await suspensaoIncompleta(e, 9);
    expect(e.chamadas[0]?.sql).toMatch(/situacao = 'suspensa', suspensa_em = NULL/);
  });

  it('checagem em outra estação e travas por FOR UPDATE', async () => {
    const e = dubleEscritor((c) => (c.tipo === 'travar' ? [{ id: 1 }] : 1));
    expect(await checarEmOutraEstacao(e, 3, { profissional: 4, situacaoChecagem: 2 })).toBe(1);
    expect(e.chamadas[0]?.parametros).toEqual([2, 4, null, 3]);
    expect(e.chamadas[1]?.sql).toMatch(/INSERT INTO horario_administracao_evento[\s\S]*'checagem'/);
    expect(await travarHorario(e, 3)).toBe(true);
    expect(await travarPrescricao(e, 8)).toBe(true);
    expect(e.chamadas.filter((c) => c.tipo === 'travar')).toHaveLength(2);
  });

  it('leituras filtram estabelecimento e excluídos, e devolvem tipos neutros', async () => {
    const e = dubleEscritor((c) =>
      /FROM prescricao WHERE id/.test(c.sql)
        ? [{ situacao: 'vigente', suspensa_em: null, motivo_suspensao: null }]
        : /MAX\(id\)/.test(c.sql)
          ? [{ m: 10 }]
          : /COUNT/.test(c.sql)
            ? [{ n: 0 }]
            : [],
    );
    expect(await suspensaoDaPrescricao(e, 1)).toEqual({
      situacao: 'vigente',
      suspensaEm: null,
      motivo: null,
    });
    expect(await horarioPendente(e, 2)).toBeNull();
    const antes = await marcasContaEstoque(e, 2, [11, 12]);
    expect(antes).toEqual({ conta: 10, movimento: 10, saldo: '' });
    expect(await semContaNemEstoque(e, 2, antes, [11, 12])).toEqual({
      conta: 0,
      movimento: 0,
      saldoIgual: true,
    });
    expect(await rastroDosHorarios(e, [])).toEqual([0, 0]);
    expect(await rastroDosHorarios(e, [1, 2])).toEqual([0, 0]);
    const pendente = e.chamadas.find((c) => /horario_administracao h/.test(c.sql));
    expect(pendente?.sql).toMatch(/h\.estabelecimento_id = \?[\s\S]*excluido_em IS NULL/);
    for (const c of e.chamadas) expect(c.sql).not.toMatch(SINTAXE_ANTIGA);
  });
});
