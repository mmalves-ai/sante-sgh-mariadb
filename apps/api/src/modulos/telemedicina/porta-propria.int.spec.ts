// Integração da porta PRÓPRIA da telemedicina contra o MariaDB real, no cliente de teste da onda 3 (f22_o3, já criado
// por `python3 -I tools/db/criar_cliente.py`). A massa é SINTÉTICA e própria do lote (estabelecimentos f22l0315 e
// f22l0315b, logins f22.l0315.*), montada de forma idempotente no beforeAll; as teleconsultas do lote são apagadas antes
// e depois. Contrato de efeito: linhas, versao, participantes e trilha de cada gravação, e as recusas (versão
// desatualizada, médico errado, UF inválida, outro estabelecimento). A mesma bateria roda na porta em memória.
// SGH_NUCLEO_SEM_BANCO=1 pula a parte do banco.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { ContextoTelemedicina, PortaTelemedicina } from './porta.js';
import { PortaTelemedicinaMemoria } from './porta-memoria.js';
import { civilNoFuso, instanteNoFuso, PortaTelemedicinaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const MARCA = 'F22L0315';
const LOGIN = 'f22.l0315.medico';
const DIA = '2030-04-02';
const CORR = `teste-l0315-${randomUUID().slice(0, 8)}`;

describe('fuso do estabelecimento', () => {
  it('converte a hora local em instante e volta', () => {
    const i = instanteNoFuso('America/Sao_Paulo', DIA, '10:15');
    expect(i.toISOString()).toBe('2030-04-02T13:15:00.000Z');
    expect(civilNoFuso('America/Sao_Paulo', i)).toMatchObject({ data: DIA, hora: '10:15' });
  });
});

interface Fixture {
  readonly porta: PortaTelemedicina;
  readonly c: () => ContextoTelemedicina;
  readonly outro: () => ContextoTelemedicina;
  readonly paciente: number;
  readonly p1: number;
  readonly p2: number;
}

const linha = (id: number | null): TrilhaDaGravacao => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'teleconsulta',
  entidadeId: id,
  dadosDepois: { evento: 'teste.l0315' },
  correlacao: CORR,
});
const local = { uf: 'RJ', municipio: 'TESTE', tipo: 'residencia' };

function bateria(nome: string, fixture: () => Fixture) {
  describe(`bateria comum: ${nome}`, () => {
    it('agenda, sala de espera, sala, entrada do paciente e encerramento, com as recusas', async () => {
      const f = fixture();
      const { id } = await f.porta.gravar(
        f.c(),
        (r: { id: number }) => linha(r.id),
        (g) =>
          g.agendar({
            marcacao: null,
            agenda: null,
            nomeAgenda: '',
            profissional: f.p1,
            data: DIA,
            hora: '10:00',
            paciente: f.paciente,
            por: LOGIN,
          }),
      );
      expect(await f.porta.porId(f.c(), id)).toMatchObject({
        modalidade: 'teleconsulta',
        situacao: 'agendada',
        data: DIA,
        hora: '10:00',
        paciente: f.paciente,
        profissionalAgenda: f.p1,
        versao: 1,
      });
      expect(await f.porta.porId(f.outro(), id)).toBeNull();
      const espera = (versao: number, uf = 'RJ') =>
        f.porta.gravar(f.c(), linha(id), (g) =>
          g.entrarSalaEspera(id, versao, { termo: 'TELE-TESTE', local: { ...local, uf }, por: LOGIN }),
        );
      await expect(espera(9)).rejects.toMatchObject({ codigo: 'versao-desatualizada' });
      const v2 = await espera(1);
      expect(v2.versao).toBe(2);
      expect(await f.porta.porId(f.c(), id)).toMatchObject({
        situacao: 'aguardando',
        termo: { versao: 'TELE-TESTE' },
        local: { uf: 'RJ', tipo: 'residencia' },
      });
      expect((await f.porta.porId(f.c(), id))?.esperaDesde).toBeTruthy();
      const v3 = await f.porta.gravar(f.c(), linha(id), (g) =>
        g.abrirSala(id, 2, {
          provedor: 'simulado',
          sala: `SIM-${randomUUID()}`,
          declaracao: 'DECL-TESTE',
          medico: LOGIN,
          vinculo: f.p1,
          cienteAlerta: false,
        }),
      );
      expect(await f.porta.porId(f.c(), id)).toMatchObject({
        situacao: 'sala-aberta',
        vinculoMedico: f.p1,
        declaracao: 'DECL-TESTE',
      });
      await expect(
        f.porta.gravar(f.c(), null, (g) =>
          g.encerrar(id, v3.versao, { motivo: 'paciente-ausente', por: 'x', vinculo: f.p2 }),
        ),
      ).rejects.toMatchObject({ codigo: 'versao-desatualizada' });
      expect(await f.porta.gravar(f.c(), null, (g) => g.registrarEntradaPaciente(id))).toBe(true);
      expect(await f.porta.gravar(f.c(), null, (g) => g.registrarEntradaPaciente(id))).toBe(false);
      await f.porta.gravar(f.c(), linha(id), (g) =>
        g.encerrar(id, v3.versao, { motivo: 'paciente-ausente', por: LOGIN, vinculo: f.p1 }),
      );
      const fim = await f.porta.porId(f.c(), id);
      expect(fim).toMatchObject({ situacao: 'encerrada', motivoEncerramento: 'paciente-ausente' });
      expect(fim?.pacienteEntrouEm).toBeTruthy();
      const dia = await f.porta.doDia(f.c(), { data: DIA, profissional: f.p1, teto: 50 });
      expect(dia.itens.map((x) => x.id)).toContain(id);
      expect(
        (await f.porta.doDia(f.c(), { data: DIA, profissional: f.p2, teto: 50 })).itens.map((x) => x.id),
      ).not.toContain(id);
      expect((await f.porta.doPaciente(f.c(), f.paciente)).map((x) => x.id)).toContain(id);
    });

    it('teleinterconsulta: responde só o convidado; cancela só quem pediu', async () => {
      const f = fixture();
      const pedir = () =>
        f.porta.gravar(f.c(), null, (g) =>
          g.solicitarInterconsulta({
            atendimento: atendimentoDe(f),
            paciente: f.paciente,
            data: DIA,
            hora: '11:00',
            convidado: f.p2,
            nomeConvidado: 'CONVIDADO',
            motivo: 'Pergunta sintética',
            solicitante: LOGIN,
            vinculoSolicitante: f.p1,
          }),
        );
      const { id } = await pedir();
      expect(await f.porta.porId(f.c(), id)).toMatchObject({
        modalidade: 'teleinterconsulta',
        situacao: 'solicitada',
        convidado: f.p2,
        criadoPor: LOGIN,
      });
      await expect(
        f.porta.gravar(f.c(), null, (g) =>
          g.responderInterconsulta(id, 1, { parecer: 'x', vinculo: f.p1, por: 'x' }),
        ),
      ).rejects.toMatchObject({ codigo: 'versao-desatualizada' });
      await f.porta.gravar(f.c(), linha(id), (g) =>
        g.responderInterconsulta(id, 1, { parecer: 'Parecer sintético', vinculo: f.p2, por: 'x' }),
      );
      expect(await f.porta.porId(f.c(), id)).toMatchObject({
        situacao: 'respondida',
        parecer: 'Parecer sintético',
        versao: 2,
      });
      const { id: id2 } = await pedir();
      await expect(
        f.porta.gravar(f.c(), null, (g) =>
          g.cancelarInterconsulta(id2, 1, { motivo: 'x', por: 'outra.pessoa' }),
        ),
      ).rejects.toMatchObject({ codigo: 'versao-desatualizada' });
      await f.porta.gravar(f.c(), null, (g) =>
        g.cancelarInterconsulta(id2, 1, { motivo: 'Não precisa mais', por: LOGIN }),
      );
      expect(await f.porta.porId(f.c(), id2)).toMatchObject({
        situacao: 'cancelada',
        motivoCancelamento: 'Não precisa mais',
      });
      const l = await f.porta.interconsultas(f.c(), {
        convidado: f.p2,
        solicitante: 'ninguem',
        desde: DIA,
        teto: 50,
      });
      expect(l.itens.map((x) => x.id)).toEqual(expect.arrayContaining([id, id2]));
    });
  });
}

const atendimentos = new Map<PortaTelemedicina, number>();
const atendimentoDe = (f: Fixture) => atendimentos.get(f.porta) ?? 1;

const memoria = new PortaTelemedicinaMemoria(() => new Date('2030-04-02T12:00:00Z'));
bateria('memória', () => ({
  porta: memoria,
  c: () => ({ hospital: 'l0315' }),
  outro: () => ({ hospital: 'l0315b' }),
  paciente: 1003,
  p1: 7101,
  p2: 7102,
}));

describe.skipIf(SEM_BANCO)('porta própria no MariaDB (f22_o3)', () => {
  const nucleo = new NucleoProprio();
  const ids = {
    est: 0,
    outro: 0,
    usuario: 0,
    paciente: 0,
    p1: 0,
    p2: 0,
    atendimento: 0,
    m1: 0,
    m2: 0,
    m3: 0,
    m4: 0,
    smAguardando: 0,
    smCancelada: 0,
  };
  const porta = new PortaTelemedicinaPropria(nucleo);
  const c = (): ContextoTelemedicina => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: ids.usuario,
    correlacao: CORR,
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: CORR }, fn);
  const limpar = () =>
    escrever(async (e) => {
      const ests = [ids.est, ids.outro].filter((x) => x > 0);
      if (!ests.length) return;
      const q = ests.map(() => '?').join(', ');
      await e.executar(
        `DELETE FROM teleconsulta_participante WHERE teleconsulta_id IN (SELECT id FROM teleconsulta WHERE estabelecimento_id IN (${q}))`,
        ests,
      );
      await e.executar(`DELETE FROM teleconsulta WHERE estabelecimento_id IN (${q})`, ests);
      await e.executar(
        `DELETE FROM integracao_mensagem WHERE ponto LIKE 'telemedicina.%' AND estabelecimento_id IN (${q})`,
        ests,
      );
    });

  async function garantir(
    e: Escritor,
    sel: string,
    p: unknown[],
    ins: string,
    pi: unknown[],
  ): Promise<number> {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }

  beforeAll(async () => {
    await escrever(async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital de teste ${codigo}`, `Hospital de teste ${codigo} (fictício)`, agora],
        );
      ids.est = await est('f22l0315');
      ids.outro = await est('f22l0315b');
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
        [LOGIN, `USUARIO ${MARCA}`, agora],
      );
      const pf = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pfPac = await pf(`PACIENTE ${MARCA}`);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pfPac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, nome_social, usa_nome_social, criado_em) VALUES (?, ?, ?, TRUE, ?)',
        [pfPac, 9_031_500, `NOME SOCIAL ${MARCA}`, agora],
      );
      const prof = async (nome: string) => {
        const p = await pf(nome);
        return garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [p],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [p, agora],
        );
      };
      ids.p1 = await prof(`MEDICA ${MARCA}`);
      ids.p2 = await prof(`CONVIDADO ${MARCA}`);
      const categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        ['consulta'],
        'INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, ?, ?)',
        ['consulta', 'Consulta ambulatorial', 'ambulatorio', agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['1'],
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        ['1', 'Eletivo', 'teste', agora],
      );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [MARCA],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [MARCA, `CONVENIO ${MARCA}`, agora],
      );
      // Catálogo público mínimo (o carregador oficial não roda no cliente de teste): o país e a UF do local do paciente.
      const pais = await garantir(
        e,
        'SELECT id FROM pais_referencia WHERE codigo_iso = ?',
        ['BR'],
        'INSERT INTO pais_referencia (codigo_iso, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        ['BR', 'Brasil', 'teste', agora],
      );
      await garantir(
        e,
        'SELECT id FROM unidade_federativa WHERE sigla = ?',
        ['RJ'],
        'INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, versao_fonte, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        ['33', 'RJ', 'Rio de Janeiro', pais, 'teste', agora],
      );
      ids.atendimento = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, 'L0315-1'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          'L0315-1',
          ids.paciente,
          categoria,
          carater,
          fonte,
          ids.p1,
          new Date('2030-01-10T12:00:00Z'),
          agora,
        ],
      );
      // A agenda sintética do médico p1 (dono da agenda), com quatro horários e as marcações do paciente; o executante fica
      // nulo, como no caso comum. A marcação m3 está cancelada pela situação.
      const catAgenda = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        [MARCA],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'consulta', ?)",
        [MARCA, `Consultas ${MARCA}`, agora],
      );
      const agenda = await garantir(
        e,
        'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, `AGENDA ${MARCA}`],
        'INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, duracao_horario_minutos, profissional_id, criado_em) VALUES (?, ?, ?, 30, ?, ?)',
        [ids.est, `AGENDA ${MARCA}`, catAgenda, ids.p1, agora],
      );
      const sm = (codigo: string, significado: string) =>
        garantir(
          e,
          'SELECT id FROM situacao_marcacao WHERE codigo = ?',
          [codigo],
          'INSERT INTO situacao_marcacao (codigo, descricao, significado, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `${significado} ${MARCA}`, significado, agora],
        );
      ids.smAguardando = await sm('L0315A', 'aguardando');
      ids.smCancelada = await sm('L0315C', 'cancelada');
      const tipo = await garantir(
        e,
        'SELECT id FROM tipo_marcacao WHERE codigo = ?',
        ['L0315T'],
        "INSERT INTO tipo_marcacao (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'teleconsulta', ?)",
        ['L0315T', `Teleconsulta ${MARCA}`, agora],
      );
      const canal = await garantir(
        e,
        'SELECT id FROM canal_marcacao WHERE codigo = ?',
        ['L0315P'],
        'INSERT INTO canal_marcacao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['L0315P', `Portal ${MARCA}`, agora],
      );
      const marcacao = async (n: number, hora: string, situacao: number) => {
        const inicio = instanteNoFuso('America/Sao_Paulo', DIA, hora);
        const horario = await garantir(
          e,
          'SELECT id FROM horario_agenda WHERE agenda_servico_id = ? AND inicio_em = ?',
          [agenda, inicio],
          'INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [ids.est, agenda, DIA, inicio, new Date(inicio.getTime() + 30 * 60_000), agora],
        );
        const m = await garantir(
          e,
          'SELECT id FROM marcacao_horario WHERE estabelecimento_id = ? AND numero = ?',
          [ids.est, `L0315-M${n}`],
          `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, tipo_marcacao_id, situacao_marcacao_id,
             canal_marcacao_id, fonte_pagadora_id, duracao_minutos, marcado_em, responsavel_usuario_id, paciente_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 30, ?, ?, ?, ?)`,
          [
            ids.est,
            `L0315-M${n}`,
            horario,
            tipo,
            situacao,
            canal,
            fonte,
            agora,
            ids.usuario,
            ids.paciente,
            agora,
          ],
        );
        await e.executar('UPDATE marcacao_horario SET situacao_marcacao_id = ? WHERE id = ?', [situacao, m]);
        return m;
      };
      ids.m1 = await marcacao(1, '08:00', ids.smAguardando);
      ids.m2 = await marcacao(2, '08:30', ids.smAguardando);
      ids.m3 = await marcacao(3, '09:00', ids.smCancelada);
      ids.m4 = await marcacao(4, '09:30', ids.smAguardando);
    });
    atendimentos.set(porta, ids.atendimento);
    await limpar();
  });
  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  bateria('banco', () => ({
    porta,
    c,
    outro: () => ({ ...c(), estabelecimento: ids.outro }),
    paciente: ids.paciente,
    p1: ids.p1,
    p2: ids.p2,
  }));

  it('contrato de efeito: linha, versao, participantes e trilha; UF inválida recusada; histórico do paciente', async () => {
    const { id } = await porta.gravar(
      c(),
      (r: { id: number }) => linha(r.id),
      (g) =>
        g.agendar({
          marcacao: null,
          agenda: null,
          nomeAgenda: '',
          profissional: ids.p1,
          data: DIA,
          hora: '14:00',
          paciente: ids.paciente,
          por: LOGIN,
        }),
    );
    await expect(
      porta.gravar(c(), null, (g) =>
        g.entrarSalaEspera(id, 1, { termo: 'T', local: { ...local, uf: 'XX' }, por: LOGIN }),
      ),
    ).rejects.toMatchObject({ codigo: 'situacao' });
    await porta.gravar(c(), linha(id), (g) =>
      g.entrarSalaEspera(id, 1, { termo: 'TELE-TESTE', local, por: LOGIN }),
    );
    const lido = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: CORR }, async (l) => ({
      t: await l.uma(
        'SELECT situacao, versao, termo_versao, local_paciente_tipo, criado_por, alterado_por, estabelecimento_id FROM teleconsulta WHERE id = ?',
        [id],
      ),
      p: await l.consultar(
        'SELECT papel, paciente_id FROM teleconsulta_participante WHERE teleconsulta_id = ?',
        [id],
      ),
      trilha: await l.uma<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'teleconsulta' AND entidade_id = ? AND correlacao = ? AND estabelecimento_id = ?",
        [id, CORR, ids.est],
      ),
    }));
    expect(lido.t).toMatchObject({
      situacao: 'aguardando',
      termo_versao: 'TELE-TESTE',
      local_paciente_tipo: 'residencia',
    });
    expect(Number(lido.t?.['versao'])).toBe(2);
    expect(Number(lido.t?.['criado_por'])).toBe(ids.usuario);
    expect(Number(lido.t?.['alterado_por'])).toBe(ids.usuario);
    expect(lido.p).toHaveLength(1);
    expect(lido.p[0]).toMatchObject({ papel: 'paciente' });
    // Duas operações do executor (agendar, entrar na sala de espera) e as duas linhas do evento de negócio.
    expect(Number(lido.trilha?.n)).toBe(4);
    const hist = await porta.historicoClinico(c(), ids.paciente);
    expect(hist.find((h) => h.atendimento === ids.atendimento)).toMatchObject({
      data: '2030-01-10',
      laboratorio: false,
    });
  });
  it('marcação: profissional da agenda (executante nulo), horário da agenda, uma viva por marcação, marcação cancelada recusada', async () => {
    const { id } = await porta.gravar(
      c(),
      (r: { id: number }) => linha(r.id),
      (g) =>
        g.agendar({
          marcacao: ids.m1,
          agenda: null,
          nomeAgenda: '',
          profissional: null,
          data: '2030-01-01',
          hora: '00:00',
          paciente: ids.paciente,
          por: LOGIN,
        }),
    );
    expect(await porta.porId(c(), id)).toMatchObject({
      marcacao: ids.m1,
      marcacaoVigente: true,
      profissionalAgenda: ids.p1,
      data: DIA,
      hora: '08:00',
      situacao: 'agendada',
    });
    expect((await porta.daMarcacao(c(), ids.m1))?.id).toBe(id);
    const outra = (marcacao: number, paciente = ids.paciente) =>
      porta.gravar(c(), null, (g) =>
        g.agendar({
          marcacao,
          agenda: null,
          nomeAgenda: '',
          profissional: null,
          data: DIA,
          hora: '08:00',
          paciente,
          por: LOGIN,
        }),
      );
    await expect(outra(ids.m1)).rejects.toMatchObject({ codigo: 'situacao' });
    await expect(outra(ids.m3)).rejects.toMatchObject({ codigo: 'situacao' });
    await expect(outra(ids.m4, ids.paciente + 1_000_000)).rejects.toBeTruthy();
    const ev = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: CORR }, (l) =>
      l.uma<{ n: number }>(
        "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'telemedicina.teleconsulta_agendada' AND entidade = 'teleconsulta' AND entidade_id = ?",
        [id],
      ),
    );
    expect(Number(ev?.n)).toBe(1);
  });

  it('marcação cancelada pela situação deixa de ser vigente; remarcação e cancelamento pela marcação', async () => {
    const { id } = await porta.gravar(c(), null, (g) =>
      g.agendar({
        marcacao: ids.m4,
        agenda: null,
        nomeAgenda: '',
        profissional: null,
        data: DIA,
        hora: '09:30',
        paciente: ids.paciente,
        por: LOGIN,
      }),
    );
    expect((await porta.porId(c(), id))?.marcacaoVigente).toBe(true);
    await escrever((e) =>
      e.executar('UPDATE marcacao_horario SET situacao_marcacao_id = ? WHERE id = ?', [
        ids.smCancelada,
        ids.m4,
      ]),
    );
    try {
      expect((await porta.porId(c(), id))?.marcacaoVigente).toBe(false);
    } finally {
      await escrever((e) =>
        e.executar('UPDATE marcacao_horario SET situacao_marcacao_id = ? WHERE id = ?', [
          ids.smAguardando,
          ids.m4,
        ]),
      );
    }
    await porta.gravar(c(), null, (g) =>
      g.entrarSalaEspera(id, 1, { termo: 'TELE-TESTE', local, por: LOGIN }),
    );
    const movidas = await porta.gravar(c(), null, (g) =>
      g.mover({
        de: ids.m4,
        para: ids.m2,
        agenda: null,
        nomeAgenda: '',
        data: DIA,
        hora: '00:00',
        por: LOGIN,
      }),
    );
    expect(movidas).toBe(1);
    expect(await porta.porId(c(), id)).toMatchObject({
      marcacao: ids.m2,
      hora: '08:30',
      situacao: 'agendada',
      termo: null,
      local: null,
      marcacaoVigente: true,
      versao: 3,
    });
    const ps = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: CORR }, (l) =>
      l.consultar(
        'SELECT excluido_em, excluido_por FROM teleconsulta_participante WHERE teleconsulta_id = ?',
        [id],
      ),
    );
    expect(ps).toHaveLength(1);
    expect(ps[0]?.['excluido_em']).toBeTruthy();
    expect(Number(ps[0]?.['excluido_por'])).toBe(ids.usuario);
    expect(await porta.gravar(c(), null, (g) => g.cancelarDaMarcacao(ids.m2, LOGIN))).toBe(1);
    expect(await porta.porId(c(), id)).toMatchObject({
      situacao: 'cancelada',
      motivoCancelamento: 'Marcação cancelada.',
      versao: 4,
    });
    expect(await porta.daMarcacao(c(), ids.m2)).toBeNull();
    expect(await porta.gravar(c(), null, (g) => g.cancelarDaMarcacao(ids.m2, LOGIN))).toBe(0);
  });

  it('início: vinculação reentrante ao atendimento, só pelo médico da sala, com trilha da operação e doAtendimento', async () => {
    const { id } = await porta.gravar(c(), null, (g) =>
      g.agendar({
        marcacao: null,
        agenda: null,
        nomeAgenda: '',
        profissional: ids.p1,
        data: DIA,
        hora: '15:00',
        paciente: ids.paciente,
        por: LOGIN,
      }),
    );
    await porta.gravar(c(), null, (g) =>
      g.entrarSalaEspera(id, 1, { termo: 'TELE-TESTE', local, por: LOGIN }),
    );
    await porta.gravar(c(), null, (g) =>
      g.abrirSala(id, 2, {
        provedor: 'simulado',
        sala: `SIM-${randomUUID()}`,
        declaracao: 'DECL',
        medico: LOGIN,
        vinculo: ids.p1,
        cienteAlerta: true,
      }),
    );
    // O executor do atendimento grava o atendimento_id na transação dele (passo 2); o passo 3 pode falhar depois.
    await escrever((e) =>
      e.executar('UPDATE teleconsulta SET atendimento_id = ?, versao = versao + 1 WHERE id = ?', [
        ids.atendimento,
        id,
      ]),
    );
    expect(await porta.doAtendimento(c(), ids.atendimento)).toBeNull();
    const vincular = (profissional: number, atendimento = ids.atendimento) =>
      porta.gravar(c(), linha(id), (g) => g.vincularAtendimento({ id, atendimento, profissional }));
    await expect(vincular(ids.p2)).rejects.toMatchObject({ codigo: 'situacao' });
    await expect(vincular(ids.p1, ids.atendimento + 1_000_000)).rejects.toMatchObject({ codigo: 'situacao' });
    expect(await vincular(ids.p1)).toBe(true);
    expect(await vincular(ids.p1)).toBe(false);
    const lida = await porta.porId(c(), id);
    expect(lida).toMatchObject({ situacao: 'em-andamento', atendimento: ids.atendimento });
    expect(lida?.iniciadaEm).toBeTruthy();
    expect((await porta.doAtendimento(c(), ids.atendimento))?.id).toBe(id);
    const t = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: CORR }, (l) =>
      l.uma<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'teleconsulta' AND entidade_id = ? AND JSON_VALUE(dados_depois, '$.operacao') = 'telemedicina.vincular_atendimento'",
        [id],
      ),
    );
    expect(Number(t?.n)).toBe(2);
    await porta.gravar(c(), null, (g) =>
      g.encerrar(id, 5, { motivo: 'concluida', por: LOGIN, vinculo: ids.p1 }),
    );
    expect(await porta.porId(c(), id)).toMatchObject({
      situacao: 'encerrada',
      motivoEncerramento: 'concluida',
    });
  });
});
