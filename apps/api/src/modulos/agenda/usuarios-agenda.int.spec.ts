// Contrato de efeito da lista nominal de usuários por agenda (02-AGE linha 40) contra o MariaDB real, no cliente de
// teste (f22_o1 por padrão). Massa SINTÉTICA própria (estabelecimento f322u, logins teste.f322u.*), idempotente; os
// registros do lote são limpos antes e depois. Prova: a linha em agenda_usuario (pode_marcar, versao, exclusão
// lógica sem apagar), a trilha na mesma transação, as recusas do domínio, a agenda restrita sumindo da leitura (lista,
// detalhe, busca de vagas, painel do dia) de quem não está na lista, a marcação gravada por quem marca e recusada
// (marcar, encaixar, remarcar para ela, cancelar, confirmar, falta, bloquear, gerar grade) para quem só consulta ou
// está fora dela, o gestor que mantém sem marcar e o administrador da plataforma que pode tudo.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { instanteDe, PortaAgendaPropria } from './porta-propria.js';
import { UsuariosAgendaPropria } from './usuarios-agenda.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'f322u';
const LOGINS = { a: 'teste.f322u.a', b: 'teste.f322u.b', c: 'teste.f322u.c' } as const;
const FUSO = 'America/Sao_Paulo';
const DIA = '2030-03-12'; // terça-feira
const AGORA = instanteDe(FUSO, '2030-03-11', '09:00');
const CONVENIO = 9141;
const HORAS = ['08:00', '08:15', '08:30', '08:45'];
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('lista nominal de usuários por agenda (porta própria, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let usuarios: UsuariosAgendaPropria;
  let porta: PortaAgendaPropria;
  const ids = { est: 0, agenda: 0, livre: 0, a: 0, b: 0, c: 0, paciente: 0, marcacao: 0, naLivre: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const est = [ids.est];
    await e.executar(
      'DELETE au FROM agenda_usuario au JOIN agenda_servico a ON a.id = au.agenda_servico_id WHERE a.estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM confirmacao_marcacao WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM cancelamento_marcacao WHERE estabelecimento_id = ?', est);
    await e.executar(
      'UPDATE marcacao_horario SET remarcada_marcacao_horario_id = NULL WHERE estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM marcacao_horario WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM horario_agenda WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM bloqueio_agenda WHERE estabelecimento_id = ?', est);
    await e.executar(
      'DELETE p FROM geracao_grade_periodo p JOIN geracao_grade g ON g.id = p.geracao_grade_id WHERE g.estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM geracao_grade WHERE estabelecimento_id = ?', est);
    await e.executar(
      'DELETE x FROM agenda_escala x JOIN agenda_servico a ON a.id = x.agenda_servico_id WHERE a.estabelecimento_id = ?',
      est,
    );
    await e.executar(
      "DELETE FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = 'marcacao_horario'",
      est,
    );
  };
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-f322u' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctxU = (login: string, gestor = false, administrador = false) => ({
    hospital: EST,
    login,
    gestor,
    administrador,
  });
  const gravar = (login: string, entrada: Record<string, unknown>) =>
    usuarios.definir(
      { ...ctxU(login, true), correlacao: 'teste-f322u', chaveIdempotencia: `f322u-${randomUUID()}` },
      { agenda: ids.agenda, ...entrada },
    );
  const ctxPorta = (login: string, gestorDeAgendas = false, administrador = false) => ({
    rede: 'teste',
    hospital: EST,
    login,
    gestorDeAgendas,
    administrador,
    correlacao: 'teste-f322u',
    chaveIdempotencia: `f322u-${randomUUID()}`,
  });
  const marcacoes = async (agenda: number) =>
    Number(
      (
        await ler<{ n: number }>(
          `SELECT COUNT(*) AS n FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
            WHERE h.agenda_servico_id = ? AND m.excluido_em IS NULL`,
          [agenda],
        )
      )[0]?.n ?? 0,
    );
  const pedido = (agenda: number, hora: string) => ({
    agenda,
    data: DIA,
    hora,
    paciente: ids.paciente,
    convenio: CONVENIO,
    retorno: false,
    canal: 'telefone',
  });
  const gerarGrade = (login: string, agenda: number) =>
    porta.executar(ctxPorta(login), 'agenda.gerarGrade', {
      agenda,
      de: DIA,
      ate: DIA,
      duracao: '00:15',
      horarios: HORAS.map((hora) => ({ data: DIA, hora })),
      escala: [
        {
          semana: 3,
          duracao: '00:15',
          horaInicio: '08:00',
          horaFim: '09:00',
          intervaloInicio: null,
          intervaloFim: null,
        },
      ],
      semanas: ['F', 'F', 'T', 'F', 'F', 'F', 'F'],
    });
  const trilhas = async () =>
    Number(
      (
        await ler<{ n: number }>(
          "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'agenda_servico' AND entidade_id = ?",
          [ids.agenda],
        )
      )[0]?.n ?? 0,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f322u' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      for (const k of ['a', 'b', 'c'] as const)
        ids[k] = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [LOGINS[k]],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [LOGINS[k], `USUARIO SINTETICO F322U ${k.toUpperCase()}`, agora],
        );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PROFISSIONAL SINTETICO F322U'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PROFISSIONAL SINTETICO F322U', agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        ['f322u-consulta'],
        'INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['f322u-consulta', 'Sintético f322u', agora],
      );
      const agenda = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
          [ids.est, nome],
          `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em)
           VALUES (?, ?, ?, ?, 15, ?)`,
          [ids.est, nome, cat, prof, agora],
        );
      ids.agenda = await agenda('AGENDA SINTETICA F322U');
      ids.livre = await agenda('AGENDA SINTETICA F322U LIVRE');
      const pp = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PACIENTE SINTETICO F322U'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PACIENTE SINTETICO F322U', agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 9322001, agora],
      );
      await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [String(CONVENIO)],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [String(CONVENIO), `CONVENIO SINTETICO ${CONVENIO}`, agora],
      );
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
      for (const sig of ['aguardando', 'confirmada', 'cancelada', 'falta'])
        if (!(await e.uma('SELECT id FROM situacao_marcacao WHERE significado = ? AND ativo', [sig])))
          await dominio('situacao_marcacao', `f322u-${sig}`, { significado: sig });
      for (const nat of ['primeira_vez', 'retorno', 'encaixe'])
        if (!(await e.uma('SELECT id FROM tipo_marcacao WHERE natureza = ? AND ativo', [nat])))
          await dominio('tipo_marcacao', `f322u-${nat}`, { natureza: nat });
      await dominio('canal_marcacao', 'telefone');
      for (const m of ['PAC-DESISTIU', 'PAC-OUTRA-DATA']) await dominio('motivo_cancelamento_operacao', m);
      await dominio('motivo_bloqueio_agenda', 'CONGRESSO');
      await limpar(e);
    });
    usuarios = new UsuariosAgendaPropria(nucleo, CLIENTE);
    porta = new PortaAgendaPropria(nucleo, CLIENTE, () => AGORA);
    // Grade sintética nas duas agendas, gerada enquanto ainda são livres.
    await gerarGrade(LOGINS.a, ids.agenda);
    await gerarGrade(LOGINS.a, ids.livre);
    ids.naLivre = Number(
      (await porta.executar(ctxPorta(LOGINS.c), 'agenda.agendarConsulta', pedido(ids.livre, '08:00')))
        .resultado['marcacao'],
    );
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f322u' }, async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('agenda sem lista é livre: todos do escopo veem e a lista vem vazia', async () => {
    expect(await usuarios.lista(ctxU(LOGINS.c), ids.agenda)).toMatchObject({
      restrita: false,
      usuarios: [],
      meuAcesso: 'livre',
    });
    expect((await porta.agendas(ctxPorta(LOGINS.c))).map((a) => a.id)).toContain(ids.agenda);
  });

  it('a lista não nasce sem quem marca e não aceita usuário inexistente (nada gravado)', async () => {
    await expect(
      gravar(LOGINS.a, { acao: 'incluir', usuario: ids.b, podeMarcar: false }),
    ).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'lista-sem-quem-marca' }),
    });
    await expect(
      gravar(LOGINS.a, { acao: 'incluir', usuario: 999_999_999, podeMarcar: true }),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'usuario-inexistente' }) });
    expect(await ler('SELECT id FROM agenda_usuario WHERE agenda_servico_id = ?', [ids.agenda])).toHaveLength(
      0,
    );
  });

  it('inclui quem marca e quem só consulta: linhas, versão e trilha na mesma transação', async () => {
    const t0 = await trilhas();
    expect((await gravar(LOGINS.a, { acao: 'incluir', usuario: ids.a, podeMarcar: true })).resultado).toEqual(
      {
        agenda: ids.agenda,
        usuarios: 1,
      },
    );
    await gravar(LOGINS.a, { acao: 'incluir', usuario: ids.b, podeMarcar: false });
    const linhas = await ler<{
      usuario_id: number;
      pode_marcar: number;
      versao: number;
      excluido_em: unknown;
    }>(
      'SELECT usuario_id, pode_marcar, versao, excluido_em, criado_por FROM agenda_usuario WHERE agenda_servico_id = ? ORDER BY usuario_id',
      [ids.agenda],
    );
    expect(
      linhas.map((x) => [Number(x.usuario_id), Number(x.pode_marcar), Number(x.versao), x.excluido_em]),
    ).toEqual([
      [ids.a, 1, 1, null],
      [ids.b, 0, 1, null],
    ]);
    expect(await trilhas()).toBe(t0 + 2);
  });

  it('agenda restrita: some da leitura de quem não está na lista; o gestor a vê; a lista mostra o meu acesso', async () => {
    expect((await porta.agendas(ctxPorta(LOGINS.c))).map((a) => a.id)).not.toContain(ids.agenda);
    expect(await porta.agenda(ctxPorta(LOGINS.c), ids.agenda)).toBeNull();
    expect(await usuarios.lista(ctxU(LOGINS.c), ids.agenda)).toBeNull();
    expect((await porta.agendas(ctxPorta(LOGINS.b))).map((a) => a.id)).toContain(ids.agenda);
    expect(await porta.agenda(ctxPorta(LOGINS.c, true), ids.agenda)).not.toBeNull();
    expect(await usuarios.lista(ctxU(LOGINS.b), ids.agenda)).toMatchObject({
      restrita: true,
      meuAcesso: 'consulta',
    });
    expect(await usuarios.lista(ctxU(LOGINS.c, true), ids.agenda)).toMatchObject({ meuAcesso: 'gestor' });
  });

  it('marcação na agenda restrita: quem marca grava; quem só consulta e quem está fora são recusados (marcar, encaixar, remarcar para ela)', async () => {
    const antes = await marcacoes(ids.agenda);
    for (const login of [LOGINS.b, LOGINS.c]) {
      await expect(
        porta.executar(ctxPorta(login), 'agenda.agendarConsulta', pedido(ids.agenda, '08:15')),
      ).rejects.toMatchObject(recusada('agenda-restrita'));
      await expect(
        porta.executar(ctxPorta(login), 'agenda.encaixar', {
          ...pedido(ids.agenda, '08:20'),
          motivo: 'Encaixe sintético de teste',
        }),
      ).rejects.toMatchObject(recusada('agenda-restrita'));
    }
    // Remarcar da agenda livre PARA a restrita: o destino recusa quem não marca nele (a origem fica intacta).
    await expect(
      porta.executar(ctxPorta(LOGINS.c), 'agenda.remarcarConsulta', {
        marcacao: ids.naLivre,
        destino: { agenda: ids.agenda, data: DIA, hora: '08:30' },
        modo: 'liberar',
        canal: 'telefone',
      }),
    ).rejects.toMatchObject(recusada('agenda-restrita'));
    // O gestor de agendas fora da lista vê, mas não marca.
    await expect(
      porta.executar(ctxPorta(LOGINS.c, true), 'agenda.agendarConsulta', pedido(ids.agenda, '08:15')),
    ).rejects.toMatchObject(recusada('agenda-restrita'));
    expect(await marcacoes(ids.agenda)).toBe(antes);
    expect(await marcacoes(ids.livre)).toBe(1);
    const m = await porta.executar(ctxPorta(LOGINS.a), 'agenda.agendarConsulta', pedido(ids.agenda, '08:00'));
    ids.marcacao = Number(m.resultado['marcacao']);
    const [linha] = await ler<{ responsavel_usuario_id: number; agenda: number }>(
      `SELECT m.responsavel_usuario_id, h.agenda_servico_id AS agenda FROM marcacao_horario m
         JOIN horario_agenda h ON h.id = m.horario_agenda_id WHERE m.id = ?`,
      [ids.marcacao],
    );
    expect([Number(linha!.responsavel_usuario_id), Number(linha!.agenda)]).toEqual([ids.a, ids.agenda]);
    expect(await marcacoes(ids.agenda)).toBe(antes + 1);
  });

  it('quem só consulta não cancela, não confirma, não registra falta, não bloqueia nem gera grade; o gestor mantém', async () => {
    const situacao = async () =>
      (
        await ler<{ s: string }>(
          'SELECT s.significado AS s FROM marcacao_horario m JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id WHERE m.id = ?',
          [ids.marcacao],
        )
      )[0]?.s;
    const antes = await situacao();
    for (const [op, entrada] of [
      [
        'agenda.cancelarConsulta',
        { marcacao: ids.marcacao, motivo: 'PAC-DESISTIU', solicitante: 'paciente' },
      ],
      ['agenda.confirmarConsulta', { marcacao: ids.marcacao }],
      ['agenda.registrarFalta', { marcacao: ids.marcacao }],
      [
        'agenda.bloquearHorarios',
        {
          agenda: ids.agenda,
          acao: 'bloquear',
          horarios: [{ data: DIA, hora: '08:45' }],
          motivo: 'CONGRESSO',
        },
      ],
    ] as const)
      for (const login of [LOGINS.b, LOGINS.c])
        await expect(porta.executar(ctxPorta(login), op, entrada)).rejects.toMatchObject(
          recusada('agenda-restrita'),
        );
    await expect(gerarGrade(LOGINS.b, ids.agenda)).rejects.toMatchObject(recusada('agenda-restrita'));
    expect(await situacao()).toBe(antes);
    expect(await ler('SELECT id FROM bloqueio_agenda WHERE estabelecimento_id = ?', [ids.est])).toHaveLength(
      0,
    );
    // O gestor de agendas fora da lista mantém a agenda (bloqueia), mas não mexe nas marcações.
    await expect(
      porta.executar(ctxPorta(LOGINS.c, true), 'agenda.cancelarConsulta', {
        marcacao: ids.marcacao,
        motivo: 'PAC-DESISTIU',
        solicitante: 'paciente',
      }),
    ).rejects.toMatchObject(recusada('agenda-restrita'));
    await porta.executar(ctxPorta(LOGINS.c, true), 'agenda.bloquearHorarios', {
      agenda: ids.agenda,
      acao: 'bloquear',
      horarios: [{ data: DIA, hora: '08:45' }],
      motivo: 'CONGRESSO',
    });
    expect(await ler('SELECT id FROM bloqueio_agenda WHERE estabelecimento_id = ?', [ids.est])).toHaveLength(
      1,
    );
  });

  it('a agenda restrita some da busca de vagas e do painel do dia de quem não está na lista', async () => {
    const agendasDasVagas = async (login: string) =>
      new Set(
        (await porta.vagas(ctxPorta(login), { agendas: null, de: DIA, ate: DIA })).itens.map((v) => v.agenda),
      );
    expect(await agendasDasVagas(LOGINS.c)).not.toContain(ids.agenda);
    expect(await agendasDasVagas(LOGINS.c)).toContain(ids.livre);
    expect(await agendasDasVagas(LOGINS.a)).toContain(ids.agenda);
    expect((await porta.proximasVagas(ctxPorta(LOGINS.c), [ids.agenda], '2030-03-11', DIA)).length).toBe(0);
    const doDia = async (login: string) =>
      (await porta.marcacoesDoDia(ctxPorta(login), DIA)).itens.map((m) => m.id);
    expect(await doDia(LOGINS.c)).not.toContain(ids.marcacao);
    expect(await doDia(LOGINS.b)).toContain(ids.marcacao);
    expect(await porta.marcacao(ctxPorta(LOGINS.c), ids.marcacao)).toBeNull();
  });

  it('o administrador da plataforma vê e marca na agenda restrita sem estar na lista', async () => {
    expect((await porta.agendas(ctxPorta(LOGINS.c, false, true))).map((a) => a.id)).toContain(ids.agenda);
    expect(await usuarios.lista(ctxU(LOGINS.c, false, true), ids.agenda)).toMatchObject({
      meuAcesso: 'administrador',
    });
    const antes = await marcacoes(ids.agenda);
    await porta.executar(
      ctxPorta(LOGINS.c, false, true),
      'agenda.agendarConsulta',
      pedido(ids.agenda, '08:15'),
    );
    expect(await marcacoes(ids.agenda)).toBe(antes + 1);
  });

  it('não deixa a agenda sem quem marca; promove, retira (exclusão lógica) e libera para todos', async () => {
    await expect(gravar(LOGINS.a, { acao: 'remover', usuario: ids.a })).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'lista-sem-quem-marca' }),
    });
    await gravar(LOGINS.a, { acao: 'alterar', usuario: ids.b, podeMarcar: true });
    await gravar(LOGINS.a, { acao: 'remover', usuario: ids.a });
    let linhas = await ler<{
      usuario_id: number;
      pode_marcar: number;
      versao: number;
      excluido_em: unknown;
      excluido_por: unknown;
    }>(
      'SELECT usuario_id, pode_marcar, versao, excluido_em, excluido_por FROM agenda_usuario WHERE agenda_servico_id = ? ORDER BY usuario_id',
      [ids.agenda],
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0]!.excluido_em).not.toBeNull();
    expect(Number(linhas[0]!.excluido_por)).toBe(ids.a);
    expect([Number(linhas[1]!.pode_marcar), Number(linhas[1]!.versao)]).toEqual([1, 2]);
    // Volta de quem foi retirado reaproveita a linha (sem duplicar), e liberar retira todos sem apagar.
    await gravar(LOGINS.a, { acao: 'incluir', usuario: ids.a, podeMarcar: false });
    await gravar(LOGINS.a, { acao: 'liberarTodos' });
    linhas = await ler(
      'SELECT usuario_id, pode_marcar, versao, excluido_em, excluido_por FROM agenda_usuario WHERE agenda_servico_id = ? ORDER BY usuario_id',
      [ids.agenda],
    );
    expect(linhas).toHaveLength(2);
    expect(linhas.every((x) => x.excluido_em !== null)).toBe(true);
    expect(await usuarios.lista(ctxU(LOGINS.c), ids.agenda)).toMatchObject({ restrita: false });
    expect((await porta.agendas(ctxPorta(LOGINS.c))).map((a) => a.id)).toContain(ids.agenda);
  });
});
