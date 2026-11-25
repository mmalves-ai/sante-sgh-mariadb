// Contrato de efeito da autorização prévia da cirurgia eletiva por etapas (C1-117, 04-CC linha 102, F7) contra o
// MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, cobertura com carteira
// fictícia, solicitante externo fictício, dois caráteres de cirurgia (eletiva e urgência) e três agendamentos
// cirúrgicos de convênio; paciente, fonte pagadora, profissional, sala e usuário são ids já existentes (só lidos).
// Prova o que fica no banco: a guia de solicitação nasce ligada à cirurgia (agendamento_cirurgico_id) e a cirurgia de
// outro paciente é recusada; as etapas seguem as situações da guia (em preparo, aguardando a operadora, autorizada); a
// resposta autorizada leva a senha ao agendamento; a eletiva sem senha não entra no bloco (nada gravado) e, com a
// senha da resposta, entra; a exceção de urgência grava justificativa, instante e usuário no agendamento, é recusada
// na eletiva e na repetição, e libera a urgência para o bloco.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaCirurgiaPropria } from '../cirurgia/porta-propria.js';
import { PortaAutorizacaoPreviaPropria } from './autorizacao-previa-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1117aut';
const CARTEIRA = 'SINTC1117A01';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const sol = `(SELECT id FROM solicitacao_autorizacao WHERE estabelecimento_id IN ${est})`;
  const ag = `(SELECT id FROM agendamento_cirurgico WHERE estabelecimento_id IN ${est})`;
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
  await e.executar(`DELETE FROM reagendamento_cirurgico WHERE agendamento_cirurgico_id IN ${ag}`, [P]);
  await e.executar(`DELETE FROM agendamento_cirurgico WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar('DELETE FROM carater_cirurgia WHERE codigo IN (?, ?)', [`${P}-ELE`, `${P}-URG`]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM solicitante_externo WHERE numero_conselho = 'SINT1117'");
  await e.executar('DELETE FROM cobertura_paciente WHERE numero_carteira = ?', [CARTEIRA]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('autorização prévia da cirurgia eletiva por etapas (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAutorizacaoPreviaPropria;
  let cirurgia: PortaCirurgiaPropria;
  let m: {
    usuario: number;
    login: string;
    paciente: number;
    outroPaciente: number;
    cobertura: number;
    externo: number;
    est: number;
    eletiva: number;
    urgencia: number;
    outra: number;
  };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ctxCc = () => ({ cliente: CLIENTE, estabelecimento: m.est, usuario: m.usuario, correlacao: P });
  const um = async (sql: string, p: unknown[] = []) =>
    (await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)))[0]!;
  const recusa = { problema: { status: 422 } };
  const item = {
    codigoTabela: '22',
    codigoProcedimento: '30715016',
    descricao: 'Cirurgia sintética',
    quantidade: 1,
  };
  const paraBloco = async (id: number) => {
    const e = await cirurgia.estado(ctxCc(), id);
    return cirurgia.gravarSgh(
      ctxCc(),
      {
        estabelecimento: m.est,
        usuario: m.usuario,
        acao: 'alteracao' as const,
        entidade: 'agendamento_cirurgico',
        entidadeId: id,
        correlacao: P,
      },
      (g) =>
        g.mudarEstado({
          id,
          estado: 'no-bloco',
          visto: { estado: 'confirmado', versao: e!.versao ?? null },
          usuario: m.login,
        }),
    );
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const v = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await v('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const login = String(
        (await e.uma('SELECT login FROM usuario WHERE id = ?', [usuario]))?.['login'] ?? '',
      );
      const paciente = await v('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const outroPaciente = await v(
        `SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL AND id > ${paciente}`,
      );
      const fonte = await v('SELECT MIN(id) AS id FROM fonte_pagadora');
      const profissional = await v('SELECT MIN(id) AS id FROM profissional');
      const sala = await v('SELECT MIN(id) AS id FROM sala_cirurgica');
      if (!usuario || !paciente || !outroPaciente || !fonte || !profissional || !sala)
        throw new Error('O cliente de teste precisa de usuário, dois pacientes, fonte, profissional e sala.');
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
         VALUES ('Solicitante sintético', (SELECT id FROM conselho_classe WHERE codigo_tiss = '06' LIMIT 1), 'SINT1117',
                 (SELECT id FROM unidade_federativa WHERE codigo_ibge = '35' LIMIT 1),
                 (SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225125' LIMIT 1), '1130000000', ?)`,
        [agora],
      );
      const carater = (codigo: string, natureza: string) =>
        e.inserir(
          'INSERT INTO carater_cirurgia (codigo, descricao, natureza, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Caráter sintético ${codigo}`, natureza, agora],
        );
      const caraterEletiva = await carater(`${P}-ELE`, 'eletiva');
      const caraterUrgencia = await carater(`${P}-URG`, 'urgencia');
      const inicio = new Date(Date.now() + 3 * 86400000);
      const agendar = (numero: string, pac: number, car: number) =>
        e.inserir(
          `INSERT INTO agendamento_cirurgico (estabelecimento_id, numero, paciente_id, sala_cirurgica_id, cirurgiao_profissional_id,
                                              carater_cirurgia_id, tipo_cobertura, fonte_pagadora_id, solicitado_em,
                                              inicio_previsto_em, duracao_prevista_minutos, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'convenio', ?, ?, ?, 60, 'agendado', ?)`,
          [est, numero, pac, sala, profissional, car, fonte, agora, inicio, agora],
        );
      return {
        usuario,
        login,
        paciente,
        outroPaciente,
        cobertura,
        externo,
        est,
        eletiva: await agendar(`${P}-1`, paciente, caraterEletiva),
        urgencia: await agendar(`${P}-2`, paciente, caraterUrgencia),
        outra: await agendar(`${P}-3`, outroPaciente, caraterEletiva),
      };
    });
    porta = new PortaAutorizacaoPreviaPropria(nucleo, CLIENTE);
    cirurgia = new PortaCirurgiaPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  it('a guia nasce ligada à cirurgia; etapas pela situação da guia; a senha autorizada vai ao agendamento e libera o bloco', async () => {
    // A cirurgia de outro paciente não recebe a guia: nada gravado.
    await expect(
      porta.criar(ctx(), {
        tipo: 'sp_sadt',
        cobertura: m.cobertura,
        agendamentoCirurgico: m.outra,
        solicitanteExterno: m.externo,
        canal: 'portal',
        itens: [item],
      }),
    ).rejects.toMatchObject(recusa);
    expect(
      Number(
        (
          await um('SELECT COUNT(*) AS q FROM solicitacao_autorizacao WHERE agendamento_cirurgico_id = ?', [
            m.outra,
          ])
        )['q'],
      ),
    ).toBe(0);

    expect((await porta.daCirurgia(ctx(), m.eletiva)).etapa).toBe('sem_guia');
    // Sem senha, a eletiva de convênio não entra no bloco e o agendamento fica como estava.
    await expect(paraBloco(m.eletiva)).rejects.toThrow(/autorizacao-pendente/);
    expect(
      await um('SELECT situacao, versao FROM agendamento_cirurgico WHERE id = ?', [m.eletiva]),
    ).toMatchObject({
      situacao: 'agendado',
      versao: 1,
    });

    const g = await porta.criar(ctx(), {
      tipo: 'sp_sadt',
      cobertura: m.cobertura,
      agendamentoCirurgico: m.eletiva,
      solicitanteExterno: m.externo,
      canal: 'portal',
      indicacaoClinica: 'Indicação sintética',
      itens: [item],
    });
    expect(
      await um('SELECT agendamento_cirurgico_id, situacao FROM solicitacao_autorizacao WHERE id = ?', [g.id]),
    ).toMatchObject({ agendamento_cirurgico_id: m.eletiva, situacao: 'rascunho' });
    expect(await porta.detalhe(ctx(), g.id)).toMatchObject({ agendamentoCirurgico: m.eletiva });
    expect(await porta.daCirurgia(ctx(), m.eletiva)).toMatchObject({
      etapa: 'guia_em_preparo',
      guias: [{ id: g.id, situacao: 'rascunho' }],
    });
    // A visão por paciente traz a cirurgia em aberto com a etapa.
    const visao = await porta.doPaciente(ctx(), m.paciente);
    expect(visao.cirurgias.map((c) => c.id)).toEqual(expect.arrayContaining([m.eletiva, m.urgencia]));

    await porta.enviar(ctx(), g.id, { versao: 1 });
    expect((await porta.daCirurgia(ctx(), m.eletiva)).etapa).toBe('aguardando_operadora');
    await expect(paraBloco(m.eletiva)).rejects.toThrow(/aguarda a resposta da operadora/);

    const v = Number((await um('SELECT versao FROM solicitacao_autorizacao WHERE id = ?', [g.id]))['versao']);
    await porta.responder(ctx(), g.id, {
      senha: 'SENHA1117',
      dataAutorizacao: '2026-11-25',
      itens: [{ sequencia: 1, quantidadeAutorizada: 1 }],
      versao: v,
    });
    expect(
      await um('SELECT senha_autorizacao, versao FROM agendamento_cirurgico WHERE id = ?', [m.eletiva]),
    ).toMatchObject({ senha_autorizacao: 'SENHA1117', versao: 2 });
    expect(await porta.daCirurgia(ctx(), m.eletiva)).toMatchObject({
      etapa: 'autorizada',
      senha: 'SENHA1117',
    });
    await paraBloco(m.eletiva);
    expect(
      await um('SELECT situacao, autorizacao_posterior_em FROM agendamento_cirurgico WHERE id = ?', [
        m.eletiva,
      ]),
    ).toMatchObject({
      situacao: 'no_bloco',
      autorizacao_posterior_em: null,
    });
  });

  it('a exceção de urgência grava justificativa, instante e usuário; recusada na eletiva e na repetição; libera o bloco', async () => {
    const ag = Number(
      (await um('SELECT versao FROM agendamento_cirurgico WHERE id = ?', [m.outra]))['versao'],
    );
    await expect(
      porta.registrarUrgencia(ctx(), m.outra, { versao: ag, justificativa: 'Paciente pediu para adiantar' }),
    ).rejects.toMatchObject(recusa);
    await expect(paraBloco(m.urgencia)).rejects.toThrow(/justificativa-urgencia/);
    await expect(
      porta.registrarUrgencia(ctx(), m.urgencia, { versao: 1, justificativa: 'curta' }),
    ).rejects.toMatchObject(recusa);
    const r = await porta.registrarUrgencia(ctx(), m.urgencia, {
      versao: 1,
      justificativa: 'Abdome agudo com risco de perfuração',
    });
    expect(r).toMatchObject({ id: m.urgencia, etapa: 'sem_guia' });
    const a = await um(
      'SELECT autorizacao_posterior_justificativa, autorizacao_posterior_em, autorizacao_posterior_por, versao FROM agendamento_cirurgico WHERE id = ?',
      [m.urgencia],
    );
    expect(a).toMatchObject({
      autorizacao_posterior_justificativa: 'Abdome agudo com risco de perfuração',
      autorizacao_posterior_por: m.usuario,
      versao: 2,
    });
    expect(a['autorizacao_posterior_em']).not.toBeNull();
    expect((await porta.daCirurgia(ctx(), m.urgencia)).autorizacaoPosterior).toMatchObject({
      justificativa: 'Abdome agudo com risco de perfuração',
    });
    await expect(
      porta.registrarUrgencia(ctx(), m.urgencia, { versao: 2, justificativa: 'Abdome agudo outra vez' }),
    ).rejects.toMatchObject(recusa);
    await paraBloco(m.urgencia);
    expect(
      (await um('SELECT situacao FROM agendamento_cirurgico WHERE id = ?', [m.urgencia]))['situacao'],
    ).toBe('no_bloco');
    // A trilha da exceção fica na mesma transação, na tabela gravada.
    expect(
      Number(
        (
          await um(
            "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'agendamento_cirurgico' AND entidade_id = ?",
            [m.urgencia],
          )
        )['q'],
      ),
    ).toBeGreaterThan(0);
  });
});
