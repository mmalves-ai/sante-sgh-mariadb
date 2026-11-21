// Integração da porta própria da cobrança da operadora contra o MariaDB real (cliente f22_o2). Massa sintética
// "L0209". Contrato de efeito: a fatura e os lançamentos (fatura_plano, fatura_plano_item), a versão, a trilha e o
// outbox; baixa, estorno e cancelamento pela trava otimista; reajuste aplicado e cancelado; e as recusas (conflito de
// versão, cobrança não aberta, outro estabelecimento, operadora de outro estabelecimento). SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaCobrancaOperadoraPropria } from './cobranca-porta-propria.js';
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

const VENCE = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('porta própria da cobrança da operadora (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCobrancaOperadoraPropria;
  let m: MassaOperadora;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't0209' }, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    porta = new PortaCobrancaOperadoraPropria(nucleo, CLIENTE);
  }, 120_000);
  afterAll(async () => {
    if (m) await limparNegocio(nucleo, m);
    await nucleo?.encerrar();
  });

  const nova = (valor = 150.5) =>
    porta.gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'operadora.cobranca.incluida'), (g) =>
      g.incluir({
        operadora: m.operadora,
        contrato: m.contrato,
        beneficiario: null,
        tipo: 3,
        competencia: '2026-10',
        descricao: 'COBRANCA AVULSA SINTETICA',
        valor,
        vencimento: VENCE,
        acordoOrigem: null,
        parcela: null,
        parcelas: null,
        itens: [],
        por: 'l0209.teste',
      }),
    );

  it('lê a operadora do estabelecimento e nenhuma no outro', async () => {
    const ops = await porta.operadoras(contexto(m));
    expect(ops.map((o) => o.id)).toContain(m.operadora);
    expect(ops.find((o) => o.id === m.operadora)).toMatchObject({ registroAns: '902090', situacao: 'ativa' });
    expect((await porta.operadoras(contexto(m, m.outroEst))).map((o) => o.id)).not.toContain(m.operadora);
    expect((await porta.relogio(contexto(m))).hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('inclui a cobrança: fatura, lançamento, número, trilha e outbox; lê a cobrança e os itens', async () => {
    const r = await nova();
    expect(r.versao).toBe(1);
    const [f] = await ler('SELECT * FROM fatura_plano WHERE id = ?', [r.id]);
    expect(f).toMatchObject({ estabelecimento_id: m.est, contrato_plano_id: m.contrato, tipo_fatura: 'avulsa', situacao: 'aberta' });
    expect(String(f!['numero'])).toMatch(/^L0209-\d+$/);
    expect(Number(f!['valor_total'])).toBe(150.5);
    const itens = await ler('SELECT descricao, valor FROM fatura_plano_item WHERE fatura_plano_id = ?', [r.id]);
    expect(itens).toHaveLength(1);
    const trilha = await ler("SELECT acao, dados_depois FROM trilha_auditoria WHERE entidade = 'fatura_plano' AND entidade_id = ?", [r.id]);
    expect(trilha).toHaveLength(1);
    expect(JSON.stringify(trilha[0]!['dados_depois'])).toContain('operadora.cobranca.incluida');
    const saida = await ler("SELECT ponto FROM integracao_mensagem WHERE entidade = 'fatura_plano' AND entidade_id = ?", [r.id]);
    expect(saida.map((s) => s['ponto'])).toContain('operadora.cobranca.gravacao');
    const c = await porta.cobranca(contexto(m), r.id);
    expect(c).toMatchObject({ id: r.id, tipo: 3, competencia: '2026-10', valor: 150.5, situacao: 'aberta', contrato: m.contrato });
    expect(await porta.itens(contexto(m), r.id)).toEqual([
      expect.objectContaining({ descricao: 'COBRANCA AVULSA SINTETICA', valor: 150.5 }),
    ]);
    const lista = await porta.cobrancas(contexto(m), { operadora: m.operadora, situacao: 'aberta' });
    expect(lista.itens.map((x) => x.id)).toContain(r.id);
    expect(await porta.cobranca(contexto(m, m.outroEst), r.id)).toBeNull();
  });

  it('baixa e estorna pela versão; recusa versão velha e baixa de cobrança paga', async () => {
    const r = await nova(80);
    const baixa = await porta.gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'operadora.cobranca.baixada'), (g) =>
      g.baixar({ id: r.id, versao: 1, pagoEm: '2026-10-15', valorPago: 82, multa: 1.6, juros: 0.4, dispensaMotivo: null, por: 'x' }),
    );
    expect(baixa.versao).toBe(2);
    const [f] = await ler('SELECT situacao, valor_pago, valor_acrescimo, versao FROM fatura_plano WHERE id = ?', [r.id]);
    expect(f).toMatchObject({ situacao: 'paga', versao: 2 });
    expect(Number(f!['valor_acrescimo'])).toBe(2);
    const velha = await porta
      .gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'x'), (g) => g.estornar({ id: r.id, versao: 1, motivo: 'teste', por: 'x' }))
      .catch((e: unknown) => codigoDe(e));
    expect(velha).toBe('conflito-versao');
    const repetida = await porta
      .gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'x'), (g) =>
        g.baixar({ id: r.id, versao: 2, pagoEm: '2026-10-15', valorPago: 82, multa: 0, juros: 0, dispensaMotivo: null, por: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(repetida).toBe('cobranca-nao-aberta');
    await porta.gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'x'), (g) => g.estornar({ id: r.id, versao: 2, motivo: 'pago em duplicidade', por: 'x' }));
    expect((await porta.cobranca(contexto(m), r.id))?.situacao).toBe('aberta');
    const t = await porta.totais(contexto(m), m.operadora, '2099-01-01');
    expect(t.vencidas).toBeGreaterThanOrEqual(1);
    const inad = await porta.inadimplentes(contexto(m), { operadora: m.operadora, hoje: '2099-01-01' });
    expect(inad.itens.map((x) => x.contrato)).toContain(m.contrato);
  });

  it('cancela com quem e quando; recusa outro estabelecimento e operadora de fora', async () => {
    const r = await nova(10);
    await porta.gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'x'), (g) => g.cancelar({ id: r.id, versao: 1, motivo: 'lançada por engano', por: 'x' }));
    const [f] = await ler('SELECT situacao, cancelada_em, cancelada_por_usuario_id FROM fatura_plano WHERE id = ?', [r.id]);
    expect(f).toMatchObject({ situacao: 'cancelada', cancelada_por_usuario_id: m.usuario });
    expect(f!['cancelada_em']).not.toBeNull();
    const outro = await porta
      .gravar(contexto(m, m.outroEst), trilhaTela(m, 'fatura_plano', 'x', m.outroEst), (g) =>
        g.cancelar({ id: r.id, versao: 2, motivo: 'x', por: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(outro).toBe('registro-inexistente');
    const fora = await porta
      .gravar(contexto(m, m.outroEst), trilhaTela(m, 'fatura_plano', 'x', m.outroEst), (g) =>
        g.incluir({
          operadora: m.operadora,
          contrato: m.contrato,
          beneficiario: null,
          tipo: 3,
          competencia: '2026-10',
          descricao: 'X',
          valor: 1,
          vencimento: VENCE,
          acordoOrigem: null,
          parcela: null,
          parcelas: null,
          itens: [],
          por: 'x',
        }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(fora).toBe('registro-inexistente');
    expect(await ler('SELECT id FROM fatura_plano WHERE estabelecimento_id = ?', [m.outroEst])).toHaveLength(0);
  });

  it('registra e cancela o reajuste; lê a situação do reajuste do contrato', async () => {
    const r = await porta.gravar(contexto(m), trilhaTela(m, 'reajuste_contrato_plano', 'operadora.reajuste'), (g) =>
      g.registrarReajuste({
        operadora: m.operadora,
        contrato: m.contrato,
        competencia: '2026-05',
        percentual: 6.91,
        tetoAns: 6.91,
        oficioAns: null,
        vidas: 1,
        motivo: 'reajuste anual sintético',
        por: 'x',
      }),
    );
    const lido = await porta.reajuste(contexto(m), r.id);
    expect(lido).toMatchObject({ contrato: m.contrato, competencia: '2026-05', percentual: 6.91, situacao: 'vigente', registradoPor: 'l0209.teste' });
    const sit = await porta.situacaoReajuste(contexto(m), m.contrato);
    expect(sit.vigentes).toContain('2026-05');
    expect(sit.vidas).toBeGreaterThanOrEqual(1);
    const dup = await porta
      .gravar(contexto(m), trilhaTela(m, 'reajuste_contrato_plano', 'x'), (g) =>
        g.registrarReajuste({ operadora: m.operadora, contrato: m.contrato, competencia: '2026-05', percentual: 1, tetoAns: null, oficioAns: null, vidas: 1, motivo: 'x', por: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(dup).toBe('reajuste-duplicado');
    await porta.gravar(contexto(m), trilhaTela(m, 'reajuste_contrato_plano', 'x'), (g) => g.cancelarReajuste({ id: r.id, motivo: 'índice errado', por: 'x' }));
    expect((await porta.reajuste(contexto(m), r.id))?.situacao).toBe('cancelado');
  });

  it('o que o modelo ainda não tem responde 501 modelo-pendente', async () => {
    const e = await porta.renegociadas(contexto(m), 1).catch((x: unknown) => codigoDe(x));
    expect(e).toBe('modelo-pendente');
  });
});
