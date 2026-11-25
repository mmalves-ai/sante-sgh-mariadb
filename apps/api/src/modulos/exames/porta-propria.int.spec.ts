// Integração da porta própria da agenda de exames contra o MariaDB real (cliente f22_o1, já criado pela obra da
// onda 1). Massa SINTÉTICA com códigos "L0105" (nenhuma pessoa real). Contrato de efeito de cada gravação: linhas,
// versão, trilha e outbox; e as recusas (horário ocupado, entrada inválida, outro estabelecimento, última fonte,
// marcação de agenda que não é de exame, horário extra no mesmo início). A bateria comum de gerar, marcar, cancelar e
// remarcar roda sobre as duas fábricas (memória e banco) num describe.each.
// No fim, a massa de negócio é apagada; ficam o estabelecimento e o usuário de teste, que a trilha (só inclusão)
// referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  type Escritor,
  ErroOperacao,
  NucleoProprio,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from './apoio-gravacao.js';
import { comPapelNominal } from './papel-nominal.js';
import type { PortaExame } from './porta.js';
import { PortaExameMemoria } from './porta-memoria.js';
import { PortaExamePropria } from './porta-propria.js';
import { ServicoExame } from './servico.js';
import { horaCivil, instanteCivil } from './relogio.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0105';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

function codigoDe(e: unknown): string | null {
  return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : null;
}

describe.skipIf(SEM_BANCO)('porta própria da agenda de exames (MariaDB, cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaExamePropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    agenda: 0,
    fonte: 0,
    fonte2: 0,
    paciente: 0,
    pessoa: 0,
    exame: 0,
    catExame: 0,
    catConsulta: 0,
  };
  let ctx: ContextoNucleo;
  const dia = horaCivil(new Date(Date.now() + 3 * 86_400_000)).data;
  const opCtx = (c: ContextoNucleo = ctx): ContextoOperacao => ({
    ...c,
    chaveIdempotencia: `t0105-${randomUUID()}`,
  });

  const limpar = (e: Escritor) =>
    (async () => {
      const a = [ids.agenda];
      await e.executar('DELETE FROM agenda_usuario WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM agenda_servico_exame WHERE agenda_servico_id = ?', a);
      await e.executar(
        "DELETE FROM dia_nao_util WHERE estabelecimento_id = ? AND descricao LIKE 'FERIADO SINTETICO 20%'",
        [ids.est],
      );
      await e.executar(
        `DELETE cm FROM cancelamento_marcacao cm JOIN marcacao_horario m ON m.id = cm.marcacao_horario_id
          JOIN horario_agenda h ON h.id = m.horario_agenda_id WHERE h.agenda_servico_id = ?`,
        a,
      );
      await e.executar(
        `DELETE i FROM marcacao_horario_item i JOIN marcacao_horario m ON m.id = i.marcacao_horario_id
          JOIN horario_agenda h ON h.id = m.horario_agenda_id WHERE h.agenda_servico_id = ?`,
        a,
      );
      await e.executar(
        'UPDATE marcacao_horario SET remarcada_marcacao_horario_id = NULL WHERE estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar(
        `DELETE m FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
          WHERE h.agenda_servico_id = ?`,
        a,
      );
      await e.executar('DELETE FROM horario_agenda WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM geracao_grade WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM agenda_fonte_pagadora WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM agenda_escala WHERE agenda_servico_id = ?', a);
      await e.executar('UPDATE agenda_servico SET categoria_agenda_id = ? WHERE id = ?', [
        ids.catExame,
        ids.agenda,
      ]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-01-05' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0105.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0105.teste', 'USUARIO SINTETICO L0105', agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        [`${P}-EXA`],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'exame', ?)",
        [`${P}-EXA`, 'EXAMES SINTETICOS', agora],
      );
      ids.catExame = cat;
      ids.catConsulta = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        [`${P}-CON`],
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'consulta', ?)",
        [`${P}-CON`, 'CONSULTAS SINTETICAS', agora],
      );
      const setor = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-SADT`],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'apoio_diagnostico', ?)",
        [ids.est, `${P}-SADT`, 'SADT SINTETICO', agora],
      );
      ids.agenda = await garantir(
        e,
        'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, `ULTRASSOM ${P}`],
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, setor_funcional_id,
           duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 20, ?)`,
        [ids.est, `ULTRASSOM ${P}`, cat, setor, agora],
      );
      const fonte = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [codigo],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)",
          [codigo, `OPERADORA ${codigo} SINTETICA`, agora],
        );
      ids.fonte = await fonte(`${P}-A`);
      ids.fonte2 = await fonte(`${P}-B`);
      ids.pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [ids.pessoa, 910_105_001, agora],
      );
      ids.exame = await garantir(
        e,
        'SELECT id FROM exame WHERE codigo = ?',
        [`${P}-USG`],
        "INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em) VALUES (?, ?, ?, 'outro', ?)",
        [`${P}-USG`, 'USGL', 'ULTRASSONOGRAFIA SINTETICA', agora],
      );
      await garantir(
        e,
        "SELECT id FROM tipo_marcacao WHERE natureza = 'exame' AND ativo = TRUE ORDER BY id LIMIT 1",
        [],
        "INSERT INTO tipo_marcacao (codigo, descricao, natureza, criado_em) VALUES (?, 'EXAME', 'exame', ?)",
        [`${P}-EXAME`, agora],
      );
      for (const s of ['aguardando', 'cancelada'])
        await garantir(
          e,
          'SELECT id FROM situacao_marcacao WHERE significado = ? AND ativo = TRUE ORDER BY ordem, id LIMIT 1',
          [s],
          'INSERT INTO situacao_marcacao (codigo, descricao, significado, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}-${s}`.slice(0, 30), s.toUpperCase(), s, agora],
        );
      await garantir(
        e,
        "SELECT id FROM canal_marcacao WHERE codigo = 'telefone'",
        [],
        "INSERT INTO canal_marcacao (codigo, descricao, criado_em) VALUES ('telefone', 'TELEFONE', ?)",
        [agora],
      );
      for (const m of ['PAC-DESISTIU', 'PAC-OUTRA-DATA'])
        await garantir(
          e,
          'SELECT id FROM motivo_cancelamento_operacao WHERE codigo = ?',
          [m],
          'INSERT INTO motivo_cancelamento_operacao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [m, m === 'PAC-DESISTIU' ? 'Paciente desistiu' : 'Paciente pediu outra data', agora],
        );
      await garantir(
        e,
        "SELECT id FROM sequencia_negocio WHERE tipo = 'marcacao_horario' AND estabelecimento_id = ?",
        [ids.est],
        "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, criado_em) VALUES (?, 'marcacao_horario', 'MX-', ?)",
        [ids.est, agora],
      );
      await limpar(e);
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-01-05' };
    porta = new PortaExamePropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (ids.agenda) await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-01-05' }, limpar);
    await nucleo.encerrar();
  });

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-01-05' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );

  it('lista a agenda de exames do estabelecimento (e não a de outro)', async () => {
    const ags = await porta.agendas(ctx);
    const a = ags.find((x) => x.id === ids.agenda);
    expect(a).toMatchObject({ ativa: true, duracao: '00:20', convenios: 0 });
    expect(await porta.agendas({ ...ctx, estabelecimento: ids.outroEst })).not.toContainEqual(
      expect.objectContaining({ id: ids.agenda }),
    );
  });

  it('gera a grade pelo Executor: geração, horários, trilha e outbox; a mesma chave não grava de novo', async () => {
    const entrada = {
      agenda: ids.agenda,
      de: dia,
      ate: dia,
      duracao: '00:20',
      horarios: ['08:00', '08:20', '08:40'].map((hora) => ({ data: dia, hora })),
      escala: [
        {
          semana: 2,
          duracao: '00:20',
          horaInicio: '08:00',
          horaFim: '09:00',
          intervaloInicio: null,
          intervaloFim: null,
        },
      ],
      semanas: ['F', 'T', 'T', 'T', 'T', 'T', 'F'],
    };
    const c = opCtx();
    const r = await porta.executar(ctx, 'agenda.gerarGradeExame', entrada, c);
    expect(r.repetida).toBe(false);
    expect(r.resultado['horarios']).toBe(3);
    expect(r.trilha).toBeGreaterThan(0);
    const h = await ler(
      'SELECT situacao, vagas_ocupadas, versao FROM horario_agenda WHERE agenda_servico_id = ?',
      [ids.agenda],
    );
    expect(h).toHaveLength(3);
    expect(h.every((x) => x['situacao'] === 'livre' && Number(x['versao']) === 1)).toBe(true);
    const [g] = await ler('SELECT situacao, horarios_gerados FROM geracao_grade WHERE id = ?', [
      r.resultado['geracao'],
    ]);
    expect(g).toMatchObject({ situacao: 'concluida', horarios_gerados: 3 });
    const [t] = await ler('SELECT entidade, estabelecimento_id FROM trilha_auditoria WHERE id = ?', [
      r.trilha,
    ]);
    expect(t).toMatchObject({ entidade: 'geracao_grade', estabelecimento_id: ids.est });
    const out = await ler(
      "SELECT id FROM integracao_mensagem WHERE tipo = 'agenda.exame.grade_gerada' AND correlacao = ?",
      [c.correlacao],
    ).catch(() => null);
    if (out) expect(out.length).toBeGreaterThan(0);
    const de2 = await porta.executar(ctx, 'agenda.gerarGradeExame', entrada, c);
    expect(de2.repetida).toBe(true);
    expect(await ler('SELECT id FROM horario_agenda WHERE agenda_servico_id = ?', [ids.agenda])).toHaveLength(
      3,
    );
    const vagas = await porta.vagas(ctx, { agendas: [ids.agenda], de: dia, ate: dia });
    expect(vagas.itens.map((v) => v.hora)).toEqual(['08:00', '08:20', '08:40']);
  });

  it('marca o exame: marcação numerada, item do exame, horário ocupado com nova versão; recusa o horário ocupado', async () => {
    const entrada = {
      agenda: ids.agenda,
      data: dia,
      hora: '08:00',
      paciente: ids.paciente,
      convenio: ids.fonte,
      exame: ids.exame,
      solicitante: null,
      retorno: false,
      canal: 'telefone',
    };
    const r = await porta.executar(ctx, 'agenda.agendarExame', entrada, opCtx());
    const id = Number(r.resultado['marcacao']);
    const [m] = await ler('SELECT numero, versao, paciente_id FROM marcacao_horario WHERE id = ?', [id]);
    expect(String(m?.['numero'])).toMatch(/^MX-/);
    expect(
      await ler('SELECT exame_id FROM marcacao_horario_item WHERE marcacao_horario_id = ?', [id]),
    ).toEqual([expect.objectContaining({ exame_id: ids.exame })]);
    const [h] = await ler(
      'SELECT h.situacao, h.vagas_ocupadas, h.versao FROM horario_agenda h JOIN marcacao_horario m ON m.horario_agenda_id = h.id WHERE m.id = ?',
      [id],
    );
    expect(h).toMatchObject({ situacao: 'ocupado', vagas_ocupadas: 1, versao: 2 });
    const grade = await porta.horarios(ctx, ids.agenda, dia, dia);
    expect(grade.itens[0]).toMatchObject({ hora: '08:00', estado: 'marcado', marcacao: id });
    const lista = await porta.marcacoesDoDia(ctx, dia, ids.agenda);
    expect(lista.itens).toContainEqual(
      expect.objectContaining({ id, estado: 'marcado', atendido: false, temSenha: false }),
    );
    const det = await porta.marcacao(ctx, id);
    expect(det?.marcacao.prontuario).toBe(910_105_001);
    const ext = await porta.extensoes(ctx, [id]);
    expect(ext.get(id)).toMatchObject({ idExame: ids.exame, canal: 'telefone', retorno: false });
    const erro = await porta.executar(ctx, 'agenda.agendarExame', entrada, opCtx()).catch((e) => e);
    expect(codigoDe(erro)).toBe('horario-ocupado');
  });

  it('02-AGE 40: agenda de exame restrita a uma lista nominal recusa marcar e cancelar de quem está fora ou só consulta (nada gravado)', async () => {
    const outro = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-01-05-nominal' },
      async (e) => {
        const u = await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', ['l0105.lista']);
        const id = u
          ? Number(u.id)
          : await e.inserir(
              "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
              ['l0105.lista', 'USUARIO SINTETICO L0105 LISTA', new Date()],
            );
        await e.executar('DELETE FROM agenda_usuario WHERE agenda_servico_id = ?', [ids.agenda]);
        await e.executar(
          'INSERT INTO agenda_usuario (agenda_servico_id, usuario_id, pode_marcar, criado_em) VALUES (?, ?, TRUE, ?), (?, ?, FALSE, ?)',
          [ids.agenda, id, new Date(), ids.agenda, ids.usuario, new Date()],
        );
        return id;
      },
    );
    expect(outro).toBeGreaterThan(0);
    const contar = async () =>
      Number(
        (
          await ler<{ n: number }>(
            'SELECT COUNT(*) AS n FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id WHERE h.agenda_servico_id = ?',
            [ids.agenda],
          )
        )[0]?.n,
      );
    const antes = await contar();
    const entrada = {
      agenda: ids.agenda,
      data: dia,
      hora: '08:30',
      paciente: ids.paciente,
      convenio: ids.fonte,
      exame: ids.exame,
      solicitante: null,
      retorno: false,
      canal: 'telefone',
    };
    // Quem só consulta (na lista sem "pode marcar") não marca.
    const e1 = await porta.executar(ctx, 'agenda.agendarExame', entrada, opCtx()).catch((e) => e);
    expect(codigoDe(e1)).toBe('agenda-restrita');
    const [m] = await ler<{ id: number }>(
      `SELECT m.id FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
        WHERE h.agenda_servico_id = ? AND m.excluido_em IS NULL ORDER BY m.id LIMIT 1`,
      [ids.agenda],
    );
    const e2 = await porta
      .executar(
        ctx,
        'agenda.cancelarExame',
        { marcacao: Number(m?.id), motivo: 'PAC-DESISTIU', solicitante: 'paciente' },
        opCtx(),
      )
      .catch((e) => e);
    expect(codigoDe(e2)).toBe('agenda-restrita');
    // Fora da lista: também recusa.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-01-05-nominal' }, (e) =>
      e.executar('DELETE FROM agenda_usuario WHERE agenda_servico_id = ? AND usuario_id = ?', [
        ids.agenda,
        ids.usuario,
      ]),
    );
    const e3 = await porta.executar(ctx, 'agenda.agendarExame', entrada, opCtx()).catch((e) => e);
    expect(codigoDe(e3)).toBe('agenda-restrita');
    expect(await contar()).toBe(antes);
    expect(
      await ler('SELECT 1 FROM cancelamento_marcacao WHERE marcacao_horario_id = ?', [Number(m?.id)]),
    ).toEqual([]);
    // Lista retirada: a agenda volta a valer só pelo escopo do cargo.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-01-05-nominal' }, (e) =>
      e.executar('DELETE FROM agenda_usuario WHERE agenda_servico_id = ?', [ids.agenda]),
    );
  });

  it('02-AGE 40: na agenda de exame restrita a manutenção (grade, fontes pagadoras, cobertura por exame) é de quem marca ou do gestor; a agenda some da leitura de quem está fora; o administrador da plataforma marca', async () => {
    const longe = horaCivil(new Date(Date.now() + 25 * 86_400_000)).data;
    const a = [ids.agenda];
    const outro = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-01-05-nominal-manut' },
      async (e) => {
        const id = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          ['l0105.lista'],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          ['l0105.lista', 'USUARIO SINTETICO L0105 LISTA', new Date()],
        );
        await e.executar('DELETE FROM agenda_usuario WHERE agenda_servico_id = ?', a);
        await e.executar(
          'INSERT INTO agenda_usuario (agenda_servico_id, usuario_id, pode_marcar, criado_em) VALUES (?, ?, TRUE, ?), (?, ?, FALSE, ?)',
          [ids.agenda, id, new Date(), ids.agenda, ids.usuario, new Date()],
        );
        return id;
      },
    );
    const foto = async () => {
      const k = async (sql: string) => Number((await ler<{ k: number }>(sql, a))[0]?.k);
      return {
        geracoes: await k('SELECT COUNT(*) AS k FROM geracao_grade WHERE agenda_servico_id = ?'),
        horarios: await k('SELECT COUNT(*) AS k FROM horario_agenda WHERE agenda_servico_id = ?'),
        fontes: await k('SELECT COUNT(*) AS k FROM agenda_fonte_pagadora WHERE agenda_servico_id = ?'),
        exames: await k('SELECT COUNT(*) AS k FROM agenda_servico_exame WHERE agenda_servico_id = ?'),
        marcacoes: await k(
          'SELECT COUNT(*) AS k FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id WHERE h.agenda_servico_id = ?',
        ),
      };
    };
    const antes = await foto();
    const grade = {
      agenda: ids.agenda,
      de: longe,
      ate: longe,
      duracao: '00:20',
      horarios: [{ data: longe, hora: '10:00' }],
      escala: [
        {
          semana: 2,
          duracao: '00:20',
          horaInicio: '10:00',
          horaFim: '10:20',
          intervaloInicio: null,
          intervaloFim: null,
        },
      ],
      semanas: ['T', 'T', 'T', 'T', 'T', 'T', 'T'],
    };
    const fonte = (convenio: number) => ({ agenda: ids.agenda, convenio, acao: 'incluir' });
    const coberto = { agenda: ids.agenda, exame: ids.exame, convenio: null };
    const trilha = (r: number) => ({
      estabelecimento: ids.est,
      usuario: ids.usuario,
      acao: 'inclusao' as const,
      entidade: 'agenda_servico_exame',
      entidadeId: r,
      correlacao: 'teste-40-cobertura',
    });
    const manutencoes = () =>
      Promise.all([
        porta.executar(ctx, 'agenda.gerarGradeExame', grade, opCtx()).catch((e) => e),
        porta.executar(ctx, 'agenda.definirCoberturaExame', fonte(ids.fonte), opCtx()).catch((e) => e),
        porta.gravarSgh(ctx, trilha, (g) => g.incluirCobertura(coberto)).catch((e) => e),
      ]);
    // Quem só consulta vê a agenda, mas não a mantém: as três manutenções são recusadas e nada é gravado.
    expect((await manutencoes()).map(codigoDe)).toEqual([
      'agenda-restrita',
      'agenda-restrita',
      'agenda-restrita',
    ]);
    expect(await porta.agenda(ctx, ids.agenda)).not.toBeNull();
    expect(await foto()).toEqual(antes);
    // Fora da lista: a agenda some da leitura (lista, detalhe, marcações do paciente) e a manutenção é recusada.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-01-05-nominal-manut' }, (e) =>
      e.executar('DELETE FROM agenda_usuario WHERE agenda_servico_id = ? AND usuario_id = ?', [
        ids.agenda,
        ids.usuario,
      ]),
    );
    expect((await manutencoes()).map(codigoDe)).toEqual([
      'agenda-restrita',
      'agenda-restrita',
      'agenda-restrita',
    ]);
    expect(await porta.agenda(ctx, ids.agenda)).toBeNull();
    expect((await porta.agendas(ctx)).map((x) => x.id)).not.toContain(ids.agenda);
    expect(
      (await porta.marcacoesDoPaciente(ctx, ids.paciente)).itens.filter((m) => m.agenda === ids.agenda),
    ).toEqual([]);
    const cancelados = await porta.cancelamentos(ctx, {
      de: horaCivil(new Date(Date.now() - 86_400_000)).data,
      ate: longe,
      agendas: null,
      pagina: 1,
      porPagina: 50,
    });
    expect(cancelados.itens.filter((x) => x.nomeAgenda === `ULTRASSOM ${P}`)).toEqual([]);
    expect(await foto()).toEqual(antes);
    // Quem está na lista e marca vê a agenda e também a mantém.
    const ctxOutro = { ...ctx, usuario: outro };
    expect((await porta.agendas(ctxOutro)).map((x) => x.id)).toContain(ids.agenda);
    await porta.executar(ctxOutro, 'agenda.definirCoberturaExame', fonte(ids.fonte2), opCtx(ctxOutro));
    // O gestor da agenda, fora da lista, vê e mantém (grade, fonte pagadora, cobertura por exame), mas não marca.
    const marcar = {
      agenda: ids.agenda,
      data: longe,
      hora: '10:00',
      paciente: ids.paciente,
      convenio: ids.fonte,
      exame: ids.exame,
      solicitante: null,
      retorno: false,
      canal: 'telefone',
    };
    await comPapelNominal({ gestor: true, administrador: false }, async () => {
      expect(await porta.agenda(ctx, ids.agenda)).not.toBeNull();
      const g = await porta.executar(ctx, 'agenda.gerarGradeExame', grade, opCtx());
      expect(g.resultado['horarios']).toBe(1);
      await porta.executar(ctx, 'agenda.definirCoberturaExame', fonte(ids.fonte), opCtx());
      expect(await porta.gravarSgh(ctx, trilha, (x) => x.incluirCobertura(coberto))).toBeGreaterThan(0);
      const m = await porta.executar(ctx, 'agenda.agendarExame', marcar, opCtx()).catch((e) => e);
      expect(codigoDe(m)).toBe('agenda-restrita');
    });
    expect(await foto()).toEqual({
      geracoes: antes.geracoes + 1,
      horarios: antes.horarios + 1,
      fontes: antes.fontes + 2,
      exames: antes.exames + 1,
      marcacoes: antes.marcacoes,
    });
    const [h] = await ler<{ id: number }>(
      'SELECT id FROM horario_agenda WHERE agenda_servico_id = ? AND data_referencia = ?',
      [ids.agenda, longe],
    );
    // O administrador da plataforma marca sem estar na lista (pode tudo); o responsável fica gravado.
    const feita = await comPapelNominal({ gestor: false, administrador: true }, () =>
      porta.executar(ctx, 'agenda.agendarExame', marcar, opCtx()),
    );
    expect(
      await ler('SELECT horario_agenda_id, responsavel_usuario_id FROM marcacao_horario WHERE id = ?', [
        Number(feita.resultado['marcacao']),
      ]),
    ).toEqual([{ horario_agenda_id: Number(h?.id), responsavel_usuario_id: ids.usuario }]);
    // Desfaz o que este caso gravou (os casos seguintes partem da agenda sem lista, sem fonte e sem cobertura).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-01-05-nominal-manut' }, async (e) => {
      const hs = [Number(h?.id)];
      await e.executar(
        'DELETE i FROM marcacao_horario_item i JOIN marcacao_horario m ON m.id = i.marcacao_horario_id WHERE m.horario_agenda_id = ?',
        hs,
      );
      await e.executar('DELETE FROM marcacao_horario WHERE horario_agenda_id = ?', hs);
      await e.executar('DELETE FROM horario_agenda WHERE id = ?', hs);
      await e.executar('DELETE FROM geracao_grade WHERE agenda_servico_id = ? AND periodo_inicio = ?', [
        ids.agenda,
        longe,
      ]);
      await e.executar('DELETE FROM agenda_fonte_pagadora WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM agenda_servico_exame WHERE agenda_servico_id = ?', a);
      await e.executar('DELETE FROM agenda_usuario WHERE agenda_servico_id = ?', a);
    });
    expect(await foto()).toEqual(antes);
  });

  it('02-AGE 44: marca o exame sem prontuário com o pré-cadastro na mesma transação e devolve a vaga ao cancelar', async () => {
    const entrada = {
      agenda: ids.agenda,
      data: dia,
      hora: '08:20',
      nome: 'pessoa sintetica exame sem pront',
      nascimento: '1990-07-08',
      telefone: '3133334444',
      convenio: ids.fonte,
      exame: ids.exame,
      canal: 'telefone',
    };
    const recusa = await porta
      .executar(ctx, 'agenda.agendarExameSemProntuario', { ...entrada, nascimento: '1800-01-01' }, opCtx())
      .catch((e) => e);
    expect(codigoDe(recusa)).toBe('nascimento-improvavel');
    const r = await porta.executar(ctx, 'agenda.agendarExameSemProntuario', entrada, opCtx());
    const id = Number(r.resultado['marcacao']);
    const [m] = await ler('SELECT paciente_id, pre_cadastro_id, numero FROM marcacao_horario WHERE id = ?', [
      id,
    ]);
    expect(m).toMatchObject({ paciente_id: null, numero: expect.stringMatching(/^MX-/) });
    const [pc] = await ler(
      'SELECT nome, situacao, telefone, celular, fonte_pagadora_id FROM pre_cadastro WHERE id = ?',
      [m?.['pre_cadastro_id']],
    );
    expect(pc).toMatchObject({
      nome: 'PESSOA SINTETICA EXAME SEM PRONT',
      situacao: 'pendente',
      telefone: '3133334444',
      celular: null,
      fonte_pagadora_id: ids.fonte,
    });
    expect(
      await ler('SELECT exame_id FROM marcacao_horario_item WHERE marcacao_horario_id = ?', [id]),
    ).toEqual([expect.objectContaining({ exame_id: ids.exame })]);
    await porta.executar(
      ctx,
      'agenda.cancelarExame',
      { marcacao: id, motivo: 'PAC-DESISTIU', solicitante: 'paciente' },
      opCtx(),
    );
    const vagas = await porta.vagas(ctx, { agendas: [ids.agenda], de: dia, ate: dia });
    expect(vagas.itens.map((v) => v.hora)).toContain('08:20');
    // O pré-cadastro e a marcação cancelada continuam no banco.
    expect(
      await ler('SELECT id FROM marcacao_horario WHERE pre_cadastro_id = ?', [m?.['pre_cadastro_id']]),
    ).toHaveLength(1);
  });

  it('02-CAD 13: paciente com óbito emitido não marca exame (motivo e data; nenhuma marcação gravada, horário livre)', async () => {
    const obito = (falecido: boolean) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'obito-teste-01-05' }, (e) =>
        e.executar('UPDATE paciente SET falecido = ?, data_hora_obito = ? WHERE id = ?', [
          falecido,
          falecido ? new Date('2026-11-20T12:00:00Z') : null,
          ids.paciente,
        ]),
      );
    const contar = async () =>
      Number(
        (
          await ler(
            'SELECT COUNT(*) AS n FROM marcacao_horario WHERE paciente_id = ? AND estabelecimento_id = ?',
            [ids.paciente, ids.est],
          )
        )[0]?.['n'],
      );
    const antes = await contar();
    await obito(true);
    try {
      const erro = await porta
        .executar(
          ctx,
          'agenda.agendarExame',
          {
            agenda: ids.agenda,
            data: dia,
            hora: '08:40',
            paciente: ids.paciente,
            convenio: ids.fonte,
            exame: ids.exame,
            solicitante: null,
            retorno: false,
            canal: 'telefone',
          },
          opCtx(),
        )
        .catch((e) => e);
      expect(codigoDe(erro)).toBe('paciente-falecido');
      expect(String((erro as ErroOperacao).problema['detail'])).toMatch(/20\/11\/2026/);
      expect(await contar()).toBe(antes);
      const vagas = await porta.vagas(ctx, { agendas: [ids.agenda], de: dia, ate: dia });
      expect(vagas.itens.map((v) => v.hora)).toContain('08:40');
    } finally {
      await obito(false);
    }
  });

  it('recusa entrada inválida e agenda de outro estabelecimento', async () => {
    const invalida = await porta
      .executar(ctx, 'agenda.agendarExame', { agenda: ids.agenda, data: 'amanha' }, opCtx())
      .catch((e) => e);
    expect(codigoDe(invalida)).toBe('entrada-invalida');
    const outro = { ...ctx, estabelecimento: ids.outroEst };
    const fora = await porta
      .executar(
        outro,
        'agenda.agendarExame',
        {
          agenda: ids.agenda,
          data: dia,
          hora: '08:20',
          paciente: ids.paciente,
          convenio: ids.fonte,
          exame: null,
          solicitante: null,
          retorno: false,
          canal: 'telefone',
        },
        opCtx(outro),
      )
      .catch((e) => e);
    expect(codigoDe(fora)).toBe('registro-inexistente');
  });

  it('cancela: cancelamento gravado, marcação cancelada e horário livre; e remarca ligando as duas marcações', async () => {
    const [m] = await ler<{ id: number }>(
      `SELECT m.id FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
        WHERE h.agenda_servico_id = ? ORDER BY m.id LIMIT 1`,
      [ids.agenda],
    );
    const id = Number(m?.id);
    await porta.executar(
      ctx,
      'agenda.cancelarExame',
      { marcacao: id, motivo: 'PAC-DESISTIU', solicitante: 'paciente' },
      opCtx(),
    );
    const [cm] = await ler(
      'SELECT horario_liberado, responsavel_usuario_id FROM cancelamento_marcacao WHERE marcacao_horario_id = ?',
      [id],
    );
    expect(cm).toMatchObject({ responsavel_usuario_id: ids.usuario });
    const [h] = await ler(
      'SELECT h.situacao, h.vagas_ocupadas FROM horario_agenda h JOIN marcacao_horario m ON m.horario_agenda_id = h.id WHERE m.id = ?',
      [id],
    );
    expect(h).toMatchObject({ situacao: 'livre', vagas_ocupadas: 0 });
    const canc = await porta.cancelamentos(ctx, {
      de: horaCivil(new Date()).data,
      ate: horaCivil(new Date()).data,
      agendas: [ids.agenda],
      pagina: 1,
      porPagina: 50,
    });
    expect(canc.total).toBeGreaterThanOrEqual(1);
    const nova = await porta.executar(
      ctx,
      'agenda.agendarExame',
      {
        agenda: ids.agenda,
        data: dia,
        hora: '08:20',
        paciente: ids.paciente,
        convenio: ids.fonte,
        exame: null,
        solicitante: null,
        retorno: false,
        canal: 'telefone',
      },
      opCtx(),
    );
    const antiga = Number(nova.resultado['marcacao']);
    const r = await porta.executar(
      ctx,
      'agenda.remarcarExame',
      {
        marcacao: antiga,
        destino: { agenda: ids.agenda, data: dia, hora: '08:40' },
        modo: 'liberar',
        canal: 'telefone',
      },
      opCtx(),
    );
    const [nv] = await ler('SELECT remarcada_marcacao_horario_id FROM marcacao_horario WHERE id = ?', [
      r.resultado['marcacao'],
    ]);
    expect(Number(nv?.['remarcada_marcacao_horario_id'])).toBe(antiga);
    const [cc] = await ler(
      'SELECT nova_marcacao_horario_id FROM cancelamento_marcacao WHERE marcacao_horario_id = ?',
      [antiga],
    );
    expect(Number(cc?.['nova_marcacao_horario_id'])).toBe(Number(r.resultado['marcacao']));
  });

  it('fontes pagadoras da agenda: inclui, recusa tirar a última sem confirmar e tira com a confirmação', async () => {
    await porta.executar(
      ctx,
      'agenda.definirCoberturaExame',
      { agenda: ids.agenda, convenio: ids.fonte2, acao: 'incluir' },
      opCtx(),
    );
    expect((await porta.convenios(ctx, ids.agenda)).map((x) => x.codigo)).toEqual([ids.fonte2]);
    const ultima = await porta
      .executar(
        ctx,
        'agenda.definirCoberturaExame',
        { agenda: ids.agenda, convenio: ids.fonte2, acao: 'remover' },
        opCtx(),
      )
      .catch((e) => e);
    expect(codigoDe(ultima)).toBe('ultima-linha');
    await porta.executar(
      ctx,
      'agenda.definirCoberturaExame',
      { agenda: ids.agenda, convenio: ids.fonte2, acao: 'remover', confirmarAceitarTodos: true },
      opCtx(),
    );
    expect(await porta.convenios(ctx, ids.agenda)).toEqual([]);
    const [l] = await ler(
      'SELECT versao, excluido_por FROM agenda_fonte_pagadora WHERE agenda_servico_id = ?',
      [ids.agenda],
    );
    expect(l).toMatchObject({ versao: 2, excluido_por: ids.usuario });
  });

  it('cancelar ou remarcar pela agenda de exames não alcança marcação de agenda de consulta', async () => {
    const marcada = await porta.executar(
      ctx,
      'agenda.agendarExame',
      {
        agenda: ids.agenda,
        data: dia,
        hora: '08:00',
        paciente: ids.paciente,
        convenio: ids.fonte,
        exame: null,
        solicitante: null,
        retorno: false,
        canal: 'telefone',
      },
      opCtx(),
    );
    const id = Number(marcada.resultado['marcacao']);
    const trocar = (cat: number) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-natureza' }, (e) =>
        e.executar('UPDATE agenda_servico SET categoria_agenda_id = ? WHERE id = ?', [cat, ids.agenda]),
      );
    await trocar(ids.catConsulta);
    try {
      const canc = await porta
        .executar(
          ctx,
          'agenda.cancelarExame',
          { marcacao: id, motivo: 'PAC-DESISTIU', solicitante: 'paciente' },
          opCtx(),
        )
        .catch((e) => e);
      expect(codigoDe(canc)).toBe('registro-inexistente');
      const rem = await porta
        .executar(
          ctx,
          'agenda.remarcarExame',
          {
            marcacao: id,
            destino: { agenda: ids.agenda, data: dia, hora: '08:40' },
            modo: 'liberar',
            canal: 'telefone',
          },
          opCtx(),
        )
        .catch((e) => e);
      expect(codigoDe(rem)).toBe('registro-inexistente');
    } finally {
      await trocar(ids.catExame);
    }
    const [m] = await ler(
      'SELECT s.significado FROM marcacao_horario m JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id WHERE m.id = ?',
      [id],
    );
    expect(m?.['significado']).not.toBe('cancelada');
  });

  it('gerar de novo: reativa o horário excluído (mesma linha) e recusa com mensagem o horário extra no mesmo início', async () => {
    const dia2 = horaCivil(new Date(Date.now() + 5 * 86_400_000)).data;
    const gerar = (hora: string) =>
      porta.executar(
        ctx,
        'agenda.gerarGradeExame',
        {
          agenda: ids.agenda,
          de: dia2,
          ate: dia2,
          duracao: '00:20',
          horarios: [{ data: dia2, hora }],
          escala: [
            {
              semana: 2,
              duracao: '00:20',
              horaInicio: '09:00',
              horaFim: '10:00',
              intervaloInicio: null,
              intervaloFim: null,
            },
          ],
          semanas: ['T', 'T', 'T', 'T', 'T', 'T', 'T'],
        },
        opCtx(),
      );
    const g1 = await gerar('09:00');
    const [h1] = await ler<{ id: number }>('SELECT id FROM horario_agenda WHERE geracao_grade_id = ?', [
      g1.resultado['geracao'],
    ]);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-exclui' }, (e) =>
      e.executar('UPDATE horario_agenda SET excluido_em = NOW(3), versao = versao + 1 WHERE id = ?', [
        h1?.id,
      ]),
    );
    expect((await porta.horarios(ctx, ids.agenda, dia2, dia2)).itens).toEqual([]);
    const g2 = await gerar('09:00');
    const [h2] = await ler(
      'SELECT id, excluido_em, geracao_grade_id, situacao, versao FROM horario_agenda WHERE id = ?',
      [h1?.id],
    );
    expect(h2).toMatchObject({ excluido_em: null, situacao: 'livre', versao: 3 });
    expect(Number(h2?.['geracao_grade_id'])).toBe(Number(g2.resultado['geracao']));
    expect(
      await ler('SELECT id FROM horario_agenda WHERE agenda_servico_id = ? AND data_referencia = ?', [
        ids.agenda,
        dia2,
      ]),
    ).toHaveLength(1);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-extra' }, (e) =>
      e.executar(
        `INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, tipo_horario, criado_em)
         VALUES (?, ?, ?, ?, ?, 'extra', NOW(3))`,
        [ids.est, ids.agenda, dia2, instanteCivil(dia2, '09:20'), instanteCivil(dia2, '09:40')],
      ),
    );
    expect(codigoDe(await gerar('09:20').catch((e) => e))).toBe('previa-desatualizada');
    expect(await porta.horariosExistentes(ctx, ids.agenda, dia2, dia2)).toEqual(
      [`${dia2} 09:00`, `${dia2} 09:20`].sort(),
    );
  });

  it('escala com pausa, vagas e feriado: a porta entrega tudo e a geração grava as vagas e o pedido de feriados', async () => {
    const dia3 = horaCivil(new Date(Date.now() + 6 * 86_400_000)).data;
    const semana = new Date(`${dia3}T00:00:00Z`).getUTCDay() + 1;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-01-05-escala' }, (e) =>
      e.executar(
        `INSERT INTO agenda_escala (agenda_servico_id, dia_semana, hora_inicio, hora_fim, intervalo_inicio, intervalo_fim,
           vagas_por_horario, atende_feriado, vigencia_inicio, criado_em)
         VALUES (?, ?, '10:00', '11:00', '10:20', '10:40', 2, TRUE, ?, NOW(3))`,
        [ids.agenda, semana, horaCivil(new Date()).data],
      ),
    );
    expect(await porta.escala(ctx, ids.agenda, { de: dia3, ate: dia3 })).toEqual([
      expect.objectContaining({
        semana,
        horaInicio: '10:00',
        horaFim: '11:00',
        intervaloInicio: '10:20',
        intervaloFim: '10:40',
        vagas: 2,
        atendeFeriado: true,
      }),
    ]);
    // Feriados do calendário do cliente: o do próprio estabelecimento vale; o ponto facultativo não.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-20-feriado' }, async (e) => {
      await e.executar(
        `INSERT INTO dia_nao_util (descricao, abrangencia, estabelecimento_id, recorrencia, data, facultativo, criado_em)
         VALUES ('FERIADO SINTETICO 20 A', 'estabelecimento', ?, 'data_unica', ?, FALSE, NOW(3)),
                ('FERIADO SINTETICO 20 B', 'estabelecimento', ?, 'data_unica', ?, TRUE, NOW(3))`,
        [ids.est, dia3, ids.est, dia3],
      );
    });
    expect(await porta.feriados(ctx, dia3, dia3)).toEqual([{ data: dia3, nome: 'FERIADO SINTETICO 20 A' }]);
    const r = await porta.executar(
      ctx,
      'agenda.gerarGradeExame',
      {
        agenda: ids.agenda,
        de: dia3,
        ate: dia3,
        duracao: '00:20',
        horarios: [
          { data: dia3, hora: '10:00' },
          { data: dia3, hora: '10:40' },
        ],
        escala: [
          {
            semana,
            duracao: '00:20',
            horaInicio: '10:00',
            horaFim: '11:00',
            intervaloInicio: '10:20',
            intervaloFim: '10:40',
          },
        ],
        semanas: ['T', 'T', 'T', 'T', 'T', 'T', 'T'],
        incluirFeriados: true,
      },
      opCtx(),
    );
    const hs = await ler('SELECT vagas FROM horario_agenda WHERE geracao_grade_id = ? ORDER BY inicio_em', [
      r.resultado['geracao'],
    ]);
    expect(hs.map((h) => Number(h['vagas']))).toEqual([2, 2]);
    const [g] = await ler('SELECT inclui_feriados FROM geracao_grade WHERE id = ?', [r.resultado['geracao']]);
    expect(Number(g?.['inclui_feriados'])).toBe(1);
  });

  it('02-CAD 28: a prévia da grade pula só a faixa do meio expediente do calendário (o resto do dia é gerado)', async () => {
    // Um dia útil (segunda a sexta) sem horários desta agenda, a partir de 9 dias à frente.
    let dia4 = '';
    for (let k = 9; !dia4; k++) {
      const d = horaCivil(new Date(Date.now() + k * 86_400_000)).data;
      const s = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (s >= 1 && s <= 5) dia4 = d;
    }
    const semana = new Date(`${dia4}T00:00:00Z`).getUTCDay() + 1;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-28-meio-expediente' }, (e) =>
      e.executar(
        `INSERT INTO dia_nao_util (descricao, abrangencia, estabelecimento_id, recorrencia, data, facultativo,
           hora_inicio, hora_fim, criado_em)
         VALUES ('FERIADO SINTETICO 20 C', 'estabelecimento', ?, 'data_unica', ?, FALSE, '09:00', '10:00', NOW(3))`,
        [ids.est, dia4],
      ),
    );
    expect(await porta.feriados(ctx, dia4, dia4)).toEqual([
      expect.objectContaining({
        data: dia4,
        nome: 'FERIADO SINTETICO 20 C',
        horaInicio: '09:00',
        horaFim: '10:00',
      }),
    ]);
    const { entrada } = await new ServicoExame(porta).previa(ctx, {
      agenda: ids.agenda,
      de: dia4,
      ate: dia4,
      duracaoMinutos: 20,
      faixas: [{ semana, inicio: '08:00', fim: '11:00', intervaloInicio: null, intervaloFim: null }],
      incluirFeriados: false,
    });
    expect(entrada.horarios.map((h) => h.hora)).toEqual([
      '08:00',
      '08:20',
      '08:40',
      '10:00',
      '10:20',
      '10:40',
    ]);
    // A faixa do meio expediente vira bloqueio do dia (regra do domínio): "incluir feriados" vale só para o dia inteiro.
    const tudo = await new ServicoExame(porta).previa(ctx, {
      agenda: ids.agenda,
      de: dia4,
      ate: dia4,
      duracaoMinutos: 20,
      faixas: [{ semana, inicio: '08:00', fim: '11:00', intervaloInicio: null, intervaloFim: null }],
      incluirFeriados: true,
    });
    expect(tudo.entrada.horarios.map((h) => h.hora)).toEqual(entrada.horarios.map((h) => h.hora));
  });

  it('02-AGE 44: a marcação sem prontuário está ligada (só a permissão do cargo controla)', async () => {
    const p = await porta.podeGravar(ctx, 'agenda.agendarExameSemProntuario');
    expect(p.pode).toBe(true);
    expect((await porta.podeGravar(ctx, 'agenda.agendarExame')).pode).toBe(true);
  });
  // Bateria comum (memória × banco): gerar, marcar, cancelar e remarcar com o mesmo contrato e as mesmas recusas.
  interface Fabrica {
    porta: PortaExame;
    ctx: ContextoPortaM18;
    agenda: number;
    paciente: number;
    convenio: number;
    exame: number;
  }
  const fabricas: [string, () => Fabrica][] = [
    [
      'memória',
      () => ({
        porta: new PortaExameMemoria(
          null,
          async () => [
            {
              id: 501,
              nome: 'PACIENTE SINTETICO',
              prontuario: 9001,
              telefone: null,
              celular: null,
              ativo: true,
            },
          ],
          () => ({ hoje: horaCivil(new Date()).data, hora: '00:00' }),
        ),
        ctx: { cliente: 'sintetico', estabelecimento: 1, usuario: 7, correlacao: 'bateria-01-05' },
        agenda: 951,
        paciente: 501,
        convenio: 10,
        exame: 7001,
      }),
    ],
    [
      'banco',
      () => ({
        porta,
        ctx,
        agenda: ids.agenda,
        paciente: ids.paciente,
        convenio: ids.fonte,
        exame: ids.exame,
      }),
    ],
  ];

  describe.each(fabricas)('bateria comum da porta de exames (%s)', (_nome, fabrica) => {
    const dia4 = horaCivil(new Date(Date.now() + 60 * 86_400_000)).data;
    const horas = ['07:00', '07:20', '07:40'];
    const op = (f: Fabrica): ContextoOperacao => ({
      ...(f.ctx as ContextoNucleo),
      chaveIdempotencia: `t0105-b-${randomUUID()}`,
    });
    const marcar = (f: Fabrica, hora: string) =>
      f.porta.executar(
        f.ctx,
        'agenda.agendarExame',
        {
          agenda: f.agenda,
          data: dia4,
          hora,
          paciente: f.paciente,
          convenio: f.convenio,
          exame: f.exame,
          solicitante: null,
          retorno: false,
          canal: 'telefone',
        },
        op(f),
      );
    const estados = async (f: Fabrica) =>
      Object.fromEntries(
        (await f.porta.horarios(f.ctx, f.agenda, dia4, dia4)).itens.map((h) => [h.hora, h.estado]),
      );

    it('gera, marca, recusa o ocupado, cancela e remarca liberando o horário antigo', async () => {
      const f = fabrica();
      const gerar = {
        agenda: f.agenda,
        de: dia4,
        ate: dia4,
        duracao: '00:20',
        horarios: horas.map((hora) => ({ data: dia4, hora })),
        escala: [
          {
            semana: 2,
            duracao: '00:20',
            horaInicio: '07:00',
            horaFim: '08:00',
            intervaloInicio: null,
            intervaloFim: null,
          },
        ],
        semanas: ['T', 'T', 'T', 'T', 'T', 'T', 'T'],
      };
      const g = await f.porta.executar(f.ctx, 'agenda.gerarGradeExame', gerar, op(f));
      expect(g.resultado['horarios']).toBe(3);
      expect(await estados(f)).toEqual({ '07:00': 'vago', '07:20': 'vago', '07:40': 'vago' });
      expect(
        codigoDe(await f.porta.executar(f.ctx, 'agenda.gerarGradeExame', gerar, op(f)).catch((e) => e)),
      ).toBe('previa-desatualizada');
      const m1 = Number((await marcar(f, '07:00')).resultado['marcacao']);
      expect((await estados(f))['07:00']).toBe('marcado');
      expect(codigoDe(await marcar(f, '07:00').catch((e) => e))).toBe('horario-ocupado');
      await f.porta.executar(
        f.ctx,
        'agenda.cancelarExame',
        { marcacao: m1, motivo: 'PAC-DESISTIU', solicitante: 'paciente' },
        op(f),
      );
      expect((await estados(f))['07:00']).toBe('vago');
      const m2 = Number((await marcar(f, '07:20')).resultado['marcacao']);
      const r = await f.porta.executar(
        f.ctx,
        'agenda.remarcarExame',
        {
          marcacao: m2,
          destino: { agenda: f.agenda, data: dia4, hora: '07:40' },
          modo: 'liberar',
          canal: 'telefone',
        },
        op(f),
      );
      expect(Number(r.resultado['marcacao'])).not.toBe(m2);
      expect(await estados(f)).toEqual({ '07:00': 'vago', '07:20': 'vago', '07:40': 'marcado' });
    });
  });
  it('cobertura por exame: inclui, recusa repetida, retira (exclusão lógica), reativa e grava a trilha junto', async () => {
    const trilha = (r: number) => ({
      estabelecimento: ids.est,
      usuario: ids.usuario,
      acao: 'inclusao' as const,
      entidade: 'agenda_servico_exame',
      entidadeId: r,
      correlacao: 'teste-20-cobertura',
    });
    const alvo = { agenda: ids.agenda, exame: ids.exame, convenio: null };
    const id = await porta.gravarSgh(ctx, trilha, (g) => g.incluirCobertura(alvo));
    expect(await porta.cobertura(ctx, ids.agenda)).toEqual([
      expect.objectContaining({
        id,
        agenda: ids.agenda,
        exame: ids.exame,
        convenio: null,
        convenioNome: null,
      }),
    ]);
    expect(await porta.cobertura(ctx, null)).toHaveLength(1);
    expect(
      codigoDe(await porta.gravarSgh(ctx, trilha, (g) => g.incluirCobertura(alvo)).catch((e) => e)),
    ).toBe('ja-coberto');
    expect(await porta.gravarSgh(ctx, trilha, (g) => g.encerrarCobertura(alvo))).toBe(1);
    expect(await porta.cobertura(ctx, ids.agenda)).toEqual([]);
    expect(await porta.gravarSgh(ctx, trilha, (g) => g.encerrarCobertura(alvo))).toBe(0);
    // Incluir de novo reativa a mesma linha (a chave única vale também para a excluída).
    expect(await porta.gravarSgh(ctx, trilha, (g) => g.incluirCobertura(alvo))).toBe(id);
    expect(
      codigoDe(
        await porta
          .gravarSgh(ctx, trilha, (g) => g.incluirCobertura({ ...alvo, agenda: 2_000_000_000 }))
          .catch((e) => e),
      ),
    ).toBe('agenda-desconhecida');
    const [n] = await ler<{ k: number }>(
      "SELECT COUNT(*) AS k FROM trilha_auditoria WHERE entidade = 'agenda_servico_exame' AND entidade_id = ?",
      [id],
    );
    // Inclusão, retirada e reativação: uma linha de trilha cada (a recusa não grava nada).
    expect(Number(n?.k)).toBe(3);
  });
});
