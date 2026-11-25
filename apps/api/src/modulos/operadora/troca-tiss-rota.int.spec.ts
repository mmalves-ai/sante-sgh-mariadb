// Contrato de efeito da rota POST /api/operadora/troca-tiss/mensagens (08-SGO linha 107, C2-061) contra o MariaDB real
// (cliente f22_o2): o controlador com a porta própria da troca TISS e a porta própria da autorização, recebendo mensagens
// TISS 4.03 SINTÉTICAS (massa "L0209", válidas no XSD oficial, com o hash do epílogo). Prova o que fica no banco:
//   - o pedido de autorização em mensagem TISS deixa o pedido_autorizacao_plano com a origem do canal "troca eletrônica"
//     e a troca_tiss_operadora 'processada' com o MESMO protocolo (a reserva 'em_processamento' concluída: uma linha só);
//   - o reenvio do mesmo sequencial é recusado (409) e não grava um segundo pedido nem uma segunda troca;
//   - o UNIQUE do sequencial recusa a segunda reserva do mesmo sequencial (o envio simultâneo);
//   - o cancelamento de guia pela rota cancela o pedido recebido (com o histórico) e registra o cancelamento recebido.
// As regras de conferência do pedido (elegibilidade, TUSS, críticas) estão provadas no int.spec da autorização; aqui o
// conferirRegistro devolve o registro da massa a partir da entrada que a rota montou (prestador, tipo de guia e origem
// vêm da mensagem e do banco). SGH_NUCLEO_SEM_BANCO=1 pula.
import { mensagemSolicitacaoAutorizacao, conferirHashEpilogo } from '@sgh/dominio-faturamento';
import { numeroCarteirinha } from '@sgh/dominio-operadora';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
import {
  CLIENTE,
  contexto,
  limparNegocio,
  type MassaOperadora,
  P,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';
import { PortaTrocaTissPropria } from './troca-tiss-propria.js';
import { TrocaTissOperadoraController } from './troca-tiss.controller.js';

describe.skipIf(SEM_BANCO)('rota da troca TISS da operadora (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let m: MassaOperadora;
  let porta: PortaTrocaTissPropria;
  let c: TrocaTissOperadoraController;
  let req: RequisicaoAutorizada;
  let registroAns = '';
  let origemTroca = 0;
  const seq = String(Date.now() % 1_000_000_000);
  const guiaPrestador = `GT61-${seq}`;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't2061r' }, (l) => l.consultar(sql, p));

  async function limparTrocas() {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-t2061r' }, async (e) => {
      const est = [m.est, m.outroEst];
      await e.executar(
        'DELETE i FROM cancelamento_guia_recebido_item i JOIN cancelamento_guia_recebido c ON c.id = i.cancelamento_guia_recebido_id WHERE c.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM cancelamento_guia_recebido WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM troca_tiss_operadora WHERE estabelecimento_id IN (?, ?)', est);
    });
  }

  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
  const solicitacao = () =>
    mensagemSolicitacaoAutorizacao({
      tipo: 'sp_sadt',
      sequencialTransacao: seq,
      data: '2026-11-24',
      hora: '10:15:00',
      registroAns,
      codigoPrestador: `${P}-PR`,
      nomeContratado: 'Clinica sintetica',
      cnes: '1234567',
      numeroGuia: guiaPrestador,
      numeroGuiaPrincipal: null,
      carteira: numeroCarteirinha(registroAns, 1),
      recemNascido: false,
      solicitante: {
        nome: 'Profissional sintetico',
        conselho: '06',
        numeroConselho: '902090',
        uf: '35',
        cbo: '225125',
        telefone: '1130000000',
      },
      urgencia: false,
      indicacaoClinica: 'Indicacao sintetica',
      regime: null,
      tipoInternacao: null,
      diarias: null,
      dataAdmissao: null,
      cids: [],
      acidente: null,
      observacao: null,
      itens: [
        {
          codigoTabela: '22',
          codigoProcedimento: '40301010',
          descricao: 'Procedimento sintetico',
          quantidade: 1,
          valorUnitario: null,
          opme: false,
          registroAnvisa: null,
          fabricante: null,
          opcaoFabricante: null,
        },
      ],
    });
  /** CANCELA_GUIA sintético: o envelope do pedido com o corpo do cancelamento, outro sequencial e o hash recalculado. */
  const cancelamento = (numeroGuiaOperadora: string) => {
    let x = Buffer.from(solicitacao().bytes)
      .toString('latin1')
      .replace('SOLICITACAO_PROCEDIMENTOS', 'CANCELA_GUIA')
      .replace(`<ans:sequencialTransacao>${seq}<`, `<ans:sequencialTransacao>${seq}1<`)
      .replace(
        /<ans:solicitacaoProcedimento>[\s\S]*<\/ans:solicitacaoProcedimento>/,
        `<ans:cancelaGuia><ans:dadosPrestador><ans:codigoPrestadorNaOperadora>${P}-PR</ans:codigoPrestadorNaOperadora></ans:dadosPrestador><ans:tipoCancelamento><ans:tipoCancelamentoGuia><ans:tipoGuia>1</ans:tipoGuia><ans:numeroGuiaPrestador>${guiaPrestador}</ans:numeroGuiaPrestador><ans:numeroGuiaOperadora>${numeroGuiaOperadora}</ans:numeroGuiaOperadora></ans:tipoCancelamentoGuia></ans:tipoCancelamento></ans:cancelaGuia>`,
      );
    x = x.replace(/<ans:hash>[^<]*<\/ans:hash>/, `<ans:hash>${conferirHashEpilogo(x).calculado}</ans:hash>`);
    return Buffer.from(x, 'latin1').toString('base64');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    // A sessão resolve o estabelecimento pelo mapa da API, como em produção.
    desligarMapaEstabelecimentos();
    await ligarMapaEstabelecimentos(CLIENTE, nucleo);
    await limparTrocas();
    await limparNegocio(nucleo, m);
    const [o] = await ler('SELECT registro_ans FROM operadora_saude WHERE id = ?', [m.operadora]);
    registroAns = String(o!['registro_ans']);
    // A origem do canal "troca eletrônica" (a mesma que a conferência da mensagem escolhe).
    origemTroca = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-t2061r' }, async (e) => {
      const ja = await e.uma(
        "SELECT id FROM origem_guia_plano WHERE canal = 'troca_eletronica' AND ativo = TRUE ORDER BY id LIMIT 1",
      );
      if (ja) return Number(ja['id']);
      await e.executar(
        "INSERT INTO origem_guia_plano (codigo, descricao, canal, criado_em) VALUES (?, ?, 'troca_eletronica', ?)",
        [`${P}-OT`, `${P}-OT SINTETICO`, new Date()],
      );
      const x = await e.uma('SELECT id FROM origem_guia_plano WHERE codigo = ?', [`${P}-OT`]);
      return Number(x!['id']);
    });
    porta = new PortaTrocaTissPropria(nucleo, CLIENTE);
    const autorizacoes = new PortaAutorizacaoOperadoraPropria(
      nucleo,
      CLIENTE,
      { elegibilidade: async () => null },
      { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
    );
    c = new TrocaTissOperadoraController(porta, autorizacoes);
    vi.spyOn(c.situacoes, 'exigir').mockResolvedValue(undefined);
    vi.spyOn(c.autorizacao, 'conferirRegistro').mockImplementation(
      async (_ctx, e) =>
        ({
          registroAns,
          registro: {
            operadora: m.operadora,
            beneficiario: m.beneficiario,
            carteirinha: e.carteirinha,
            prestador: e.prestador,
            executante: null,
            guiaPrincipal: null,
            tipoGuia: e.tipoGuia,
            carater: e.carater,
            altaComplexidade: false,
            origem: e.origem,
            solicitadaEm: new Date().toISOString(),
            prazoTipo: 'padrao',
            prazoEm: new Date(Date.now() + 5 * 86_400_000).toISOString(),
            cid: null,
            indicacaoClinica: e.indicacaoClinica,
            profissional: e.profissional,
            internacao: null,
            itens: [],
          },
        }) as unknown as Awaited<ReturnType<typeof c.autorizacao.conferirRegistro>>,
    );
    req = {
      headers: {},
      sgh: {
        real: true,
        sessao: {
          estabelecimentoAtivo: contexto(m).hospital,
          rede: '',
          usuario: { id: String(m.usuario), login: 'l0209.teste' },
        },
        ability: { can: () => true },
      },
    } as unknown as RequisicaoAutorizada;
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limparTrocas();
      await limparNegocio(nucleo, m);
    }
    desligarMapaEstabelecimentos();
    await nucleo?.encerrar();
  });

  let protocolo = '';
  let pedido = 0;

  it('pedido de autorização TISS: o pedido com a origem "troca eletrônica" e a troca processada com o mesmo protocolo', async () => {
    const r = await c.receber({ arquivo: b64(solicitacao().bytes), canal: 'webservice' }, req);
    expect(r).toMatchObject({ tipo: 'solicitacao_procedimento', situacao: 'processada', motivos: [] });
    protocolo = r.protocolo!;
    expect(protocolo).toMatch(/^\d{20}$/);
    const trocas = await ler(
      'SELECT id, direcao, situacao, numero_protocolo, canal, prestador_rede_id, mensagem_erro FROM troca_tiss_operadora WHERE estabelecimento_id = ? AND sequencial_transacao = ?',
      [m.est, seq],
    );
    expect(trocas).toEqual([
      expect.objectContaining({
        id: r.troca,
        direcao: 'recebida',
        situacao: 'processada',
        numero_protocolo: protocolo,
        canal: 'webservice',
        prestador_rede_id: m.prestador,
        mensagem_erro: null,
      }),
    ]);
    const pedidos = await ler(
      `SELECT p.id, p.origem_guia_plano_id, o.canal, p.solicitante_prestador_rede_id, p.tipo_guia_plano_id
         FROM pedido_autorizacao_plano p JOIN origem_guia_plano o ON o.id = p.origem_guia_plano_id
        WHERE p.estabelecimento_id = ? AND p.protocolo = ?`,
      [m.est, protocolo],
    );
    expect(pedidos).toEqual([
      expect.objectContaining({
        origem_guia_plano_id: origemTroca,
        canal: 'troca_eletronica',
        solicitante_prestador_rede_id: m.prestador,
        tipo_guia_plano_id: m.tipoGuia,
      }),
    ]);
    pedido = Number(pedidos[0]!['id']);
    // A trilha da reserva e da conclusão na troca; a do pedido no pedido.
    expect(
      (
        await ler(
          "SELECT id FROM trilha_auditoria WHERE entidade = 'troca_tiss_operadora' AND entidade_id = ?",
          [r.troca],
        )
      ).length,
    ).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('o reenvio do mesmo sequencial: 409 repetida, sem segundo pedido nem segunda troca', async () => {
    const e = await c.receber({ arquivo: b64(solicitacao().bytes) }, req).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ErroProblema);
    expect((e as ErroProblema).extras).toMatchObject({ codigo: 'transacao-repetida' });
    expect(
      await ler(
        'SELECT id FROM pedido_autorizacao_plano WHERE estabelecimento_id = ? AND solicitante_prestador_rede_id = ? AND origem_guia_plano_id = ?',
        [m.est, m.prestador, origemTroca],
      ),
    ).toHaveLength(1);
    expect(
      await ler(
        'SELECT id FROM troca_tiss_operadora WHERE estabelecimento_id = ? AND sequencial_transacao = ?',
        [m.est, seq],
      ),
    ).toHaveLength(1);
  }, 60_000);

  it('o UNIQUE do sequencial recusa a segunda reserva do mesmo sequencial (envio simultâneo)', async () => {
    const [x] = await ler(
      'SELECT id FROM troca_tiss_operadora WHERE estabelecimento_id = ? AND sequencial_transacao = ?',
      [m.est, seq],
    );
    expect(x).toBeTruthy();
    const { lerCabecalhoTroca } = await import('@sgh/dominio-operadora');
    const xml = Buffer.from(solicitacao().bytes).toString('latin1');
    const segunda = await porta
      .registrarRecebida(
        contexto(m),
        {
          cabecalho: lerCabecalhoTroca(xml),
          canal: 'webservice',
          hash: null,
          operadora: m.operadora,
          prestador: m.prestador,
        },
        { situacao: 'em_processamento', protocolo: null, erro: null },
        trilhaTela(m, 'troca_tiss_operadora', 'x'),
      )
      .then(
        () => 'gravou',
        () => 'recusou',
      );
    expect(segunda).toBe('recusou');
  }, 60_000);

  it('cancelamento de guia pela rota: o pedido recebido fica cancelado, com o histórico e o cancelamento recebido', async () => {
    const [p] = await ler('SELECT numero_guia FROM pedido_autorizacao_plano WHERE id = ?', [pedido]);
    const r = await c.receber({ arquivo: cancelamento(String(p!['numero_guia'])) }, req);
    expect(r).toMatchObject({ tipo: 'cancelamento_guia', situacao: 'processada' });
    expect(r.guias).toEqual([
      expect.objectContaining({ numeroGuiaPrestador: guiaPrestador, resultado: 'cancelada' }),
    ]);
    const cg = await ler(
      'SELECT situacao, prestador_rede_id FROM cancelamento_guia_recebido WHERE estabelecimento_id = ? AND protocolo = ?',
      [m.est, r.protocolo],
    );
    expect(cg).toEqual([expect.objectContaining({ situacao: 'respondido', prestador_rede_id: m.prestador })]);
    const [t] = await ler(
      'SELECT tipo_transacao, situacao, sequencial_transacao FROM troca_tiss_operadora WHERE id = ?',
      [r.troca],
    );
    expect(t).toMatchObject({
      tipo_transacao: 'cancelamento_guia',
      situacao: 'processada',
      sequencial_transacao: `${seq}1`,
    });
    const [pd] = await ler('SELECT situacao FROM pedido_autorizacao_plano WHERE id = ?', [pedido]);
    expect(pd).toMatchObject({ situacao: 'cancelada' });
    expect(
      await ler(
        "SELECT id FROM pedido_autorizacao_plano_historico WHERE pedido_autorizacao_plano_id = ? AND evento = 'cancelamento'",
        [pedido],
      ),
    ).toHaveLength(1);
  }, 60_000);
});
