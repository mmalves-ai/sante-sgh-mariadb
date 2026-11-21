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
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await prepararMassa(nucleo);
    await limparInadimplencia();
    await limparNegocio(nucleo, m);
    porta = new PortaCobrancaOperadoraPropria(nucleo, CLIENTE);
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limparInadimplencia();
      await limparNegocio(nucleo, m);
    }
    await nucleo?.encerrar();
  });

  /** Acordos e notificações da massa (antes das faturas, por causa das chaves). */
  const limparInadimplencia = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-acordo' }, async (e) => {
      const est = [m.est, m.outroEst];
      await e.executar(
        'DELETE n FROM notificacao_inadimplencia n JOIN ocorrencia_inadimplencia o ON o.id = n.ocorrencia_inadimplencia_id WHERE o.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM ocorrencia_inadimplencia WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'DELETE af FROM acordo_inadimplencia_fatura af JOIN acordo_inadimplencia a ON a.id = af.acordo_inadimplencia_id WHERE a.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar(
        'UPDATE fatura_plano SET acordo_inadimplencia_id = NULL WHERE estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM acordo_inadimplencia WHERE estabelecimento_id IN (?, ?)', est);
    });
  /** Torna a cobrança vencida há `dias` dias (a emissão vem junto, pelo CHECK do vencimento). */
  const vencer = (id: number, dias: number) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'vencer-teste' }, (e) =>
      e.executar(
        'UPDATE fatura_plano SET data_emissao = CURRENT_DATE - INTERVAL ? DAY, data_vencimento = CURRENT_DATE - INTERVAL ? DAY, data_vencimento_original = CURRENT_DATE - INTERVAL ? DAY WHERE id = ?',
        [dias + 5, dias, dias, id],
      ),
    );

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
    expect(f).toMatchObject({
      estabelecimento_id: m.est,
      contrato_plano_id: m.contrato,
      tipo_fatura: 'avulsa',
      situacao: 'aberta',
    });
    expect(String(f!['numero'])).toMatch(/^L0209-\d+$/);
    expect(Number(f!['valor_total'])).toBe(150.5);
    const itens = await ler('SELECT descricao, valor FROM fatura_plano_item WHERE fatura_plano_id = ?', [
      r.id,
    ]);
    expect(itens).toHaveLength(1);
    const trilha = await ler(
      "SELECT acao, dados_depois FROM trilha_auditoria WHERE entidade = 'fatura_plano' AND entidade_id = ?",
      [r.id],
    );
    expect(trilha).toHaveLength(1);
    expect(JSON.stringify(trilha[0]!['dados_depois'])).toContain('operadora.cobranca.incluida');
    const saida = await ler(
      "SELECT ponto FROM integracao_mensagem WHERE entidade = 'fatura_plano' AND entidade_id = ?",
      [r.id],
    );
    expect(saida.map((s) => s['ponto'])).toContain('operadora.cobranca.gravacao');
    const c = await porta.cobranca(contexto(m), r.id);
    expect(c).toMatchObject({
      id: r.id,
      tipo: 3,
      competencia: '2026-10',
      valor: 150.5,
      situacao: 'aberta',
      contrato: m.contrato,
    });
    expect(await porta.itens(contexto(m), r.id)).toEqual([
      expect.objectContaining({ descricao: 'COBRANCA AVULSA SINTETICA', valor: 150.5 }),
    ]);
    const lista = await porta.cobrancas(contexto(m), { operadora: m.operadora, situacao: 'aberta' });
    expect(lista.itens.map((x) => x.id)).toContain(r.id);
    expect(await porta.cobranca(contexto(m, m.outroEst), r.id)).toBeNull();
  });

  it('baixa e estorna pela versão; recusa versão velha e baixa de cobrança paga', async () => {
    const r = await nova(80);
    const baixa = await porta.gravar(
      contexto(m),
      trilhaTela(m, 'fatura_plano', 'operadora.cobranca.baixada'),
      (g) =>
        g.baixar({
          id: r.id,
          versao: 1,
          pagoEm: '2026-10-15',
          valorPago: 82,
          multa: 1.6,
          juros: 0.4,
          dispensaMotivo: null,
          por: 'x',
        }),
    );
    expect(baixa.versao).toBe(2);
    const [f] = await ler(
      'SELECT situacao, valor_pago, valor_acrescimo, versao FROM fatura_plano WHERE id = ?',
      [r.id],
    );
    expect(f).toMatchObject({ situacao: 'paga', versao: 2 });
    expect(Number(f!['valor_acrescimo'])).toBe(2);
    const velha = await porta
      .gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'x'), (g) =>
        g.estornar({ id: r.id, versao: 1, motivo: 'teste', por: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(velha).toBe('conflito-versao');
    const repetida = await porta
      .gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'x'), (g) =>
        g.baixar({
          id: r.id,
          versao: 2,
          pagoEm: '2026-10-15',
          valorPago: 82,
          multa: 0,
          juros: 0,
          dispensaMotivo: null,
          por: 'x',
        }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(repetida).toBe('cobranca-nao-aberta');
    await porta.gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'x'), (g) =>
      g.estornar({ id: r.id, versao: 2, motivo: 'pago em duplicidade', por: 'x' }),
    );
    expect((await porta.cobranca(contexto(m), r.id))?.situacao).toBe('aberta');
    const t = await porta.totais(contexto(m), m.operadora, '2099-01-01');
    expect(t.vencidas).toBeGreaterThanOrEqual(1);
    const inad = await porta.inadimplentes(contexto(m), { operadora: m.operadora, hoje: '2099-01-01' });
    expect(inad.itens.map((x) => x.contrato)).toContain(m.contrato);
  });

  it('cancela com quem e quando; recusa outro estabelecimento e operadora de fora', async () => {
    const r = await nova(10);
    await porta.gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'x'), (g) =>
      g.cancelar({ id: r.id, versao: 1, motivo: 'lançada por engano', por: 'x' }),
    );
    const [f] = await ler(
      'SELECT situacao, cancelada_em, cancelada_por_usuario_id FROM fatura_plano WHERE id = ?',
      [r.id],
    );
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
    expect(await ler('SELECT id FROM fatura_plano WHERE estabelecimento_id = ?', [m.outroEst])).toHaveLength(
      0,
    );
  });

  it('registra e cancela o reajuste; lê a situação do reajuste do contrato', async () => {
    const r = await porta.gravar(
      contexto(m),
      trilhaTela(m, 'reajuste_contrato_plano', 'operadora.reajuste'),
      (g) =>
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
    expect(lido).toMatchObject({
      contrato: m.contrato,
      competencia: '2026-05',
      percentual: 6.91,
      situacao: 'vigente',
      registradoPor: 'l0209.teste',
    });
    const sit = await porta.situacaoReajuste(contexto(m), m.contrato);
    expect(sit.vigentes).toContain('2026-05');
    expect(sit.vidas).toBeGreaterThanOrEqual(1);
    const dup = await porta
      .gravar(contexto(m), trilhaTela(m, 'reajuste_contrato_plano', 'x'), (g) =>
        g.registrarReajuste({
          operadora: m.operadora,
          contrato: m.contrato,
          competencia: '2026-05',
          percentual: 1,
          tetoAns: null,
          oficioAns: null,
          vidas: 1,
          motivo: 'x',
          por: 'x',
        }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(dup).toBe('reajuste-duplicado');
    await porta.gravar(contexto(m), trilhaTela(m, 'reajuste_contrato_plano', 'x'), (g) =>
      g.cancelarReajuste({ id: r.id, motivo: 'índice errado', por: 'x' }),
    );
    expect((await porta.reajuste(contexto(m), r.id))?.situacao).toBe('cancelado');
  });

  it('base das mensalidades: contrato vigente na competência com beneficiários, reajustes e se já foi gerada', async () => {
    const f = {
      operadora: m.operadora,
      competencia: '2026-10',
      primeiroDia: '2026-10-01',
      ultimoDia: '2026-10-31',
      contrato: m.contrato,
    };
    const r = await porta.baseMensalidades(contexto(m), f);
    expect(r.proxima).toBeNull();
    expect(r.itens).toHaveLength(1);
    const k = r.itens[0]!;
    expect(k).toMatchObject({ id: m.contrato, operadora: m.operadora, produto: m.produto });
    expect(k.beneficiarios.map((b) => b.id)).toContain(m.beneficiario);
    expect(k.precos === null || Array.isArray(k.precos)).toBe(true);
    expect(typeof k.jaGerada).toBe('boolean');
    expect((await porta.baseMensalidades(contexto(m, m.outroEst), f)).itens).toEqual([]);
    // Antes do início de vigência de qualquer contrato da massa: nada a gerar.
    expect(
      (
        await porta.baseMensalidades(contexto(m), {
          ...f,
          competencia: '1990-01',
          primeiroDia: '1990-01-01',
          ultimoDia: '1990-01-31',
        })
      ).itens,
    ).toEqual([]);
  });

  it('notifica a inadimplência: ocorrência, notificação e cobranças notificadas; recusa a segunda no mesmo dia', async () => {
    const a = await nova(100);
    const b = await nova(50);
    await vencer(a.id, 70);
    await vencer(b.id, 40);
    const hoje = (await porta.relogio(contexto(m))).hoje;
    const em = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const n = await porta.gravar(
      contexto(m),
      trilhaTela(m, 'fatura_plano', 'operadora.cobranca.notificada'),
      async (g) => ({
        id: m.contrato,
        ...(await g.notificar({
          contrato: m.contrato,
          hoje,
          em,
          meio: 'carta-ar',
          referencia: 'AR-SINTETICO-1',
          por: 'x',
        })),
      }),
    );
    expect(n.cobrancas).toBe(2);
    const [o] = await ler(
      'SELECT * FROM ocorrencia_inadimplencia WHERE contrato_plano_id = ? AND estabelecimento_id = ?',
      [m.contrato, m.est],
    );
    expect(o).toMatchObject({ situacao: 'notificada', quantidade_parcelas: 2, dias_atraso: 70 });
    expect(Number(o!['valor_em_aberto'])).toBe(150);
    const ns = await ler(
      'SELECT meio, sequencia, aviso_recebimento, dias_atraso FROM notificacao_inadimplencia WHERE ocorrencia_inadimplencia_id = ?',
      [o!['id']],
    );
    expect(ns).toEqual([
      expect.objectContaining({
        meio: 'carta_ar',
        sequencia: 1,
        aviso_recebimento: 'AR-SINTETICO-1',
        // Atraso na data de emissão (ontem): 69 dias; a ocorrência guarda o de hoje (70).
        dias_atraso: 69,
      }),
    ]);
    const lida = await porta.cobranca(contexto(m), a.id);
    expect(lida).toMatchObject({
      notificadoEm: em,
      notificacaoMeio: 'carta-ar',
      notificacaoReferencia: 'AR-SINTETICO-1',
    });
    // A cobrança a vencer não é notificada.
    expect((await porta.cobranca(contexto(m), (await nova(10)).id))?.notificadoEm).toBeNull();
    const de2 = await porta
      .gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'operadora.cobranca.notificada'), async (g) => ({
        id: m.contrato,
        ...(await g.notificar({
          contrato: m.contrato,
          hoje,
          em,
          meio: 'pessoal',
          referencia: 'ASSINADO',
          por: 'x',
        })),
      }))
      .catch((x: unknown) => codigoDe(x));
    expect(de2).toBe('notificacao-sem-atraso');
  });

  it('notifica pela data de emissão: a cobrança vencida entre a emissão e hoje não é alcançada; recusa emissão futura', async () => {
    // Contrato sem notificação anterior: a do caso acima alcançaria a cobrança vencida há 5 dias.
    await limparInadimplencia();
    await limparNegocio(nucleo, m);
    const a = await nova(100);
    const c = await nova(30);
    await vencer(a.id, 40);
    await vencer(c.id, 5);
    const hoje = (await porta.relogio(contexto(m))).hoje;
    const em = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const notificar = (data: string) =>
      porta.gravar(
        contexto(m),
        trilhaTela(m, 'fatura_plano', 'operadora.cobranca.notificada'),
        async (g) => ({
          id: m.contrato,
          ...(await g.notificar({
            contrato: m.contrato,
            hoje,
            em: data,
            meio: 'carta-ar',
            referencia: 'AR-SINT-2',
            por: 'x',
          })),
        }),
      );
    const futura = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(await notificar(futura).catch((x: unknown) => codigoDe(x))).toBe('notificacao-data-futura');
    const n = await notificar(em);
    expect(n.cobrancas).toBe(1);
    expect((await porta.cobranca(contexto(m), a.id))?.notificadoEm).toBe(em);
    // Venceu depois da emissão: não foi alcançada pela notificação, mesmo registrada hoje.
    expect((await porta.cobranca(contexto(m), c.id))?.notificadoEm).toBeNull();
    const [nt] = await ler(
      `SELECT n.dias_atraso, DATE_FORMAT(n.emitida_em, '%Y-%m-%d') AS emitida FROM notificacao_inadimplencia n
         JOIN ocorrencia_inadimplencia o ON o.id = n.ocorrencia_inadimplencia_id
        WHERE o.contrato_plano_id = ? AND o.estabelecimento_id = ? ORDER BY n.id DESC LIMIT 1`,
      [m.contrato, m.est],
    );
    expect(nt).toMatchObject({ dias_atraso: 30, emitida: em });
  });

  it('faz o acordo: acordo, renegociadas com encargos, parcelas apontando o acordo; recusa cobrança já renegociada', async () => {
    const a = await nova(200);
    await vencer(a.id, 20);
    const hoje = (await porta.relogio(contexto(m))).hoje;
    const vence = (meses: number) => {
      const d = new Date(`${hoje}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + meses);
      return d.toISOString().slice(0, 10);
    };
    const r = await porta.gravar(
      contexto(m),
      trilhaTela(m, 'fatura_plano', 'operadora.cobranca.acordo'),
      async (g) => {
        const { acordo } = await g.registrarAcordo({
          contrato: m.contrato,
          data: hoje,
          principal: 200,
          encargos: 6,
          total: 206,
          cobrancas: [{ id: a.id, versao: 1, valor: 200, multa: 4, juros: 2 }],
          parcelas: [
            { numero: 1, vencimento: vence(1), valor: 103 },
            { numero: 2, vencimento: vence(2), valor: 103 },
          ],
          dispensaMotivo: null,
          por: 'x',
        });
        const ids: number[] = [];
        for (const p of [1, 2])
          ids.push(
            (
              await g.incluir({
                operadora: m.operadora,
                contrato: m.contrato,
                beneficiario: null,
                tipo: 3,
                competencia: vence(p).slice(0, 7),
                descricao: `Parcela ${p}/2 do acordo ${acordo}`,
                valor: 103,
                vencimento: vence(p),
                acordoOrigem: acordo,
                parcela: p,
                parcelas: 2,
                itens: [],
                por: 'x',
              })
            ).id,
          );
        return { id: ids[0]!, acordo, ids };
      },
    );
    expect(r.acordo).toBeGreaterThan(0);
    const [ac] = await ler('SELECT * FROM acordo_inadimplencia WHERE estabelecimento_id = ? AND numero = ?', [
      m.est,
      String(r.acordo),
    ]);
    expect(ac).toMatchObject({
      contrato_plano_id: m.contrato,
      tipo_operacao: 'parcelamento',
      situacao: 'ativo',
      quantidade_parcelas: 2,
    });
    expect([
      Number(ac!['valor_original']),
      Number(ac!['valor_multa']),
      Number(ac!['valor_juros']),
      Number(ac!['valor_acordado']),
    ]).toEqual([200, 4, 2, 206]);
    const [af] = await ler('SELECT * FROM acordo_inadimplencia_fatura WHERE acordo_inadimplencia_id = ?', [
      ac!['id'],
    ]);
    expect(Number(af!['valor_total'])).toBe(206);
    const renegociada = await porta.cobranca(contexto(m), a.id);
    expect(renegociada).toMatchObject({ situacao: 'renegociada', acordoDestino: r.acordo });
    const parcela = await porta.cobranca(contexto(m), r.ids[0]!);
    expect(parcela).toMatchObject({ acordoOrigem: r.acordo, parcela: 1, parcelas: 2 });
    expect((await porta.renegociadas(contexto(m), r.acordo)).map((x) => x.id)).toEqual([a.id]);
    expect(await porta.renegociadas(contexto(m, m.outroEst), r.acordo)).toEqual([]);
    const de2 = await porta
      .gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'operadora.cobranca.acordo'), async (g) => ({
        id: a.id,
        ...(await g.registrarAcordo({
          contrato: m.contrato,
          data: hoje,
          principal: 200,
          encargos: 0,
          total: 200,
          cobrancas: [{ id: a.id, versao: 2, valor: 200, multa: 0, juros: 0 }],
          parcelas: [{ numero: 1, vencimento: vence(1), valor: 200 }],
          dispensaMotivo: 'SINTETICO',
          por: 'x',
        })),
      }))
      .catch((x: unknown) => codigoDe(x));
    expect(de2).toBe('acordo-cobranca-nao-aberta');
    // A recusa desfez o acordo inteiro (uma transação só).
    expect(
      await ler('SELECT id FROM acordo_inadimplencia WHERE estabelecimento_id = ?', [m.est]),
    ).toHaveLength(1);
  });
});
