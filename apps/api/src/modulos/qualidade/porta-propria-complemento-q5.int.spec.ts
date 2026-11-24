// Integração do complemento Q5 da porta própria da gestão da qualidade (fecho-1, qualidade-resto) contra o MariaDB do
// cliente de teste do lote (SGH_CLIENTE_TESTE). Só dados sintéticos, nos estabelecimentos da massa 'Q5': uma comissão
// com o checklist publicado, um sorteio ativo com dois prontuários (um concluído com a pendência aberta) e um sorteio
// cancelado, uma reunião realizada, três não conformidades (duas abertas e uma reaberta) e uma do outro
// estabelecimento, e duas auditorias com o checklist. Confere cada leitura no banco (consultas, filtro pelo
// estabelecimento, nulo do inexistente) e cada gravação pelo gravador real dentro da gravação direta: a linha
// resultante (CHECKs ck_revisao_prontuario_aval, ck_reuniao_comissao_cancelamento/_realizacao e
// ck_nao_conformidade_qualidade_cancelamento), a versão anterior na trilha (lida por `versoes`) e as recusas sem gravar.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
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
import { LeiturasGestaoComplementoD } from './porta-propria-complemento-d.js';
import {
  gravacoesComplementoQ5,
  LeiturasGestaoComplementoQ5,
  TABELAS_COMPLEMENTO_Q5,
} from './porta-propria-complemento-q5.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'nao_conformidade_qualidade',
  entidadeId: null,
  correlacao: 'teste-qualidade-q5',
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

describe.skipIf(SEM_BANCO_QUA)(
  `complemento Q5 da gestão da qualidade no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let leituras: LeiturasGestaoComplementoQ5;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    let ids: Record<string, number> = {};
    let setorNome = '';

    const gravar = <R>(fn: (g: GravadorGestao) => Promise<R>) =>
      gravacaoDireta(m.nucleo.criarExecutor(), c, {
        nome: 'qualidade.gestao',
        tabelas: TABELAS_COMPLEMENTO_Q5,
        trilha: T,
        gravador: (tx, est, anotacao = { motivo: null, dados: null }) =>
          gravacoesComplementoQ5(tx, est, anotacao) as unknown as GravadorGestao,
        fn,
      });
    const linha = (sql: string, p: unknown[]) =>
      m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conferencia-q5' }, (e) =>
        e.uma<Record<string, unknown>>(sql, p),
      );
    const versoes = (
      tabela: 'pendencia_prontuario' | 'reuniao_comissao' | 'nao_conformidade_qualidade',
      id: number,
    ) => new LeiturasGestaoComplementoD(m.nucleo).versoes(c, tabela, id);

    beforeAll(async () => {
      m = await prepararMassaQualidade('Q5');
      leituras = new LeiturasGestaoComplementoQ5(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      await m.nucleo.escrever(
        { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-qualidade-q5' },
        async (e) => {
          const hoje = new Date('2026-11-01T10:00:00');
          const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
            (await e.uma<{ id: number }>(sel, p))?.id ?? e.inserir(ins, pi);
          setorNome = String(
            (await e.uma<{ nome: string }>('SELECT nome FROM setor_funcional WHERE id = ?', [m.setor]))?.nome,
          );
          const tipoComissao = await garantir(
            'SELECT id FROM tipo_comissao WHERE codigo = ?',
            ['sintq5_rev'],
            "INSERT INTO tipo_comissao (codigo, descricao, criado_em) VALUES ('sintq5_rev', 'Revisão sintética', ?)",
            [hoje],
          );
          const comissao = await e.inserir(
            'INSERT INTO comissao_hospitalar (estabelecimento_id, tipo_comissao_id, nome, criado_em) VALUES (?, ?, ?, ?)',
            [m.est, tipoComissao, `COMISSAO SINTETICA Q5 ${NUM}`, hoje],
          );
          const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
            'PESSOA SINTETICA Q5',
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
            ['sintq5_int'],
            "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES ('sintq5_int', 'Categoria sintética', 'internacao', ?)",
            [hoje],
          );
          const carater = await garantir(
            'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
            ['sq5'],
            "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('sq5', 'Caráter sintético', 'teste', ?)",
            [hoje],
          );
          const fonte = await garantir(
            'SELECT id FROM fonte_pagadora WHERE codigo = ?',
            ['SINTQ5'],
            "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES ('SINTQ5', 'Fonte sintética Q5', 'particular', ?)",
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
          const tipoPendencia = await garantir(
            'SELECT id FROM tipo_pendencia_prontuario WHERE codigo = ?',
            ['sintq5_rev'],
            "INSERT INTO tipo_pendencia_prontuario (codigo, descricao, categoria, criado_em) VALUES ('sintq5_rev', 'Revisão sintética', 'documento', ?)",
            [hoje],
          );
          // O checklist publicado da comissão (versão vigente com um item).
          const modelo = await e.inserir(
            `INSERT INTO modelo_checklist_qualidade (codigo, nome, finalidade, comissao_hospitalar_id, situacao, criado_em)
           VALUES (?, 'Checklist sintético Q5', 'revisao_prontuario', ?, 'publicado', ?)`,
            [`SQ5${NUM}`, comissao, hoje],
          );
          const checklist = await e.inserir(
            `INSERT INTO modelo_checklist_qualidade_versao (modelo_checklist_qualidade_id, operacao, ocorrido_em, numero_versao,
             situacao, vigencia_inicio, motivo_publicacao, publicado_em, publicador_usuario_id, criado_em)
           VALUES (?, 'inclusao', ?, 1, 'vigente', '2026-01-01', 'Publicação sintética', ?, ?, ?)`,
            [modelo, hoje, hoje, m.usuario, hoje],
          );
          const itemChecklist = await e.inserir(
            `INSERT INTO modelo_checklist_qualidade_item (modelo_checklist_qualidade_versao_id, sequencia, codigo, enunciado, criado_em)
           VALUES (?, 1, 'assinatura', 'Assinatura e número do conselho', ?)`,
            [checklist, hoje],
          );
          const sorteio = (competencia: string, cancelado: boolean) =>
            e.inserir(
              `INSERT INTO sorteio_revisao_prontuario (estabelecimento_id, comissao_hospitalar_id, competencia,
               universo_quantidade, quantidade, semente, hash_universo, sorteado_em, sorteado_por_usuario_id, situacao,
               justificativa, alterado_em, alterado_por, criado_em)
             VALUES (?, ?, ?, 10, 2, 'semente', ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                m.est,
                comissao,
                competencia,
                'b'.repeat(64),
                hoje,
                m.usuario,
                cancelado ? 'cancelado' : 'sorteado',
                cancelado ? 'Cancelamento sintético' : null,
                cancelado ? '2026-10-20 10:00:00' : null,
                cancelado ? m.usuario : null,
                hoje,
              ],
            );
          const sorteioAtivo = await sorteio('2026-10-01', false);
          const sorteioCancelado = await sorteio('2026-09-01', true);
          const rev = (s: number, at: number, revisado: boolean) =>
            e.inserir(
              `INSERT INTO revisao_prontuario (estabelecimento_id, comissao_hospitalar_id, sorteio_revisao_prontuario_id,
               paciente_id, atendimento_id, modelo_checklist_qualidade_versao_id, revisor_usuario_id, resultado,
               situacao, revisada_em, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                m.est,
                comissao,
                s,
                paciente,
                at,
                checklist,
                m.usuario,
                revisado ? 'nao_conforme' : null,
                revisado ? 'concluida' : 'em_andamento',
                revisado ? hoje : null,
                hoje,
              ],
            );
          const p1 = await rev(sorteioAtivo, at1, true);
          const p2 = await rev(sorteioAtivo, at2, false);
          const pCancelado = await rev(sorteioCancelado, at2, false);
          const pend = await e.inserir(
            `INSERT INTO pendencia_prontuario (estabelecimento_id, atendimento_id, paciente_id, tipo_pendencia_prontuario_id,
             responsavel_profissional_id, descricao, apontada_em, apontada_por_usuario_id, prazo_em, criado_em)
           VALUES (?, ?, ?, ?, ?, 'Falta assinatura.', ?, ?, '2026-11-10', ?)`,
            [m.est, at1, paciente, tipoPendencia, prof, hoje, m.usuario, hoje],
          );
          await e.inserir(
            `INSERT INTO revisao_prontuario_item (revisao_prontuario_id, sequencia, modelo_checklist_qualidade_item_id,
             resultado, observacao, responsavel_profissional_id, pendencia_prontuario_id, criado_em)
           VALUES (?, 1, ?, 'nao_conforme', 'Sem assinatura.', ?, ?, ?)`,
            [p1, itemChecklist, prof, pend, hoje],
          );
          const reuniao = await e.inserir(
            `INSERT INTO reuniao_comissao (comissao_hospitalar_id, tipo, situacao, agendada_para, realizada_em, pauta, ata,
             criado_em, criado_por)
           VALUES (?, 'ordinaria', 'realizada', '2026-10-07 14:00:00', '2026-10-08 14:00:00', 'Pauta sintética',
             'Ata sintética', ?, ?)`,
            [comissao, hoje, m.usuario],
          );
          const nc = (est: number, k: string, situacao: string) =>
            e.inserir(
              `INSERT INTO nao_conformidade_qualidade (estabelecimento_id, numero, tipo_origem, setor_funcional_id, descricao,
               classificacao, situacao, responsavel_usuario_id, prazo, aberta_em, criado_em)
             VALUES (?, ?, 'outra', ?, 'Não conformidade sintética', 'menor', ?, ?, ?, ?, ?)`,
              [
                est,
                `Q5-${NUM}-${k}`,
                est === m.est ? m.setor : m.setorOutro,
                situacao,
                situacao === 'aberta' ? null : m.usuario,
                situacao === 'aberta' ? null : '2026-12-01',
                hoje,
                hoje,
              ],
            );
          const ncA = await nc(m.est, 'A', 'aberta');
          const ncB = await nc(m.est, 'B', 'aberta');
          const ncR = await nc(m.est, 'R', 'reaberta');
          const ncOutro = await nc(m.outro, 'O', 'aberta');
          const categoriaAud = await garantir(
            'SELECT id FROM categoria_auditoria_interna WHERE codigo = ?',
            ['sintq5'],
            "INSERT INTO categoria_auditoria_interna (codigo, descricao, criado_em) VALUES ('sintq5', 'Categoria sintética Q5', ?)",
            [hoje],
          );
          const auditoria = (est: number, k: string, previsto: string, realizado: string | null) =>
            e.inserir(
              `INSERT INTO auditoria_interna (estabelecimento_id, numero, titulo, categoria_auditoria_interna_id,
               setor_funcional_id, inicio_previsto, fim_previsto, inicio_realizado, auditor_lider_usuario_id,
               auditores_descricao, situacao, itens_conformes, itens_nao_conformes, fechamento, criado_em, criado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUDITOR SINT A; AUDITOR SINT B', 'em_execucao', 1, 1,
               'Conclusão sintética', ?, ?)`,
              [
                est,
                `Q5-${NUM}-${k}`,
                `Auditoria sintética ${k}`,
                categoriaAud,
                est === m.est ? m.setor : m.setorOutro,
                previsto,
                previsto,
                realizado,
                m.usuario,
                hoje,
                m.usuario,
              ],
            );
          const audRecente = await auditoria(m.est, 'R', '2026-10-01', '2026-10-05');
          const audAntiga = await auditoria(m.est, 'P', '2026-09-01', null);
          const audOutro = await auditoria(m.outro, 'O', '2026-10-01', null);
          await e.inserir(
            `INSERT INTO auditoria_interna_item (auditoria_interna_id, sequencia, pergunta, resultado, evidencia, criado_em)
           VALUES (?, 1, 'Requisito sintético 1', 'conforme', 'Evidência sintética', ?)`,
            [audRecente, hoje],
          );
          await e.inserir(
            `INSERT INTO auditoria_interna_item (auditoria_interna_id, sequencia, pergunta, resultado, justificativa, criado_em)
           VALUES (?, 2, 'Requisito sintético 2', 'nao_conforme', 'Justificativa sintética', ?)`,
            [audRecente, hoje],
          );
          ids = {
            comissao,
            pf,
            prof,
            vinculo,
            paciente,
            at1,
            at2,
            modelo,
            checklist,
            sorteioAtivo,
            sorteioCancelado,
            p1,
            p2,
            pCancelado,
            pend,
            reuniao,
            ncA,
            ncB,
            ncR,
            ncOutro,
            audRecente,
            audAntiga,
            audOutro,
          };
        },
      );
    });

    afterAll(async () => {
      // Só o sintético desta execução, na ordem das chaves; a trilha fica (só de acréscimo). As não conformidades saem
      // pela limpeza da massa.
      if (m && ids['comissao'])
        await m.nucleo
          .escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-qualidade-q5' }, async (e) => {
            const run = (sql: string, p: unknown[]) => e.executar(sql, p).catch(() => undefined);
            await run(
              'DELETE i FROM auditoria_interna_item i JOIN auditoria_interna a ON a.id = i.auditoria_interna_id WHERE a.estabelecimento_id IN (?, ?)',
              [m.est, m.outro],
            );
            await run('DELETE FROM auditoria_interna WHERE estabelecimento_id IN (?, ?)', [m.est, m.outro]);
            await run(
              'DELETE ri FROM revisao_prontuario_item ri JOIN revisao_prontuario r ON r.id = ri.revisao_prontuario_id WHERE r.comissao_hospitalar_id = ?',
              [ids['comissao']],
            );
            await run('DELETE FROM pendencia_prontuario WHERE atendimento_id IN (?, ?)', [
              ids['at1'],
              ids['at2'],
            ]);
            await run('DELETE FROM revisao_prontuario WHERE comissao_hospitalar_id = ?', [ids['comissao']]);
            await run('DELETE FROM sorteio_revisao_prontuario WHERE comissao_hospitalar_id = ?', [
              ids['comissao'],
            ]);
            await run(
              'DELETE FROM modelo_checklist_qualidade_item WHERE modelo_checklist_qualidade_versao_id = ?',
              [ids['checklist']],
            );
            await run('DELETE FROM modelo_checklist_qualidade_versao WHERE id = ?', [ids['checklist']]);
            await run('DELETE FROM modelo_checklist_qualidade WHERE id = ?', [ids['modelo']]);
            await run('DELETE FROM reuniao_comissao WHERE comissao_hospitalar_id = ?', [ids['comissao']]);
            await run('DELETE FROM atendimento WHERE id IN (?, ?)', [ids['at1'], ids['at2']]);
            await run('DELETE FROM paciente WHERE id = ?', [ids['paciente']]);
            await run('DELETE FROM usuario_profissional WHERE id = ?', [ids['vinculo']]);
            await run('DELETE FROM comissao_hospitalar WHERE id = ?', [ids['comissao']]);
            await run('DELETE FROM profissional WHERE id = ?', [ids['prof']]);
            await run('DELETE FROM pessoa_fisica WHERE id = ?', [ids['pf']]);
          })
          .catch(() => undefined);
      await encerrarMassaQualidade(m);
    });

    it('auditorias: a página da mais recente para a mais antiga, com o checklist, a área e o referencial', async () => {
      const pag = await leituras.auditorias(c, { pagina: 1, porPagina: 10 });
      expect(pag.total).toBe(2);
      expect(pag.itens.map((a) => a.id)).toEqual([ids['audRecente'], ids['audAntiga']]);
      expect(pag.itens[0]).toMatchObject({
        titulo: 'Auditoria sintética R',
        area: setorNome,
        referencial: 'sintq5',
        realizadaEm: '2026-10-05',
        auditores: 'AUDITOR SINT A; AUDITOR SINT B',
        conformes: 1,
        naoConformes: 1,
        conclusao: 'Conclusão sintética',
        registradaPor: m.login,
        versao: 1,
        canceladaEm: null,
      });
      expect(JSON.parse(pag.itens[0]!.itens)).toEqual([
        {
          requisito: 'Requisito sintético 1',
          secao: null,
          resultado: 'conforme',
          evidencia: 'Evidência sintética',
        },
        { requisito: 'Requisito sintético 2', secao: null, resultado: 'naoConforme', evidencia: null },
      ]);
      expect(pag.itens[1]).toMatchObject({ realizadaEm: '2026-09-01', itens: '[]' });
      const segunda = await leituras.auditorias(c, { pagina: 2, porPagina: 1 });
      expect([segunda.total, segunda.itens.map((a) => a.id)]).toEqual([2, [ids['audAntiga']]]);
      expect((await leituras.auditoria(c, ids['audRecente']!))?.id).toBe(ids['audRecente']);
      expect(await leituras.auditoria(c, ids['audOutro']!)).toBeNull();
      expect(await leituras.auditoria(cOutro, ids['audRecente']!)).toBeNull();
    });

    it('análises da competência e logins dos médicos rodam no banco', async () => {
      expect(await leituras.analises(c, '2026-10')).toEqual([]);
      const logins = await leituras.loginsDosMedicos(c, [ids['prof']!, 999_999_999]);
      expect(logins.get(ids['prof']!)?.toUpperCase()).toBe(m.loginGestor.toUpperCase());
      expect(logins.get(999_999_999)).toBe('');
    });

    it('sorteios e revisões: o checklist das revisões, os revisados e o cancelado; as revisões só dos ativos', async () => {
      const ss = await leituras.sorteiosRevisao(c, ids['comissao']!);
      expect(ss.map((s) => s.id)).toEqual([ids['sorteioAtivo'], ids['sorteioCancelado']]);
      expect(ss[0]).toMatchObject({
        competencia: '2026-10',
        checklist: ids['checklist'],
        checklistRevisao: 1,
        quantidade: 2,
        universo: 10,
        revisados: 1,
        sorteadoPor: m.login,
        canceladoEm: null,
        motivoCancelamento: null,
      });
      expect(ss[1]).toMatchObject({
        competencia: '2026-09',
        revisados: 0,
        canceladoEm: '2026-10-20T10:00:00',
        canceladoPor: m.login,
        motivoCancelamento: 'Cancelamento sintético',
      });
      expect((await leituras.sorteioRevisao(c, ids['sorteioAtivo']!))?.revisados).toBe(1);
      expect(await leituras.sorteioRevisao(cOutro, ids['sorteioAtivo']!)).toBeNull();
      expect(await leituras.sorteiosRevisao(cOutro, ids['comissao']!)).toEqual([]);

      const comp = await leituras.revisoesDaCompetencia(c, ids['comissao']!, '2026-10');
      expect(comp.map((p) => [p.id, p.reg])).toEqual([
        [ids['p1'], ids['at1']],
        [ids['p2'], ids['at2']],
      ]);
      expect(await leituras.revisoesDaCompetencia(c, ids['comissao']!, '2026-09')).toEqual([]);
      expect((await leituras.revisoesDaInternacao(c, ids['at2']!)).map((p) => p.id)).toEqual([ids['p2']]);
      expect(await leituras.revisoesDaInternacao(cOutro, ids['at2']!)).toEqual([]);
    });

    it('aval: recusa com a pendência aberta; cancelar a pendência grava e versiona; aí o aval passa', async () => {
      const aval = (id: number, versao: number) =>
        gravar((g) => g.avalRevisao({ id, versao, agora: '2026-11-03T09:00:00', usuario: m.login }));
      expect(await codigoDe(aval(ids['p1']!, 1))).toBe('409:versao-desatualizada');
      expect(await codigoDe(aval(ids['p2']!, 1))).toBe('409:versao-desatualizada');

      const cancelar = (versao: number) =>
        gravar((g) =>
          g.cancelarPendenciaRevisao({
            id: ids['pend']!,
            versao,
            motivo: 'Pendência sintética indevida',
            agora: '2026-11-02T09:00:00',
            usuario: m.login,
          }),
        );
      expect(await codigoDe(cancelar(7))).toBe('409:versao-desatualizada');
      expect(await cancelar(1)).toEqual({ versao: 2 });
      expect(
        await linha(
          'SELECT situacao, resolucao, resolvida_por_usuario_id AS por, versao FROM pendencia_prontuario WHERE id = ?',
          [ids['pend']],
        ),
      ).toMatchObject({
        situacao: 'cancelada',
        resolucao: 'Pendência sintética indevida',
        por: m.usuario,
        versao: 2,
      });
      const vp = await versoes('pendencia_prontuario', ids['pend']!);
      expect(vp).toHaveLength(1);
      expect(vp[0]).toMatchObject({
        versao: 1,
        acao: 'cancelamento',
        motivo: 'Pendência sintética indevida',
      });
      expect(vp[0]?.dados).toMatchObject({ situacao: 'aberta', versao: 1 });
      expect(await codigoDe(cancelar(2))).toBe('409:versao-desatualizada');

      expect(await aval(ids['p1']!, 1)).toEqual({ versao: 2 });
      const r = await linha(
        'SELECT situacao, avalizada_em, avalizada_por_usuario_id AS por, versao FROM revisao_prontuario WHERE id = ?',
        [ids['p1']],
      );
      expect(r).toMatchObject({ situacao: 'avalizada', por: m.usuario, versao: 2 });
      expect(r?.['avalizada_em']).not.toBeNull();
      expect(await codigoDe(aval(ids['p1']!, 2))).toBe('409:versao-desatualizada');
    });

    it('cancelar a reunião realizada: situação, motivo, sem realização (CHECK) e a linha anterior na trilha', async () => {
      const cancelar = (versao: number) =>
        gravar((g) =>
          g.cancelarReuniao({
            id: ids['reuniao']!,
            versao,
            justificativa: 'Reunião sintética registrada por engano',
            agora: '2026-11-02T10:00:00',
            usuario: m.login,
          }),
        );
      expect(await cancelar(1)).toEqual({ versao: 2 });
      const r = await linha(
        'SELECT situacao, cancelada_em, motivo_cancelamento AS motivo, realizada_em, versao FROM reuniao_comissao WHERE id = ?',
        [ids['reuniao']],
      );
      expect(r).toMatchObject({
        situacao: 'cancelada',
        motivo: 'Reunião sintética registrada por engano',
        realizada_em: null,
        versao: 2,
      });
      expect(r?.['cancelada_em']).not.toBeNull();
      const vs = await versoes('reuniao_comissao', ids['reuniao']!);
      expect(vs[0]).toMatchObject({ versao: 1, acao: 'cancelamento', alteradoPor: m.login });
      expect(vs[0]?.dados).toMatchObject({
        situacao: 'realizada',
        realizada_em: '2026-10-08T14:00:00',
        versao: 1,
      });
      expect(await codigoDe(cancelar(2))).toBe('409:versao-desatualizada');
    });

    it('não conformidade: duplicada, dependente cancelada recusa a original, reaberta se cancela', async () => {
      const cancelar = (id: number, versao: number, duplicadaDe: number | null) =>
        gravar((g) =>
          g.cancelarNaoConformidade({
            id,
            versao,
            duplicadaDe,
            justificativa: 'Cancelamento sintético',
            agora: '2026-11-02T11:00:00',
            usuario: m.login,
          }),
        );
      // A duplicada do outro estabelecimento e a própria não valem.
      expect(await codigoDe(cancelar(ids['ncB']!, 1, ids['ncOutro']!))).toBe('409:duplicada-inexistente');
      expect(await codigoDe(cancelar(ids['ncB']!, 1, ids['ncB']!))).toBe('409:duplicada-inexistente');
      // B cancelada como duplicada de A.
      expect(await cancelar(ids['ncB']!, 1, ids['ncA']!)).toEqual({ versao: 2 });
      expect(
        await linha(
          `SELECT situacao, motivo_cancelamento AS motivo, cancelada_por_usuario_id AS por, duplicada_de_id AS dup, versao
             FROM nao_conformidade_qualidade WHERE id = ?`,
          [ids['ncB']],
        ),
      ).toMatchObject({
        situacao: 'cancelada',
        motivo: 'Cancelamento sintético',
        por: m.usuario,
        dup: ids['ncA'],
        versao: 2,
      });
      const vs = await versoes('nao_conformidade_qualidade', ids['ncB']!);
      expect(vs[0]).toMatchObject({ versao: 1, acao: 'cancelamento', motivo: 'Cancelamento sintético' });
      expect(vs[0]?.dados).toMatchObject({ situacao: 'aberta', duplicada_de_id: null, versao: 1 });
      // A original: B (já cancelada) a aponta, então recusa sem gravar.
      expect(await codigoDe(cancelar(ids['ncA']!, 1, null))).toBe('409:com-dependentes');
      expect(
        await linha('SELECT situacao, versao FROM nao_conformidade_qualidade WHERE id = ?', [ids['ncA']]),
      ).toMatchObject({ situacao: 'aberta', versao: 1 });
      // Uma cancelada não vale como original.
      expect(await codigoDe(cancelar(ids['ncR']!, 1, ids['ncB']!))).toBe('409:duplicada-inexistente');
      // A reaberta (aberta no contrato) se cancela.
      expect(await cancelar(ids['ncR']!, 1, null)).toEqual({ versao: 2 });
      expect(
        await linha('SELECT situacao, duplicada_de_id AS dup FROM nao_conformidade_qualidade WHERE id = ?', [
          ids['ncR'],
        ]),
      ).toMatchObject({ situacao: 'cancelada', dup: null });
      expect(await codigoDe(cancelar(ids['ncR']!, 2, null))).toBe('409:versao-desatualizada');
    });
  },
);
