// Integração da porta própria das contas médicas recebidas contra o MariaDB real (cliente f22_o2). Massa sintética
// "L0209". Contrato de efeito: o lote, a guia e o item (lote_conta_recebida, guia_conta_recebida,
// guia_conta_recebida_item), a glosa com o motivo da terminologia (glosa_conta_recebida) e os totais recalculados,
// a conclusão da análise, o pagamento e a devolução; versão, trilha e outbox; e as recusas (glosa maior que o
// apresentado, glosa sem motivo, lote repetido, conflito de versão, outro estabelecimento). SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaContasOperadoraPropria } from './contas-porta-propria.js';
import { ServicoContasOperadora } from './contas-servico.js';
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

describe.skipIf(SEM_BANCO)('porta própria das contas médicas recebidas (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaContasOperadoraPropria;
  let m: MassaOperadora;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't0209' }, (l) => l.consultar(sql, p));
  const T = (ev: string, est?: number) => trilhaTela(m, 'lote_conta_recebida', ev, est);
  const prazo = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    porta = new PortaContasOperadoraPropria(
      nucleo,
      CLIENTE,
      { elegibilidade: async () => null },
      { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
      { autorizacoesPorSenha: async () => [], designacoes: async () => [] },
    );
  }, 120_000);
  afterAll(async () => {
    if (m) await limparNegocio(nucleo, m);
    await nucleo?.encerrar();
  });

  const receber = (lote: string) =>
    porta.gravar(contexto(m), T('operadora.contas.recebida'), async (g) => {
      const protocolo = await g.proximoProtocolo();
      return g.receber({
        operadora: m.operadora,
        prestador: m.prestador,
        protocolo: `L0209-C${protocolo}`,
        numeroLote: lote,
        tipoGuia: 'sp-sadt',
        competencia: '2026-10',
        prazoPagamento: prazo,
        arquivo: { nome: 'lote.xml', bytes: 10, sha256: `h${lote}`, base64: '', hashEpilogo: `e${lote}` },
        apresentado: 200,
        guias: [
          {
            ordem: 1,
            numeroGuiaPrestador: `G${lote}`,
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
              { ordem: 1, sequencial: 1, grupo: 'procedimento', codigoDespesa: null, tabela: '22', codigo: '90209001', descricao: 'PROCEDIMENTO SINTETICO', data: '2026-10-05', quantidade: 1, fator: 1, valorUnitario: 200, apresentado: 200, glosado: 0, motivo: null, justificativa: null, critica: null },
            ],
          },
        ],
        texto: 'recebida',
        usuario: 'x',
      });
    });

  it('recebe o lote: lote, guia, item, trilha e outbox; lê a conta, as guias, os itens e os totais', async () => {
    const r = await receber('900001');
    const [l] = await ler('SELECT situacao, valor_apresentado, quantidade_guias, tipo_guia FROM lote_conta_recebida WHERE id = ?', [r.id]);
    expect(l).toMatchObject({ situacao: 'recebida', quantidade_guias: 1, tipo_guia: 'sp_sadt' });
    expect(await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'lote_conta_recebida' AND entidade_id = ?", [r.id])).toHaveLength(1);
    expect(await ler("SELECT id FROM integracao_mensagem WHERE ponto = 'operadora.contas.gravacao' AND entidade_id = ?", [r.id])).toHaveLength(1);
    expect(await porta.conta(contexto(m), r.id)).toMatchObject({ tipoGuia: 'sp-sadt', competencia: '2026-10', apresentado: 200, situacao: 'recebida', registroAns: '902090' });
    expect(await porta.guias(contexto(m), r.id)).toEqual([expect.objectContaining({ numeroGuiaPrestador: 'G900001', apresentado: 200, carater: '1' })]);
    expect(await porta.itens(contexto(m), r.id)).toEqual([expect.objectContaining({ codigo: '90209001', apresentado: 200, glosado: 0 })]);
    expect(await porta.loteJaRecebido(contexto(m), { operadora: m.operadora, prestador: m.prestador, numeroLote: '900001', sha256: 'x' })).toBe(true);
    expect([...(await porta.guiasJaApresentadas(contexto(m), m.prestador, ['G900001', 'G0']))]).toEqual(['G900001']);
    expect((await porta.totais(contexto(m))).emAnalise).toBeGreaterThanOrEqual(1);
    expect(await porta.conta(contexto(m, m.outroEst), r.id)).toBeNull();
    const repetido = await receber('900001').catch((e: unknown) => codigoDe(e));
    expect(repetido).not.toBeNull();
  });

  it('glosa com motivo e recalcula; recusa glosa maior e sem motivo; conclui e paga', async () => {
    const r = await receber('900002');
    const [item] = await porta.itens(contexto(m), r.id);
    const maior = await porta
      .gravar(contexto(m), T('x'), (g) => g.glosar({ id: r.id, versao: 1, usuario: 'x', itens: [{ item: item!.id, valorGlosado: 999, motivo: m.motivoGlosa, justificativa: 'x' }], texto: 'x', desfeita: false }))
      .catch((e: unknown) => codigoDe(e));
    expect(maior).toBe('glosa-maior');
    const semMotivo = await porta
      .gravar(contexto(m), T('x'), (g) => g.glosar({ id: r.id, versao: 1, usuario: 'x', itens: [{ item: item!.id, valorGlosado: 50, motivo: null, justificativa: 'x' }], texto: 'x', desfeita: false }))
      .catch((e: unknown) => codigoDe(e));
    expect(semMotivo).toBe('motivo-obrigatorio');
    const gl = await porta.gravar(contexto(m), T('operadora.contas.glosada'), (g) =>
      g.glosar({ id: r.id, versao: 1, usuario: 'x', itens: [{ item: item!.id, valorGlosado: 50, motivo: m.motivoGlosa, justificativa: 'Sem indicação' }], texto: 'glosa', desfeita: false }),
    );
    expect(gl.versao).toBe(2);
    const [l] = await ler('SELECT valor_glosado, valor_liberado FROM lote_conta_recebida WHERE id = ?', [r.id]);
    expect(Number(l!['valor_glosado'])).toBe(50);
    expect(Number(l!['valor_liberado'])).toBe(150);
    expect(await ler('SELECT motivo_glosa_id FROM glosa_conta_recebida WHERE guia_conta_recebida_item_id = ? AND excluido_em IS NULL', [item!.id])).toEqual([
      { motivo_glosa_id: m.motivoGlosa },
    ]);
    expect((await porta.itens(contexto(m), r.id))[0]).toMatchObject({ glosado: 50, motivo: m.motivoGlosa, origem: 'auditor' });
    const velha = await porta
      .gravar(contexto(m), T('x'), (g) => g.concluir({ id: r.id, versao: 1, usuario: 'x', auditor: 1, situacao: 'analisada', observacao: null, texto: 'x' }))
      .catch((e: unknown) => codigoDe(e));
    expect(velha).toBe('conflito-versao');
    await porta.gravar(contexto(m), T('x'), (g) => g.concluir({ id: r.id, versao: 2, usuario: 'x', auditor: 1, situacao: 'analisada', observacao: 'ok', texto: 'x' }));
    expect((await porta.pagamentos(contexto(m), { estado: 'a-pagar' })).itens.map((x) => x.id)).toContain(r.id);
    await porta.gravar(contexto(m), T('x'), (g) => g.pagar({ id: r.id, versao: 3, usuario: 'x', valor: 150, data: '2026-11-20', documento: 'TED 1', situacao: 'paga' }));
    expect(await porta.conta(contexto(m), r.id)).toMatchObject({ situacao: 'paga', pago: 150 });
    expect((await porta.eventos(contexto(m), r.id)).map((e) => e.evento)).toEqual(['recebimento', 'analise', 'pagamento']);
  });

  it('devolve com o motivo; recusa outro estabelecimento; motivos da terminologia; recurso sem dado é lista vazia; ficha pelo serviço', async () => {
    const r = await receber('900003');
    const fora = await porta
      .gravar(contexto(m, m.outroEst), T('x', m.outroEst), (g) => g.devolver({ id: r.id, versao: 1, usuario: 'x', motivo: 'x' }))
      .catch((e: unknown) => codigoDe(e));
    expect(fora).toBe('registro-inexistente');
    await porta.gravar(contexto(m), T('x'), (g) => g.devolver({ id: r.id, versao: 1, usuario: 'x', motivo: 'Arquivo ilegível' }));
    expect(await porta.conta(contexto(m), r.id)).toMatchObject({ situacao: 'devolvida', motivoDevolucao: 'Arquivo ilegível' });
    expect((await porta.motivos(contexto(m))).map((x) => x.codigo)).toContain(m.motivoGlosa);
    expect(await porta.recursosItens(contexto(m), r.id)).toEqual([]);
    const ficha = await new ServicoContasOperadora(porta).detalhe(contexto(m), r.id, {
      login: 'l0209.teste',
      podeAnalisar: true,
      podeReceber: true,
      podePagar: true,
    });
    expect(ficha).toMatchObject({ id: r.id });
  });
});
