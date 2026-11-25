// Contrato de efeito da comunicação com o paciente pelos EVENTOS (08-INTG L133) contra o MariaDB real (cliente de
// teste): o disparo automático gera o pedido da marcação criada e o da véspera (uma vez só por regra e marcação); a
// Hal-AI entra pela credencial do cliente da API de mensageria (usuário técnico na trilha), lê os pendentes devidos,
// devolve o "enviado" e a resposta; a resposta "sim" confirma a presença da marcação e a resposta "não" abre o pedido
// de cancelamento (confirmação recusada) sem cancelar a marcação; credencial errada ou sem escopo é recusada.
// Massa SINTÉTICA (estabelecimento, paciente, agenda, marcações e credencial fictícios), limpa antes e depois.
import { createHash } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaMensagensPacientePropria } from './mensagens-paciente-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2023e';
const NOME_PAC = 'c2023 Paciente sintético';
const CLIENTE_API = 'c2023.halai';
const SEGREDO = 'segredo-sintetico-c2023-0123456789abcdef';
const basic = (id: string, s: string) => `Basic ${Buffer.from(`${id}:${s}`).toString('base64')}`;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE t FROM pedido_mensagem_paciente_retorno t JOIN pedido_mensagem_paciente q
        ON q.id = t.pedido_mensagem_paciente_id WHERE q.estabelecimento_id IN ${est}`,
    [P],
  );
  for (const t of [
    'confirmacao_marcacao',
    'pedido_mensagem_paciente',
    'regra_envio_mensagem_paciente',
    'modelo_mensagem_paciente',
    'marcacao_horario',
    'horario_agenda',
    'agenda_servico',
  ])
    await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM categoria_agenda WHERE codigo = 'c2023-cat'");
  await e.executar("DELETE FROM situacao_confirmacao WHERE codigo LIKE 'c2023-%'");
  const ca = "(SELECT x.id FROM (SELECT id FROM cliente_api WHERE codigo = 'c2023-hal') x)";
  await e.executar(`DELETE FROM escopo_cliente_api WHERE cliente_api_id IN ${ca}`);
  await e.executar(`DELETE FROM chave_api WHERE cliente_api_id IN ${ca}`);
  await e.executar("DELETE FROM cliente_api WHERE codigo = 'c2023-hal'");
  await e.executar("DELETE FROM sistema_externo WHERE codigo = 'c2023-hal'");
  const pf = '(SELECT x.id FROM (SELECT id FROM pessoa_fisica WHERE nome = ?) x)';
  await e.executar(`DELETE FROM telefone_pessoa WHERE pessoa_fisica_id IN ${pf}`, [NOME_PAC]);
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN ${pf}`, [NOME_PAC]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome = ?', [NOME_PAC]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)(
  'L133 eventos, resposta na marcação e credencial da Hal-AI (contrato de efeito)',
  () => {
    let nucleo: NucleoProprio;
    let msg: PortaMensagensPacientePropria;
    let m: { usuario: number; paciente: number; m1: number; m2: number; m3: number };
    const agora = new Date();
    const em = (horas: number) => new Date(agora.getTime() + horas * 3_600_000);
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
      msg = new PortaMensagensPacientePropria(nucleo, CLIENTE);
      m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
        await limpar(e);
        const usuario = Number(
          (await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL'))!['id'],
        );
        const est = await e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
          [P, agora],
        );
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          NOME_PAC,
          agora,
        ]);
        const pront = await e.uma('SELECT COALESCE(MAX(numero_prontuario), 0) + 1 AS n FROM paciente');
        const paciente = await e.inserir(
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pf, pront!['n'], agora],
        );
        await e.executar(
          `INSERT INTO telefone_pessoa (pessoa_fisica_id, sequencia, tipo_telefone_id, ddd, numero, principal,
           aceita_mensagem, aceita_mensagem_em, usa_aplicativo_mensagem, criado_em)
         VALUES (?, 1, 1, '11', '999990023', TRUE, TRUE, ?, TRUE, ?)`,
          [pf, agora, agora],
        );
        for (const sig of ['confirmada', 'recusada']) {
          const ja = await e.uma('SELECT id FROM situacao_confirmacao WHERE significado = ? AND ativo', [
            sig,
          ]);
          if (!ja)
            await e.executar(
              'INSERT INTO situacao_confirmacao (codigo, descricao, significado, criado_em) VALUES (?, ?, ?, ?)',
              [`c2023-${sig}`, `Sintética ${sig}`, sig, agora],
            );
        }
        const cat = await e.inserir(
          "INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES ('c2023-cat', 'Categoria sintética', ?)",
          [agora],
        );
        const agenda = await e.inserir(
          `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id,
           duracao_horario_minutos, criado_em)
         VALUES (?, 'Clínica sintética', ?, (SELECT MIN(id) FROM profissional WHERE excluido_em IS NULL), 15, ?)`,
          [est, cat, agora],
        );
        const aguardando = (await e.uma(
          "SELECT id FROM situacao_marcacao WHERE significado = 'aguardando' ORDER BY id LIMIT 1",
        ))!['id'];
        const canal = (await e.uma('SELECT MIN(id) AS id FROM canal_marcacao'))!['id'];
        const tipo = (await e.uma('SELECT MIN(id) AS id FROM tipo_marcacao'))!['id'];
        const fonte = (await e.uma('SELECT MIN(id) AS id FROM fonte_pagadora'))!['id'];
        const marcacao = async (n: number, inicio: Date) => {
          const h = await e.inserir(
            `INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em,
             situacao, criado_em) VALUES (?, ?, ?, ?, ?, 'ocupado', ?)`,
            [
              est,
              agenda,
              inicio.toISOString().slice(0, 10),
              inicio,
              new Date(inicio.getTime() + 900_000),
              agora,
            ],
          );
          return e.inserir(
            `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, paciente_id, tipo_marcacao_id,
             situacao_marcacao_id, canal_marcacao_id, fonte_pagadora_id, duracao_minutos, marcado_em,
             responsavel_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 15, ?, ?, ?)`,
            [est, `C2023-${n}`, h, paciente, tipo, aguardando, canal, fonte, agora, usuario, agora],
          );
        };
        // m1 e m2: consultas daqui a 30 h (véspera dentro do horizonte); m3: daqui a 10 dias (só o aviso de criada).
        const m1 = await marcacao(1, em(30));
        const m2 = await marcacao(2, em(31));
        const m3 = await marcacao(3, em(240));
        // A credencial da Hal-AI: sistema de mensageria, cliente da API com usuário técnico, chave e escopo.
        const sis = await e.inserir(
          `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES ('c2023-hal', 'Mensageria sintética', 'mensageria', 'Mensagens ao paciente (teste)', ?)`,
          [agora],
        );
        const ca = await e.inserir(
          `INSERT INTO cliente_api (codigo, nome, identificador_cliente, estabelecimento_id, sistema_externo_id, usuario_id,
           situacao, criado_em) VALUES ('c2023-hal', 'Mensageria sintética', ?, ?, ?, ?, 'ativo', ?)`,
          [CLIENTE_API, est, sis, usuario, agora],
        );
        await e.executar(
          `INSERT INTO chave_api (cliente_api_id, sequencia, prefixo, hash_chave, situacao, valida_desde, criado_em)
         VALUES (?, 1, 'c2023', ?, 'ativa', ?, ?)`,
          [
            ca,
            createHash('sha256').update(SEGREDO, 'utf8').digest('hex'),
            new Date(agora.getTime() - 3_600_000),
            agora,
          ],
        );
        const escopo =
          (await e.uma("SELECT id FROM escopo_api WHERE codigo = 'mensagem.paciente'"))?.['id'] ??
          (await e.inserir(
            `INSERT INTO escopo_api (codigo, descricao, recurso, acao, criado_em)
           VALUES ('mensagem.paciente', 'Mensagens ao paciente (pendentes e retornos)', 'mensagem', 'escrita', ?)`,
            [agora],
          ));
        await e.executar(
          'INSERT INTO escopo_cliente_api (cliente_api_id, escopo_api_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [ca, escopo, agora.toISOString().slice(0, 10), agora],
        );
        return { usuario, paciente, m1, m2, m3 };
      });
    }, 120_000);

    afterAll(async () => {
      if (!nucleo) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
      await nucleo.encerrar();
    });

    it('dispara pelos eventos, a Hal-AI lê pela credencial e a resposta age na marcação', async () => {
      const modelo = await msg.gravarModelo(ctx(), {
        codigo: 'conf',
        descricao: 'Confirmação de consulta',
        finalidade: 'confirmacao',
        canal: 'whatsapp',
        corpo: '{{estabelecimento}}: confirma {{servico}} em {{data}} às {{hora}}? Responda SIM ou NAO.',
        respostaConfirmacao: 'SIM',
        respostaRecusa: 'NAO',
      });
      const criada = await msg.gravarRegra(ctx(), {
        codigo: 'criada',
        descricao: 'Aviso da marcação',
        modeloId: modelo.id,
        gatilho: 'agendamento_criado',
      });
      const vespera = await msg.gravarRegra(ctx(), {
        codigo: 'vespera',
        descricao: 'Confirmação na véspera',
        modeloId: modelo.id,
        gatilho: 'confirmacao_agendamento',
        antecedenciaMinutos: 1440,
      });

      // 1) Disparo: 3 marcações criadas (regra "criada") + 2 na véspera (regra "véspera"); a de 10 dias não tem véspera.
      expect(await msg.dispararEventos(ctx(), agora)).toEqual({ pedidos: 5, recusados: {} });
      // De novo: nada novo (uma vez por regra e marcação).
      expect(await msg.dispararEventos(ctx(), agora)).toEqual({ pedidos: 0, recusados: {} });
      const pedidos = await ler<{
        id: number;
        r: number;
        entidade: string;
        entidade_id: number;
        agendado_para: Date;
      }>(
        `SELECT id, regra_envio_mensagem_paciente_id AS r, entidade, entidade_id, agendado_para
         FROM pedido_mensagem_paciente WHERE paciente_id = ? AND situacao = 'pendente' ORDER BY id`,
        [m.paciente],
      );
      expect(pedidos.filter((x) => Number(x.r) === criada.id).map((x) => Number(x.entidade_id))).toEqual(
        expect.arrayContaining([m.m1, m.m2, m.m3]),
      );
      const daVespera = pedidos.filter((x) => Number(x.r) === vespera.id);
      expect(daVespera.map((x) => Number(x.entidade_id)).sort()).toEqual([m.m1, m.m2].sort());
      expect(new Set(pedidos.map((x) => x.entidade))).toEqual(new Set(['marcacao_horario']));
      // A véspera sai 24 h antes da consulta (daqui a 6 h para a m1).
      const v1 = daVespera.find((x) => Number(x.entidade_id) === m.m1)!;
      expect(new Date(v1.agendado_para).getTime()).toBe(em(30).getTime() - 86_400_000);

      // 2) Credencial: segredo errado e identificador desconhecido recusados; a certa traz o usuário técnico.
      expect((await erro(msg.contextoDaCredencial(P, basic(CLIENTE_API, 'errado')))).status).toBe(401);
      expect((await erro(msg.contextoDaCredencial(P, basic('outro.cliente', SEGREDO)))).status).toBe(401);
      const hal = await msg.contextoDaCredencial(P, basic(CLIENTE_API, SEGREDO));
      expect(hal.usuario).toBe(m.usuario);
      // Pendentes devidos: agora só os avisos de criada (3); daqui a 7 h, também as duas vésperas.
      expect((await msg.pendentes(hal, agora)).length).toBe(3);
      const devidos = await msg.pendentes(hal, em(7));
      expect(devidos.length).toBe(5);
      expect(devidos[0]!.conteudo).toContain('Hospital Teste: confirma Clínica sintética em');

      // 3) A Hal-AI devolve o enviado e as respostas: "sim" na m1, "não" na m2.
      const p1 = daVespera.find((x) => Number(x.entidade_id) === m.m1)!.id;
      const p2 = daVespera.find((x) => Number(x.entidade_id) === m.m2)!.id;
      await msg.marcarEnviado(hal, Number(p1), 'hal-1');
      await msg.marcarEnviado(hal, Number(p2), 'hal-2');
      const r1 = await msg.registrarRetorno(hal, Number(p1), { tipo: 'resposta', respostaTexto: 'sim' });
      expect(r1).toMatchObject({
        situacao: 'respondido',
        respostaInterpretada: 'confirmado',
        efeito: 'confirmar_presenca',
      });
      const r2 = await msg.registrarRetorno(hal, Number(p2), { tipo: 'resposta', respostaTexto: 'nao' });
      expect(r2).toMatchObject({ respostaInterpretada: 'cancelado', efeito: 'pedir_cancelamento' });

      const marc = await ler<{ id: number; significado: string }>(
        `SELECT m.id, s.significado FROM marcacao_horario m JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
        WHERE m.id IN (?, ?) ORDER BY m.id`,
        [m.m1, m.m2],
      );
      // A m1 fica confirmada; a m2 continua aguardando (a resposta nunca cancela sozinha).
      expect(marc.map((x) => x.significado)).toEqual(['confirmada', 'aguardando']);
      const conf = await ler<{
        marcacao_horario_id: number;
        significado: string;
        automatica: number;
        u: number;
      }>(
        `SELECT c.marcacao_horario_id, s.significado, c.automatica, c.responsavel_usuario_id AS u, c.observacao
         FROM confirmacao_marcacao c JOIN situacao_confirmacao s ON s.id = c.situacao_confirmacao_id
        WHERE c.marcacao_horario_id IN (?, ?) ORDER BY c.marcacao_horario_id`,
        [m.m1, m.m2],
      );
      expect(conf.map((x) => [Number(x.marcacao_horario_id), x.significado, Number(x.automatica)])).toEqual([
        [m.m1, 'confirmada', 1],
        [m.m2, 'recusada', 1],
      ]);
      expect(String((conf[1] as Record<string, unknown>)['observacao'])).toContain('cancelamento');
      const ret = await ler<{ efeito_resposta: string; confirmacao_marcacao_id: number | null }>(
        `SELECT efeito_resposta, confirmacao_marcacao_id FROM pedido_mensagem_paciente_retorno
        WHERE pedido_mensagem_paciente_id IN (?, ?) ORDER BY pedido_mensagem_paciente_id`,
        [p1, p2],
      );
      expect(ret.map((x) => x.efeito_resposta)).toEqual(['confirmar_presenca', 'pedir_cancelamento']);
      expect(ret.every((x) => x.confirmacao_marcacao_id !== null)).toBe(true);
      // A trilha do retorno é do usuário técnico da credencial.
      const [trilha] = await ler<{ n: number }>(
        'SELECT COUNT(*) AS n FROM pedido_mensagem_paciente_retorno WHERE pedido_mensagem_paciente_id IN (?, ?) AND criado_por = ?',
        [p1, p2, m.usuario],
      );
      expect(Number(trilha?.n)).toBe(2);
    });

    it('credencial sem o escopo das mensagens é recusada', async () => {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `escopo-${P}` }, (e) =>
        e.executar(
          `UPDATE escopo_cliente_api SET excluido_em = ? WHERE cliente_api_id =
           (SELECT id FROM cliente_api WHERE codigo = 'c2023-hal')`,
          [new Date()],
        ),
      );
      expect(await erro(msg.contextoDaCredencial(P, basic(CLIENTE_API, SEGREDO)))).toMatchObject({
        status: 403,
        codigo: 'fora-do-escopo',
      });
    });
  },
);
