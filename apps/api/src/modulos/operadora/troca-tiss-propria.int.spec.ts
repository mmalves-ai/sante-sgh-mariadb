// Contrato de efeito da troca TISS na visão da operadora (08-SGO linha 107, C2-061) contra o MariaDB real (cliente
// f22_o2). Massa sintética "L0209". Prova o que fica no banco: o cancelamento de guia recebido (troca processada, pedido
// com o protocolo, a guia localizada cancelada com o histórico e a não localizada registrada); a comunicação de
// internação aceita pelo beneficiário da carteira e a de alta com carteira desconhecida recebida (pendente); a troca
// rejeitada com o motivo; o demonstrativo de pagamento (troca enviada, demonstrativo e linha do protocolo; a reemissão
// atualiza o mesmo número com a versão) e o envio do demonstrativo de análise. Trilha de cada gravação.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { lerCabecalhoTroca, type CancelamentoLido } from '@sgh/dominio-operadora';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
import { PortaContasOperadoraPropria } from './contas-porta-propria.js';
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
import { PortaTrocaTissPropria, type TrocaRecebida } from './troca-tiss-propria.js';

describe.skipIf(SEM_BANCO)('troca TISS da operadora (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTrocaTissPropria;
  let autorizacoes: PortaAutorizacaoOperadoraPropria;
  let contas: PortaContasOperadoraPropria;
  let m: MassaOperadora;
  let registroAns = '';
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't2061' }, (l) => l.consultar(sql, p));
  const T = (tabela: string, ev: string) => trilhaTela(m, tabela, ev);

  async function limparTrocas() {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-t2061' }, async (e) => {
      const est = [m.est, m.outroEst];
      await e.executar(
        'DELETE i FROM cancelamento_guia_recebido_item i JOIN cancelamento_guia_recebido c ON c.id = i.cancelamento_guia_recebido_id WHERE c.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM cancelamento_guia_recebido WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM comunicacao_internacao_recebida WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'DELETE i FROM demonstrativo_pagamento_emitido_item i JOIN demonstrativo_pagamento_emitido d ON d.id = i.demonstrativo_pagamento_emitido_id WHERE d.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM demonstrativo_pagamento_emitido WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM troca_tiss_operadora WHERE estabelecimento_id IN (?, ?)', est);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparTrocas();
    await limparNegocio(nucleo, m);
    porta = new PortaTrocaTissPropria(nucleo, CLIENTE);
    autorizacoes = new PortaAutorizacaoOperadoraPropria(
      nucleo,
      CLIENTE,
      { elegibilidade: async () => null },
      { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
    );
    contas = new PortaContasOperadoraPropria(
      nucleo,
      CLIENTE,
      { elegibilidade: async () => null },
      { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
      { autorizacoesPorSenha: async () => [], designacoes: async () => [] },
    );
    const [o] = await ler('SELECT registro_ans FROM operadora_saude WHERE id = ?', [m.operadora]);
    registroAns = String(o!['registro_ans']);
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limparTrocas();
      await limparNegocio(nucleo, m);
    }
    await nucleo?.encerrar();
  });

  const cab = (tipo: string, seq: string) =>
    lerCabecalhoTroca(
      `<ans:cabecalho><ans:identificacaoTransacao><ans:tipoTransacao>${tipo}</ans:tipoTransacao><ans:sequencialTransacao>${seq}</ans:sequencialTransacao><ans:dataRegistroTransacao>2026-11-20</ans:dataRegistroTransacao><ans:horaRegistroTransacao>09:30:00</ans:horaRegistroTransacao></ans:identificacaoTransacao><ans:origem><ans:identificacaoPrestador><ans:codigoPrestadorNaOperadora>${P}-PR</ans:codigoPrestadorNaOperadora></ans:identificacaoPrestador></ans:origem><ans:destino><ans:registroANS>${registroAns}</ans:registroANS></ans:destino><ans:Padrao>4.03.00</ans:Padrao></ans:cabecalho>`,
    );
  const troca = (tipo: string, seq: string): TrocaRecebida => ({
    cabecalho: cab(tipo, seq),
    canal: 'webservice',
    hash: `h${seq}`,
    operadora: m.operadora,
    prestador: m.prestador,
  });

  it('a conferência acha a operadora, o prestador pelo código e o sequencial repetido', async () => {
    const a = await porta.apoioRecebimento(contexto(m), { tipo: 'codigo', valor: `${P}-PR` }, '206101');
    expect(a).toMatchObject({
      operadora: { id: m.operadora, registroAns },
      prestador: m.prestador,
      sequencialRepetido: false,
    });
    await porta.registrarRecebida(
      contexto(m),
      troca('SOLICITACAO_PROCEDIMENTOS', '206101'),
      { situacao: 'rejeitada', protocolo: null, erro: 'O conselho do solicitante não é aceito.' },
      T('troca_tiss_operadora', 'operadora.troca-tiss.recebida'),
    );
    const [t] = await ler(
      "SELECT tipo_transacao, direcao, situacao, mensagem_erro, registro_ans, origem FROM troca_tiss_operadora WHERE estabelecimento_id = ? AND sequencial_transacao = '206101'",
      [m.est],
    );
    expect(t).toMatchObject({
      tipo_transacao: 'solicitacao_procedimento',
      direcao: 'recebida',
      situacao: 'rejeitada',
      mensagem_erro: 'O conselho do solicitante não é aceito.',
      registro_ans: registroAns,
      origem: 'integracao',
    });
    expect(
      (await porta.apoioRecebimento(contexto(m), { tipo: 'codigo', valor: `${P}-PR` }, '206101'))
        .sequencialRepetido,
    ).toBe(true);
    expect((await porta.trocas(contexto(m), { direcao: 'recebida' })).map((x) => x.sequencial)).toContain(
      '206101',
    );
  });

  it('o cancelamento cancela a guia localizada (com histórico) e registra a não localizada', async () => {
    const r = await autorizacoes.gravar(contexto(m), T('pedido_autorizacao_plano', 'x'), (g) =>
      g.registrar({
        operadora: m.operadora,
        beneficiario: m.beneficiario,
        carteirinha: 'L02090001',
        prestador: m.prestador,
        executante: null,
        guiaPrincipal: null,
        tipoGuia: m.tipoGuia,
        carater: 'E',
        altaComplexidade: false,
        origem: m.origemGuia,
        protocolo: 'L0209-T61',
        solicitadaEm: new Date().toISOString(),
        prazoTipo: 'padrao',
        prazoEm: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        cid: 'Z00',
        indicacaoClinica: 'Indicação clínica sintética',
        profissional: { nome: 'MEDICO SINTETICO', conselho: 'CRM', numero: '902090', uf: 'SP' },
        internacao: null,
        itens: [],
        usuario: 'l0209.teste',
      }),
    );
    const [p] = await ler('SELECT numero_guia FROM pedido_autorizacao_plano WHERE id = ?', [r.id]);
    const x: CancelamentoLido = {
      lote: null,
      guias: [
        {
          tipoGuia: 'solicitacao',
          numeroGuiaPrestador: 'GP-T61-1',
          numeroGuiaOperadora: String(p!['numero_guia']),
          numeroProtocolo: null,
        },
        {
          tipoGuia: 'solicitacao',
          numeroGuiaPrestador: 'GP-T61-X',
          numeroGuiaOperadora: null,
          numeroProtocolo: null,
        },
      ],
    };
    const c = await porta.receberCancelamento(
      contexto(m),
      troca('CANCELA_GUIA', '206102'),
      x,
      T('cancelamento_guia_recebido', 'operadora.troca-tiss.cancelamento-recebido'),
    );
    expect(c.protocolo).toMatch(/^\d{12}$/);
    expect(c.situacao).toBe('respondido');
    expect(c.guias.map((g) => g.resultado)).toEqual(['cancelada', 'nao_localizada']);
    const [cg] = await ler(
      'SELECT protocolo, situacao, respondido_em IS NOT NULL AS respondido, prestador_rede_id FROM cancelamento_guia_recebido WHERE id = ?',
      [c.id],
    );
    expect(cg).toMatchObject({
      protocolo: c.protocolo,
      situacao: 'respondido',
      respondido: 1,
      prestador_rede_id: m.prestador,
    });
    expect(
      await ler(
        'SELECT sequencia, resultado, pedido_autorizacao_plano_id FROM cancelamento_guia_recebido_item WHERE cancelamento_guia_recebido_id = ? ORDER BY sequencia',
        [c.id],
      ),
    ).toEqual([
      expect.objectContaining({ sequencia: 1, resultado: 'cancelada', pedido_autorizacao_plano_id: r.id }),
      expect.objectContaining({
        sequencia: 2,
        resultado: 'nao_localizada',
        pedido_autorizacao_plano_id: null,
      }),
    ]);
    const [pd] = await ler(
      'SELECT situacao, motivo_cancelamento_guia_plano_id IS NOT NULL AS motivo FROM pedido_autorizacao_plano WHERE id = ?',
      [r.id],
    );
    expect(pd).toMatchObject({ situacao: 'cancelada', motivo: 1 });
    expect(
      await ler(
        "SELECT id FROM pedido_autorizacao_plano_historico WHERE pedido_autorizacao_plano_id = ? AND evento = 'cancelamento'",
        [r.id],
      ),
    ).toHaveLength(1);
    const [t] = await ler(
      'SELECT tipo_transacao, situacao, numero_protocolo FROM troca_tiss_operadora WHERE id = ?',
      [c.troca],
    );
    expect(t).toMatchObject({
      tipo_transacao: 'cancelamento_guia',
      situacao: 'processada',
      numero_protocolo: c.protocolo,
    });
    expect(
      await ler(
        "SELECT id FROM trilha_auditoria WHERE entidade = 'cancelamento_guia_recebido' AND entidade_id = ?",
        [c.id],
      ),
    ).toHaveLength(1);
    // A segunda vez: a guia já cancelada responde cancelada sem mudar o pedido.
    const de = await porta.receberCancelamento(
      contexto(m),
      troca('CANCELA_GUIA', '206103'),
      { lote: null, guias: [x.guias[0]!] },
      T('cancelamento_guia_recebido', 'x'),
    );
    expect(de.guias[0]).toMatchObject({ resultado: 'cancelada', observacao: 'A guia já estava cancelada.' });
    expect(de.protocolo).not.toBe(c.protocolo);
  });

  it('a comunicação de internação é aceita pela carteira; a alta de carteira desconhecida fica recebida', async () => {
    const i = await porta.receberComunicacao(
      contexto(m),
      troca('COMUNICACAO_BENEFICIARIO', '206104'),
      {
        carteira: `${P}0001`,
        recemNascido: false,
        dataEvento: '2026-11-19',
        tipoEvento: 'internacao',
        tipoInternacao: 'cirurgica',
        motivoEncerramento: null,
      },
      T('comunicacao_internacao_recebida', 'operadora.troca-tiss.comunicacao-recebida'),
    );
    expect(i).toMatchObject({ situacao: 'aceita', beneficiarioIdentificado: true });
    const a = await porta.receberComunicacao(
      contexto(m),
      troca('COMUNICACAO_BENEFICIARIO', '206105'),
      {
        carteira: '9999999999999999',
        recemNascido: true,
        dataEvento: '2026-11-20',
        tipoEvento: 'alta',
        tipoInternacao: null,
        motivoEncerramento: '12',
      },
      T('comunicacao_internacao_recebida', 'x'),
    );
    expect(a).toMatchObject({ situacao: 'recebida', beneficiarioIdentificado: false });
    const linhas = await ler(
      'SELECT tipo_evento, tipo_internacao, codigo_motivo_encerramento, beneficiario_plano_id, situacao, recem_nascido, numero_transacao FROM comunicacao_internacao_recebida WHERE id IN (?, ?) ORDER BY id',
      [i.id, a.id],
    );
    expect(linhas).toEqual([
      expect.objectContaining({
        tipo_evento: 'internacao',
        tipo_internacao: 'cirurgica',
        beneficiario_plano_id: m.beneficiario,
        situacao: 'aceita',
        numero_transacao: '206104',
      }),
      expect.objectContaining({
        tipo_evento: 'alta',
        codigo_motivo_encerramento: '12',
        beneficiario_plano_id: null,
        situacao: 'recebida',
        recem_nascido: 1,
      }),
    ]);
    const [t] = await ler('SELECT tipo_transacao FROM troca_tiss_operadora WHERE id = ?', [i.troca]);
    expect(t).toMatchObject({ tipo_transacao: 'comunicacao_internacao' });
  });

  it('o demonstrativo de pagamento fica registrado com a troca enviada; a reemissão atualiza o mesmo número', async () => {
    const lote = await contas.gravar(contexto(m), T('lote_conta_recebida', 'x'), async (g) => {
      const protocolo = await g.proximoProtocolo();
      return g.receber({
        operadora: m.operadora,
        prestador: m.prestador,
        protocolo: `L0209-T${protocolo}`,
        numeroLote: '920061',
        tipoGuia: 'sp-sadt',
        competencia: '2026-10',
        prazoPagamento: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        arquivo: { nome: 'lote.xml', bytes: 10, sha256: 'ht920061', base64: '', hashEpilogo: 'et920061' },
        apresentado: 100,
        guias: [],
        usuario: 'l0209.teste',
      } as never);
    });
    const e = {
      numero: 'PT920061',
      hash: 'hp1',
      dataPagamento: '2026-11-20',
      informado: 100,
      liberado: 80,
      glosa: 20,
    };
    const d = await porta.registrarDemonstrativoPagamento(
      contexto(m),
      lote.id,
      e,
      T('demonstrativo_pagamento_emitido', 'operadora.contas.demonstrativo-pagamento'),
    );
    const [x] = await ler(
      'SELECT competencia, valor_informado, valor_liberado, valor_glosa, valor_liquido, situacao, troca_tiss_operadora_id, versao FROM demonstrativo_pagamento_emitido WHERE id = ?',
      [d.id],
    );
    expect(x).toMatchObject({ situacao: 'enviado', troca_tiss_operadora_id: d.troca, versao: 1 });
    expect(
      [x!['valor_informado'], x!['valor_liberado'], x!['valor_glosa'], x!['valor_liquido']].map(Number),
    ).toEqual([100, 80, 20, 80]);
    const [it1] = await ler(
      'SELECT tipo_linha, lote_conta_recebida_id, valor FROM demonstrativo_pagamento_emitido_item WHERE demonstrativo_pagamento_emitido_id = ?',
      [d.id],
    );
    expect(it1).toMatchObject({ tipo_linha: 'protocolo', lote_conta_recebida_id: lote.id });
    expect(Number(it1!['valor'])).toBe(80);
    const [t] = await ler(
      'SELECT direcao, tipo_transacao, situacao, hash_mensagem FROM troca_tiss_operadora WHERE id = ?',
      [d.troca],
    );
    expect(t).toMatchObject({
      direcao: 'enviada',
      tipo_transacao: 'demonstrativo_pagamento',
      situacao: 'gerada',
      hash_mensagem: 'hp1',
    });
    const de = await porta.registrarDemonstrativoPagamento(
      contexto(m),
      lote.id,
      { ...e, hash: 'hp2', liberado: 90, glosa: 10 },
      T('demonstrativo_pagamento_emitido', 'x'),
    );
    expect(de).toMatchObject({ id: d.id, versao: 2 });
    expect(
      await ler('SELECT id FROM demonstrativo_pagamento_emitido WHERE numero_demonstrativo = ?', [
        'PT920061',
      ]),
    ).toHaveLength(1);
    expect(
      await ler(
        "SELECT id FROM trilha_auditoria WHERE entidade = 'demonstrativo_pagamento_emitido' AND entidade_id = ?",
        [d.id],
      ),
    ).toHaveLength(2);
    const an = await porta.registrarEnvioAnalise(
      contexto(m),
      lote.id,
      { hash: 'ha1', informado: 100 },
      T('troca_tiss_operadora', 'x'),
    );
    const [ta] = await ler('SELECT tipo_transacao, numero_lote FROM troca_tiss_operadora WHERE id = ?', [
      an.id,
    ]);
    expect(ta).toMatchObject({ tipo_transacao: 'demonstrativo_analise_conta', numero_lote: '920061' });
  });
});
