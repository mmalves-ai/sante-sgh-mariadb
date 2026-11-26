// Contrato de efeito das cotas e prazos de marcação (02-AGE linha 47) contra o MariaDB real, no cliente de teste
// (f22_o1 por padrão). Massa SINTÉTICA própria (estabelecimento f107c, login teste.f107c.a), idempotente; os registros
// do lote são limpos antes e depois. Prova: as linhas em cota_marcacao e prazo_aviso_marcacao (versão, ativo, sem
// apagar), a trilha na mesma transação, as recusas do domínio e a trava na marcação: antecedência mínima, aviso ao
// paciente, cota que bloqueia no limite e que só alerta, restrição confirmada da agenda que recusa e estimada que
// alerta, e a leitura com o uso da cota na janela; a remarcação com a cota no limite (a origem sai da contagem e o
// aviso volta), o item principal da agenda gravado na marcação e a cota por item, e a restrição por plano.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CotasPrazosPropria } from './cota-prazo.js';
import { instanteDe, PortaAgendaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'f107c';
const LOGIN = 'teste.f107c.a';
const FUSO = 'America/Sao_Paulo';
const DIA = '2030-03-12'; // terça-feira
const AGORA = instanteDe(FUSO, '2030-03-11', '09:00');
const CONVENIO = 9107;
const OUTRO = 9108;
const HORAS = ['08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45'];
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('cotas e prazos de marcação (porta própria, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let cotas: CotasPrazosPropria;
  let porta: PortaAgendaPropria;
  const ids = {
    est: 0,
    agenda: 0,
    usuario: 0,
    paciente: 0,
    fpA: 0,
    fpB: 0,
    esp: 0,
    cota: 0,
    prazo: 0,
    item: 0,
    itemFora: 0,
    plano: 0,
  };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const est = [ids.est];
    await e.executar('DELETE FROM cota_marcacao WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM prazo_aviso_marcacao WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM agenda_restricao WHERE agenda_servico_id = ?', [ids.agenda]);
    await e.executar('DELETE FROM cancelamento_marcacao WHERE estabelecimento_id = ?', est);
    await e.executar(
      'UPDATE marcacao_horario SET remarcada_marcacao_horario_id = NULL WHERE estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM marcacao_horario WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM agenda_item_agendavel WHERE agenda_servico_id = ?', [ids.agenda]);
    await e.executar('DELETE FROM horario_agenda WHERE estabelecimento_id = ?', est);
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
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-f107c' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctxG = () => ({
    hospital: EST,
    login: LOGIN,
    correlacao: 'teste-f107c',
    chaveIdempotencia: `f107c-${randomUUID()}`,
  });
  const ctxPorta = () => ({
    rede: 'teste',
    hospital: EST,
    login: LOGIN,
    gestorDeAgendas: false,
    administrador: false,
    correlacao: 'teste-f107c',
    chaveIdempotencia: `f107c-${randomUUID()}`,
  });
  const marcar = (hora: string, convenio: number, extra: { item?: number; plano?: number } = {}) =>
    porta
      .executar(ctxPorta(), 'agenda.agendarConsulta', {
        agenda: ids.agenda,
        data: DIA,
        hora,
        paciente: ids.paciente,
        convenio,
        retorno: false,
        canal: 'telefone',
        ...extra,
      })
      .then((r) => r.resultado as { marcacao: number; avisos?: string });
  const cotaBase = () => ({
    agenda: null,
    fontePagadora: ids.fpA,
    especialidade: ids.esp,
    tipoMarcacao: null,
    item: null,
    periodicidade: 'mes' as const,
    vigenciaInicio: '2030-01-01',
    vigenciaFim: null,
    quantidadeMaxima: 2,
    percentualMaximo: null,
    acao: 'bloquear' as const,
    ativo: true,
  });
  const prazoBase = () => ({
    agenda: ids.agenda,
    item: null,
    antecedenciaMinimaHoras: 48,
    antecedenciaMaximaDias: 30,
    textoAviso: 'Chegue 15 minutos antes com a carteirinha.',
    vigenciaInicio: null,
    vigenciaFim: null,
    ativo: true,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f107c' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [LOGIN, 'USUARIO SINTETICO F107C', agora],
      );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PROFISSIONAL SINTETICO F107C'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PROFISSIONAL SINTETICO F107C', agora],
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
        ['f107c-consulta'],
        'INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['f107c-consulta', 'Sintético f107c', agora],
      );
      ids.agenda = await garantir(
        e,
        'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, 'AGENDA SINTETICA F107C'],
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em)
         VALUES (?, ?, ?, ?, 15, ?)`,
        [ids.est, 'AGENDA SINTETICA F107C', cat, prof, agora],
      );
      const pp = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PACIENTE SINTETICO F107C'],
        'INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)',
        ['PACIENTE SINTETICO F107C', '1990-01-01', agora],
      );
      await e.executar('UPDATE pessoa_fisica SET data_nascimento = ? WHERE id = ?', ['1990-01-01', pp]);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 9107001, agora],
      );
      for (const [k, cod] of [
        ['fpA', CONVENIO],
        ['fpB', OUTRO],
      ] as const)
        ids[k] = await garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [String(cod)],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
          [String(cod), `CONVENIO SINTETICO ${cod}`, agora],
        );
      ids.esp = await garantir(
        e,
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        ['910701'],
        'INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['910701', 'ESPECIALIDADE SINTETICA F107C', agora],
      );
      if (
        !(await e.uma(
          'SELECT id FROM agenda_especialidade WHERE agenda_servico_id = ? AND especialidade_medica_id = ?',
          [ids.agenda, ids.esp],
        ))
      )
        await e.inserir(
          'INSERT INTO agenda_especialidade (agenda_servico_id, especialidade_medica_id, criado_em) VALUES (?, ?, ?)',
          [ids.agenda, ids.esp, agora],
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
          await dominio('situacao_marcacao', `f107c-${sig}`, { significado: sig });
      for (const nat of ['primeira_vez', 'retorno', 'encaixe'])
        if (!(await e.uma('SELECT id FROM tipo_marcacao WHERE natureza = ? AND ativo', [nat])))
          await dominio('tipo_marcacao', `f107c-${nat}`, { natureza: nat });
      await dominio('canal_marcacao', 'telefone');
      for (const [k, cod] of [
        ['item', 'f107c-item'],
        ['itemFora', 'f107c-item-fora'],
      ] as const)
        ids[k] = await garantir(
          e,
          'SELECT id FROM item_agendavel WHERE codigo = ?',
          [cod],
          "INSERT INTO item_agendavel (codigo, descricao, tipo_item, duracao_minutos, criado_em) VALUES (?, ?, 'consulta', 15, ?)",
          [cod, `ITEM SINTETICO ${cod}`, agora],
        );
      ids.plano = await garantir(
        e,
        'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ?',
        [ids.fpB, 'f107c-plano'],
        'INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids.fpB, 'f107c-plano', 'PLANO SINTETICO F107C', agora],
      );
      await limpar(e);
    });
    cotas = new CotasPrazosPropria(nucleo, CLIENTE, () => DIA);
    porta = new PortaAgendaPropria(nucleo, CLIENTE, () => AGORA);
    await porta.executar(ctxPorta(), 'agenda.gerarGrade', {
      agenda: ids.agenda,
      de: DIA,
      ate: DIA,
      duracao: '00:15',
      horarios: HORAS.map((hora) => ({ data: DIA, hora })),
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
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f107c' }, async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('grava a cota e o prazo com a trilha, recusa o cadastro inválido e altera pela versão', async () => {
    await expect(
      cotas.salvarCota(ctxG(), { ...cotaBase(), fontePagadora: null, especialidade: null }),
    ).rejects.toMatchObject(recusada('cota-sem-recorte'));
    await expect(cotas.salvarCota(ctxG(), { ...cotaBase(), quantidadeMaxima: null })).rejects.toMatchObject(
      recusada('cota-sem-limite'),
    );
    ids.cota = (await cotas.salvarCota(ctxG(), cotaBase())).resultado.cota;
    await expect(
      cotas.salvarPrazo(ctxG(), { ...prazoBase(), antecedenciaMinimaHoras: 72, antecedenciaMaximaDias: 2 }),
    ).rejects.toMatchObject(recusada('antecedencia-incoerente'));
    ids.prazo = (await cotas.salvarPrazo(ctxG(), prazoBase())).resultado.prazo;
    const [c] = await ler<Record<string, unknown>>(
      'SELECT fonte_pagadora_id, especialidade_medica_id, periodicidade, quantidade_maxima, acao_ao_esgotar, ativo, versao, criado_por FROM cota_marcacao WHERE id = ?',
      [ids.cota],
    );
    expect(c).toMatchObject({ periodicidade: 'mes', acao_ao_esgotar: 'bloquear' });
    expect(
      [c!['fonte_pagadora_id'], c!['especialidade_medica_id'], c!['quantidade_maxima'], c!['versao']].map(
        Number,
      ),
    ).toEqual([ids.fpA, ids.esp, 2, 1]);
    expect(Number(c!['criado_por'])).toBe(ids.usuario);
    const [t] = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade IN ('cota_marcacao', 'prazo_aviso_marcacao') AND entidade_id IN (?, ?)",
      [ids.cota, ids.prazo],
    );
    expect(Number(t!.n)).toBeGreaterThanOrEqual(2);
  });

  it('o prazo de aviso recusa a marcação sem a antecedência mínima e devolve o aviso ao paciente', async () => {
    await expect(marcar('08:00', CONVENIO)).rejects.toMatchObject(recusada('antecedencia-minima'));
    // Versão velha não altera (409).
    await expect(
      cotas.salvarPrazo(ctxG(), { ...prazoBase(), id: ids.prazo, versao: 9, antecedenciaMinimaHoras: 12 }),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ status: 409 }) });
    await cotas.salvarPrazo(ctxG(), {
      ...prazoBase(),
      id: ids.prazo,
      versao: 1,
      antecedenciaMinimaHoras: 12,
    });
    const [p] = await ler<{ antecedencia_minima_horas: number; versao: number }>(
      'SELECT antecedencia_minima_horas, versao FROM prazo_aviso_marcacao WHERE id = ?',
      [ids.prazo],
    );
    expect([Number(p!.antecedencia_minima_horas), Number(p!.versao)]).toEqual([12, 2]);
    const r = await marcar('08:00', CONVENIO);
    expect(r.avisos).toBe('Aviso ao paciente: Chegue 15 minutos antes com a carteirinha.');
  });

  it('a cota bloqueia no limite e, mudada para alertar, deixa passar com o aviso; a leitura mostra o uso', async () => {
    await marcar('08:15', CONVENIO);
    await expect(marcar('08:30', CONVENIO)).rejects.toMatchObject(recusada('cota-esgotada'));
    const [n] = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM marcacao_horario WHERE estabelecimento_id = ? AND fonte_pagadora_id = ?',
      [ids.est, ids.fpA],
    );
    expect(Number(n!.n)).toBe(2);
    await cotas.salvarCota(ctxG(), { ...cotaBase(), id: ids.cota, versao: 1, acao: 'alertar' });
    const r = await marcar('08:30', CONVENIO);
    expect(r.avisos).toContain('2 de 2');
    const lido = await cotas.listar({ hospital: EST, login: LOGIN });
    const k = lido.cotas.find((x) => x.id === ids.cota)!;
    expect(k).toMatchObject({ acao: 'alertar', versao: 2 });
    expect(k.uso).toEqual({ usadas: 3, limite: 2, inicio: '2030-03-01', fim: '2030-03-31' });
    expect(lido.prazos.map((x) => x.id)).toEqual([ids.prazo]);
  });

  it('a restrição confirmada da agenda recusa a marcação; a estimada só alerta', async () => {
    const regra = (situacao: string) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'restricao-f107c' }, (e) =>
        e.executar(
          `INSERT INTO agenda_restricao (agenda_servico_id, fonte_pagadora_id, idade_minima_anos, vigencia_inicio,
             situacao_revisao, criado_em) VALUES (?, ?, 60, '2030-01-01', ?, NOW(3))`,
          [ids.agenda, ids.fpB, situacao],
        ),
      );
    await regra('confirmada');
    await expect(marcar('08:45', OUTRO)).rejects.toMatchObject(recusada('restricao-agenda'));
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'restricao-f107c' }, (e) =>
      e.executar("UPDATE agenda_restricao SET situacao_revisao = 'estimada' WHERE agenda_servico_id = ?", [
        ids.agenda,
      ]),
    );
    const r = await marcar('08:45', OUTRO);
    expect(r.avisos).toContain('Regra da agenda ainda a confirmar');
  });

  it('a remarcação com a cota no limite passa (a origem sai da contagem) e devolve o aviso ao paciente', async () => {
    // A cota do convênio A volta a bloquear, no limite das 3 marcações ativas (08:00, 08:15 e 08:30).
    await cotas.salvarCota(ctxG(), { ...cotaBase(), id: ids.cota, versao: 2, quantidadeMaxima: 3 });
    await expect(marcar('09:00', CONVENIO)).rejects.toMatchObject(recusada('cota-esgotada'));
    const [origem] = await ler<{ id: number }>(
      `SELECT m.id FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
        WHERE m.estabelecimento_id = ? AND h.inicio_em = ?`,
      [ids.est, instanteDe(FUSO, DIA, '08:30')],
    );
    const r = (
      await porta.executar(ctxPorta(), 'agenda.remarcarConsulta', {
        marcacao: Number(origem!.id),
        destino: { agenda: ids.agenda, data: DIA, hora: '09:00' },
        modo: 'liberar',
        canal: 'telefone',
      })
    ).resultado as { marcacao: number; avisos?: string };
    expect(r.avisos).toContain('Aviso ao paciente: Chegue 15 minutos antes com a carteirinha.');
    const linhas = await ler<{ id: number; significado: string; remarcada: number | null }>(
      `SELECT m.id, s.significado, m.remarcada_marcacao_horario_id AS remarcada FROM marcacao_horario m
         JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
        WHERE m.id IN (?, ?) ORDER BY m.id`,
      [Number(origem!.id), r.marcacao],
    );
    expect(linhas.map((x) => [x.significado, x.remarcada === null ? null : Number(x.remarcada)])).toEqual([
      ['cancelada', null],
      ['aguardando', Number(origem!.id)],
    ]);
    const [n] = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM marcacao_horario m JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
        WHERE m.estabelecimento_id = ? AND m.fonte_pagadora_id = ? AND s.significado <> 'cancelada'`,
      [ids.est, ids.fpA],
    );
    expect(Number(n!.n)).toBe(3);
  });

  it('o item principal da agenda vai à marcação e a cota por item vale; o item fora da agenda é recusado', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'item-f107c' }, (e) =>
      e.executar(
        'INSERT INTO agenda_item_agendavel (agenda_servico_id, item_agendavel_id, criado_em) VALUES (?, ?, NOW(3))',
        [ids.agenda, ids.item],
      ),
    );
    // A cota por agenda e item que a agenda não oferece nunca valeria: recusada no cadastro.
    await expect(
      cotas.salvarCota(ctxG(), {
        ...cotaBase(),
        agenda: ids.agenda,
        fontePagadora: null,
        especialidade: null,
        item: ids.itemFora,
        quantidadeMaxima: 1,
      }),
    ).rejects.toMatchObject(recusada('item-fora-da-agenda'));
    await cotas.salvarCota(ctxG(), {
      ...cotaBase(),
      agenda: ids.agenda,
      fontePagadora: null,
      especialidade: null,
      item: ids.item,
      quantidadeMaxima: 1,
    });
    await expect(marcar('09:15', OUTRO, { item: ids.itemFora })).rejects.toMatchObject(
      recusada('item-fora-da-agenda'),
    );
    const r = await marcar('09:15', OUTRO);
    const [m] = await ler<{ item_agendavel_id: number | null }>(
      'SELECT item_agendavel_id FROM marcacao_horario WHERE id = ?',
      [r.marcacao],
    );
    expect(Number(m!.item_agendavel_id)).toBe(ids.item);
    await expect(marcar('09:30', OUTRO)).rejects.toMatchObject(recusada('cota-esgotada'));
  });

  it('a restrição confirmada por plano vale só para a marcação daquele plano; plano de outro convênio é recusado', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'plano-f107c' }, async (e) => {
      // A cota por item sai de cena: o caso é só a restrição por plano.
      await e.executar(
        'UPDATE cota_marcacao SET ativo = FALSE WHERE estabelecimento_id = ? AND item_agendavel_id IS NOT NULL',
        [ids.est],
      );
      await e.executar(
        `INSERT INTO agenda_restricao (agenda_servico_id, fonte_pagadora_id, plano_fonte_pagadora_id, idade_minima_anos,
           vigencia_inicio, situacao_revisao, criado_em) VALUES (?, ?, ?, 60, '2030-01-01', 'confirmada', NOW(3))`,
        [ids.agenda, ids.fpB, ids.plano],
      );
    });
    await expect(marcar('09:30', CONVENIO, { plano: ids.plano })).rejects.toMatchObject(
      recusada('plano-de-outro-convenio'),
    );
    await expect(marcar('09:30', OUTRO, { plano: ids.plano })).rejects.toMatchObject(
      recusada('restricao-agenda'),
    );
    const r = await marcar('09:30', OUTRO);
    const [m] = await ler<{ plano_fonte_pagadora_id: number | null }>(
      'SELECT plano_fonte_pagadora_id FROM marcacao_horario WHERE id = ?',
      [r.marcacao],
    );
    expect(m!.plano_fonte_pagadora_id).toBeNull();
  });
});
