// Complemento Q5 da porta PRÓPRIA da gestão da qualidade (fecho-1, família qualidade-resto): o que restou recusando
// no ramo próprio depois dos complementos Q1 a Q4, com o mesmo contrato da porta de memória (ordem, nulo para o
// inexistente, versão conferida e a versão anterior na trilha da mesma operação).
// Leituras:
// - analises: as análises críticas da competência (a última análise de cada indicador, pela consulta do Q2);
// - auditorias/auditoria: auditoria_interna com a área (setor_funcional), o referencial (código da
//   categoria_auditoria_interna), os auditores em texto (auditores_descricao), o checklist (auditoria_interna_item, no
//   JSON do contrato: requisito, seção, resultado e evidência), as contagens e a conclusão (fechamento); a cancelada
//   aparece com o instante e o motivo (inativa, nunca apagada);
// - loginsDosMedicos: o login do vínculo vigente usuario_profissional de cada profissional ('' sem login);
// - sorteiosRevisao/sorteioRevisao: sorteio_revisao_prontuario; o checklist do sorteio é a versão do checklist das
//   revisões da amostra (revisao_prontuario.modelo_checklist_qualidade_versao_id, gravada com a amostra no sorteio);
//   o cancelamento é o da situação 'cancelado' (o motivo em justificativa, o instante e quem em alterado_em/_por);
//   revisados são as revisões com revisada_em;
// - revisoesDaCompetencia/revisoesDaInternacao: as revisões dos sorteios não cancelados (a consulta do Q3).
// Gravações (dentro da transação da gestão; a recusa desfaz tudo):
// - avalRevisao: a revisão concluída, sem aval e sem pendência aberta, vai a 'avalizada' (CHECK ck_revisao_prontuario_aval);
// - cancelarPendenciaRevisao: a pendência aberta vai a 'cancelada' (o motivo em resolucao, o instante e quem em
//   resolvida_em/_por, que a leitura do Q3 lê como cancelamento);
// - cancelarReuniao: a reunião não cancelada, sem ata assinada nem assinatura anterior, vai a 'cancelada';
// - cancelarNaoConformidade: a não conformidade aberta vai a 'cancelada' com o motivo, quem e a duplicada (do mesmo
//   estabelecimento, ativa e diferente dela); recusa `com-dependentes` quando outra não conformidade ativa a aponta
//   como duplicada. O evento da situação não leva 'cancelada' (CHECK do evento): o cancelamento fica na trilha.
// Os cancelamentos guardam a linha anterior em anotacao.dados.versaoAnterior (ação `cancelamento`), que `versoes` lê;
// o aval não versiona (como na memória): fica na trilha da operação.
// Ligação (integrador): a porta completa delega as leituras de METODOS_COMPLEMENTO_Q5 a LeiturasGestaoComplementoQ5,
// espalha gravacoesComplementoQ5(tx, est, anotacao) no gravador e soma TABELAS_COMPLEMENTO_Q5 às tabelas.
import { recusa, type TxOperacao } from '@sgh/nucleo';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import {
  camelo,
  dataIso,
  exigirUsuario,
  instante,
  instanteN,
  type L,
  type Linha,
  lerNoEstabelecimento,
  marcas,
  n,
  type NucleoQualidade,
  paraBanco,
  texto,
  textoN,
} from './apoio-propria.js';
import type { ContextoGestao, GravadorGestao, MudancaGestao, MudancaRevisao } from './porta-gestao.js';
import { analise, SQL_ANALISE } from './porta-propria-complemento-q2.js';
import { prontuarios, SQL_PRONTUARIO } from './porta-propria-complemento-q3.js';
import {
  type AcaoVersao,
  type AnaliseIndicadorRegistrada,
  type AuditoriaRegistrada,
  type PaginaGestao,
  type ProntuarioRevisaoRegistrado,
  recusaVersaoGestao,
  type SorteioRevisaoRegistrado,
  type TabelaCorrigivel,
} from './tipos.js';

/** Os métodos da porta da gestão que este complemento cobre (a ligação na porta completa é do integrador). */
export const METODOS_COMPLEMENTO_Q5 = [
  'analises',
  'auditorias',
  'auditoria',
  'loginsDosMedicos',
  'sorteiosRevisao',
  'sorteioRevisao',
  'revisoesDaCompetencia',
  'revisoesDaInternacao',
  'avalRevisao',
  'cancelarPendenciaRevisao',
  'cancelarReuniao',
  'cancelarNaoConformidade',
] as const;

/** As tabelas que as gravações deste complemento escrevem (somadas às da porta completa pelo integrador). */
export const TABELAS_COMPLEMENTO_Q5 = [
  'revisao_prontuario',
  'pendencia_prontuario',
  'reuniao_comissao',
  'nao_conformidade_qualidade',
] as const;

/** Tetos de leitura (os do uso real ficam muito abaixo). */
export const TETO_ANALISES = 2000;
export const TETO_SORTEIOS = 5000;
export const TETO_REVISOES = 20_000;
const LOTE_IDS = 500;

/** A competência do contrato (AAAA-MM) como o banco guarda (o primeiro dia do mês). */
const competenciaBanco = (c: string): string => `${c.slice(0, 7)}-01`;

// ── Auditorias ──────────────────────────────────────────────────────────────────────────────────────────────

const SQL_AUDITORIA = `
  SELECT a.id, a.titulo, sf.nome AS area, ca.codigo AS referencial, a.inicio_realizado, a.inicio_previsto,
         a.auditores_descricao, a.itens_conformes, a.itens_parciais, a.itens_nao_conformes, a.itens_nao_aplicaveis,
         a.fechamento, uc.login AS registrada_por, a.criado_em, a.versao, a.cancelada_em, a.motivo_cancelamento
    FROM auditoria_interna a
    JOIN categoria_auditoria_interna ca ON ca.id = a.categoria_auditoria_interna_id
    LEFT JOIN setor_funcional sf ON sf.id = a.setor_funcional_id
    LEFT JOIN usuario uc ON uc.id = a.criado_por
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

/** O resultado do item no banco (CHECK ck_auditoria_interna_item_resultado) no vocabulário do contrato. */
const RESULTADO_ITEM: Readonly<Record<string, string>> = {
  conforme: 'conforme',
  parcial: 'parcial',
  nao_conforme: 'naoConforme',
  nao_se_aplica: 'naoAplicavel',
};

export function auditoriaDaLinha(r: Linha, itens: string): AuditoriaRegistrada {
  return {
    id: n(r['id']),
    titulo: texto(r['titulo']),
    area: texto(r['area']),
    referencial: camelo(r['referencial']),
    realizadaEm: dataIso(r['inicio_realizado'] ?? r['inicio_previsto']) ?? '',
    auditores: texto(r['auditores_descricao']),
    itens,
    conformes: n(r['itens_conformes']),
    parciais: n(r['itens_parciais']),
    naoConformes: n(r['itens_nao_conformes']),
    naoAplicaveis: n(r['itens_nao_aplicaveis']),
    conclusao: texto(r['fechamento']),
    registradaPor: texto(r['registrada_por']),
    registradaEm: instante(r['criado_em']),
    versao: n(r['versao']),
    canceladaEm: instanteN(r['cancelada_em']),
    motivoCancelamento: textoN(r['motivo_cancelamento']),
  };
}

/** O checklist de cada auditoria (JSON do contrato, na ordem da sequência). */
async function itensDasAuditorias(l: L, ids: readonly number[]): Promise<Map<number, string>> {
  type Item = { requisito: string; secao: null; resultado: string; evidencia: string | null };
  const porAuditoria = new Map<number, Item[]>(ids.map((id) => [id, []]));
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const lote = ids.slice(i, i + LOTE_IDS);
    const linhas = await l.consultar(
      `SELECT auditoria_interna_id AS a, pergunta, resultado, evidencia
         FROM auditoria_interna_item
        WHERE auditoria_interna_id IN (${marcas(lote.length)}) AND excluido_em IS NULL
        ORDER BY auditoria_interna_id, sequencia`,
      lote,
      { teto: lote.length * 150 + 1 },
    );
    for (const x of linhas)
      porAuditoria.get(n(x['a']))?.push({
        requisito: texto(x['pergunta']),
        secao: null,
        resultado: RESULTADO_ITEM[texto(x['resultado'])] ?? 'naoAplicavel',
        evidencia: textoN(x['evidencia']),
      });
  }
  return new Map([...porAuditoria].map(([k, v]) => [k, JSON.stringify(v)]));
}

async function auditoriasDas(l: L, linhas: Linha[]): Promise<AuditoriaRegistrada[]> {
  const itens = await itensDasAuditorias(
    l,
    linhas.map((r) => n(r['id'])),
  );
  return linhas.map((r) => auditoriaDaLinha(r, itens.get(n(r['id'])) ?? '[]'));
}

// ── Sorteios da revisão ─────────────────────────────────────────────────────────────────────────────────────

const SQL_SORTEIO = `
  SELECT x.*, v.numero_versao AS checklist_revisao
    FROM (SELECT s.id, s.comissao_hospitalar_id, DATE_FORMAT(s.competencia, '%Y-%m') AS competencia, s.semente,
                 s.quantidade, s.universo_quantidade, s.hash_universo, us.login AS sorteado_por, s.sorteado_em,
                 s.situacao, s.justificativa, s.alterado_em, ua.login AS alterado_por_login, s.versao,
                 (SELECT MIN(r.modelo_checklist_qualidade_versao_id) FROM revisao_prontuario r
                   WHERE r.sorteio_revisao_prontuario_id = s.id AND r.excluido_em IS NULL) AS checklist,
                 (SELECT COUNT(*) FROM revisao_prontuario r
                   WHERE r.sorteio_revisao_prontuario_id = s.id AND r.excluido_em IS NULL
                     AND r.revisada_em IS NOT NULL) AS revisados
            FROM sorteio_revisao_prontuario s
            JOIN usuario us ON us.id = s.sorteado_por_usuario_id
            LEFT JOIN usuario ua ON ua.id = s.alterado_por
           WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL) x
    LEFT JOIN modelo_checklist_qualidade_versao v ON v.id = x.checklist`;

export function sorteioDaLinha(r: Linha): SorteioRevisaoRegistrado {
  const cancelado = texto(r['situacao']) === 'cancelado';
  return {
    id: n(r['id']),
    comissao: n(r['comissao_hospitalar_id']),
    checklist: n(r['checklist']),
    checklistRevisao: n(r['checklist_revisao']),
    competencia: texto(r['competencia']),
    semente: texto(r['semente']),
    quantidade: n(r['quantidade']),
    universo: n(r['universo_quantidade']),
    resumoUniverso: texto(r['hash_universo']),
    sorteadoPor: texto(r['sorteado_por']),
    sorteadoEm: instante(r['sorteado_em']),
    canceladoEm: cancelado ? instanteN(r['alterado_em']) : null,
    canceladoPor: cancelado ? textoN(r['alterado_por_login']) : null,
    motivoCancelamento: cancelado ? textoN(r['justificativa']) : null,
    revisados: n(r['revisados']),
    versao: n(r['versao']),
  };
}

/** Os sorteios ativos (não cancelados) do estabelecimento, para filtrar as revisões. */
const SORTEIOS_ATIVOS = `SELECT s.id FROM sorteio_revisao_prontuario s
  WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.situacao <> 'cancelado'`;

/** As leituras do Q5 (a porta completa delega). */
export class LeiturasGestaoComplementoQ5 {
  constructor(private readonly nucleo: NucleoQualidade) {}

  private ler<T>(c: ContextoGestao, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  analises(c: ContextoGestao, competencia: string): Promise<AnaliseIndicadorRegistrada[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_ANALISE} AND ap.competencia = ? ORDER BY i.codigo, a.id`,
          [est, competenciaBanco(competencia)],
          { teto: TETO_ANALISES },
        )
      ).map(analise),
    );
  }

  auditorias(
    c: ContextoGestao,
    f: { pagina: number; porPagina: number },
  ): Promise<PaginaGestao<AuditoriaRegistrada>> {
    return this.ler(c, async (l, est) => {
      const t = await l.uma(`SELECT COUNT(*) AS total FROM (${SQL_AUDITORIA}) x`, [est]);
      const porPagina = Math.max(1, Math.trunc(f.porPagina));
      const pagina = Math.max(1, Math.trunc(f.pagina));
      const linhas = await l.consultar(
        `${SQL_AUDITORIA} ORDER BY COALESCE(a.inicio_realizado, a.inicio_previsto) DESC, a.id DESC
          LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
        [est],
        { teto: porPagina },
      );
      return { itens: await auditoriasDas(l, linhas), total: n(t?.['total']) };
    });
  }

  auditoria(c: ContextoGestao, id: number): Promise<AuditoriaRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_AUDITORIA} AND a.id = ?`, [est, id]);
      return r ? ((await auditoriasDas(l, [r]))[0] ?? null) : null;
    });
  }

  loginsDosMedicos(c: ContextoGestao, registros: readonly number[]): Promise<Map<number, string>> {
    return this.ler(c, async (l) => {
      const m = new Map<number, string>(registros.map((r) => [r, '']));
      const ids = [...new Set(registros)];
      for (let i = 0; i < ids.length; i += LOTE_IDS) {
        const lote = ids.slice(i, i + LOTE_IDS);
        const linhas = await l.consultar(
          `SELECT up.profissional_id AS p, u.login
             FROM usuario_profissional up
             JOIN usuario u ON u.id = up.usuario_id AND u.excluido_em IS NULL
            WHERE up.profissional_id IN (${marcas(lote.length)})
              AND up.vigencia_fim IS NULL AND up.excluido_em IS NULL
            ORDER BY up.profissional_id, up.id DESC`,
          lote,
          { teto: lote.length * 20 + 1 },
        );
        const vistos = new Set<number>();
        for (const x of linhas) {
          const p = n(x['p']);
          if (vistos.has(p)) continue;
          vistos.add(p);
          m.set(p, texto(x['login']));
        }
      }
      return m;
    });
  }

  sorteiosRevisao(c: ContextoGestao, comissao: number): Promise<SorteioRevisaoRegistrado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_SORTEIO} WHERE x.comissao_hospitalar_id = ? ORDER BY x.competencia DESC, x.id DESC`,
          [est, comissao],
          { teto: TETO_SORTEIOS },
        )
      ).map(sorteioDaLinha),
    );
  }

  sorteioRevisao(c: ContextoGestao, id: number): Promise<SorteioRevisaoRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_SORTEIO} WHERE x.id = ?`, [est, id]);
      return r ? sorteioDaLinha(r) : null;
    });
  }

  revisoesDaCompetencia(
    c: ContextoGestao,
    comissao: number,
    competencia: string,
  ): Promise<ProntuarioRevisaoRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT x.* FROM (${SQL_PRONTUARIO}
            AND r.sorteio_revisao_prontuario_id IN (${SORTEIOS_ATIVOS}
                AND s.comissao_hospitalar_id = ? AND s.competencia = ?)) x
          ORDER BY x.sorteio, x.ordem`,
        [est, est, comissao, competenciaBanco(competencia)],
        { teto: TETO_REVISOES },
      );
      return prontuarios(l, linhas);
    });
  }

  revisoesDaInternacao(c: ContextoGestao, reg: number): Promise<ProntuarioRevisaoRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT x.* FROM (${SQL_PRONTUARIO}
            AND r.sorteio_revisao_prontuario_id IN (${SORTEIOS_ATIVOS}
                AND EXISTS (SELECT 1 FROM revisao_prontuario r2
                             WHERE r2.sorteio_revisao_prontuario_id = s.id AND r2.atendimento_id = ?
                               AND r2.excluido_em IS NULL))) x
          WHERE x.atendimento_id = ?
          ORDER BY x.id DESC`,
        [est, est, reg, reg],
        { teto: TETO_REVISOES },
      );
      return prontuarios(l, linhas);
    });
  }
}

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────────────

/** A linha como estava (datas no formato local), para a versão anterior na trilha. */
function retrato(r: Linha): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? instante(v) : v]));
}

function anotarVersao(
  anotacao: AnotacaoGravacao,
  tabela: TabelaCorrigivel,
  antes: Linha,
  acao: AcaoVersao,
  motivo: string,
): void {
  anotacao.motivo = motivo;
  anotacao.dados = {
    ...(anotacao.dados ?? {}),
    versaoAnterior: {
      tabela,
      id: n(antes['id']),
      versao: n(antes['versao']),
      acao,
      motivo,
      dados: retrato(antes),
    },
  };
}

/** A situação aberta da pendência no banco (a leitura do Q3 lê 'aberta' e 'em_resolucao' como aberta). */
const PENDENCIA_ABERTA = ['aberta', 'em_resolucao'];

type GravacoesQ5 = Pick<
  GravadorGestao,
  'avalRevisao' | 'cancelarPendenciaRevisao' | 'cancelarReuniao' | 'cancelarNaoConformidade'
>;

/**
 * As gravações do Q5 dentro da transação da gestão (o integrador espalha o resultado no gravador da porta completa e
 * soma `TABELAS_COMPLEMENTO_Q5` às tabelas dela).
 */
export function gravacoesComplementoQ5(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao = { motivo: null, dados: null },
): GravacoesQ5 {
  return {
    avalRevisao: async (a) => {
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        `SELECT * FROM revisao_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [a.id, est],
        { teto: 1 },
      );
      if (
        !antes ||
        n(antes['versao']) !== a.versao ||
        antes['revisada_em'] === null ||
        antes['avalizada_em'] !== null ||
        texto(antes['situacao']) !== 'concluida'
      )
        throw recusaVersaoGestao('O prontuário');
      const aberta = await tx.uma(
        `SELECT p.id FROM pendencia_prontuario p
           JOIN revisao_prontuario_item ri ON ri.pendencia_prontuario_id = p.id AND ri.excluido_em IS NULL
          WHERE ri.revisao_prontuario_id = ? AND p.excluido_em IS NULL
            AND p.situacao IN (${marcas(PENDENCIA_ABERTA.length)})
          LIMIT 1`,
        [a.id, ...PENDENCIA_ABERTA],
      );
      if (aberta) throw recusaVersaoGestao('O prontuário');
      const usuario = await exigirUsuario(tx, a.usuario);
      const versao = await tx.alterar('revisao_prontuario', a.id, a.versao, {
        situacao: 'avalizada',
        avalizada_em: paraBanco(a.agora),
        avalizada_por_usuario_id: usuario,
      });
      return { versao };
    },

    cancelarPendenciaRevisao: async (m: MudancaRevisao) => {
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        `SELECT p.* FROM pendencia_prontuario p
          WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
            AND EXISTS (SELECT 1 FROM revisao_prontuario_item ri WHERE ri.pendencia_prontuario_id = p.id)`,
        [m.id, est],
        { teto: 1 },
      );
      if (!antes || n(antes['versao']) !== m.versao || !PENDENCIA_ABERTA.includes(texto(antes['situacao'])))
        throw recusaVersaoGestao('A pendência');
      const usuario = await exigirUsuario(tx, m.usuario);
      const versao = await tx.alterar('pendencia_prontuario', m.id, m.versao, {
        situacao: 'cancelada',
        resolucao: m.motivo,
        resolvida_em: paraBanco(m.agora),
        resolvida_por_usuario_id: usuario,
      });
      anotarVersao(anotacao, 'pendencia_prontuario', antes, 'cancelamento', m.motivo);
      return { versao };
    },

    cancelarReuniao: async (r: MudancaGestao) => {
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        `SELECT r.* FROM reuniao_comissao r
           JOIN comissao_hospitalar c ON c.id = r.comissao_hospitalar_id
          WHERE r.id = ? AND c.estabelecimento_id = ? AND r.excluido_em IS NULL`,
        [r.id, est],
        { teto: 1 },
      );
      if (
        !antes ||
        n(antes['versao']) !== r.versao ||
        antes['cancelada_em'] !== null ||
        texto(antes['situacao']) === 'cancelada' ||
        antes['ata_assinada_em'] !== null ||
        antes['assinatura_anterior_em'] !== null
      )
        throw recusaVersaoGestao('A reunião');
      await exigirUsuario(tx, r.usuario);
      const versao = await tx.alterar('reuniao_comissao', r.id, r.versao, {
        situacao: 'cancelada',
        cancelada_em: paraBanco(r.agora),
        motivo_cancelamento: r.justificativa,
      });
      anotarVersao(anotacao, 'reuniao_comissao', antes, 'cancelamento', r.justificativa);
      return { versao };
    },

    cancelarNaoConformidade: async (x) => {
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        `SELECT * FROM nao_conformidade_qualidade WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [x.id, est],
        { teto: 1 },
      );
      if (
        !antes ||
        n(antes['versao']) !== x.versao ||
        antes['cancelada_em'] !== null ||
        texto(antes['situacao']) !== 'aberta'
      )
        throw recusaVersaoGestao('A não conformidade');
      if (x.duplicadaDe !== null) {
        const d =
          x.duplicadaDe === x.id
            ? null
            : await tx.uma(
                `SELECT id FROM nao_conformidade_qualidade
                  WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'`,
                [x.duplicadaDe, est],
              );
        if (!d)
          throw recusa(
            'duplicada-inexistente',
            'A não conformidade original não existe neste estabelecimento, está cancelada ou é a própria.',
          );
      }
      const dependente = await tx.uma(
        `SELECT id FROM nao_conformidade_qualidade
          WHERE duplicada_de_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
          LIMIT 1`,
        [x.id, est],
      );
      if (dependente)
        throw recusa(
          'com-dependentes',
          'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
        );
      const usuario = await exigirUsuario(tx, x.usuario);
      const versao = await tx.alterar('nao_conformidade_qualidade', x.id, x.versao, {
        situacao: 'cancelada',
        cancelada_em: paraBanco(x.agora),
        cancelada_por_usuario_id: usuario,
        motivo_cancelamento: x.justificativa,
        duplicada_de_id: x.duplicadaDe,
      });
      anotarVersao(anotacao, 'nao_conformidade_qualidade', antes, 'cancelamento', x.justificativa);
      return { versao };
    },
  };
}
