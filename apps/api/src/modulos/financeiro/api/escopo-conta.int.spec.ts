// Regra 15 do M32 sobre a cópia (transação desfeita): a conta bancária só aparece e só grava se estiver no escopo do
// usuário (MFCTAUSU, que vale nos dois sistemas, com o REST_CTA_USU da empresa ligado): a lista das contas do usuário é
// exatamente o conjunto do escopo e o movimento numa conta fora dele é recusado ("fora do escopo"), nada gravado; na
// conta do escopo, grava. Só contagens e códigos.
import { ErroOperacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import { portaFinanceiroNaTransacao } from '../porta-legado.js';

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).name}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('escopo de conta bancária (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  // A conferência do schema leva minutos na cópia com a VM carregada: o gancho tem prazo próprio.
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('a lista é o escopo do usuário; fora dele, o movimento é recusado; dentro, grava', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m32-escopo' }, async (e) => {
      const [p] = await e.consultar('SELECT REST_CTA_USU FROM MFPARAM WHERE EMPRESA = 1', [], { teto: 1 });
      const restrito = String(p?.['REST_CTA_USU'] ?? '').trim() === 'T';
      // Um usuário ativo com escopo de poucas contas (só em memória).
      const [u] = await e.consultar(
        `SELECT FIRST 1 u.NOME, COUNT(*) N FROM MFCTAUSU m JOIN TBUSERS u ON u.ID_TBUSERS = m.ID_TBUSERS
          JOIN TBCTABAN t ON t.ID_CTABAN = m.ID_TBCTABAN AND t.EMPRESA = 1 AND COALESCE(t.SITUACAO, 'A') = 'A'
          WHERE u.STATUS = 'T' AND u.BLOQUEADO = 'F' GROUP BY u.NOME HAVING COUNT(*) BETWEEN 1 AND 20 ORDER BY 2`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      const login = String(u?.['NOME'] ?? '').trim();
      const esperadas = (
        await e.consultar(
          `SELECT t.ID FROM TBCTABAN t WHERE t.EMPRESA = 1 AND t.ID_CTABAN IN
             (SELECT m.ID_TBCTABAN FROM MFCTAUSU m JOIN TBUSERS x ON x.ID_TBUSERS = m.ID_TBUSERS WHERE x.NOME = ?)`,
          [login],
          { teto: 600 },
        )
      )
        .map((x) => Number(x['ID']))
        .sort((x, y) => x - y);
      const porta = portaFinanceiroNaTransacao(e, a.executor);
      const lidas = (await porta.contas(a.c, login)).map((c) => c.id).sort((x, y) => x - y);
      const [fora] = await e.consultar(
        `SELECT FIRST 1 t.ID FROM TBCTABAN t WHERE t.EMPRESA = 1 AND COALESCE(t.SITUACAO, 'A') = 'A' AND t.ID_CTABAN NOT IN
           (SELECT m.ID_TBCTABAN FROM MFCTAUSU m JOIN TBUSERS x ON x.ID_TBUSERS = m.ID_TBUSERS WHERE x.NOME = ?)`,
        [login],
        { teto: 1 },
      );
      const [k] = await e.consultar(
        'SELECT FIRST 1 GRUPO, SUBGRUPO, ITEM FROM TBITEDES WHERE GRUPO > 0 ORDER BY ID DESC',
        [],
        {
          teto: 1,
        },
      );
      const [h] = await e.consultar('SELECT CURRENT_DATE H FROM RDB$DATABASE', [], { teto: 1 });
      const hoje = (h?.['H'] instanceof Date ? h['H'].toISOString() : String(h?.['H'])).slice(0, 10);
      const movimento = (conta: number) => ({
        tipo: 'O',
        data: hoje,
        contaCredito: null,
        contaDebito: conta,
        valor: 1.11,
        historico: 'SINTETICO M32 escopo',
        classificacao: {
          grupo: Number(k?.['GRUPO']),
          subgrupo: Number(k?.['SUBGRUPO']),
          item: Number(k?.['ITEM']),
        },
      });
      const octx = (n: number) => ({
        ...a.c,
        traceId: 'int-m32-escopo',
        usuarioLegado: login,
        idempotencyKey: `int-m32-escopo-${Date.now().toString(36)}-${n}`,
        reautenticadoEm: Date.now(),
      });
      const [n0] = await e.consultar('SELECT COUNT(*) N FROM MFLANCTO', [], { teto: 1 });
      const foraDoEscopo = fora
        ? await codigo(
            porta.executar(a.c, 'financeiro.lancarMovimento', movimento(Number(fora['ID'])), octx(1)),
          )
        : 'sem-conta-fora';
      const [n1] = await e.consultar('SELECT COUNT(*) N FROM MFLANCTO', [], { teto: 1 });
      const dentro = await codigo(
        porta.executar(a.c, 'financeiro.lancarMovimento', movimento(esperadas[0]!), octx(2)),
      );
      return {
        restrito,
        listaIgual: JSON.stringify(lidas) === JSON.stringify(esperadas),
        escopo: esperadas.length,
        foraDoEscopo,
        nadaGravadoFora: Number(n1?.['N']) === Number(n0?.['N']),
        dentro,
      };
    });
    console.info(
      `[m32] escopo de conta: ${r.escopo} conta(s) no escopo do usuário; REST_CTA_USU ${r.restrito ? 'T' : 'F'}`,
    );
    expect(r.restrito).toBe(true);
    expect(r.listaIgual).toBe(true);
    expect(r.foraDoEscopo).toBe('fora-do-escopo');
    expect(r.nadaGravadoFora).toBe(true);
    expect(r.dentro).toBe('gravou');
  }, 600_000);
});
