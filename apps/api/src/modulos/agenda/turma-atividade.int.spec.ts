// Contrato de efeito da agenda de grupos e turmas (02-AGE linha 50) contra o MariaDB real, no cliente de teste (f22_o1
// por padrão). Massa SINTÉTICA própria (estabelecimento c2067, login teste.c2067.a), idempotente; os registros do lote
// são limpos antes e depois. Prova: a turma com profissionais e fontes (retirada sem apagar), a escala e a recusa de
// sobreposição, a geração dos encontros sem feriado e sem repetir, a inscrição com as recusas (idade, sexo, indicação,
// fonte, limite da fonte) e a espera com posição, a saída com a promoção do primeiro da espera, a presença (recusa no
// encontro futuro, falta justificada, participante que passa a ativo, encontro realizado), o cancelamento com motivo,
// a visão por paciente com a frequência e a trilha na mesma transação; a promoção da espera só para vaga regular e
// dentro do limite da fonte (saída de quem estava no encaixe não promove; a fonte no limite fica na espera); a volta de
// quem saiu como participação nova, com a encerrada intacta e a frequência de cada uma separada. SGH_NUCLEO_SEM_BANCO=1
// pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { instanteDe } from './porta-propria.js';
import { TurmasAtividadePropria } from './turma-atividade.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c2067';
const LOGIN = 'teste.c2067.a';
const FUSO = 'America/Sao_Paulo';
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('agenda de grupos e turmas (porta própria, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let agora = instanteDe(FUSO, '2030-03-01', '09:00');
  let turmas: TurmasAtividadePropria;
  const ids = {
    est: 0,
    usuario: 0,
    tipo: 0,
    item: 0,
    setor: 0,
    prof1: 0,
    prof2: 0,
    fpA: 0,
    fpB: 0,
    sexoF: 0,
    sexoM: 0,
    pac: [] as number[],
    criança: 0,
    turma: 0,
  };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const t = 'SELECT id FROM turma_atividade WHERE estabelecimento_id = ?';
    const est = [ids.est];
    await e.executar(
      `DELETE x FROM turma_presenca x JOIN turma_encontro n ON n.id = x.turma_encontro_id WHERE n.turma_atividade_id IN (${t})`,
      est,
    );
    for (const tabela of [
      'turma_encontro',
      'turma_participante',
      'turma_escala',
      'turma_profissional',
      'turma_fonte_pagadora',
    ] as const)
      await e.executar(`DELETE FROM ${tabela} WHERE turma_atividade_id IN (${t})`, est);
    await e.executar('DELETE FROM turma_atividade WHERE estabelecimento_id = ?', est);
    await e.executar(
      "DELETE FROM dia_nao_util WHERE estabelecimento_id = ? AND descricao = 'FERIADO C2067'",
      est,
    );
  };
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2067' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctxG = () => ({
    hospital: EST,
    login: LOGIN,
    correlacao: 'teste-c2067',
    chaveIdempotencia: `c2067-${randomUUID()}`,
  });
  const ctxL = { hospital: EST, login: LOGIN };
  const turmaBase = () => ({
    codigo: 'GRP-HAS',
    descricao: 'GRUPO SINTETICO DE HIPERTENSOS',
    tipo: ids.tipo,
    itemAgendavel: ids.item,
    setorFuncional: ids.setor,
    localFisico: null,
    dataInicio: '2030-03-01',
    dataFim: '2030-06-30',
    vagas: 2,
    vagasEncaixe: 0,
    exigeAcompanhante: false,
    permiteAcompanhante: true,
    exigeIndicacaoMedica: true,
    idadeMinimaAnos: 18,
    idadeMaximaAnos: 90,
    sexo: null as number | null,
    ativo: true,
    profissionais: [
      { profissional: ids.prof1, principal: true },
      { profissional: ids.prof2, principal: false },
    ],
    fontes: [
      { fontePagadora: ids.fpA, plano: null, limite: null as number | null },
      { fontePagadora: ids.fpB, plano: null, limite: 1 as number | null },
    ],
  });
  const inscricao = (paciente: number, x: Record<string, unknown> = {}) => ({
    turma: ids.turma,
    paciente,
    fontePagadora: ids.fpA,
    plano: null,
    indicacaoProfissional: ids.prof1,
    acompanhante: false,
    encaixe: false,
    observacao: null,
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2067' }, async (e) => {
      const hoje = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, hoje],
      );
      await e.executar('UPDATE estabelecimento SET fuso_horario = ? WHERE id = ?', [FUSO, ids.est]);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [LOGIN, 'USUARIO SINTETICO C2067', hoje],
      );
      const sexo = (codigo: string, sigla: string) =>
        garantir(
          e,
          'SELECT id FROM sexo WHERE sigla = ? ORDER BY id LIMIT 1',
          [sigla],
          'INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Sintético ${codigo}`, sigla, hoje],
        );
      ids.sexoF = await sexo('c2067-f', 'F');
      ids.sexoM = await sexo('c2067-m', 'M');
      const pessoa = (nome: string, nascimento: string | null, sx: number | null) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, data_nascimento, sexo_id, criado_em) VALUES (?, ?, ?, ?)',
          [nome, nascimento, sx, hoje],
        );
      for (const [i, nome] of [
        'PROFISSIONAL SINTETICO C2067 A',
        'PROFISSIONAL SINTETICO C2067 B',
      ].entries()) {
        const pf = await pessoa(nome, null, null);
        const prof = await garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, hoje],
        );
        if (i === 0) ids.prof1 = prof;
        else ids.prof2 = prof;
      }
      const paciente = async (n: number, nascimento: string, sx: number) => {
        const nome = `PACIENTE SINTETICO C2067 ${n}`;
        const pf = await pessoa(nome, nascimento, sx);
        await e.executar('UPDATE pessoa_fisica SET data_nascimento = ?, sexo_id = ? WHERE id = ?', [
          nascimento,
          sx,
          pf,
        ]);
        return garantir(
          e,
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pf],
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pf, 9206700 + n, hoje],
        );
      };
      ids.pac = [];
      for (let n = 1; n <= 4; n++)
        ids.pac.push(await paciente(n, '1960-01-15', n % 2 ? ids.sexoF : ids.sexoM));
      ids.criança = await paciente(9, '2025-01-15', ids.sexoF);
      for (const [k, cod] of [
        ['fpA', '920671'],
        ['fpB', '920672'],
      ] as const)
        ids[k] = await garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [cod],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
          [cod, `CONVENIO SINTETICO ${cod}`, hoje],
        );
      ids.tipo = await garantir(
        e,
        'SELECT id FROM tipo_turma_atividade WHERE codigo = ?',
        ['c2067-grupo'],
        'INSERT INTO tipo_turma_atividade (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['c2067-grupo', 'GRUPO TERAPEUTICO SINTETICO', hoje],
      );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_agendavel WHERE codigo = ?',
        ['C2067-GRUPO'],
        "INSERT INTO item_agendavel (codigo, descricao, tipo_item, duracao_minutos, criado_em) VALUES (?, ?, 'sessao', 90, ?)",
        ['C2067-GRUPO', 'SESSAO DE GRUPO SINTETICA', hoje],
      );
      ids.setor = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'C2067-AMB'],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'AMBULATORIO SINTETICO', 'assistencial', ?)",
        [ids.est, 'C2067-AMB', hoje],
      );
      await limpar(e);
      await e.inserir(
        `INSERT INTO dia_nao_util (descricao, abrangencia, estabelecimento_id, recorrencia, data, criado_em)
         VALUES ('FERIADO C2067', 'estabelecimento', ?, 'data_unica', '2030-03-12', ?)`,
        [ids.est, hoje],
      );
    });
    turmas = new TurmasAtividadePropria(nucleo, CLIENTE, () => agora);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2067' }, async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('turma, escala e encontros: grava com a trilha, retira sem apagar e gera sem feriado nem repetição', async () => {
    await expect(turmas.salvarTurma(ctxG(), { ...turmaBase(), vagas: 0 })).rejects.toThrow();
    await expect(
      turmas.salvarTurma(ctxG(), { ...turmaBase(), idadeMinimaAnos: 60, idadeMaximaAnos: 20 }),
    ).rejects.toMatchObject(recusada('turma-idade-invertida'));
    const r = await turmas.salvarTurma(ctxG(), turmaBase());
    ids.turma = r.resultado.turma;
    await expect(turmas.salvarTurma(ctxG(), turmaBase())).rejects.toMatchObject(
      recusada('turma-codigo-repetido'),
    );
    const [t] = await ler<Record<string, unknown>>(
      'SELECT versao, vagas, criado_por, liberada_em FROM turma_atividade WHERE id = ?',
      [ids.turma],
    );
    expect([Number(t!['versao']), Number(t!['vagas']), Number(t!['criado_por'])]).toEqual([
      1,
      2,
      ids.usuario,
    ]);
    expect(t!['liberada_em']).not.toBeNull();
    // Alteração: retira o profissional B e a fonte B (sem apagar).
    await turmas.salvarTurma(ctxG(), {
      ...turmaBase(),
      id: ids.turma,
      versao: 1,
      profissionais: [{ profissional: ids.prof1, principal: true }],
      fontes: [turmaBase().fontes[0]!],
    });
    const profs = await ler<Record<string, unknown>>(
      'SELECT profissional_id, vigencia_fim FROM turma_profissional WHERE turma_atividade_id = ? ORDER BY profissional_id',
      [ids.turma],
    );
    expect(profs.map((p) => [Number(p['profissional_id']), p['vigencia_fim'] === null])).toEqual([
      [ids.prof1, true],
      [ids.prof2, false],
    ]);
    const fontes = await ler<Record<string, unknown>>(
      'SELECT fonte_pagadora_id, excluido_em FROM turma_fonte_pagadora WHERE turma_atividade_id = ? ORDER BY fonte_pagadora_id',
      [ids.turma],
    );
    expect(fontes.map((f) => [Number(f['fonte_pagadora_id']), f['excluido_em'] === null])).toEqual([
      [ids.fpA, true],
      [ids.fpB, false],
    ]);
    // Volta a fonte B com limite 1 (reativada na mesma linha).
    await turmas.salvarTurma(ctxG(), { ...turmaBase(), id: ids.turma, versao: 2 });
    expect(
      (
        await ler<Record<string, unknown>>(
          'SELECT COUNT(*) AS n FROM turma_fonte_pagadora WHERE turma_atividade_id = ? AND excluido_em IS NULL',
          [ids.turma],
        )
      )[0]!['n'],
    ).toBe(2);

    const escala = {
      turma: ids.turma,
      diaSemana: 3,
      horaInicio: '14:00',
      horaFim: '15:30',
      inclusiveFeriado: false,
      vigenciaInicio: '2030-03-01',
      vigenciaFim: null,
      ativo: true,
    };
    await expect(turmas.salvarEscala(ctxG(), { ...escala, horaFim: '13:00' })).rejects.toMatchObject(
      recusada('escala-horario-invertido'),
    );
    await turmas.salvarEscala(ctxG(), escala);
    await expect(
      turmas.salvarEscala(ctxG(), { ...escala, horaInicio: '15:00', horaFim: '16:00' }),
    ).rejects.toMatchObject(recusada('escala-sobreposta'));

    const g = await turmas.gerarEncontros(ctxG(), { turma: ids.turma, de: '2030-03-01', ate: '2030-03-31' });
    expect(g.resultado).toMatchObject({ gerados: 3, feriados: 1, existentes: 0 });
    const g2 = await turmas.gerarEncontros(ctxG(), { turma: ids.turma, de: '2030-03-01', ate: '2030-03-31' });
    expect(g2.resultado).toMatchObject({ gerados: 0, existentes: 3 });
    const enc = await ler<Record<string, unknown>>(
      'SELECT inicio, condutor_profissional_id, situacao, turma_escala_id FROM turma_encontro WHERE turma_atividade_id = ? ORDER BY inicio',
      [ids.turma],
    );
    expect(enc.map((x) => (x['inicio'] as Date).getTime())).toEqual(
      ['2030-03-05', '2030-03-19', '2030-03-26'].map((d) => instanteDe(FUSO, d, '14:00').getTime()),
    );
    expect(
      enc.every((x) => Number(x['condutor_profissional_id']) === ids.prof1 && x['situacao'] === 'previsto'),
    ).toBe(true);
    const trilha = await ler<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade IN ('turma_atividade','turma_escala')`,
      [ids.est],
    );
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(4);
  });

  it('inscrição: recusas, limite da fonte, espera com posição e promoção na saída', async () => {
    const [p1, p2, p3, p4] = ids.pac as [number, number, number, number];
    await expect(turmas.inscrever(ctxG(), inscricao(ids.criança))).rejects.toMatchObject(
      recusada('idade-fora-da-turma'),
    );
    await expect(
      turmas.inscrever(ctxG(), inscricao(p1, { indicacaoProfissional: null })),
    ).rejects.toMatchObject(recusada('indicacao-obrigatoria'));
    const outra = await ler<Record<string, unknown>>(
      "SELECT id FROM fonte_pagadora WHERE codigo NOT IN ('920671','920672') LIMIT 1",
      [],
    );
    if (outra[0])
      await expect(
        turmas.inscrever(ctxG(), inscricao(p1, { fontePagadora: Number(outra[0]['id']) })),
      ).rejects.toMatchObject(recusada('fonte-nao-aceita'));
    const a = await turmas.inscrever(ctxG(), inscricao(p1, { fontePagadora: ids.fpB }));
    expect(a.resultado).toMatchObject({ situacao: 'inscrito', posicaoEspera: null });
    await expect(turmas.inscrever(ctxG(), inscricao(p2, { fontePagadora: ids.fpB }))).rejects.toMatchObject(
      recusada('limite-da-fonte'),
    );
    await expect(turmas.inscrever(ctxG(), inscricao(p1))).rejects.toMatchObject(
      recusada('paciente-ja-na-turma'),
    );
    await turmas.inscrever(ctxG(), inscricao(p2));
    const c = await turmas.inscrever(ctxG(), inscricao(p3));
    expect(c.resultado).toMatchObject({ situacao: 'em_espera', posicaoEspera: 1 });
    const d = await turmas.inscrever(ctxG(), inscricao(p4));
    expect(d.resultado).toMatchObject({ situacao: 'em_espera', posicaoEspera: 2 });

    const part = await ler<Record<string, unknown>>(
      'SELECT id, versao, paciente_id, situacao, posicao_espera FROM turma_participante WHERE turma_atividade_id = ? ORDER BY id',
      [ids.turma],
    );
    expect(
      part.map((x) => [x['situacao'], x['posicao_espera'] === null ? null : Number(x['posicao_espera'])]),
    ).toEqual([
      ['inscrito', null],
      ['inscrito', null],
      ['em_espera', 1],
      ['em_espera', 2],
    ]);
    const p2Linha = part[1]!;
    await expect(
      turmas.sair(ctxG(), {
        participante: Number(p2Linha['id']),
        versao: Number(p2Linha['versao']),
        saida: 'desligado',
        motivo: ' ',
      }),
    ).rejects.toMatchObject(recusada('saida-sem-motivo'));
    const s = await turmas.sair(ctxG(), {
      participante: Number(p2Linha['id']),
      versao: Number(p2Linha['versao']),
      saida: 'desistente',
      motivo: 'Mudou de cidade',
    });
    expect(s.resultado.promovido).toBe(Number(part[2]!['id']));
    const depois = await ler<Record<string, unknown>>(
      'SELECT situacao, desligado_em, motivo_desligamento, posicao_espera FROM turma_participante WHERE turma_atividade_id = ? ORDER BY id',
      [ids.turma],
    );
    expect(depois.map((x) => x['situacao'])).toEqual(['inscrito', 'desistente', 'inscrito', 'em_espera']);
    expect(depois[1]!['desligado_em']).not.toBeNull();
    expect(depois[1]!['motivo_desligamento']).toBe('Mudou de cidade');
    expect(depois[2]!['posicao_espera']).toBeNull();
  });

  it('presença e cancelamento: encontro futuro recusa, falta justificada, ativo, realizado e frequência por paciente', async () => {
    const [e1, e2] = await ler<Record<string, unknown>>(
      'SELECT id, versao FROM turma_encontro WHERE turma_atividade_id = ? ORDER BY inicio',
      [ids.turma],
    );
    const part = await ler<Record<string, unknown>>(
      "SELECT id, paciente_id FROM turma_participante WHERE turma_atividade_id = ? AND situacao = 'inscrito' ORDER BY id",
      [ids.turma],
    );
    const [pa, pb] = part.map((x) => Number(x['id'])) as [number, number];
    const registros = [
      { participante: pa, situacao: 'presente' as const, justificativa: null, acompanhante: true },
      {
        participante: pb,
        situacao: 'falta_justificada' as const,
        justificativa: 'Consulta médica',
        acompanhante: false,
      },
    ];
    await expect(
      turmas.registrarPresenca(ctxG(), { encontro: Number(e1!['id']), registros }),
    ).rejects.toMatchObject(recusada('encontro-futuro'));
    agora = instanteDe(FUSO, '2030-03-05', '16:00');
    await expect(
      turmas.registrarPresenca(ctxG(), {
        encontro: Number(e1!['id']),
        registros: [{ ...registros[1]!, justificativa: null }],
      }),
    ).rejects.toMatchObject(recusada('falta-sem-justificativa'));
    const r = await turmas.registrarPresenca(ctxG(), { encontro: Number(e1!['id']), registros });
    expect(r.resultado.registradas).toBe(2);
    const pres = await ler<Record<string, unknown>>(
      'SELECT turma_participante_id, situacao, justificativa, acompanhante_presente FROM turma_presenca WHERE turma_encontro_id = ? ORDER BY turma_participante_id',
      [Number(e1!['id'])],
    );
    expect(pres.map((x) => [Number(x['turma_participante_id']), x['situacao'], x['justificativa']])).toEqual([
      [pa, 'presente', null],
      [pb, 'falta_justificada', 'Consulta médica'],
    ]);
    const situacoes = await ler<Record<string, unknown>>(
      'SELECT id, situacao FROM turma_participante WHERE id IN (?, ?) ORDER BY id',
      [pa, pb],
    );
    expect(situacoes.map((x) => x['situacao'])).toEqual(['ativo', 'inscrito']);
    const [enc] = await ler<Record<string, unknown>>('SELECT situacao FROM turma_encontro WHERE id = ?', [
      Number(e1!['id']),
    ]);
    expect(enc!['situacao']).toBe('realizado');
    // Correção da presença: a mesma linha é alterada (versão 2), nada se duplica.
    await turmas.registrarPresenca(ctxG(), {
      encontro: Number(e1!['id']),
      registros: [{ ...registros[1]!, situacao: 'presente', justificativa: null }],
    });
    const corr = await ler<Record<string, unknown>>(
      'SELECT situacao, versao FROM turma_presenca WHERE turma_encontro_id = ? AND turma_participante_id = ?',
      [Number(e1!['id']), pb],
    );
    expect(corr.map((x) => [x['situacao'], Number(x['versao'])])).toEqual([['presente', 2]]);

    await expect(
      turmas.cancelarEncontro(ctxG(), { encontro: Number(e1!['id']), versao: 2, motivo: 'x' }),
    ).rejects.toMatchObject(recusada('encontro-realizado'));
    await expect(
      turmas.cancelarEncontro(ctxG(), {
        encontro: Number(e2!['id']),
        versao: Number(e2!['versao']),
        motivo: '  ',
      }),
    ).rejects.toMatchObject(recusada('cancelamento-sem-motivo'));
    await turmas.cancelarEncontro(ctxG(), {
      encontro: Number(e2!['id']),
      versao: Number(e2!['versao']),
      motivo: 'Profissional em capacitação',
    });
    const [can] = await ler<Record<string, unknown>>(
      'SELECT situacao, motivo_cancelamento, excluido_em FROM turma_encontro WHERE id = ?',
      [Number(e2!['id'])],
    );
    expect([can!['situacao'], can!['motivo_cancelamento'], can!['excluido_em']]).toEqual([
      'cancelado',
      'Profissional em capacitação',
      null,
    ]);
    agora = instanteDe(FUSO, '2030-03-20', '09:00');
    await expect(
      turmas.registrarPresenca(ctxG(), { encontro: Number(e2!['id']), registros: [registros[0]!] }),
    ).rejects.toMatchObject(recusada('encontro-cancelado'));

    // Leituras: lista, detalhe, presença do encontro e visão por paciente (frequência).
    const lista = await turmas.listar(ctxL);
    expect(lista).toEqual([
      expect.objectContaining({ id: ids.turma, ocupadas: 2, espera: 1, proximoEncontro: '2030-03-26 14:00' }),
    ]);
    const det = await turmas.detalhe(ctxL, ids.turma);
    expect(det.encontros.map((x) => x.situacao)).toEqual(['realizado', 'cancelado', 'previsto']);
    expect(det.participantes.find((x) => x.id === pa)?.frequencia).toBe(100);
    const pe = await turmas.presencaDoEncontro(ctxL, Number(e1!['id']));
    expect(pe.participantes.map((x) => x.situacao)).toEqual(['presente', 'presente']);
    const pac = Number(part.find((x) => Number(x['id']) === pa)!['paciente_id']);
    const visao = await turmas.doPaciente(ctxL, pac);
    expect(visao).toEqual([
      expect.objectContaining({
        turma: ids.turma,
        situacao: 'ativo',
        frequencia: 100,
        proximoEncontro: '2030-03-26 14:00',
      }),
    ]);
    const trilha = await ler<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade IN ('turma_presenca','turma_encontro','turma_participante')`,
      [ids.est],
    );
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(8);
  });

  it('promoção da espera: só vaga regular e limite da fonte; a volta de quem saiu é participação nova', async () => {
    const [p1, p2, p3, p4] = ids.pac as [number, number, number, number];
    const p5 = ids.criança;
    const t2 = await turmas.salvarTurma(ctxG(), {
      ...turmaBase(),
      codigo: 'GRP-ENC',
      descricao: 'GRUPO SINTETICO COM ENCAIXE',
      vagas: 2,
      vagasEncaixe: 1,
      exigeIndicacaoMedica: false,
      idadeMinimaAnos: null,
      idadeMaximaAnos: null,
      fontes: [
        { fontePagadora: ids.fpA, plano: null, limite: 1 },
        { fontePagadora: ids.fpB, plano: null, limite: null },
      ],
    });
    const turma = t2.resultado.turma;
    const ins = (paciente: number, x: Record<string, unknown> = {}) =>
      turmas.inscrever(ctxG(), { ...inscricao(paciente, { indicacaoProfissional: null, ...x }), turma });
    const linha = async (paciente: number) =>
      (
        await ler<Record<string, unknown>>(
          `SELECT id, versao, situacao, posicao_espera FROM turma_participante
            WHERE turma_atividade_id = ? AND paciente_id = ? ORDER BY id DESC LIMIT 1`,
          [turma, paciente],
        )
      )[0]!;
    const sair = async (paciente: number) => {
      const l = await linha(paciente);
      return turmas.sair(ctxG(), {
        participante: Number(l['id']),
        versao: Number(l['versao']),
        saida: 'desistente',
        motivo: 'Teste sintético',
      });
    };
    await ins(p1, { fontePagadora: ids.fpB });
    await ins(p2, { fontePagadora: ids.fpB });
    expect((await ins(p3, { fontePagadora: ids.fpB, encaixe: true })).resultado.situacao).toBe('inscrito');
    // Fonte A com limite 1 e 0 usadas: os dois entram na espera (a turma está cheia).
    expect((await ins(p4)).resultado).toMatchObject({ situacao: 'em_espera', posicaoEspera: 1 });
    expect((await ins(p5)).resultado).toMatchObject({ situacao: 'em_espera', posicaoEspera: 2 });
    // Sai quem estava no encaixe: ficam 2 de 2 vagas regulares, ninguém sobe.
    expect((await sair(p3)).resultado).toMatchObject({ promovido: null, promovidos: 0 });
    expect((await linha(p4))['situacao']).toBe('em_espera');
    // Sai um da fonte B: abre vaga regular e sobe o primeiro da espera (fonte A passa a 1 de 1).
    const s1 = await sair(p1);
    expect(s1.resultado.promovido).toBe(Number((await linha(p4))['id']));
    expect((await linha(p4))['situacao']).toBe('inscrito');
    // Sai o outro da fonte B: há vaga, mas o próximo da espera é da fonte A, já no limite: fica na espera.
    expect((await sair(p2)).resultado).toMatchObject({ promovido: null, promovidos: 0 });
    expect((await linha(p5))['situacao']).toBe('em_espera');
    const fonteA = await ler<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM turma_participante WHERE turma_atividade_id = ? AND fonte_pagadora_id = ?
          AND situacao IN ('inscrito','ativo')`,
      [turma, ids.fpA],
    );
    expect(Number(fonteA[0]!['n'])).toBe(1);

    // Volta de quem saiu (turma 1, cheia: a volta entra na espera): a participação encerrada fica com a data e a
    // presença; a nova é outra linha, com frequência própria.
    const [pa] = await ler<Record<string, unknown>>(
      "SELECT id, versao, paciente_id FROM turma_participante WHERE turma_atividade_id = ? AND situacao = 'ativo'",
      [ids.turma],
    );
    const pac = Number(pa!['paciente_id']);
    await turmas.sair(ctxG(), {
      participante: Number(pa!['id']),
      versao: Number(pa!['versao']),
      saida: 'concluido',
      motivo: null,
    });
    await expect(turmas.inscrever(ctxG(), inscricao(p3))).rejects.toMatchObject(
      recusada('paciente-ja-na-turma'),
    );
    const volta = await turmas.inscrever(ctxG(), inscricao(pac, { fontePagadora: ids.fpB }));
    expect(volta.resultado.participante).not.toBe(Number(pa!['id']));
    const historico = await ler<Record<string, unknown>>(
      `SELECT id, situacao, desligado_em, inscrito_em FROM turma_participante
        WHERE turma_atividade_id = ? AND paciente_id = ? ORDER BY id`,
      [ids.turma, pac],
    );
    expect(historico.map((x) => [Number(x['id']), x['situacao']])).toEqual([
      [Number(pa!['id']), 'concluido'],
      [volta.resultado.participante, 'em_espera'],
    ]);
    expect(historico[0]!['desligado_em']).not.toBeNull();
    expect(historico[1]!['desligado_em']).toBeNull();
    const pres = await ler<Record<string, unknown>>(
      'SELECT COUNT(*) AS n FROM turma_presenca WHERE turma_participante_id = ?',
      [Number(pa!['id'])],
    );
    expect(Number(pres[0]!['n'])).toBe(1);
    const det = await turmas.detalhe(ctxL, ids.turma);
    const doPac = det.participantes.filter((x) => x.paciente === pac);
    expect(doPac.map((x) => [x.situacao, x.frequencia])).toEqual([
      ['em_espera', null],
      ['concluido', 100],
    ]);
    expect(doPac[1]!.desligadoEm).not.toBeNull();
    const visao = await turmas.doPaciente(ctxL, pac);
    // O paciente também tem a participação encerrada na turma com encaixe: a visão traz todas, a mais nova primeiro.
    expect(visao.filter((x) => x.turma === turma).map((x) => x.situacao)).toEqual(['desistente']);
    expect(
      visao.filter((x) => x.turma === ids.turma).map((x) => [x.participacao, x.situacao, x.frequencia]),
    ).toEqual([
      [volta.resultado.participante, 'em_espera', null],
      [Number(pa!['id']), 'concluido', 100],
    ]);
  });
});
