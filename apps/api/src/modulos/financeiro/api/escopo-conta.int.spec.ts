// Regra 15 do M32 no MariaDB real (cliente f22_o2, massa sintética "L0207"): o usuário com permissão em uma conta
// bancária só lista essa conta (pode_consultar), só movimenta onde tem pode_movimentar, e o movimento numa conta fora do escopo é recusado ("fora-do-escopo"), nada gravado;
// na conta do escopo, grava. Quem não tem nenhuma linha de permissão vê todas as contas ativas do estabelecimento.
// Só contagens e códigos.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from '../aplicacao/massa-banco.spec-util.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';

describe.skipIf(SEM_BANCO)('escopo de conta bancária (MariaDB, cliente f22_o2)', () => {
  let m: MassaFinanceiro;
  beforeAll(async () => {
    m = await montarMassa();
    // Conta A: consulta e movimenta; conta B: só consulta.
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-07' }, async (e) => {
      for (const [conta, movimenta] of [
        [m.contaA, true],
        [m.contaB, false],
      ] as const)
        await e.inserir(
          `INSERT INTO permissao_conta_bancaria (usuario_id, conta_bancaria_id, estabelecimento_id, pode_consultar,
             pode_movimentar, criado_em) VALUES (?, ?, ?, TRUE, ?, ?)`,
          [m.restrito, conta, m.est, movimenta, new Date()],
        );
    });
  }, 180_000);
  afterAll(async () => {
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('a lista é o escopo do usuário; fora dele, o movimento é recusado; dentro, grava', async () => {
    const porta = new PortaFinanceiroPropria(m.nucleo);
    const c = m.ctx(m.restrito);
    expect((await porta.contas(c, 'l0207.restrito')).map((x) => x.id).sort((a, b) => a - b)).toEqual(
      [m.contaA, m.contaB].sort((a, b) => a - b),
    );
    const todas = (await porta.contas(m.ctx(m.lanca), 'l0207.lanca')).map((x) => x.id);
    expect(todas).toEqual(expect.arrayContaining([m.contaA, m.contaB]));
    expect(todas).not.toContain(m.contaOutroEst);
    const movimento = (conta: number) => ({
      tipo: 'O',
      data: new Date().toISOString().slice(0, 10),
      contaCredito: null,
      contaDebito: conta,
      valor: 1.11,
      historico: 'SINTETICO L0207 escopo',
      classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
    });
    const n = () =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conta-02-07' }, async (l) =>
        Number(
          (
            await l.uma('SELECT COUNT(*) AS n FROM movimento_bancario WHERE estabelecimento_id = ?', [m.est])
          )?.['n'],
        ),
      );
    const exec = (conta: number) =>
      porta.executar(c, 'financeiro.lancarMovimento', movimento(conta), {
        ...c,
        chaveIdempotencia: `t0207-${randomUUID()}`,
      });
    const n0 = await n();
    // A conta B está no escopo de consulta, mas sem pode_movimentar: o movimento é recusado.
    expect(await codigoDaGravacao(exec(m.contaB))).toBe('fora-do-escopo');
    expect(await n()).toBe(n0);
    expect(await codigoDaGravacao(exec(m.contaOutroEst))).toBe('fora-do-escopo');
    expect(await codigoDaGravacao(exec(m.contaA))).toBe('gravou');
    expect(await n()).toBe(n0 + 1);
    console.info(
      `[02-07] escopo de conta: ${todas.length} conta(s) do estabelecimento; 2 no escopo de consulta e 1 no de movimentação do restrito`,
    );
  });
});
