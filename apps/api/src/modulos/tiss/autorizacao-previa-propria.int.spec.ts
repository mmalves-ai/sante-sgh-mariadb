// Contrato de efeito da autorização prévia à operadora (F78.06-2, 06-FAT L25 e L27) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste, cobertura com carteira fictícia, solicitante externo,
// configuração da fonte pagadora com registro e código fictícios, uma conta sintética e um limite de OPME; paciente,
// atendimento, fonte pagadora, item faturável, catálogos e usuário são ids já existentes (só lidos, nunca alterados).
// Prova o que fica no banco: o pedido em rascunho com número, carteira e itens; o envio recusado com a lista do que
// falta e, configurado, 'pronta_envio' sem enviada_em, com o XML válido no XSD guardado (arquivo imutável, arquivo_id,
// versão do padrão) e servido igual depois de mudar a configuração e o solicitante; a transmissão registrada com o
// canal real; as consultas de andamento por tentativa; a resposta parcial por item (resposta e itens, quantidade
// autorizada no pedido, senha na conta, consulta respondida); a resposta repetida recusada; o cancelamento com o
// motivo, e o do rascunho pelo webservice sem enviada_em; o limite de OPME (valor passado, OPME sem valor, procedimento
// sem item faturável), a guia só com OPME e o pedido complementar sem guia principal recusados; o pedido pelo portal
// enviado sem XML; a internação com a hipótese diagnóstica (CID-10 do catálogo, na mensagem) e recusada sem ela; a
// prorrogação pelo webservice na guia própria, com a guia referenciada pelo número da operadora; a autorização ligada
// aos itens da conta (quantidade coberta, refazer não duplica).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { guiaSolicitacaoHtml } from './guia-solicitacao-impressao.js';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { armazemXmlMemoria } from './armazem-xml.js';
import { PortaAutorizacaoPreviaPropria } from './autorizacao-previa-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f7862aut';
const CARTEIRA = 'SINTF7862A01';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const sol = `(SELECT id FROM solicitacao_autorizacao WHERE estabelecimento_id IN ${est})`;
  const itensConta = `(SELECT ci.id FROM conta_hospitalar_item ci JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id WHERE ch.estabelecimento_id IN ${est})`;
  await e.executar(
    `DELETE FROM conta_hospitalar_item_autorizacao WHERE conta_hospitalar_item_id IN ${itensConta}`,
    [P],
  );
  await e.executar(
    `DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (SELECT id FROM conta_hospitalar WHERE estabelecimento_id IN ${est})`,
    [P],
  );
  await e.executar(
    `DELETE FROM solicitacao_autorizacao_diagnostico WHERE solicitacao_autorizacao_id IN ${sol}`,
    [P],
  );
  await e.executar(`DELETE FROM consulta_situacao_autorizacao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    `DELETE FROM resposta_autorizacao_item WHERE resposta_autorizacao_id IN (SELECT id FROM resposta_autorizacao WHERE estabelecimento_id IN ${est})`,
    [P],
  );
  await e.executar(`DELETE FROM resposta_autorizacao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM solicitacao_autorizacao_item WHERE solicitacao_autorizacao_id IN ${sol}`, [
    P,
  ]);
  await e.executar(
    `DELETE FROM solicitacao_autorizacao WHERE principal_solicitacao_autorizacao_id IS NOT NULL AND estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM solicitacao_autorizacao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    `DELETE FROM arquivo WHERE entidade = 'solicitacao_autorizacao' AND estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM limite_opme_procedimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM configuracao_tiss_fonte_pagadora WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM versao_padrao_tiss WHERE descricao = 'Versão sintética f7862aut'");
  await e.executar("DELETE FROM solicitante_externo WHERE numero_conselho = 'SINT7862D'");
  await e.executar("DELETE FROM solicitante_externo WHERE numero_conselho = 'SINT7862'");
  await e.executar('DELETE FROM cobertura_paciente WHERE numero_carteira LIKE ?', ['SINTF7862A%']);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaAutorizacaoPreviaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAutorizacaoPreviaPropria;
  let m: {
    usuario: number;
    paciente: number;
    cobertura: number;
    externo: number;
    duplicado: number;
    conta: number;
    faturavel: number;
    atendimento: number;
    est: number;
    fonte: number;
    motivo: number;
    cid: string;
    itemConta: number;
    outroItemConta: number;
  };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const um = async (sql: string, p: unknown[] = []) =>
    (await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)))[0]!;
  const todos = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const recusa = { problema: { status: 422 } };
  const item = (x: Record<string, unknown> = {}) => ({
    codigoTabela: '22',
    codigoProcedimento: '40301010',
    descricao: 'Procedimento sintético',
    quantidade: 2,
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const v = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await v('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await v(
        'SELECT MIN(p.id) AS id FROM paciente p JOIN atendimento a ON a.paciente_id = p.id WHERE p.excluido_em IS NULL',
      );
      const atendimento = await v(`SELECT MIN(id) AS id FROM atendimento WHERE paciente_id = ${paciente}`);
      const fonte = await v('SELECT MIN(id) AS id FROM fonte_pagadora');
      const faturavel = await v('SELECT MIN(id) AS id FROM item_faturavel');
      const tipoConta = await v('SELECT MIN(id) AS id FROM tipo_conta');
      const motivo = await v('SELECT MIN(id) AS id FROM motivo_glosa');
      if (!usuario || !paciente || !atendimento || !fonte || !faturavel || !tipoConta || !motivo)
        throw new Error(
          'O cliente de teste precisa de usuário, paciente com atendimento, fonte e catálogos.',
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
         VALUES ('Solicitante sintético', (SELECT id FROM conselho_classe WHERE codigo_tiss = '06' LIMIT 1), 'SINT7862',
                 (SELECT id FROM unidade_federativa WHERE codigo_ibge = '35' LIMIT 1),
                 (SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225125' LIMIT 1), '1130000000', ?)`,
        [agora],
      );
      // Cadastro duplicado já unificado no solicitante acima (inativo, com o ponteiro): pedido novo nunca nasce nele.
      const duplicado = await e.inserir(
        `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id, ocupacao_cbo_id,
                                          ativo, sucessor_solicitante_externo_id, unificado_em, unificado_por, criado_em)
         VALUES ('Solicitante sintético duplicado', (SELECT id FROM conselho_classe WHERE codigo_tiss = '06' LIMIT 1), 'SINT7862D',
                 (SELECT id FROM unidade_federativa WHERE codigo_ibge = '35' LIMIT 1),
                 (SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225125' LIMIT 1), FALSE, ?, ?, ?, ?)`,
        [externo, agora, usuario, agora],
      );
      const conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
                                       natureza, competencia, inicio_em, criado_em)
         VALUES (?, 'SINT7862', ?, ?, ?, ?, 'internacao', '2026-11-01', ?, ?)`,
        [est, atendimento, paciente, fonte, tipoConta, agora, agora],
      );
      await e.inserir(
        `INSERT INTO limite_opme_procedimento (estabelecimento_id, fonte_pagadora_id, item_faturavel_id, valor_limite, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, 1000, '2026-01-01', ?)`,
        [est, fonte, faturavel, agora],
      );
      const cid = String(
        (
          await e.uma(
            `SELECT t.codigo_termo FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
              WHERE g.codigo = 'cid10' AND t.nivel = 4 AND t.ativo = TRUE ORDER BY t.id LIMIT 1`,
          )
        )?.['codigo_termo'] ?? '',
      );
      if (!cid) throw new Error('O cliente de teste precisa do catálogo da CID-10 carregado.');
      const itemConta = (s: number) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, criado_em) VALUES (?, ?, ?, '2026-11-20 10:00:00', 1, 100, 100, ?)`,
          [conta, s, faturavel, agora],
        );
      return {
        cid,
        itemConta: await itemConta(1),
        outroItemConta: await itemConta(2),
        usuario,
        paciente,
        cobertura,
        externo,
        duplicado,
        conta,
        faturavel,
        atendimento,
        est,
        fonte,
        motivo,
      };
    });
    porta = new PortaAutorizacaoPreviaPropria(nucleo, CLIENTE, armazemXmlMemoria());
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  it('pedido SP/SADT: rascunho, envio pelo webservice, andamento, resposta parcial e cancelamento', async () => {
    const p = await porta.criar(ctx(), {
      tipo: 'sp_sadt',
      cobertura: m.cobertura,
      conta: m.conta,
      solicitanteExterno: m.externo,
      indicacaoClinica: 'Indicação sintética',
      itens: [item({ valorUnitario: 50 }), item({ codigoProcedimento: '40302016', quantidade: 1 })],
    });
    expect(p.numero).toMatch(/^SA\d+$/);
    const s = await um('SELECT * FROM solicitacao_autorizacao WHERE id = ?', [p.id]);
    expect(s).toMatchObject({
      situacao: 'rascunho',
      numero_carteira: CARTEIRA,
      canal: 'webservice',
      enviada_em: null,
    });
    expect(Number(s['solicitante_externo_id'])).toBe(m.externo);
    const itens = await todos(
      'SELECT sequencia, quantidade_solicitada, quantidade_autorizada FROM solicitacao_autorizacao_item WHERE solicitacao_autorizacao_id = ? ORDER BY sequencia',
      [p.id],
    );
    expect(itens.map((i) => [Number(i['sequencia']), Number(i['quantidade_solicitada'])])).toEqual([
      [1, 2],
      [2, 1],
    ]);

    // Sem a configuração da fonte pagadora, o envio diz o que falta e nada muda.
    await expect(porta.enviar(ctx(), p.id, { versao: 1 })).rejects.toMatchObject(recusa);
    expect((await um('SELECT situacao FROM solicitacao_autorizacao WHERE id = ?', [p.id]))['situacao']).toBe(
      'rascunho',
    );
    const versaoExistente = await um(
      "SELECT id, descricao FROM versao_padrao_tiss WHERE codigo_tiss = '04.03.00' AND componente = 'troca'",
      [],
    );
    const descricaoPadrao = versaoExistente
      ? String(versaoExistente['descricao'])
      : 'Versão sintética f7862aut';
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `config-${P}` }, async (w) => {
      const agora = new Date();
      // A versão 04.03.00 é única por componente no banco de teste compartilhado: reaproveita a de outro teste.
      const versao =
        versaoExistente !== null
          ? Number(versaoExistente['id'])
          : await w.inserir(
              `INSERT INTO versao_padrao_tiss (codigo_tiss, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('04.03.00', 'Versão sintética f7862aut', '2026-01-01', 'sintetica', ?)`,
              [agora],
            );
      await w.inserir(
        `INSERT INTO configuracao_tiss_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, versao_padrao_tiss_id, vigencia_inicio,
                                                       registro_ans, codigo_prestador_operadora, criado_em)
         VALUES (?, ?, ?, '2026-01-01', '999999', 'HSINT7862', ?)`,
        [m.est, m.fonte, versao, agora],
      );
    });
    const env = await porta.enviar(ctx(), p.id, { versao: 1 });
    // Não há transmissão ao webservice: o XML validado fica guardado e o pedido, pronto para envio, sem enviada_em.
    expect(env.situacao).toBe('pronta_envio');
    expect(env.hash).toMatch(/^[0-9a-f]{32}$/);
    const e1 = await um(
      `SELECT sa.situacao, sa.enviada_em, sa.sequencial_transacao, sa.versao, sa.arquivo_id, v.descricao AS padrao,
              a.entidade, a.entidade_id, a.imutavel, a.tipo_mime, a.hash_sha256
         FROM solicitacao_autorizacao sa JOIN arquivo a ON a.id = sa.arquivo_id
         LEFT JOIN versao_padrao_tiss v ON v.id = sa.versao_padrao_tiss_id WHERE sa.id = ?`,
      [p.id],
    );
    expect(e1).toMatchObject({
      situacao: 'pronta_envio',
      enviada_em: null,
      sequencial_transacao: String(p.id),
      padrao: descricaoPadrao,
      entidade: 'solicitacao_autorizacao',
      tipo_mime: 'application/xml',
    });
    expect(Number(e1['entidade_id'])).toBe(p.id);
    expect(Number(e1['imutavel'])).toBe(1);
    const x = await porta.xml(ctx(), p.id);
    expect(x.xml).toContain('<ans:tipoTransacao>SOLICITACAO_PROCEDIMENTOS</ans:tipoTransacao>');
    expect(x.xml).toContain(`<ans:hash>${env.hash}</ans:hash>`);
    expect(x.sha256).toBe(e1['hash_sha256']);
    // A configuração da fonte pagadora e o solicitante mudam: o XML servido é o guardado, igual byte a byte.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `mudanca-${P}` }, async (w) => {
      await w.executar(
        "UPDATE configuracao_tiss_fonte_pagadora SET codigo_prestador_operadora = 'HSINT7862B' WHERE estabelecimento_id = ?",
        [m.est],
      );
      await w.executar("UPDATE solicitante_externo SET telefone = '1130009999' WHERE id = ?", [m.externo]);
    });
    const x2 = await porta.xml(ctx(), p.id);
    expect(x2).toEqual(x);
    expect(x2.xml).toContain('HSINT7862<');
    // Pronto para envio ainda não tem andamento; a transmissão registra o canal real e o instante.
    await expect(porta.consultarAndamento(ctx(), p.id)).rejects.toMatchObject(recusa);
    await expect(
      (async () =>
        porta.registrarTransmissao(ctx(), p.id, { versao: Number(e1['versao']), canal: 'webservice' }))(),
    ).rejects.toMatchObject({ problema: { status: 400 } });
    const tr = await porta.registrarTransmissao(ctx(), p.id, {
      versao: Number(e1['versao']),
      canal: 'portal',
    });
    expect(tr.situacao).toBe('enviada');
    const e2 = await um(
      'SELECT situacao, canal, enviada_em, sequencial_transacao, versao FROM solicitacao_autorizacao WHERE id = ?',
      [p.id],
    );
    expect(e2).toMatchObject({ situacao: 'enviada', canal: 'portal' });
    expect(e2['enviada_em']).not.toBeNull();
    expect((await porta.xml(ctx(), p.id)).xml).toBe(x.xml);
    await expect(
      porta.registrarTransmissao(ctx(), p.id, { versao: Number(e2['versao']), canal: 'portal' }),
    ).rejects.toMatchObject(recusa);

    const a1 = await porta.consultarAndamento(ctx(), p.id);
    const a2 = await porta.consultarAndamento(ctx(), p.id);
    expect([a1.tentativa, a2.tentativa]).toEqual([1, 2]);

    // Resposta com item faltando é recusada; a completa e parcial grava tudo.
    await expect(
      porta.responder(ctx(), p.id, {
        senha: 'SENHA7862',
        itens: [{ sequencia: 1, quantidadeAutorizada: 2 }],
        versao: Number(e2['versao']),
      }),
    ).rejects.toMatchObject(recusa);
    const r = await porta.responder(ctx(), p.id, {
      senha: 'SENHA7862',
      dataAutorizacao: '2026-11-24',
      senhaValidade: '2026-12-24',
      itens: [
        { sequencia: 1, quantidadeAutorizada: 2, valorAutorizado: 90 },
        {
          sequencia: 2,
          quantidadeAutorizada: 0,
          motivoGlosa: m.motivo,
          motivoNegativa: 'Sem cobertura (sintético)',
        },
      ],
      versao: Number(e2['versao']),
    });
    expect(r.situacao).toBe('autorizada_parcial');
    const ra = await um('SELECT * FROM resposta_autorizacao WHERE id = ?', [r.resposta]);
    expect(ra).toMatchObject({ situacao: 'autorizado_parcial', senha: 'SENHA7862', canal: 'portal' });
    expect(Number(ra['valor_total_autorizado'])).toBe(90);
    expect(Number(ra['registrado_por_usuario_id'])).toBe(m.usuario);
    const ri = await todos(
      'SELECT sequencia, situacao, quantidade_autorizada, valor_solicitado, valor_autorizado, motivo_glosa_id FROM resposta_autorizacao_item WHERE resposta_autorizacao_id = ? ORDER BY sequencia',
      [r.resposta],
    );
    expect(ri.map((i) => [i['situacao'], Number(i['quantidade_autorizada'])])).toEqual([
      ['autorizado', 2],
      ['negado', 0],
    ]);
    expect(Number(ri[0]!['valor_solicitado'])).toBe(100);
    expect(Number(ri[1]!['motivo_glosa_id'])).toBe(m.motivo);
    const si = await todos(
      'SELECT quantidade_autorizada FROM solicitacao_autorizacao_item WHERE solicitacao_autorizacao_id = ? ORDER BY sequencia',
      [p.id],
    );
    expect(si.map((i) => Number(i['quantidade_autorizada']))).toEqual([2, 0]);
    expect(
      (await um('SELECT senha_autorizacao FROM conta_hospitalar WHERE id = ?', [m.conta]))[
        'senha_autorizacao'
      ],
    ).toBe('SENHA7862');
    const cs = await todos(
      'SELECT tentativa, situacao, situacao_retornada, resposta_autorizacao_id FROM consulta_situacao_autorizacao WHERE solicitacao_autorizacao_id = ? ORDER BY tentativa',
      [p.id],
    );
    expect(cs.map((c) => [Number(c['tentativa']), c['situacao']])).toEqual([
      [1, 'pendente'],
      [2, 'respondida'],
    ]);
    expect(cs[1]).toMatchObject({ situacao_retornada: 'autorizada_parcialmente' });
    expect(Number(cs[1]!['resposta_autorizacao_id'])).toBe(r.resposta);

    const v = Number((await um('SELECT versao FROM solicitacao_autorizacao WHERE id = ?', [p.id]))['versao']);
    await expect(porta.responder(ctx(), p.id, { situacao: 'em_analise', versao: v })).rejects.toMatchObject(
      recusa,
    );
    await expect(porta.consultarAndamento(ctx(), p.id)).rejects.toMatchObject(recusa);
    await porta.cancelar(ctx(), p.id, { versao: v, motivo: 'Procedimento desmarcado' });
    const c = await um('SELECT situacao, observacao, excluido_em FROM solicitacao_autorizacao WHERE id = ?', [
      p.id,
    ]);
    expect(c).toMatchObject({ situacao: 'cancelada', excluido_em: null });
    expect(String(c['observacao'])).toContain('Cancelado: Procedimento desmarcado');

    // O rascunho pelo webservice cancelado antes de sair fica sem enviada_em (nada é dado como enviado).
    const rc = await porta.criar(ctx(), {
      tipo: 'sp_sadt',
      cobertura: m.cobertura,
      solicitanteExterno: m.externo,
      itens: [item({ quantidade: 1 })],
    });
    await porta.cancelar(ctx(), rc.id, { versao: 1, motivo: 'Pedido em duplicidade' });
    expect(
      await um('SELECT situacao, canal, enviada_em, arquivo_id FROM solicitacao_autorizacao WHERE id = ?', [
        rc.id,
      ]),
    ).toMatchObject({ situacao: 'cancelada', canal: 'webservice', enviada_em: null, arquivo_id: null });
    const vis = await porta.doPaciente(ctx(), m.paciente);
    expect(vis.pedidos.find((x) => x.id === p.id)).toMatchObject({
      situacao: 'cancelada',
      respostas: [{ situacao: 'autorizado_parcial' }],
    });
  });

  it('limite de OPME, pedido complementar sem guia principal e pedido pelo portal', async () => {
    const opme = (valorUnitario: number | null, faturavel: number | null = m.faturavel) => ({
      tipo: 'internacao',
      cobertura: m.cobertura,
      solicitanteExterno: m.externo,
      regime: 'hospitalar',
      diarias: 3,
      dataAdmissao: '2026-11-26',
      indicacaoClinica: 'Indicação sintética',
      diagnosticos: [{ cid: m.cid }],
      itens: [
        item({ itemFaturavel: faturavel, quantidade: 1 }),
        item({
          codigoTabela: '19',
          codigoProcedimento: '70000001',
          descricao: 'OPME sintética',
          quantidade: 2,
          valorUnitario,
          opme: true,
          registroAnvisa: '80000000001',
        }),
      ],
    });
    const msgs = async (entrada: unknown) => {
      const r = await porta.criar(ctx(), entrada).then(
        () => null,
        (x: { problema?: { status?: number; erros?: unknown } }) => x,
      );
      expect(r).toMatchObject(recusa);
      return JSON.stringify(r);
    };
    expect(await msgs(opme(800))).toMatch(/acima do limite/);
    // A OPME sem valor não passa pelo limite de valor como zero; sem o item faturável do procedimento, não há
    // conferência possível e o pedido é recusado; a guia só com OPME também.
    expect(await msgs(opme(null))).toMatch(/Informe o valor da OPME/);
    expect(await msgs(opme(400, null))).toMatch(/item faturável/);
    expect(
      await msgs({
        ...opme(400),
        tipo: 'sp_sadt',
        regime: null,
        diarias: null,
        itens: opme(400).itens.slice(1),
      }),
    ).toMatch(/procedimento além da OPME/);
    const ok = await porta.criar(ctx(), opme(400));
    const env = await porta.enviar(ctx(), ok.id, { versao: 1 });
    expect(env).toMatchObject({ situacao: 'pronta_envio' });
    expect(env.hash).toMatch(/^[0-9a-f]{32}$/);
    expect((await porta.xml(ctx(), ok.id)).xml).toContain('<ans:solicitacaoOPME>');

    await expect(
      porta.criar(ctx(), {
        tipo: 'prorrogacao',
        canal: 'portal',
        cobertura: m.cobertura,
        solicitanteExterno: m.externo,
        diarias: 2,
        itens: [item({ quantidade: 1 })],
      }),
    ).rejects.toMatchObject(recusa);
    const q = await porta.criar(ctx(), {
      tipo: 'quimioterapia',
      canal: 'portal',
      principal: ok.id,
      cobertura: m.cobertura,
      solicitanteExterno: m.externo,
      itens: [item({ quantidade: 1 })],
    });
    const eq = await porta.enviar(ctx(), q.id, { versao: 1 });
    expect(eq).toMatchObject({ situacao: 'enviada', hash: null });
    const sq = await um(
      'SELECT situacao, canal, enviada_em, sequencial_transacao, principal_solicitacao_autorizacao_id FROM solicitacao_autorizacao WHERE id = ?',
      [q.id],
    );
    expect(sq).toMatchObject({ situacao: 'enviada', canal: 'portal', sequencial_transacao: null });
    expect(Number(sq['principal_solicitacao_autorizacao_id'])).toBe(ok.id);
    await expect(porta.xml(ctx(), q.id)).rejects.toMatchObject(recusa);
    const n = await um('SELECT COUNT(*) AS n FROM solicitacao_autorizacao WHERE estabelecimento_id = ?', [
      m.est,
    ]);
    expect(Number(n['n'])).toBe(4);
  });

  it('pedido com o solicitante unificado em outro grava o cadastro que responde hoje', async () => {
    const p = await porta.criar(ctx(), {
      tipo: 'sp_sadt',
      cobertura: m.cobertura,
      solicitanteExterno: m.duplicado,
      indicacaoClinica: 'Indicação sintética',
      itens: [item({ quantidade: 1 })],
    });
    const s = await um('SELECT solicitante_externo_id FROM solicitacao_autorizacao WHERE id = ?', [p.id]);
    expect(Number(s['solicitante_externo_id'])).toBe(m.externo);
    // O duplicado fica como estava: inativo, com o ponteiro, sem pedido nenhum ligado a ele.
    expect(
      await um(
        'SELECT ativo, sucessor_solicitante_externo_id AS suc, (SELECT COUNT(*) FROM solicitacao_autorizacao WHERE solicitante_externo_id = ?) AS n FROM solicitante_externo WHERE id = ?',
        [m.duplicado, m.duplicado],
      ),
    ).toMatchObject({ ativo: 0, suc: m.externo, n: 0 });
  });

  it('internação com CID, prorrogação eletrônica e autorização ligada aos itens da conta', async () => {
    const internacao = (x: Record<string, unknown> = {}) => ({
      tipo: 'internacao',
      cobertura: m.cobertura,
      conta: m.conta,
      solicitanteExterno: m.externo,
      regime: 'hospitalar',
      diarias: 2,
      dataAdmissao: '2026-11-26',
      indicacaoClinica: 'Indicação sintética',
      diagnosticos: [{ cid: m.cid, tipoDoenca: 'aguda', tempo: 3, unidadeTempo: 'dia' }],
      itens: [item({ itemFaturavel: m.faturavel, quantidade: 2 })],
      ...x,
    });
    // Sem CID, com CID fora do catálogo ou com forma errada: recusado na hora, nada gravado.
    await expect(porta.criar(ctx(), internacao({ diagnosticos: [] }))).rejects.toMatchObject(recusa);
    await expect(porta.criar(ctx(), internacao({ diagnosticos: [{ cid: 'U999' }] }))).rejects.toMatchObject(
      recusa,
    );
    await expect(porta.criar(ctx(), internacao({ diagnosticos: [{ cid: '12' }] }))).rejects.toMatchObject(
      recusa,
    );
    const i = await porta.criar(ctx(), internacao());
    expect(
      await todos(
        `SELECT d.sequencia, d.principal, d.tipo_doenca, d.tempo_doenca, d.unidade_tempo_doenca, t.codigo_termo AS cid
           FROM solicitacao_autorizacao_diagnostico d JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
          WHERE d.solicitacao_autorizacao_id = ?`,
        [i.id],
      ),
    ).toEqual([
      expect.objectContaining({
        sequencia: 1,
        principal: 1,
        tipo_doenca: 'aguda',
        tempo_doenca: 3,
        unidade_tempo_doenca: 'dia',
        cid: m.cid,
      }),
    ]);
    await porta.enviar(ctx(), i.id, { versao: 1 });
    expect((await porta.xml(ctx(), i.id)).xml).toContain(`<ans:diagnosticoCID>${m.cid}</ans:diagnosticoCID>`);
    const vI = async () =>
      Number((await um('SELECT versao FROM solicitacao_autorizacao WHERE id = ?', [i.id]))['versao']);
    // Transmissão automática pela central de integrações externas (sem configuração: simulador, determinístico).
    const ws = await porta.transmitirWebservice(ctx(), i.id, { versao: await vI() });
    expect(ws).toMatchObject({ situacao: 'enviada', modo: 'simulador', falha: null });
    expect(ws.protocolo).toMatch(/^SIM-[0-9A-Z]{7,}$/);
    expect(
      await um(
        'SELECT situacao, canal, transmissao_modo, protocolo_transmissao, falha_transmissao, enviada_em IS NOT NULL AS saiu FROM solicitacao_autorizacao WHERE id = ?',
        [i.id],
      ),
    ).toMatchObject({
      situacao: 'enviada',
      canal: 'webservice',
      transmissao_modo: 'simulador',
      protocolo_transmissao: ws.protocolo,
      falha_transmissao: null,
      saiu: 1,
    });
    // O que já saiu não é transmitido de novo.
    await expect(porta.transmitirWebservice(ctx(), i.id, { versao: await vI() })).rejects.toMatchObject(
      recusa,
    );
    // Antes da resposta, a conta não se liga.
    await expect(porta.ligarConta(ctx(), i.id)).rejects.toMatchObject(recusa);
    await porta.responder(ctx(), i.id, {
      senha: 'SINT7862I',
      numeroGuiaOperadora: 'OPSINT7862',
      itens: [{ sequencia: 1, quantidadeAutorizada: 1 }],
      versao: await vI(),
    });
    expect(await um('SELECT situacao FROM solicitacao_autorizacao WHERE id = ?', [i.id])).toMatchObject({
      situacao: 'autorizada_parcial',
    });

    // Prorrogação pelo webservice: a guia própria, referenciando a internação pelo número que a operadora deu.
    const pr = await porta.criar(ctx(), {
      tipo: 'prorrogacao',
      principal: i.id,
      cobertura: m.cobertura,
      solicitanteExterno: m.externo,
      diarias: 3,
      indicacaoClinica: 'Evolução sintética pede mais dias',
      itens: [item({ quantidade: 1 })],
    });
    expect(await porta.enviar(ctx(), pr.id, { versao: 1 })).toMatchObject({ situacao: 'pronta_envio' });
    const xp = (await porta.xml(ctx(), pr.id)).xml;
    expect(xp).toContain('<ans:solicitacaoProrrogacao>');
    expect(xp).toContain('<ans:nrGuiaReferenciada>OPSINT7862</ans:nrGuiaReferenciada>');
    expect(xp).toContain('<ans:qtDiariasAdicionais>3</ans:qtDiariasAdicionais>');
    expect(
      await um(
        'SELECT situacao, enviada_em, arquivo_id IS NOT NULL AS xml FROM solicitacao_autorizacao WHERE id = ?',
        [pr.id],
      ),
    ).toMatchObject({ situacao: 'pronta_envio', enviada_em: null, xml: 1 });

    // A autorização parcial (1 de 2) cobre um dos dois itens lançados na conta; refazer não duplica.
    expect(await porta.ligarConta(ctx(), i.id)).toMatchObject({ ligados: 1, semCobertura: 1 });
    expect(await porta.ligarConta(ctx(), i.id)).toMatchObject({ ligados: 0, semCobertura: 1 });
    const lig = await todos(
      `SELECT cia.conta_hospitalar_item_id AS item, cia.sequencial_item_guia AS seq, cia.quantidade_coberta AS q,
              cia.guia_fonte_pagadora_id AS guia, ri.quantidade_autorizada AS aut
         FROM conta_hospitalar_item_autorizacao cia JOIN resposta_autorizacao_item ri ON ri.id = cia.resposta_autorizacao_item_id
         JOIN conta_hospitalar_item ci ON ci.id = cia.conta_hospitalar_item_id WHERE ci.conta_hospitalar_id = ?`,
      [m.conta],
    );
    expect(lig).toHaveLength(1);
    expect(lig[0]).toMatchObject({ item: m.itemConta, seq: 1, guia: null });
    expect(Number(lig[0]!['q'])).toBe(1);
    expect((await porta.detalhe(ctx(), i.id)).itensDaContaCobertos).toBe(1);
    // C2-034: a guia TISS de solicitação de internação sai do pedido gravado (CID, procedimento, carteira mascarada).
    const det = await porta.detalhe(ctx(), i.id);
    const guia = guiaSolicitacaoHtml(det);
    expect(guia).toContain('GUIA DE SOLICITAÇÃO DE INTERNAÇÃO');
    expect(guia).toContain(det.numero);
    expect(guia).toContain(det.diagnosticos[0]!.cid);
    expect(guia).toContain(det.itens[0]!.codigoProcedimento);
    if (det.carteira.length > 4) expect(guia).not.toContain(det.carteira);
  });
});
