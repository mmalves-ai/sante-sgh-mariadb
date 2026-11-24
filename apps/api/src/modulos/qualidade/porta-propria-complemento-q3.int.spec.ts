// Integração do complemento Q3 da porta própria da gestão da qualidade (modulos-proprios-3, qualidade-q3) contra o
// MariaDB do cliente de teste do lote (SGH_CLIENTE_TESTE). Só dados sintéticos, no estabelecimento da massa: uma
// comissão, o checklist publicado pelo gravador real (primeira revisão e a seguinte, que substitui a vigente), um
// sorteio com dois prontuários (um revisado com resposta não conforme e a pendência ao profissional) e a resposta da
// pendência pelo gravador real.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { GravadorGestao } from './porta-gestao.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import {
  gravacoesComplementoQ3,
  LeiturasRevisaoComplementoQ3,
  TABELAS_COMPLEMENTO_Q3,
} from './porta-propria-complemento-q3.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'revisao_prontuario',
  entidadeId: null,
  correlacao: 'teste-qualidade-q3',
};
const NUM = randomInt(100_000_000, 999_999_999);

describe.skipIf(SEM_BANCO_QUA)(
  `complemento Q3 da gestão da qualidade no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let leituras: LeiturasRevisaoComplementoQ3;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    const agora = '2026-11-02T09:00:00';
    let ids: Record<string, number> = {};
    let checklist = { id: 0, revisao: 0 };

    const gravar = <R>(fn: (g: GravadorGestao) => Promise<R>, ctx = c) =>
      gravacaoDireta(m.nucleo.criarExecutor(), ctx, {
        nome: 'qualidade.gestao',
        tabelas: TABELAS_COMPLEMENTO_Q3,
        trilha: T,
        gravador: (tx, est) => gravacoesComplementoQ3(tx, est) as unknown as GravadorGestao,
        fn,
      });

    beforeAll(async () => {
      m = await prepararMassaQualidade('Q3');
      leituras = new LeiturasRevisaoComplementoQ3(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-teste-qualidade-q3' }, async (e) => {
        const hoje = new Date();
        const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
          (await e.uma<{ id: number }>(sel, p))?.id ?? e.inserir(ins, pi);
        const tipoComissao = await garantir(
          'SELECT id FROM tipo_comissao WHERE codigo = ?',
          ['sintq3_rev'],
          "INSERT INTO tipo_comissao (codigo, descricao, criado_em) VALUES ('sintq3_rev', 'Revisão sintética', ?)",
          [hoje],
        );
        const comissao = await e.inserir(
          'INSERT INTO comissao_hospitalar (estabelecimento_id, tipo_comissao_id, nome, criado_em) VALUES (?, ?, ?, ?)',
          [m.est, tipoComissao, `COMISSAO SINTETICA Q3 ${NUM}`, hoje],
        );
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          'PESSOA SINTETICA Q3',
          hoje,
        ]);
        const prof = await e.inserir(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, hoje],
        );
        const vinculo = await e.inserir(
          'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [m.gestor, prof, '2026-01-01', hoje],
        );
        const paciente = await e.inserir(
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
          [pf, NUM, hoje],
        );
        const categoria = await garantir(
          'SELECT id FROM categoria_atendimento WHERE codigo = ?',
          ['sintq3_int'],
          "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES ('sintq3_int', 'Categoria sintética', 'internacao', ?)",
          [hoje],
        );
        const carater = await garantir(
          'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
          ['sq3'],
          "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('sq3', 'Caráter sintético', 'teste', ?)",
          [hoje],
        );
        const fonte = await garantir(
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          ['SINTQ3'],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES ('SINTQ3', 'Fonte sintética Q3', 'particular', ?)",
          [hoje],
        );
        const atendimento = (k: string) =>
          e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
            [m.est, `${NUM}${k}`, paciente, categoria, carater, fonte, prof, hoje, hoje],
          );
        const tipoPendencia = await garantir(
          'SELECT id FROM tipo_pendencia_prontuario WHERE codigo = ?',
          ['sintq3_rev'],
          "INSERT INTO tipo_pendencia_prontuario (codigo, descricao, categoria, criado_em) VALUES ('sintq3_rev', 'Revisão sintética', 'documento', ?)",
          [hoje],
        );
        ids = {
          comissao,
          pf,
          prof,
          vinculo,
          paciente,
          atendimento1: await atendimento('1'),
          atendimento2: await atendimento('2'),
          tipoPendencia,
        };
      });
    });

    afterAll(async () => {
      // Só o sintético desta execução, na ordem das chaves; a trilha fica (só de acréscimo). O checklist publicado é
      // histórico: se o privilégio recusar, a linha fica no estabelecimento da massa (código revisao_prontuario_*).
      if (m && ids['comissao'])
        await m.nucleo
          .escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-qualidade-q3' }, async (e) => {
            const run = (sql: string, p: unknown[]) => e.executar(sql, p).catch(() => undefined);
            await run(
              'DELETE ri FROM revisao_prontuario_item ri JOIN revisao_prontuario r ON r.id = ri.revisao_prontuario_id WHERE r.comissao_hospitalar_id = ?',
              [ids['comissao']],
            );
            await run('DELETE FROM pendencia_prontuario WHERE atendimento_id IN (?, ?)', [
              ids['atendimento1'],
              ids['atendimento2'],
            ]);
            await run('DELETE FROM revisao_prontuario WHERE comissao_hospitalar_id = ?', [ids['comissao']]);
            await run('DELETE FROM sorteio_revisao_prontuario WHERE comissao_hospitalar_id = ?', [ids['comissao']]);
            await run(
              `DELETE i FROM modelo_checklist_qualidade_item i
                 JOIN modelo_checklist_qualidade_versao v ON v.id = i.modelo_checklist_qualidade_versao_id
                 JOIN modelo_checklist_qualidade q ON q.id = v.modelo_checklist_qualidade_id WHERE q.codigo = ?`,
              [`revisao_prontuario_${ids['comissao']}`],
            );
            await run(
              `DELETE v FROM modelo_checklist_qualidade_versao v
                 JOIN modelo_checklist_qualidade q ON q.id = v.modelo_checklist_qualidade_id WHERE q.codigo = ?`,
              [`revisao_prontuario_${ids['comissao']}`],
            );
            await run('DELETE FROM modelo_checklist_qualidade WHERE codigo = ?', [
              `revisao_prontuario_${ids['comissao']}`,
            ]);
            await run('DELETE FROM atendimento WHERE id IN (?, ?)', [ids['atendimento1'], ids['atendimento2']]);
            await run('DELETE FROM paciente WHERE id = ?', [ids['paciente']]);
            await run('DELETE FROM usuario_profissional WHERE id = ?', [ids['vinculo']]);
            await run('DELETE FROM comissao_hospitalar WHERE id = ?', [ids['comissao']]);
            await run('DELETE FROM profissional WHERE id = ?', [ids['prof']]);
            await run('DELETE FROM pessoa_fisica WHERE id = ?', [ids['pf']]);
          })
          .catch(() => undefined);
      await encerrarMassaQualidade(m);
    });

    const itens = JSON.stringify([
      { codigo: 'assinatura', titulo: 'Assinatura e número do conselho' },
      { codigo: 'evolucao', titulo: 'Evolução diária' },
    ]);

    it('publicarChecklistRevisao: a primeira revisão fica vigente; a seguinte substitui a vigente conferida pela versão', async () => {
      const r1 = await gravar((g) =>
        g.publicarChecklistRevisao({ comissao: ids['comissao']!, itens, motivo: null, vigente: null, agora, usuario: m.login }),
      );
      expect(r1.revisao).toBe(1);
      // Sem citar a vigente: recusa (nunca duas vigentes).
      await expect(
        gravar((g) =>
          g.publicarChecklistRevisao({ comissao: ids['comissao']!, itens, motivo: 'x', vigente: null, agora, usuario: m.login }),
        ),
      ).rejects.toMatchObject({ status: 409 });
      // Versão desatualizada da vigente: recusa.
      await expect(
        gravar((g) =>
          g.publicarChecklistRevisao({
            comissao: ids['comissao']!,
            itens,
            motivo: 'Nova',
            vigente: { id: r1.id, versao: 9 },
            agora,
            usuario: m.login,
          }),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const r2 = await gravar((g) =>
        g.publicarChecklistRevisao({
          comissao: ids['comissao']!,
          itens,
          motivo: 'Nova revisão',
          vigente: { id: r1.id, versao: 1 },
          agora,
          usuario: m.login,
        }),
      );
      expect(r2.revisao).toBe(2);
      checklist = r2;
      const sit = await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conf-q3' }, (e) =>
        e.consultar(
          `SELECT v.id, v.situacao, v.vigencia_fim IS NOT NULL AS fim, COUNT(i.id) AS itens
             FROM modelo_checklist_qualidade_versao v LEFT JOIN modelo_checklist_qualidade_item i
               ON i.modelo_checklist_qualidade_versao_id = v.id AND i.codigo IS NOT NULL
            WHERE v.id IN (?, ?) GROUP BY v.id ORDER BY v.id`,
          [r1.id, r2.id],
        ),
      );
      expect(sit.map((x) => [x['situacao'], Number(x['fim']), Number(x['itens'])])).toEqual([
        ['substituida', 1, 2],
        ['vigente', 0, 2],
      ]);
    });

    it('prontuários e pendências: a amostra na ordem, as respostas em JSON, a pendência ao login; a resposta resolve', async () => {
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-q3-revisao' }, async (e) => {
        const hoje = new Date('2026-11-01T10:00:00');
        const sorteio = await e.inserir(
          `INSERT INTO sorteio_revisao_prontuario (estabelecimento_id, comissao_hospitalar_id, competencia,
             universo_quantidade, quantidade, semente, hash_universo, sorteado_em, sorteado_por_usuario_id, criado_em)
           VALUES (?, ?, '2026-10-01', 10, 2, 'semente', ?, ?, ?, ?)`,
          [m.est, ids['comissao'], 'a'.repeat(64), hoje, m.usuario, hoje],
        );
        const rev = (at: number, revisado: boolean) =>
          e.inserir(
            `INSERT INTO revisao_prontuario (estabelecimento_id, comissao_hospitalar_id, sorteio_revisao_prontuario_id,
               paciente_id, atendimento_id, modelo_checklist_qualidade_versao_id, revisor_usuario_id, resultado,
               situacao, revisada_em, observacao, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              m.est,
              ids['comissao'],
              sorteio,
              ids['paciente'],
              at,
              checklist.id,
              m.usuario,
              revisado ? 'nao_conforme' : null,
              revisado ? 'concluida' : 'em_andamento',
              revisado ? hoje : null,
              revisado ? 'Observação sintética.' : null,
              hoje,
            ],
          );
        const p1 = await rev(ids['atendimento1']!, true);
        const p2 = await rev(ids['atendimento2']!, false);
        const pend = await e.inserir(
          `INSERT INTO pendencia_prontuario (estabelecimento_id, atendimento_id, paciente_id, tipo_pendencia_prontuario_id,
             responsavel_profissional_id, descricao, apontada_em, apontada_por_usuario_id, prazo_em, criado_em)
           VALUES (?, ?, ?, ?, ?, 'Falta assinatura.', ?, ?, '2026-11-10', ?)`,
          [m.est, ids['atendimento1'], ids['paciente'], ids['tipoPendencia'], ids['prof'], hoje, m.usuario, hoje],
        );
        const item = await e.uma<{ id: number }>(
          "SELECT id FROM modelo_checklist_qualidade_item WHERE modelo_checklist_qualidade_versao_id = ? AND codigo = 'assinatura'",
          [checklist.id],
        );
        const item2 = await e.uma<{ id: number }>(
          "SELECT id FROM modelo_checklist_qualidade_item WHERE modelo_checklist_qualidade_versao_id = ? AND codigo = 'evolucao'",
          [checklist.id],
        );
        await e.inserir(
          `INSERT INTO revisao_prontuario_item (revisao_prontuario_id, sequencia, modelo_checklist_qualidade_item_id,
             resultado, observacao, responsavel_profissional_id, pendencia_prontuario_id, criado_em)
           VALUES (?, 1, ?, 'nao_conforme', 'Sem assinatura.', ?, ?, ?)`,
          [p1, item?.id, ids['prof'], pend, hoje],
        );
        await e.inserir(
          `INSERT INTO revisao_prontuario_item (revisao_prontuario_id, sequencia, modelo_checklist_qualidade_item_id,
             resultado, criado_em) VALUES (?, 2, ?, 'conforme', ?)`,
          [p1, item2?.id, hoje],
        );
        ids = { ...ids, sorteio, p1, p2, pend };
      });

      const amostra = await leituras.prontuariosDoSorteio(c, ids['sorteio']!);
      expect(amostra.map((p) => [p.ordem, p.situacao, p.reg])).toEqual([
        [1, 'naoConforme', ids['atendimento1']],
        [2, 'aRevisar', ids['atendimento2']],
      ]);
      expect(JSON.parse(amostra[0]!.respostas ?? '[]')).toEqual([
        { item: 'assinatura', resultado: 'naoConforme', observacao: 'Sem assinatura.' },
        { item: 'evolucao', resultado: 'conforme', observacao: null },
      ]);
      expect(amostra[0]!.revisadoPor).toBe(m.login);
      expect(amostra[1]!.revisadoPor).toBeNull();
      const so = await leituras.prontuarioRevisao(c, ids['p2']!);
      expect(so?.ordem).toBe(2);
      expect(await leituras.prontuarioRevisao(cOutro, ids['p2']!)).toBeNull();
      expect(await leituras.prontuariosDoSorteio(cOutro, ids['sorteio']!)).toEqual([]);

      const ps = await leituras.pendenciasDosProntuarios(c, [ids['p1']!, ids['p2']!]);
      expect(ps.map((p) => [p.id, p.prontuario, p.item, p.situacao, p.prazo])).toEqual([
        [ids['pend'], ids['p1'], 'assinatura', 'aberta', '2026-11-10'],
      ]);
      expect(ps[0]!.profissionalLogin?.toUpperCase()).toBe(m.loginGestor.toUpperCase());
      expect(ps[0]!.profissionalNome).toBe('PESSOA SINTETICA Q3');
      expect(await leituras.pendenciasDosProntuarios(c, [])).toEqual([]);
      const doLogin = await leituras.pendenciasDoLogin(c, m.loginGestor);
      expect(doLogin.map((p) => p.id)).toContain(ids['pend']);
      expect(await leituras.pendenciasDoLogin(cOutro, m.loginGestor)).toEqual([]);

      // Responder: versão errada recusa; a certa resolve, com quem e quando.
      await expect(
        gravar((g) =>
          g.responderPendenciaRevisao({ id: ids['pend']!, versao: 7, resposta: 'Assinado.', agora, usuario: m.login }),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const r = await gravar((g) =>
        g.responderPendenciaRevisao({ id: ids['pend']!, versao: 1, resposta: 'Assinado.', agora, usuario: m.login }),
      );
      expect(r.versao).toBe(2);
      const lida = await leituras.pendenciaRevisao(c, ids['pend']!);
      expect([lida?.situacao, lida?.resposta, lida?.resolvidaPor, lida?.resolvidaEm, lida?.versao]).toEqual([
        'resolvida',
        'Assinado.',
        m.login,
        agora,
        2,
      ]);
      // A já resolvida não se responde de novo; o outro estabelecimento não a alcança.
      await expect(
        gravar((g) =>
          g.responderPendenciaRevisao({ id: ids['pend']!, versao: 2, resposta: 'De novo.', agora, usuario: m.login }),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await leituras.pendenciaRevisao(cOutro, ids['pend']!)).toBeNull();
    });
  },
);
