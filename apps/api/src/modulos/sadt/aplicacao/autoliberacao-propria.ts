// Autoliberação do resultado e checagens de consistência no banco do cliente (F8, 05-SADT linha 11). A decisão é do
// domínio (dominio-sadt/resultado/autoliberacao): aqui fica a leitura do que ela precisa (regras ativas do exame no
// setor, limites de delta do estabelecimento, último resultado liberado do mesmo analito do paciente, substâncias
// interferentes presentes e pontos da curva), a gravação do que ela decide e o cadastro.
//   - `avaliarNaDigitacao`: chamada pela digitação (resultado-propria.ts) na mesma transação. Sem regra ativa nada
//     muda (desligada por padrão). Com regra: registra a avaliação em avaliacao_regra_resultado (liberado
//     automaticamente, com a regra, ou retido para revisão, com os motivos) e, se liberou, marca o resultado como
//     autoliberado e o exame como liberado.
//   - `conferirRetidoNaLiberacao`: a liberação manual do retido grava a conferência (quem e quando) no resultado.
//   - `ServicoAutoliberacao`: fila de conferência do responsável técnico e cadastro (regras com condições, limites de
//     delta, substâncias interferentes). Nada se apaga: a regra que sai de uso é desativada.
import {
  type CondicaoAutoliberacao,
  conferirRegraAutoliberacao,
  type CurvaDoExame,
  decidirAutoliberacao,
  type DecisaoAutoliberacao,
  type InterferentePresente,
  type LimiteDelta,
  MENSAGEM_REGRA_AUTOLIBERACAO,
  MENSAGEM_RETENCAO_AUTOLIBERACAO,
  type MotivoRetencao,
  type RegraAutoliberacao,
  type ResultadoAnteriorAnalito,
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
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const instante = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
const dia = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/** Horas para trás em que o medicamento prescrito ainda conta como interferente. */
export const JANELA_MEDICAMENTO_HORAS = 72;

/** Tabelas gravadas pela avaliação na digitação (entram na lista da operação de digitação). */
export const TABELAS_AUTOLIBERACAO = ['avaliacao_regra_resultado'] as const;

export interface ContextoAvaliacao {
  readonly agora: Date;
  readonly estabelecimento: number;
  readonly exameItem: number;
  readonly exameId: number;
  readonly paciente: number;
  readonly setor: number;
  readonly resultado: number;
  /** Substâncias interferentes (condição da amostra) que a bancada apontou na digitação. */
  readonly interferentesAmostra: readonly number[];
}

/** Lê o que a regra precisa, decide e grava a decisão. Devolve a decisão (manual quando não há regra ativa). */
export async function avaliarNaDigitacao(
  tx: TxOperacao,
  c: ContextoAvaliacao,
): Promise<DecisaoAutoliberacao> {
  const regras = await lerRegrasAtivas(tx, c.exameId, c.setor);
  const valores = (
    await tx.consultar(
      `SELECT analito_id, valor_numerico, critico FROM resultado_analito
        WHERE resultado_exame_id = ? AND excluido_em IS NULL`,
      [c.resultado],
    )
  ).map((l) => ({
    analito: n(l['analito_id']),
    numero: nn(l['valor_numerico']),
    critico: n(l['critico']) === 1,
  }));
  const analitos = valores.map((v) => v.analito);
  const limitesDelta: LimiteDelta[] = analitos.length
    ? (
        await tx.consultar(
          `SELECT analito_id, tipo_variacao, variacao_maxima, janela_horas, acao FROM limite_delta_analito
            WHERE estabelecimento_id = ? AND ativo = TRUE AND analito_id IN (${marcas(analitos.length)})
              AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
            ORDER BY vigencia_inicio DESC, id DESC`,
          [c.estabelecimento, ...analitos],
        )
      ).map((l) => ({
        analito: n(l['analito_id']),
        tipo: l['tipo_variacao'] === 'absoluta' ? 'absoluta' : 'percentual',
        variacaoMaxima: n(l['variacao_maxima']),
        janelaHoras: n(l['janela_horas']),
        acao: String(l['acao']) as LimiteDelta['acao'],
      }))
    : [];
  const anteriores: ResultadoAnteriorAnalito[] = analitos.length
    ? (
        await tx.consultar(
          `SELECT ra.analito_id, ra.valor_numerico, re.resultado_em
             FROM resultado_analito ra
             JOIN resultado_exame re ON re.id = ra.resultado_exame_id
            WHERE re.paciente_id = ? AND re.id <> ? AND re.excluido_em IS NULL
              AND re.situacao IN ('liberado','retificado') AND ra.excluido_em IS NULL
              AND ra.valor_numerico IS NOT NULL AND ra.analito_id IN (${marcas(analitos.length)})
            ORDER BY re.resultado_em DESC LIMIT 200`,
          [c.paciente, c.resultado, ...analitos],
        )
      ).map((l) => ({
        analito: n(l['analito_id']),
        numero: n(l['valor_numerico']),
        em: instante(l['resultado_em']) ?? c.agora,
      }))
    : [];
  const desde = new Date(c.agora.getTime() - JANELA_MEDICAMENTO_HORAS * 3_600_000);
  const interferentes: InterferentePresente[] = (
    await tx.consultar(
      `SELECT si.id, si.substancia, si.analito_id, si.bloqueia_autoliberacao, si.principio_ativo_id
         FROM substancia_interferente si
        WHERE si.exame_id = ? AND si.ativo = TRUE
          AND (si.id IN (${c.interferentesAmostra.length ? marcas(c.interferentesAmostra.length) : 'NULL'})
           OR (si.principio_ativo_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM prescricao_item pi
                  JOIN prescricao p ON p.id = pi.prescricao_id
                  JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
                 WHERE p.paciente_id = ? AND ip.principio_ativo_id = si.principio_ativo_id
                   AND pi.excluido_em IS NULL AND pi.inicio_em <= ?
                   AND COALESCE(pi.suspenso_em, pi.fim_em, ?) >= ?)))`,
      [c.exameId, ...c.interferentesAmostra, c.paciente, c.agora, c.agora, desde],
    )
  ).map((l) => ({
    substancia: String(l['substancia']),
    analito: nn(l['analito_id']),
    bloqueia: n(l['bloqueia_autoliberacao']) === 1,
  }));
  const curva = await lerCurva(tx, c.exameId, c.exameItem);
  const pac = await tx.uma(
    `SELECT TIMESTAMPDIFF(YEAR, pf.data_nascimento, ?) AS idade, s.sigla
       FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
       LEFT JOIN sexo s ON s.id = pf.sexo_id WHERE p.id = ?`,
    [c.agora, c.paciente],
  );
  const decisao = decidirAutoliberacao({
    regras,
    valores,
    anteriores,
    limitesDelta,
    interferentes,
    curva,
    paciente: { idadeAnos: nn(pac?.['idade']), sexo: txt(pac?.['sigla']) },
    agora: c.agora,
  });
  if (decisao.decisao === 'manual') return decisao;
  await tx.incluir('avaliacao_regra_resultado', {
    resultado_exame_id: c.resultado,
    operacao: 'inclusao',
    dados: JSON.stringify({
      motivos: decisao.motivos,
      deltas: decisao.deltas.map((d) => ({
        analito: d.analito,
        variacao: Number(d.variacao.toFixed(4)),
        acao: d.acao,
      })),
      curva: decisao.falhaCurva,
      interferentes: decisao.interferentes,
    }),
    ocorrido_em: c.agora,
    usuario_id: tx.contexto.usuario,
    regra_autoliberacao_id: decisao.regra,
    decisao: decisao.decisao === 'liberar' ? 'liberado_automaticamente' : 'retido_para_revisao',
    motivo: decisao.motivos.length
      ? decisao.motivos
          .map((m) => MENSAGEM_RETENCAO_AUTOLIBERACAO[m])
          .join(' ')
          .slice(0, 500)
      : null,
  });
  return decisao;
}

async function lerRegrasAtivas(tx: Leitor, exameId: number, setor: number): Promise<RegraAutoliberacao[]> {
  const regras = await tx.consultar(
    `SELECT id, acao, prioridade FROM regra_autoliberacao
      WHERE exame_id = ? AND ativo = TRUE AND (setor_diagnostico_id IS NULL OR setor_diagnostico_id = ?)
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [exameId, setor],
  );
  if (!regras.length) return [];
  const ids = regras.map((r) => n(r['id']));
  const conds = await tx.consultar(
    `SELECT regra_autoliberacao_id, tipo_condicao, analito_id, operador, valor, valor_minimo, valor_maximo,
            delta_percentual, delta_janela_horas
       FROM condicao_autoliberacao WHERE regra_autoliberacao_id IN (${marcas(ids.length)}) AND excluido_em IS NULL
      ORDER BY regra_autoliberacao_id, sequencia`,
    ids,
  );
  return regras.map((r) => ({
    id: n(r['id']),
    acao: r['acao'] === 'reter' ? 'reter' : 'liberar',
    prioridade: n(r['prioridade']),
    condicoes: conds.filter((c) => n(c['regra_autoliberacao_id']) === n(r['id'])).map(condicaoDaLinha),
  }));
}

const condicaoDaLinha = (c: Linha): CondicaoAutoliberacao => ({
  tipo: String(c['tipo_condicao']),
  analito: nn(c['analito_id']),
  operador: (txt(c['operador']) as CondicaoAutoliberacao['operador']) ?? null,
  valor: txt(c['valor']),
  minimo: nn(c['valor_minimo']),
  maximo: nn(c['valor_maximo']),
  deltaPercentual: nn(c['delta_percentual']),
  deltaJanelaHoras: nn(c['delta_janela_horas']),
});

async function lerCurva(tx: Leitor, exameId: number, exameItem: number): Promise<CurvaDoExame | null> {
  const curva = await tx.uma(
    `SELECT id, limite_tempo_minutos FROM curva_exame WHERE exame_id = ? AND ativo = TRUE
      ORDER BY padrao DESC, id LIMIT 1`,
    [exameId],
  );
  if (!curva) return null;
  const previstos = (
    await tx.consultar(
      `SELECT sequencia, tempo_minutos FROM curva_exame_ponto WHERE curva_exame_id = ? AND excluido_em IS NULL
        ORDER BY sequencia`,
      [curva['id']],
    )
  ).map((p) => ({ sequencia: n(p['sequencia']), tempoMinutos: n(p['tempo_minutos']) }));
  if (!previstos.length) return null;
  const medidos = (
    await tx.consultar(
      `SELECT sequencia, valor_numerico, coletado_em FROM resultado_curva_ponto
        WHERE exame_item_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [exameItem],
    )
  ).map((p) => ({
    sequencia: n(p['sequencia']),
    numero: nn(p['valor_numerico']),
    coletadoEm: instante(p['coletado_em']),
  }));
  return { previstos, medidos, toleranciaMinutos: nn(curva['limite_tempo_minutos']) };
}

/** A última avaliação do resultado reteve? (a liberação manual grava então a conferência do retido). */
export async function retidoParaConferencia(tx: Leitor, resultado: number): Promise<boolean> {
  const u = await tx.uma(
    `SELECT decisao FROM avaliacao_regra_resultado WHERE resultado_exame_id = ?
      ORDER BY ocorrido_em DESC, id DESC LIMIT 1`,
    [resultado],
  );
  return u?.['decisao'] === 'retido_para_revisao';
}

// ── Cadastro e fila ────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimal = z.number().finite().nullable().default(null);

export const esquemaCondicao = z
  .object({
    tipo: z.enum(['faixa', 'delta', 'analito_relacionado', 'idade', 'sexo']),
    analito: id.nullable().default(null),
    operador: z
      .enum(['entre', 'maior', 'maior_igual', 'menor', 'menor_igual', 'igual'])
      .nullable()
      .default(null),
    valor: z.string().trim().max(300).nullable().default(null),
    minimo: decimal,
    maximo: decimal,
    deltaPercentual: z.number().positive().max(1000).nullable().default(null),
    deltaJanelaHoras: z.number().int().positive().max(65_535).nullable().default(null),
  })
  .strict();

export const esquemaRegraAutoliberacao = z
  .object({
    codigo: z.string().trim().min(2).max(30),
    descricao: z.string().trim().min(3).max(150),
    exame: id,
    setor: id.nullable().default(null),
    acao: z.enum(['liberar', 'reter']).default('liberar'),
    prioridade: z.number().int().min(0).max(65_535).default(0),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
    condicoes: z.array(esquemaCondicao).max(20).default([]),
  })
  .strict();

export const esquemaLimiteDelta = z
  .object({
    analito: id,
    tipo: z.enum(['percentual', 'absoluta']).default('percentual'),
    variacaoMaxima: z.number().positive().max(1_000_000),
    janelaHoras: z.number().int().positive().max(87_600),
    acao: z.enum(['alertar', 'reter_revisao', 'bloquear_autoliberacao']).default('reter_revisao'),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
  })
  .strict();

export const esquemaInterferente = z
  .object({
    exame: id,
    analito: id.nullable().default(null),
    principioAtivo: id.nullable().default(null),
    substancia: z.string().trim().min(2).max(150),
    efeito: z.enum(['aumenta', 'diminui', 'variavel', 'invalida']).default('variavel'),
    mensagem: z.string().trim().max(500).nullable().default(null),
    bloqueia: z.boolean().default(true),
  })
  .strict();

export const TIPOS_CADASTRO_AUTOLIBERACAO = {
  regras: 'regra_autoliberacao',
  'limites-delta': 'limite_delta_analito',
  interferentes: 'substancia_interferente',
} as const;
export type TipoCadastroAutoliberacao = keyof typeof TIPOS_CADASTRO_AUTOLIBERACAO;

const TABELAS_CADASTRO = [
  'regra_autoliberacao',
  'condicao_autoliberacao',
  'limite_delta_analito',
  'substancia_interferente',
];

export interface RetidoNaFila {
  readonly exameItem: number;
  readonly resultado: number;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly exame: string;
  readonly setor: string;
  readonly avaliadoEm: string;
  readonly motivos: readonly MotivoRetencao[];
  readonly interferentes: readonly string[];
  readonly critico: boolean;
}

export class ServicoAutoliberacao {
  private readonly executor: Executor;

  constructor(private readonly nucleo: NucleoSadt) {
    this.executor = nucleo.criarExecutor();
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

  /** A fila do responsável técnico: resultados do estabelecimento retidos pela última avaliação e ainda não liberados. */
  async fila(c: ContextoSadt): Promise<RetidoNaFila[]> {
    const est = this.est(c);
    const linhas = await this.nucleo.lerSomente(this.ctxNucleo(c), (l) =>
      l.consultar(
        `SELECT re.exame_item_id, re.id AS resultado, re.paciente_id, re.critico, pf.nome AS paciente_nome,
                e.nome AS exame, sd.nome AS setor, a.ocorrido_em, a.dados
           FROM resultado_exame re
           JOIN exame_item ei ON ei.id = re.exame_item_id AND ei.excluido_em IS NULL
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.estabelecimento_id = ?
           JOIN exame e ON e.id = ei.exame_id
           JOIN setor_diagnostico sd ON sd.id = re.setor_diagnostico_id
           JOIN paciente p ON p.id = re.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           JOIN avaliacao_regra_resultado a ON a.resultado_exame_id = re.id
            AND a.id = (SELECT MAX(a2.id) FROM avaliacao_regra_resultado a2 WHERE a2.resultado_exame_id = re.id)
          WHERE re.excluido_em IS NULL AND re.situacao IN ('digitado','conferido')
            AND a.decisao = 'retido_para_revisao'
          ORDER BY re.critico DESC, a.ocorrido_em
          LIMIT 500`,
        [est],
      ),
    );
    return linhas.map((l) => {
      const dados = (typeof l['dados'] === 'string' ? JSON.parse(l['dados']) : (l['dados'] ?? {})) as {
        motivos?: MotivoRetencao[];
        interferentes?: string[];
      };
      return {
        exameItem: n(l['exame_item_id']),
        resultado: n(l['resultado']),
        paciente: n(l['paciente_id']),
        pacienteNome: String(l['paciente_nome']),
        exame: String(l['exame']),
        setor: String(l['setor']),
        avaliadoEm: (instante(l['ocorrido_em']) ?? new Date(0)).toISOString(),
        motivos: dados.motivos ?? [],
        interferentes: dados.interferentes ?? [],
        critico: n(l['critico']) === 1,
      };
    });
  }

  /** O cadastro (regras com condições, limites de delta do estabelecimento, interferentes) e as opções da tela. */
  async listar(c: ContextoSadt) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const regras = await l.consultar(
        `SELECT r.id, r.codigo, r.descricao, r.exame_id, e.nome AS exame, r.setor_diagnostico_id, r.acao, r.prioridade,
                r.vigencia_inicio, r.vigencia_fim, r.ativo
           FROM regra_autoliberacao r JOIN exame e ON e.id = r.exame_id ORDER BY r.ativo DESC, r.exame_id, r.prioridade`,
        [],
      );
      const conds = regras.length
        ? await l.consultar(
            `SELECT regra_autoliberacao_id, tipo_condicao, analito_id, operador, valor, valor_minimo, valor_maximo,
                    delta_percentual, delta_janela_horas
               FROM condicao_autoliberacao WHERE excluido_em IS NULL ORDER BY regra_autoliberacao_id, sequencia`,
            [],
          )
        : [];
      const deltas = await l.consultar(
        `SELECT d.id, d.analito_id, a.nome AS analito, d.tipo_variacao, d.variacao_maxima, d.janela_horas, d.acao,
                d.vigencia_inicio, d.vigencia_fim, d.ativo
           FROM limite_delta_analito d JOIN analito a ON a.id = d.analito_id
          WHERE d.estabelecimento_id = ? ORDER BY d.ativo DESC, a.nome`,
        [est],
      );
      const interferentes = await l.consultar(
        `SELECT si.id, si.exame_id, e.nome AS exame, si.analito_id, si.principio_ativo_id, pa.descricao AS principio,
                si.substancia, si.efeito, si.mensagem_alerta, si.bloqueia_autoliberacao, si.ativo
           FROM substancia_interferente si JOIN exame e ON e.id = si.exame_id
           LEFT JOIN principio_ativo pa ON pa.id = si.principio_ativo_id
          ORDER BY si.ativo DESC, e.nome, si.substancia`,
        [],
      );
      const exames = await l.consultar(
        `SELECT DISTINCT e.id, e.nome FROM exame e
           JOIN exame_analito ea ON ea.exame_id = e.id AND ea.excluido_em IS NULL AND ea.titulo = FALSE
          WHERE e.ativo = TRUE ORDER BY e.nome LIMIT 2000`,
        [],
      );
      const analitos = await l.consultar(
        `SELECT ea.exame_id, a.id, a.nome FROM exame_analito ea JOIN analito a ON a.id = ea.analito_id
          WHERE ea.excluido_em IS NULL AND ea.titulo = FALSE ORDER BY ea.exame_id, ea.ordem, ea.id LIMIT 20000`,
        [],
      );
      const setores = await l.consultar(
        'SELECT id, nome FROM setor_diagnostico WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY nome',
        [est],
      );
      return {
        regras: regras.map((r) => ({
          id: n(r['id']),
          codigo: String(r['codigo']),
          descricao: String(r['descricao']),
          exame: n(r['exame_id']),
          exameNome: String(r['exame']),
          setor: nn(r['setor_diagnostico_id']),
          acao: String(r['acao']),
          prioridade: n(r['prioridade']),
          vigenciaInicio: dia(r['vigencia_inicio']),
          vigenciaFim: dia(r['vigencia_fim']),
          ativo: n(r['ativo']) === 1,
          condicoes: conds.filter((x) => n(x['regra_autoliberacao_id']) === n(r['id'])).map(condicaoDaLinha),
        })),
        limitesDelta: deltas.map((d) => ({
          id: n(d['id']),
          analito: n(d['analito_id']),
          analitoNome: String(d['analito']),
          tipo: String(d['tipo_variacao']),
          variacaoMaxima: n(d['variacao_maxima']),
          janelaHoras: n(d['janela_horas']),
          acao: String(d['acao']),
          vigenciaInicio: dia(d['vigencia_inicio']),
          vigenciaFim: dia(d['vigencia_fim']),
          ativo: n(d['ativo']) === 1,
        })),
        interferentes: interferentes.map((i) => ({
          id: n(i['id']),
          exame: n(i['exame_id']),
          exameNome: String(i['exame']),
          analito: nn(i['analito_id']),
          principioAtivo: nn(i['principio_ativo_id']),
          principioNome: txt(i['principio']),
          substancia: String(i['substancia']),
          efeito: String(i['efeito']),
          mensagem: txt(i['mensagem_alerta']),
          bloqueia: n(i['bloqueia_autoliberacao']) === 1,
          ativo: n(i['ativo']) === 1,
        })),
        opcoes: {
          exames: exames.map((e) => ({ id: n(e['id']), nome: String(e['nome']) })),
          analitos: analitos.map((a) => ({
            exame: n(a['exame_id']),
            id: n(a['id']),
            nome: String(a['nome']),
          })),
          setores: setores.map((s) => ({ id: n(s['id']), nome: String(s['nome']) })),
        },
      };
    });
  }

  /** A busca do medicamento interferente pelo princípio ativo (DCB). */
  async principios(c: ContextoSadt, busca: string) {
    const termo = busca.trim();
    if (termo.length < 3) return [];
    const linhas = await this.nucleo.lerSomente(this.ctxNucleo(c), (l) =>
      l.consultar(
        'SELECT id, descricao FROM principio_ativo WHERE descricao LIKE ? ORDER BY descricao LIMIT 20',
        [`%${termo.replace(/[%_]/g, '')}%`],
      ),
    );
    return linhas.map((p) => ({ id: n(p['id']), nome: String(p['descricao']) }));
  }

  /**
   * Condições da amostra (substância interferente sem princípio ativo, ativa) cadastradas para o exame: a bancada as
   * aponta na digitação (hemólise, lipemia, icterícia) e a avaliação da regra as recebe em `interferentesAmostra`.
   */
  async interferentesDaAmostra(c: ContextoSadt, exame: number) {
    const linhas = await this.nucleo.lerSomente(this.ctxNucleo(c), (l) =>
      l.consultar(
        `SELECT id, substancia, efeito, bloqueia_autoliberacao FROM substancia_interferente
          WHERE exame_id = ? AND principio_ativo_id IS NULL AND ativo = TRUE ORDER BY substancia, id LIMIT 50`,
        [exame],
      ),
    );
    return linhas.map((i) => ({
      id: n(i['id']),
      substancia: String(i['substancia']),
      efeito: String(i['efeito']),
      bloqueia: Boolean(i['bloqueia_autoliberacao']),
    }));
  }

  async incluirRegra(c: ContextoSadt, e: z.infer<typeof esquemaRegraAutoliberacao>) {
    this.est(c);
    return this.gravar(c, 'sadt.autoliberacao.regra.incluir', 'regra_autoliberacao', async (tx) => {
      const analitos = (
        await tx.consultar(
          'SELECT analito_id FROM exame_analito WHERE exame_id = ? AND excluido_em IS NULL AND titulo = FALSE',
          [e.exame],
        )
      ).map((a) => n(a['analito_id']));
      if (!analitos.length) throw recusa('exame-sem-analito', 'O exame não tem analitos para a regra.');
      const condicoes: CondicaoAutoliberacao[] = e.condicoes.map((x) => ({ ...x }));
      const falha = conferirRegraAutoliberacao({
        acao: e.acao,
        condicoes,
        analitosDoExame: analitos,
        vigenciaInicio: e.vigenciaInicio,
        vigenciaFim: e.vigenciaFim,
      });
      if (falha) throw recusa(falha, MENSAGEM_REGRA_AUTOLIBERACAO[falha]);
      const ja = await tx.uma('SELECT id FROM regra_autoliberacao WHERE codigo = ?', [e.codigo]);
      if (ja) throw recusa('codigo-repetido', 'Já existe uma regra com este código.');
      const regra = await tx.incluir('regra_autoliberacao', {
        codigo: e.codigo,
        descricao: e.descricao,
        exame_id: e.exame,
        setor_diagnostico_id: e.setor,
        acao: e.acao,
        prioridade: e.prioridade,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
      });
      let seq = 0;
      for (const x of e.condicoes)
        await tx.incluir('condicao_autoliberacao', {
          regra_autoliberacao_id: regra,
          sequencia: ++seq,
          tipo_condicao: x.tipo,
          analito_id: x.analito,
          operador: x.operador,
          valor: x.valor,
          valor_minimo: x.minimo,
          valor_maximo: x.maximo,
          delta_percentual: x.deltaPercentual,
          delta_janela_horas: x.deltaJanelaHoras,
        });
      return regra;
    });
  }

  async incluirLimiteDelta(c: ContextoSadt, e: z.infer<typeof esquemaLimiteDelta>) {
    const est = this.est(c);
    if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
      throw recusa('vigencia-invertida', MENSAGEM_REGRA_AUTOLIBERACAO['vigencia-invertida']);
    return this.gravar(c, 'sadt.autoliberacao.delta.incluir', 'limite_delta_analito', async (tx) => {
      const ja = await tx.uma(
        `SELECT id FROM limite_delta_analito WHERE estabelecimento_id = ? AND analito_id = ? AND material_biologico_id IS NULL
            AND vigencia_inicio = ?`,
        [est, e.analito, e.vigenciaInicio],
      );
      if (ja)
        throw recusa('limite-repetido', 'Já existe um limite deste analito com o mesmo início de vigência.');
      return tx.incluir('limite_delta_analito', {
        estabelecimento_id: est,
        analito_id: e.analito,
        tipo_variacao: e.tipo,
        variacao_maxima: e.variacaoMaxima,
        janela_horas: e.janelaHoras,
        acao: e.acao,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
      });
    });
  }

  async incluirInterferente(c: ContextoSadt, e: z.infer<typeof esquemaInterferente>) {
    this.est(c);
    return this.gravar(
      c,
      'sadt.autoliberacao.interferente.incluir',
      'substancia_interferente',
      async (tx) => {
        if (e.analito !== null) {
          const ok = await tx.uma(
            'SELECT 1 AS ok FROM exame_analito WHERE exame_id = ? AND analito_id = ? AND excluido_em IS NULL',
            [e.exame, e.analito],
          );
          if (!ok)
            throw recusa('condicao-analito-fora', MENSAGEM_REGRA_AUTOLIBERACAO['condicao-analito-fora']);
        }
        return tx.incluir('substancia_interferente', {
          exame_id: e.exame,
          analito_id: e.analito,
          principio_ativo_id: e.principioAtivo,
          substancia: e.substancia,
          efeito: e.efeito,
          mensagem_alerta: e.mensagem,
          bloqueia_autoliberacao: e.bloqueia,
        });
      },
    );
  }

  /** Desativa (nunca apaga): a regra fica no histórico e ligada às avaliações já registradas. */
  async desativar(c: ContextoSadt, tipo: TipoCadastroAutoliberacao, registro: number) {
    const est = this.est(c);
    const tabela = TIPOS_CADASTRO_AUTOLIBERACAO[tipo];
    return this.gravar(c, `sadt.autoliberacao.${tipo}.desativar`, tabela, async (tx) => {
      const [r] =
        tabela === 'limite_delta_analito'
          ? await tx.consultarParaAtualizar(
              'SELECT id, versao, ativo FROM limite_delta_analito WHERE id = ? AND estabelecimento_id = ?',
              [registro, est],
            )
          : tabela === 'regra_autoliberacao'
            ? await tx.consultarParaAtualizar(
                'SELECT id, versao, ativo FROM regra_autoliberacao WHERE id = ?',
                [registro],
              )
            : await tx.consultarParaAtualizar(
                'SELECT id, versao, ativo FROM substancia_interferente WHERE id = ?',
                [registro],
              );
      if (!r) throw recusa('nao-encontrado', 'Registro não encontrado.');
      if (n(r['ativo']) !== 1) throw recusa('ja-desativado', 'O registro já está desativado.');
      await tx.alterar(tabela, registro, n(r['versao']), { ativo: false });
      return registro;
    });
  }

  private async gravar(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    aplicar: (tx: TxOperacao) => Promise<number>,
  ): Promise<{ id: number }> {
    let gravado = 0;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_CADASTRO,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        gravado = await aplicar(tx);
        return { id: gravado };
      },
      alvo: () => ({ tabela, id: gravado || null }),
      trilha: () => ({ dados: { evento: nome, id: gravado } }),
    });
    const chave = `sadt-autolib:${c.chaveIdempotencia ?? randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return { id: gravado };
  }
}
