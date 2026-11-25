// Contrato de efeito da F3.9-6 contra o MariaDB real (cliente de teste): mensagens ao paciente pela Hal-AI (L133),
// pacotes de parceiros e entregas agendadas (L134) e classificação de risco externa (L140). Massa SINTÉTICA:
// estabelecimento com o código do teste, consentimento, categoria de pronto atendimento e atendimentos fictícios
// (chaves desligadas só no preparo), sistema de triagem e parceiro fictícios; usuário e paciente são ids já existentes
// do cliente de teste (só lidos). Prova o que fica no banco: modelo, regra, pedido com o momento e o texto montados,
// limite, cancelamento sem apagar, retornos em sequência com a situação avançando e o descadastro bloqueando o canal;
// pacote com campos (o tirado fica excluído), entrega devida pela agenda, nada devido depois, transições; perfis,
// recebida idempotente, rejeitada com motivo e substituição pela mais nova. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaClassificacaoExternaPropria } from './classificacao-externa-propria.js';
import { PortaMensagensPacientePropria } from './mensagens-paciente-propria.js';
import { PortaPacotesParceiroPropria } from './pacotes-parceiro-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'f396cpt';
/** Segundo estabelecimento (fuso de Manaus): isolamento e fuso. */
const P2 = 'f396cp2';
const E = [P, P2];
const NOME_PAC = 'f396 Paciente sintético';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  await e.executar(
    `DELETE t FROM pedido_mensagem_paciente_retorno t JOIN pedido_mensagem_paciente q
        ON q.id = t.pedido_mensagem_paciente_id WHERE q.estabelecimento_id IN ${est}`,
    E,
  );
  await e.executar(`DELETE FROM pedido_mensagem_paciente WHERE estabelecimento_id IN ${est}`, E);
  await e.executar(`DELETE FROM regra_envio_mensagem_paciente WHERE estabelecimento_id IN ${est}`, E);
  await e.executar(`DELETE FROM modelo_mensagem_paciente WHERE estabelecimento_id IN ${est}`, E);
  await e.executar(`DELETE FROM consentimento_titular WHERE estabelecimento_id IN ${est}`, E);
  await e.executar(`DELETE FROM classificacao_externa_recebida WHERE estabelecimento_id IN ${est}`, E);
  await e.executar(
    `UPDATE classificacao_risco SET anterior_classificacao_risco_id = NULL WHERE estabelecimento_id IN ${est}`,
    E,
  );
  await e.executar(`DELETE FROM classificacao_risco WHERE estabelecimento_id IN ${est}`, E);
  const prot =
    "(SELECT x.id FROM (SELECT id FROM protocolo_classificacao_risco WHERE codigo = 'f396-prot') x)";
  await e.executar(
    `DELETE FROM protocolo_classificacao_estabelecimento WHERE protocolo_classificacao_risco_id IN ${prot}`,
  );
  await e.executar(
    `DELETE FROM protocolo_classificacao_risco_versao WHERE protocolo_classificacao_risco_id IN ${prot}`,
  );
  await e.executar("DELETE FROM protocolo_classificacao_risco WHERE codigo = 'f396-prot'");
  await e.executar("DELETE FROM perfil_prioridade_externa WHERE codigo LIKE 'f396-%'");
  await e.executar("DELETE FROM sistema_externo WHERE codigo = 'f396-tri'");
  const pac =
    "(SELECT x.id FROM (SELECT p.id FROM pacote_parceiro p JOIN parceiro_dados d ON d.id = p.parceiro_dados_id WHERE d.codigo = 'f396-par') x)";
  await e.executar(`DELETE FROM entrega_pacote_parceiro WHERE pacote_parceiro_id IN ${pac}`);
  await e.executar(`DELETE FROM pacote_parceiro_campo WHERE pacote_parceiro_id IN ${pac}`);
  await e.executar(`DELETE FROM pacote_parceiro WHERE id IN ${pac}`);
  await e.executar("DELETE FROM parceiro_dados WHERE codigo = 'f396-par'");
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, E);
  await e.executar("DELETE FROM categoria_atendimento WHERE codigo IN ('f396-pa','f396-amb')");
  const pf = '(SELECT x.id FROM (SELECT id FROM pessoa_fisica WHERE nome = ?) x)';
  await e.executar(`DELETE FROM telefone_pessoa WHERE pessoa_fisica_id IN ${pf}`, [NOME_PAC]);
  await e.executar(`DELETE FROM email_pessoa WHERE pessoa_fisica_id IN ${pf}`, [NOME_PAC]);
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN ${pf}`, [NOME_PAC]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome = ?', [NOME_PAC]);
  await limparTrilhaDaMassa(e, { codigos: E });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', E);
}

describe.skipIf(SEM_BANCO)('F3.9-6 contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let msg: PortaMensagensPacientePropria;
  let pac: PortaPacotesParceiroPropria;
  let cla: PortaClassificacaoExternaPropria;
  let m: {
    est: number;
    est2: number;
    usuario: number;
    paciente: number;
    atdPa: number;
    atdAmb: number;
    prof: number;
  };
  const ctx = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P, hospital: P });
  const ctx2 = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P2, hospital: P2 });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as { problema?: { status?: number; codigo?: string } }).problema ?? {};
    }
    throw new Error('Era para recusar.');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const prof = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      if (!usuario?.['id'] || !prof?.['id'])
        throw new Error('O cliente de teste precisa de usuário e profissional.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      const est2 = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Manaus', 'Hospital sintético 2 (fictício)', 'America/Manaus', ?)`,
        [P2, agora],
      );
      const pa = await e.inserir(
        `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em)
         VALUES ('f396-pa', 'PA (teste)', 'pronto_atendimento', ?)`,
        [agora],
      );
      const amb = await e.inserir(
        `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em)
         VALUES ('f396-amb', 'Ambulatório (teste)', 'ambulatorio', ?)`,
        [agora],
      );
      await e.executar(
        `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES ('f396-tri', 'Triagem (teste)', 'triagem', 'Classificação de risco (teste)', ?)`,
        [agora],
      );
      await e.executar(
        `INSERT INTO protocolo_classificacao_risco (codigo, nome, tipo, situacao, criado_em)
         VALUES ('f396-prot', 'Protocolo (teste)', 'institucional', 'publicado', ?)`,
        [agora],
      );
      const prot = await e.uma("SELECT id FROM protocolo_classificacao_risco WHERE codigo = 'f396-prot'");
      await e.executar(
        `INSERT INTO protocolo_classificacao_risco_versao (protocolo_classificacao_risco_id, operacao, dados, ocorrido_em,
           numero_versao, vigencia_inicio, motivo_publicacao, publicado_por_usuario_id, criado_em)
         VALUES (?, 'inclusao', '{}', ?, '1.0', ?, 'Teste', ?, ?)`,
        [prot!['id'], agora, new Date(agora.getTime() - 86_400_000), usuario['id'], agora],
      );
      await e.executar(
        `INSERT INTO protocolo_classificacao_estabelecimento (protocolo_classificacao_risco_id, estabelecimento_id,
           vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)`,
        [prot!['id'], est, new Date(agora.getTime() - 86_400_000), agora],
      );
      await e.executar(
        `INSERT INTO parceiro_dados (codigo, nome, tipo, finalidade, base_legal, criado_em)
         VALUES ('f396-par', 'Parceiro (teste)', 'arquivo', 'Indicadores de UTI (teste)', 'execucao-de-contrato', ?)`,
        [agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        // Paciente SINTÉTICO, com os contatos do cadastro: um telefone principal com aceite de mensagem e aplicativo,
        // um sem aceite e um e-mail com aceite.
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          NOME_PAC,
          agora,
        ]);
        const pront = await e.uma('SELECT COALESCE(MAX(numero_prontuario), 0) + 1 AS n FROM paciente');
        const paciente = {
          id: await e.inserir(
            'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
            [pf, pront!['n'], agora],
          ),
        };
        const fone = (seq: number, numero: string, aceita: boolean, principal: boolean) =>
          e.executar(
            `INSERT INTO telefone_pessoa (pessoa_fisica_id, sequencia, tipo_telefone_id, ddd, numero, principal,
               aceita_mensagem, aceita_mensagem_em, usa_aplicativo_mensagem, criado_em)
             VALUES (?, ?, 1, '11', ?, ?, ?, ?, TRUE, ?)`,
            [pf, seq, numero, principal, aceita, aceita ? agora : null, agora],
          );
        await fone(1, '999990000', true, true);
        await fone(2, '988887777', false, false);
        await e.executar(
          `INSERT INTO email_pessoa (pessoa_fisica_id, sequencia, email, principal, aceita_comunicacao, criado_em)
           VALUES (?, 1, 'paciente.f396@exemplo.invalid', TRUE, TRUE, ?)`,
          [pf, agora],
        );
        await e.executar(
          `INSERT INTO consentimento_titular (estabelecimento_id, numero, tipo_termo_lgpd_id, paciente_id, finalidade,
             situacao, emitido_em, autorizado_em, criado_em)
           VALUES (?, ?, 1, ?, 'Comunicação (teste)', 'autorizado', ?, ?, ?)`,
          [est, `${P}-1`, paciente['id'], agora, agora, agora],
        );
        const atd = (cat: number, n: string) =>
          e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
             VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`,
            [est, `${P}-${n}`, paciente['id'], cat, prof['id'], new Date(agora.getTime() - 3_600_000), agora],
          );
        return {
          est,
          est2,
          usuario: Number(usuario['id']),
          paciente: Number(paciente['id']),
          atdPa: await atd(pa, 'pa'),
          atdAmb: await atd(amb, 'amb'),
          prof: Number(prof['id']),
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    msg = new PortaMensagensPacientePropria(nucleo, CLIENTE);
    pac = new PortaPacotesParceiroPropria(nucleo, CLIENTE);
    cla = new PortaClassificacaoExternaPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  }, 120_000);

  it('L133: modelo, regra, pedido registrado, limite, cancelamento, retornos e descadastro', async () => {
    const modelo = await msg.gravarModelo(ctx(), {
      codigo: 'conf',
      descricao: 'Confirmação da consulta',
      finalidade: 'confirmacao',
      canal: 'whatsapp',
      corpo: '{{estabelecimento}}: confirma a consulta de {{data}} às {{hora}}? Responda SIM ou NAO.',
      respostaConfirmacao: 'SIM',
      respostaRecusa: 'NAO',
    });
    expect(
      (
        await erro(
          msg.gravarModelo(ctx(), {
            codigo: 'conf',
            descricao: 'x',
            finalidade: 'confirmacao',
            canal: 'whatsapp',
            corpo: 'x',
            respostaConfirmacao: 'SIM',
            respostaRecusa: 'NAO',
          }),
        )
      ).codigo,
    ).toBe('conflito-versao');
    expect(
      (
        await erro(
          msg.gravarRegra(ctx(), {
            codigo: 'r0',
            descricao: 'Lembrete',
            modeloId: modelo.id,
            gatilho: 'lembrete_agendamento',
            antecedenciaMinutos: 60,
          }),
        )
      ).codigo,
    ).toBe('finalidade-incompativel');
    const regra = await msg.gravarRegra(ctx(), {
      codigo: 'conf-24h',
      descricao: 'Confirmação 24 h antes',
      modeloId: modelo.id,
      gatilho: 'confirmacao_agendamento',
      antecedenciaMinutos: 1440,
      horaInicio: '08:00',
      horaFim: '20:00',
      maximoEnviosPaciente: 2,
    });
    const r = (
      await ler('SELECT canal, exige_consentimento FROM regra_envio_mensagem_paciente WHERE id = ?', [
        regra.id,
      ])
    )[0]!;
    expect(r).toMatchObject({ canal: 'whatsapp' });

    const agora = new Date();
    const consulta = new Date(agora.getTime() + 3 * 86_400_000);
    consulta.setUTCHours(17, 0, 0, 0); // 14:00 em Brasília
    const entrada = (x: Record<string, unknown> = {}) => ({
      regraId: regra.id,
      pacienteId: m.paciente,
      destino: '11999990000',
      referenciaEm: consulta.toISOString(),
      valores: { data: '01/12', hora: '14:00' },
      entidade: 'agendamento',
      entidadeId: 1,
      ...x,
    });
    expect((await erro(msg.pedir(ctx(), entrada({ valores: { data: '01/12' } })))).codigo).toBe(
      'variavel-sem-valor',
    );
    expect((await erro(msg.pedir(ctx(), entrada({ destino: '123' })))).codigo).toBe('destino-invalido');
    // Destino de fora do cadastro do paciente: recusado (não vaza dado do atendimento a terceiro).
    expect((await erro(msg.pedir(ctx(), entrada({ destino: '21911112222' })))).codigo).toBe(
      'destino-fora-do-cadastro',
    );
    // O paciente tem um termo autorizado de outra finalidade, mas o telefone não tem o aceite de mensagem: recusado.
    expect((await erro(msg.pedir(ctx(), entrada({ destino: '11988887777' })))).codigo).toBe(
      'sem-consentimento',
    );
    // O modelo do cliente inteiro só pela rota de alcance do cliente.
    expect(
      (
        await erro(
          msg.gravarModelo(ctx(), {
            doCliente: true,
            codigo: 'f396-cli',
            descricao: 'Do cliente',
            finalidade: 'aviso',
            canal: 'sms',
            corpo: 'Aviso',
          }),
        )
      ).codigo,
    ).toBe('alcance-do-cliente');
    const p1 = await msg.pedir(ctx(), entrada(), agora);
    expect(p1.agendadoPara).toBe(new Date(consulta.getTime() - 86_400_000).toISOString());
    const q = (
      await ler(
        `SELECT situacao, motivo_envio, canal, conteudo, modelo_mensagem_paciente_id AS modelo, solicitante_usuario_id AS u
         FROM pedido_mensagem_paciente WHERE id = ?`,
        [p1.id],
      )
    )[0]!;
    expect(q).toMatchObject({
      situacao: 'pendente',
      motivo_envio: 'confirmacao',
      canal: 'whatsapp',
      u: m.usuario,
    });
    expect(String(q['conteudo'])).toContain('Hospital Teste: confirma a consulta de 01/12 às 14:00?');

    // Sem destino: o contato do canal com consentimento, do cadastro.
    const p2 = await msg.pedir(ctx(), entrada({ destino: null }), agora);
    expect(
      (await ler('SELECT destino FROM pedido_mensagem_paciente WHERE id = ?', [p2.id]))[0],
    ).toMatchObject({
      destino: '11999990000',
    });
    expect((await erro(msg.pedir(ctx(), entrada(), agora))).codigo).toBe('limite-atingido');
    await msg.cancelar(ctx(), p2.id, 'Consulta remarcada');
    expect(
      (
        await ler('SELECT situacao, motivo_cancelamento FROM pedido_mensagem_paciente WHERE id = ?', [p2.id])
      )[0],
    ).toMatchObject({ situacao: 'cancelado', motivo_cancelamento: 'Consulta remarcada' });

    await msg.marcarEnviado(ctx(), p1.id, 'hal-123');
    expect((await erro(msg.cancelar(ctx(), p1.id, 'tarde'))).codigo).toBe('pedido-ja-enviado');
    await msg.registrarRetorno(ctx(), p1.id, { tipo: 'leitura' });
    await msg.registrarRetorno(ctx(), p1.id, { tipo: 'entrega' });
    const resp = await msg.registrarRetorno(ctx(), p1.id, { tipo: 'resposta', respostaTexto: ' sim ' });
    expect(resp).toMatchObject({ situacao: 'respondido', respostaInterpretada: 'confirmado' });
    const rets = await ler(
      'SELECT sequencia, tipo, resposta_interpretada FROM pedido_mensagem_paciente_retorno WHERE pedido_mensagem_paciente_id = ? ORDER BY sequencia',
      [p1.id],
    );
    expect(rets.map((x) => [Number(x['sequencia']), x['tipo']])).toEqual([
      [1, 'leitura'],
      [2, 'entrega'],
      [3, 'resposta'],
    ]);
    const fim = (
      await ler(
        'SELECT situacao, identificador_externo, enviado_em, lido_em FROM pedido_mensagem_paciente WHERE id = ?',
        [p1.id],
      )
    )[0]!;
    expect(fim['situacao']).toBe('respondido');
    expect(fim['identificador_externo']).toBe('hal-123');
    expect(fim['enviado_em']).not.toBeNull();
    expect(fim['lido_em']).not.toBeNull();

    await msg.registrarRetorno(ctx(), p1.id, { tipo: 'descadastro' });
    await msg.gravarRegra(ctx(), {
      id: regra.id,
      versao: 1,
      codigo: 'conf-24h',
      descricao: 'Confirmação 24 h antes',
      modeloId: modelo.id,
      gatilho: 'confirmacao_agendamento',
      antecedenciaMinutos: 1440,
      horaInicio: '08:00',
      horaFim: '20:00',
      maximoEnviosPaciente: 10,
    });
    expect((await erro(msg.pedir(ctx(), entrada(), agora))).codigo).toBe('descadastrado');

    const visao = await msg.doPaciente(ctx(), m.paciente);
    expect(visao.map((x) => x.situacao).sort()).toEqual(['cancelado', 'respondido']);
    expect(visao.find((x) => x.id === p1.id)!.retornos.map((x) => x.tipo)).toEqual([
      'leitura',
      'entrega',
      'resposta',
      'descadastro',
    ]);
  }, 120_000);

  it('L133: aviso sem evento fora do horário vai para a próxima abertura, no fuso de cada estabelecimento; isolamento', async () => {
    const regraSms = async (c: () => ReturnType<typeof ctx>, cod: string) => {
      const mo = await msg.gravarModelo(c(), {
        codigo: cod,
        descricao: 'Resultado disponível',
        finalidade: 'resultado_disponivel',
        canal: 'sms',
        corpo: '{{estabelecimento}}: o seu resultado está disponível.',
      });
      return msg.gravarRegra(c(), {
        codigo: cod,
        descricao: 'Resultado liberado',
        modeloId: mo.id,
        gatilho: 'resultado_liberado',
        horaInicio: '08:00',
        horaFim: '20:00',
      });
    };
    const r1 = await regraSms(ctx, 'res1');
    const r2 = await regraSms(ctx2, 'res2');
    // 23:30Z = 20:30 em Brasília (fora do horário) e 19:30 em Manaus (dentro).
    const t = new Date('2026-12-01T23:30:00Z');
    const pedido = (regraId: number) => ({
      regraId,
      pacienteId: m.paciente,
      entidade: 'resultado',
      entidadeId: 1,
    });
    const a = await msg.pedir(ctx(), pedido(r1.id), t);
    expect(a.agendadoPara).toBe('2026-12-02T11:00:00.000Z');
    const b = await msg.pedir(ctx2(), pedido(r2.id), t);
    expect(b.agendadoPara).toBe(t.toISOString());
    const linhas = await ler(
      'SELECT id, estabelecimento_id AS e, agendado_para, situacao FROM pedido_mensagem_paciente WHERE id IN (?, ?) ORDER BY id',
      [a.id, b.id],
    );
    expect(linhas.map((x) => [Number(x['e']), x['situacao']])).toEqual([
      [m.est, 'pendente'],
      [m.est2, 'pendente'],
    ]);
    // Isolamento: o segundo estabelecimento não enxerga nem mexe no pedido do primeiro.
    expect((await msg.doPaciente(ctx2(), m.paciente)).map((x) => x.id)).toEqual([b.id]);
    expect((await erro(msg.cancelar(ctx2(), a.id, 'outro hospital'))).status).toBe(404);
    expect((await erro(msg.registrarRetorno(ctx2(), a.id, { tipo: 'entrega' }))).status).toBe(404);
    expect((await erro(msg.marcarEnviado(ctx2(), a.id, 'x'))).status).toBe(404);
    expect((await erro(msg.pedir(ctx2(), pedido(r1.id), t))).status).toBe(404);
    expect(await cla.doAtendimento(ctx2(), m.atdPa)).toEqual([]);
    expect(
      (await ler('SELECT situacao FROM pedido_mensagem_paciente WHERE id = ?', [a.id]))[0],
    ).toMatchObject({
      situacao: 'pendente',
    });
  }, 120_000);

  it('L134: pacote com campos, entrega devida pela agenda, nada devido depois, transições', async () => {
    const campo = (s: number, c: string, x: Record<string, unknown> = {}) => ({
      sequencia: s,
      entidade: 'internacao',
      campo: c,
      rotuloSaida: c,
      justificativa: 'Cálculo dos índices de UTI do parceiro',
      ...x,
    });
    const base = {
      parceiroCodigo: 'f396-par',
      codigo: 'uti',
      nome: 'Índices de UTI',
      conteudo: 'Internações em UTI do período',
      formato: 'csv',
      meioEntrega: 'sftp',
      periodicidade: 'diaria',
      agenda: '02:00',
      anonimizacao: 'pseudonimizada',
    };
    expect(
      (await erro(pac.gravarPacote(ctx(), { ...base, campos: [campo(1, 'nome', { dadoSensivel: true })] })))
        .codigo,
    ).toBe('sensivel-sem-tratamento');
    const { id } = await pac.gravarPacote(ctx(), {
      ...base,
      campos: [campo(1, 'entrada'), campo(2, 'saida'), campo(3, 'leito')],
    });
    await pac.gravarPacote(ctx(), {
      ...base,
      id,
      versao: 1,
      campos: [campo(1, 'saida'), campo(2, 'entrada')],
    });
    const cs = await ler(
      'SELECT campo, sequencia, excluido_em FROM pacote_parceiro_campo WHERE pacote_parceiro_id = ? ORDER BY campo',
      [id],
    );
    expect(
      cs.map((x) => [x['campo'], x['excluido_em'] === null ? Number(x['sequencia']) : 'excluido']),
    ).toEqual([
      ['entrada', 2],
      ['leito', 'excluido'],
      ['saida', 1],
    ]);
    const pk = (
      await ler('SELECT revisado_em, proxima_revisao_em, versao FROM pacote_parceiro WHERE id = ?', [id])
    )[0]!;
    // Gravar não revisa: sem o ato de revisão, a entrega é recusada.
    expect(pk['revisado_em']).toBeNull();
    expect(Number(pk['versao'])).toBe(2);
    const agora = new Date();
    expect((await erro(pac.registrarEntrega(ctx(), id, { quantidadeRegistros: 1 }, agora))).codigo).toBe(
      'sem-revisao',
    );
    const rev = await pac.revisarPacote(ctx(), id, 2, agora);
    const pr = (
      await ler(
        'SELECT revisado_em, revisado_por_usuario_id AS u, proxima_revisao_em, versao FROM pacote_parceiro WHERE id = ?',
        [id],
      )
    )[0]!;
    expect(pr['revisado_em']).not.toBeNull();
    expect(Number(pr['u'])).toBe(m.usuario);
    // Uma troca de nome depois da revisão não mexe na data de vencimento.
    await pac.gravarPacote(ctx(), {
      ...base,
      nome: 'Índices de UTI (novo nome)',
      id,
      versao: Number(pr['versao']),
      campos: [campo(1, 'saida'), campo(2, 'entrada')],
    });
    const depois = (
      await ler('SELECT revisado_em, proxima_revisao_em FROM pacote_parceiro WHERE id = ?', [id])
    )[0]!;
    expect(String(depois['proxima_revisao_em'])).toBe(String(pr['proxima_revisao_em']));
    expect(String(depois['revisado_em'])).toBe(String(pr['revisado_em']));
    expect(rev.proximaRevisao).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const e1 = await pac.registrarEntrega(
      ctx(),
      id,
      { quantidadeRegistros: 12, tamanhoBytes: 900, hashSha256: 'a'.repeat(64) },
      agora,
    );
    expect(new Date(e1.periodoFim).getTime()).toBeLessThanOrEqual(agora.getTime());
    expect(new Date(e1.periodoFim).getTime() - new Date(e1.periodoInicio).getTime()).toBe(86_400_000);
    expect((await erro(pac.registrarEntrega(ctx(), id, { quantidadeRegistros: 1 }, agora))).codigo).toBe(
      'nada-devido',
    );
    expect(
      (await erro(pac.mudarEntrega(ctx(), e1.id, { situacao: 'confirmada', protocolo: 'X' }))).codigo,
    ).toBe('transicao-invalida');
    await pac.mudarEntrega(ctx(), e1.id, { situacao: 'enviada' });
    expect((await erro(pac.mudarEntrega(ctx(), e1.id, { situacao: 'confirmada' }))).codigo).toBe(
      'protocolo-obrigatorio',
    );
    await pac.mudarEntrega(ctx(), e1.id, { situacao: 'confirmada', protocolo: 'PROT-1' });
    const en = (
      await ler(
        'SELECT situacao, quantidade_registros, hash_sha256, enviado_em, confirmado_em, protocolo_confirmacao, usuario_id FROM entrega_pacote_parceiro WHERE id = ?',
        [e1.id],
      )
    )[0]!;
    expect(en).toMatchObject({
      situacao: 'confirmada',
      protocolo_confirmacao: 'PROT-1',
      usuario_id: m.usuario,
    });
    expect(Number(en['quantidade_registros'])).toBe(12);
    expect(en['enviado_em']).not.toBeNull();
    const lista = await pac.pacotes(ctx(), agora);
    const lido = lista.find((x) => x.id === id)!;
    expect(lido.campos.map((x) => x.campo)).toEqual(['saida', 'entrada']);
    expect(lido.ultimaEntrega).toMatchObject({ id: e1.id, situacao: 'confirmada' });
    expect(lido.proximaDevida).toBeNull();
    expect(lido.revisaoVencida).toBe(false);
    // A entrega registrada à mão não tem arquivo guardado: a lista diz, e o download recusa com o motivo.
    const hist = await pac.entregas(ctx(), id);
    expect(hist.find((x) => x.id === e1.id)).toMatchObject({ arquivoId: null, situacao: 'confirmada' });
    const semArq = await erro(pac.arquivoDaEntrega(ctx(), e1.id));
    expect(semArq).toMatchObject({ status: 404, codigo: 'entrega-sem-arquivo' });
    expect((await erro(pac.arquivoDaEntrega(ctx(), 2_000_000_000))).status).toBe(404);
  }, 120_000);

  it('L140: perfis enviados, recebida idempotente, rejeitada com motivo e substituição pela mais nova', async () => {
    await cla.gravarPerfil(ctx(), {
      codigo: 'f396-gest',
      descricao: 'Gestante',
      sistemaCodigo: 'f396-tri',
      codigoExterno: 'G',
      condicaoPreferencial: 'gestante',
      ordemPrioridade: 2,
    });
    await cla.gravarPerfil(ctx(), {
      codigo: 'f396-ido',
      descricao: 'Idoso',
      sistemaCodigo: 'f396-tri',
      codigoExterno: 'I',
      condicaoPreferencial: 'idoso',
      ordemPrioridade: 1,
    });
    expect(
      (await erro(cla.gravarPerfil(ctx(), { codigo: 'f396-x', descricao: 'X', codigoExterno: 'X' }))).codigo,
    ).toBe('sistema-obrigatorio');
    const envio = (await cla.perfisParaSistema(ctx(), 'f396-tri')).filter(
      (x) => x.codigo === 'G' || x.codigo === 'I',
    );
    expect(envio.map((x) => x.codigo)).toEqual(['I', 'G']);

    const agora = new Date();
    const rec = (id: string, minutosAtras: number, atd = m.atdPa) => ({
      sistemaCodigo: 'f396-tri',
      atendimentoId: atd,
      identificadorExterno: id,
      codigoPrioridade: 'AMARELO',
      cor: 'amarelo',
      tempoAlvoMinutos: 60,
      perfilCodigoExterno: 'G',
      classificadoEm: new Date(agora.getTime() - minutosAtras * 60_000).toISOString(),
    });
    const a = await cla.receber(ctx(), rec('T-1', 30), agora);
    expect(a).toMatchObject({ situacao: 'recebida', repetida: false });
    expect(await cla.receber(ctx(), rec('T-1', 30), agora)).toMatchObject({ id: a.id, repetida: true });
    const b = await cla.receber(ctx(), rec('T-2', 10), agora);
    expect(b.situacao).toBe('recebida');
    const atrasada = await cla.receber(ctx(), rec('T-0', 40), agora);
    expect(atrasada.situacao).toBe('substituida');
    const rej = await cla.receber(ctx(), rec('T-amb', 10, m.atdAmb), agora);
    expect(rej).toMatchObject({ situacao: 'rejeitada', motivos: ['nao-pronto-atendimento'] });

    const rows = await ler(
      `SELECT identificador_externo AS i, situacao, motivo_rejeicao, perfil_prioridade_externa_id AS perfil, origem
         FROM classificacao_externa_recebida WHERE estabelecimento_id = ? ORDER BY identificador_externo`,
      [m.est],
    );
    expect(rows.map((x) => [x['i'], x['situacao']])).toEqual([
      ['T-0', 'substituida'],
      ['T-1', 'substituida'],
      ['T-2', 'recebida'],
      ['T-amb', 'rejeitada'],
    ]);
    expect(rows.every((x) => x['perfil'] !== null && x['origem'] === 'integracao')).toBe(true);
    expect(String(rows[3]!['motivo_rejeicao'])).toContain('pronto atendimento');
    const visao = await cla.doAtendimento(ctx(), m.atdPa);
    expect(visao[0]).toMatchObject({ identificadorExterno: 'T-2', situacao: 'recebida', perfil: 'Gestante' });
    expect(
      new Date(visao[0]!.prazoAtendimento!).getTime() - new Date(visao[0]!.classificadoEm).getTime(),
    ).toBe(3_600_000);

    // Aplicação: a rejeitada não vira classificação interna; a vigente vira, com o classificador identificado.
    expect((await erro(cla.aplicar(ctx(), rej.id))).codigo).toBe('nao-vigente');
    expect((await erro(cla.aplicar(ctx2(), b.id))).status).toBe(404);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, (e) =>
      e.executar('UPDATE classificacao_externa_recebida SET profissional_id = ? WHERE id IN (?, ?)', [
        m.prof,
        b.id,
        a.id,
      ]),
    );
    const ap = await cla.aplicar(ctx(), b.id);
    expect(ap.reclassificou).toBeNull();
    expect((await erro(cla.aplicar(ctx(), b.id))).codigo).toBe('nao-vigente');
    const [interna] = await ler(
      `SELECT c.situacao, c.origem, c.tempo_alvo_minutos AS t, n.codigo AS cor, c.classificador_profissional_id AS prof,
              TIMESTAMPDIFF(MINUTE, c.classificado_em, c.prazo_atendimento_em) AS prazo, c.paciente_id AS pac,
              r.situacao AS sr, r.classificacao_risco_id AS liga
         FROM classificacao_risco c JOIN nivel_prioridade n ON n.id = c.nivel_prioridade_id
         JOIN classificacao_externa_recebida r ON r.id = ?
        WHERE c.id = ?`,
      [b.id, ap.classificacaoRiscoId],
    );
    expect(interna).toMatchObject({
      situacao: 'concluida',
      origem: 'integracao',
      cor: 'amarelo',
      sr: 'aplicada',
    });
    expect([Number(interna!['t']), Number(interna!['prazo']), Number(interna!['prof'])]).toEqual([
      60,
      60,
      m.prof,
    ]);
    expect([Number(interna!['pac']), Number(interna!['liga'])]).toEqual([
      m.paciente,
      ap.classificacaoRiscoId,
    ]);
    // Nova classificação externa mais recente: substitui a aplicada e, aplicada, reclassifica a interna (nada apagado).
    const c3 = await cla.receber(ctx(), { ...rec('T-3', 5), cor: 'laranja', tempoAlvoMinutos: 10 }, agora);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, (e) =>
      e.executar('UPDATE classificacao_externa_recebida SET profissional_id = ? WHERE id = ?', [
        m.prof,
        c3.id,
      ]),
    );
    const ap2 = await cla.aplicar(ctx(), c3.id);
    expect(ap2.reclassificou).toBe(ap.classificacaoRiscoId);
    const internas = await ler(
      `SELECT c.id, c.situacao, n.codigo AS cor, c.anterior_classificacao_risco_id AS ant FROM classificacao_risco c
         JOIN nivel_prioridade n ON n.id = c.nivel_prioridade_id WHERE c.atendimento_id = ? ORDER BY c.id`,
      [m.atdPa],
    );
    expect(internas.map((x) => [x['situacao'], x['cor']])).toEqual([
      ['reclassificada', 'amarelo'],
      ['concluida', 'laranja'],
    ]);
    expect(Number(internas[1]!['ant'])).toBe(ap.classificacaoRiscoId);
    const [sb] = await ler('SELECT situacao FROM classificacao_externa_recebida WHERE id = ?', [b.id]);
    expect(sb!['situacao']).toBe('substituida');
  }, 120_000);
});
