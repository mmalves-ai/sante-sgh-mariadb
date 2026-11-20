// Regra 10 do M32 sobre a cópia (transação desfeita): as contas apresentadas sem título de uma competência do convênio
// ganham o título a receber pelo fechamento (um título por tipo de conta, como o outro sistema agrupa), pela receita
// financeiro.criarTituloReceber no executor; depois, a competência não tem mais conta sem título, cada conta aponta para
// o título do seu grupo e o valor do título é a soma das contas (com as parcelas impressas no teste). A leitura das contas
// sem título é medida (vai ao log). Só contagens, IDs e valores agregados.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AmbienteM27,
  ambienteM27,
  PODE_ESCREVER,
  usuariosAtivos,
} from '../../acesso/aplicacao/copia.spec-util.js';
import { portaFinanceiroNaTransacao } from '../porta-legado.js';
import { entradasDaCompetencia } from '../servico.js';

/** Competência de convênio (não particular) com 2 a 12 contas apresentadas sem título do mesmo tipo. */
const SQL_COMPETENCIA = `SELECT FIRST 1 c.CON, c.ANOPRO, c.MESPRO, COUNT(*) N FROM FCCTAEXT c WHERE c.FECHADA = 'A' AND c.ANOPRO >= 2026
   AND COALESCE(c.ID_MFCTAREC, 0) = 0 AND c.TOTAL_CONTA > 0 AND c.CON <> 10
   AND EXISTS (SELECT 1 FROM MFCTAREC m WHERE m.DEV = 'C' AND m.COD = c.CON)
 GROUP BY c.CON, c.ANOPRO, c.MESPRO HAVING COUNT(*) BETWEEN 2 AND 12 ORDER BY c.ANOPRO DESC, c.MESPRO DESC`;

describe.skipIf(!PODE_ESCREVER)('títulos da competência (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  // A conferência do schema leva minutos na cópia com a VM carregada: o gancho tem prazo próprio.
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('cada conta apresentada sem título ganha o título do seu grupo; a competência fica sem conta sem título', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m32-competencia' }, async (e) => {
      const [k] = await e.consultar(SQL_COMPETENCIA, [], { teto: 1, tempoMaximoMs: 120_000 });
      expect(k).toBeDefined();
      const convenio = Number(k?.['CON']);
      const ano = Number(k?.['ANOPRO']);
      const mes = Number(k?.['MESPRO']);
      const u = await usuariosAtivos(e);
      const porta = portaFinanceiroNaTransacao(e, a.executor);
      const t0 = performance.now();
      const contas = await porta.contasSemTitulo(a.c, { convenio, ano, mes });
      const leitura = Math.round(performance.now() - t0);
      // O vencimento vai de 0 a 90 dias da apresentação: 30 dias depois da apresentação mais recente das contas.
      const apres =
        contas
          .map((c) => c.apresentacao ?? '')
          .sort()
          .at(-1) ?? '';
      const venc = new Date(`${apres}T12:00:00Z`);
      venc.setUTCDate(venc.getUTCDate() + 30);
      const hoje = venc.toISOString().slice(0, 10);
      // Número de fatura sintético na faixa alta (nunca usada pelo outro sistema).
      const fatura = 1_900_000_000 + (Date.now() % 99_999_000);
      const entradas = entradasDaCompetencia(contas, { ano, mes, vencimento: hoje, documento: fatura });
      const titulos: number[] = [];
      for (const [i, entrada] of entradas.entries()) {
        const g = await porta.executar(a.c, 'financeiro.criarTituloReceber', entrada, {
          ...a.c,
          traceId: 'int-m32-competencia',
          usuarioLegado: u.a,
          idempotencyKey: `int-m32-comp-${Date.now().toString(36)}-${i}`,
          reautenticadoEm: Date.now(),
        });
        titulos.push(Number(g.resultado['titulo']));
      }
      const depois = await porta.contasSemTitulo(a.c, { convenio, ano, mes });
      // Cada conta do grupo aponta para o título do grupo; o valor do título é a soma das contas.
      const conferencia: { contas: number; ligadas: number; valor: number; soma: number }[] = [];
      for (const [i, entrada] of entradas.entries()) {
        const [t] = await e.consultar(
          'SELECT ID_MFCTAREC, VALOR, DEV, COD FROM MFCTAREC WHERE ID = ?',
          [titulos[i]],
          {
            teto: 1,
          },
        );
        expect(String(t?.['DEV']).trim()).toBe('C');
        expect(Number(t?.['COD'])).toBe(convenio);
        const ids = entrada.contas.map((c) => c.conta);
        const ls = await e.consultar(
          `SELECT ID, ID_MFCTAREC, TOTAL_CONTA FROM FCCTAEXT WHERE ID IN (${ids.map(() => '?').join(', ')})`,
          ids,
          { teto: ids.length },
        );
        const parcelas = ls.map((l) => Number(l['TOTAL_CONTA']));
        conferencia.push({
          contas: ids.length,
          ligadas: ls.filter((l) => Number(l['ID_MFCTAREC']) === Number(t?.['ID_MFCTAREC'])).length,
          valor: Math.round(Number(t?.['VALOR']) * 100),
          soma: Math.round(parcelas.reduce((s, v) => s + v, 0) * 100),
        });
      }
      return { antes: contas.length, depois: depois.length, conferencia, leitura, grupos: entradas.length };
    });
    console.info(
      `[m32] títulos da competência: ${r.antes} conta(s) em ${r.grupos} título(s); leitura das contas sem título ${r.leitura} ms`,
    );
    expect(r.antes).toBeGreaterThanOrEqual(2);
    expect(r.depois).toBe(0);
    for (const c of r.conferencia) {
      expect(c.ligadas).toBe(c.contas);
      expect(c.valor).toBe(c.soma);
    }
  }, 600_000);
});
