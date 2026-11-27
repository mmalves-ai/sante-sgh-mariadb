// Contrato de efeito de qualidade.revisarProntuario (F3.9-Q4) contra o MariaDB do cliente de teste do lote
// (SGH_CLIENTE_TESTE). Só dados sintéticos, nos estabelecimentos da massa 'RP': uma comissão com o checklist de três
// itens, um sorteio ativo com dois prontuários (um com médico responsável e outro sem) e um sorteio cancelado.
// Prova, pelo gravador real da porta própria completa da gestão (PortaGestaoPropriaCompleta.gravarSgh, com as versões
// anteriores e as tabelas dela; o tipo de pendência vem da migração 18_QUA/93_pendencia_revisao_comissao, não do
// preparo): a primeira revisão grava os itens, o resultado, o percentual e
// a pendência ao médico (tipo da semente, prazo, quem apontou); a correção exige a justificativa, altera os itens sem
// apagar, cancela a pendência do item que ficou conforme, cria a do novo não conforme e põe a versão anterior (com os
// itens e as pendências) na trilha; a pendência cancelada reabre quando o item volta a não conforme; e as recusas sem
// gravar (versão, sorteio cancelado, resposta incompleta, item fora do checklist, sem médico responsável, revisão de
// outro estabelecimento). Num segundo checklist com itens sem código (casados por `item<sequência>`, como a tela), com
// peso e item que não aceita "não se aplica": o percentual ponderado, a recusa do "não se aplica" e a pendência
// resolvida pelo médico que reabre quando a correção mantém o item não conforme.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaGestaoPropriaCompleta } from './gestao-porta-propria-completa.js';
import type { GravadorGestao } from './porta-gestao.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import { LeiturasGestaoComplementoD } from './porta-propria-complemento-d.js';
import { LeiturasRevisaoComplementoQ3 } from './porta-propria-complemento-q3.js';
import { TIPO_PENDENCIA_REVISAO } from './porta-propria-revisar-prontuario.js';
import type { RevisaoNova } from './tipos.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'revisao_prontuario',
  entidadeId: null,
  correlacao: 'teste-qualidade-revisar-prontuario',
};
const NUM = randomInt(100_000_000, 999_999_999);

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ErroOperacao) return `${e.problema.status}:${e.problema.codigo}`;
    throw e;
  }
}

type Resultado = 'conforme' | 'naoConforme' | 'naoAplicavel';

describe.skipIf(SEM_BANCO_QUA)(`revisão do prontuário no banco próprio (${CLIENTE_QUA})`, () => {
  let m: MassaQualidade;
  let c: ReturnType<typeof ctxBanco>;
  let ids: Record<string, number> = {};
  let porta: PortaGestaoPropriaCompleta;

  const gravar = <R>(fn: (g: GravadorGestao) => Promise<R>) => porta.gravarSgh(c, T, fn);
  const linhas = (sql: string, p: unknown[]) =>
    m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conferencia-revisar' }, (e) =>
      e.consultarParaAtualizar<Record<string, unknown>>(sql, p, { teto: 100 }),
    );

  const revisao = (
    id: number,
    versao: number,
    resp: Record<string, Resultado>,
    o: { justificativa?: string | null; registro?: number | null; situacao?: RevisaoNova['situacao'] } = {},
  ) => {
    const respostas = Object.entries(resp).map(([item, resultado]) => ({
      item,
      resultado,
      observacao: resultado === 'naoConforme' ? `Obs ${item}` : null,
    }));
    const nc = respostas.filter((x) => x.resultado === 'naoConforme');
    const r: RevisaoNova = {
      id,
      versao,
      situacao: o.situacao ?? (nc.length ? 'naoConforme' : 'conforme'),
      respostas: JSON.stringify(respostas),
      observacao: 'Revisão sintética',
      justificativa: o.justificativa ?? null,
      pendencias: nc.map((x) => ({
        item: x.item,
        descricao: `Item não conforme: ${x.item}.`,
        prazo: '2026-12-10',
      })),
      profissional: {
        registro: o.registro === undefined ? ids['prof']! : o.registro,
        login: null,
        nome: null,
      },
      agora: '2026-11-20T10:00:00',
      usuario: m.login,
    };
    return gravar((g) => g.revisarProntuario(r));
  };

  beforeAll(async () => {
    m = await prepararMassaQualidade('RP');
    porta = new PortaGestaoPropriaCompleta(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-revisar-prontuario' }, async (e) => {
      const hoje = new Date('2026-11-01T10:00:00');
      const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
        (await e.uma<{ id: number }>(sel, p))?.id ?? e.inserir(ins, pi);
      const tipoComissao = await garantir(
        'SELECT id FROM tipo_comissao WHERE codigo = ?',
        ['sintrp_rev'],
        "INSERT INTO tipo_comissao (codigo, descricao, criado_em) VALUES ('sintrp_rev', 'Revisão sintética', ?)",
        [hoje],
      );
      const comissao = await e.inserir(
        'INSERT INTO comissao_hospitalar (estabelecimento_id, tipo_comissao_id, nome, criado_em) VALUES (?, ?, ?, ?)',
        [m.est, tipoComissao, `COMISSAO SINTETICA RP ${NUM}`, hoje],
      );
      const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        'PESSOA SINTETICA RP',
        hoje,
      ]);
      const prof = await e.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, hoje],
      );
      const paciente = await e.inserir(
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pf, NUM, hoje],
      );
      const categoria = await garantir(
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        ['sintrp_int'],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES ('sintrp_int', 'Categoria sintética', 'internacao', ?)",
        [hoje],
      );
      const carater = await garantir(
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['srp'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('srp', 'Caráter sintético', 'teste', ?)",
        [hoje],
      );
      const fonte = await garantir(
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        ['SINTRP'],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES ('SINTRP', 'Fonte sintética RP', 'particular', ?)",
        [hoje],
      );
      const atendimento = (k: string) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
          [m.est, `${NUM}${k}`, paciente, categoria, carater, fonte, prof, hoje, hoje],
        );
      const at1 = await atendimento('1');
      const at2 = await atendimento('2');
      const at3 = await atendimento('3');
      const modelo = await e.inserir(
        `INSERT INTO modelo_checklist_qualidade (codigo, nome, finalidade, comissao_hospitalar_id, situacao, criado_em)
         VALUES (?, 'Checklist sintético RP', 'revisao_prontuario', ?, 'publicado', ?)`,
        [`SRP${NUM}`, comissao, hoje],
      );
      const checklist = await e.inserir(
        `INSERT INTO modelo_checklist_qualidade_versao (modelo_checklist_qualidade_id, operacao, ocorrido_em, numero_versao,
         situacao, vigencia_inicio, motivo_publicacao, publicado_em, publicador_usuario_id, criado_em)
         VALUES (?, 'inclusao', ?, 1, 'vigente', '2026-01-01', 'Publicação sintética', ?, ?, ?)`,
        [modelo, hoje, hoje, m.usuario, hoje],
      );
      for (const [seq, cod] of [
        [1, 'assinatura'],
        [2, 'evolucao'],
        [3, 'sumario'],
      ] as const)
        await e.inserir(
          `INSERT INTO modelo_checklist_qualidade_item (modelo_checklist_qualidade_versao_id, sequencia, codigo, enunciado, criado_em)
           VALUES (?, ?, ?, ?, ?)`,
          [checklist, seq, cod, `Item sintético ${cod}`, hoje],
        );
      // Segundo checklist: itens sem código (a tela os mostra como item1 e item2), o primeiro com peso 3 e sem aceitar
      // "não se aplica"; o segundo com o peso padrão. Fica sem comissão dona (como os já carregados sem dono): a chave
      // única uq_modelo_checklist_qualidade_comissao_finalidade admite um só checklist por comissão e finalidade.
      const modelo2 = await e.inserir(
        `INSERT INTO modelo_checklist_qualidade (codigo, nome, finalidade, comissao_hospitalar_id, situacao, criado_em)
         VALUES (?, 'Checklist sintético RP sem código', 'revisao_prontuario', NULL, 'publicado', ?)`,
        [`SRQ${NUM}`, hoje],
      );
      const checklist2 = await e.inserir(
        `INSERT INTO modelo_checklist_qualidade_versao (modelo_checklist_qualidade_id, operacao, ocorrido_em, numero_versao,
         situacao, vigencia_inicio, motivo_publicacao, publicado_em, publicador_usuario_id, criado_em)
         VALUES (?, 'inclusao', ?, 1, 'vigente', '2026-01-01', 'Publicação sintética', ?, ?, ?)`,
        [modelo2, hoje, hoje, m.usuario, hoje],
      );
      await e.inserir(
        `INSERT INTO modelo_checklist_qualidade_item (modelo_checklist_qualidade_versao_id, sequencia, codigo, enunciado,
         peso, aceita_nao_aplicavel, criado_em) VALUES (?, 1, NULL, 'Item sintético crítico', 3, FALSE, ?)`,
        [checklist2, hoje],
      );
      await e.inserir(
        `INSERT INTO modelo_checklist_qualidade_item (modelo_checklist_qualidade_versao_id, sequencia, codigo, enunciado,
         criado_em) VALUES (?, 2, NULL, 'Item sintético simples', ?)`,
        [checklist2, hoje],
      );
      const sorteio = (competencia: string, cancelado: boolean) =>
        e.inserir(
          `INSERT INTO sorteio_revisao_prontuario (estabelecimento_id, comissao_hospitalar_id, competencia,
           universo_quantidade, quantidade, semente, hash_universo, sorteado_em, sorteado_por_usuario_id, situacao,
           justificativa, criado_em)
           VALUES (?, ?, ?, 10, 2, 'semente', ?, ?, ?, ?, ?, ?)`,
          [
            m.est,
            comissao,
            competencia,
            'c'.repeat(64),
            hoje,
            m.usuario,
            cancelado ? 'cancelado' : 'sorteado',
            cancelado ? 'Cancelamento sintético' : null,
            hoje,
          ],
        );
      const ativo = await sorteio('2026-10-01', false);
      const cancelado = await sorteio('2026-09-01', true);
      // Sorteio próprio da revisão do outro estabelecimento: a chave única uq_revisao_prontuario_sorteio_atendimento
      // admite um atendimento uma vez por sorteio (o at2 já está no sorteio ativo).
      const ativoOutro = await sorteio('2026-08-01', false);
      const rev = (s: number, at: number, ck = checklist, est = m.est) =>
        e.inserir(
          `INSERT INTO revisao_prontuario (estabelecimento_id, comissao_hospitalar_id, sorteio_revisao_prontuario_id,
           paciente_id, atendimento_id, modelo_checklist_qualidade_versao_id, revisor_usuario_id, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'em_andamento', ?)`,
          [est, comissao, s, paciente, at, ck, m.usuario, hoje],
        );
      ids = {
        comissao,
        pf,
        prof,
        paciente,
        at1,
        at2,
        at3,
        modelo,
        checklist,
        modelo2,
        checklist2,
        ativo,
        p1: await rev(ativo, at1),
        p2: await rev(ativo, at2),
        pCancelado: await rev(cancelado, at1),
        p3: await rev(ativo, at3, checklist2),
        pOutro: await rev(ativoOutro, at2, checklist, m.outro),
      };
    });
  });

  afterAll(async () => {
    if (m && ids['comissao'])
      await m.nucleo
        .escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-revisar-prontuario' }, async (e) => {
          const run = (sql: string, p: unknown[]) => e.executar(sql, p).catch(() => undefined);
          await run(
            'DELETE ri FROM revisao_prontuario_item ri JOIN revisao_prontuario r ON r.id = ri.revisao_prontuario_id WHERE r.comissao_hospitalar_id = ?',
            [ids['comissao']],
          );
          await run('DELETE FROM pendencia_prontuario WHERE atendimento_id IN (?, ?, ?)', [
            ids['at1'],
            ids['at2'],
            ids['at3'],
          ]);
          await run('DELETE FROM revisao_prontuario WHERE comissao_hospitalar_id = ?', [ids['comissao']]);
          await run('DELETE FROM sorteio_revisao_prontuario WHERE comissao_hospitalar_id = ?', [
            ids['comissao'],
          ]);
          for (const [ck, mo] of [
            [ids['checklist'], ids['modelo']],
            [ids['checklist2'], ids['modelo2']],
          ]) {
            await run(
              'DELETE FROM modelo_checklist_qualidade_item WHERE modelo_checklist_qualidade_versao_id = ?',
              [ck],
            );
            await run('DELETE FROM modelo_checklist_qualidade_versao WHERE id = ?', [ck]);
            await run('DELETE FROM modelo_checklist_qualidade WHERE id = ?', [mo]);
          }
          await run('DELETE FROM atendimento WHERE id IN (?, ?, ?)', [ids['at1'], ids['at2'], ids['at3']]);
          await run('DELETE FROM paciente WHERE id = ?', [ids['paciente']]);
          await run('DELETE FROM comissao_hospitalar WHERE id = ?', [ids['comissao']]);
          await run('DELETE FROM profissional WHERE id = ?', [ids['prof']]);
          await run('DELETE FROM pessoa_fisica WHERE id = ?', [ids['pf']]);
        })
        .catch(() => undefined);
    await encerrarMassaQualidade(m);
  });

  const itens = (rev: number) =>
    linhas(
      `SELECT mi.codigo AS item, ri.sequencia, ri.resultado, ri.observacao, ri.responsavel_profissional_id AS resp,
              ri.pendencia_prontuario_id AS pend, ri.versao
         FROM revisao_prontuario_item ri JOIN modelo_checklist_qualidade_item mi ON mi.id = ri.modelo_checklist_qualidade_item_id
        WHERE ri.revisao_prontuario_id = ? ORDER BY ri.sequencia`,
      [rev],
    );
  const pendencias = (at: number) =>
    linhas(
      `SELECT p.id, p.situacao, p.descricao, p.responsavel_profissional_id AS resp, p.apontada_por_usuario_id AS por,
              DATE_FORMAT(p.prazo_em, '%Y-%m-%d %H:%i:%s') AS prazo, p.resolucao, p.versao, t.codigo AS tipo
         FROM pendencia_prontuario p JOIN tipo_pendencia_prontuario t ON t.id = p.tipo_pendencia_prontuario_id
        WHERE p.atendimento_id = ? ORDER BY p.id`,
      [at],
    );
  const cabeca = async (rev: number) =>
    (
      await linhas(
        `SELECT situacao, resultado, CAST(percentual_conformidade AS CHAR) AS percentual, pendencias_geradas AS geradas,
                observacao, justificativa, revisor_usuario_id AS revisor,
                DATE_FORMAT(revisada_em, '%Y-%m-%d %H:%i:%s') AS revisada, versao
           FROM revisao_prontuario WHERE id = ?`,
        [rev],
      )
    )[0];

  it('recusas sem gravar: versão, sorteio cancelado, resposta incompleta, item fora, sem médico, resultado divergente', async () => {
    const tudo = { assinatura: 'conforme', evolucao: 'conforme', sumario: 'conforme' } as const;
    expect(await codigoDe(revisao(ids['p1']!, 9, tudo))).toBe('409:versao-desatualizada');
    expect(await codigoDe(revisao(ids['pCancelado']!, 1, tudo))).toMatch(/:sorteio-cancelado$/);
    expect(await codigoDe(revisao(ids['p1']!, 1, { assinatura: 'conforme', evolucao: 'conforme' }))).toMatch(
      /:resposta-incompleta$/,
    );
    expect(await codigoDe(revisao(ids['p1']!, 1, { ...tudo, outro: 'conforme' }))).toMatch(
      /:item-fora-do-checklist$/,
    );
    expect(
      await codigoDe(revisao(ids['p2']!, 1, { ...tudo, assinatura: 'naoConforme' }, { registro: null })),
    ).toMatch(/:pendencia-sem-responsavel$/);
    expect(await codigoDe(revisao(ids['p1']!, 1, tudo, { situacao: 'naoConforme' }))).toMatch(
      /:resultado-divergente$/,
    );
    // A revisão de outro estabelecimento, pedida a partir deste, não é achada: recusa sem gravar.
    expect(await codigoDe(revisao(ids['pOutro']!, 1, { ...tudo, assinatura: 'naoConforme' }))).toBe(
      '409:versao-desatualizada',
    );
    expect(await itens(ids['pOutro']!)).toEqual([]);
    expect(await cabeca(ids['pOutro']!)).toMatchObject({
      situacao: 'em_andamento',
      resultado: null,
      versao: 1,
    });
    // Nada gravado.
    expect(await itens(ids['p1']!)).toEqual([]);
    expect(await pendencias(ids['at2']!)).toEqual([]);
    expect(await cabeca(ids['p1']!)).toMatchObject({ situacao: 'em_andamento', resultado: null, versao: 1 });
  });

  it('primeira revisão: itens, resultado, percentual e a pendência ao médico', async () => {
    expect(
      await revisao(ids['p1']!, 1, {
        assinatura: 'naoConforme',
        evolucao: 'conforme',
        sumario: 'naoAplicavel',
      }),
    ).toEqual({ versao: 2 });
    expect(await cabeca(ids['p1']!)).toMatchObject({
      situacao: 'concluida',
      resultado: 'nao_conforme',
      percentual: '50.0000',
      geradas: 1,
      observacao: 'Revisão sintética',
      justificativa: null,
      revisor: m.usuario,
      revisada: '2026-11-20 10:00:00',
      versao: 2,
    });
    const pend = await pendencias(ids['at1']!);
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({
      situacao: 'aberta',
      descricao: 'Item não conforme: assinatura.',
      resp: ids['prof'],
      por: m.usuario,
      prazo: '2026-12-10 23:59:59',
      tipo: TIPO_PENDENCIA_REVISAO,
      versao: 1,
    });
    expect(await itens(ids['p1']!)).toEqual([
      {
        item: 'assinatura',
        sequencia: 1,
        resultado: 'nao_conforme',
        observacao: 'Obs assinatura',
        resp: ids['prof'],
        pend: pend[0]!['id'],
        versao: 1,
      },
      {
        item: 'evolucao',
        sequencia: 2,
        resultado: 'conforme',
        observacao: null,
        resp: null,
        pend: null,
        versao: 1,
      },
      {
        item: 'sumario',
        sequencia: 3,
        resultado: 'nao_se_aplica',
        observacao: null,
        resp: null,
        pend: null,
        versao: 1,
      },
    ]);
    // A leitura própria (Q3) entrega o prontuário revisado e a pendência pelo contrato.
    const l = new LeiturasRevisaoComplementoQ3(m.nucleo);
    expect(await l.prontuarioRevisao(c, ids['p1']!)).toMatchObject({
      situacao: 'naoConforme',
      revisadoPor: m.login,
      versao: 2,
    });
    expect((await l.pendenciasDosProntuarios(c, [ids['p1']!])).map((p) => [p.item, p.situacao])).toEqual([
      ['assinatura', 'aberta'],
    ]);
  });

  it('correção: exige justificativa; altera os itens, cancela e cria pendências e põe a versão anterior na trilha', async () => {
    const corr = { assinatura: 'conforme', evolucao: 'naoConforme', sumario: 'naoAplicavel' } as const;
    expect(await codigoDe(revisao(ids['p1']!, 2, corr))).toMatch(/:justificativa-obrigatoria$/);
    expect(await revisao(ids['p1']!, 2, corr, { justificativa: 'Assinatura localizada no verso.' })).toEqual({
      versao: 3,
    });
    const pend = await pendencias(ids['at1']!);
    expect(pend.map((p) => [p['descricao'], p['situacao']])).toEqual([
      ['Item não conforme: assinatura.', 'cancelada'],
      ['Item não conforme: evolucao.', 'aberta'],
    ]);
    expect(pend[0]!['resolucao']).toBe(
      'Revisão corrigida: o item deixou de ser não conforme. Assinatura localizada no verso.',
    );
    const it = await itens(ids['p1']!);
    // Nenhum item apagado: a assinatura continua ligada à pendência (cancelada), agora conforme.
    expect(it.map((x) => [x['item'], x['resultado'], x['pend'], x['versao']])).toEqual([
      ['assinatura', 'conforme', pend[0]!['id'], 2],
      ['evolucao', 'nao_conforme', pend[1]!['id'], 2],
      ['sumario', 'nao_se_aplica', null, 1],
    ]);
    expect(await cabeca(ids['p1']!)).toMatchObject({
      resultado: 'nao_conforme',
      percentual: '50.0000',
      geradas: 2,
      justificativa: 'Assinatura localizada no verso.',
      versao: 3,
    });
    const vs = await new LeiturasGestaoComplementoD(m.nucleo).versoes(c, 'revisao_prontuario', ids['p1']!);
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ versao: 2, acao: 'correcao', motivo: 'Assinatura localizada no verso.' });
    expect(vs[0]?.dados).toMatchObject({ resultado: 'nao_conforme', versao: 2 });
    const anteriores = vs[0]?.dados['itens'] as Record<string, unknown>[];
    expect(anteriores.map((x) => [x['item_codigo'], x['resultado']])).toEqual([
      ['assinatura', 'nao_conforme'],
      ['evolucao', 'conforme'],
      ['sumario', 'nao_se_aplica'],
    ]);
    expect((vs[0]?.dados['pendencias'] as Record<string, unknown>[]).map((x) => x['situacao'])).toEqual([
      'aberta',
    ]);
  });

  it('a pendência cancelada reabre quando o item volta a não conforme (nunca uma segunda)', async () => {
    expect(
      await revisao(
        ids['p1']!,
        3,
        { assinatura: 'naoConforme', evolucao: 'naoConforme', sumario: 'conforme' },
        { justificativa: 'A assinatura do verso é de outro profissional.' },
      ),
    ).toEqual({ versao: 4 });
    const pend = await pendencias(ids['at1']!);
    expect(pend.map((p) => [p['situacao'], p['resolucao'], p['versao']])).toEqual([
      ['aberta', null, 3],
      ['aberta', null, 1],
    ]);
    expect(await cabeca(ids['p1']!)).toMatchObject({ percentual: '33.3333', geradas: 2, versao: 4 });
  });

  it('revisão toda conforme sem médico responsável grava (não há pendência a cobrar)', async () => {
    expect(
      await revisao(
        ids['p2']!,
        1,
        { assinatura: 'conforme', evolucao: 'conforme', sumario: 'conforme' },
        { registro: null },
      ),
    ).toEqual({ versao: 2 });
    expect(await cabeca(ids['p2']!)).toMatchObject({
      resultado: 'conforme',
      percentual: '100.0000',
      geradas: 0,
    });
    expect(await pendencias(ids['at2']!)).toEqual([]);
  });

  it('checklist com itens sem código: casa por item<sequência>, pondera o peso e recusa o "não se aplica" não aceito', async () => {
    expect(await codigoDe(revisao(ids['p3']!, 1, { item1: 'naoAplicavel', item2: 'conforme' }))).toMatch(
      /:nao-aplicavel-nao-aceito$/,
    );
    expect(await itens(ids['p3']!)).toEqual([]);
    // Crítico (peso 3) conforme e simples (peso 1) não conforme: 3 ÷ 4 = 75%.
    expect(await revisao(ids['p3']!, 1, { item1: 'conforme', item2: 'naoConforme' })).toEqual({ versao: 2 });
    expect(await cabeca(ids['p3']!)).toMatchObject({
      resultado: 'nao_conforme',
      percentual: '75.0000',
      geradas: 1,
    });
    const pend = await pendencias(ids['at3']!);
    expect(pend.map((p) => [p['descricao'], p['situacao']])).toEqual([
      ['Item não conforme: item2.', 'aberta'],
    ]);
    expect((await itens(ids['p3']!)).map((x) => [x['item'], x['resultado'], x['pend']])).toEqual([
      [null, 'conforme', null],
      [null, 'nao_conforme', pend[0]!['id']],
    ]);
  });

  it('a pendência resolvida pelo médico reabre quando a correção mantém o item não conforme', async () => {
    const [p0] = await pendencias(ids['at3']!);
    await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'resolver-pendencia-revisar' }, (e) =>
      e.executar(
        `UPDATE pendencia_prontuario SET situacao = 'resolvida', resolucao = 'Evolução complementada.',
                resolvida_em = '2026-11-21 08:00:00', resolvida_por_usuario_id = ?, versao = versao + 1 WHERE id = ?`,
        [m.usuario, p0!['id']],
      ),
    );
    expect(
      await revisao(
        ids['p3']!,
        2,
        { item1: 'naoConforme', item2: 'naoConforme' },
        { justificativa: 'Evolução complementada continua sem assinatura.' },
      ),
    ).toEqual({ versao: 3 });
    const pend = await pendencias(ids['at3']!);
    // A mesma pendência volta a aberta (sem a resolução); o item crítico ganha a sua.
    expect(pend.map((p) => [p['descricao'], p['situacao'], p['resolucao']])).toEqual([
      ['Item não conforme: item2.', 'aberta', null],
      ['Item não conforme: item1.', 'aberta', null],
    ]);
    expect(await cabeca(ids['p3']!)).toMatchObject({ percentual: '0.0000', geradas: 2, versao: 3 });
    // A resolução anterior fica na trilha, na versão anterior da revisão.
    const vs = await new LeiturasGestaoComplementoD(m.nucleo).versoes(c, 'revisao_prontuario', ids['p3']!);
    expect(vs[0]).toMatchObject({ versao: 2, acao: 'correcao' });
    expect(
      (vs[0]?.dados['pendencias'] as Record<string, unknown>[]).map((x) => [x['situacao'], x['resolucao']]),
    ).toEqual([['resolvida', 'Evolução complementada.']]);
  });
});
