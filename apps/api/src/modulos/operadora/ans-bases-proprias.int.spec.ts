// Integração das bases das obrigações da ANS no banco próprio (cliente f22_o2, massa sintética "L0209"): pendências do
// SIB, beneficiários do aviso de ressarcimento, SIP, DIOPS (contraprestações) e monitoramento, montados pelas portas
// próprias irmãs com a regra da porta de memória; o estabelecimento da sessão filtra; sem as portas irmãs, 501.
// Só leitura: não grava nada. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAnsOperadoraPropria } from './ans-porta-propria.js';
import { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
import { PortaCobrancaOperadoraPropria } from './cobranca-porta-propria.js';
import { PortaContasOperadoraPropria } from './contas-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
} from './infra/massa-operadora.spec-util.js';
import { PortaOperadoraPropria } from './porta-propria.js';
import { PortaRedeOperadoraPropria } from './rede-porta-propria.js';

describe.skipIf(SEM_BANCO)('bases das obrigações da ANS no banco próprio (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAnsOperadoraPropria;
  let sem: PortaAnsOperadoraPropria;
  let m: MassaOperadora;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    const operadora = new PortaOperadoraPropria(nucleo, CLIENTE);
    const rede = new PortaRedeOperadoraPropria(nucleo, CLIENTE);
    const autorizacao = new PortaAutorizacaoOperadoraPropria(nucleo, CLIENTE, operadora, rede);
    const contas = new PortaContasOperadoraPropria(nucleo, CLIENTE, operadora, rede, {
      designacoes: (c, login) => autorizacao.designacoes(c, login),
      autorizacoesPorSenha: async () => [],
    });
    const cobranca = new PortaCobrancaOperadoraPropria(nucleo, CLIENTE);
    porta = new PortaAnsOperadoraPropria(nucleo, CLIENTE, operadora, 'simulador', {
      operadora,
      cobranca,
      contas,
    });
    sem = new PortaAnsOperadoraPropria(nucleo, CLIENTE, operadora, 'simulador');
  }, 120_000);
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('pendências do SIB: o beneficiário da operadora com produto, contrato, titular e complemento do banco', async () => {
    const r = await porta.beneficiariosSib(contexto(m), m.operadora, 0);
    const b = r.itens.find((x) => x.id === m.beneficiario);
    expect(b).toMatchObject({ operadora: m.operadora, carteirinha: 'L02090001', titular: null });
    expect(b?.produto.id).toBe(m.produto);
    expect(b?.contrato.id).toBe(m.contrato);
    // O complemento é o mesmo da leitura própria do complemento do SIB.
    expect(b?.complemento).toEqual(await porta.complementoSib(contexto(m), m.beneficiario));
    const d = r.itens.find((x) => x.id === m.dependente);
    if (d?.titular) expect(d.titular.id).toBe(m.beneficiario);
    // Paginação pelo id (a partir do último visto) e o estabelecimento da sessão.
    expect(
      (await porta.beneficiariosSib(contexto(m), m.operadora, m.beneficiario)).itens.map((x) => x.id),
    ).not.toContain(m.beneficiario);
    expect((await porta.beneficiariosSib(contexto(m, m.outroEst), m.operadora, 0)).itens).toEqual([]);
  });

  it('beneficiários do aviso de ressarcimento: pela carteirinha, com contrato, produto e cobertura parcial', async () => {
    const r = await porta.beneficiariosRessarcimento(contexto(m), m.operadora, [
      'L02090001',
      'L0209-NAO-EXISTE',
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ identificacao: 'L02090001', id: m.beneficiario, carteirinha: 'L02090001' });
    expect(typeof r[0]?.coberturaParcial).toBe('boolean');
    expect(JSON.parse(r[0]?.produto.carencias ?? '')).toBeTypeOf('object');
    expect(
      await porta.beneficiariosRessarcimento(contexto(m, m.outroEst), m.operadora, ['L02090001']),
    ).toEqual([]);
  });

  it('SIP, DIOPS e monitoramento: leem pelas portas irmãs e respeitam o período', async () => {
    expect(await porta.vigenciasSip(contexto(m), [])).toEqual([]);
    expect(await porta.itensSip(contexto(m), m.operadora, '1990-01-01', '1990-01-31', 0)).toEqual({
      itens: [],
      proxima: null,
    });
    const sip = await porta.itensSip(contexto(m), m.operadora, '2000-01-01', '2099-12-31', 0);
    expect(sip.proxima).toBeNull();
    for (let i = 1; i < sip.itens.length; i++) expect(sip.itens[i]!.id).toBeGreaterThan(sip.itens[i - 1]!.id);
    expect(await porta.guiasMonitoramento(contexto(m), m.operadora, '1990-01-01', '1990-01-31', 100)).toEqual(
      [],
    );
    const mon = await porta.guiasMonitoramento(contexto(m), m.operadora, '2000-01-01', '2099-12-31', 100);
    for (const g of mon) expect(Array.isArray(g.itens)).toBe(true);
    const diops = await porta.cobrancasDiops(
      contexto(m),
      m.operadora,
      ['2026-09'],
      '2026-07-01',
      '2026-09-30',
    );
    for (const x of diops) expect(['aberta', 'paga', 'cancelada', 'renegociada']).toContain(x.situacao);
    expect(
      await porta.cobrancasDiops(
        contexto(m, m.outroEst),
        m.operadora,
        ['2026-09'],
        '2026-07-01',
        '2026-09-30',
      ),
    ).toEqual([]);
  });

  it('sem as portas irmãs (montagem parcial): 501 modelo-pendente, nunca base vazia', async () => {
    const c = contexto(m);
    const chamadas: (() => Promise<unknown>)[] = [
      () => sem.beneficiariosSib(c, m.operadora, 0),
      () => sem.itensSip(c, m.operadora, '2026-01-01', '2026-01-31', 0),
      () => sem.vigenciasSip(c, [1]),
      () => sem.cobrancasDiops(c, m.operadora, ['2026-01'], '2026-01-01', '2026-01-31'),
      () => sem.guiasMonitoramento(c, m.operadora, '2026-01-01', '2026-01-31', 10),
      () => sem.beneficiariosRessarcimento(c, m.operadora, ['x']),
    ];
    for (const f of chamadas)
      expect(
        await Promise.resolve()
          .then(f)
          .catch((e: unknown) => codigoDe(e)),
      ).toBe('modelo-pendente');
  });
});
