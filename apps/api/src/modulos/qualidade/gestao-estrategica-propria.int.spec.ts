// Contrato de efeito da gestão estratégica (C2-066, 01-ADM L118) no MariaDB:
// - mapa e objetivo gravam mapa_estrategico, objetivo_estrategico, os indicadores ligados (com peso) e a relação de
//   causa e efeito; o indicador que sai fica com exclusão lógica e volta reativado (mesma linha); pesos que não somam
//   100 são recusados sem gravar nada; o farol do objetivo sai da última apuração de cada indicador;
// - iniciativa grava objetivos e participantes; cada ação recalcula o progresso da iniciativa; o apontamento de horas
//   grava apontamento_hora_iniciativa e recusa passar de 24 h no dia; concluir com ação aberta é recusado e, com as ações
//   fechadas, grava término real e 100%; iniciativa concluída não recebe ação;
// - reunião de análise crítica grava número, participantes convocados e a pauta com as análises do período (fora do
//   período recusada); realizada exige presente; encerrada exige ata, marca as análises concluídas da pauta como
//   apresentadas e não recebe deliberação nova (a existente segue o andamento). Toda gravação deixa trilha.
// Massa sintética (prefixo L118E).
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { GestaoEstrategicaPropria } from './gestao-estrategica-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L118E';
// Segundo estabelecimento sintético, para provar o isolamento entre estabelecimentos.
const P2 = 'L118F';

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('gestão estratégica no banco próprio', () => {
  const nucleo = new NucleoProprio();
  let porta: GestaoEstrategicaPropria;
  const ids = {
    est: 0,
    est2: 0,
    a: 0,
    b: 0,
    grupo: 0,
    i1: 0,
    i2: 0,
    v1: 0,
    v2: 0,
    persp: 0,
    ap1: 0,
    ap2: 0,
    an1: 0,
    an2: 0,
  };
  const ctx = () => ({
    hospital: P,
    login: `${P}.A`,
    correlacao: 'teste-l118e',
    chaveIdempotencia: `tl118e-${randomUUID()}`,
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l118e' }, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['q'] ?? -1);

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l118e' }, async (e) => {
      for (const estId of [ids.est, ids.est2].filter(Boolean)) {
        const est = [estId];
        await e.executar(
          'DELETE d FROM reuniao_analise_critica_deliberacao d JOIN reuniao_analise_critica r ON r.id = d.reuniao_analise_critica_id WHERE r.estabelecimento_id = ?',
          est,
        );
        await e.executar(
          'DELETE p FROM reuniao_analise_critica_participante p JOIN reuniao_analise_critica r ON r.id = p.reuniao_analise_critica_id WHERE r.estabelecimento_id = ?',
          est,
        );
        await e.executar(
          'DELETE x FROM analise_critica_indicador x JOIN apuracao_indicador a ON a.id = x.apuracao_indicador_id WHERE a.estabelecimento_id = ?',
          est,
        );
        await e.executar('DELETE FROM reuniao_analise_critica WHERE estabelecimento_id = ?', est);
        await e.executar('DELETE FROM apuracao_indicador WHERE estabelecimento_id = ?', est);
        for (const t of [
          'apontamento_hora_iniciativa h JOIN iniciativa_estrategica_acao a ON a.id = h.iniciativa_estrategica_acao_id',
        ]) {
          await e.executar(
            `DELETE h FROM ${t} JOIN iniciativa_estrategica i ON i.id = a.iniciativa_estrategica_id WHERE i.estabelecimento_id = ?`,
            est,
          );
        }
        for (const t of [
          'iniciativa_estrategica_acao',
          'iniciativa_estrategica_objetivo',
          'iniciativa_estrategica_participante',
        ])
          await e.executar(
            `DELETE x FROM ${t} x JOIN iniciativa_estrategica i ON i.id = x.iniciativa_estrategica_id WHERE i.estabelecimento_id = ?`,
            est,
          );
        await e.executar('DELETE FROM iniciativa_estrategica WHERE estabelecimento_id = ?', est);
        await e.executar(
          'DELETE r FROM objetivo_estrategico_relacao r JOIN objetivo_estrategico o ON o.id = r.objetivo_efeito_id JOIN mapa_estrategico m ON m.id = o.mapa_estrategico_id WHERE m.estabelecimento_id = ?',
          est,
        );
        await e.executar(
          'DELETE x FROM objetivo_estrategico_indicador x JOIN objetivo_estrategico o ON o.id = x.objetivo_estrategico_id JOIN mapa_estrategico m ON m.id = o.mapa_estrategico_id WHERE m.estabelecimento_id = ?',
          est,
        );
        await e.executar(
          'DELETE o FROM objetivo_estrategico o JOIN mapa_estrategico m ON m.id = o.mapa_estrategico_id WHERE m.estabelecimento_id = ?',
          est,
        );
        await e.executar('DELETE FROM mapa_estrategico WHERE estabelecimento_id = ?', est);
      }
      await e.executar(
        'DELETE v FROM indicador_versao v JOIN indicador i ON i.id = v.indicador_id WHERE i.codigo LIKE ?',
        [`${P}%`],
      );
      await e.executar('DELETE FROM indicador WHERE codigo LIKE ?', [`${P}%`]);
      await e.executar('DELETE FROM grupo_indicador WHERE codigo = ?', [P]);
      await e.executar('DELETE FROM perspectiva_estrategica WHERE codigo = ?', [P]);
      await limparTrilhaDaMassa(e, { codigos: [P, P2] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l118e' }, async (e) => {
      const hoje = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, hoje],
      );
      ids.est2 = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P2],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P2, `ESTAB ${P2} SINTETICO`, `ESTAB ${P2} SINTETICO`, hoje],
      );
      for (const k of ['a', 'b'] as const)
        ids[k] = await g(
          'SELECT id FROM usuario WHERE login = ?',
          [`${P}.${k.toUpperCase()}`],
          "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'PESSOA SINTETICA', TRUE, 'pessoa', ?)",
          [`${P}.${k.toUpperCase()}`, hoje],
        );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l118e' }, async (e) => {
      const hoje = new Date();
      ids.grupo = await e.inserir(
        'INSERT INTO grupo_indicador (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [P, 'GRUPO SINTETICO', hoje],
      );
      for (const n of [1, 2] as const) {
        const i = await e.inserir(
          `INSERT INTO indicador (codigo, nome, grupo_indicador_id, unidade, polaridade, criado_em)
           VALUES (?, ?, ?, 'percentual', 'maior_melhor', ?)`,
          [`${P}-${n}`, `INDICADOR SINTETICO ${P} ${n}`, ids.grupo, hoje],
        );
        const v = await e.inserir(
          `INSERT INTO indicador_versao (indicador_id, numero_versao, operacao, ocorrido_em, formula, numerador_descricao,
             vigencia_inicio, criado_em) VALUES (?, 1, 'inclusao', ?, 'n/d', 'n', '2026-01-01', ?)`,
          [i, hoje, hoje],
        );
        ids[`i${n}`] = i;
        ids[`v${n}`] = v;
        ids[`ap${n}`] = await e.inserir(
          `INSERT INTO apuracao_indicador (estabelecimento_id, indicador_id, indicador_versao_id, competencia, periodo_inicio,
             periodo_fim, numerador, denominador, valor, situacao_meta, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 1, 10, 10, ?, 'previa', ?)`,
          [
            ids.est,
            i,
            v,
            n === 1 ? '2026-03-01' : '2026-06-01',
            n === 1 ? '2026-03-01' : '2026-06-01',
            n === 1 ? '2026-03-31' : '2026-06-30',
            n === 1 ? 'na_meta' : 'fora_da_meta',
            hoje,
          ],
        );
        ids[`an${n}`] = await e.inserir(
          `INSERT INTO analise_critica_indicador (apuracao_indicador_id, sequencia, responsavel_usuario_id, analisado_em,
             resultado_periodo, analise, situacao, criado_em) VALUES (?, 1, ?, ?, ?, 'ANALISE SINTETICA', 'concluida', ?)`,
          [ids[`ap${n}`], ids.a, hoje, n === 1 ? 'na_meta' : 'fora_da_meta', hoje],
        );
      }
    });
    porta = new GestaoEstrategicaPropria(nucleo, CLIENTE, () => '2026-04-15');
    ids.persp = (
      await porta.gravarPerspectivaEstrategica(ctx(), { codigo: P, descricao: 'PERSPECTIVA SINTETICA' })
    ).resultado as unknown as number;
    ids.persp = Number((await um('SELECT id FROM perspectiva_estrategica WHERE codigo = ?', [P]))?.['id']);
  }, 60_000);

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('mapa e objetivos com indicadores ligados, causa e efeito e farol pela última apuração', async () => {
    const mapa = (
      await porta.gravarMapaEstrategico(ctx(), {
        nome: `MAPA ${P}`,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: '2026-12-31',
        missao: 'MISSAO SINTETICA',
      })
    ).resultado as { id: number };
    expect(
      await codigo(
        porta.gravarMapaEstrategico(ctx(), {
          nome: 'X',
          vigenciaInicio: '2026-02-01',
          vigenciaFim: '2026-01-01',
        }),
      ),
    ).toBe('mapa-vigencia');

    const base = {
      mapa: mapa.id,
      perspectiva: ids.persp,
      titulo: 'OBJETIVO SINTETICO',
      responsavel: `${P}.B`,
    };
    const o1 = (
      await porta.gravarObjetivoEstrategico(ctx(), {
        ...base,
        codigo: 'O1',
        indicadores: [
          { indicador: ids.i1, peso: 60 },
          { indicador: ids.i2, peso: 40 },
        ],
      })
    ).resultado as { id: number };
    const o2 = (
      await porta.gravarObjetivoEstrategico(ctx(), {
        ...base,
        codigo: 'O2',
        indicadores: [],
        causas: [o1.id],
      })
    ).resultado as { id: number };
    expect(
      await contar(
        'SELECT COUNT(*) AS q FROM objetivo_estrategico_indicador WHERE objetivo_estrategico_id = ? AND excluido_em IS NULL',
        [o1.id],
      ),
    ).toBe(2);
    expect(
      await um(
        'SELECT objetivo_causa_id AS c FROM objetivo_estrategico_relacao WHERE objetivo_efeito_id = ?',
        [o2.id],
      ),
    ).toMatchObject({ c: o1.id });
    // Pesos que não somam 100: nada gravado.
    const antes = await contar(
      'SELECT COUNT(*) AS q FROM objetivo_estrategico WHERE mapa_estrategico_id = ?',
      [mapa.id],
    );
    expect(
      await codigo(
        porta.gravarObjetivoEstrategico(ctx(), {
          ...base,
          codigo: 'O3',
          indicadores: [
            { indicador: ids.i1, peso: 60 },
            { indicador: ids.i2, peso: 30 },
          ],
        }),
      ),
    ).toBe('objetivo-peso-soma');
    expect(
      await contar('SELECT COUNT(*) AS q FROM objetivo_estrategico WHERE mapa_estrategico_id = ?', [mapa.id]),
    ).toBe(antes);

    // Farol: indicador 1 na meta (60) e 2 fora (40) = amarelo, 60%.
    const lido = await porta.mapa({ hospital: P, login: `${P}.A` }, mapa.id);
    const ob1 = lido.objetivos.find((o) => o.id === o1.id);
    expect(ob1?.desempenho).toMatchObject({
      farol: 'amarelo',
      percentualNaMeta: 60,
      naMeta: 1,
      foraDaMeta: 1,
    });
    expect(lido.objetivos.find((o) => o.id === o2.id)?.causas).toEqual([o1.id]);

    // Tirar o indicador 2: exclusão lógica; recolocar: a mesma linha volta.
    const ligacao = Number(
      (
        await um(
          'SELECT id FROM objetivo_estrategico_indicador WHERE objetivo_estrategico_id = ? AND indicador_id = ?',
          [o1.id, ids.i2],
        )
      )?.['id'],
    );
    const v1 = Number(
      (await um('SELECT versao FROM objetivo_estrategico WHERE id = ?', [o1.id]))?.['versao'],
    );
    await porta.gravarObjetivoEstrategico(ctx(), {
      ...base,
      id: o1.id,
      versao: v1,
      codigo: 'O1',
      indicadores: [{ indicador: ids.i1 }],
    });
    expect(
      await um('SELECT excluido_em IS NOT NULL AS x FROM objetivo_estrategico_indicador WHERE id = ?', [
        ligacao,
      ]),
    ).toMatchObject({ x: 1 });
    const v2 = Number(
      (await um('SELECT versao FROM objetivo_estrategico WHERE id = ?', [o1.id]))?.['versao'],
    );
    await porta.gravarObjetivoEstrategico(ctx(), {
      ...base,
      id: o1.id,
      versao: v2,
      codigo: 'O1',
      indicadores: [{ indicador: ids.i1 }, { indicador: ids.i2 }],
    });
    expect(
      await um('SELECT excluido_em IS NULL AS x FROM objetivo_estrategico_indicador WHERE id = ?', [ligacao]),
    ).toMatchObject({ x: 1 });
    expect(
      await contar(
        'SELECT COUNT(*) AS q FROM objetivo_estrategico_indicador WHERE objetivo_estrategico_id = ?',
        [o1.id],
      ),
    ).toBe(2);
    expect(
      await contar(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade IN ('mapa_estrategico', 'objetivo_estrategico', 'perspectiva_estrategica')",
        [ids.est],
      ),
    ).toBeGreaterThanOrEqual(5);
  });

  it('iniciativa com ações, progresso, horas e conclusão', async () => {
    const obj = Number(
      (
        await um(
          "SELECT o.id FROM objetivo_estrategico o JOIN mapa_estrategico m ON m.id = o.mapa_estrategico_id WHERE m.estabelecimento_id = ? AND o.codigo = 'O1'",
          [ids.est],
        )
      )?.['id'],
    );
    const ini = (
      await porta.gravarIniciativaEstrategica(ctx(), {
        titulo: 'INICIATIVA SINTETICA',
        responsavel: `${P}.A`,
        inicioPrevisto: '2026-04-01',
        terminoPrevisto: '2026-06-30',
        objetivos: [obj],
        participantes: [{ usuario: `${P}.B`, papel: 'equipe' }],
      })
    ).resultado as { id: number };
    expect(
      await um('SELECT codigo, situacao FROM iniciativa_estrategica WHERE id = ?', [ini.id]),
    ).toMatchObject({
      codigo: 'INI-2026-0001',
      situacao: 'planejada',
    });
    expect(
      await contar(
        'SELECT COUNT(*) AS q FROM iniciativa_estrategica_participante WHERE iniciativa_estrategica_id = ?',
        [ini.id],
      ),
    ).toBe(1);
    expect(
      await contar(
        'SELECT COUNT(*) AS q FROM iniciativa_estrategica_objetivo WHERE iniciativa_estrategica_id = ?',
        [ini.id],
      ),
    ).toBe(1);

    const acao = (dados: Record<string, unknown>) =>
      porta.gravarAcaoIniciativa(ctx(), {
        iniciativa: ini.id,
        titulo: 'ACAO SINTETICA',
        responsavel: `${P}.B`,
        inicioPrevisto: '2026-04-01',
        terminoPrevisto: '2026-04-30',
        ...dados,
      });
    expect(await codigo(acao({ terminoPrevisto: '2026-07-31' }))).toBe('acao-fora-da-iniciativa');
    const a1 = (await acao({ duracaoPrevistaMinutos: 300, situacao: 'em_andamento', progresso: 50 }))
      .resultado as {
      id: number;
      progressoIniciativa: number;
    };
    const a2 = (await acao({ duracaoPrevistaMinutos: 100 })).resultado as {
      id: number;
      progressoIniciativa: number;
    };
    expect(a2.progressoIniciativa).toBe(37.5);
    expect(
      await um(
        'SELECT percentual_progresso AS p, inicio_real FROM iniciativa_estrategica_acao WHERE id = ?',
        [a1.id],
      ),
    ).toMatchObject({ p: '50.0000' });
    expect(
      Number(
        (await um('SELECT percentual_progresso AS p FROM iniciativa_estrategica WHERE id = ?', [ini.id]))?.[
          'p'
        ],
      ),
    ).toBe(37.5);

    // Horas: grava; passa de 24 h no dia, recusa sem gravar.
    await porta.apontarHoras(ctx(), { acao: a1.id, dataTrabalho: '2026-04-10', minutos: 600 });
    expect(
      await codigo(porta.apontarHoras(ctx(), { acao: a1.id, dataTrabalho: '2026-04-10', minutos: 900 })),
    ).toBe('apontamento-dia-excedido');
    expect(
      await codigo(porta.apontarHoras(ctx(), { acao: a1.id, dataTrabalho: '2026-04-20', minutos: 60 })),
    ).toBe('apontamento-futuro');
    expect(
      await um(
        'SELECT COUNT(*) AS q, SUM(duracao_minutos) AS m, MIN(usuario_id) AS u FROM apontamento_hora_iniciativa WHERE iniciativa_estrategica_acao_id = ?',
        [a1.id],
      ),
    ).toMatchObject({ q: 1, m: '600', u: ids.a });

    // Situação: iniciar; concluir com ação aberta recusa; com as ações fechadas grava término real e 100%.
    const ver = async () =>
      Number((await um('SELECT versao FROM iniciativa_estrategica WHERE id = ?', [ini.id]))?.['versao']);
    await porta.mudarSituacaoIniciativa(ctx(), { id: ini.id, versao: await ver(), situacao: 'em_andamento' });
    expect(
      await codigo(
        porta.mudarSituacaoIniciativa(ctx(), { id: ini.id, versao: await ver(), situacao: 'concluida' }),
      ),
    ).toBe('iniciativa-acoes-abertas');
    const va = async (id: number) =>
      Number((await um('SELECT versao FROM iniciativa_estrategica_acao WHERE id = ?', [id]))?.['versao']);
    await acao({ id: a1.id, versao: await va(a1.id), duracaoPrevistaMinutos: 300, situacao: 'concluida' });
    await acao({ id: a2.id, versao: await va(a2.id), duracaoPrevistaMinutos: 100, situacao: 'cancelada' });
    await porta.mudarSituacaoIniciativa(ctx(), {
      id: ini.id,
      versao: await ver(),
      situacao: 'concluida',
      resultados: 'RESULTADO SINTETICO',
    });
    expect(
      await um(
        'SELECT situacao, inicio_real, termino_real, percentual_progresso AS p FROM iniciativa_estrategica WHERE id = ?',
        [ini.id],
      ),
    ).toMatchObject({
      situacao: 'concluida',
      p: '100.0000',
    });
    expect(
      await um("SELECT DATE_FORMAT(termino_real, '%Y-%m-%d') AS t FROM iniciativa_estrategica WHERE id = ?", [
        ini.id,
      ]),
    ).toMatchObject({ t: '2026-04-15' });
    expect(await codigo(acao({}))).toBe('iniciativa-encerrada');
    const lida = await porta.iniciativa({ hospital: P, login: `${P}.A` }, ini.id);
    expect(lida.horas).toEqual({ total: 600, porPessoa: [{ pessoa: `${P}.A`, minutos: 600 }] });
  });

  it('reunião de análise crítica: participantes, pauta, presença, ata, deliberações', async () => {
    const r = (
      await porta.gravarReuniao(ctx(), {
        titulo: 'REUNIAO SINTETICA',
        competenciaInicio: '2026-01-01',
        competenciaFim: '2026-03-31',
        inicioPrevisto: '2026-04-10T09:00',
        responsavel: `${P}.A`,
        participantes: [
          { usuario: `${P}.A`, papel: 'coordenador' },
          { usuario: `${P}.B` },
          { convidado: 'CONVIDADO SINTETICO', papel: 'convidado' },
        ],
      })
    ).resultado as { id: number; numero: string };
    expect(r.numero).toBe('RAC-2026-0001');
    expect(
      await contar(
        "SELECT COUNT(*) AS q FROM reuniao_analise_critica_participante WHERE reuniao_analise_critica_id = ? AND presenca = 'convocado'",
        [r.id],
      ),
    ).toBe(3);

    // Pauta: a análise de março entra; a de junho está fora do período.
    expect(await codigo(porta.gravarPauta(ctx(), { reuniao: r.id, analises: [ids.an2] }))).toBe(
      'reuniao-analise-fora-do-periodo',
    );
    await porta.gravarPauta(ctx(), { reuniao: r.id, analises: [ids.an1] });
    expect(
      await um('SELECT reuniao_analise_critica_id AS r FROM analise_critica_indicador WHERE id = ?', [
        ids.an1,
      ]),
    ).toMatchObject({ r: r.id });
    expect(
      await um('SELECT reuniao_analise_critica_id AS r FROM analise_critica_indicador WHERE id = ?', [
        ids.an2,
      ]),
    ).toMatchObject({ r: null });

    const ver = async () =>
      Number((await um('SELECT versao FROM reuniao_analise_critica WHERE id = ?', [r.id]))?.['versao']);
    expect(
      await codigo(
        porta.mudarSituacaoReuniao(ctx(), { id: r.id, versao: await ver(), situacao: 'realizada' }),
      ),
    ).toBe('reuniao-sem-presente');
    const parts = (await porta.reuniao({ hospital: P, login: `${P}.A` }, r.id)).participantes;
    expect(
      await codigo(
        porta.registrarPresenca(ctx(), {
          reuniao: r.id,
          presencas: [{ participante: parts[1]!.id, presenca: 'ausencia_justificada' }],
        }),
      ),
    ).toBe('reuniao-justificativa-ausencia');
    await porta.registrarPresenca(ctx(), {
      reuniao: r.id,
      presencas: [
        { participante: parts[0]!.id, presenca: 'presente' },
        { participante: parts[1]!.id, presenca: 'ausencia_justificada', justificativa: 'MOTIVO SINTETICO' },
      ],
    });
    await porta.mudarSituacaoReuniao(ctx(), {
      id: r.id,
      versao: await ver(),
      situacao: 'realizada',
      realizadaEm: '2026-04-10T09:30',
    });
    expect(
      await codigo(porta.gravarDeliberacao(ctx(), { reuniao: r.id, descricao: 'X', prazo: '2026-04-01' })),
    ).toBe('deliberacao-prazo');
    const d = (
      await porta.gravarDeliberacao(ctx(), {
        reuniao: r.id,
        descricao: 'DELIBERACAO SINTETICA',
        indicador: ids.i1,
        responsavel: `${P}.B`,
        prazo: '2026-05-10',
      })
    ).resultado as { id: number };
    // Encerrar: sem ata e com convocado sem presença, recusa.
    expect(
      await codigo(
        porta.mudarSituacaoReuniao(ctx(), { id: r.id, versao: await ver(), situacao: 'encerrada' }),
      ),
    ).toBe('reuniao-sem-ata');
    await porta.registrarPresenca(ctx(), {
      reuniao: r.id,
      presencas: [{ participante: parts[2]!.id, presenca: 'ausente' }],
    });
    await porta.mudarSituacaoReuniao(ctx(), {
      id: r.id,
      versao: await ver(),
      situacao: 'encerrada',
      ata: 'ATA SINTETICA',
    });
    expect(
      await um(
        'SELECT situacao, ata, fechamento_em IS NOT NULL AS f, realizada_em IS NOT NULL AS rr FROM reuniao_analise_critica WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({
      situacao: 'encerrada',
      ata: 'ATA SINTETICA',
      f: 1,
      rr: 1,
    });
    expect(await um('SELECT situacao FROM analise_critica_indicador WHERE id = ?', [ids.an1])).toMatchObject({
      situacao: 'apresentada',
    });
    expect(await um('SELECT situacao FROM analise_critica_indicador WHERE id = ?', [ids.an2])).toMatchObject({
      situacao: 'concluida',
    });
    // Encerrada: nova deliberação recusa; a existente segue o andamento.
    expect(await codigo(porta.gravarDeliberacao(ctx(), { reuniao: r.id, descricao: 'NOVA' }))).toBe(
      'reuniao-encerrada',
    );
    const vd = Number(
      (await um('SELECT versao FROM reuniao_analise_critica_deliberacao WHERE id = ?', [d.id]))?.['versao'],
    );
    await porta.gravarDeliberacao(ctx(), {
      id: d.id,
      versao: vd,
      reuniao: r.id,
      descricao: 'IGNORADA',
      situacao: 'concluida',
    });
    expect(
      await um(
        'SELECT situacao, descricao, concluida_em IS NOT NULL AS c FROM reuniao_analise_critica_deliberacao WHERE id = ?',
        [d.id],
      ),
    ).toMatchObject({
      situacao: 'concluida',
      descricao: 'DELIBERACAO SINTETICA',
      c: 1,
    });
    expect(
      await codigo(
        porta.registrarPresenca(ctx(), {
          reuniao: r.id,
          presencas: [{ participante: parts[2]!.id, presenca: 'presente' }],
        }),
      ),
    ).toBe('reuniao-encerrada');
  });

  it('isolamento: referências e leituras de outro estabelecimento são recusadas', async () => {
    // Massa do estabelecimento B (P2), gravada pela própria porta com a sessão dele.
    const ctxB = () => ({ ...ctx(), hospital: P2 });
    const mapaB = (
      await porta.gravarMapaEstrategico(ctxB(), {
        nome: `MAPA ${P2}`,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: '2026-12-31',
      })
    ).resultado as { id: number };
    const objB = (
      await porta.gravarObjetivoEstrategico(ctxB(), {
        mapa: mapaB.id,
        perspectiva: ids.persp,
        codigo: 'OB',
        titulo: 'OBJETIVO SINTETICO B',
        indicadores: [],
      })
    ).resultado as { id: number };
    const iniB = (
      await porta.gravarIniciativaEstrategica(ctxB(), {
        titulo: 'INICIATIVA SINTETICA B',
        responsavel: `${P}.A`,
        inicioPrevisto: '2026-04-01',
        terminoPrevisto: '2026-06-30',
        objetivos: [objB.id],
      })
    ).resultado as { id: number };
    const reuB = (
      await porta.gravarReuniao(ctxB(), {
        titulo: 'REUNIAO SINTETICA B',
        competenciaInicio: '2026-01-01',
        competenciaFim: '2026-03-31',
        inicioPrevisto: '2026-04-10T09:00',
        responsavel: `${P}.A`,
        participantes: [{ usuario: `${P}.A` }],
      })
    ).resultado as { id: number };

    // Sessão do estabelecimento A: ligar a iniciativa a objetivo ou mapa de B é recusado, sem gravar nada.
    const iniA = {
      titulo: 'INICIATIVA ISOLAMENTO',
      responsavel: `${P}.A`,
      inicioPrevisto: '2026-04-01',
      terminoPrevisto: '2026-06-30',
    };
    const antes = await contar(
      'SELECT COUNT(*) AS q FROM iniciativa_estrategica WHERE estabelecimento_id = ?',
      [ids.est],
    );
    expect(await codigo(porta.gravarIniciativaEstrategica(ctx(), { ...iniA, objetivos: [objB.id] }))).toBe(
      'objetivo-inexistente',
    );
    expect(await codigo(porta.gravarIniciativaEstrategica(ctx(), { ...iniA, mapa: mapaB.id }))).toBe(
      'mapa-inexistente',
    );
    expect(
      await contar('SELECT COUNT(*) AS q FROM iniciativa_estrategica WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toBe(antes);

    // Reunião de A com o mapa de B: recusada.
    const reuA = {
      titulo: 'REUNIAO ISOLAMENTO',
      competenciaInicio: '2026-01-01',
      competenciaFim: '2026-03-31',
      inicioPrevisto: '2026-04-20T09:00',
      responsavel: `${P}.A`,
      participantes: [{ usuario: `${P}.A` }],
    };
    expect(await codigo(porta.gravarReuniao(ctx(), { ...reuA, mapa: mapaB.id }))).toBe('mapa-inexistente');

    // Deliberação numa reunião de A apontando para objetivo ou iniciativa de B: recusada, sem gravar nada.
    const r = (await porta.gravarReuniao(ctx(), reuA)).resultado as { id: number };
    expect(
      await codigo(porta.gravarDeliberacao(ctx(), { reuniao: r.id, descricao: 'X', objetivo: objB.id })),
    ).toBe('objetivo-inexistente');
    expect(
      await codigo(porta.gravarDeliberacao(ctx(), { reuniao: r.id, descricao: 'X', iniciativa: iniB.id })),
    ).toBe('iniciativa-inexistente');
    expect(
      await contar(
        'SELECT COUNT(*) AS q FROM reuniao_analise_critica_deliberacao WHERE reuniao_analise_critica_id = ?',
        [r.id],
      ),
    ).toBe(0);
    // A deliberação também não alcança a reunião de B.
    expect(await codigo(porta.gravarDeliberacao(ctx(), { reuniao: reuB.id, descricao: 'X' }))).toBe(
      'nao-encontrado',
    );

    // Leituras de A sobre o mapa, a iniciativa e a reunião de B: não encontrado.
    const leA = { hospital: P, login: `${P}.A` };
    expect(await codigo(porta.mapa(leA, mapaB.id))).toBe('nao-encontrado');
    expect(await codigo(porta.iniciativa(leA, iniB.id))).toBe('nao-encontrado');
    expect(await codigo(porta.reuniao(leA, reuB.id))).toBe('nao-encontrado');
  });
});
