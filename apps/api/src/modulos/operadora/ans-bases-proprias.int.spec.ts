// Integração das bases das obrigações da ANS no banco próprio (cliente f22_o2, massa sintética "L0209"): pendências do
// SIB, beneficiários do aviso de ressarcimento, SIP, DIOPS (contraprestações) e monitoramento, montados pelas portas
// próprias irmãs com a regra da porta de memória; o estabelecimento da sessão filtra; sem as portas irmãs, 501.
// A massa de negócio (uma conta médica analisada com guia e item, uma cobrança da competência) é gravada pelas portas
// irmãs e apagada por `limparNegocio`. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
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
  limparNegocio,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';
import { PortaOperadoraPropria } from './porta-propria.js';
import { PortaRedeOperadoraPropria } from './rede-porta-propria.js';

describe.skipIf(SEM_BANCO)('bases das obrigações da ANS no banco próprio (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAnsOperadoraPropria;
  let sem: PortaAnsOperadoraPropria;
  let m: MassaOperadora;
  let operadora: PortaOperadoraPropria;
  let contas: PortaContasOperadoraPropria;
  let cobranca: PortaCobrancaOperadoraPropria;
  /** A conta médica analisada (lote, guia e item) e a cobrança da competência 2026-10 gravadas pelo teste. */
  const neg = { conta: 0, guia: 0, item: 0, cobranca: 0, grupoSip: 0 };
  const limparSip = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-09-sip' }, async (e) => {
      await e.executar(
        "DELETE cr FROM item_assistencial_ans_criterio cr JOIN item_assistencial_ans i ON i.id = cr.item_assistencial_ans_id WHERE i.codigo LIKE 'L0209-SIP%'",
      );
      await e.executar("DELETE FROM item_assistencial_ans WHERE codigo LIKE 'L0209-SIP%'");
    });
  const vence = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    await limparSip();
    // Um grupo do SIP sintético com o procedimento da massa (90209001), vigente a partir de 2024-01-01.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-09-sip' }, async (e) => {
      const grupo = await e.inserir(
        "INSERT INTO item_assistencial_ans (codigo, descricao, ordem, vigencia_inicio, vigencia_fim, criado_em) VALUES ('L0209-SIP1', 'GRUPO SIP SINTETICO', 1, '2024-01-01', NULL, NOW(3))",
        [],
      );
      neg.grupoSip = grupo;
      await e.executar(
        "INSERT INTO item_assistencial_ans_criterio (item_assistencial_ans_id, sequencia, tipo_criterio, procedimento_termo_terminologia_id, criado_em) VALUES (?, 1, 'procedimento', ?, NOW(3))",
        [grupo, m.termo],
      );
    });
    operadora = new PortaOperadoraPropria(nucleo, CLIENTE);
    const rede = new PortaRedeOperadoraPropria(nucleo, CLIENTE);
    const autorizacao = new PortaAutorizacaoOperadoraPropria(nucleo, CLIENTE, operadora, rede);
    contas = new PortaContasOperadoraPropria(nucleo, CLIENTE, operadora, rede, {
      designacoes: (c, login) => autorizacao.designacoes(c, login),
      autorizacoesPorSenha: async () => [],
    });
    cobranca = new PortaCobrancaOperadoraPropria(nucleo, CLIENTE);
    porta = new PortaAnsOperadoraPropria(nucleo, CLIENTE, operadora, 'simulador', {
      operadora,
      cobranca,
      contas,
    });
    sem = new PortaAnsOperadoraPropria(nucleo, CLIENTE, operadora, 'simulador');
    const T = (ev: string) => trilhaTela(m, 'lote_conta_recebida', ev);
    const lote = await contas.gravar(contexto(m), T('operadora.contas.recebida'), async (g) =>
      g.receber({
        operadora: m.operadora,
        prestador: m.prestador,
        protocolo: `L0209-B${await g.proximoProtocolo()}`,
        numeroLote: '980001',
        tipoGuia: 'sp-sadt',
        competencia: '2026-10',
        prazoPagamento: vence,
        arquivo: { nome: 'lote.xml', bytes: 10, sha256: 'hb980001', base64: '', hashEpilogo: 'eb980001' },
        apresentado: 200,
        guias: [
          {
            ordem: 1,
            numeroGuiaPrestador: 'GB980001',
            numeroGuiaOperadora: null,
            senha: null,
            carteirinha: 'L02090001',
            beneficiario: m.beneficiario,
            autorizacao: null,
            carater: '1',
            inicio: '2026-10-05',
            fim: '2026-10-05',
            criticas: [],
            apresentado: 200,
            itens: [
              {
                ordem: 1,
                sequencial: 1,
                grupo: 'procedimento',
                codigoDespesa: null,
                tabela: '22',
                codigo: '90209001',
                descricao: 'PROCEDIMENTO SINTETICO',
                data: '2026-10-05',
                quantidade: 1,
                fator: 1,
                valorUnitario: 200,
                apresentado: 200,
                glosado: 0,
                motivo: null,
                justificativa: null,
                critica: null,
              },
            ],
          },
        ],
        texto: 'recebida',
        usuario: 'x',
      }),
    );
    await contas.gravar(contexto(m), T('operadora.contas.analisada'), (g) =>
      g.concluir({
        id: lote.id,
        versao: lote.versao,
        usuario: 'x',
        auditor: 1,
        situacao: 'analisada',
        observacao: null,
        texto: 'x',
      }),
    );
    neg.conta = lote.id;
    neg.guia = (await contas.guias(contexto(m), lote.id))[0]!.id;
    neg.item = (await contas.itens(contexto(m), lote.id))[0]!.id;
    neg.cobranca = (
      await cobranca.gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'operadora.cobranca.incluida'), (g) =>
        g.incluir({
          operadora: m.operadora,
          contrato: m.contrato,
          beneficiario: null,
          tipo: 3,
          competencia: '2026-10',
          descricao: 'COBRANCA SINTETICA DIOPS',
          valor: 150.5,
          vencimento: vence,
          acordoOrigem: null,
          parcela: null,
          parcelas: null,
          itens: [],
          por: 'l0209.teste',
        }),
      )
    ).id;
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limparNegocio(nucleo, m);
      await limparSip();
    }
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
    // O dependente leva o titular (id, carteirinha e CCO do complemento do titular).
    const d = r.itens.find((x) => x.id === m.dependente);
    expect(d?.titular).toEqual({
      id: m.beneficiario,
      carteirinha: 'L02090001',
      cco: (await porta.complementoSib(contexto(m), m.beneficiario))?.cco ?? null,
    });
    // Página que começa depois do titular: o titular continua identificado (lido pelo id, fora da página).
    const depois = await porta.beneficiariosSib(contexto(m), m.operadora, m.beneficiario);
    if (m.dependente > m.beneficiario)
      expect(depois.itens.find((x) => x.id === m.dependente)?.titular).toMatchObject({
        id: m.beneficiario,
        carteirinha: 'L02090001',
      });
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

  it('SIP: o item da conta analisada no período, com segmentação e município; vazio fora do período e no outro estabelecimento', async () => {
    const c = contexto(m);
    const produto = await operadora.produto(c, m.produto);
    const municipio = (await porta.complementoSib(c, m.beneficiario))?.municipio ?? null;
    const sip = await porta.itensSip(c, m.operadora, '2026-10-01', '2026-10-31', 0);
    expect(sip.proxima).toBeNull();
    expect(sip.itens.find((i) => i.id === neg.item)).toEqual({
      id: neg.item,
      beneficiario: m.beneficiario,
      segmentacao: produto?.segmentacao ?? null,
      municipio,
      dataExecucao: '2026-10-05',
      tabela: '22',
      codigo: '90209001',
      quantidade: 1,
      apresentado: 200,
      glosado: 0,
    });
    for (let i = 1; i < sip.itens.length; i++) expect(sip.itens[i]!.id).toBeGreaterThan(sip.itens[i - 1]!.id);
    // Paginação pelo id do item, período e estabelecimento.
    expect(
      (await porta.itensSip(c, m.operadora, '2026-10-01', '2026-10-31', neg.item)).itens.map((i) => i.id),
    ).not.toContain(neg.item);
    expect(await porta.itensSip(c, m.operadora, '2026-11-01', '2026-11-30', 0)).toEqual({
      itens: [],
      proxima: null,
    });
    expect(await porta.itensSip(contexto(m, m.outroEst), m.operadora, '2026-10-01', '2026-10-31', 0)).toEqual(
      {
        itens: [],
        proxima: null,
      },
    );
  });

  it('vigências do SIP: o procedimento do catálogo com o grupo e a vigência; vazio sem procedimento', async () => {
    const c = contexto(m);
    expect(await porta.vigenciasSip(c, [])).toEqual([]);
    const v = await porta.vigenciasSip(c, [90209001, 90209001]);
    expect(v).toEqual([{ procedimento: 90209001, grupo: neg.grupoSip, inicio: '2024-01-01', fim: null }]);
    expect(await porta.vigenciasSip(c, [90209999])).toEqual([]);
  });

  it('DIOPS: a cobrança da competência com situação e valores; vazio no outro estabelecimento', async () => {
    const c = contexto(m);
    const diops = await porta.cobrancasDiops(c, m.operadora, ['2026-10'], '2026-10-01', '2026-10-31');
    expect(diops).toContainEqual(
      expect.objectContaining({ competencia: '2026-10', valor: 150.5, situacao: 'aberta', pagoEm: null }),
    );
    expect(
      await porta.cobrancasDiops(
        contexto(m, m.outroEst),
        m.operadora,
        ['2026-10'],
        '2026-10-01',
        '2026-10-31',
      ),
    ).toEqual([]);
    // Fora da competência, sem pagamento no período e vencendo depois do fim: não entra.
    expect(await porta.cobrancasDiops(c, m.operadora, ['2025-01'], '2025-01-01', '2025-01-31')).toEqual([]);
  });

  it('monitoramento: a guia da conta analisada no período, com beneficiário, município, CCO e itens', async () => {
    const c = contexto(m);
    const hoje = (await cobranca.relogio(c)).hoje;
    const comp = await porta.complementoSib(c, m.beneficiario);
    const ficha = await contas.conta(c, neg.conta);
    const mon = await porta.guiasMonitoramento(c, m.operadora, hoje, hoje, 100);
    const g = mon.find((x) => x.id === neg.guia);
    expect(g).toMatchObject({
      protocolo: ficha?.protocolo,
      prestadorDocumento: ficha?.prestadorDocumento,
      numeroGuiaPrestador: 'GB980001',
      carater: '1',
      inicio: '2026-10-05',
      carteirinhaApresentada: 'L02090001',
      beneficiario: {
        id: m.beneficiario,
        carteirinha: 'L02090001',
        municipio: comp?.municipio ?? null,
        cco: comp?.cco ?? null,
      },
      itens: [{ tabela: '22', codigo: '90209001', quantidade: 1, informado: 200, glosado: 0 }],
    });
    // A análise é de hoje: fora do período ou no outro estabelecimento não há guia.
    expect(await porta.guiasMonitoramento(c, m.operadora, '1990-01-01', '1990-01-31', 100)).toEqual([]);
    expect(await porta.guiasMonitoramento(contexto(m, m.outroEst), m.operadora, hoje, hoje, 100)).toEqual([]);
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
