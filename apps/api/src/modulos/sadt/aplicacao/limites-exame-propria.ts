// Limites do pedido de exame no banco do cliente (F8, 05-SADT linha 6): o cadastro das cotas, dos intervalos de
// repetição (inclusive a repetição proibida no mesmo dia) e dos bloqueios pelo último resultado, e a leitura que o
// pedido de exames faz na hora de avaliar e de gravar. A regra mora em @sgh/dominio-sadt (exame/limites.ts); aqui fica
// só a leitura do cadastro e das contagens e a gravação do que a regra decide. Nada se apaga: a regra que sai de uso é
// desativada (fica no histórico e ligada às liberações já registradas nos itens).
import {
  type BloqueioPorResultado,
  bloqueiosPorResultado,
  conferirBloqueioPorResultado,
  conferirCota,
  conferirIntervalo,
  type CotaExame,
  cotasAcionadas,
  type IntervaloRepeticao,
  intervalosAcionados,
  janelaDaCota,
  type LimiteAcionado,
  type PedidoAnterior,
  RecusaLimite,
  type ResultadoAnterior,
  type UsoDaCota,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const instante = (v: unknown): Date => (v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`));

// ── Cadastro: entradas ─────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const acao = z.enum(['bloquear', 'alertar', 'exigir_justificativa']);

export const esquemaCota = z.object({
  exame: id.nullable().default(null),
  setor: id.nullable().default(null),
  fontePagadora: id.nullable().default(null),
  unidade: id.nullable().default(null),
  setorSolicitante: id.nullable().default(null),
  periodo: z.enum(['dia', 'semana', 'mes', 'competencia']).default('mes'),
  quantidadeMaxima: z.number().int().min(1).max(1_000_000).nullable().default(null),
  percentualLimite: z.number().min(0).max(100).nullable().default(null),
  permiteExceder: z.boolean().default(false),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
});

export const esquemaIntervalo = z.object({
  exame: id,
  conflitante: id.nullable().default(null),
  fontePagadora: id.nullable().default(null),
  intervaloMinimoHoras: z.number().int().min(0).max(87_600).default(0),
  mesmoDia: z.boolean().default(false),
  acao: acao.default('bloquear'),
  mensagem: z.string().trim().max(500).nullable().default(null),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
});

export const esquemaBloqueioResultado = z.object({
  exame: id,
  exameAvaliado: id.nullable().default(null),
  analito: id,
  operador: z.enum(['igual', 'diferente', 'maior', 'maior_igual', 'menor', 'menor_igual', 'entre', 'contem']),
  valor: z.string().trim().min(1).max(300),
  janelaDias: z.number().int().min(1).max(3650),
  acao: acao.default('bloquear'),
  mensagem: z.string().trim().max(500).nullable().default(null),
});

export const TIPOS_LIMITE = {
  cota: 'cota_exame',
  intervalo: 'intervalo_repeticao_exame',
  resultado: 'bloqueio_exame_resultado',
} as const;
export type TipoCadastroLimite = keyof typeof TIPOS_LIMITE;

export const TABELAS_LIMITES = [
  'cota_exame',
  'intervalo_repeticao_exame',
  'bloqueio_exame_resultado',
] as const;

// ── Leitura do cadastro para a regra ───────────────────────────────────────────────────────────────────────────

const cotaDe = (r: Linha): CotaExame => ({
  id: n(r['id']),
  exame: nn(r['exame_id']),
  setor: nn(r['setor_diagnostico_id']),
  fontePagadora: nn(r['fonte_pagadora_id']),
  unidade: nn(r['unidade_assistencial_id']),
  setorSolicitante: nn(r['solicitante_setor_funcional_id']),
  periodo: texto(r['periodo']) as CotaExame['periodo'],
  quantidadeMaxima: nn(r['quantidade_maxima']),
  percentualLimite: nn(r['percentual_limite']),
  permiteExceder: Boolean(Number(r['permite_exceder'] ?? 0)),
  vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '1900-01-01',
  vigenciaFim: dataIso(r['vigencia_fim']),
});

const intervaloDe = (r: Linha): IntervaloRepeticao => ({
  id: n(r['id']),
  exame: n(r['exame_id']),
  conflitante: n(r['exame_conflitante_id']),
  fontePagadora: nn(r['fonte_pagadora_id']),
  intervaloMinimoHoras: n(r['intervalo_minimo_horas']),
  mesmoDia: Boolean(Number(r['mesmo_dia'] ?? 0)),
  acao: texto(r['acao']) as IntervaloRepeticao['acao'],
  mensagem: r['mensagem'] === null || r['mensagem'] === undefined ? null : texto(r['mensagem']),
  vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '1900-01-01',
  vigenciaFim: dataIso(r['vigencia_fim']),
});

const bloqueioDe = (r: Linha): BloqueioPorResultado => ({
  id: n(r['id']),
  exame: n(r['exame_id']),
  exameAvaliado: nn(r['exame_avaliado_id']),
  analito: n(r['analito_id']),
  operador: texto(r['operador']) as BloqueioPorResultado['operador'],
  valor: texto(r['valor']),
  janelaDias: n(r['janela_dias']),
  acao: texto(r['acao']) as BloqueioPorResultado['acao'],
  mensagem: r['mensagem'] === null || r['mensagem'] === undefined ? null : texto(r['mensagem']),
});

export interface ContextoDosLimites {
  readonly paciente: number;
  readonly fontePagadora: number | null;
  readonly unidade: number | null;
  readonly setorSolicitante: number | null;
  readonly itens: readonly { exame: number; setor: number; quantidade: number }[];
}

/** O que vale para cada item do pedido: lê o cadastro e as contagens, e a regra decide. */
export async function limitesDoPedido(
  l: Leitor,
  est: number,
  x: ContextoDosLimites,
): Promise<LimiteAcionado[]> {
  if (!x.itens.length) return [];
  const f = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  const fuso = texto(f?.['fuso_horario']) || FUSO_PADRAO;
  const rel = relogioNoFuso(fuso);
  const local = (v: unknown) => {
    const r = relogioNoFuso(fuso, instante(v));
    return `${r.hoje} ${r.hora}`;
  };
  const exames = [...new Set(x.itens.map((i) => i.exame))];
  const setores = [...new Set(x.itens.map((i) => i.setor))];
  const cotas = (
    await l.consultar(
      `SELECT * FROM cota_exame WHERE estabelecimento_id = ? AND ativo = TRUE
          AND (exame_id IN (${lista(exames.length)}) OR (exame_id IS NULL AND setor_diagnostico_id IN (${lista(setores.length)})))`,
      [est, ...exames, ...setores],
    )
  ).map(cotaDe);
  const intervalos = (
    await l.consultar(
      `SELECT * FROM intervalo_repeticao_exame WHERE estabelecimento_id = ? AND ativo = TRUE
          AND (exame_id IN (${lista(exames.length)}) OR exame_conflitante_id IN (${lista(exames.length)}))`,
      [est, ...exames, ...exames],
    )
  ).map(intervaloDe);
  const bloqueios = (
    await l.consultar(
      `SELECT * FROM bloqueio_exame_resultado WHERE ativo = TRUE AND exame_id IN (${lista(exames.length)})`,
      exames,
    )
  ).map(bloqueioDe);

  // Uso das cotas: os itens não cancelados do estabelecimento na janela (pela data civil do estabelecimento).
  const usos = new Map<number, UsoDaCota>();
  for (const c of cotas) usos.set(c.id, await usoDaCota(l, est, fuso, rel.hoje, c));

  // Pedidos anteriores do paciente nos exames das regras de intervalo (até a maior janela da regra, com folga).
  const pares = [...new Set(intervalos.flatMap((r) => [r.exame, r.conflitante]))];
  const horas = Math.max(24, ...intervalos.map((r) => r.intervaloMinimoHoras));
  const anteriores: PedidoAnterior[] = pares.length
    ? (
        await l.consultar(
          `SELECT ei.exame_id, r.fonte_pagadora_id, r.solicitado_em FROM exame_item ei
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
            WHERE r.paciente_id = ? AND ei.excluido_em IS NULL AND ei.situacao NOT IN ('cancelado','recusado')
              AND ei.exame_id IN (${lista(pares.length)}) AND r.solicitado_em >= ?`,
          [x.paciente, ...pares, new Date(Date.now() - (horas + 48) * 3_600_000)],
        )
      ).map((r) => ({
        exame: n(r['exame_id']),
        fontePagadora: nn(r['fonte_pagadora_id']),
        em: local(r['solicitado_em']),
      }))
    : [];

  // O último resultado liberado de cada exame e analito das regras de bloqueio.
  const avaliados = [...new Set(bloqueios.map((b) => b.exameAvaliado ?? b.exame))];
  const analitos = [...new Set(bloqueios.map((b) => b.analito))];
  const resultados: ResultadoAnterior[] = bloqueios.length
    ? (
        await l.consultar(
          `SELECT ei.exame_id, ra.analito_id, ra.valor_texto, ra.valor_numerico, re.liberado_em
             FROM resultado_analito ra JOIN resultado_exame re ON re.id = ra.resultado_exame_id
             JOIN exame_item ei ON ei.id = re.exame_item_id
            WHERE re.paciente_id = ? AND re.situacao = 'liberado' AND re.liberado_em IS NOT NULL
              AND ei.exame_id IN (${lista(avaliados.length)}) AND ra.analito_id IN (${lista(analitos.length)})`,
          [x.paciente, ...avaliados, ...analitos],
        )
      ).map((r) => ({
        exame: n(r['exame_id']),
        analito: n(r['analito_id']),
        valorTexto:
          r['valor_texto'] === null || r['valor_texto'] === undefined ? null : texto(r['valor_texto']),
        valorNumerico: nn(r['valor_numerico']),
        data: local(r['liberado_em']).slice(0, 10),
      }))
    : [];

  const saida: LimiteAcionado[] = [];
  const noPedido = new Map<number, number>();
  for (const i of x.itens) {
    const item = {
      exame: i.exame,
      setor: i.setor,
      fontePagadora: x.fontePagadora,
      unidade: x.unidade,
      setorSolicitante: x.setorSolicitante,
      data: rel.hoje,
      hora: rel.hora,
    };
    const q = Math.max(1, i.quantidade);
    saida.push(
      ...cotasAcionadas(
        cotas,
        item,
        (c) => usos.get(c) ?? { usados: 0, totalDoAlvo: 0 },
        (c) => (noPedido.get(c) ?? 0) + q - 1,
      ),
    );
    for (const c of cotas)
      if (c.exame === i.exame || (c.exame === null && c.setor === i.setor))
        noPedido.set(c.id, (noPedido.get(c.id) ?? 0) + q);
    const outros = x.itens.filter((o) => o !== i).map((o) => o.exame);
    saida.push(...intervalosAcionados(intervalos, item, anteriores, outros));
    saida.push(...bloqueiosPorResultado(bloqueios, item, resultados));
  }
  return saida;
}

/** A coluna da liberação de cada tipo de limite (liberacao_excecao_exame). */
export const COLUNA_LIBERACAO: Record<LimiteAcionado['tipo'], string> = {
  cota: 'cota_exame_id',
  intervalo: 'intervalo_repeticao_exame_id',
  ultimo_resultado: 'bloqueio_exame_resultado_id',
};

// ── Cadastro ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface LimitesCadastrados {
  readonly cotas: readonly (CotaExame & { ativo: boolean; exameNome: string | null; usoNoPeriodo: number })[];
  readonly intervalos: readonly (IntervaloRepeticao & { ativo: boolean })[];
  readonly bloqueios: readonly (BloqueioPorResultado & { ativo: boolean })[];
}

function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaLimite) throw recusa(e.codigo, e.message);
    throw e;
  }
}

export class ServicoLimitesExame {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private async gravar(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, est: number) => Promise<number>,
  ): Promise<{ id: number }> {
    const est = this.est(c);
    let gravado: number | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_LIMITES,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        gravado = await fn(tx, est);
        return { id: gravado };
      },
      alvo: () => ({ tabela, id: gravado }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt-limite:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return { id: gravado ?? n(r.resultado['id']) };
  }

  /** Os limites do estabelecimento (ativos primeiro), com o uso da cota no período corrente. */
  listar(c: ContextoSadt): Promise<LimitesCadastrados> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const f = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
      const fuso = texto(f?.['fuso_horario']) || FUSO_PADRAO;
      const hoje = relogioNoFuso(fuso).hoje;
      const cotasL = await l.consultar(
        `SELECT q.*, e.nome AS exame_nome FROM cota_exame q LEFT JOIN exame e ON e.id = q.exame_id
          WHERE q.estabelecimento_id = ? ORDER BY q.ativo DESC, q.id DESC LIMIT 500`,
        [est],
      );
      const cotas = [];
      for (const r of cotasL) {
        const cota = cotaDe(r);
        const uso = Number(r['ativo'] ?? 0) ? (await usoDaCota(l, est, fuso, hoje, cota)).usados : 0;
        cotas.push({
          ...cota,
          ativo: Boolean(Number(r['ativo'] ?? 0)),
          exameNome: r['exame_nome'] ? texto(r['exame_nome']) : null,
          usoNoPeriodo: uso,
        });
      }
      const intervalos = (
        await l.consultar(
          'SELECT * FROM intervalo_repeticao_exame WHERE estabelecimento_id = ? ORDER BY ativo DESC, id DESC LIMIT 500',
          [est],
        )
      ).map((r) => ({ ...intervaloDe(r), ativo: Boolean(Number(r['ativo'] ?? 0)) }));
      // O bloqueio por resultado não tem estabelecimento no modelo: vale para os exames do catálogo do cliente.
      const bloqueios = (
        await l.consultar('SELECT * FROM bloqueio_exame_resultado ORDER BY ativo DESC, id DESC LIMIT 500', [])
      ).map((r) => ({ ...bloqueioDe(r), ativo: Boolean(Number(r['ativo'] ?? 0)) }));
      return { cotas, intervalos, bloqueios };
    });
  }

  async incluirCota(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaCota.parse(entrada);
    daRegra(() => conferirCota(e));
    return this.gravar(c, 'sadt.limite.cota.incluida', 'cota_exame', async (tx, est) => {
      if (e.exame !== null) await exameExiste(tx, e.exame);
      return tx.incluir('cota_exame', {
        estabelecimento_id: est,
        exame_id: e.exame,
        setor_diagnostico_id: e.setor,
        fonte_pagadora_id: e.fontePagadora,
        unidade_assistencial_id: e.unidade,
        solicitante_setor_funcional_id: e.setorSolicitante,
        periodo: e.periodo,
        quantidade_maxima: e.quantidadeMaxima,
        percentual_limite: e.percentualLimite,
        permite_exceder: e.permiteExceder,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: true,
      });
    });
  }

  async incluirIntervalo(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaIntervalo.parse(entrada);
    const regra = { ...e, conflitante: e.conflitante ?? e.exame };
    daRegra(() => conferirIntervalo(regra));
    return this.gravar(c, 'sadt.limite.intervalo.incluido', 'intervalo_repeticao_exame', async (tx, est) => {
      await exameExiste(tx, regra.exame);
      await exameExiste(tx, regra.conflitante);
      return tx.incluir('intervalo_repeticao_exame', {
        estabelecimento_id: est,
        exame_id: regra.exame,
        exame_conflitante_id: regra.conflitante,
        fonte_pagadora_id: regra.fontePagadora,
        intervalo_minimo_horas: regra.intervaloMinimoHoras,
        mesmo_dia: regra.mesmoDia,
        acao: regra.acao,
        mensagem: regra.mensagem,
        vigencia_inicio: regra.vigenciaInicio,
        vigencia_fim: regra.vigenciaFim,
        ativo: true,
      });
    });
  }

  async incluirBloqueioResultado(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const e = esquemaBloqueioResultado.parse(entrada);
    daRegra(() => conferirBloqueioPorResultado(e));
    return this.gravar(c, 'sadt.limite.resultado.incluido', 'bloqueio_exame_resultado', async (tx) => {
      await exameExiste(tx, e.exame);
      if (e.exameAvaliado !== null) await exameExiste(tx, e.exameAvaliado);
      const a = await tx.uma('SELECT id FROM analito WHERE id = ?', [e.analito]);
      if (!a) throw recusa('analito-inexistente', 'O analito não existe.');
      return tx.incluir('bloqueio_exame_resultado', {
        exame_id: e.exame,
        exame_avaliado_id: e.exameAvaliado,
        analito_id: e.analito,
        operador: e.operador,
        valor: e.valor,
        janela_dias: e.janelaDias,
        acao: e.acao,
        mensagem: e.mensagem,
        ativo: true,
      });
    });
  }

  /** Desativa a regra (nunca apaga: as liberações já registradas nos itens seguem ligadas a ela). */
  async desativar(c: ContextoSadt, tipo: TipoCadastroLimite, alvo: number): Promise<{ id: number }> {
    const tabela = TIPOS_LIMITE[tipo];
    return this.gravar(c, `sadt.limite.${tipo}.desativado`, tabela, async (tx, est) => {
      const r = await tx.uma(
        tabela === 'bloqueio_exame_resultado'
          ? `SELECT id, versao, ativo FROM ${tabela} WHERE id = ?`
          : `SELECT id, versao, ativo FROM ${tabela} WHERE id = ? AND estabelecimento_id = ?`,
        tabela === 'bloqueio_exame_resultado' ? [alvo] : [alvo, est],
      );
      if (!r) throw recusa('nao-encontrado', 'A regra não existe neste estabelecimento.');
      if (!Number(r['ativo'] ?? 0)) throw recusa('ja-inativa', 'A regra já está desativada.');
      await tx.alterar(tabela, alvo, n(r['versao']), { ativo: false });
      return alvo;
    });
  }
}

async function exameExiste(l: Leitor, exame: number): Promise<void> {
  const e = await l.uma('SELECT id FROM exame WHERE id = ? AND excluido_em IS NULL', [exame]);
  if (!e) throw recusa('exame-inexistente', 'O exame não existe.');
}

/** O uso da cota no período que contém hoje (a mesma contagem na tela, "8 de 10 no mês", e no pedido). */
async function usoDaCota(
  l: Leitor,
  est: number,
  fuso: string,
  hoje: string,
  c: CotaExame,
): Promise<UsoDaCota> {
  const j = janelaDaCota(c.periodo, hoje);
  // Um dia de folga antes do início cobre o fuso; a data civil decide abaixo.
  const linhas = await l.consultar(
    `SELECT ei.quantidade, ei.setor_diagnostico_id, r.fonte_pagadora_id, r.unidade_assistencial_id, a.setor_funcional_id,
            r.solicitado_em
       FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
       JOIN atendimento a ON a.id = r.atendimento_id
      WHERE r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND ei.situacao NOT IN ('cancelado','recusado')
        AND r.solicitado_em >= ? AND ${c.exame !== null ? 'ei.exame_id = ?' : 'ei.setor_diagnostico_id = ?'}`,
    [est, new Date(Date.parse(`${j.inicio}T00:00:00Z`) - 86_400_000), c.exame ?? c.setor],
  );
  let usados = 0;
  let totalDoAlvo = 0;
  for (const x of linhas) {
    const d = relogioNoFuso(fuso, instante(x['solicitado_em'])).hoje;
    if (d < j.inicio || d > j.fim) continue;
    if (c.exame !== null && c.setor !== null && nn(x['setor_diagnostico_id']) !== c.setor) continue;
    const q = Math.max(1, n(x['quantidade']));
    totalDoAlvo += q;
    if (c.fontePagadora !== null && nn(x['fonte_pagadora_id']) !== c.fontePagadora) continue;
    if (c.unidade !== null && nn(x['unidade_assistencial_id']) !== c.unidade) continue;
    if (c.setorSolicitante !== null && nn(x['setor_funcional_id']) !== c.setorSolicitante) continue;
    usados += q;
  }
  return { usados, totalDoAlvo };
}
