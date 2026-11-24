// Contrato de efeito da autorização prévia à operadora (F78.06-2, 06-FAT L25 e L27) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste, cobertura com carteira fictícia, solicitante externo,
// configuração da fonte pagadora com registro e código fictícios, uma conta sintética e um limite de OPME; paciente,
// atendimento, fonte pagadora, item faturável, catálogos e usuário são ids já existentes (só lidos, nunca alterados).
// Prova o que fica no banco: o pedido em rascunho com número, carteira e itens; o envio recusado com a lista do que
// falta e, configurado, enviado com o sequencial (XML válido no XSD, remontável); as consultas de andamento por
// tentativa; a resposta parcial por item (resposta e itens, quantidade autorizada no pedido, senha na conta, consulta
// respondida); a resposta repetida recusada; o cancelamento com o motivo; o limite de OPME e o pedido complementar
// sem guia principal recusados; o pedido pelo portal enviado sem XML.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaAutorizacaoPreviaPropria } from './autorizacao-previa-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f7862aut';
const CARTEIRA = 'SINTF7862A01';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const sol = `(SELECT id FROM solicitacao_autorizacao WHERE estabelecimento_id IN ${est})`;
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
  await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM limite_opme_procedimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM configuracao_tiss_fonte_pagadora WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM versao_padrao_tiss WHERE descricao = 'Versão sintética f7862aut'");
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
    conta: number;
    faturavel: number;
    atendimento: number;
    est: number;
    fonte: number;
    motivo: number;
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
      return { usuario, paciente, cobertura, externo, conta, faturavel, atendimento, est, fonte, motivo };
    });
    porta = new PortaAutorizacaoPreviaPropria(nucleo, CLIENTE);
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
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `config-${P}` }, async (w) => {
      const agora = new Date();
      const versao = await w.inserir(
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
    expect(env.situacao).toBe('enviada');
    expect(env.hash).toMatch(/^[0-9a-f]{32}$/);
    const e2 = await um(
      'SELECT situacao, enviada_em, sequencial_transacao, versao FROM solicitacao_autorizacao WHERE id = ?',
      [p.id],
    );
    expect(e2['enviada_em']).not.toBeNull();
    expect(e2['sequencial_transacao']).toBe(String(p.id));
    const x = await porta.xml(ctx(), p.id);
    expect(x.xml).toContain('<ans:tipoTransacao>SOLICITACAO_PROCEDIMENTOS</ans:tipoTransacao>');
    expect(x.xml).toContain(`<ans:hash>${env.hash}</ans:hash>`);

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
    const vis = await porta.doPaciente(ctx(), m.paciente);
    expect(vis.pedidos.find((x) => x.id === p.id)).toMatchObject({
      situacao: 'cancelada',
      respostas: [{ situacao: 'autorizado_parcial' }],
    });
  });

  it('limite de OPME, pedido complementar sem guia principal e pedido pelo portal', async () => {
    const opme = (valorUnitario: number) => ({
      tipo: 'internacao',
      cobertura: m.cobertura,
      solicitanteExterno: m.externo,
      regime: 'hospitalar',
      diarias: 3,
      dataAdmissao: '2026-11-26',
      indicacaoClinica: 'Indicação sintética',
      itens: [
        item({ itemFaturavel: m.faturavel, quantidade: 1 }),
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
    await expect(porta.criar(ctx(), opme(800))).rejects.toMatchObject(recusa);
    const ok = await porta.criar(ctx(), opme(400));
    const env = await porta.enviar(ctx(), ok.id, { versao: 1 });
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
    expect(Number(n['n'])).toBe(3);
  });
});
