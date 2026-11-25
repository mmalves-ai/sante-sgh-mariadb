// Contrato de efeito da OPME na guia (06-FAT linha 25) contra o MariaDB real (cliente de teste). Massa SINTÉTICA:
// estabelecimento com o código do teste, cobertura com carteira fictícia, solicitante externo, conta sintética com um
// item de OPME, limite de OPME e uma guia de cobrança sintética; paciente, atendimento, fonte pagadora, itens faturáveis,
// catálogos e usuários são ids já existentes (só lidos, nunca alterados).
// Prova o que fica no banco: o pedido acima do limite sem justificativa recusado; com ela, o pedido em rascunho e a
// liberação 'pendente' (tipo 'limite_opme', valor da OPME, resumo com limite e justificativa); o envio retido; quem
// pediu não libera; outra pessoa libera ('aprovado' + decisão gravada) e o envio sai; a resposta da operadora grava a
// guia de autorização da OPME (tipo 'opme', ligada à conta) com o valor autorizado por item; a guia de cobrança recebe a
// OPME da conta ligada à autorizada, com a revisão do que passa do autorizado; a regravação guarda a anterior com
// exclusão lógica; a recusa da liberação com motivo retém o pedido para sempre.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { definirOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaAutorizacaoPreviaPropria } from './autorizacao-previa-propria.js';
import { gravarOpmeDaGuiaTiss, PortaLiberacaoOpmePropria } from './opme-guia-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2057opm';
const CARTEIRA = 'SINTC2057A01';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const sol = `(SELECT id FROM solicitacao_autorizacao WHERE estabelecimento_id IN ${est})`;
  const ped = `(SELECT id FROM pedido_aprovacao WHERE estabelecimento_id IN ${est})`;
  const gfp = `(SELECT id FROM guia_fonte_pagadora WHERE estabelecimento_id IN ${est})`;
  const gt = `(SELECT id FROM guia_tiss WHERE estabelecimento_id IN ${est})`;
  await e.executar(`DELETE FROM guia_tiss_opme WHERE guia_tiss_id IN ${gt}`, [P]);
  await e.executar(`DELETE FROM guia_tiss WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM guia_fonte_pagadora_opme WHERE guia_fonte_pagadora_id IN ${gfp}`, [P]);
  await e.executar(`DELETE FROM guia_fonte_pagadora WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM decisao_aprovacao WHERE pedido_aprovacao_id IN ${ped}`, [P]);
  await e.executar(`DELETE FROM pedido_aprovacao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM consulta_situacao_autorizacao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    `DELETE FROM resposta_autorizacao_item WHERE resposta_autorizacao_id IN (SELECT id FROM resposta_autorizacao WHERE estabelecimento_id IN ${est})`,
    [P],
  );
  await e.executar(`DELETE FROM resposta_autorizacao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM solicitacao_autorizacao_item WHERE solicitacao_autorizacao_id IN ${sol}`, [
    P,
  ]);
  await e.executar(`DELETE FROM solicitacao_autorizacao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    `DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (SELECT id FROM conta_hospitalar WHERE estabelecimento_id IN ${est})`,
    [P],
  );
  await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM limite_opme_procedimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM item_faturavel WHERE codigo = 'SINT2057O'");
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM solicitante_externo WHERE numero_conselho = 'SINT2057'");
  await e.executar('DELETE FROM cobertura_paciente WHERE numero_carteira LIKE ?', ['SINTC2057A%']);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('OPME na guia contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let autorizacao: PortaAutorizacaoPreviaPropria;
  let liberacao: PortaLiberacaoOpmePropria;
  let m: {
    usuario: number;
    outro: number;
    cobertura: number;
    externo: number;
    conta: number;
    faturavel: number;
    opme: number;
    opmeCodigo: string;
    est: number;
    fonte: number;
    paciente: number;
  };
  const ctx = (usuario = m.usuario) => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const um = async (sql: string, p: unknown[] = []) =>
    (await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)))[0]!;
  const todos = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const recusa = { problema: { status: 422 } };
  const erroDe = async (pr: Promise<unknown>) => {
    const r = await pr.then(
      () => null,
      (x: unknown) => x,
    );
    expect(r).toMatchObject(recusa);
    return JSON.stringify(r);
  };
  const pedido = (valorUnitario: number, justificativaLimite: string | null) => ({
    tipo: 'internacao',
    canal: 'portal',
    cobertura: m.cobertura,
    conta: m.conta,
    solicitanteExterno: m.externo,
    regime: 'hospitalar',
    diarias: 3,
    dataAdmissao: '2026-11-26',
    indicacaoClinica: 'Indicação sintética',
    justificativaLimite,
    itens: [
      {
        itemFaturavel: m.faturavel,
        codigoTabela: '22',
        codigoProcedimento: '40301010',
        descricao: 'Procedimento sintético',
        quantidade: 1,
      },
      {
        itemFaturavel: m.opme,
        codigoTabela: '19',
        codigoProcedimento: m.opmeCodigo,
        descricao: 'OPME sintética',
        quantidade: 2,
        valorUnitario,
        opme: true,
        registroAnvisa: '80000000001',
      },
    ],
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const v = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await v('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const outro = await v(
        `SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL AND id > ${usuario}`,
      );
      const paciente = await v(
        'SELECT MIN(p.id) AS id FROM paciente p JOIN atendimento a ON a.paciente_id = p.id WHERE p.excluido_em IS NULL',
      );
      const atendimento = await v(`SELECT MIN(id) AS id FROM atendimento WHERE paciente_id = ${paciente}`);
      const fonte = await v('SELECT MIN(id) AS id FROM fonte_pagadora');
      const faturavel = await v("SELECT MIN(id) AS id FROM item_faturavel WHERE tipo_item <> 'opme'");
      const insumo = await v('SELECT MIN(id) AS id FROM insumo');
      const grupo = await v('SELECT MIN(id) AS id FROM grupo_faturamento');
      if (!insumo || !grupo) throw new Error('O cliente de teste precisa de insumo e grupo de faturamento.');
      // Item faturável de OPME sintético (o catálogo do cliente de teste pode não ter OPME).
      const opme = await e.inserir(
        `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, insumo_id, criado_em)
         VALUES ('SINT2057O', 'OPME sintética', 'opme', ?, ?, ?)`,
        [grupo, insumo, agora],
      );
      const tipoConta = await v('SELECT MIN(id) AS id FROM tipo_conta');
      if (!usuario || !outro || !paciente || !atendimento || !fonte || !faturavel || !opme || !tipoConta)
        throw new Error(
          'O cliente de teste precisa de dois usuários, paciente com atendimento, fonte e itens de OPME.',
        );
      const opmeCodigo = String(
        (await e.uma('SELECT codigo FROM item_faturavel WHERE id = ?', [opme]))?.['codigo'],
      );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const cobertura = await e.inserir(
        `INSERT INTO cobertura_paciente (paciente_id, fonte_pagadora_id, numero_carteira, validade, vigencia_inicio, situacao, criado_em)
         VALUES (?, ?, ?, '2030-12-31', '2026-01-01', 'ativa', ?)`,
        [paciente, fonte, CARTEIRA, agora],
      );
      const externo = await e.inserir(
        `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id, ocupacao_cbo_id, telefone, criado_em)
         VALUES ('Solicitante sintético', (SELECT id FROM conselho_classe WHERE codigo_tiss = '06' LIMIT 1), 'SINT2057',
                 (SELECT id FROM unidade_federativa WHERE codigo_ibge = '35' LIMIT 1),
                 (SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225125' LIMIT 1), '1130000000', ?)`,
        [agora],
      );
      const conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
                                       natureza, competencia, inicio_em, criado_em)
         VALUES (?, 'SINT2057', ?, ?, ?, ?, 'internacao', '2026-11-01', ?, ?)`,
        [est, atendimento, paciente, fonte, tipoConta, agora, agora],
      );
      await e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
                                            valor_unitario, valor_total, criado_em)
         VALUES (?, 1, ?, ?, 2, 750, 1500, ?)`,
        [conta, opme, agora, agora],
      );
      await e.inserir(
        `INSERT INTO limite_opme_procedimento (estabelecimento_id, fonte_pagadora_id, item_faturavel_id, valor_limite, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, 1000, '2026-01-01', ?)`,
        [est, fonte, faturavel, agora],
      );
      return { usuario, outro, cobertura, externo, conta, faturavel, opme, opmeCodigo, est, fonte, paciente };
    });
    autorizacao = new PortaAutorizacaoPreviaPropria(nucleo, CLIENTE);
    liberacao = new PortaLiberacaoOpmePropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  it('acima do limite: retido, quatro olhos, liberado, autorizado por item e cobrado na guia com a revisão', async () => {
    // Sem justificativa, a passagem do limite é recusada com o caminho da liberação.
    expect(await erroDe(autorizacao.criar(ctx(), pedido(800, null)))).toMatch(
      /acima do limite.*justificativa/s,
    );
    const criado = await autorizacao.criar(ctx(), pedido(800, 'Haste longa exigida pela revisão da prótese'));
    expect(criado.liberacao).toBeGreaterThan(0);
    const lib = await um(
      `SELECT p.situacao, p.valor, p.entidade, p.entidade_id, p.solicitante_usuario_id, p.resumo_documento, t.codigo
         FROM pedido_aprovacao p JOIN tipo_documento_aprovacao t ON t.id = p.tipo_documento_aprovacao_id WHERE p.id = ?`,
      [criado.liberacao],
    );
    expect(lib).toMatchObject({
      situacao: 'pendente',
      entidade: 'solicitacao_autorizacao',
      codigo: 'limite_opme',
    });
    expect(Number(lib['valor'])).toBe(1600);
    expect(Number(lib['entidade_id'])).toBe(criado.id);
    expect(Number(lib['solicitante_usuario_id'])).toBe(m.usuario);
    const resumo =
      typeof lib['resumo_documento'] === 'string'
        ? JSON.parse(lib['resumo_documento'] as string)
        : lib['resumo_documento'];
    expect(resumo).toMatchObject({
      total: 1600,
      limiteValor: 1000,
      justificativa: 'Haste longa exigida pela revisão da prótese',
    });

    // Retido: o envio não sai; quem pediu não libera.
    expect(await erroDe(autorizacao.enviar(ctx(), criado.id, { versao: 1 }))).toMatch(/aguarda a libera/);
    expect(
      await erroDe(
        liberacao.decidir(ctx(), criado.liberacao!, { versao: 1, decisao: 'aprovar', justificativa: null }),
      ),
    ).toMatch(/não libera o próprio pedido/);
    const painel = await liberacao.painel(ctx(m.outro));
    expect(painel.pedidos.find((p) => p.id === criado.liberacao)).toMatchObject({
      situacao: 'pendente',
      meu: false,
      valor: 1600,
      limiteValor: 1000,
    });
    // Outra pessoa libera (sem alçada cadastrada, basta outra pessoa com a permissão): decisão gravada.
    expect(
      await liberacao.decidir(ctx(m.outro), criado.liberacao!, {
        versao: 1,
        decisao: 'aprovar',
        justificativa: null,
      }),
    ).toMatchObject({ situacao: 'aprovado', faltam: [] });
    const dec = await todos(
      'SELECT aprovador_usuario_id, decisao, valor_aprovado FROM decisao_aprovacao WHERE pedido_aprovacao_id = ?',
      [criado.liberacao],
    );
    expect(dec).toHaveLength(1);
    expect(dec[0]).toMatchObject({ decisao: 'aprovado' });
    expect(Number(dec[0]!['aprovador_usuario_id'])).toBe(m.outro);
    expect(await autorizacao.enviar(ctx(), criado.id, { versao: 1 })).toMatchObject({ situacao: 'enviada' });

    // A resposta da operadora grava a guia de autorização da OPME com o valor autorizado por item.
    await autorizacao.responder(ctx(), criado.id, {
      senha: 'SINT2057',
      numeroGuiaOperadora: 'OP2057',
      dataAutorizacao: '2026-11-25',
      versao: 2,
      itens: [
        { sequencia: 1, quantidadeAutorizada: 1, valorAutorizado: null },
        { sequencia: 2, quantidadeAutorizada: 2, valorAutorizado: 1200 },
      ],
    });
    const guia = await um(
      'SELECT id, tipo_guia, situacao, conta_hospitalar_id, senha, numero_guia_operadora FROM guia_fonte_pagadora WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(guia).toMatchObject({
      tipo_guia: 'opme',
      situacao: 'autorizada',
      senha: 'SINT2057',
      numero_guia_operadora: 'OP2057',
    });
    expect(Number(guia['conta_hospitalar_id'])).toBe(m.conta);
    const autorizadas = await todos(
      'SELECT id, item_faturavel_id, quantidade, valor_total, valor_autorizado, situacao, registro_anvisa FROM guia_fonte_pagadora_opme WHERE guia_fonte_pagadora_id = ?',
      [guia['id']],
    );
    expect(autorizadas).toHaveLength(1);
    expect(autorizadas[0]).toMatchObject({ situacao: 'autorizado', registro_anvisa: '80000000001' });
    expect(Number(autorizadas[0]!['valor_autorizado'])).toBe(1200);
    expect(Number(autorizadas[0]!['valor_total'])).toBe(1600);
    expect(Number(autorizadas[0]!['item_faturavel_id'])).toBe(m.opme);

    // A guia de cobrança do lote leva a OPME da conta ligada à autorizada; 1500 cobrados contra 1200 autorizados.
    const executor = nucleo.criarExecutor();
    const guiaTiss = await nucleo.escrever({ cliente: CLIENTE, correlacao: `guia-${P}` }, (e) =>
      e.inserir(
        `INSERT INTO guia_tiss (estabelecimento_id, conta_hospitalar_id, tipo_guia, fonte_pagadora_id, paciente_id,
                                numero_guia_prestador, data_emissao, situacao, criado_em)
         VALUES (?, ?, 'resumo_internacao', ?, ?, 'SINT2057', '2026-11-25', 'em_lote', ?)`,
        [m.est, m.conta, m.fonte, m.paciente, new Date()],
      ),
    );
    let avisos: string[] = [];
    const op = definirOperacao({
      nome: 'tiss.opme-guia.teste',
      tabelas: ['guia_tiss_opme'],
      entrada: z.object({}).strict(),
      gravar: async (tx, _e, c) => {
        avisos = await gravarOpmeDaGuiaTiss(tx, {
          guiaTiss,
          conta: m.conta,
          agora: new Date(),
          usuario: c.usuario,
        });
        return { tabela: 'guia_tiss', id: guiaTiss };
      },
      alvo: () => ({ tabela: 'guia_tiss', id: guiaTiss }),
    });
    const contexto = (k: string) => ({
      cliente: CLIENTE,
      estabelecimento: m.est,
      usuario: m.usuario,
      correlacao: P,
      chaveIdempotencia: `${P}-${k}-${Date.now()}`,
    });
    await executor.executar(op, CLIENTE, {}, contexto('1'));
    expect(avisos.join()).toMatch(/Cobrado 1500.00 acima do autorizado 1200.00/);
    const cobradas = await todos(
      'SELECT sequencia, guia_fonte_pagadora_opme_id, momento, tabela_tiss, quantidade, valor_unitario, valor_total, justificativa_revisao, excluido_em FROM guia_tiss_opme WHERE guia_tiss_id = ? ORDER BY sequencia',
      [guiaTiss],
    );
    expect(cobradas).toHaveLength(1);
    expect(cobradas[0]).toMatchObject({ momento: 'utilizado', tabela_tiss: '19', excluido_em: null });
    expect(Number(cobradas[0]!['guia_fonte_pagadora_opme_id'])).toBe(Number(autorizadas[0]!['id']));
    expect(Number(cobradas[0]!['valor_total'])).toBe(1500);
    expect(Number(cobradas[0]!['valor_unitario'])).toBe(750);
    expect(String(cobradas[0]!['justificativa_revisao'])).toMatch(/acima do autorizado/);
    // Guia reapresentada: a linha anterior fica com exclusão lógica, a nova segue a sequência.
    await executor.executar(op, CLIENTE, {}, contexto('2'));
    const depois = await todos(
      'SELECT sequencia, excluido_em FROM guia_tiss_opme WHERE guia_tiss_id = ? ORDER BY sequencia',
      [guiaTiss],
    );
    expect(depois.map((x) => Number(x['sequencia']))).toEqual([1, 2]);
    expect(depois[0]!['excluido_em']).not.toBeNull();
    expect(depois[1]!['excluido_em']).toBeNull();
  });

  it('liberação recusada com motivo retém o pedido; cancelamento só por quem pediu', async () => {
    const a = await autorizacao.criar(ctx(), pedido(700, 'Material importado sem similar nacional'));
    expect(
      await erroDe(
        liberacao.decidir(ctx(m.outro), a.liberacao!, { versao: 1, decisao: 'recusar', justificativa: null }),
      ),
    ).toMatch(/Diga por que/);
    expect(
      await liberacao.decidir(ctx(m.outro), a.liberacao!, {
        versao: 1,
        decisao: 'recusar',
        justificativa: 'Há similar na tabela da operadora',
      }),
    ).toMatchObject({ situacao: 'reprovado' });
    expect(await erroDe(autorizacao.enviar(ctx(), a.id, { versao: 1 }))).toMatch(/foi reprovado/);
    const b = await autorizacao.criar(ctx(), pedido(650, 'Segunda opção de fabricante exigida'));
    expect(
      await erroDe(
        liberacao.decidir(ctx(m.outro), b.liberacao!, {
          versao: 1,
          decisao: 'cancelar',
          justificativa: null,
        }),
      ),
    ).toMatch(/Só quem pediu/);
    expect(
      await liberacao.decidir(ctx(), b.liberacao!, {
        versao: 1,
        decisao: 'cancelar',
        justificativa: 'Desisti',
      }),
    ).toMatchObject({ situacao: 'cancelado' });
    const n = await um(
      "SELECT COUNT(*) AS n FROM pedido_aprovacao WHERE estabelecimento_id = ? AND situacao IN ('aprovado','reprovado','cancelado')",
      [m.est],
    );
    expect(Number(n['n'])).toBe(3);
  });
});
