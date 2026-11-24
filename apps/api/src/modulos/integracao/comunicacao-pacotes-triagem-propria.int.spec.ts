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

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE t FROM pedido_mensagem_paciente_retorno t JOIN pedido_mensagem_paciente q
        ON q.id = t.pedido_mensagem_paciente_id WHERE q.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM pedido_mensagem_paciente WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM regra_envio_mensagem_paciente WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM modelo_mensagem_paciente WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM consentimento_titular WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM classificacao_externa_recebida WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM perfil_prioridade_externa WHERE codigo LIKE 'f396-%'");
  await e.executar("DELETE FROM sistema_externo WHERE codigo = 'f396-tri'");
  const pac =
    "(SELECT x.id FROM (SELECT p.id FROM pacote_parceiro p JOIN parceiro_dados d ON d.id = p.parceiro_dados_id WHERE d.codigo = 'f396-par') x)";
  await e.executar(`DELETE FROM entrega_pacote_parceiro WHERE pacote_parceiro_id IN ${pac}`);
  await e.executar(`DELETE FROM pacote_parceiro_campo WHERE pacote_parceiro_id IN ${pac}`);
  await e.executar(`DELETE FROM pacote_parceiro WHERE id IN ${pac}`);
  await e.executar("DELETE FROM parceiro_dados WHERE codigo = 'f396-par'");
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM categoria_atendimento WHERE codigo IN ('f396-pa','f396-amb')");
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('F3.9-6 contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let msg: PortaMensagensPacientePropria;
  let pac: PortaPacotesParceiroPropria;
  let cla: PortaClassificacaoExternaPropria;
  let m: { est: number; usuario: number; paciente: number; atdPa: number; atdAmb: number };
  const ctx = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P, hospital: P });
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
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const prof = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      if (!usuario?.['id'] || !paciente?.['id'] || !prof?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente e profissional.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
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
        `INSERT INTO parceiro_dados (codigo, nome, tipo, finalidade, base_legal, criado_em)
         VALUES ('f396-par', 'Parceiro (teste)', 'arquivo', 'Indicadores de UTI (teste)', 'execucao-de-contrato', ?)`,
        [agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
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
          usuario: Number(usuario['id']),
          paciente: Number(paciente['id']),
          atdPa: await atd(pa, 'pa'),
          atdAmb: await atd(amb, 'amb'),
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

    const p2 = await msg.pedir(ctx(), entrada(), agora);
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
    expect(pk['revisado_em']).not.toBeNull();
    expect(Number(pk['versao'])).toBe(2);

    const agora = new Date();
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
  }, 120_000);
});
