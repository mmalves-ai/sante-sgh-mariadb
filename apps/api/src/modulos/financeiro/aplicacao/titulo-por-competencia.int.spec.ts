// Regra 10 do M32 no MariaDB real (cliente f22_o2, massa sintética "L0207"): as contas hospitalares fechadas sem
// título de uma competência do convênio ganham o título a receber (um título por tipo de conta), pela operação
// financeiro.criarTituloReceber no executor; depois, a competência não tem mais conta sem título, cada conta está
// ligada ao título do seu grupo pelo vínculo de origem e o valor do título é a soma das contas (parcelas impressas
// no teste). A conta já titulada é recusada. Só contagens, ids e valores agregados.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import { entradasDaCompetencia } from '../servico.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

describe.skipIf(SEM_BANCO)('títulos da competência (MariaDB, cliente f22_o2)', () => {
  let m: MassaFinanceiro;
  beforeAll(async () => {
    m = await montarMassa();
  }, 180_000);
  afterAll(async () => {
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('cada conta sem título ganha o título do seu grupo; a competência fica sem conta sem título', async () => {
    const porta = new PortaFinanceiroPropria(m.nucleo);
    const c = m.ctx(m.lanca);
    const filtro = { convenio: m.convenio, ano: 2026, mes: 10 };
    const contas = await porta.contasSemTitulo(c, filtro);
    expect(contas.map((x) => x.id).sort((a, b) => a - b)).toEqual([...m.contasHospitalares].sort((a, b) => a - b));
    expect(await porta.contasSemTitulo(m.ctx(m.lanca, m.outroEst), filtro)).toEqual([]);
    const entradas = entradasDaCompetencia(contas, { ano: 2026, mes: 10, vencimento: '2026-12-15', documento: 90_207 });
    expect(entradas).toHaveLength(2);
    const ids: number[] = [];
    for (const e of entradas) {
      const r = await porta.executar(c, 'financeiro.criarTituloReceber', e, { ...c, chaveIdempotencia: `t0207-${randomUUID()}` });
      ids.push(Number(r.resultado['titulo']));
    }
    expect(await porta.contasSemTitulo(c, filtro)).toEqual([]);
    const valores = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conta-02-07' }, (l) =>
      l.consultar(
        `SELECT t.id, t.valor_bruto, (SELECT COUNT(*) FROM documento_origem_titulo d WHERE d.titulo_receber_id = t.id) AS contas,
                (SELECT SUM(p.valor) FROM parcela_receber p WHERE p.titulo_receber_id = t.id) AS parcelas
           FROM titulo_receber t WHERE t.id IN (?, ?) ORDER BY t.id`,
        ids,
      ),
    );
    // Externas: 100,10 + 200,20 = 300,30 (2 contas); internação: 1.000,55 (1 conta).
    expect(valores.map((v) => [Number(v['valor_bruto']), Number(v['contas']), Number(v['parcelas'])])).toEqual([
      [300.3, 2, 300.3],
      [1000.55, 1, 1000.55],
    ]);
    const det = await porta.tituloReceber(c, ids[0]!, '2026-11-01');
    expect(det?.contasLigadas.map((x) => x.competencia)).toEqual(['2026-10', '2026-10']);
    expect(
      await codigoDaGravacao(
        porta.executar(
          c,
          'financeiro.criarTituloReceber',
          { contas: [{ conta: m.contasHospitalares[0]!, versao: null }], vencimento: '2026-12-15', documento: 1, referente: '' },
          { ...c, chaveIdempotencia: `t0207-${randomUUID()}` },
        ),
      ),
    ).toBe('conta-titulada');
    console.info(`[02-07] competência: ${contas.length} conta(s) sem título viraram ${ids.length} título(s)`);
  });
});
