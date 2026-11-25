// Contrato de efeito dos itens agendáveis (02-AGE linha 45) contra o MariaDB real, no cliente de teste (f22_o1 por
// padrão). Massa SINTÉTICA própria (estabelecimento c2054, login teste.c2054, itens C2054-*), idempotente; os registros
// do lote são limpos antes e depois. Prova: o cadastro do item e das regras filhas (composição, conflito, pré-requisito,
// recurso, orientação por convênio) com versão e retirada sem apagar; as recusas do domínio (pacote vazio, ciclo de
// pré-requisito, código repetido); e, na marcação, a crítica (pré-requisito, conflito, equipamento ocupado, item
// repetido) que bloqueia sem gravar, o lançamento com o preparo entregue em marcacao_horario_item, o equipamento
// reservado em marcacao_equipamento e o pacote desdobrado. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ItensAgendaveisPropria } from './itens-agendaveis.js';
import { instanteDe } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c2054';
const EST_B = 'c2054b';
const LOGIN = 'teste.c2054';
const FUSO = 'America/Sao_Paulo';
const DIA = '2030-03-12';
const AGORA = instanteDe(FUSO, '2030-03-11', '09:00');
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('itens agendáveis (porta própria, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let itens: ItensAgendaveisPropria;
  const ids = {
    est: 0,
    estB: 0,
    recursoB: 0,
    usuario: 0,
    fp: 0,
    pac1: 0,
    pac2: 0,
    agenda: 0,
    recurso: 0,
    equip: 0,
    situacao: 0,
    tipo: 0,
    canal: 0,
  };
  const item = { a: 0, b: 0, c: 0, d: 0, p: 0 };
  let seqMarc = 0;

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const est = [ids.est, ids.estB];
    await e.executar(
      'DELETE x FROM marcacao_equipamento x JOIN marcacao_horario m ON m.id = x.marcacao_horario_id WHERE m.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar(
      'DELETE x FROM marcacao_horario_item x JOIN marcacao_horario m ON m.id = x.marcacao_horario_id WHERE m.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar('DELETE FROM marcacao_horario WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar('DELETE FROM horario_agenda WHERE estabelecimento_id IN (?, ?)', est);
    for (const t of [
      'item_agendavel_composicao',
      'item_agendavel_conflito',
      'item_agendavel_pre_requisito',
      'item_agendavel_recurso',
      'item_agendavel_orientacao_fonte_pagadora',
    ])
      await e.executar(
        `DELETE x FROM ${t} x JOIN item_agendavel i ON i.id = x.item_agendavel_id WHERE i.codigo LIKE 'C2054-%'`,
      );
    await e.executar("DELETE FROM item_agendavel WHERE codigo LIKE 'C2054-%'");
  };
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2054' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = () => ({
    hospital: EST,
    login: LOGIN,
    correlacao: 'teste-c2054',
    chaveIdempotencia: `c2054-${randomUUID()}`,
  });
  const leitura = { hospital: EST, login: LOGIN };
  const leituraB = { hospital: EST_B, login: LOGIN };
  const salvar = async (x: Record<string, unknown>) => (await itens.salvar(ctx(), x)).resultado.item;
  /** Marcação viva do paciente na data e hora, gravada direto (a marcação em si é de outra função). */
  const marcacao = (paciente: number, data: string, hora: string, est = ids.est) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'marcacao-c2054' }, async (e) => {
      const inicio = instanteDe(FUSO, data, hora);
      const fim = new Date(inicio.getTime() + 30 * 60_000);
      const agora = new Date();
      const h = await e.inserir(
        `INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, situacao, vagas_ocupadas, criado_em)
         VALUES (?, ?, ?, ?, ?, 'ocupado', 1, ?)`,
        [est, ids.agenda, data, inicio, fim, agora],
      );
      return e.inserir(
        `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, tipo_marcacao_id, situacao_marcacao_id,
            canal_marcacao_id, fonte_pagadora_id, duracao_minutos, marcado_em, responsavel_usuario_id, paciente_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 30, ?, ?, ?, ?)`,
        [
          est,
          `C2054-${++seqMarc}`,
          h,
          ids.tipo,
          ids.situacao,
          ids.canal,
          ids.fp,
          agora,
          ids.usuario,
          paciente,
          agora,
        ],
      );
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2054' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      ids.estB = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST_B],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST_B, `Hospital sintético ${EST_B}`, `Hospital sintético ${EST_B} (fictício)`, agora],
      );
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [LOGIN, 'USUARIO SINTETICO C2054', agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pf = await pessoa('PROFISSIONAL SINTETICO C2054');
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      for (const [k, n, pr] of [
        ['pac1', 'PACIENTE SINTETICO C2054 UM', 92054001],
        ['pac2', 'PACIENTE SINTETICO C2054 DOIS', 92054002],
      ] as const) {
        const pp = await pessoa(n);
        ids[k] = await garantir(
          e,
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pp],
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pp, pr, agora],
        );
      }
      ids.fp = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        ['92054'],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        ['92054', 'CONVENIO SINTETICO 92054', agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        ['c2054-exame'],
        'INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['c2054-exame', 'Sintético c2054', agora],
      );
      ids.agenda = await garantir(
        e,
        'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, 'AGENDA SINTETICA C2054'],
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em)
         VALUES (?, ?, ?, ?, 30, ?)`,
        [ids.est, 'AGENDA SINTETICA C2054', cat, prof, agora],
      );
      const setor = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'C2054-ENDO'],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'ENDOSCOPIA SINTETICA', 'apoio_diagnostico', ?)",
        [ids.est, 'C2054-ENDO', agora],
      );
      const cc = await garantir(
        e,
        "SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = 'C2054-CC'",
        [ids.est],
        "INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, 'C2054-CC', 'SETOR FICTÍCIO', '2026-01-01', ?)",
        [ids.est, agora],
      );
      ids.equip = await garantir(
        e,
        "SELECT id FROM equipamento_saude WHERE estabelecimento_id = ? AND codigo = 'C2054-EQ'",
        [ids.est],
        "INSERT INTO equipamento_saude (estabelecimento_id, codigo, nome, tipo, criticidade, centro_custo_id, criado_em) VALUES (?, 'C2054-EQ', 'VIDEOENDOSCOPIO SINTETICO', 'medico', 'alta', ?, ?)",
        [ids.est, cc, agora],
      );
      ids.recurso = await garantir(
        e,
        "SELECT id FROM recurso_agendavel WHERE estabelecimento_id = ? AND codigo = 'C2054-R'",
        [ids.est],
        `INSERT INTO recurso_agendavel (estabelecimento_id, codigo, descricao, tipo, setor_funcional_id, equipamento_saude_id, capacidade, criado_em)
         VALUES (?, 'C2054-R', 'SALA DE ENDOSCOPIA SINTETICA', 'equipamento', ?, ?, 1, ?)`,
        [ids.est, setor, ids.equip, agora],
      );
      // A outra unidade tem a sua sala (sem equipamento de saúde ligado).
      const setorB = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.estB, 'C2054-ENDO-B'],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'ENDOSCOPIA SINTETICA B', 'apoio_diagnostico', ?)",
        [ids.estB, 'C2054-ENDO-B', agora],
      );
      ids.recursoB = await garantir(
        e,
        "SELECT id FROM recurso_agendavel WHERE estabelecimento_id = ? AND codigo = 'C2054-RB'",
        [ids.estB],
        `INSERT INTO recurso_agendavel (estabelecimento_id, codigo, descricao, tipo, setor_funcional_id, capacidade, criado_em)
         VALUES (?, 'C2054-RB', 'SALA DE ENDOSCOPIA SINTETICA B', 'sala', ?, 1, ?)`,
        [ids.estB, setorB, agora],
      );
      const dominio = async (tabela: string, codigo: string, extra: Record<string, unknown>) =>
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
      const s = await e.uma<{ id: number }>(
        "SELECT id FROM situacao_marcacao WHERE significado = 'aguardando' AND ativo ORDER BY id LIMIT 1",
      );
      ids.situacao = s
        ? Number(s.id)
        : await dominio('situacao_marcacao', 'c2054-aguardando', { significado: 'aguardando' });
      const t = await e.uma<{ id: number }>(
        "SELECT id FROM tipo_marcacao WHERE natureza = 'primeira_vez' AND ativo ORDER BY id LIMIT 1",
      );
      ids.tipo = t
        ? Number(t.id)
        : await dominio('tipo_marcacao', 'c2054-primeira', { natureza: 'primeira_vez' });
      const c = await e.uma<{ id: number }>('SELECT id FROM canal_marcacao ORDER BY id LIMIT 1');
      ids.canal = c
        ? Number(c.id)
        : await e.inserir(
            "INSERT INTO canal_marcacao (codigo, descricao, criado_em) VALUES ('telefone', 'TELEFONE', ?)",
            [agora],
          );
    });
    itens = new ItensAgendaveisPropria(nucleo, CLIENTE, () => AGORA);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2054' }, async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est, ids.estB] });
    });
    await nucleo.encerrar();
  });

  const base = (codigo: string, descricao: string, x: Record<string, unknown> = {}) => ({
    codigo,
    descricao,
    tipoItem: 'exame',
    duracaoMinutos: 30,
    ...x,
  });

  it('cadastra o item com as regras filhas, recusa o inválido e o ciclo, e retira regra sem apagar', async () => {
    item.a = await salvar(base('C2054-A', 'CONSULTA PRE SINTETICA', { tipoItem: 'consulta' }));
    item.c = await salvar(base('C2054-C', 'TOMOGRAFIA COM CONTRASTE SINTETICA'));
    item.d = await salvar(
      base('C2054-D', 'BIOPSIA SINTETICA', {
        recursos: [{ recurso: ids.recurso, papel: 'exigido', quantidade: 1 }],
      }),
    );
    const regrasB = {
      diasPreparo: 2,
      orientacaoPreparo: 'Dieta líquida sem resíduos.',
      requisitos: [
        { tipo: 'item_realizado', item: item.a, descricao: null, prazoMaximoDias: 30, bloqueia: true },
      ],
      conflitos: [{ item: item.c, intervaloMinimoHoras: 48, direcao: 'ambos' }],
      recursos: [{ recurso: ids.recurso, papel: 'realiza', quantidade: 1 }],
      orientacoes: [{ fontePagadora: ids.fp, orientacao: 'Levar a guia autorizada.' }],
    };
    item.b = await salvar(base('C2054-B', 'COLONOSCOPIA SINTETICA', regrasB));
    await expect(salvar(base('c2054-b', 'OUTRA'))).rejects.toMatchObject(recusada('codigo-repetido'));
    await expect(salvar(base('C2054-P', 'PACOTE', { tipoItem: 'composto' }))).rejects.toMatchObject(
      recusada('pacote-vazio'),
    );
    const [a0] = await ler<{ versao: number }>('SELECT versao FROM item_agendavel WHERE id = ?', [item.a]);
    await expect(
      salvar({
        ...base('C2054-A', 'CONSULTA PRE SINTETICA', { tipoItem: 'consulta' }),
        id: item.a,
        versao: a0!.versao,
        requisitos: [
          { tipo: 'item_marcado', item: item.b, descricao: null, prazoMaximoDias: null, bloqueia: true },
        ],
      }),
    ).rejects.toMatchObject(recusada('requisito-circular'));
    const contar = async () =>
      (
        await ler<Record<string, number>>(
          `SELECT (SELECT COUNT(*) FROM item_agendavel_pre_requisito WHERE item_agendavel_id = ? AND ativo) AS req,
                  (SELECT COUNT(*) FROM item_agendavel_conflito WHERE item_agendavel_id = ?) AS conf_total,
                  (SELECT COUNT(*) FROM item_agendavel_conflito WHERE item_agendavel_id = ? AND ativo) AS conf,
                  (SELECT COUNT(*) FROM item_agendavel_recurso WHERE item_agendavel_id = ? AND excluido_em IS NULL) AS rec,
                  (SELECT COUNT(*) FROM item_agendavel_orientacao_fonte_pagadora WHERE item_agendavel_id = ? AND excluido_em IS NULL) AS ori`,
          [item.b, item.b, item.b, item.b, item.b],
        )
      ).map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Number(v)])))[0];
    expect(await contar()).toEqual({ req: 1, conf_total: 1, conf: 1, rec: 1, ori: 1 });
    const [b1] = await ler<{ versao: number; criado_por: number; dias_preparo: number }>(
      'SELECT versao, criado_por, dias_preparo FROM item_agendavel WHERE id = ?',
      [item.b],
    );
    expect([Number(b1!.versao), Number(b1!.criado_por), Number(b1!.dias_preparo)]).toEqual([
      1,
      ids.usuario,
      2,
    ]);
    // Retira o conflito: a linha fica, com ativo = falso. Volta: a mesma linha é reativada.
    const lido = await itens.lerItem(leitura, item.b);
    await salvar({
      ...base('C2054-B', 'COLONOSCOPIA SINTETICA', { ...regrasB, conflitos: [] }),
      id: item.b,
      versao: lido.versao,
    });
    expect(await contar()).toEqual({ req: 1, conf_total: 1, conf: 0, rec: 1, ori: 1 });
    const lido2 = await itens.lerItem(leitura, item.b);
    expect(lido2.conflitos).toEqual([]);
    await salvar({ ...base('C2054-B', 'COLONOSCOPIA SINTETICA', regrasB), id: item.b, versao: lido2.versao });
    expect(await contar()).toEqual({ req: 1, conf_total: 1, conf: 1, rec: 1, ori: 1 });
    // Versão velha: conflito de versão, nada muda.
    await expect(
      salvar({ ...base('C2054-B', 'COLONOSCOPIA SINTETICA', regrasB), id: item.b, versao: lido.versao }),
    ).rejects.toMatchObject(recusada('conflito-versao'));
    const lista = await itens.listar(leitura, 'C2054');
    expect(lista.find((x) => x.id === item.b)?.regras).toEqual({
      composicao: 0,
      conflitos: 1,
      requisitos: 1,
      recursos: 1,
      orientacoes: 1,
    });
    item.p = await salvar(
      base('C2054-P', 'PACOTE SINTETICO', {
        tipoItem: 'composto',
        composicao: [
          { componente: item.a, quantidade: 1 },
          { componente: item.c, quantidade: 1 },
        ],
      }),
    );
  });

  it('na marcação: o pré-requisito bloqueia sem gravar; cumprido, lança com o preparo e reserva o equipamento', async () => {
    const m1 = await marcacao(ids.pac1, DIA, '08:00');
    const previa = await itens.criticar(leitura, m1, [item.b]);
    expect(previa.bloqueios.map((b) => b.codigo)).toEqual(['requisito-nao-realizado']);
    await expect(itens.lancar(ctx(), { marcacao: m1, itens: [item.b] })).rejects.toMatchObject(
      recusada('critica-da-marcacao'),
    );
    expect(
      await ler('SELECT id FROM marcacao_horario_item WHERE marcacao_horario_id = ?', [m1]),
    ).toHaveLength(0);
    // A consulta prévia feita há uma semana cumpre o pré-requisito.
    const m0 = await marcacao(ids.pac1, '2030-03-05', '08:00');
    await itens.lancar(ctx(), { marcacao: m0, itens: [item.a] });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'realizado-c2054' }, (e) =>
      e.executar("UPDATE marcacao_horario_item SET situacao = 'realizado' WHERE marcacao_horario_id = ?", [
        m0,
      ]),
    );
    const r = await itens.lancar(ctx(), { marcacao: m1, itens: [item.b] });
    expect([r.resultado.itens, r.resultado.equipamentos]).toEqual([1, 1]);
    expect(r.resultado.alertas).toContain('preparo deveria ter começado');
    const [mi] = await ler<{
      item_agendavel_id: number;
      orientacao_preparo: string;
      situacao: string;
      versao: number;
    }>(
      'SELECT item_agendavel_id, orientacao_preparo, situacao, versao FROM marcacao_horario_item WHERE marcacao_horario_id = ?',
      [m1],
    );
    expect(Number(mi!.item_agendavel_id)).toBe(item.b);
    expect(mi!.orientacao_preparo).toBe(
      'Começar o preparo 2 dia(s) antes: a partir de 10/03/2030.\nDieta líquida sem resíduos.\nOrientação do convênio: Levar a guia autorizada.',
    );
    const [me] = await ler<{ equipamento_saude_id: number; quantidade: string }>(
      'SELECT equipamento_saude_id, quantidade FROM marcacao_equipamento WHERE marcacao_horario_id = ?',
      [m1],
    );
    expect([Number(me!.equipamento_saude_id), Number(me!.quantidade)]).toEqual([ids.equip, 1]);
    const [mh] = await ler<{ item_agendavel_id: number; versao: number }>(
      'SELECT item_agendavel_id, versao FROM marcacao_horario WHERE id = ?',
      [m1],
    );
    expect([Number(mh!.item_agendavel_id), Number(mh!.versao)]).toEqual([item.b, 2]);
    const vista = await itens.itensDaMarcacao(leitura, m1);
    expect(vista.itens[0]!.preparo).toContain('Levar a guia autorizada.');
    expect(vista.equipamentos).toEqual([
      { equipamento: ids.equip, nome: 'VIDEOENDOSCOPIO SINTETICO', quantidade: 1 },
    ]);
    // O mesmo item de novo na mesma marcação: recusa.
    await expect(itens.lancar(ctx(), { marcacao: m1, itens: [item.b] })).rejects.toMatchObject(
      recusada('critica-da-marcacao'),
    );
  });

  it('equipamento ocupado no horário, conflito entre itens e pacote desdobrado', async () => {
    const m2 = await marcacao(ids.pac2, DIA, '08:10');
    const c2 = await itens.criticar(leitura, m2, [item.d]);
    expect(c2.bloqueios.map((b) => b.codigo)).toEqual(['equipamento-ocupado']);
    await expect(itens.lancar(ctx(), { marcacao: m2, itens: [item.d] })).rejects.toMatchObject(
      recusada('critica-da-marcacao'),
    );
    const m3 = await marcacao(ids.pac2, DIA, '10:00');
    expect((await itens.lancar(ctx(), { marcacao: m3, itens: [item.d] })).resultado.equipamentos).toBe(1);
    // Tomografia com contraste no dia seguinte da colonoscopia (regra de 48 h no cadastro da colonoscopia).
    const m4 = await marcacao(ids.pac1, '2030-03-13', '08:00');
    const c4 = await itens.criticar(leitura, m4, [item.c]);
    expect(c4.bloqueios.map((b) => b.codigo)).toEqual(['conflito-entre-itens']);
    // O pacote vira os itens que o compõem.
    const m5 = await marcacao(ids.pac2, '2030-03-20', '08:00');
    const r5 = await itens.lancar(ctx(), { marcacao: m5, itens: [item.p] });
    expect(r5.resultado.itens).toBe(2);
    const xs = await ler<{ item_agendavel_id: number }>(
      'SELECT item_agendavel_id FROM marcacao_horario_item WHERE marcacao_horario_id = ? ORDER BY sequencia',
      [m5],
    );
    expect(xs.map((x) => Number(x.item_agendavel_id))).toEqual([item.a, item.c]);
    const [mh] = await ler<{ item_agendavel_id: number }>(
      'SELECT item_agendavel_id FROM marcacao_horario WHERE id = ?',
      [m5],
    );
    expect(Number(mh!.item_agendavel_id)).toBe(item.p);
  });

  it('conflito com o item já lançado na mesma marcação, em dois pedidos, nos dois sentidos da regra', async () => {
    // C primeiro, depois B (a regra de 48 h está no cadastro de B).
    const m6 = await marcacao(ids.pac1, '2030-03-25', '08:00');
    await itens.lancar(ctx(), { marcacao: m6, itens: [item.c] });
    const c6 = await itens.criticar(leitura, m6, [item.b]);
    expect(c6.bloqueios.map((b) => b.codigo)).toEqual(['conflito-na-marcacao']);
    await expect(itens.lancar(ctx(), { marcacao: m6, itens: [item.b] })).rejects.toMatchObject(
      recusada('critica-da-marcacao'),
    );
    // B primeiro, depois C (a regra é lida pelo sentido inverso).
    const m7 = await marcacao(ids.pac1, '2030-03-28', '08:00');
    await itens.lancar(ctx(), { marcacao: m7, itens: [item.b] });
    const c7 = await itens.criticar(leitura, m7, [item.c]);
    expect(c7.bloqueios.map((b) => b.codigo)).toEqual(['conflito-na-marcacao']);
    await expect(itens.lancar(ctx(), { marcacao: m7, itens: [item.c] })).rejects.toMatchObject(
      recusada('critica-da-marcacao'),
    );
    const n = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM marcacao_horario_item WHERE marcacao_horario_id IN (?, ?)',
      [m6, m7],
    );
    expect(Number(n[0]!.n)).toBe(2);
  });

  it('pacote com quantidade maior que 1: lança a quantidade, soma o recurso e leva as regras e o preparo do pacote', async () => {
    const p2 = await salvar(
      base('C2054-P2', 'PACOTE DUAS SESSOES SINTETICO', {
        tipoItem: 'composto',
        diasPreparo: 1,
        orientacaoPreparo: 'Jejum de 8 horas.',
        composicao: [{ componente: item.c, quantidade: 2 }],
        requisitos: [
          {
            tipo: 'documento',
            item: null,
            descricao: 'Termo do pacote assinado',
            prazoMaximoDias: null,
            bloqueia: true,
          },
        ],
      }),
    );
    const m8 = await marcacao(ids.pac2, '2030-04-10', '08:00');
    const c8 = await itens.criticar(leitura, m8, [p2]);
    expect(c8.bloqueios).toEqual([]);
    expect(c8.alertas.map((a) => a.codigo)).toContain('requisito-documento');
    await itens.lancar(ctx(), { marcacao: m8, itens: [p2] });
    const [mi] = await ler<{ item_agendavel_id: number; quantidade: string; orientacao_preparo: string }>(
      'SELECT item_agendavel_id, quantidade, orientacao_preparo FROM marcacao_horario_item WHERE marcacao_horario_id = ?',
      [m8],
    );
    expect([Number(mi!.item_agendavel_id), Number(mi!.quantidade)]).toEqual([item.c, 2]);
    expect(mi!.orientacao_preparo).toBe(
      'Começar o preparo 1 dia(s) antes: a partir de 09/04/2030.\nJejum de 8 horas.',
    );
    // Duas sessões do item que usa a sala de capacidade 1: não cabem no mesmo horário.
    const p3 = await salvar(
      base('C2054-P3', 'PACOTE DUAS BIOPSIAS SINTETICO', {
        tipoItem: 'composto',
        composicao: [{ componente: item.d, quantidade: 2 }],
      }),
    );
    const m9 = await marcacao(ids.pac2, '2030-04-11', '08:00');
    expect((await itens.criticar(leitura, m9, [p3])).bloqueios.map((b) => b.codigo)).toEqual([
      'equipamento-ocupado',
    ]);
  });

  it('dois lançamentos ao mesmo tempo no mesmo recurso de capacidade 1: só um reserva', async () => {
    const ma = await marcacao(ids.pac1, '2030-04-15', '14:00');
    const mb = await marcacao(ids.pac2, '2030-04-15', '14:05'); // sobrepõe (30 min)
    const rs = await Promise.allSettled([
      itens.lancar(ctx(), { marcacao: ma, itens: [item.d] }),
      itens.lancar(ctx(), { marcacao: mb, itens: [item.d] }),
    ]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const falha = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(falha.reason).toMatchObject(recusada('critica-da-marcacao'));
    const eq = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM marcacao_equipamento WHERE marcacao_horario_id IN (?, ?) AND excluido_em IS NULL',
      [ma, mb],
    );
    expect(Number(eq[0]!.n)).toBe(1);
  });

  it('duas unidades: cada uma vê, sincroniza, critica e reserva só os seus recursos', async () => {
    // A unidade B não vê a sala da unidade A no item; grava a sua sem retirar a de A.
    const vistoB = await itens.lerItem(leituraB, item.d);
    expect(vistoB.recursos).toEqual([]);
    await itens.salvar(
      { ...ctx(), hospital: EST_B },
      {
        ...base('C2054-D', 'BIOPSIA SINTETICA'),
        id: item.d,
        versao: vistoB.versao,
        recursos: [{ recurso: ids.recursoB, papel: 'exigido', quantidade: 1 }],
      },
    );
    expect((await itens.lerItem(leitura, item.d)).recursos.map((r) => r.recurso)).toEqual([ids.recurso]);
    expect((await itens.lerItem(leituraB, item.d)).recursos.map((r) => r.recurso)).toEqual([ids.recursoB]);
    // No horário em que a sala de A está ocupada (m3, 10:00 a 10:30), a marcação de B usa a sala de B e não reserva o
    // equipamento de A.
    const mB = await marcacao(ids.pac1, DIA, '10:05', ids.estB);
    expect((await itens.criticar(leituraB, mB, [item.d])).bloqueios).toEqual([]);
    const r = await itens.lancar({ ...ctx(), hospital: EST_B }, { marcacao: mB, itens: [item.d] });
    expect(r.resultado.equipamentos).toBe(0);
    expect(await ler('SELECT id FROM marcacao_equipamento WHERE marcacao_horario_id = ?', [mB])).toHaveLength(
      0,
    );
  });
});
