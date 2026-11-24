// Integração da porta PRÓPRIA da agenda contra o MariaDB real, no cliente de teste da onda 1 (f22_o1, já criado por
// `python3 -I tools/db/criar_cliente.py`). A massa é SINTÉTICA e própria do lote (estabelecimentos l0104 e l0104b,
// códigos com o prefixo l0104), montada de forma idempotente no beforeAll; os registros de agenda do lote são limpos
// antes e depois. Contrato de efeito: linhas, versao, trilha e outbox de cada gravação, e as recusas (conflito de
// versão, entrada inválida, outro estabelecimento). A mesma bateria básica roda também na porta em memória.
// SGH_NUCLEO_SEM_BANCO=1 pula a parte do banco.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoGravacao, PortaAgenda } from './porta.js';
import { pacientesSinteticos } from './modulo.js';
import { PortaAgendaMemoria } from './porta-memoria.js';
import { instanteDe, localDe, PortaAgendaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'l0104';
const EST_B = 'l0104b';
const LOGIN = 'teste.l0104';
const DIA = '2030-03-12'; // terça-feira
const FUSO = 'America/Sao_Paulo';
/** Relógio da porta: véspera do dia da grade, 09:00 locais. */
const AGORA = instanteDe(FUSO, '2030-03-11', '09:00');

let chave = 0;
const ctx = (hospital = EST): ContextoGravacao => ({
  rede: 'teste',
  hospital,
  login: LOGIN,
  correlacao: `teste-l0104-${chave}`,
  chaveIdempotencia: `l0104-${randomUUID()}-${++chave}`,
});

const recusada = (codigo: string, status = 409) => ({
  problema: expect.objectContaining({ codigo, status }),
});

describe('instantes no fuso do estabelecimento', () => {
  it('converte a hora local em instante e volta', () => {
    const i = instanteDe(FUSO, DIA, '08:15');
    expect(i.toISOString()).toBe('2030-03-12T11:15:00.000Z');
    expect(localDe(FUSO, i)).toEqual({ data: DIA, hora: '08:15' });
  });
});

interface Fixture {
  readonly porta: PortaAgenda;
  readonly agenda: number;
  readonly paciente: number;
  readonly outro: number;
  readonly convenio: number;
  readonly data: string;
  readonly hora: string;
  /** Dia sem grade, para o bloqueio de período do teste do encaixe. */
  readonly outroDia: string;
  readonly c: () => ContextoGravacao;
}

/** A mesma bateria básica nas duas portas: marcar, disputa do horário, cancelar devolve a vaga. */
function bateria(nome: string, fixture: () => Fixture) {
  describe(`bateria comum: ${nome}`, () => {
    it('marca, recusa o mesmo horário, cancela e a vaga volta', async () => {
      const f = fixture();
      const antes = (await f.porta.vagas(f.c(), { agendas: [f.agenda], de: f.data, ate: f.data })).itens
        .length;
      const pedido = {
        agenda: f.agenda,
        data: f.data,
        hora: f.hora,
        convenio: f.convenio,
        retorno: false,
        canal: 'telefone',
      };
      const m = await f.porta.executar(f.c(), 'agenda.agendarConsulta', { ...pedido, paciente: f.paciente });
      const id = Number(m.resultado['marcacao']);
      expect(id).toBeGreaterThan(0);
      await expect(
        f.porta.executar(f.c(), 'agenda.agendarConsulta', { ...pedido, paciente: f.outro }),
      ).rejects.toMatchObject(recusada('horario-ocupado'));
      expect(
        (await f.porta.vagas(f.c(), { agendas: [f.agenda], de: f.data, ate: f.data })).itens.length,
      ).toBe(antes - 1);
      const lida = await f.porta.marcacao(f.c(), id);
      expect(lida?.marcacao).toMatchObject({
        agenda: f.agenda,
        hora: f.hora,
        situacao: 'marcada',
        canal: 'telefone',
      });
      await f.porta.executar(f.c(), 'agenda.cancelarConsulta', {
        marcacao: id,
        motivo: 'PAC-DESISTIU',
        solicitante: 'paciente',
      });
      expect(
        (await f.porta.vagas(f.c(), { agendas: [f.agenda], de: f.data, ate: f.data })).itens.length,
      ).toBe(antes);
    });

    it('o encaixe não passa por cima de bloqueio de período ativo', async () => {
      const f = fixture();
      const id = await f.porta.gravar(f.c(), (g) =>
        g.gravarBloqueioPeriodo({
          agenda: f.agenda,
          inicio: f.outroDia,
          fim: f.outroDia,
          horaInicio: null,
          horaFim: null,
          motivo: 'CONGRESSO',
          complemento: null,
          previsaoRetorno: null,
        }),
      );
      try {
        await expect(
          f.porta.executar(f.c(), 'agenda.encaixar', {
            agenda: f.agenda,
            data: f.outroDia,
            hora: '10:00',
            paciente: f.outro,
            convenio: f.convenio,
            retorno: false,
            canal: 'presencial',
            motivo: 'Encaixe no período bloqueado',
          }),
        ).rejects.toMatchObject(recusada('horario-bloqueado'));
      } finally {
        await f.porta.gravar(f.c(), (g) => g.encerrarBloqueio({ agenda: f.agenda, id }));
      }
    });

    it('entrada inválida é recusada antes de gravar', async () => {
      const f = fixture();
      await expect(
        f.porta.executar(f.c(), 'agenda.agendarConsulta', { agenda: f.agenda, data: f.data, hora: '25:00' }),
      ).rejects.toMatchObject({ problema: expect.objectContaining({ status: 400 }) });
    });
  });
}

const memoria = new PortaAgendaMemoria(
  null,
  async (_c, ids) => pacientesSinteticos(ids),
  () => ({
    hoje: '2026-10-21',
    hora: '07:00',
  }),
);
bateria('memória', () => ({
  porta: memoria,
  agenda: 901,
  paciente: 1001,
  outro: 1002,
  convenio: 10,
  data: '2026-10-22',
  hora: '08:00',
  outroDia: '2026-10-23',
  c: () => ctx('aa'),
}));

describe.skipIf(SEM_BANCO)('porta própria da agenda contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAgendaPropria;
  const ids = {
    est: 0,
    estB: 0,
    agenda: 0,
    agendaB: 0,
    pacienteA: 0,
    pacienteB: 0,
    profissional: 0,
    localB: 0,
    unidadeB: 0,
  };
  let geracao = 0;

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

  /** Apaga os registros de agenda dos estabelecimentos do lote (as tabelas de domínio e cadastros ficam). */
  async function limpar(e: Escritor) {
    if (ids.pacienteB)
      await e.executar('DELETE FROM paciente_prioridade_legal WHERE paciente_id = ?', [ids.pacienteB]);
    for (const est of [ids.est, ids.estB]) {
      if (!est) continue;
      await e.executar('DELETE FROM feriado WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM dia_nao_util WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM confirmacao_marcacao WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM cancelamento_marcacao WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        'DELETE h FROM lista_espera_historico h JOIN lista_espera l ON l.id = h.lista_espera_id WHERE l.estabelecimento_id = ?',
        [est],
      );
      await e.executar('UPDATE lista_espera SET marcacao_horario_id = NULL WHERE estabelecimento_id = ?', [
        est,
      ]);
      await e.executar(
        'UPDATE marcacao_horario SET lista_espera_id = NULL, remarcada_marcacao_horario_id = NULL WHERE estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM lista_espera WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM marcacao_horario WHERE estabelecimento_id = ?', [est]);
      await e.executar('UPDATE horario_agenda SET bloqueio_agenda_id = NULL WHERE estabelecimento_id = ?', [
        est,
      ]);
      await e.executar('DELETE FROM horario_agenda WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM bloqueio_agenda WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        'DELETE p FROM geracao_grade_periodo p JOIN geracao_grade g ON g.id = p.geracao_grade_id WHERE g.estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM geracao_grade WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        `DELETE x FROM agenda_escala x JOIN agenda_servico a ON a.id = x.agenda_servico_id WHERE a.estabelecimento_id = ?`,
        [est],
      );
      await e.executar(
        `DELETE x FROM agenda_fonte_pagadora x JOIN agenda_servico a ON a.id = x.agenda_servico_id WHERE a.estabelecimento_id = ?`,
        [est],
      );
      await e.executar(
        `DELETE x FROM agenda_especialidade x JOIN agenda_servico a ON a.id = x.agenda_servico_id WHERE a.estabelecimento_id = ?`,
        [est],
      );
      await e.executar(
        `UPDATE agenda_servico SET ativo = TRUE, duracao_horario_minutos = 15, teleatendimento = FALSE,
           local_atendimento_id = NULL, unidade_assistencial_id = NULL, profissional_id = ?, versao = 1
         WHERE estabelecimento_id = ?`,
        [ids.profissional, est],
      );
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = 'marcacao_horario'",
        [est],
      );
    }
  }

  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0104-conferir' }, async (l) =>
      Number((await l.uma<{ n: number }>(sql, p))?.n ?? 0),
    );
  const linha = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0104-conferir' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-l0104' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      ids.est = await est(EST);
      ids.estB = await est(EST_B);
      await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [LOGIN, 'USUARIO SINTETICO L0104', agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pf = await pessoa('PROFISSIONAL SINTETICO L0104');
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      const paciente = async (nome: string, prontuario: number) => {
        const p = await pessoa(nome);
        return garantir(
          e,
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [p],
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [p, prontuario, agora],
        );
      };
      ids.pacienteA = await paciente('PACIENTE SINTETICO L0104 A', 9104001);
      ids.pacienteB = await paciente('PACIENTE SINTETICO L0104 B', 9104002);
      const dominio = (tabela: string, codigo: string, extra: Record<string, unknown> = {}) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, descricao, ${[...Object.keys(extra), 'criado_em'].join(', ')}) VALUES (?, ?, ${[
            ...Object.keys(extra),
            'x',
          ]
            .map(() => '?')
            .join(', ')})`,
          [codigo, `Sintético ${codigo}`, ...Object.values(extra), agora],
        );
      const categoria = await dominio('categoria_agenda', 'l0104-consulta');
      for (const [sig, cod] of [
        ['aguardando', 'l0104-aguardando'],
        ['confirmada', 'l0104-confirmada'],
        ['cancelada', 'l0104-cancelada'],
        ['falta', 'l0104-falta'],
      ] as const) {
        const ja = await e.uma('SELECT id FROM situacao_marcacao WHERE significado = ? AND ativo', [sig]);
        if (!ja) await dominio('situacao_marcacao', cod, { significado: sig });
      }
      for (const nat of ['primeira_vez', 'retorno', 'encaixe']) {
        const ja = await e.uma('SELECT id FROM tipo_marcacao WHERE natureza = ? AND ativo', [nat]);
        if (!ja) await dominio('tipo_marcacao', `l0104-${nat}`, { natureza: nat });
      }
      for (const sig of ['confirmada', 'sem_resposta', 'recusada']) {
        const ja = await e.uma('SELECT id FROM situacao_confirmacao WHERE significado = ? AND ativo', [sig]);
        if (!ja) await dominio('situacao_confirmacao', `l0104-${sig}`, { significado: sig });
      }
      for (const c of ['telefone', 'presencial', 'whatsapp']) await dominio('canal_marcacao', c);
      for (const m of ['PAC-DESISTIU', 'PAC-OUTRA-DATA', 'ENCAIXE-DESFEITO'])
        await dominio('motivo_cancelamento_operacao', m);
      await dominio('motivo_bloqueio_agenda', 'CONGRESSO');
      for (const fp of ['9141', '9142'])
        await garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [fp],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
          [fp, `CONVENIO SINTETICO ${fp}`, agora],
        );
      await garantir(
        e,
        "SELECT id FROM especialidade_medica WHERE codigo = '97'",
        [],
        "INSERT INTO especialidade_medica (codigo, descricao, tipo, criado_em) VALUES ('97', 'ESPECIALIDADE SINTETICA L0104', 'medica', ?)",
        [agora],
      );
      const agenda = (est: number, nome: string) =>
        garantir(
          e,
          'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
          [est, nome],
          `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em)
           VALUES (?, ?, ?, ?, 15, ?)`,
          [est, nome, categoria, ids.profissional, agora],
        );
      const recepcaoB = await garantir(
        e,
        'SELECT id FROM ponto_recepcao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.estB, 'L0104B-REC'],
        'INSERT INTO ponto_recepcao (estabelecimento_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids.estB, 'L0104B-REC', 'Recepção sintética L0104B', agora],
      );
      ids.localB = await garantir(
        e,
        'SELECT id FROM local_atendimento WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.estB, 'L0104B-CONS'],
        'INSERT INTO local_atendimento (estabelecimento_id, ponto_recepcao_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?, ?)',
        [ids.estB, recepcaoB, 'L0104B-CONS', 'Consultório sintético L0104B', agora],
      );
      ids.unidadeB = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.estB, 'L0104B-AMB'],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'ambulatorio', ?)",
        [ids.estB, 'L0104B-AMB', 'Ambulatório sintético L0104B', agora],
      );
      ids.agenda = await agenda(ids.est, 'CLINICA SINTETICA L0104 A');
      ids.agendaB = await agenda(ids.estB, 'CLINICA SINTETICA L0104 B');
      await limpar(e);
    });
    porta = new PortaAgendaPropria(nucleo, CLIENTE, () => AGORA);
    const r = await porta.executar(ctx(), 'agenda.gerarGrade', {
      agenda: ids.agenda,
      de: DIA,
      ate: DIA,
      duracao: '00:15',
      horarios: ['08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45'].map((hora) => ({
        data: DIA,
        hora,
      })),
      escala: [
        {
          semana: 3,
          duracao: '00:15',
          horaInicio: '08:00',
          horaFim: '10:00',
          intervaloInicio: null,
          intervaloFim: null,
        },
      ],
      semanas: ['F', 'F', 'T', 'F', 'F', 'F', 'F'],
    });
    geracao = Number(r.resultado['geracao']);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-l0104' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  bateria('própria (MariaDB)', () => ({
    porta,
    agenda: ids.agenda,
    paciente: ids.pacienteA,
    outro: ids.pacienteB,
    convenio: 9141,
    data: DIA,
    hora: '09:45',
    outroDia: '2030-03-13',
    c: () => ctx(),
  }));

  it('02-AGE 41: a grade pula o feriado e o dia não útil do próprio estabelecimento; ponto facultativo, meio expediente e outro estabelecimento não', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-l0104-feriado' }, async (e) => {
      const agora = new Date();
      const fer = (data: string, nome: string, est: number, facultativo = false) =>
        e.inserir(
          "INSERT INTO feriado (data, nome, abrangencia, estabelecimento_id, ponto_facultativo, criado_em) VALUES (?, ?, 'estabelecimento', ?, ?, ?)",
          [data, nome, est, facultativo, agora],
        );
      await fer('2030-08-06', 'Feriado sintético L0104', ids.est);
      await fer('2030-08-07', 'Facultativo sintético L0104', ids.est, true);
      await fer('2030-08-08', 'Feriado de outro estabelecimento', ids.estB);
      const dnu = (descricao: string, dia: number, inicio: string | null) =>
        e.inserir(
          "INSERT INTO dia_nao_util (descricao, abrangencia, estabelecimento_id, recorrencia, dia, mes, hora_inicio, hora_fim, criado_em) VALUES (?, 'estabelecimento', ?, 'anual', ?, 8, ?, ?, ?)",
          [descricao, ids.est, dia, inicio, inicio ? '18:00' : null, agora],
        );
      await dnu('Aniversário sintético L0104', 13, null);
      await dnu('Meio expediente sintético L0104', 14, '13:00');
    });
    const r = await porta.feriados(ctx(), '2030-08-01', '2031-08-31');
    const datas = r.map((f) => f.data);
    expect(datas).toContain('2030-08-06');
    expect(datas).toContain('2030-08-13');
    expect(datas).toContain('2031-08-13');
    expect(datas).not.toContain('2030-08-07');
    expect(datas).not.toContain('2030-08-08');
    expect(datas).not.toContain('2030-08-14');
    expect(r.find((f) => f.data === '2030-08-06')?.nome).toBe('Feriado sintético L0104');
    // Os nacionais continuam.
    expect(datas).toContain('2030-09-07');
    // O outro estabelecimento vê o seu, e não o deste.
    const b = (await porta.feriados(ctx(EST_B), '2030-08-01', '2030-08-31')).map((f) => f.data);
    expect(b).toContain('2030-08-08');
    expect(b).not.toContain('2030-08-06');
  });

  it('gerar a grade: horários, geração, trilha e outbox; repetir a chave não grava de novo; prévia velha é recusada', async () => {
    expect(geracao).toBeGreaterThan(0);
    expect(
      await contar('SELECT COUNT(*) AS n FROM horario_agenda WHERE geracao_grade_id = ?', [geracao]),
    ).toBe(8);
    expect(
      await linha('SELECT horarios_gerados, situacao, versao FROM geracao_grade WHERE id = ?', [geracao]),
    ).toMatchObject({
      horarios_gerados: 8,
      situacao: 'concluida',
      versao: 1,
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'geracao_grade' AND entidade_id = ?",
        [geracao],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'agenda.grade.gerada' AND entidade_id = ?",
        [geracao],
      ),
    ).toBe(1);
    const c = ctx();
    const entrada = {
      agenda: ids.agenda,
      de: DIA,
      ate: DIA,
      duracao: '00:15',
      horarios: [{ data: DIA, hora: '08:00' }],
      escala: [
        {
          semana: 3,
          duracao: '00:15',
          horaInicio: '08:00',
          horaFim: '10:00',
          intervaloInicio: null,
          intervaloFim: null,
        },
      ],
      semanas: ['F', 'F', 'T', 'F', 'F', 'F', 'F'],
    };
    await expect(porta.executar(c, 'agenda.gerarGrade', entrada)).rejects.toMatchObject(
      recusada('previa-desatualizada'),
    );
    const g = (await porta.geracoes(ctx(), ids.agenda))[0];
    expect(g).toMatchObject({
      id: geracao,
      horarios: 8,
      diasSemana: [3],
      duracaoMinutos: 15,
      revertidaEm: null,
    });
  });

  it('lê a agenda, a grade e as vagas no fuso do estabelecimento; outro estabelecimento não vê', async () => {
    const a = await porta.agenda(ctx(), ids.agenda);
    expect(a).toMatchObject({
      ativa: true,
      duracaoMinutos: 15,
      profissional: ids.profissional,
      gradeInicio: DIA,
    });
    const h = await porta.horarios(ctx(), ids.agenda, DIA, DIA);
    expect(h.itens.map((x) => x.hora).slice(0, 2)).toEqual(['08:00', '08:15']);
    expect(await porta.relogio(ctx())).toEqual({ hoje: '2030-03-11', hora: '09:00' });
    expect(await porta.agenda(ctx(EST_B), ids.agenda)).toBeNull();
    await expect(
      porta.executar(ctx(EST_B), 'agenda.agendarConsulta', {
        agenda: ids.agenda,
        data: DIA,
        hora: '08:00',
        paciente: ids.pacienteA,
        convenio: 9141,
        retorno: false,
        canal: 'telefone',
      }),
    ).rejects.toMatchObject(recusada('registro-inexistente', 404));
  });

  it('02-AGE 49: a marcação grava a prioridade legal sugerida pelo cadastro do paciente e a mostra; grupo informado inválido é recusado sem gravar', async () => {
    const grupo = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-l0104-prioridade' },
      async (e) => {
        const agora = new Date();
        const g = await garantir(
          e,
          'SELECT id FROM grupo_prioridade_legal WHERE codigo = ?',
          ['l0104-gestante'],
          'INSERT INTO grupo_prioridade_legal (codigo, descricao, peso, criado_em) VALUES (?, ?, 2, ?)',
          ['l0104-gestante', 'Gestante (sintético L0104)', agora],
        );
        await e.inserir(
          'INSERT INTO paciente_prioridade_legal (paciente_id, grupo_prioridade_legal_id, vigencia_inicio, vigencia_fim, criado_em) VALUES (?, ?, ?, ?, ?)',
          [ids.pacienteB, g, '2030-01-01', '2030-09-30', agora],
        );
        return g;
      },
    );
    const pedido = {
      agenda: ids.agenda,
      data: DIA,
      hora: '08:45',
      paciente: ids.pacienteB,
      convenio: 9141,
      retorno: false,
      canal: 'telefone',
    };
    const antes = await contar('SELECT COUNT(*) AS n FROM marcacao_horario WHERE paciente_id = ?', [
      ids.pacienteB,
    ]);
    await expect(
      porta.executar(ctx(), 'agenda.agendarConsulta', { ...pedido, prioridadeLegal: 999_999_999 }),
    ).rejects.toMatchObject(recusada('prioridade-invalida'));
    expect(
      await contar('SELECT COUNT(*) AS n FROM marcacao_horario WHERE paciente_id = ?', [ids.pacienteB]),
    ).toBe(antes);
    const m = await porta.executar(ctx(), 'agenda.agendarConsulta', pedido);
    const id = Number(m.resultado['marcacao']);
    expect(
      await linha('SELECT grupo_prioridade_legal_id FROM marcacao_horario WHERE id = ?', [id]),
    ).toMatchObject({
      grupo_prioridade_legal_id: grupo,
    });
    const lida = await porta.marcacao(ctx(), id);
    expect(lida?.marcacao.prioridadeLegal).toBe('Gestante (sintético L0104)');
    await porta.executar(ctx(), 'agenda.cancelarConsulta', {
      marcacao: id,
      motivo: 'PAC-DESISTIU',
      solicitante: 'paciente',
    });
  });

  it('marcar grava a marcação com número de negócio e ocupa o horário (versao, trilha); confirmar e remarcar liberando', async () => {
    const m = await porta.executar(ctx(), 'agenda.agendarConsulta', {
      agenda: ids.agenda,
      data: DIA,
      hora: '08:00',
      paciente: ids.pacienteA,
      convenio: 9141,
      retorno: false,
      canal: 'telefone',
      observacao: 'Recado sintético',
    });
    const id = Number(m.resultado['marcacao']);
    expect(
      await linha('SELECT numero, versao, encaixe, duracao_minutos FROM marcacao_horario WHERE id = ?', [id]),
    ).toMatchObject({
      numero: expect.stringMatching(/^MC-\d+$/),
      versao: 1,
      duracao_minutos: 15,
    });
    expect(
      await linha(
        'SELECT h.situacao, h.vagas_ocupadas, h.versao FROM horario_agenda h JOIN marcacao_horario m ON m.horario_agenda_id = h.id WHERE m.id = ?',
        [id],
      ),
    ).toMatchObject({ situacao: 'ocupado', vagas_ocupadas: 1, versao: 2 });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'marcacao_horario' AND entidade_id = ?",
        [id],
      ),
    ).toBe(1);
    await porta.executar(ctx(), 'agenda.confirmarConsulta', { marcacao: id });
    expect((await porta.marcacao(ctx(), id))?.marcacao.situacao).toBe('confirmada');
    expect((await porta.confirmacoes(ctx(), id))[0]).toMatchObject({ resultado: 'confirmado', por: LOGIN });
    const r = await porta.executar(ctx(), 'agenda.remarcarConsulta', {
      marcacao: id,
      destino: { agenda: ids.agenda, data: DIA, hora: '08:15' },
      modo: 'liberar',
      canal: 'telefone',
    });
    const nova = Number(r.resultado['marcacao']);
    expect((await porta.complementos(ctx(), [nova])).get(nova)).toMatchObject({
      remarcadaDe: id,
      modoRemarcacao: 'liberar',
    });
    expect(
      await linha(
        'SELECT horario_liberado, nova_marcacao_horario_id FROM cancelamento_marcacao WHERE marcacao_horario_id = ?',
        [id],
      ),
    ).toMatchObject({ nova_marcacao_horario_id: nova });
    const grade = await porta.horarios(ctx(), ids.agenda, DIA, DIA);
    expect(grade.itens.find((x) => x.hora === '08:00')).toMatchObject({ marcacao: null, paciente: null });
    expect(grade.itens.find((x) => x.hora === '08:15')).toMatchObject({
      marcacao: nova,
      situacao: 'marcada',
    });
    const canc = await porta.cancelamentos(ctx(), {
      de: '2030-03-11',
      ate: '2030-03-11',
      agendas: [ids.agenda],
      pagina: 1,
      porPagina: 50,
    });
    void canc; // O cancelamento é gravado com o relógio real do servidor (o dia de hoje), não o da porta.
    await expect(porta.executar(ctx(), 'agenda.registrarFalta', { marcacao: nova })).rejects.toMatchObject(
      recusada('consulta-futura'),
    );
    const depois = new PortaAgendaPropria(nucleo, CLIENTE, () => instanteDe(FUSO, DIA, '12:00'));
    await depois.executar(ctx(), 'agenda.registrarFalta', { marcacao: nova });
    expect((await porta.marcacao(ctx(), nova))?.marcacao.situacao).toBe('falta');
  });

  it('cobertura: convênio não aceito é recusado; o último só sai com confirmação', async () => {
    await porta.executar(ctx(), 'agenda.definirCobertura', {
      agenda: ids.agenda,
      convenio: 9142,
      acao: 'incluir',
    });
    expect((await porta.cobertura(ctx(), [ids.agenda])).get(ids.agenda)).toEqual([9142]);
    await expect(
      porta.executar(ctx(), 'agenda.agendarConsulta', {
        agenda: ids.agenda,
        data: DIA,
        hora: '08:30',
        paciente: ids.pacienteA,
        convenio: 9141,
        retorno: false,
        canal: 'telefone',
      }),
    ).rejects.toMatchObject(recusada('convenio-nao-aceito'));
    await expect(
      porta.executar(ctx(), 'agenda.definirCobertura', {
        agenda: ids.agenda,
        convenio: 9142,
        acao: 'remover',
      }),
    ).rejects.toMatchObject(recusada('confirmar-aceitar-todos'));
    await porta.executar(ctx(), 'agenda.definirCobertura', {
      agenda: ids.agenda,
      convenio: 9142,
      acao: 'remover',
      confirmarAceitarTodos: true,
    });
    expect((await porta.cobertura(ctx(), [ids.agenda])).size).toBe(0);
  });

  it('encaixe cria o horário em ordem e desfazer o cancela; bloquear e desbloquear horários vagos', async () => {
    const e = await porta.executar(ctx(), 'agenda.encaixar', {
      agenda: ids.agenda,
      data: DIA,
      hora: '08:30',
      paciente: ids.pacienteB,
      convenio: 9141,
      retorno: false,
      canal: 'presencial',
      motivo: 'Retorno com exame urgente',
    });
    const id = Number(e.resultado['marcacao']);
    expect(
      await linha(
        'SELECT h.tipo_horario, h.encaixe_ordem FROM horario_agenda h JOIN marcacao_horario m ON m.horario_agenda_id = h.id WHERE m.id = ?',
        [id],
      ),
    ).toMatchObject({ tipo_horario: 'encaixe', encaixe_ordem: 1 });
    await porta.executar(ctx(), 'agenda.desfazerEncaixe', { marcacao: id });
    expect(
      await linha(
        'SELECT h.situacao FROM horario_agenda h JOIN marcacao_horario m ON m.horario_agenda_id = h.id WHERE m.id = ?',
        [id],
      ),
    ).toMatchObject({ situacao: 'cancelado' });
    const horarios = [
      { data: DIA, hora: '09:00' },
      { data: DIA, hora: '09:15' },
    ];
    await porta.executar(ctx(), 'agenda.bloquearHorarios', {
      agenda: ids.agenda,
      acao: 'bloquear',
      horarios,
      motivo: 'CONGRESSO',
    });
    await expect(
      porta.executar(ctx(), 'agenda.encaixar', {
        agenda: ids.agenda,
        data: DIA,
        hora: '09:00',
        paciente: ids.pacienteB,
        convenio: 9141,
        retorno: false,
        canal: 'presencial',
        motivo: 'Encaixe no horário bloqueado',
      }),
    ).rejects.toMatchObject(recusada('horario-bloqueado'));
    const [b] = await porta.bloqueios(ctx(), { agenda: ids.agenda, ativos: true });
    expect(b).toMatchObject({ motivo: 'CONGRESSO', horarios: 2, ativo: true, autor: LOGIN });
    expect((await porta.horariosDoBloqueio(ctx(), b?.id ?? 0)).map((h) => h.hora)).toEqual([
      '09:00',
      '09:15',
    ]);
    await porta.executar(ctx(), 'agenda.bloquearHorarios', {
      agenda: ids.agenda,
      acao: 'desbloquear',
      horarios,
      motivo: 'CONGRESSO',
    });
    expect(await linha('SELECT situacao FROM bloqueio_agenda WHERE id = ?', [b?.id])).toMatchObject({
      situacao: 'desbloqueado',
    });
  });

  it('alterar a agenda confere os valores lidos (conflito de versão) e grava com versão nova', async () => {
    await expect(
      porta.executar(ctx(), 'agenda.alterarAgenda', {
        agenda: ids.agenda,
        lidos: { duracaoMinutos: 20, ativa: true, teleatendimento: false },
        valores: { teleatendimento: true },
      }),
    ).rejects.toMatchObject(recusada('conflito-versao'));
    await porta.executar(ctx(), 'agenda.alterarAgenda', {
      agenda: ids.agenda,
      lidos: { duracaoMinutos: 15, ativa: true, teleatendimento: false },
      valores: { teleatendimento: true },
    });
    expect(
      await linha('SELECT teleatendimento, versao FROM agenda_servico WHERE id = ?', [ids.agenda]),
    ).toMatchObject({
      teleatendimento: 1,
      versao: 2,
    });
  });

  it('gravações de apoio: escala planejada, fila de espera com oferta, vínculo e bloqueio de período', async () => {
    const r = await porta.gravar(ctx(), async (g) => {
      const escala = await g.planejarEscala({
        agenda: ids.agenda,
        vigenteDesde: '2030-04-01',
        faixas: [
          {
            diaSemana: 2,
            duracaoMinutos: 20,
            inicio: '08:00',
            fim: '12:00',
            intervaloInicio: null,
            intervaloFim: null,
          },
        ],
      });
      const espera = await g.incluirEspera({
        paciente: ids.pacienteA,
        agenda: ids.agenda,
        especialidade: null,
        prioridade: 'urgente',
        observacao: null,
      });
      await g.ofertarEspera({ id: espera, agenda: ids.agenda, data: DIA, hora: '09:30' });
      await g.gravarVinculo({
        agenda: ids.agenda,
        profissional: ids.profissional,
        especialidade: 97,
        local: null,
        unidade: null,
      });
      const periodo = await g.gravarBloqueioPeriodo({
        agenda: ids.agenda,
        inicio: '2030-05-01',
        fim: '2030-05-03',
        horaInicio: null,
        horaFim: null,
        motivo: 'CONGRESSO',
        complemento: null,
        previsaoRetorno: '2030-05-04',
      });
      return { escala, espera, periodo };
    });
    const [p] = await porta.escalasPlanejadas(ctx(), ids.agenda);
    expect(p).toMatchObject({ id: r.escala, vigenteDesde: '2030-04-01', autor: LOGIN });
    expect(p?.faixas[0]).toMatchObject({ diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMinutos: 20 });
    const [e] = await porta.espera(ctx(), { situacoes: ['ofertado'] });
    expect(e).toMatchObject({
      id: r.espera,
      prioridade: 'urgente',
      oferta: { agenda: ids.agenda, data: DIA, hora: '09:30' },
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM lista_espera_historico WHERE lista_espera_id = ?', [r.espera]),
    ).toBe(2);
    expect((await porta.vinculos(ctx())).get(ids.agenda)).toMatchObject({
      especialidade: 97,
      situacao: 'revisada',
    });
    const b = (await porta.bloqueios(ctx(), { agenda: ids.agenda, ativos: true })).find(
      (x) => x.id === r.periodo,
    );
    expect(b).toMatchObject({ inicio: '2030-05-01', fim: '2030-05-03', horaInicio: null, horarios: 0 });
    await porta.gravar(ctx(), async (g) => {
      await g.cancelarEscalaPlanejada({ agenda: ids.agenda, id: r.escala });
      await g.encerrarEspera({ id: r.espera, situacao: 'cancelado', marcacao: null });
      await g.encerrarBloqueio({ agenda: ids.agenda, id: r.periodo });
    });
    expect(await porta.escalasPlanejadas(ctx(), ids.agenda)).toEqual([]);
    expect(await porta.espera(ctx(), { situacoes: ['aguardando', 'ofertado'] })).toEqual([]);
    await expect(
      porta.gravar(ctx(), (g) => g.encerrarBloqueio({ agenda: ids.agenda, id: r.periodo })),
    ).rejects.toMatchObject(recusada('bloqueio-inexistente'));
  });

  it('o vínculo da agenda recusa local e unidade de outro estabelecimento', async () => {
    for (const [local, unidade] of [
      [ids.localB, null],
      [null, ids.unidadeB],
    ] as const)
      await expect(
        porta.gravar(ctx(), (g) =>
          g.gravarVinculo({
            agenda: ids.agenda,
            profissional: ids.profissional,
            especialidade: null,
            local,
            unidade,
          }),
        ),
      ).rejects.toMatchObject(recusada('local-de-outro-estabelecimento'));
    expect(
      await linha('SELECT local_atendimento_id, unidade_assistencial_id FROM agenda_servico WHERE id = ?', [
        ids.agenda,
      ]),
    ).toMatchObject({ local_atendimento_id: null, unidade_assistencial_id: null });
  });

  it('reverter a geração tira só os horários vagos sem marcação, uma vez', async () => {
    const r = await porta.executar(ctx(), 'agenda.reverterGrade', { geracao });
    expect(Number(r.resultado['removidos']) + Number(r.resultado['mantidos'])).toBe(8);
    expect(Number(r.resultado['mantidos'])).toBeGreaterThan(0);
    expect(await linha('SELECT situacao, versao FROM geracao_grade WHERE id = ?', [geracao])).toMatchObject({
      situacao: 'revertida',
      versao: 2,
    });
    await expect(porta.executar(ctx(), 'agenda.reverterGrade', { geracao })).rejects.toMatchObject(
      recusada('geracao-revertida'),
    );
    // Depois de reverter, a grade do mesmo período é gerada de novo nos horários que saíram.
    const vivos = new Set(
      (
        await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0104-conferir' }, (l) =>
          l.consultar(
            'SELECT inicio_em FROM horario_agenda WHERE agenda_servico_id = ? AND data_referencia = ? AND excluido_em IS NULL AND encaixe_ordem = 0',
            [ids.agenda, DIA],
          ),
        )
      ).map(
        (x) =>
          localDe(FUSO, x['inicio_em'] instanceof Date ? x['inicio_em'] : new Date(String(x['inicio_em'])))
            .hora,
      ),
    );
    const livres = ['08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45'].filter(
      (h) => !vivos.has(h),
    );
    expect(livres.length).toBe(Number(r.resultado['removidos']));
    const n = await porta.executar(ctx(), 'agenda.gerarGrade', {
      agenda: ids.agenda,
      de: DIA,
      ate: DIA,
      duracao: '00:15',
      horarios: livres.map((hora) => ({ data: DIA, hora })),
      escala: [
        {
          semana: 3,
          duracao: '00:15',
          horaInicio: '08:00',
          horaFim: '10:00',
          intervaloInicio: null,
          intervaloFim: null,
        },
      ],
      semanas: ['F', 'F', 'T', 'F', 'F', 'F', 'F'],
    });
    expect(Number(n.resultado['horarios'])).toBe(livres.length);
    expect(
      await contar('SELECT COUNT(*) AS n FROM horario_agenda WHERE geracao_grade_id = ?', [
        Number(n.resultado['geracao']),
      ]),
    ).toBe(livres.length);
  });

  it('ADR 0009, decisão 25 na marcação (agenda.encaixar): alerta sem credenciamento; bloqueio do convênio recusa sem gravar; credenciado só num plano, com a marcação sem plano, só alerta', async () => {
    const op = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-l0104-cred' }, async (e) => {
      const agora = new Date();
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        ['9143'],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES ('9143', 'OPERADORA SINTETICA 9143', 'operadora', 'ativa', ?)",
        [agora],
      );
      const plano = await garantir(
        e,
        'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ?',
        [fonte, 'L0104-PL'],
        "INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, 'L0104-PL', 'PLANO SINTETICO L0104', ?)",
        [fonte, agora],
      );
      await e.executar('DELETE FROM profissional_fonte_pagadora WHERE fonte_pagadora_id = ?', [fonte]);
      await e.executar(
        'UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = 0, credencia_todos_ao_criar = 0 WHERE id = ?',
        [fonte],
      );
      return { fonte, plano };
    });
    const escrever = (sql: string, p: unknown[]) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-l0104-cred' }, (e) => e.executar(sql, p));
    const marcacoes = () =>
      contar(
        'SELECT COUNT(*) AS n FROM marcacao_horario WHERE fonte_pagadora_id = ? AND excluido_em IS NULL',
        [op.fonte],
      );
    const encaixar = (hora: string, paciente: number) =>
      porta.executar(ctx(), 'agenda.encaixar', {
        agenda: ids.agenda,
        data: DIA,
        hora,
        paciente,
        convenio: 9143,
        retorno: false,
        canal: 'presencial',
        motivo: 'Encaixe sintético da decisão 25',
      });
    try {
      // Sem credenciamento e sem bloqueio: marca, com o alerta no resultado.
      const a = await encaixar('09:00', ids.pacienteA);
      expect(a.resultado).toMatchObject({ alerta: 'profissional-nao-credenciado' });
      expect(String(a.resultado['alertaMotivo'])).toMatch(/credenciamento/);
      // Com o bloqueio do convênio: recusa antes de gravar (nenhuma marcação nova).
      await escrever('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = 1 WHERE id = ?', [op.fonte]);
      const antes = await marcacoes();
      await expect(encaixar('09:15', ids.pacienteB)).rejects.toMatchObject(
        recusada('profissional-nao-credenciado'),
      );
      expect(await marcacoes()).toBe(antes);
      // Credenciado só no plano: a marcação não traz o plano, então só alerta (nunca o bloqueio).
      await escrever(
        `INSERT INTO profissional_fonte_pagadora (profissional_id, fonte_pagadora_id, plano_fonte_pagadora_id, vigencia_inicio,
           credenciado, criado_em) VALUES (?, ?, ?, '2020-01-01', TRUE, CURRENT_TIMESTAMP(3))`,
        [ids.profissional, op.fonte, op.plano],
      );
      const b = await encaixar('09:15', ids.pacienteB);
      expect(b.resultado).toMatchObject({ alerta: 'profissional-nao-credenciado' });
      expect(String(b.resultado['alertaMotivo'])).toMatch(/plano do paciente/);
      expect(await marcacoes()).toBe(antes + 1);
      // Credenciado no convênio inteiro: sem alerta.
      await escrever(
        `INSERT INTO profissional_fonte_pagadora (profissional_id, fonte_pagadora_id, vigencia_inicio, credenciado, criado_em)
         VALUES (?, ?, '2020-01-01', TRUE, CURRENT_TIMESTAMP(3))`,
        [ids.profissional, op.fonte],
      );
      const c = await encaixar('09:30', ids.pacienteA);
      expect(c.resultado['alerta']).toBeUndefined();
    } finally {
      await escrever('DELETE FROM profissional_fonte_pagadora WHERE fonte_pagadora_id = ?', [op.fonte]);
      await escrever('UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = 0 WHERE id = ?', [op.fonte]);
    }
  });
});
