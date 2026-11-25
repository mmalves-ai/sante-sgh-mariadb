// Contrato de efeito da escala de execução do diagnóstico (F3.5, 05-SADT linha 19) no MariaDB real (cliente f22_o2;
// massa SINTÉTICA). Prova o que fica no banco: a escala com o papel, os plantões (inclusive o que vira a noite) e os
// exames, com a trilha; a escala de laudo do mesmo profissional em outro setor no mesmo horário recusada pelo choque,
// sem gravar nada; a escala inválida recusada com todos os campos; o encerramento da vigência que não apaga (com a
// versão conferida); outro estabelecimento não vê a escala. A fila do setor lida do banco é a do DIA: sai na ordem da
// regra (o urgente, depois a prioridade legal vigente do paciente, registrada ou pela idade, depois a chegada), sem o
// pedido antigo que ficou para trás (contado à parte), sem o previsto nem o marcado para outro dia, com o marcado de
// hoje pela chegada registrada, cortada no servidor pela mesma ordem, e com quem está escalado na hora. As leituras
// seguem de pé com mais de mil exames nas escalas do estabelecimento; os combos grandes são busca por digitação.
// Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';
import { ServicoEscalaExecucao } from './escala-execucao-propria.js';

const problemaDe = (e: unknown) =>
  e instanceof ErroOperacao
    ? { codigo: String(e.problema['codigo'] ?? ''), campos: (e.problema['campos'] as string[]) ?? [] }
    : { codigo: String(e), campos: [] };

describe.skipIf(SEM_BANCO)('escala de execução do diagnóstico (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let escalas: ServicoEscalaExecucao;
  let m: MassaSadt | null = null;
  let grupo: number | null = null;
  let grupoIdade: number | null = null;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-l19esc' }, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'E19');
    escalas = new ServicoEscalaExecucao(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const est = m.base.est;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-l19esc' }, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        await x(
          'DELETE d FROM escala_execucao_dia d JOIN escala_execucao s ON s.id = d.escala_execucao_id WHERE s.estabelecimento_id = ?',
          [est],
        );
        await x(
          'DELETE x FROM escala_execucao_exame x JOIN escala_execucao s ON s.id = x.escala_execucao_id WHERE s.estabelecimento_id = ?',
          [est],
        );
        await x('DELETE FROM escala_execucao WHERE estabelecimento_id = ?', [est]);
      });
    }
    if (m) {
      const { marca } = m;
      const est = m.base.est;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-l19esc' }, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        for (const g of [grupo, grupoIdade].filter((v): v is number => v !== null)) {
          await x('DELETE FROM paciente_prioridade_legal WHERE grupo_prioridade_legal_id = ?', [g]);
          await x('DELETE FROM grupo_prioridade_legal WHERE id = ?', [g]);
        }
        // A marcação de teste solta o pedido antes de sair (o pedido sai na limpeza da massa).
        await x('UPDATE requisicao_exame SET marcacao_horario_id = NULL WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM marcacao_horario WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM horario_agenda WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM agenda_servico WHERE estabelecimento_id = ?', [est]);
        for (const t of ['tipo_marcacao', 'situacao_marcacao', 'canal_marcacao', 'categoria_agenda'])
          await x(`DELETE FROM ${t} WHERE codigo = ?`, [marca]);
        await x('DELETE FROM exame WHERE codigo LIKE ?', [`${marca}M%`]);
      });
    }
    await limparMassaSadt(nucleo, m);
    if (m) {
      const nome = `PACIENTE ${m.marca} FILA%`;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-l19esc' }, async (e) => {
        await e.executar(
          'DELETE p FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome LIKE ?',
          [nome],
        );
        await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [nome]);
      });
    }
    await nucleo.encerrar();
  }, 60_000);

  it('inclui com plantões e exames, recusa o choque e o inválido sem gravar, encerra sem apagar', async () => {
    const c = contexto(m!);
    const prof = m!.base.profissional;
    const escala = {
      setor: m!.setorImagem,
      profissional: prof,
      papel: 'executa',
      descricao: 'Imagem noturno E19',
      vigenciaInicio: '2026-11-01',
      plantoes: [
        { diaSemana: 2, inicio: '19:00', fim: '07:00', capacidade: 8 },
        { diaSemana: 4, inicio: '07:00', fim: '07:00', capacidade: 20 },
      ],
      exames: [{ exame: m!.exameImagem, limitePorTurno: 6 }],
    };
    // Inclusão: a escala, os dois plantões (o que vira a noite e o de 24 horas) e o exame.
    const { id } = await escalas.incluir(c, escala);
    expect(id).toBeGreaterThan(0);
    const cab = await um(
      'SELECT papel, profissional_id, vigencia_fim, versao, ativo FROM escala_execucao WHERE id = ?',
      [id],
    );
    expect(cab).toMatchObject({ papel: 'executa', vigencia_fim: null });
    expect(Number(cab?.['profissional_id'])).toBe(prof);
    expect(
      await contar(
        'SELECT COUNT(*) n FROM escala_execucao_dia WHERE escala_execucao_id = ? AND hora_fim <= hora_inicio',
        [id],
      ),
    ).toBe(2);
    expect(
      await contar(
        'SELECT COUNT(*) n FROM escala_execucao_exame WHERE escala_execucao_id = ? AND limite_por_turno = 6',
        [id],
      ),
    ).toBe(1);

    // A mesma pessoa laudando em outro setor das 02:00 às 04:00 da terça (dentro do noturno de segunda): choque, nada gravado.
    const choque = await escalas
      .incluir(c, {
        ...escala,
        setor: m!.setorLab,
        papel: 'lauda',
        descricao: 'Laudo madrugada E19',
        plantoes: [{ diaSemana: 3, inicio: '02:00', fim: '04:00', capacidade: 4 }],
        exames: [{ exame: m!.exameLab }],
      })
      .catch(problemaDe);
    expect(choque).toEqual({ codigo: 'escala-conflito', campos: ['plantoes.0'] });

    // Escala de laudo de sala e sem exame: todos os problemas de uma vez, nada gravado.
    const invalida = await escalas
      .incluir(c, { ...escala, profissional: null, recurso: null, papel: 'lauda', exames: [] })
      .catch(problemaDe);
    expect(invalida).toMatchObject({ codigo: 'escala-invalida' });
    expect((invalida as { campos: string[] }).campos).toEqual(
      expect.arrayContaining(['executante', 'profissional', 'exames']),
    );
    expect(
      await contar('SELECT COUNT(*) n FROM escala_execucao WHERE estabelecimento_id = ?', [m!.base.est]),
    ).toBe(1);

    // A leitura traz a escala com os plantões em HH:MM; outro estabelecimento não a vê.
    const lidas = await escalas.listar(c, m!.setorImagem);
    expect(lidas.map((e) => e.id)).toEqual([id]);
    expect(lidas[0]!.plantoes.map((p) => `${p.inicio}-${p.fim}`)).toEqual(['19:00-07:00', '07:00-07:00']);
    expect((await escalas.listar(contexto(m!, m!.base.outroEst))).map((e) => e.id)).not.toContain(id);

    // Encerrar: versão velha recusada; fim antes do início recusado; o encerramento grava o fim e a linha fica.
    const versao = Number(cab?.['versao']);
    expect(
      await escalas.encerrar(c, id, { vigenciaFim: '2026-12-31', versao: versao + 5 }).catch(problemaDe),
    ).toMatchObject({ codigo: 'versao-mudou' });
    expect(
      await escalas.encerrar(c, id, { vigenciaFim: '2026-10-01', versao }).catch(problemaDe),
    ).toMatchObject({ codigo: 'vigencia-invalida' });
    await escalas.encerrar(c, id, { vigenciaFim: '2026-12-31', versao });
    const depois = await um(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') fim, versao, excluido_em FROM escala_execucao WHERE id = ?",
      [id],
    );
    expect(depois).toMatchObject({ fim: '2026-12-31', excluido_em: null });
    expect(Number(depois?.['versao'])).toBe(versao + 1);
    expect(
      await contar('SELECT COUNT(*) n FROM escala_execucao_dia WHERE escala_execucao_id = ?', [id]),
    ).toBe(2);

    // A trilha: a inclusão e o encerramento da escala (as recusas não deixam rastro de gravação).
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'escala_execucao' AND entidade_id = ?",
        [id],
      ),
    ).toBe(2);
  }, 120_000);
  it('a fila do setor é a do dia, na ordem da regra: urgência, prioridade legal (registrada ou pela idade) e chegada', async () => {
    const c = contexto(m!);
    const est = m!.base.est;
    const marca = m!.marca;
    const ctxT = { cliente: CLIENTE, correlacao: 't-l19esc' };
    // Quarta-feira, 25/11/2026, 15:00 UTC: de manhã ao meio-dia em qualquer fuso do país.
    const quarta = new Date('2026-11-25T15:00:00Z');
    const quinta = new Date('2026-11-26T15:00:00Z');
    const ids = (f: { itens: { id: number }[] }) => f.itens.map((x) => x.id);
    // O pedido da massa passa a ser de quarta, 12:00 UTC (a fila é a do dia: a hora do pedido decide).
    await nucleo.escrever(ctxT, (e) =>
      e.executar('UPDATE requisicao_exame SET solicitado_em = ? WHERE id = ?', [
        new Date('2026-11-25T12:00:00Z'),
        m!.requisicao,
      ]),
    );
    // Sem escala no laboratório: os dois exames que esperam estão na fila (o liberado não), sem ninguém escalado.
    const semEscala = await escalas.fila(c, m!.setorLab, quarta);
    expect(ids(semEscala).sort()).toEqual([m!.itemLab, m!.itemLab2].sort());
    expect(semEscala).toMatchObject({ semExecutante: 2, total: 2, antigos: 0, data: '2026-11-25' });

    // O segundo exame vira urgente e o paciente ganha uma prioridade legal vigente; o plantão de quarta cobre o exame.
    await nucleo.escrever(ctxT, async (e) => {
      await e.executar('UPDATE exame_item SET urgente = TRUE WHERE id = ?', [m!.itemLab2]);
      grupo = await e.inserir(
        `INSERT INTO grupo_prioridade_legal (codigo, descricao, ativo, peso, criado_em)
         VALUES (?, 'Prioridade de teste E19', TRUE, 1, ?)`,
        [`${marca}-GP`, new Date()],
      );
      await e.executar(
        `INSERT INTO paciente_prioridade_legal (paciente_id, grupo_prioridade_legal_id, vigencia_inicio, criado_em)
         VALUES (?, ?, '2026-01-01', ?)`,
        [m!.base.paciente, grupo, new Date()],
      );
    });
    const { id: plantaoLab } = await escalas.incluir(c, {
      setor: m!.setorLab,
      profissional: m!.base.profissional2,
      papel: 'executa',
      descricao: 'Bancada quarta E19',
      vigenciaInicio: '2026-11-01',
      plantoes: [{ diaSemana: 4, inicio: '08:00', fim: '18:00', capacidade: 30 }],
      exames: [{ exame: m!.exameLab }],
    });
    const fila = await escalas.fila(c, m!.setorLab, quarta);
    // A ordem é a da regra: o urgente primeiro; a posição acompanha.
    expect(ids(fila)).toEqual([m!.itemLab2, m!.itemLab]);
    expect(fila.itens.map((x) => x.posicao)).toEqual([1, 2]);
    expect(fila.itens.map((x) => x.urgente)).toEqual([true, false]);
    expect(fila.itens.every((x) => x.grupoPrioridade === grupo && x.ordemPrioridade === 1)).toBe(true);
    // Quem executa agora: a escala de quarta, com o profissional dela e o nome; na quinta, ninguém.
    expect(fila.itens.map((x) => x.executantes.map((e) => e.escala))).toEqual([[plantaoLab], [plantaoLab]]);
    expect(fila.itens[0]!.executantes[0]!.profissional).toBe(m!.base.profissional2);
    expect(fila.itens[0]!.executantes[0]!.profissionalNome).toMatch(/\S/);
    expect(fila.semExecutante).toBe(0);
    expect((await escalas.fila(c, m!.setorLab, quinta)).semExecutante).toBe(2);

    // Mais gente no setor. Um paciente SEM prioridade com o pedido MAIS ANTIGO do dia (09:00 UTC); um paciente de 86
    // anos, sem nenhum registro, com o pedido mais novo (13:00 UTC) e um grupo de prioridade por idade (85 anos, o
    // de menor peso); um pedido de agosto que ficou sem execução; um pedido de hoje com a coleta prevista para
    // sábado; um exame pedido há 15 dias e marcado para HOJE, com a chegada registrada às 08:00 UTC; e um exame
    // marcado para sexta.
    const extra = await nucleo.escrever(ctxT, async (e) => {
      const agora = new Date();
      const origem = await e.uma(
        `SELECT r.fonte_pagadora_id AS fonte, pf.sexo_id AS sexo
           FROM requisicao_exame r JOIN paciente p ON p.id = r.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE r.id = ?`,
        [m!.requisicao],
      );
      const paciente = async (rotulo: string, nascimento: string) => {
        const pf = await e.inserir(
          'INSERT INTO pessoa_fisica (nome, sexo_id, data_nascimento, criado_em) VALUES (?, ?, ?, ?)',
          [`PACIENTE ${marca} FILA ${rotulo}`, origem!['sexo'], nascimento, agora],
        );
        const pront = Number(
          (await e.uma('SELECT COALESCE(MAX(numero_prontuario), 970000) + 1 AS n FROM paciente'))?.['n'],
        );
        return e.inserir(
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, tipo_sanguineo, fator_rh, criado_em) VALUES (?, ?, 'O', 'positivo', ?)",
          [pf, pront, agora],
        );
      };
      const semPrioridade = await paciente('SEM', '1990-03-10');
      const idoso = await paciente('IDOSO', '1940-01-15');
      let seq = 0;
      const pedido = async (
        pac: number,
        solicitado: string,
        situacao: string,
        previsto: string | null = null,
        marcacao: number | null = null,
      ) => {
        const r = await e.inserir(
          `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
             solicitante_profissional_id, fonte_pagadora_id, solicitado_em, coleta_prevista_em, marcacao_horario_id,
             criado_em, versao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            est,
            `${marca}-F${++seq}`,
            pac,
            m!.base.atendimento,
            m!.setorLab,
            m!.base.profissional,
            origem!['fonte'],
            new Date(solicitado),
            previsto === null ? null : new Date(previsto),
            marcacao,
            agora,
          ],
        );
        return e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, criado_em, versao)
           VALUES (?, 1, ?, ?, ?, 1)`,
          [r, m!.exameLab, situacao, agora],
        );
      };
      // A agenda mínima para o exame marcado: um horário hoje e um na sexta.
      const cadastro = (tabela: string, colunas = '', valores = '') =>
        e.inserir(
          `INSERT INTO ${tabela} (codigo, descricao, criado_em${colunas}) VALUES (?, 'Teste E19', ?${valores})`,
          [marca, agora],
        );
      const categoria = await cadastro('categoria_agenda');
      const tipo = await cadastro('tipo_marcacao', ', natureza', ", 'primeira_vez'");
      const situacaoMarcacao = await cadastro('situacao_marcacao', ', significado', ", 'chegou'");
      const canal = await cadastro('canal_marcacao');
      const agenda = await e.inserir(
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id,
           duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 20, ?)`,
        [est, `Agenda ${marca}`, categoria, m!.base.profissional, agora],
      );
      const marcado = async (pac: number, dia: string, chegada: string | null) => {
        const horario = await e.inserir(
          `INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [est, agenda, dia, new Date(`${dia}T16:00:00Z`), new Date(`${dia}T16:20:00Z`), agora],
        );
        return e.inserir(
          `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, tipo_marcacao_id,
             situacao_marcacao_id, canal_marcacao_id, fonte_pagadora_id, paciente_id, duracao_minutos, marcado_em,
             responsavel_usuario_id, chegada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 20, ?, ?, ?, ?)`,
          [
            est,
            `${marca}-M${dia.slice(8)}`,
            horario,
            tipo,
            situacaoMarcacao,
            canal,
            origem!['fonte'],
            pac,
            agora,
            m!.base.usuario,
            chegada === null ? null : new Date(chegada),
            agora,
          ],
        );
      };
      grupoIdade = await e.inserir(
        `INSERT INTO grupo_prioridade_legal (codigo, descricao, ativo, peso, idade_minima, criado_em)
         VALUES (?, 'Idade de teste E19', TRUE, 0, 85, ?)`,
        [`${marca}-GI`, agora],
      );
      return {
        semPrioridade,
        idoso,
        itemSem: await pedido(semPrioridade, '2026-11-25T09:00:00Z', 'solicitado'),
        itemIdoso: await pedido(idoso, '2026-11-25T13:00:00Z', 'solicitado'),
        itemAntigo: await pedido(semPrioridade, '2026-08-10T12:00:00Z', 'solicitado'),
        itemPrevisto: await pedido(
          semPrioridade,
          '2026-11-25T10:00:00Z',
          'autorizado',
          '2026-11-28T12:00:00Z',
        ),
        itemMarcadoHoje: await pedido(
          semPrioridade,
          '2026-11-10T12:00:00Z',
          'agendado',
          null,
          await marcado(semPrioridade, '2026-11-25', '2026-11-25T08:00:00Z'),
        ),
        itemMarcadoSexta: await pedido(
          semPrioridade,
          '2026-11-25T11:00:00Z',
          'agendado',
          null,
          await marcado(semPrioridade, '2026-11-27', null),
        ),
      };
    });

    // A fila do dia: o urgente; depois a prioridade por idade (peso 0, sem registro nenhum, só a data de nascimento);
    // depois a prioridade registrada (peso 1), que passa à frente de quem chegou antes sem prioridade; depois a
    // chegada: o marcado de hoje pela chegada registrada (08:00) e o pedido das 09:00.
    const cheia = await escalas.fila(c, m!.setorLab, quarta);
    expect(ids(cheia)).toEqual([
      m!.itemLab2,
      extra.itemIdoso,
      m!.itemLab,
      extra.itemMarcadoHoje,
      extra.itemSem,
    ]);
    expect(cheia.itens.map((x) => x.grupoPrioridade)).toEqual([grupo, grupoIdade, grupo, null, null]);
    expect(cheia.itens.map((x) => x.ordemPrioridade)).toEqual([1, 0, 1, null, null]);
    expect(cheia.itens[3]!.chegada).toBe('2026-11-25T08:00:00.000Z');
    // O pedido de agosto não entra (é contado como pendência antiga); o previsto e o marcado para outro dia também não.
    expect(ids(cheia)).not.toContain(extra.itemAntigo);
    expect(ids(cheia)).not.toContain(extra.itemPrevisto);
    expect(ids(cheia)).not.toContain(extra.itemMarcadoSexta);
    expect(cheia).toMatchObject({ total: 5, antigos: 1, semExecutante: 0 });
    // O corte da leitura no servidor segue a mesma ordem: os dois primeiros são o urgente e o idoso, não os dois que
    // chegaram antes; o total do dia continua informado.
    const cortada = await escalas.fila(c, m!.setorLab, quarta, 2);
    expect(ids(cortada)).toEqual([m!.itemLab2, extra.itemIdoso]);
    expect(cortada.total).toBe(5);
    // Na sexta, o marcado de sexta está na fila e o de quarta virou pendência; os pedidos de quarta já saíram.
    const sexta = await escalas.fila(c, m!.setorLab, new Date('2026-11-27T15:00:00Z'));
    expect(ids(sexta)).toEqual([extra.itemMarcadoSexta]);
    expect(sexta.itens[0]!.chegada).toBe('2026-11-27T16:00:00.000Z');
    expect(sexta.antigos).toBe(6);

    // A prioridade registrada que venceu ontem não vale mais: o paciente volta para trás de quem chegou antes.
    await nucleo.escrever(ctxT, (e) =>
      e.executar(
        "UPDATE paciente_prioridade_legal SET vigencia_fim = '2026-11-24' WHERE grupo_prioridade_legal_id = ?",
        [grupo],
      ),
    );
    const vencida = await escalas.fila(c, m!.setorLab, quarta);
    expect(ids(vencida)).toEqual([
      m!.itemLab2,
      extra.itemIdoso,
      extra.itemMarcadoHoje,
      extra.itemSem,
      m!.itemLab,
    ]);
    expect(vencida.itens.some((x) => x.grupoPrioridade === grupo)).toBe(false);
    // Desligado o grupo de idade do teste, ele deixa de valer para o paciente de 86 anos (o cadastro do cliente pode
    // ter outro grupo de idade, por isso a posição dele não é conferida aqui).
    await nucleo.escrever(ctxT, (e) =>
      e.executar('UPDATE grupo_prioridade_legal SET ativo = FALSE WHERE id = ?', [grupoIdade]),
    );
    const semIdade = await escalas.fila(c, m!.setorLab, quarta);
    expect(ids(semIdade)).toHaveLength(5);
    expect(semIdade.itens.some((x) => x.grupoPrioridade === grupoIdade)).toBe(false);
    // A fila é do estabelecimento: de outro, o setor não existe.
    expect(
      await escalas.fila(contexto(m!, m!.base.outroEst), m!.setorLab, quarta).catch(problemaDe),
    ).toMatchObject({
      codigo: 'setor-inexistente',
    });

    // Os combos pequenos saem do cadastro, com o dia civil de hoje; o exame e o profissional são busca por digitação.
    const op = await escalas.opcoes(c);
    expect(op.setores.map((x) => x.id)).toEqual(expect.arrayContaining([m!.setorLab, m!.setorImagem]));
    expect(op.gruposPrioridade.map((x) => x.id)).toContain(grupo);
    expect(op.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(op)).not.toContain('exames');
    expect((await escalas.buscar(c, 'exame', 'sintetico potassio')).map((x) => x.id)).toContain(m!.exameLab);
    expect((await escalas.buscar(c, 'exame', 'tomografia')).map((x) => x.id)).not.toContain(m!.exameLab);
    expect((await escalas.buscar(c, 'profissional', `conferente ${marca}`)).map((x) => x.id)).toEqual([
      m!.base.profissional2,
    ]);
    expect((await escalas.buscar(c, 'exame', '')).length).toBeLessThanOrEqual(30);
    expect(await escalas.buscar(c, 'exame', `${marca}%_`)).toEqual([]);
  }, 180_000);

  it('as leituras seguem de pé com mais de mil exames nas escalas do estabelecimento', async () => {
    const c = contexto(m!);
    const marca = m!.marca;
    const QUANTOS = 260;
    // 260 exames no catálogo e cinco bancadas do laboratório com todos eles: 1300 linhas de exame de escala.
    const exames = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-l19esc' }, async (e) => {
      const agora = new Date();
      await e.executar(
        `INSERT INTO exame (codigo, sigla, nome, tipo_servico, tipo_resultado, ativo, criado_em, versao)
         VALUES ${Array.from({ length: QUANTOS }, () => "(?, ?, ?, 'laboratorio', 'numerico', TRUE, ?, 1)").join(', ')}`,
        Array.from({ length: QUANTOS }, (_, i) => [
          `${marca}M${i}`,
          `${marca}M${i}`,
          `BANCADA ${marca} ${i}`,
          agora,
        ]).flat(),
      );
      return (await e.consultar('SELECT id FROM exame WHERE codigo LIKE ? ORDER BY id', [`${marca}M%`])).map(
        (r) => Number(r['id']),
      );
    });
    expect(exames).toHaveLength(QUANTOS);
    const bancadas: number[] = [];
    for (const dia of [1, 2, 3, 5, 6]) {
      const { id } = await escalas.incluir(c, {
        setor: m!.setorLab,
        profissional: m!.base.profissional2,
        papel: 'executa',
        descricao: `Bancada grande E19 dia ${dia}`,
        vigenciaInicio: '2026-11-01',
        plantoes: [{ diaSemana: dia, inicio: '08:00', fim: '12:00', capacidade: 40 }],
        exames: [{ exame: m!.exameLab }, ...exames.map((exame) => ({ exame }))],
      });
      bancadas.push(id);
    }
    expect(
      await contar(
        `SELECT COUNT(*) n FROM escala_execucao_exame x JOIN escala_execucao s ON s.id = x.escala_execucao_id
          WHERE s.estabelecimento_id = ?`,
        [m!.base.est],
      ),
    ).toBeGreaterThan(1300);
    // A grade do setor: as bancadas com a lista inteira de exames e o nome de quem executa; as escalas dos outros
    // setores vêm para o choque de horário, sem a lista de exames.
    const grade = await escalas.listar(c, m!.setorLab, { outros: true, desde: '2026-11-22' });
    const grandes = grade.filter((e) => bancadas.includes(e.id));
    expect(grandes.map((e) => e.exames.length)).toEqual([261, 261, 261, 261, 261]);
    expect(grandes.every((e) => (e.profissionalNome ?? '').length > 0)).toBe(true);
    const deOutroSetor = grade.filter((e) => e.setor !== m!.setorLab);
    expect(deOutroSetor.length).toBeGreaterThan(0);
    expect(deOutroSetor.every((e) => e.exames.length === 0 && e.plantoes.length > 0)).toBe(true);
    // A leitura de todas as escalas do estabelecimento também responde; a encerrada antes do recorte fica de fora.
    expect((await escalas.listar(c)).length).toBeGreaterThanOrEqual(6);
    expect((await escalas.listar(c, null, { desde: '2027-01-01' })).map((e) => e.setor)).not.toContain(
      m!.setorImagem,
    );
    // A fila lê das escalas só os exames que estão nela: segunda de manhã em qualquer fuso do país, a bancada grande de
    // segunda executa o exame pedido.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-l19esc' }, (e) =>
      e.executar('UPDATE requisicao_exame SET solicitado_em = ? WHERE id = ?', [
        new Date('2026-11-30T11:00:00Z'),
        m!.requisicao,
      ]),
    );
    const segunda = await escalas.fila(c, m!.setorLab, new Date('2026-11-30T14:00:00Z'));
    expect(segunda.itens.length).toBe(2);
    expect(segunda.itens.every((x) => x.executantes.some((e) => e.escala === bancadas[1]))).toBe(true);
    // A gravação seguinte do mesmo executante confere o choque só pelos plantões (terça das 10:00 às 11:00 choca).
    expect(
      await escalas
        .incluir(c, {
          setor: m!.setorImagem,
          profissional: m!.base.profissional2,
          papel: 'lauda',
          descricao: 'Laudo terça E19',
          vigenciaInicio: '2026-11-01',
          plantoes: [{ diaSemana: 3, inicio: '10:00', fim: '11:00', capacidade: 4 }],
          exames: [{ exame: m!.exameImagem }],
        })
        .catch(problemaDe),
    ).toEqual({ codigo: 'escala-conflito', campos: ['plantoes.0'] });
  }, 240_000);
});
