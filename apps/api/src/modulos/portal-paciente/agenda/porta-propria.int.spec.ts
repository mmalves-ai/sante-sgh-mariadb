// Integração da porta própria da agenda online do portal (M50, etapa 2) contra o MariaDB real, cliente f22_o2, massa
// SINTÉTICA criada no beforeAll e apagada no afterAll (nenhum dado de pessoa real; ficam o estabelecimento e o
// usuário de teste, que a trilha, só inclusão, referencia):
//   - configuração da agenda online: inclusão, leitura (nome da agenda e CRM relidos da agenda), troca das listas,
//     trava otimista e trilha na linha gravada;
//   - pré-check-in: envio com documento, leitura pela marcação, pelo id, do paciente e na fila (data, situação,
//     cursor), reserva da conferência (outro conferente recusado), decisão, reenvio do conferido recusado e
//     cancelamento;
//   - intenção de pagamento: inclusão, pendente em andamento recusado, transação repetida, leituras; a confirmação
//     (baixa no caixa) recusa com 503 `recurso-sem-modelo`; a conciliação só do confirmado;
//   - pesquisa de satisfação: resposta única por marcação e leitura do paciente;
//   - o outro estabelecimento não vê nada.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoAgendaOnline } from './porta.js';
import { PortaAgendaOnlinePropria } from './porta-propria.js';
import type { RegistroTrilhaPortal } from '../tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_AGENDA_ONLINE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'PAO2AO';
const OUTRO = 'PAO2AOX';
const PRONT = 939_701;
const LOGIN = 'pao2ao.recepcao';
const LOGIN2 = 'pao2ao.conferente';
const AGENDA = 'AGENDA SINTETICA PORTAL AO';
const MODELO = 'pao2ao_portal';
const CHAVE = 'teste-pao2ao/doc-1';
const PROF = 'PROFISSIONAL SINTETICO AO';

interface Massa {
  est: number;
  outro: number;
  agenda: number;
  paciente: number;
  conta: number;
  marcacao: number;
  fonte: number;
  especialidade: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor, est: number): Promise<void> {
  const pre = 'SELECT id FROM pre_checkin WHERE estabelecimento_id = ?';
  await e.executar(
    `DELETE k FROM conciliacao_pagamento_portal k JOIN intencao_pagamento_portal p ON p.id = k.intencao_pagamento_portal_id
      WHERE p.estabelecimento_id = ?`,
    [est],
  );
  await e.executar('DELETE FROM intencao_pagamento_portal WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM resposta_pesquisa_satisfacao WHERE estabelecimento_id = ?', [est]);
  await e.executar(`DELETE FROM pre_checkin_documento WHERE pre_checkin_id IN (${pre})`, [est]);
  await e.executar("DELETE FROM arquivo WHERE chave_armazenamento LIKE 'teste-pao2ao/%'", []);
  await e.executar('DELETE FROM pre_checkin WHERE estabelecimento_id = ?', [est]);
  const cfg = 'SELECT id FROM agenda_online_configuracao WHERE estabelecimento_id = ?';
  await e.executar(`DELETE FROM agenda_online_convenio WHERE agenda_online_configuracao_id IN (${cfg})`, [est]);
  await e.executar(`DELETE FROM agenda_online_servico WHERE agenda_online_configuracao_id IN (${cfg})`, [est]);
  await e.executar('DELETE FROM agenda_online_configuracao WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM marcacao_horario WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM horario_agenda WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM agenda_servico WHERE estabelecimento_id = ?', [est]);
  await e.executar(
    'DELETE c FROM conta_portal_paciente c JOIN paciente p ON p.id = c.paciente_id WHERE p.numero_prontuario = ?',
    [PRONT],
  );
  const pfs = await e.consultar('SELECT pessoa_fisica_id AS id FROM paciente WHERE numero_prontuario = ?', [PRONT]);
  await e.executar('DELETE FROM paciente WHERE numero_prontuario = ?', [PRONT]);
  for (const x of pfs) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [x['id']]);
  await e.executar('DELETE FROM modelo_pesquisa_satisfacao WHERE codigo = ?', [MODELO]);
  const profs = await e.consultar(
    'SELECT p.id, p.pessoa_fisica_id FROM profissional p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome = ?',
    [PROF],
  );
  for (const x of profs) {
    await e.executar('DELETE FROM profissional WHERE id = ?', [x['id']]);
    await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [x['pessoa_fisica_id']]);
  }
}

const trilha = (evento: string): RegistroTrilhaPortal => ({
  rede: CLIENTE,
  hospital: EST,
  usuario: LOGIN,
  evento,
  recurso: 'portal.agenda-online',
  operacao: 'gravar',
  tabelaAlvo: 'conta_portal_paciente',
  idAlvo: null,
  chaveNaturalAlvo: null,
  resultado: 'sucesso',
  estacao: null,
  correlacao: 'teste-pao2ao',
});

describe.skipIf(SEM_BANCO)(`porta própria da agenda online do portal (MariaDB, cliente ${CLIENTE})`, () => {
  const nucleo = new NucleoProprio();
  let m: Massa;
  let porta: PortaAgendaOnlinePropria;
  const c: ContextoAgendaOnline = { rede: CLIENTE, hospital: EST };
  const cOutro: ContextoAgendaOnline = { rede: CLIENTE, hospital: OUTRO };
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-pao2ao' }, (l) => l.consultar(sql, p));
  const hoje = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-pao2ao' }, async (e) => {
      const agora = new Date();
      const estab = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, 'ESTAB SINTETICO PORTAL AO', 'ESTAB SINTETICO PORTAL AO', agora],
        );
      const est = await estab(EST);
      const outro = await estab(OUTRO);
      await limpar(e, est);
      const usuario = async (login: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, 'USUARIO SINTETICO AO', 'pessoa', TRUE, ?)",
          [login, agora],
        );
      const u = await usuario(LOGIN);
      await usuario(LOGIN2);
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        ['pao2ao_consulta'],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES ('pao2ao_consulta', 'CONSULTA SINTETICA', 'consulta', ?)",
        [agora],
      );
      const pfProf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [PROF, agora]);
      const prof = await e.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pfProf, agora],
      );
      const agenda = await e.inserir(
        'INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 20, ?)',
        [est, AGENDA, cat, prof, agora],
      );
      const tipo = await garantir(
        e,
        'SELECT id FROM tipo_marcacao WHERE codigo = ?',
        ['pao2ao'],
        "INSERT INTO tipo_marcacao (codigo, descricao, natureza, criado_em) VALUES ('pao2ao', 'CONSULTA', 'primeira_vez', ?)",
        [agora],
      );
      const canal = await garantir(
        e,
        'SELECT id FROM canal_marcacao WHERE codigo = ?',
        ['pao2ao'],
        "INSERT INTO canal_marcacao (codigo, descricao, criado_em) VALUES ('pao2ao', 'PORTAL SINTETICO', ?)",
        [agora],
      );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        ['PAO2AO'],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES ('PAO2AO', 'FONTE SINTETICA AO', 'operadora', 'ativa', ?)",
        [agora],
      );
      const especialidade = await garantir(
        e,
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        ['PAO2AO'],
        "INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES ('PAO2AO', 'ESPECIALIDADE SINTETICA', ?)",
        [agora],
      );
      const sit = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM situacao_marcacao', []);
      const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        'PACIENTE SINTETICO AO',
        agora,
      ]);
      const paciente = await e.inserir(
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pf, PRONT, agora],
      );
      const conta = await e.inserir(
        'INSERT INTO conta_portal_paciente (paciente_id, login, email, criado_em) VALUES (?, ?, ?, ?)',
        [paciente, 'pao2ao@exemplo.invalid', 'pao2ao@exemplo.invalid', agora],
      );
      const inicio = new Date(`${hoje}T13:00:00.000Z`);
      const horario = await e.inserir(
        'INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [est, agenda, hoje, inicio, new Date(inicio.getTime() + 20 * 60_000), agora],
      );
      const marcacao = await e.inserir(
        `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, paciente_id, tipo_marcacao_id,
           situacao_marcacao_id, canal_marcacao_id, fonte_pagadora_id, duracao_minutos, marcado_em, responsavel_usuario_id, criado_em)
         VALUES (?, 'PAO2AO-1', ?, ?, ?, ?, ?, ?, 20, ?, ?, ?)`,
        [est, horario, paciente, tipo, Number(sit?.id), canal, fonte, agora, u, agora],
      );
      await e.inserir(
        "INSERT INTO modelo_pesquisa_satisfacao (codigo, nome, publico, canal_aplicacao, situacao, criado_em) VALUES (?, 'PESQUISA SINTETICA', 'ambulatorio', 'portal', 'vigente', ?)",
        [MODELO, agora],
      );
      return { est, outro, agenda, paciente, conta, marcacao, fonte, especialidade };
    });
    porta = new PortaAgendaOnlinePropria(nucleo);
  });

  afterAll(async () => {
    if (m) await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-pao2ao' }, (e) => limpar(e, m.est));
    await nucleo.encerrar();
  });

  it('configuração: inclui, lê da agenda, troca as listas, trava a versão e grava a trilha na linha', async () => {
    const base = {
      tipo: 'consulta' as const,
      agenda: m.agenda,
      nomeAgenda: 'IGNORADO',
      crm: 0,
      ativa: true,
      convenios: [m.fonte, m.fonte],
      servicos: [m.especialidade],
      antecedenciaHoras: 2,
      horizonteDias: 30,
      cancelaAteHoras: 12,
      precheckin: true,
      valorParticular: 150,
      teleconsulta: false,
      por: LOGIN,
    };
    const r = await porta.gravar(c, (g) => g.gravarConfig({ ...base, versao: null }), trilha('portal.agenda.config'));
    expect(r.versao).toBe(1);
    const lida = await porta.config(c, 'consulta', m.agenda);
    expect(lida).toMatchObject({
      id: r.id,
      nomeAgenda: AGENDA,
      convenios: [m.fonte],
      servicos: [m.especialidade],
      valorParticular: 150,
      precheckin: true,
      alteradoPor: LOGIN,
      versao: 1,
    });
    expect((await porta.configs(c)).map((k) => k.id)).toEqual([r.id]);
    expect(await porta.configs(cOutro)).toEqual([]);
    await expect(
      porta.gravar(c, (g) => g.gravarConfig({ ...base, versao: null }), null),
    ).rejects.toMatchObject({ codigo: 'versao-desatualizada' });
    const r2 = await porta.gravar(
      c,
      (g) => g.gravarConfig({ ...base, convenios: [], servicos: [], ativa: false, versao: 1 }),
      trilha('portal.agenda.config'),
    );
    expect(r2).toEqual({ id: r.id, versao: 2 });
    expect(await porta.config(c, 'consulta', m.agenda)).toMatchObject({ convenios: [], servicos: [], ativa: false });
    const tr = await ler(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'agenda_online_configuracao' AND entidade_id = ?",
      [r.id],
    );
    expect(tr.map((x) => x['motivo'])).toEqual(['portal.agenda.config', 'portal.agenda.config']);
  });

  it('pré-check-in: envia, lê, reserva, decide, recusa o reenvio do conferido e cancela', async () => {
    const envio = {
      tipo: 'consulta' as const,
      marcacao: m.marcacao,
      nomeAgenda: 'IGNORADO',
      crm: 0,
      data: hoje,
      hora: '10:00',
      paciente: m.paciente,
      conta: m.conta,
      dados: { celular: 'sintetico' },
      documentos: [{ tipo: 'identidade', chave: CHAVE, sha256: 'a'.repeat(64), mime: 'image/png' }],
      carteirinha: '123',
      carteirinhaValidade: null,
      termos: 'v1',
    };
    const r = await porta.gravar(c, (g) => g.enviarPreCheckin(envio), trilha('portal.precheckin.enviado'));
    const p = await porta.preCheckinDaMarcacao(c, 'consulta', m.marcacao);
    expect(p).toMatchObject({
      id: r.id,
      situacao: 'enviado',
      nomeAgenda: AGENDA,
      data: hoje,
      hora: '10:00',
      conta: m.conta,
      dados: { celular: 'sintetico' },
      documentos: [{ tipo: 'identidade', chave: CHAVE, sha256: 'a'.repeat(64), mime: 'image/png' }],
      carteirinha: '123',
      termos: 'v1',
      reservadoPor: null,
    });
    expect(await porta.preCheckinDaMarcacao(c, 'exame', m.marcacao)).toBeNull();
    expect((await porta.preCheckinPorId(c, r.id))?.id).toBe(r.id);
    expect(await porta.preCheckinPorId(cOutro, r.id)).toBeNull();
    expect((await porta.preCheckinsDoPaciente(c, m.paciente)).map((k) => k.id)).toEqual([r.id]);
    const fila = await porta.filaPreCheckin(c, { situacao: 'enviado', de: hoje, ate: hoje });
    expect(fila).toMatchObject({ haMais: false, itens: [{ id: r.id }] });
    expect((await porta.filaPreCheckin(c, { situacao: 'enviado', de: hoje, ate: hoje, depoisDe: r.id })).itens).toEqual(
      [],
    );
    const res = await porta.gravar(c, (g) => g.reservarConferencia(r.id, r.versao, LOGIN), null);
    expect((await porta.preCheckinPorId(c, r.id))?.reservadoPor).toBe(LOGIN);
    await expect(
      porta.gravar(c, (g) => g.enviarPreCheckin(envio), null),
    ).rejects.toMatchObject({ codigo: 'situacao' });
    await expect(
      porta.gravar(c, (g) => g.decidirPreCheckin(r.id, res.versao, { conferido: true, campos: [], por: LOGIN2 }), null),
    ).rejects.toMatchObject({ codigo: 'versao-desatualizada' });
    await porta.gravar(
      c,
      (g) => g.decidirPreCheckin(r.id, res.versao, { conferido: true, campos: ['celular'], por: LOGIN }),
      trilha('portal.precheckin.conferido'),
    );
    expect(await porta.preCheckinPorId(c, r.id)).toMatchObject({
      situacao: 'conferido',
      conferidoPor: LOGIN,
      camposGravados: ['celular'],
      reservadoPor: null,
    });
    await expect(porta.gravar(c, (g) => g.enviarPreCheckin(envio), null)).rejects.toMatchObject({
      codigo: 'situacao',
    });
    expect(await porta.gravar(c, (g) => g.cancelarPreCheckin('consulta', m.marcacao), null)).toBe(0);
  });

  it('pagamento: inicia, recusa o duplo e a transação repetida, lê; a confirmação recusa sem modelo', async () => {
    const nova = {
      conta: m.conta,
      paciente: m.paciente,
      tipo: 'consulta' as const,
      marcacao: m.marcacao,
      valor: 150,
      forma: 'cartao-credito' as const,
      conector: 'simulado' as const,
      transacao: `pao2ao-${Date.now()}`,
      expiraEm: new Date(Date.now() + 3_600_000),
      pixCopiaECola: null,
      enderecoCartao: null,
    };
    const r = await porta.gravar(c, (g) => g.iniciarPagamento(nova), trilha('portal.pagamento.iniciado'));
    await expect(
      porta.gravar(c, (g) => g.iniciarPagamento({ ...nova, transacao: `${nova.transacao}-2` }), null),
    ).rejects.toMatchObject({ codigo: 'situacao' });
    const p = await porta.pagamentoPorTransacao(c, nova.transacao);
    expect(p).toMatchObject({ id: r.id, forma: 'cartao-credito', situacao: 'pendente', valor: 150, tipo: 'consulta' });
    expect((await porta.pagamentoPorId(c, r.id))?.transacao).toBe(nova.transacao);
    expect(await porta.pagamentoPorId(cOutro, r.id)).toBeNull();
    expect((await porta.pagamentosDoPaciente(c, m.paciente)).map((k) => k.id)).toEqual([r.id]);
    expect(await porta.tesouraria(c, hoje, hoje)).toEqual([]);
    expect(await porta.pagamentoTesouraria(c, r.id)).toMatchObject({ cobradoPor: null, atos: [] });
    await expect(
      porta.gravar(
        c,
        (g) => g.registrarConciliacao({ pagamento: r.id, acao: 'conciliado', valor: 150, referencia: null, motivo: null, usuario: LOGIN2 }),
        null,
      ),
    ).rejects.toMatchObject({ codigo: 'situacao' });
    await expect(
      porta.gravar(
        c,
        (g) => g.confirmarPagamento({ transacao: nova.transacao, resultado: 'aprovado', comprovante: 'x', por: 'retorno' }),
        null,
      ),
    ).rejects.toMatchObject({ problema: { status: 503, codigo: 'recurso-sem-modelo' } });
  });

  it('pesquisa: responde uma vez por marcação e lê do paciente', async () => {
    const resposta = {
      conta: m.conta,
      paciente: m.paciente,
      tipo: 'consulta' as const,
      marcacao: m.marcacao,
      nomeAgenda: 'IGNORADO',
      dataAtendimento: hoje,
      nota: 9,
      comentario: 'sintetico',
    };
    const r = await porta.gravar(c, (g) => g.responderPesquisa(resposta), trilha('portal.pesquisa.respondida'));
    await expect(porta.gravar(c, (g) => g.responderPesquisa(resposta), null)).rejects.toMatchObject({
      codigo: 'situacao',
    });
    expect(await porta.pesquisasDoPaciente(c, m.paciente)).toEqual([
      expect.objectContaining({ id: r.id, nota: 9, nomeAgenda: AGENDA, dataAtendimento: hoje, comentario: 'sintetico' }),
    ]);
    expect(await porta.pesquisasDoPaciente(cOutro, m.paciente)).toEqual([]);
  });
});
