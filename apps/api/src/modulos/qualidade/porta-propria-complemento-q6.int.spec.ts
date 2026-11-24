// Contrato de efeito do complemento Q6 da gestão da qualidade (F3.9-Q2) contra o MariaDB do cliente de teste
// (SGH_CLIENTE_TESTE). Só dados sintéticos, nos estabelecimentos da massa 'Q6' e num indicador sintético de código
// único por execução. Confere o que cada gravação deixa no banco: a análise crítica (indicador do catálogo incluído com
// a ficha, apuração fechada com o valor e a meta, a análise, o plano de ação com dono, a recusa da segunda análise e do
// plano incompleto; a apuração já existente: a fechada fica intacta, a cancelada recusa, a prévia é reapurada com a
// linha anterior na trilha; a alteração com a versão, que mantém a apuração fechada, mantém a situação do plano em
// andamento, cancela o retirado não concluído e só desliga o concluído, com análise e plano anteriores na trilha) e a
// auditoria interna (número do ano, categoria do referencial, setor da área, auditor líder, checklist com seção e
// justificativa, a conformidade do domínio; a alteração que regrava só o item que mudou e guarda a versão anterior,
// com o checklist e quem respondeu, na trilha lida por `versoes`). Outro estabelecimento não altera. Recusas não gravam.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import type { FichaIndicadorQualidade } from '@sgh/contratos';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
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
import { LeiturasGestaoComplementoQ5 } from './porta-propria-complemento-q5.js';
import { gravacoesComplementoQ6, TABELAS_COMPLEMENTO_Q6 } from './porta-propria-complemento-q6.js';
import type { AnaliseIndicadorNova } from './tipos.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'auditoria_interna',
  entidadeId: null,
  correlacao: 'teste-qualidade-q6',
};
const NUM = randomInt(100_000_000, 999_999_999);
const COD = `sintQ6${NUM}`;
const AGORA = '2026-11-10T10:00:00';
const COMP = '2026-10';

const FICHA: FichaIndicadorQualidade = {
  codigo: COD,
  nome: `Indicador sintético Q6 ${NUM}`,
  formula: 'Eventos ÷ pacientes-dia × 1.000',
  numerador: 'Eventos sintéticos',
  denominador: 'Pacientes-dia sintéticos',
  fator: 1000,
  unidade: 'densidade',
  fonte: 'Massa de teste',
  periodicidade: 'mensal',
  polaridade: 'menor-melhor',
  responsavel: 'Qualidade',
  referencia: 'Teste',
  programas: ['ona'],
  origem: 'qualidade',
};

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
  `complemento Q6 da gestão da qualidade no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    let setorNome = '';
    let analiseId = 0;
    let auditoriaId = 0;

    const gravar = <R>(fn: (g: GravadorGestao) => Promise<R>, ctx = c) =>
      gravacaoDireta(m.nucleo.criarExecutor(), ctx, {
        nome: 'qualidade.gestao',
        tabelas: TABELAS_COMPLEMENTO_Q6,
        trilha: T,
        gravador: (tx, est, anotacao = { motivo: null, dados: null }) =>
          gravacoesComplementoQ6(tx, est, anotacao) as unknown as GravadorGestao,
        fn,
      });
    const linha = (sql: string, p: unknown[]) =>
      m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conferencia-q6' }, (e) =>
        e.uma<Record<string, unknown>>(sql, p),
      );
    const executar = (sql: string, p: unknown[]) =>
      m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-q6' }, (e) => e.executar(sql, p));
    /** O que a última gravação do estabelecimento deixou na trilha em dados.<chave> (JSON lido). */
    const naTrilha = async (chave: string): Promise<Record<string, unknown> | null> => {
      const t = await linha(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(dados_depois, CONCAT('$.dados.', ?))) AS x FROM trilha_auditoria
          WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1`,
        [chave, m.est],
      );
      const x = t?.['x'];
      return x === null || x === undefined ? null : (JSON.parse(String(x)) as Record<string, unknown>);
    };
    const analise = (x: Partial<AnaliseIndicadorNova> = {}): AnaliseIndicadorNova => ({
      id: null,
      versao: null,
      indicador: COD,
      competencia: COMP,
      numerador: 3,
      denominador: 1250,
      valor: 2.4,
      meta: 1.5,
      situacaoMeta: 'fora-da-meta',
      texto: 'Aumento de eventos concentrado na unidade sintética, acima da meta.',
      causas: 'Troca de equipe sem treinamento',
      plano: 'Treinar a equipe e auditar o protocolo',
      responsavel: m.loginGestor,
      prazo: '2026-12-15',
      agora: AGORA,
      usuario: m.login,
      ficha: FICHA,
      ...x,
    });
    const checklist = (n: number) =>
      JSON.stringify(
        [
          {
            requisito: 'Pulseira de identificação',
            secao: 'Identificação',
            resultado: 'conforme',
            evidencia: null,
          },
          {
            requisito: 'Dupla checagem',
            secao: 'Medicamentos',
            resultado: 'naoConforme',
            evidencia: 'Sem registro',
          },
          { requisito: 'Bomba de infusão', secao: null, resultado: 'naoAplicavel', evidencia: null },
          {
            requisito: 'Escala de risco',
            secao: 'Quedas',
            resultado: 'parcial',
            evidencia: 'Feita em metade',
          },
        ].slice(0, n),
      );

    beforeAll(async () => {
      m = await prepararMassaQualidade('Q6');
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      setorNome = String((await linha('SELECT nome FROM setor_funcional WHERE id = ?', [m.setor]))?.['nome']);
    });

    afterAll(async () => {
      if (m)
        await m.nucleo
          .escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-qualidade-q6' }, async (e) => {
            const run = (sql: string, p: unknown[]) => e.executar(sql, p).catch(() => undefined);
            await run(
              'DELETE a FROM analise_critica_indicador a JOIN apuracao_indicador ap ON ap.id = a.apuracao_indicador_id WHERE ap.estabelecimento_id IN (?, ?)',
              [m.est, m.outro],
            );
            await run('DELETE FROM plano_acao_qualidade WHERE estabelecimento_id IN (?, ?)', [
              m.est,
              m.outro,
            ]);
            await run('DELETE FROM apuracao_indicador WHERE estabelecimento_id IN (?, ?)', [m.est, m.outro]);
            await run(
              'DELETE v FROM indicador_versao v JOIN indicador i ON i.id = v.indicador_id WHERE i.codigo = ?',
              [COD],
            );
            await run('DELETE FROM indicador WHERE codigo = ?', [COD]);
            await run(
              'DELETE i FROM auditoria_interna_item i JOIN auditoria_interna a ON a.id = i.auditoria_interna_id WHERE a.estabelecimento_id IN (?, ?)',
              [m.est, m.outro],
            );
            await run(
              'DELETE x FROM auditoria_interna_auditor x JOIN auditoria_interna a ON a.id = x.auditoria_interna_id WHERE a.estabelecimento_id IN (?, ?)',
              [m.est, m.outro],
            );
            await run('DELETE FROM auditoria_interna WHERE estabelecimento_id IN (?, ?)', [m.est, m.outro]);
            await run(
              `DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (?, ?)
                  AND (tipo LIKE 'auditoria_interna_%' OR tipo LIKE 'plano_acao_qualidade_%')`,
              [m.est, m.outro],
            );
            await limparTrilhaDaMassa(e, { ids: [m.est, m.outro] });
          })
          .catch(() => undefined);
      await encerrarMassaQualidade(m);
    });

    it('registrarAnaliseIndicador: indicador do catálogo, apuração fechada, análise e plano com dono', async () => {
      expect(await codigoDe(gravar((g) => g.registrarAnaliseIndicador(analise({ prazo: null }))))).toMatch(
        /:plano-incompleto$/,
      );
      expect(await linha('SELECT id FROM indicador WHERE codigo = ?', [COD])).toBeNull();
      const r = await gravar((g) => g.registrarAnaliseIndicador(analise()));
      expect(r).toMatchObject({ versao: 1, criada: true });
      analiseId = r.id;
      const ind = await linha(
        `SELECT i.unidade, i.polaridade, v.multiplicador, v.numero_versao FROM indicador i
           JOIN indicador_versao v ON v.indicador_id = i.id WHERE i.codigo = ?`,
        [COD],
      );
      expect(ind).toMatchObject({ unidade: 'taxa_por_mil', polaridade: 'menor_melhor', numero_versao: 1 });
      expect(Number(ind?.['multiplicador'])).toBe(1000);
      const ap = await linha(
        `SELECT ap.situacao, ap.situacao_meta, ap.numerador, ap.valor, ap.valor_meta, ap.escopo_chave,
                DATE_FORMAT(ap.periodo_fim, '%Y-%m-%d') AS fim, a.resultado_periodo, a.analise, a.causa,
                a.acao_proposta, a.situacao AS sa, p.tipo_origem, p.prazo, p.situacao AS sp,
                p.responsavel_usuario_id AS resp, a.responsavel_usuario_id AS autor
           FROM analise_critica_indicador a JOIN apuracao_indicador ap ON ap.id = a.apuracao_indicador_id
           LEFT JOIN plano_acao_qualidade p ON p.id = a.plano_acao_qualidade_id WHERE a.id = ?`,
        [analiseId],
      );
      expect(ap).toMatchObject({
        situacao: 'fechada',
        situacao_meta: 'fora_da_meta',
        escopo_chave: '0-0',
        fim: '2026-10-31',
        resultado_periodo: 'fora_da_meta',
        acao_proposta: 'Treinar a equipe e auditar o protocolo',
        sa: 'concluida',
        tipo_origem: 'indicador',
        sp: 'planejado',
        resp: m.gestor,
        autor: m.usuario,
      });
      expect([Number(ap?.['numerador']), Number(ap?.['valor']), Number(ap?.['valor_meta'])]).toEqual([
        3, 2.4, 1.5,
      ]);
      const lida = (await new LeiturasGestaoComplementoQ5(m.nucleo).analises(c, COMP)).find(
        (x) => x.indicador === COD,
      );
      expect(lida).toMatchObject({
        id: analiseId,
        versao: 1,
        situacaoMeta: 'fora-da-meta',
        responsavel: m.loginGestor.toUpperCase(),
        prazo: '2026-12-15',
      });
      // A segunda análise do mesmo indicador e competência recusa sem gravar.
      expect(await codigoDe(gravar((g) => g.registrarAnaliseIndicador(analise())))).toMatch(
        /:analise-ja-registrada$/,
      );
      const total = await linha(
        `SELECT COUNT(*) AS n FROM analise_critica_indicador a JOIN apuracao_indicador ap ON ap.id = a.apuracao_indicador_id
          WHERE ap.estabelecimento_id = ?`,
        [m.est],
      );
      expect(Number(total?.['n'])).toBe(1);
    });

    it('registrarAnaliseIndicador (alteração): versão, apuração fechada intacta, situação do plano e trilha', async () => {
      expect(
        await codigoDe(gravar((g) => g.registrarAnaliseIndicador(analise({ id: analiseId, versao: 9 })))),
      ).toMatch(/^409:/);
      // Outro estabelecimento não alcança a análise deste.
      expect(
        await codigoDe(
          gravar((g) => g.registrarAnaliseIndicador(analise({ id: analiseId, versao: 1 })), cOutro),
        ),
      ).toMatch(/^409:/);
      const p1 = Number(
        (
          await linha('SELECT plano_acao_qualidade_id AS p FROM analise_critica_indicador WHERE id = ?', [
            analiseId,
          ])
        )?.['p'],
      );
      // O plano andou (fora desta gravação): a correção do texto não o devolve a "planejado".
      await executar("UPDATE plano_acao_qualidade SET situacao = 'em_andamento' WHERE id = ?", [p1]);
      const r = await gravar((g) =>
        g.registrarAnaliseIndicador(
          analise({
            id: analiseId,
            versao: 1,
            valor: 1.2,
            numerador: null,
            situacaoMeta: 'na-meta',
            texto: 'Revisão: a análise corrigida mantém o plano em andamento com novo prazo.',
            prazo: '2026-12-31',
          }),
        ),
      );
      expect(r).toEqual({ id: analiseId, versao: 2, criada: false });
      const depois = await linha(
        `SELECT a.plano_acao_qualidade_id AS p, a.resultado_periodo, ap.valor, ap.numerador, ap.situacao_meta, ap.versao AS va,
                p.situacao AS sp, DATE_FORMAT(p.prazo, '%Y-%m-%d') AS prazo
           FROM analise_critica_indicador a JOIN apuracao_indicador ap ON ap.id = a.apuracao_indicador_id
           JOIN plano_acao_qualidade p ON p.id = a.plano_acao_qualidade_id WHERE a.id = ?`,
        [analiseId],
      );
      // A apuração fechada não é reescrita: valor, numerador e situação da meta ficam os apurados no fechamento.
      expect(depois).toMatchObject({ resultado_periodo: 'na_meta', situacao_meta: 'fora_da_meta', va: 1 });
      expect(Number(depois?.['p'])).toBe(p1);
      expect([Number(depois?.['valor']), Number(depois?.['numerador'])]).toEqual([2.4, 3]);
      expect(depois).toMatchObject({ sp: 'em_andamento', prazo: '2026-12-31' });
      expect(await naTrilha('analiseAnterior')).toMatchObject({
        id: analiseId,
        versao: 1,
        resultado_periodo: 'fora_da_meta',
      });
      expect(await naTrilha('planoAnterior')).toMatchObject({ id: p1, situacao: 'em_andamento' });
      expect(await naTrilha('apuracaoAnterior')).toBeNull();
      // Plano retirado e não concluído: cancelado (nunca apagado), com o retrato na trilha.
      const sem = {
        causas: null,
        plano: null,
        responsavel: null,
        prazo: null,
        situacaoMeta: 'na-meta' as const,
      };
      await gravar((g) => g.registrarAnaliseIndicador(analise({ id: analiseId, versao: 2, ...sem })));
      expect(await linha('SELECT situacao FROM plano_acao_qualidade WHERE id = ?', [p1])).toMatchObject({
        situacao: 'cancelado',
      });
      expect(await naTrilha('planoAnterior')).toMatchObject({ id: p1, situacao: 'em_andamento' });
      // O plano volta: nasce outro, planejado (o cancelado não volta).
      await gravar((g) => g.registrarAnaliseIndicador(analise({ id: analiseId, versao: 3 })));
      const p2 = Number(
        (
          await linha('SELECT plano_acao_qualidade_id AS p FROM analise_critica_indicador WHERE id = ?', [
            analiseId,
          ])
        )?.['p'],
      );
      expect(p2).not.toBe(p1);
      expect(await linha('SELECT situacao FROM plano_acao_qualidade WHERE id = ?', [p2])).toMatchObject({
        situacao: 'planejado',
      });
      // O concluído não muda: retirado da análise, só se desliga.
      await executar(
        "UPDATE plano_acao_qualidade SET situacao = 'concluido', concluido_em = '2026-11-09 09:00:00' WHERE id = ?",
        [p2],
      );
      await gravar((g) => g.registrarAnaliseIndicador(analise({ id: analiseId, versao: 4, ...sem })));
      expect(
        await linha(
          'SELECT a.plano_acao_qualidade_id AS p, (SELECT situacao FROM plano_acao_qualidade WHERE id = ?) AS sp FROM analise_critica_indicador a WHERE a.id = ?',
          [p2, analiseId],
        ),
      ).toMatchObject({ p: null, sp: 'concluido' });
    });

    it('registrarAnaliseIndicador: apuração já existente (fechada intacta, cancelada recusa, prévia reapurada)', async () => {
      const ind = await linha(
        `SELECT i.id, v.id AS v FROM indicador i JOIN indicador_versao v ON v.indicador_id = i.id WHERE i.codigo = ?`,
        [COD],
      );
      const apuracao = (comp: string, fim: string, situacao: string, valor: number) =>
        executar(
          `INSERT INTO apuracao_indicador (estabelecimento_id, indicador_id, indicador_versao_id, competencia, periodo_inicio,
             periodo_fim, numerador, denominador, valor, situacao_meta, situacao, fechada_em, fechada_por_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 7, 1000, ?, 'fora_da_meta', ?, ?, ?, NOW(3))`,
          [
            m.est,
            ind?.['id'],
            ind?.['v'],
            `${comp}-01`,
            `${comp}-01`,
            fim,
            valor,
            situacao,
            situacao === 'fechada' ? '2026-09-05 08:00:00' : null,
            situacao === 'fechada' ? m.gestor : null,
          ],
        );
      await apuracao('2026-07', '2026-07-31', 'cancelada', 7);
      await apuracao('2026-08', '2026-08-31', 'fechada', 9);
      await apuracao('2026-09', '2026-09-30', 'previa', 7);
      expect(
        await codigoDe(gravar((g) => g.registrarAnaliseIndicador(analise({ competencia: '2026-07' })))),
      ).toMatch(/:apuracao-cancelada$/);
      await gravar((g) => g.registrarAnaliseIndicador(analise({ competencia: '2026-08' })));
      const fechada = await linha(
        `SELECT ap.valor, ap.versao, ap.fechada_por_usuario_id AS por, COUNT(a.id) AS analises FROM apuracao_indicador ap
           LEFT JOIN analise_critica_indicador a ON a.apuracao_indicador_id = ap.id
          WHERE ap.estabelecimento_id = ? AND ap.indicador_id = ? AND ap.competencia = '2026-08-01' GROUP BY ap.id`,
        [m.est, ind?.['id']],
      );
      expect([
        Number(fechada?.['valor']),
        Number(fechada?.['versao']),
        Number(fechada?.['analises']),
      ]).toEqual([9, 1, 1]);
      expect(Number(fechada?.['por'])).toBe(m.gestor);
      await gravar((g) => g.registrarAnaliseIndicador(analise({ competencia: '2026-09' })));
      const previa = await linha(
        `SELECT valor, situacao, versao, fechada_por_usuario_id AS por FROM apuracao_indicador
          WHERE estabelecimento_id = ? AND indicador_id = ? AND competencia = '2026-09-01'`,
        [m.est, ind?.['id']],
      );
      expect(previa).toMatchObject({ situacao: 'fechada' });
      expect([Number(previa?.['valor']), Number(previa?.['versao']), Number(previa?.['por'])]).toEqual([
        2.4,
        2,
        m.usuario,
      ]);
      const anterior = await naTrilha('apuracaoAnterior');
      expect(anterior).toMatchObject({ situacao: 'previa', versao: 1 });
      expect(Number(anterior?.['valor'])).toBe(7);
    });

    it('registrarAuditoria: número, categoria, setor, auditor líder, checklist e percentual', async () => {
      const base = {
        titulo: `Auditoria sintética Q6 ${NUM} com título longo `.padEnd(180, 'x'),
        area: setorNome,
        referencial: 'ona',
        realizadaEm: '2026-11-05',
        auditores: 'Equipe sintética',
        itens: checklist(4),
        conformes: 1,
        parciais: 1,
        naoConformes: 1,
        naoAplicaveis: 1,
        conformidade: 50,
        conclusao: 'Conclusão sintética da auditoria.',
        agora: AGORA,
        usuario: m.login,
      };
      expect(
        await codigoDe(gravar((g) => g.registrarAuditoria({ ...base, area: `Sem setor ${NUM}` }))),
      ).toMatch(/:area-inexistente$/);
      const r = await gravar((g) => g.registrarAuditoria(base));
      auditoriaId = r.id;
      const a = await linha(
        `SELECT a.numero, a.situacao, a.setor_funcional_id, a.auditor_lider_usuario_id, a.percentual_conformidade,
                a.fechada_em IS NOT NULL AS fechada, ca.codigo AS cat, CHAR_LENGTH(a.titulo) AS tam,
                (SELECT COUNT(*) FROM auditoria_interna_auditor x WHERE x.auditoria_interna_id = a.id AND x.papel = 'auditor_lider') AS lider
           FROM auditoria_interna a JOIN categoria_auditoria_interna ca ON ca.id = a.categoria_auditoria_interna_id
          WHERE a.id = ?`,
        [auditoriaId],
      );
      expect(String(a?.['numero'])).toMatch(/^AUD-2026-\d{6}$/);
      expect(a).toMatchObject({
        situacao: 'concluida',
        setor_funcional_id: m.setor,
        auditor_lider_usuario_id: m.usuario,
        cat: 'ona',
        tam: 180,
        lider: 1,
      });
      expect(Number(a?.['fechada'])).toBe(1);
      expect(Number(a?.['percentual_conformidade'])).toBe(50);
      const lida = await new LeiturasGestaoComplementoQ5(m.nucleo).auditoria(c, auditoriaId);
      expect(lida).toMatchObject({ referencial: 'ona', area: setorNome, conformes: 1, naoAplicaveis: 1 });
      expect(JSON.parse(lida!.itens)).toEqual([
        {
          requisito: 'Pulseira de identificação',
          secao: 'Identificação',
          resultado: 'conforme',
          evidencia: null,
        },
        {
          requisito: 'Dupla checagem',
          secao: 'Medicamentos',
          resultado: 'naoConforme',
          evidencia: 'Sem registro',
        },
        { requisito: 'Bomba de infusão', secao: null, resultado: 'naoAplicavel', evidencia: null },
        { requisito: 'Escala de risco', secao: 'Quedas', resultado: 'parcial', evidencia: 'Feita em metade' },
      ]);
    });

    it('alterarAuditoria: confere a versão, reescreve o checklist e guarda a versão anterior na trilha', async () => {
      const mudanca = {
        id: auditoriaId,
        versao: 1,
        titulo: 'Auditoria sintética Q6 corrigida',
        area: setorNome,
        realizadaEm: '2026-11-04',
        auditores: 'Equipe sintética revisada',
        itens: checklist(2),
        contagens: { conformes: 1, parciais: 0, naoConformes: 1, naoAplicaveis: 0, conformidade: 50 },
        conclusao: 'Conclusão revisada da auditoria.',
        justificativa: 'Checklist lançado com itens a mais',
        agora: '2026-11-10T11:00:00',
        usuario: m.login,
      };
      expect(await codigoDe(gravar((g) => g.alterarAuditoria({ ...mudanca, versao: 7 })))).toMatch(/^409:/);
      // Outro estabelecimento não alcança a auditoria deste.
      expect(await codigoDe(gravar((g) => g.alterarAuditoria(mudanca), cOutro))).toMatch(/^409:/);
      expect(await gravar((g) => g.alterarAuditoria(mudanca))).toEqual({ versao: 2 });
      const itens = await linha(
        `SELECT SUM(excluido_em IS NULL) AS ativos, SUM(excluido_em IS NOT NULL) AS excluidos
           FROM auditoria_interna_item WHERE auditoria_interna_id = ?`,
        [auditoriaId],
      );
      expect([Number(itens?.['ativos']), Number(itens?.['excluidos'])]).toEqual([2, 2]);
      const a = await linha(
        "SELECT titulo, percentual_conformidade, DATE_FORMAT(inicio_realizado, '%Y-%m-%d') AS ini FROM auditoria_interna WHERE id = ?",
        [auditoriaId],
      );
      expect(a).toMatchObject({ titulo: 'Auditoria sintética Q6 corrigida', ini: '2026-11-04' });
      expect(Number(a?.['percentual_conformidade'])).toBe(50);
      // O item que não mudou guarda o respondente e o instante originais.
      const item1 = await linha(
        "SELECT DATE_FORMAT(respondido_em, '%H:%i') AS h, versao FROM auditoria_interna_item WHERE auditoria_interna_id = ? AND sequencia = 1",
        [auditoriaId],
      );
      expect(item1).toMatchObject({ h: '10:00', versao: 1 });
      const v = await new LeiturasGestaoComplementoD(m.nucleo).versoes(c, 'auditoria_interna', auditoriaId);
      expect(v.length).toBeGreaterThanOrEqual(1);
      expect(v[0]).toMatchObject({ versao: 1 });
      const ant = (await naTrilha('versaoAnterior')) as { dados: Record<string, unknown> } | null;
      expect(ant?.dados).toMatchObject({ auditores_descricao: 'Equipe sintética' });
      expect(String(ant?.dados['titulo'])).toMatch(/^Auditoria sintética Q6 \d+ com título longo/);
      const checklistAnterior = ant?.dados['checklist'] as Record<string, unknown>[];
      expect(
        checklistAnterior.map((x) => [x['sequencia'], x['resultado'], Number(x['respondente_usuario_id'])]),
      ).toEqual([
        [1, 'conforme', m.usuario],
        [2, 'nao_conforme', m.usuario],
        [3, 'nao_se_aplica', m.usuario],
        [4, 'parcial', m.usuario],
      ]);
      expect(checklistAnterior[0]).toHaveProperty('respondido_em');
      expect(Number(checklistAnterior[1]?.['exige_acao'])).toBe(1);
      // Voltar a 4 itens reaproveita as sequências excluídas (nada é apagado).
      expect(await gravar((g) => g.alterarAuditoria({ ...mudanca, versao: 2, itens: checklist(4) }))).toEqual(
        {
          versao: 3,
        },
      );
      const todos = await linha(
        'SELECT COUNT(*) AS n, SUM(excluido_em IS NULL) AS ativos FROM auditoria_interna_item WHERE auditoria_interna_id = ?',
        [auditoriaId],
      );
      expect([Number(todos?.['n']), Number(todos?.['ativos'])]).toEqual([4, 4]);
    });
  },
);
