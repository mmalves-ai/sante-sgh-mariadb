// F8, 07-FIN linha 127 (C2-101): consolidação gerencial de várias empresas no banco próprio, pelo executor do
// @sgh/nucleo (trilha, outbox e idempotência na mesma transação). As regras são do @sgh/dominio-contabil
// (consolidacao.ts); aqui ficam a leitura e a gravação nas tabelas do modelo:
//   grupo_consolidacao (grupo, vigência, eliminação ligada) e empresa_grupo_consolidacao (membros, participação,
//   método e consolidadora; quem sai do grupo fica com o fim da vigência, nada é apagado);
//   plano_contas (o plano gerencial comum do grupo, tipo gerencial) e conta_gerencial_consolidada (as contas por
//   exercício);
//   depara_conta_gerencial (conta contábil do membro → conta gerencial; a ligação trocada fica inativa);
//   apuracao_consolidacao (a rodada mensal; a refeita aponta a anterior, que fica cancelada), eliminacao_consolidacao
//   (os lançamentos de eliminação), transacao_intercompanhia (fica eliminada na rodada) e saldo_consolidado_mensal
//   (o saldo por conta gerencial, por estabelecimento de origem e o total consolidado com as eliminações).
// As somas vêm das partidas gravadas (partida_contabil) dos lançamentos dos membros até a competência.
import {
  apurarConsolidacao,
  conferirApuracaoConsolidacao,
  conferirCompetenciaConsolidacao,
  conferirContaGerencial,
  conferirDeParaConsolidacao,
  conferirGrupoConsolidacao,
  type ContaGerencial,
  demonstracoesConsolidadas,
  METODOS_CONSOLIDACAO,
  type MembroGrupo,
  NATUREZAS_CONTA_GERENCIAL,
  type NaturezaContaGerencial,
  type NaturezaSaldo,
  type RecusaConsolidacao,
  type ResultadoApuracaoConsolidacao,
} from '@sgh/dominio-contabil';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const dia = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10));
const reais = (centavos: number): number => Math.round(centavos) / 100;
const diaUm = (c: string): string => `${c}-01`;
function ultimoDia(c: string): string {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
const ph = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
const NATUREZA_SALDO: Record<NaturezaContaGerencial, NaturezaSaldo> = {
  ativo: 'devedora',
  custo: 'devedora',
  despesa: 'devedora',
  compensacao: 'devedora',
  passivo: 'credora',
  patrimonio_liquido: 'credora',
  receita: 'credora',
  resultado: 'credora',
};

function recusar(r: RecusaConsolidacao | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────

interface Grupo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly planoContas: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly eliminaEntreEmpresas: boolean;
  readonly situacao: string;
  readonly observacao: string | null;
  readonly versao: number;
}

async function grupoDe(l: Leitor, grupo: number, travar = false): Promise<Grupo | null> {
  const sql = `SELECT id, codigo, nome, plano_contas_id, vigencia_inicio, vigencia_fim, elimina_intercompanhia, situacao,
      observacao, versao FROM grupo_consolidacao WHERE id = ? AND excluido_em IS NULL`;
  const r = travar
    ? (await (l as TxOperacao).consultarParaAtualizar(sql, [grupo]))[0]
    : await l.uma(sql, [grupo]);
  if (!r) return null;
  return {
    id: num(r['id']),
    codigo: txt(r['codigo']),
    nome: txt(r['nome']),
    planoContas: num(r['plano_contas_id']),
    vigenciaInicio: dia(r['vigencia_inicio']),
    vigenciaFim: r['vigencia_fim'] ? dia(r['vigencia_fim']) : null,
    eliminaEntreEmpresas: Boolean(num(r['elimina_intercompanhia'])),
    situacao: txt(r['situacao']),
    observacao: r['observacao'] == null ? null : txt(r['observacao']),
    versao: num(r['versao']),
  };
}

interface MembroLido extends MembroGrupo {
  readonly id: number;
  readonly nome: string;
  readonly versao: number;
}

/** Membros vigentes na data (fim da vigência nulo ou depois dela). */
async function membrosDe(l: Leitor, grupo: number, naData: string | null = null): Promise<MembroLido[]> {
  const rs = await l.consultar(
    `SELECT m.id, m.estabelecimento_id, m.percentual_participacao, m.metodo, m.consolidadora, m.versao,
        e.nome_fantasia FROM empresa_grupo_consolidacao m JOIN estabelecimento e ON e.id = m.estabelecimento_id
      WHERE m.grupo_consolidacao_id = ? AND m.excluido_em IS NULL
        AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= COALESCE(?, CURRENT_DATE))
        AND m.vigencia_inicio <= COALESCE(?, '9999-12-31')
      ORDER BY m.consolidadora DESC, e.nome_fantasia`,
    [grupo, naData, naData],
  );
  return rs.map((r) => ({
    id: num(r['id']),
    estabelecimento: num(r['estabelecimento_id']),
    nome: txt(r['nome_fantasia']),
    percentual: num(r['percentual_participacao']),
    metodo: txt(r['metodo']) as MembroGrupo['metodo'],
    consolidadora: Boolean(num(r['consolidadora'])),
    versao: num(r['versao']),
  }));
}

async function contasGerenciais(
  l: Leitor,
  exercicio: number,
): Promise<(ContaGerencial & { nivel: number })[]> {
  const rs = await l.consultar(
    `SELECT id, classificacao, descricao, natureza, natureza_saldo, tipo, nivel FROM conta_gerencial_consolidada
      WHERE exercicio = ? AND excluido_em IS NULL AND ativo = TRUE ORDER BY classificacao`,
    [exercicio],
  );
  return rs.map((r) => ({
    id: num(r['id']),
    classificacao: txt(r['classificacao']),
    descricao: txt(r['descricao']),
    natureza: txt(r['natureza']) as NaturezaContaGerencial,
    naturezaSaldo: txt(r['natureza_saldo']) as NaturezaSaldo,
    tipo: txt(r['tipo']) as 'sintetica' | 'analitica',
    nivel: num(r['nivel']),
  }));
}

async function deParaDe(l: Leitor, grupo: number): Promise<Map<number, number>> {
  const rs = await l.consultar(
    `SELECT conta_contabil_id, conta_gerencial_consolidada_id FROM depara_conta_gerencial
      WHERE grupo_consolidacao_id = ? AND ativo = TRUE`,
    [grupo],
  );
  return new Map(rs.map((r) => [num(r['conta_contabil_id']), num(r['conta_gerencial_consolidada_id'])]));
}

export async function apoioConsolidacao(l: Leitor) {
  const [estabelecimentos, grupos] = await Promise.all([
    l.consultar(
      'SELECT id, nome_fantasia FROM estabelecimento WHERE excluido_em IS NULL ORDER BY nome_fantasia LIMIT 500',
      [],
    ),
    l.consultar(
      `SELECT g.id, g.codigo, g.nome, g.situacao, (SELECT COUNT(*) FROM empresa_grupo_consolidacao m
          WHERE m.grupo_consolidacao_id = g.id AND m.excluido_em IS NULL AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= CURRENT_DATE)) AS membros
        FROM grupo_consolidacao g WHERE g.excluido_em IS NULL ORDER BY g.nome`,
      [],
    ),
  ]);
  return {
    estabelecimentos: estabelecimentos.map((r) => ({ id: num(r['id']), nome: txt(r['nome_fantasia']) })),
    grupos: grupos.map((r) => ({
      id: num(r['id']),
      codigo: txt(r['codigo']),
      nome: txt(r['nome']),
      situacao: txt(r['situacao']),
      membros: num(r['membros']),
    })),
    metodos: METODOS_CONSOLIDACAO,
    naturezas: NATUREZAS_CONTA_GERENCIAL,
  };
}

/** O grupo com os membros, as contas gerenciais do exercício e o de-para das contas analíticas dos membros. */
export async function detalheGrupoConsolidacao(l: Leitor, grupo: number, exercicio: number) {
  const g = await grupoDe(l, grupo);
  if (!g) return null;
  const membros = await membrosDe(l, grupo);
  const gerenciais = await contasGerenciais(l, exercicio);
  const ests = membros.map((m) => m.estabelecimento);
  const contas = ests.length
    ? await l.consultar(
        `SELECT DISTINCT k.id, k.classificacao, k.descricao, k.natureza, pe.estabelecimento_id, d.conta_gerencial_consolidada_id
           FROM periodo_contabil pe JOIN conta_contabil k ON k.plano_contas_id = pe.plano_contas_id
           LEFT JOIN depara_conta_gerencial d ON d.conta_contabil_id = k.id AND d.grupo_consolidacao_id = ? AND d.ativo = TRUE
          WHERE pe.estabelecimento_id IN (${ph(ests.length)}) AND pe.exercicio = ? AND pe.excluido_em IS NULL
            AND k.tipo = 'analitica' AND k.excluido_em IS NULL
          ORDER BY pe.estabelecimento_id, k.classificacao LIMIT 5000`,
        [grupo, ...ests, exercicio],
      )
    : [];
  const apuracoes = await l.consultar(
    `SELECT id, periodo_inicio, situacao, valor_total, liberado_em, versao FROM apuracao_consolidacao
      WHERE grupo_consolidacao_id = ? AND excluido_em IS NULL ORDER BY periodo_inicio DESC, id DESC LIMIT 36`,
    [grupo],
  );
  return {
    grupo: g,
    membros,
    gerenciais,
    depara: contas.map((r) => ({
      conta: num(r['id']),
      estabelecimento: num(r['estabelecimento_id']),
      classificacao: txt(r['classificacao']),
      descricao: txt(r['descricao']),
      natureza: txt(r['natureza']),
      gerencial: numOuNulo(r['conta_gerencial_consolidada_id']),
    })),
    apuracoes: apuracoes.map((r) => ({
      id: num(r['id']),
      competencia: dia(r['periodo_inicio']).slice(0, 7),
      situacao: txt(r['situacao']),
      eliminado: num(r['valor_total']),
      liberadoEm: r['liberado_em'] ? String(r['liberado_em']) : null,
      versao: num(r['versao']),
    })),
  };
}

/** Rodada vigente (apurada ou liberada) da competência. */
async function rodadaVigente(l: Leitor, grupo: number, comp: string, travar = false) {
  const sql = `SELECT id, situacao, versao FROM apuracao_consolidacao WHERE grupo_consolidacao_id = ? AND periodo_inicio = ?
      AND situacao IN ('apurada', 'liberada') AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`;
  const r = travar
    ? (await (l as TxOperacao).consultarParaAtualizar(sql, [grupo, diaUm(comp)]))[0]
    : await l.uma(sql, [grupo, diaUm(comp)]);
  return r ? { id: num(r['id']), situacao: txt(r['situacao']), versao: num(r['versao']) } : null;
}

/** Lê os dados e aplica a regra da apuração (a mesma conta na prévia e na gravação). */
async function calcular(
  l: Leitor,
  g: Grupo,
  comp: string,
  anterior: number | null,
): Promise<{
  membros: MembroLido[];
  r: ResultadoApuracaoConsolidacao;
  versoesTransacao: Map<number, number>;
}> {
  const membros = await membrosDe(l, g.id, ultimoDia(comp));
  const ests = membros.map((m) => m.estabelecimento);
  const depara = await deParaDe(l, g.id);
  const saldos = ests.length
    ? await l.consultar(
        `SELECT l.estabelecimento_id AS est, p.conta_contabil_id AS conta,
            ROUND(SUM(CASE WHEN pe.competencia < ? THEN IF(p.lado = 'debito', p.valor, -p.valor) ELSE 0 END) * 100) AS anterior,
            ROUND(SUM(CASE WHEN pe.competencia = ? AND p.lado = 'debito' THEN p.valor ELSE 0 END) * 100) AS debitos,
            ROUND(SUM(CASE WHEN pe.competencia = ? AND p.lado = 'credito' THEN p.valor ELSE 0 END) * 100) AS creditos,
            ROUND(SUM(CASE WHEN pe.competencia = ? AND p.lado = 'debito' AND l.tipo = 'apuracao' THEN p.valor ELSE 0 END) * 100) AS debitos_apuracao,
            ROUND(SUM(CASE WHEN pe.competencia = ? AND p.lado = 'credito' AND l.tipo = 'apuracao' THEN p.valor ELSE 0 END) * 100) AS creditos_apuracao
           FROM lancamento_contabil l
           JOIN periodo_contabil pe ON pe.id = l.periodo_contabil_id
           JOIN partida_contabil p ON p.lancamento_contabil_id = l.id AND p.excluido_em IS NULL
          WHERE l.estabelecimento_id IN (${ph(ests.length)}) AND l.excluido_em IS NULL AND pe.competencia <= ?
          GROUP BY l.estabelecimento_id, p.conta_contabil_id`,
        [...Array(5).fill(diaUm(comp)), ...ests, diaUm(comp)],
      )
    : [];
  const transacoes = ests.length
    ? await l.consultar(
        `SELECT id, estabelecimento_id, contraparte_estabelecimento_id, conta_contabil_id, contraparte_conta_contabil_id,
            ROUND(valor * 100) AS valor, versao FROM transacao_intercompanhia
          WHERE competencia = ? AND marcada_eliminacao = TRUE AND excluido_em IS NULL
            AND estabelecimento_id IN (${ph(ests.length)})
            AND (situacao IN ('aberta', 'conciliada') OR (situacao = 'eliminada' AND apuracao_consolidacao_id <=> ?))`,
        [diaUm(comp), ...ests, anterior ?? 0],
      )
    : [];
  const contasT = [
    ...new Set(
      transacoes.flatMap((t) => [num(t['conta_contabil_id']), numOuNulo(t['contraparte_conta_contabil_id'])]),
    ),
  ].filter((x): x is number => x !== null);
  const naturezas = contasT.length
    ? await l.consultar(
        `SELECT id, natureza_saldo FROM conta_contabil WHERE id IN (${ph(contasT.length)})`,
        contasT,
      )
    : [];
  const r = apurarConsolidacao({
    competencia: comp,
    membros,
    saldos: saldos.map((s) => ({
      estabelecimento: num(s['est']),
      conta: num(s['conta']),
      anterior: num(s['anterior']),
      debitos: num(s['debitos']),
      creditos: num(s['creditos']),
      debitosApuracao: num(s['debitos_apuracao']),
      creditosApuracao: num(s['creditos_apuracao']),
    })),
    depara,
    naturezaSaldo: new Map(naturezas.map((n) => [num(n['id']), txt(n['natureza_saldo']) as NaturezaSaldo])),
    transacoes: transacoes.map((t) => ({
      id: num(t['id']),
      estabelecimento: num(t['estabelecimento_id']),
      contraparte: num(t['contraparte_estabelecimento_id']),
      conta: num(t['conta_contabil_id']),
      contaContraparte: numOuNulo(t['contraparte_conta_contabil_id']),
      valor: num(t['valor']),
    })),
    eliminaEntreEmpresas: g.eliminaEntreEmpresas,
  });
  return { membros, r, versoesTransacao: new Map(transacoes.map((t) => [num(t['id']), num(t['versao'])])) };
}

async function nomesDeContas(l: Leitor, ids: readonly number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rs = await l.consultar(
    `SELECT id, classificacao, descricao FROM conta_contabil WHERE id IN (${ph(ids.length)})`,
    [...ids],
  );
  return new Map(rs.map((r) => [num(r['id']), `${txt(r['classificacao'])} ${txt(r['descricao'])}`]));
}

/** A prévia da apuração: totais por conta gerencial, eliminações e pendências, sem gravar. */
export async function previaConsolidacao(l: Leitor, grupo: number, comp: string) {
  recusar(conferirCompetenciaConsolidacao(comp));
  const g = await grupoDe(l, grupo);
  if (!g) return null;
  const vigente = await rodadaVigente(l, grupo, comp);
  const { membros, r } = await calcular(l, g, comp, vigente?.id ?? null);
  const gerenciais = new Map((await contasGerenciais(l, Number(comp.slice(0, 4)))).map((c) => [c.id, c]));
  const nomes = await nomesDeContas(l, [
    ...new Set([
      ...r.pendencias.flatMap((p) => (p.conta === null ? [] : [p.conta])),
      ...r.eliminacoes.flatMap((x) => [x.debitoConta, x.creditoConta]),
    ]),
  ]);
  const nomeEst = new Map(membros.map((m) => [m.estabelecimento, m.nome]));
  return {
    competencia: comp,
    rodadaVigente: vigente,
    membros: membros.map((m) => ({
      estabelecimento: m.estabelecimento,
      nome: m.nome,
      metodo: m.metodo,
      percentual: m.percentual,
    })),
    totais: r.linhas
      .filter((x) => x.origem === null)
      .map((x) => ({
        gerencial: x.gerencial,
        classificacao: gerenciais.get(x.gerencial)?.classificacao ?? '',
        descricao: gerenciais.get(x.gerencial)?.descricao ?? '',
        anterior: x.anterior,
        debitos: x.debitos,
        creditos: x.creditos,
        final: x.final,
        eliminado: x.eliminadoDebito - x.eliminadoCredito,
      })),
    eliminacoes: r.eliminacoes.map((x) => ({
      ...x,
      origemNome: nomeEst.get(x.origem) ?? '',
      contraparteNome: nomeEst.get(x.contraparte) ?? '',
      debitoNome: nomes.get(x.debitoConta) ?? '',
      creditoNome: nomes.get(x.creditoConta) ?? '',
    })),
    pendencias: r.pendencias.map((p) => ({
      ...p,
      estabelecimentoNome: nomeEst.get(p.estabelecimento) ?? '',
      contaNome: p.conta === null ? '' : (nomes.get(p.conta) ?? ''),
    })),
    totalEliminado: r.totalEliminado,
    conferencia: r.conferencia,
  };
}

/** DRE e balanço consolidados da competência, sobre os saldos gravados na apuração (total do grupo). */
export async function demonstracoesDoGrupo(l: Leitor, grupo: number, comp: string) {
  recusar(conferirCompetenciaConsolidacao(comp));
  const g = await grupoDe(l, grupo);
  if (!g) return null;
  const exercicio = Number(comp.slice(0, 4));
  const contas = await contasGerenciais(l, exercicio);
  const rs = await l.consultar(
    `SELECT conta_gerencial_consolidada_id, DATE_FORMAT(competencia, '%Y-%m') AS competencia,
        ROUND(total_debito_sem_apuracao * 100) AS d, ROUND(total_credito_sem_apuracao * 100) AS c,
        ROUND(saldo_final * 100) AS f
       FROM saldo_consolidado_mensal
      WHERE grupo_consolidacao_id = ? AND estabelecimento_origem_id IS NULL AND competencia BETWEEN ? AND ?`,
    [grupo, `${exercicio}-01-01`, diaUm(comp)],
  );
  const vigente = await rodadaVigente(l, grupo, comp);
  const { dre, balanco } = demonstracoesConsolidadas(
    contas,
    grupo,
    comp,
    rs.map((r) => ({
      gerencial: num(r['conta_gerencial_consolidada_id']),
      competencia: txt(r['competencia']),
      debitosSemApuracao: num(r['d']),
      creditosSemApuracao: num(r['c']),
      final: num(r['f']),
    })),
  );
  return { competencia: comp, rodada: vigente, dre, balanco };
}

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────

const esquemaMembro = z
  .object({
    estabelecimento: id,
    percentual: z.number().gt(0).max(100),
    metodo: z.enum(METODOS_CONSOLIDACAO),
    consolidadora: z.boolean(),
  })
  .strict();
const esquemaGrupo = z
  .object({
    grupo: id.nullable().default(null),
    versao: z.number().int().positive().nullable().default(null),
    codigo: z.string().trim().min(1).max(30),
    nome: z.string().trim().min(1).max(150),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
    eliminaEntreEmpresas: z.boolean().default(true),
    observacao: z.string().trim().max(500).nullable().default(null),
    membros: z.array(esquemaMembro).min(1).max(100),
  })
  .strict();
const esquemaConta = z
  .object({
    exercicio: z.number().int().min(1990).max(2200),
    classificacao: z.string().trim().min(1).max(40),
    descricao: z.string().trim().min(1).max(150),
    natureza: z.enum(NATUREZAS_CONTA_GERENCIAL),
    tipo: z.enum(['sintetica', 'analitica']),
  })
  .strict();
const esquemaDePara = z
  .object({
    grupo: id,
    itens: z
      .array(z.object({ conta: id, gerencial: id.nullable() }).strict())
      .min(1)
      .max(500),
  })
  .strict();
const esquemaApurar = z.object({ grupo: id, competencia }).strict();
const esquemaLiberar = z.object({ apuracao: id, versao: z.number().int().positive() }).strict();

const salvarGrupo = definirOperacao<z.infer<typeof esquemaGrupo>, ResultadoOperacao>({
  nome: 'contabil.consolidacao_grupo_salvar',
  tabelas: ['grupo_consolidacao', 'empresa_grupo_consolidacao', 'plano_contas'],
  entrada: esquemaGrupo as never,
  async gravar(tx, e) {
    recusar(conferirGrupoConsolidacao(e));
    const ests = e.membros.map((m) => m.estabelecimento);
    const validos = await tx.consultar(
      `SELECT id FROM estabelecimento WHERE excluido_em IS NULL AND id IN (${ph(ests.length)})`,
      ests,
    );
    if (validos.length !== ests.length)
      throw recusa('estabelecimento-inexistente', 'Um dos estabelecimentos não existe.', {
        campos: ['membros'],
      });
    const repetido = await tx.uma('SELECT id FROM grupo_consolidacao WHERE codigo = ? AND id <> ?', [
      e.codigo,
      e.grupo ?? 0,
    ]);
    if (repetido)
      throw recusa('codigo-repetido', 'Já existe um grupo com este código.', { campos: ['codigo'] });
    const valores = {
      codigo: e.codigo,
      nome: e.nome,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      elimina_intercompanhia: e.eliminaEntreEmpresas,
      observacao: e.observacao,
    };
    let grupo: number;
    if (e.grupo === null) {
      const moeda = await tx.uma('SELECT id FROM moeda ORDER BY moeda_nacional DESC, id LIMIT 1', []);
      if (!moeda) throw recusa('sem-moeda', 'Cadastre a moeda nacional antes do grupo.');
      // O plano gerencial comum do grupo nasce com ele (menos um passo para o usuário).
      const plano = await tx.incluir('plano_contas', {
        codigo: `GC-${e.codigo}`.slice(0, 20),
        descricao: `Plano gerencial ${e.nome}`.slice(0, 100),
        tipo: 'gerencial',
        mascara: '9.9.99.999',
        quantidade_niveis: 4,
        vigencia_inicio: e.vigenciaInicio,
      });
      grupo = await tx.incluir('grupo_consolidacao', {
        ...valores,
        moeda_id: num(moeda['id']),
        plano_contas_id: plano,
        situacao: 'ativo',
      });
      await tx.alterar('plano_contas', plano, 1, { grupo_consolidacao_id: grupo });
    } else {
      const g = await grupoDe(tx, e.grupo, true);
      if (!g) throw recusa('grupo-inexistente', 'O grupo não existe.', { campos: ['grupo'] });
      await tx.alterar('grupo_consolidacao', g.id, e.versao ?? g.versao, valores);
      grupo = g.id;
    }
    const atuais = await membrosDe(tx, grupo);
    const hoje = new Date().toISOString().slice(0, 10);
    const novos = new Map(e.membros.map((m) => [m.estabelecimento, m]));
    let saiu = 0;
    for (const a of atuais) {
      const n = novos.get(a.estabelecimento);
      if (!n) {
        // Quem sai fica no histórico com o fim da vigência.
        await tx.alterar('empresa_grupo_consolidacao', a.id, a.versao, { vigencia_fim: hoje });
        saiu++;
      } else if (
        n.percentual !== a.percentual ||
        n.metodo !== a.metodo ||
        n.consolidadora !== a.consolidadora
      )
        await tx.alterar('empresa_grupo_consolidacao', a.id, a.versao, {
          percentual_participacao: n.percentual,
          metodo: n.metodo,
          consolidadora: n.consolidadora,
        });
      novos.delete(a.estabelecimento);
    }
    for (const n of novos.values())
      await tx.incluir('empresa_grupo_consolidacao', {
        grupo_consolidacao_id: grupo,
        estabelecimento_id: n.estabelecimento,
        percentual_participacao: n.percentual,
        metodo: n.metodo,
        consolidadora: n.consolidadora,
        vigencia_inicio: e.grupo === null ? e.vigenciaInicio : hoje,
      });
    return { grupo, membros: e.membros.length, saiu };
  },
  alvo: (e, r) => ({ tabela: 'grupo_consolidacao', id: Number(r['grupo'] ?? e.grupo) }),
});

const incluirConta = definirOperacao<z.infer<typeof esquemaConta>, ResultadoOperacao>({
  nome: 'contabil.consolidacao_conta_gerencial_incluir',
  tabelas: ['conta_gerencial_consolidada'],
  entrada: esquemaConta as never,
  async gravar(tx, e) {
    const partes = e.classificacao.split('.');
    const pai =
      partes.length > 1
        ? await tx.uma(
            `SELECT id, classificacao, tipo, natureza FROM conta_gerencial_consolidada
              WHERE exercicio = ? AND classificacao = ? AND excluido_em IS NULL`,
            [e.exercicio, partes.slice(0, -1).join('.')],
          )
        : null;
    recusar(
      conferirContaGerencial({
        classificacao: e.classificacao,
        nivel: partes.length,
        natureza: e.natureza,
        pai: pai
          ? {
              classificacao: txt(pai['classificacao']),
              tipo: txt(pai['tipo']),
              natureza: txt(pai['natureza']),
            }
          : null,
      }),
    );
    const repetida = await tx.uma(
      'SELECT id FROM conta_gerencial_consolidada WHERE exercicio = ? AND classificacao = ?',
      [e.exercicio, e.classificacao],
    );
    if (repetida)
      throw recusa('conta-repetida', 'Esta classificação já existe no exercício.', {
        campos: ['classificacao'],
      });
    const conta = await tx.incluir('conta_gerencial_consolidada', {
      exercicio: e.exercicio,
      classificacao: e.classificacao,
      descricao: e.descricao,
      conta_pai_id: pai ? num(pai['id']) : null,
      nivel: partes.length,
      natureza: e.natureza,
      natureza_saldo: NATUREZA_SALDO[e.natureza],
      tipo: e.tipo,
    });
    return { conta };
  },
  alvo: (_e, r) => ({ tabela: 'conta_gerencial_consolidada', id: Number(r['conta']) }),
});

const salvarDePara = definirOperacao<z.infer<typeof esquemaDePara>, ResultadoOperacao>({
  nome: 'contabil.consolidacao_depara_salvar',
  tabelas: ['depara_conta_gerencial'],
  entrada: esquemaDePara as never,
  async gravar(tx, e) {
    const g = await grupoDe(tx, e.grupo, true);
    if (!g) throw recusa('grupo-inexistente', 'O grupo não existe.', { campos: ['grupo'] });
    const contas = e.itens.map((i) => i.conta);
    const lidas = await tx.consultar(
      `SELECT id, natureza, tipo FROM conta_contabil WHERE id IN (${ph(contas.length)})`,
      contas,
    );
    const porId = new Map(lidas.map((r) => [num(r['id']), r]));
    const gers = [...new Set(e.itens.flatMap((i) => (i.gerencial === null ? [] : [i.gerencial])))];
    const gLidas = gers.length
      ? await tx.consultar(
          `SELECT id, natureza, tipo FROM conta_gerencial_consolidada WHERE excluido_em IS NULL AND id IN (${ph(gers.length)})`,
          gers,
        )
      : [];
    const gPorId = new Map(gLidas.map((r) => [num(r['id']), r]));
    const atuais = await tx.consultar(
      `SELECT id, conta_contabil_id, conta_gerencial_consolidada_id, versao FROM depara_conta_gerencial
        WHERE grupo_consolidacao_id = ? AND ativo = TRUE AND conta_contabil_id IN (${ph(contas.length)})`,
      [e.grupo, ...contas],
    );
    const atualDe = new Map(atuais.map((r) => [num(r['conta_contabil_id']), r]));
    let ligadas = 0;
    let desligadas = 0;
    for (const i of e.itens) {
      const c = porId.get(i.conta);
      if (!c) throw recusa('conta-inexistente', 'A conta contábil não existe.', { campos: ['itens'] });
      const atual = atualDe.get(i.conta);
      if (atual && numOuNulo(atual['conta_gerencial_consolidada_id']) === i.gerencial) continue;
      if (i.gerencial !== null) {
        const gc = gPorId.get(i.gerencial);
        if (!gc)
          throw recusa('gerencial-inexistente', 'A conta gerencial não existe.', { campos: ['itens'] });
        recusar(
          conferirDeParaConsolidacao(
            {
              id: i.conta,
              natureza: txt(c['natureza']) as NaturezaContaGerencial,
              tipo: txt(c['tipo']) as 'analitica',
            },
            {
              id: i.gerencial,
              natureza: txt(gc['natureza']) as NaturezaContaGerencial,
              tipo: txt(gc['tipo']) as 'analitica',
            },
          ),
        );
      }
      if (atual) {
        await tx.alterar('depara_conta_gerencial', num(atual['id']), num(atual['versao']), { ativo: false });
        desligadas++;
      }
      if (i.gerencial !== null) {
        await tx.incluir('depara_conta_gerencial', {
          grupo_consolidacao_id: e.grupo,
          conta_contabil_id: i.conta,
          conta_gerencial_consolidada_id: i.gerencial,
          ativo: true,
        });
        ligadas++;
      }
    }
    return { grupo: e.grupo, ligadas, desligadas };
  },
  alvo: (e) => ({ tabela: 'grupo_consolidacao', id: e.grupo }),
});

const apurar = definirOperacao<z.infer<typeof esquemaApurar>, ResultadoOperacao>({
  nome: 'contabil.consolidacao_apurar',
  tabelas: [
    'apuracao_consolidacao',
    'eliminacao_consolidacao',
    'transacao_intercompanhia',
    'saldo_consolidado_mensal',
  ],
  entrada: esquemaApurar as never,
  async gravar(tx, e, ctx: ContextoOperacao) {
    const g = await grupoDe(tx, e.grupo, true);
    if (!g) throw recusa('grupo-inexistente', 'O grupo não existe.', { campos: ['grupo'] });
    if (g.situacao !== 'ativo')
      throw recusa('grupo-encerrado', 'O grupo está encerrado.', { campos: ['grupo'] });
    if (ctx.usuario === null) throw recusa('sem-usuario', 'A apuração precisa de um responsável.');
    const anterior = await rodadaVigente(tx, g.id, e.competencia, true);
    const { r, versoesTransacao } = await calcular(tx, g, e.competencia, anterior?.id ?? null);
    recusar(
      conferirApuracaoConsolidacao({
        pendencias: r.pendencias.length,
        situacaoAnterior: anterior?.situacao ?? null,
      }),
    );
    if (anterior)
      await tx.alterar('apuracao_consolidacao', anterior.id, anterior.versao, { situacao: 'cancelada' });
    const fim = ultimoDia(e.competencia);
    const apuracao = await tx.incluir('apuracao_consolidacao', {
      grupo_consolidacao_id: g.id,
      descricao: `Consolidação ${g.codigo} ${e.competencia}`.slice(0, 150),
      periodo_inicio: diaUm(e.competencia),
      periodo_fim: fim,
      apura_resultado: false,
      rodada_anterior_id: anterior?.id ?? null,
      valor_total: reais(r.totalEliminado),
      situacao: 'apurada',
      responsavel_usuario_id: ctx.usuario,
    });
    for (const x of r.eliminacoes)
      await tx.incluir('eliminacao_consolidacao', {
        apuracao_consolidacao_id: apuracao,
        sequencia: x.sequencia,
        data_lancamento: fim,
        competencia: diaUm(e.competencia),
        origem_estabelecimento_id: x.origem,
        contraparte_estabelecimento_id: x.contraparte,
        transacao_intercompanhia_id: x.transacao,
        debito_conta_contabil_id: x.debitoConta,
        credito_conta_contabil_id: x.creditoConta,
        valor: reais(x.valor),
        complemento: 'Eliminação entre empresas do grupo (CPC 36)',
        transitoria: false,
      });
    for (const t of r.transacoesEliminadas)
      await tx.alterar('transacao_intercompanhia', t, versoesTransacao.get(t) ?? 1, {
        situacao: 'eliminada',
        apuracao_consolidacao_id: apuracao,
      });
    // Saldo por conta gerencial: alterado quando já existe (a linha que sumiu fica zerada), incluído quando novo.
    const existentes = await tx.consultar(
      `SELECT id, conta_gerencial_consolidada_id, estabelecimento_origem_id, versao FROM saldo_consolidado_mensal
        WHERE grupo_consolidacao_id = ? AND competencia = ?`,
      [g.id, diaUm(e.competencia)],
    );
    const chave = (gerencial: number, origem: number | null) => `${gerencial}:${origem ?? 'total'}`;
    const existe = new Map(
      existentes.map((x) => [
        chave(num(x['conta_gerencial_consolidada_id']), numOuNulo(x['estabelecimento_origem_id'])),
        x,
      ]),
    );
    const agora = new Date();
    let incluidos = 0;
    let alterados = 0;
    for (const x of r.linhas) {
      const valores = {
        saldo_anterior: reais(x.anterior),
        total_debito: reais(x.debitos),
        total_credito: reais(x.creditos),
        saldo_final: reais(x.final),
        total_debito_sem_apuracao: reais(x.debitosSemApuracao),
        total_credito_sem_apuracao: reais(x.creditosSemApuracao),
        saldo_final_sem_apuracao: reais(x.finalSemApuracao),
        dados: JSON.stringify({
          apuracao,
          eliminadoDebito: x.eliminadoDebito,
          eliminadoCredito: x.eliminadoCredito,
        }),
        ocorrido_em: agora,
        usuario_id: ctx.usuario,
      };
      const k = chave(x.gerencial, x.origem);
      const atual = existe.get(k);
      if (atual) {
        await tx.alterar('saldo_consolidado_mensal', num(atual['id']), num(atual['versao']), {
          ...valores,
          operacao: 'alteracao',
        });
        existe.delete(k);
        alterados++;
      } else {
        await tx.incluir('saldo_consolidado_mensal', {
          ...valores,
          grupo_consolidacao_id: g.id,
          conta_gerencial_consolidada_id: x.gerencial,
          competencia: diaUm(e.competencia),
          estabelecimento_origem_id: x.origem,
          operacao: 'inclusao',
        });
        incluidos++;
      }
    }
    for (const x of existe.values())
      await tx.alterar('saldo_consolidado_mensal', num(x['id']), num(x['versao']), {
        saldo_anterior: 0,
        total_debito: 0,
        total_credito: 0,
        saldo_final: 0,
        total_debito_sem_apuracao: 0,
        total_credito_sem_apuracao: 0,
        saldo_final_sem_apuracao: 0,
        dados: JSON.stringify({ apuracao, semMovimento: true }),
        ocorrido_em: agora,
        usuario_id: ctx.usuario,
        operacao: 'alteracao',
      });
    return {
      apuracao,
      rodadaAnterior: anterior?.id ?? null,
      eliminacoes: r.eliminacoes.length,
      totalEliminado: r.totalEliminado,
      saldos: incluidos + alterados,
      conferencia: r.conferencia,
    };
  },
  alvo: (_e, r) => ({ tabela: 'apuracao_consolidacao', id: Number(r['apuracao']) }),
});

const liberar = definirOperacao<z.infer<typeof esquemaLiberar>, ResultadoOperacao>({
  nome: 'contabil.consolidacao_liberar',
  tabelas: ['apuracao_consolidacao'],
  entrada: esquemaLiberar as never,
  async gravar(tx, e) {
    const a = (
      await tx.consultarParaAtualizar(
        'SELECT id, situacao FROM apuracao_consolidacao WHERE id = ? AND excluido_em IS NULL',
        [e.apuracao],
      )
    )[0];
    if (!a) throw recusa('apuracao-inexistente', 'A apuração não existe.', { campos: ['apuracao'] });
    if (txt(a['situacao']) !== 'apurada')
      throw recusa('apuracao-nao-apurada', 'Só a apuração vigente (apurada) é liberada.', {
        campos: ['apuracao'],
      });
    await tx.alterar('apuracao_consolidacao', e.apuracao, e.versao, {
      situacao: 'liberada',
      liberado_em: new Date(),
    });
    return { apuracao: e.apuracao };
  },
  alvo: (e) => ({ tabela: 'apuracao_consolidacao', id: e.apuracao }),
});

export const OPERACOES_CONSOLIDACAO = {
  salvarGrupo,
  incluirConta,
  salvarDePara,
  apurar,
  liberar,
} as const;
