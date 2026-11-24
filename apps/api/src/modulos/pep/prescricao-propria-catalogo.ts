// Leituras de catálogo e de regra da prescrição sobre o banco PRÓPRIO do cliente (família prescricao-catalogo): regras
// de horário (grade_horario_unidade + horario_padrao_dose), horários relativos (frequencia_horario_relativo),
// horários das dietas (modalidade_dieta_refeicao + horario_refeicao), domínios da tela, produtos e índice de busca
// (item_prescritivel, princípio, vias, limite_dose_principio, lista_controle_especial), kits (kit_prescricao*),
// cadastros em consulta, protocolos (protocolo_prescricao*), especialidades do prescritor, produtos ativos e dieta de
// outro prescritor no período, parâmetros da prescrição (parametro_definicao/parametro_valor), regras de alerta
// (regra_alerta + cenario_alerta) e interações (interacao_medicamentosa + gravidade_interacao).
// Só leitura (Leitor do @sgh/nucleo), SQL parametrizado, estabelecimento da sessão e exclusão lógica em toda leitura,
// datas no fuso do estabelecimento. A especificação é a porta de memória (mesma forma de retorno). O integrador liga
// cada método da PortaPrescricaoPropria a `new CatalogoPrescricaoPropria(nucleo, cliente).<metodo>(...)`.
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import { PLANO_DO_TIPO, TIPOS_ALERTA, type SecaoCadastroPrescricao } from '@sgh/contratos';
import type { ContextoPrescricao, ParametrosPrescricao } from './prescricao-porta.js';
import { BASE_PLANO_PROPRIO } from './prescricao-porta-propria.js';
import { dataHora, fusoValido, type NucleoLeituraPep } from './registro-porta-propria.js';
import type {
  ConsultaCadastroLida,
  InteracaoLida,
  ItemDoIndice,
  ItemPrescricaoLido,
  KitMedicamentoLido,
  OpcaoDominio,
  ProdutoLido,
  ProtocoloLido,
  RegraAlertaLida,
  RegraHorarioLida,
} from './tipos-pep.js';

/** Teto de linhas de uma consulta de cadastro (o contrato pede refinar a busca acima dele). */
export const TETO_CADASTRO = 200;

/** Categorias de tipo_item_prescricao que entram no índice de busca de produtos (o que se prescreve por produto). */
export const CATEGORIAS_DE_PRODUTO = ['medicamento', 'solucao', 'quimioterapia'] as const;

/** Categoria do tipo de item (CHECK de tipo_item_prescricao) → código de plano (o mesmo da porta própria). */
const PLANO_DA_CATEGORIA: Readonly<Record<string, number>> = {
  medicamento: PLANO_DO_TIPO.medicamento,
  solucao: PLANO_DO_TIPO.solucao,
  dieta: PLANO_DO_TIPO['dieta-oral'],
  hemocomponente: PLANO_DO_TIPO.hemoterapia,
  procedimento: PLANO_DO_TIPO.procedimento,
};

/** Gravidade cadastrada (código de gravidade_interacao, ou o nível 1 a 4) → vocabulário do contrato. */
const GRAVIDADES = ['leve', 'moderada', 'grave', 'contraindicada'] as const;

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const verdadeiro = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (Buffer.isBuffer(v) && v[0] === 1);
const cboDe = (v: unknown): number => {
  const t = textoOuNull(v)?.replace(/\D/g, '') ?? '';
  return t ? Number(t) : 0;
};
/** TIME do banco (HH:MM:SS) → HHMM, a forma de horário da tela. */
const hhmm = (v: unknown): string => {
  const t = textoOuNull(v) ?? '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? `${m[1]!.padStart(2, '0')}${m[2]}` : '';
};
const dataDe = (v: unknown): string | null => {
  const t = textoOuNull(v);
  return t !== null && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};
const lista = (ids: readonly unknown[]) => ids.map(() => '?').join(',');

/**
 * Data e hora civil do estabelecimento (AAAA-MM-DDTHH:MM[:SS]) → instante UTC, sem depender do TZ do processo (a
 * diferença do fuso é medida pelo próprio formatador; na virada de horário de verão converge na segunda volta).
 */
export function instanteDoCivil(civil: string, fuso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(civil);
  if (!m)
    throw new ErroOperacao(
      400,
      'data-invalida',
      'Data inválida',
      'A data e hora do período não está no formato.',
    );
  const alvo = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  let t = alvo;
  for (let i = 0; i < 2; i++) {
    const visto = dataHora(new Date(t), fuso)!;
    const v = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(visto)!;
    const vistoUtc = Date.UTC(+v[1]!, +v[2]! - 1, +v[3]!, +v[4]!, +v[5]!, +v[6]!);
    t += alvo - vistoUtc;
  }
  return new Date(t);
}

/** Tipo de atendimento do kit (CHECK de kit_prescricao) → o da regra da prescrição (I, E; todos = null). */
const ATENDIMENTO_DO_KIT: Readonly<Record<string, string | null>> = {
  todos: null,
  internacao: 'I',
  ambulatorial: 'E',
  urgencia: 'E',
  externo: 'E',
};

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

/** Situações do item que o tiram do período (as mesmas que a leitura dos itens marca como suspenso). */
const ITEM_FORA = "('suspenso','cancelado','suspenso_correcao')";

/** Prescrição em vigor no período (liberada, não suspensa nem cancelada, do estabelecimento e não excluída). */
const PRESCRICAO_NO_PERIODO = `p.estabelecimento_id = ? AND p.excluido_em IS NULL
  AND p.situacao NOT IN ('rascunho','cancelada') AND p.suspensa_em IS NULL
  AND p.atendimento_id = ? AND p.vigencia_inicio_em <= ? AND p.vigencia_fim_em >= ?`;

/** Login do usuário ligado ao profissional (o vínculo vigente primeiro); sem vínculo, o nome de exibição. */
const loginDoProfissional = (coluna: string) => `COALESCE(
  (SELECT u.login FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id
    WHERE up.profissional_id = ${coluna} AND up.excluido_em IS NULL
    ORDER BY up.vigencia_fim IS NULL DESC, up.vigencia_inicio DESC, up.id DESC LIMIT 1),
  (SELECT pf.nome_exibicao FROM profissional pf WHERE pf.id = ${coluna}))`;

/** Chaves de parametro_definicao lidas para os parâmetros da prescrição (sem definição, vale o padrão de mercado). */
export const CHAVES_PARAMETROS_PRESCRICAO = {
  consistirDuplicidade: 'pep.prescricao.consistirDuplicidade',
  porMedicamento: 'pep.prescricao.duplicidadePorMedicamento',
  porPrincipio: 'pep.prescricao.duplicidadePorPrincipio',
  calcularVelocidade: 'pep.prescricao.calcularVelocidade',
} as const;
/** Padrão: consiste a duplicidade pelos dois critérios (o critério fino é a política `pep.prescricao.duplicidadeCriterio`). */
export const PARAMETROS_PRESCRICAO_PADRAO: ParametrosPrescricao = {
  consistirDuplicidade: true,
  porMedicamento: true,
  porPrincipio: true,
  calcularVelocidade: false,
};

export class CatalogoPrescricaoPropria {
  constructor(
    private readonly nucleo: NucleoLeituraPep,
    private readonly cliente: string,
  ) {}

  private ler<T>(
    c: ContextoPrescricao,
    rotulo: string,
    fn: (l: Leitor, est: Estabelecimento) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: c.cliente || this.cliente, correlacao: `pep.prescricao.${rotulo}` },
      async (l) => {
        const e = await l.uma<{ id: unknown; fuso_horario: unknown }>(
          'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
          [c.hospital],
        );
        if (!e)
          throw new ErroOperacao(
            404,
            'estabelecimento-inexistente',
            'Estabelecimento não encontrado',
            'O estabelecimento da sessão não existe neste cliente.',
          );
        return fn(l, { id: num(e.id), fuso: fusoValido(e.fuso_horario) });
      },
    );
  }

  // ── Horários ─────────────────────────────────────────────────────────────────────────────────────
  /**
   * Regras de horário do estabelecimento (grade_horario_unidade ativa): internação vira I e os demais tipos E; a hora
   * de início do dia vira o horário inicial; sem "considera vigência" a regra começa no minuto da prescrição
   * (considerar 3), senão no dia fixo (0). A grade de cada regra é a dos horários padrão por número de doses
   * (horario_padrao_dose: a da regra, e o que valer para o estabelecimento todo onde a regra não tiver o seu).
   * porBloco e porUnidade ligam o bloco e a unidade de internação à regra.
   */
  regras(c: ContextoPrescricao): Promise<{
    regras: RegraHorarioLida[];
    porBloco: Map<string, number>;
    porUnidade: Map<number, number>;
  }> {
    return this.ler(c, 'regras', async (l, est) => {
      const gs = await l.consultar(
        `SELECT g.id, g.tipo_atendimento, g.hora_inicio_dia, g.considera_vigencia, g.padrao,
                g.unidade_internacao_id, g.bloco_internacao_id, g.setor_funcional_id,
                ui.unidade_assistencial_id
           FROM grade_horario_unidade g
           LEFT JOIN unidade_internacao ui ON ui.id = g.unidade_internacao_id
          WHERE g.estabelecimento_id = ? AND g.ativo
          ORDER BY g.id`,
        [est.id],
      );
      const hs = await l.consultar(
        `SELECT h.grade_horario_unidade_id, h.doses_por_dia, h.horario
           FROM horario_padrao_dose h
          WHERE h.estabelecimento_id = ? AND h.ativo
          ORDER BY h.doses_por_dia, h.ordem_dose, h.id`,
        [est.id],
      );
      const grades = new Map<string, Map<number, string[]>>();
      for (const h of hs) {
        const chave =
          h['grade_horario_unidade_id'] === null ? 'geral' : String(num(h['grade_horario_unidade_id']));
        const g = grades.get(chave) ?? new Map<number, string[]>();
        const n = num(h['doses_por_dia']);
        g.set(n, [...(g.get(n) ?? []), hhmm(h['horario'])]);
        grades.set(chave, g);
      }
      const geral = grades.get('geral') ?? new Map<number, string[]>();
      // porBloco pelo id do bloco (texto); porUnidade pela unidade ASSISTENCIAL que a unidade de internação
      // especializa (1:1), a mesma que o atendimento da porta própria devolve em `unidade`. Havendo mais de uma
      // grade para o mesmo bloco ou unidade (tipos de atendimento diferentes), vale a de menor id.
      const porBloco = new Map<string, number>();
      const porUnidade = new Map<number, number>();
      const regras: RegraHorarioLida[] = gs.map((g) => {
        const id = num(g['id']);
        const bloco = g['bloco_internacao_id'] === null ? null : String(num(g['bloco_internacao_id']));
        const unidade = g['unidade_assistencial_id'] === null ? null : num(g['unidade_assistencial_id']);
        if (bloco !== null && !porBloco.has(bloco)) porBloco.set(bloco, id);
        if (unidade !== null && !porUnidade.has(unidade)) porUnidade.set(unidade, id);
        // Só a grade geral do estabelecimento (sem unidade, bloco nem setor) é candidata a padrão do tipo: uma grade
        // de unidade marcada como padrão não vira a grade do estabelecimento inteiro.
        const geralDoEstabelecimento =
          g['unidade_internacao_id'] === null &&
          g['bloco_internacao_id'] === null &&
          g['setor_funcional_id'] === null;
        const propria = grades.get(String(id)) ?? new Map<number, string[]>();
        return {
          id,
          tipoAtendimento: g['tipo_atendimento'] === 'internacao' ? 'I' : 'E',
          horarioInicial: hhmm(g['hora_inicio_dia']) || null,
          considerar: verdadeiro(g['considera_vigencia']) ? 0 : 3,
          padrao: geralDoEstabelecimento && verdadeiro(g['padrao']),
          grade: new Map([...geral, ...propria]),
        };
      });
      return { regras, porBloco, porUnidade };
    });
  }

  /** Horários relativos ativos (café, almoço...): id, descrição e horário de referência (HHMM). */
  relativos(c: ContextoPrescricao): Promise<{ id: number; nome: string; horario: string }[]> {
    return this.ler(c, 'relativos', async (l) => {
      const ls = await l.consultar(
        `SELECT r.id, r.descricao, r.horario_referencia
           FROM frequencia_horario_relativo r
          WHERE r.ativo AND r.excluido_em IS NULL
          ORDER BY r.horario_referencia, r.sequencia, r.id`,
      );
      return ls.map((x) => ({
        id: num(x['id']),
        nome: String(x['descricao']),
        horario: hhmm(x['horario_referencia']),
      }));
    });
  }

  /**
   * Horários de cada dieta (modalidade_dieta) no estabelecimento: as refeições ligadas à modalidade
   * (modalidade_dieta_refeicao) no horário de início da refeição (horario_refeicao geral da refeição ou o próprio da
   * modalidade), sem os de uma unidade de internação específica; em ordem, sem repetição.
   */
  horariosDieta(c: ContextoPrescricao): Promise<Map<number, string[]>> {
    return this.ler(c, 'horariosDieta', async (l, est) => {
      const ls = await l.consultar(
        `SELECT DISTINCT x.modalidade_dieta_id, x.horario_inicio FROM (
            SELECT mr.modalidade_dieta_id, hr.horario_inicio
              FROM modalidade_dieta_refeicao mr
              JOIN horario_refeicao hr ON hr.refeicao_do_dia_id = mr.refeicao_do_dia_id AND hr.ativo
               AND hr.estabelecimento_id = mr.estabelecimento_id AND hr.unidade_internacao_id IS NULL
               AND (hr.modalidade_dieta_id IS NULL OR hr.modalidade_dieta_id = mr.modalidade_dieta_id)
             WHERE mr.estabelecimento_id = ? AND mr.ativo AND mr.excluido_em IS NULL
            UNION
            SELECT hr.modalidade_dieta_id, hr.horario_inicio
              FROM horario_refeicao hr
             WHERE hr.estabelecimento_id = ? AND hr.ativo AND hr.unidade_internacao_id IS NULL
               AND hr.modalidade_dieta_id IS NOT NULL) x
          ORDER BY x.modalidade_dieta_id, x.horario_inicio`,
        [est.id, est.id],
      );
      const m = new Map<number, string[]>();
      for (const x of ls) {
        const d = num(x['modalidade_dieta_id']);
        m.set(d, [...(m.get(d) ?? []), hhmm(x['horario_inicio'])]);
      }
      return m;
    });
  }

  // ── Domínios da tela ─────────────────────────────────────────────────────────────────────────────
  /**
   * Listas da tela de prescrever, com as mesmas chaves da porta de memória. Via e unidade vão pela sigla (a mesma
   * que a leitura dos itens devolve); os demais pelo id. Sem cadastro próprio no modelo (motivos do "se necessário",
   * unidades de resposta), lista vazia.
   */
  dominios(c: ContextoPrescricao): Promise<Record<string, OpcaoDominio[]>> {
    return this.ler(c, 'dominios', async (l) => {
      const ops = async (sql: string): Promise<OpcaoDominio[]> =>
        (await l.consultar(sql)).map((x) => ({
          id: String(x['id']),
          nome: String(x['nome']),
          ...(x['grupo'] !== undefined ? { grupo: textoOuNull(x['grupo']) } : {}),
        }));
      return {
        vias: await ops(
          `SELECT COALESCE(sigla, descricao) AS id, descricao AS nome FROM via_de_uso WHERE ativo
            ORDER BY ordem IS NULL, ordem, descricao, id`,
        ),
        unidades: await ops(
          `SELECT sigla AS id, descricao AS nome FROM unidade_prescricao WHERE ativo AND permite_prescricao
            ORDER BY sigla, id`,
        ),
        motivos: [],
        dietas: await ops(
          `SELECT id, descricao AS nome, classe AS grupo FROM modalidade_dieta WHERE ativo
            ORDER BY ordem IS NULL, ordem, descricao, id`,
        ),
        viasDieta: await ops(
          `SELECT id, descricao AS nome FROM via_dieta WHERE ativo ORDER BY descricao, id`,
        ),
        procedimentos: await ops(
          `SELECT ip.id, ip.descricao AS nome FROM item_prescritivel ip
             JOIN tipo_item_prescricao t ON t.id = ip.tipo_item_prescricao_id
            WHERE t.categoria IN ('procedimento','cuidado') AND ip.ativo AND NOT ip.bloqueado AND ip.excluido_em IS NULL
            ORDER BY ip.descricao, ip.id`,
        ),
        caracteristicas: await ops(
          `SELECT id, descricao AS nome FROM caracteristica_dieta WHERE ativo ORDER BY descricao, id`,
        ),
        tiposInfusao: await ops(
          `SELECT id, descricao AS nome FROM tipo_infusao WHERE ativo ORDER BY descricao, id`,
        ),
        unidadesInfusao: await ops(
          `SELECT id, COALESCE(sigla, descricao) AS nome FROM unidade_infusao WHERE ativo ORDER BY descricao, id`,
        ),
        viasAereas: await ops(
          `SELECT id, descricao AS nome FROM via_aerea WHERE ativo ORDER BY descricao, id`,
        ),
        modos: await ops(
          `SELECT id, descricao AS nome, IF(ventilacao_controlada, 'controlada', 'assistida') AS grupo
             FROM modo_ventilatorio WHERE ativo ORDER BY descricao, id`,
        ),
        hemocomponentes: await ops(
          `SELECT id, descricao AS nome FROM hemocomponente WHERE ativo ORDER BY descricao, id`,
        ),
        unidadesResposta: [],
      };
    });
  }

  // ── Produtos ─────────────────────────────────────────────────────────────────────────────────────
  private async produtosDe(
    l: Leitor,
    est: Estabelecimento,
    filtro: string,
    p: unknown[],
  ): Promise<ProdutoLido[]> {
    const ls = await l.consultar(
      `SELECT ip.id, ip.descricao, up.sigla AS unidade, ip.padronizado, ip.controlado, ip.antimicrobiano,
              ip.alta_vigilancia, ip.validade_horas, ip.principio_ativo_id, ip.insumo_id,
              COALESCE(v.sigla, v.descricao) AS via_padrao
         FROM item_prescritivel ip
         JOIN tipo_item_prescricao t ON t.id = ip.tipo_item_prescricao_id
         LEFT JOIN unidade_prescricao up ON up.id = ip.unidade_prescricao_id
         LEFT JOIN via_de_uso v ON v.id = ip.via_de_uso_id
        WHERE ip.excluido_em IS NULL AND ${filtro}
        ORDER BY ip.descricao, ip.id`,
      p,
      { teto: 100_000 },
    );
    if (ls.length === 0) return [];
    const ids = ls.map((x) => num(x['id']));
    const ph = lista(ids);
    // Princípios: o do item e os do insumo ligado (insumo_principio_ativo), sem repetir; a lista de controle especial
    // (portaria) vem do princípio.
    const princ = await l.consultar(
      `SELECT x.item, pa.id, pa.descricao, lce.codigo_lista FROM (
          SELECT ip.id AS item, ip.principio_ativo_id AS principio, 0 AS ordem FROM item_prescritivel ip
           WHERE ip.id IN (${ph}) AND ip.principio_ativo_id IS NOT NULL
          UNION
          SELECT ip.id, ipa.principio_ativo_id, IF(ipa.principal, 1, 2) FROM item_prescritivel ip
            JOIN insumo_principio_ativo ipa ON ipa.insumo_id = ip.insumo_id AND ipa.excluido_em IS NULL
           WHERE ip.id IN (${ph})) x
         JOIN principio_ativo pa ON pa.id = x.principio
         LEFT JOIN lista_controle_especial lce ON lce.id = pa.lista_controle_especial_id
        ORDER BY x.item, x.ordem, pa.id`,
      [...ids, ...ids],
      { teto: 100_000 },
    );
    const vias = await l.consultar(
      `SELECT iv.item_prescritivel_id AS item, COALESCE(v.sigla, v.descricao) AS via
         FROM item_prescritivel_via iv JOIN via_de_uso v ON v.id = iv.via_de_uso_id AND v.ativo
        WHERE iv.item_prescritivel_id IN (${ph}) AND iv.excluido_em IS NULL
        ORDER BY iv.item_prescritivel_id, iv.uso_frequente DESC, v.ordem IS NULL, v.ordem, iv.id`,
      ids,
      { teto: 100_000 },
    );
    // Faixa de dose por dose (não por dia nem tratamento, sem recorte de idade, peso ou setor): a do item e a dos
    // princípios do item (o do próprio item e os do insumo ligado, como na lista de princípios acima), do
    // estabelecimento ou de todos; alerta mínimo e máximo na unidade de prescrição. Cada limite sai uma vez só.
    const faixas = await l.consultar(
      `SELECT ip.id AS item, up.sigla AS unidade, ld.dose_minima_alerta, ld.dose_maxima_alerta
         FROM item_prescritivel ip
         JOIN limite_dose_principio ld ON (ld.item_prescritivel_id = ip.id
              OR (ld.item_prescritivel_id IS NULL AND (ld.principio_ativo_id = ip.principio_ativo_id
                  OR ld.principio_ativo_id IN (SELECT ipa.principio_ativo_id FROM insumo_principio_ativo ipa
                                                WHERE ipa.insumo_id = ip.insumo_id AND ipa.excluido_em IS NULL))))
         JOIN unidade_prescricao up ON up.id = ld.unidade_prescricao_id
        WHERE ip.id IN (${ph}) AND ld.ativo AND ld.periodo = 'dose' AND NOT ld.por_peso
          AND (ld.estabelecimento_id IS NULL OR ld.estabelecimento_id = ?) AND ld.setor_funcional_id IS NULL
          AND ld.idade_minima_dias IS NULL AND ld.idade_maxima_dias IS NULL
          AND ld.peso_minimo_kg IS NULL AND ld.peso_maximo_kg IS NULL
          AND (ld.dose_minima_alerta IS NOT NULL OR ld.dose_maxima_alerta IS NOT NULL)
        ORDER BY ip.id, ld.item_prescritivel_id IS NULL, ld.id`,
      [...ids, est.id],
      { teto: 100_000 },
    );
    const agrupa = <T>(rows: Record<string, unknown>[], f: (x: Record<string, unknown>) => T) => {
      const m = new Map<number, T[]>();
      for (const x of rows) m.set(num(x['item']), [...(m.get(num(x['item'])) ?? []), f(x)]);
      return m;
    };
    const pr = agrupa(princ, (x) => ({
      id: num(x['id']),
      nome: String(x['descricao']),
      lista: textoOuNull(x['codigo_lista']),
    }));
    const vs = agrupa(vias, (x) => String(x['via']));
    const fx = agrupa(faixas, (x) => ({
      unidade: String(x['unidade']),
      minima: numOuNull(x['dose_minima_alerta']),
      maxima: numOuNull(x['dose_maxima_alerta']),
    }));
    return ls.map((x) => {
      const id = num(x['id']);
      const ps = pr.get(id) ?? [];
      const viasDoItem = [
        ...new Set([...(vs.get(id) ?? []), ...(x['via_padrao'] === null ? [] : [String(x['via_padrao'])])]),
      ];
      const portaria = ps.find((p) => p.lista !== null)?.lista ?? null;
      return {
        produto: id,
        nome: String(x['descricao']),
        unidade: textoOuNull(x['unidade']),
        padronizado: verdadeiro(x['padronizado']),
        psicotropico: verdadeiro(x['controlado']) || portaria !== null,
        portaria,
        antimicrobiano: verdadeiro(x['antimicrobiano']),
        principios: ps.map((p) => ({ id: p.id, nome: p.nome })),
        vias: viasDoItem,
        potencialmentePerigoso: verdadeiro(x['alta_vigilancia']),
        periodoMinimoHoras: null,
        faixasDose: fx.get(id) ?? [],
      };
    });
  }

  /** Produtos pedidos (item_prescritivel por id, não excluídos), com princípios, vias e faixas de dose. */
  produtos(c: ContextoPrescricao, ids: readonly number[]): Promise<ProdutoLido[]> {
    const validos = [...new Set(ids)].filter((x) => Number.isSafeInteger(x) && x > 0);
    if (validos.length === 0) return Promise.resolve([]);
    return this.ler(c, 'produtos', (l, est) =>
      this.produtosDe(l, est, `ip.id IN (${lista(validos)})`, validos),
    );
  }

  /** O índice de busca: os itens prescritíveis por produto, ativos e não bloqueados (materiais e cuidados fora). */
  itensParaIndice(c: ContextoPrescricao): Promise<ItemDoIndice[]> {
    return this.ler(c, 'itensParaIndice', async (l, est) => {
      const ps = await this.produtosDe(
        l,
        est,
        `ip.ativo AND NOT ip.bloqueado AND t.categoria IN (${lista([...CATEGORIAS_DE_PRODUTO])})`,
        [...CATEGORIAS_DE_PRODUTO],
      );
      return ps.map((p): ItemDoIndice => ({
        produto: p.produto,
        nome: p.nome,
        unidade: p.unidade,
        padronizado: p.padronizado,
        psicotropico: p.psicotropico,
        portaria: p.portaria,
        antimicrobiano: p.antimicrobiano,
        potencialmentePerigoso: p.potencialmentePerigoso,
        principios: p.principios,
        faixasDose: p.faixasDose,
      }));
    });
  }

  /** Kits de medicamento do produto (kit_prescricao de medicamento ativo): faixa de dose, unidade, via e componentes. */
  kits(c: ContextoPrescricao, produto: number): Promise<KitMedicamentoLido[]> {
    return this.ler(c, 'kits', async (l) => {
      const ks = await l.consultar(
        `SELECT k.id, k.item_prescritivel_id, k.intervalo_dose_inicial, k.intervalo_dose_final, k.tipo_atendimento,
                up.sigla AS unidade, COALESCE(v.sigla, v.descricao) AS via
           FROM kit_prescricao k
           LEFT JOIN unidade_prescricao up ON up.id = k.unidade_prescricao_id
           LEFT JOIN via_de_uso v ON v.id = k.via_de_uso_id
          WHERE k.item_prescritivel_id = ? AND k.tipo_kit = 'medicamento' AND k.ativo AND k.excluido_em IS NULL
          ORDER BY k.id`,
        [produto],
      );
      if (ks.length === 0) return [];
      const ids = ks.map((k) => num(k['id']));
      const its = await l.consultar(
        `SELECT ki.kit_prescricao_id, ki.item_prescritivel_id, ki.quantidade, up.sigla AS unidade
           FROM kit_prescricao_item ki JOIN unidade_prescricao up ON up.id = ki.unidade_prescricao_id
          WHERE ki.kit_prescricao_id IN (${lista(ids)}) AND ki.excluido_em IS NULL AND ki.papel <> 'principal'
            AND ki.item_prescritivel_id IS NOT NULL
          ORDER BY ki.kit_prescricao_id, ki.sequencia, ki.id`,
        ids,
      );
      return ks.map((k) => ({
        id: num(k['id']),
        produto: num(k['item_prescritivel_id']),
        doseDe: numOuNull(k['intervalo_dose_inicial']) ?? 0,
        doseAte: numOuNull(k['intervalo_dose_final']) ?? 0,
        unidade: textoOuNull(k['unidade']) ?? '',
        via: textoOuNull(k['via']) ?? '',
        tipoAtendimento: ATENDIMENTO_DO_KIT[String(k['tipo_atendimento'])] ?? null,
        itens: its
          .filter((i) => num(i['kit_prescricao_id']) === num(k['id']))
          .map((i) => ({
            produto: num(i['item_prescritivel_id']),
            quantidade: num(i['quantidade']),
            unidade: String(i['unidade']),
          })),
      }));
    });
  }

  // ── Cadastros em consulta ────────────────────────────────────────────────────────────────────────
  /** Uma seção do cadastro da prescrição filtrada pelo termo (no nome), até o teto; acima dele, `truncada`. */
  cadastro(
    c: ContextoPrescricao,
    secao: SecaoCadastroPrescricao,
    termo: string | undefined,
  ): Promise<ConsultaCadastroLida> {
    const t = (termo ?? '').trim();
    if (secao === 'parametrosItem' && t.length < 2) return Promise.resolve({ linhas: [], truncada: false });
    return this.ler(c, `cadastro.${secao}`, async (l, est) => {
      const like = `%${t.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
      const corte = (ls: Record<string, unknown>[]) => ({
        ls: ls.slice(0, TETO_CADASTRO),
        truncada: ls.length > TETO_CADASTRO,
      });
      const filhosDoKit = async (ids: number[]) =>
        ids.length === 0
          ? []
          : l.consultar(
              `SELECT ki.kit_prescricao_id AS dono, COALESCE(ip.descricao, ins.nome) AS nome, ki.quantidade,
                      up.sigla AS unidade, ki.papel
                 FROM kit_prescricao_item ki
                 JOIN unidade_prescricao up ON up.id = ki.unidade_prescricao_id
                 LEFT JOIN item_prescritivel ip ON ip.id = ki.item_prescritivel_id
                 LEFT JOIN insumo ins ON ins.id = ki.insumo_id
                WHERE ki.kit_prescricao_id IN (${lista(ids)}) AND ki.excluido_em IS NULL
                ORDER BY ki.kit_prescricao_id, ki.sequencia, ki.id`,
              ids,
              { teto: 100_000 },
            );
      const doDono = (fs: Record<string, unknown>[], id: number) => fs.filter((f) => num(f['dono']) === id);
      switch (secao) {
        case 'kitsMedicamento': {
          const { ls, truncada } = corte(
            await l.consultar(
              `SELECT k.id, COALESCE(ip.descricao, k.nome) AS nome, k.ativo, k.intervalo_dose_inicial,
                      k.intervalo_dose_final, up.sigla AS unidade, COALESCE(v.sigla, v.descricao) AS via,
                      k.tipo_atendimento
                 FROM kit_prescricao k
                 LEFT JOIN item_prescritivel ip ON ip.id = k.item_prescritivel_id
                 LEFT JOIN unidade_prescricao up ON up.id = k.unidade_prescricao_id
                 LEFT JOIN via_de_uso v ON v.id = k.via_de_uso_id
                WHERE k.tipo_kit = 'medicamento' AND k.excluido_em IS NULL AND COALESCE(ip.descricao, k.nome) LIKE ?
                ORDER BY nome, k.id LIMIT ${TETO_CADASTRO + 1}`,
              [like],
            ),
          );
          const fs = await filhosDoKit(ls.map((x) => num(x['id'])));
          const atend = (v: unknown) => ({ todos: 'A', internacao: 'I' })[String(v)] ?? 'E';
          return {
            truncada,
            linhas: ls.map((k) => ({
              id: String(num(k['id'])),
              nome: String(k['nome']),
              ativo: verdadeiro(k['ativo']),
              campos: {
                doseDe: numOuNull(k['intervalo_dose_inicial']) ?? 0,
                doseAte: numOuNull(k['intervalo_dose_final']) ?? 0,
                unidade: textoOuNull(k['unidade']),
                via: textoOuNull(k['via']),
                atendimento: atend(k['tipo_atendimento']),
              },
              filhos: doDono(fs, num(k['id']))
                .filter((f) => f['papel'] !== 'principal')
                .map((f) => ({
                  nome: String(f['nome']),
                  campos: { quantidade: num(f['quantidade']), unidade: String(f['unidade']) },
                })),
            })),
          };
        }
        case 'kitsSolucao': {
          const { ls, truncada } = corte(
            await l.consultar(
              `SELECT k.id, k.nome, k.ativo, f.descricao AS frequencia, v.descricao AS via,
                      k.iniciar_administracao_agora, k.velocidade_infusao, ti.descricao AS infusao
                 FROM kit_prescricao k
                 LEFT JOIN frequencia_administracao f ON f.id = k.frequencia_administracao_id
                 LEFT JOIN via_de_uso v ON v.id = k.via_de_uso_id
                 LEFT JOIN tipo_infusao ti ON ti.id = k.tipo_infusao_id
                WHERE k.tipo_kit = 'solucao' AND k.excluido_em IS NULL AND k.nome LIKE ?
                ORDER BY k.nome, k.id LIMIT ${TETO_CADASTRO + 1}`,
              [like],
            ),
          );
          const fs = await filhosDoKit(ls.map((x) => num(x['id'])));
          return {
            truncada,
            linhas: ls.map((k) => ({
              id: String(num(k['id'])),
              nome: String(k['nome']),
              ativo: verdadeiro(k['ativo']),
              campos: {
                frequencia: textoOuNull(k['frequencia']),
                via: textoOuNull(k['via']),
                agora: verdadeiro(k['iniciar_administracao_agora']),
                velocidade: numOuNull(k['velocidade_infusao']),
                infusao: textoOuNull(k['infusao']),
              },
              filhos: doDono(fs, num(k['id'])).map((f) => ({
                nome: String(f['nome']),
                campos: {
                  quantidade: num(f['quantidade']),
                  unidade: String(f['unidade']),
                  principal: f['papel'] === 'principal',
                },
              })),
            })),
          };
        }
        case 'receitasPadrao': {
          const { ls, truncada } = corte(
            await l.consultar(
              `SELECT pp.id, pp.nome, pp.ativo, pp.uso_geral,
                      DATE_FORMAT(pp.vigencia_inicio, '%Y-%m-%d') AS inicio,
                      DATE_FORMAT(pp.vigencia_fim, '%Y-%m-%d') AS fim
                 FROM protocolo_prescricao pp
                WHERE pp.tipo = 'prescricao_padrao' AND pp.excluido_em IS NULL
                  AND (pp.estabelecimento_id IS NULL OR pp.estabelecimento_id = ?) AND pp.nome LIKE ?
                ORDER BY pp.nome, pp.id LIMIT ${TETO_CADASTRO + 1}`,
              [est.id, like],
            ),
          );
          return {
            truncada,
            linhas: ls.map((x) => ({
              id: String(num(x['id'])),
              nome: String(x['nome']),
              ativo: verdadeiro(x['ativo']),
              campos: {
                geral: verdadeiro(x['uso_geral']),
                vigenteDesde: dataDe(x['inicio']),
                vigenteAte: dataDe(x['fim']),
              },
              filhos: [],
            })),
          };
        }
        case 'naoPadronizados': {
          const { ls, truncada } = corte(
            await l.consultar(
              `SELECT ip.id, ip.descricao AS nome, ip.ativo, up.sigla AS unidade, t.descricao AS plano
                 FROM item_prescritivel ip
                 JOIN tipo_item_prescricao t ON t.id = ip.tipo_item_prescricao_id
                 LEFT JOIN unidade_prescricao up ON up.id = ip.unidade_prescricao_id
                WHERE NOT ip.padronizado AND ip.excluido_em IS NULL AND ip.descricao LIKE ?
                ORDER BY ip.descricao, ip.id LIMIT ${TETO_CADASTRO + 1}`,
              [like],
            ),
          );
          const ids = ls.map((x) => num(x['id']));
          const fs =
            ids.length === 0
              ? []
              : await l.consultar(
                  `SELECT iv.item_prescritivel_id AS dono, v.descricao AS nome, 'via' AS tipo, 0 AS ordem, iv.id
                     FROM item_prescritivel_via iv JOIN via_de_uso v ON v.id = iv.via_de_uso_id
                    WHERE iv.item_prescritivel_id IN (${lista(ids)}) AND iv.excluido_em IS NULL
                   UNION ALL
                   SELECT ip.id, pa.descricao, 'principio', 1, pa.id
                     FROM item_prescritivel ip JOIN principio_ativo pa ON pa.id = ip.principio_ativo_id
                    WHERE ip.id IN (${lista(ids)})
                   ORDER BY dono, ordem, id`,
                  [...ids, ...ids],
                  { teto: 100_000 },
                );
          return {
            truncada,
            linhas: ls.map((x) => ({
              id: String(num(x['id'])),
              nome: String(x['nome']),
              ativo: verdadeiro(x['ativo']),
              campos: { unidade: textoOuNull(x['unidade']), plano: textoOuNull(x['plano']) },
              filhos: doDono(fs, num(x['id'])).map((f) => ({
                nome: String(f['nome']),
                campos: { tipo: String(f['tipo']) },
              })),
            })),
          };
        }
        case 'parametrosItem': {
          const { ls, truncada } = corte(
            await l.consultar(
              `SELECT ip.id, ip.descricao AS nome, ip.ativo, ip.alta_vigilancia, ip.tipo_balanco_hidrico,
                      ip.observacao_adicional,
                      EXISTS (SELECT 1 FROM limite_dose_principio ld WHERE ld.ativo
                               AND (ld.item_prescritivel_id = ip.id OR ld.principio_ativo_id = ip.principio_ativo_id)
                               AND (ld.estabelecimento_id IS NULL OR ld.estabelecimento_id = ?)) AS consiste_dose
                 FROM item_prescritivel ip
                 JOIN tipo_item_prescricao t ON t.id = ip.tipo_item_prescricao_id
                WHERE t.categoria IN (${lista([...CATEGORIAS_DE_PRODUTO])}) AND ip.excluido_em IS NULL
                  AND ip.descricao LIKE ?
                ORDER BY ip.descricao, ip.id LIMIT ${TETO_CADASTRO + 1}`,
              [est.id, ...CATEGORIAS_DE_PRODUTO, like],
            ),
          );
          return {
            truncada,
            linhas: ls.map((x) => ({
              id: String(num(x['id'])),
              nome: String(x['nome']),
              ativo: verdadeiro(x['ativo']),
              campos: {
                altaVigilancia: verdadeiro(x['alta_vigilancia']),
                consistirDose: verdadeiro(x['consiste_dose']) ? 1 : 0,
                informacaoComplementar: x['observacao_adicional'] === null ? 0 : 1,
                doseAcima24h: false,
                periodoMinimoHoras: null,
                acessoInvasivo: false,
                permanenciaInvasivo: 0,
                balancoHidrico: x['tipo_balanco_hidrico'] !== null,
                ncm: null,
                excecaoTipi: null,
                genero: null,
              },
              filhos: [],
            })),
          };
        }
      }
      return { linhas: [], truncada: false };
    });
  }

  // ── Protocolos ───────────────────────────────────────────────────────────────────────────────────
  /** Protocolos de prescrição do estabelecimento (ou de todos), com critérios, especialidades e o número de itens. */
  protocolos(c: ContextoPrescricao): Promise<ProtocoloLido[]> {
    return this.ler(c, 'protocolos', async (l, est) => {
      const ls = await l.consultar(
        `SELECT pp.id, pp.nome, pp.ativo, DATE_FORMAT(pp.vigencia_inicio, '%Y-%m-%d') AS inicio,
                DATE_FORMAT(pp.vigencia_fim, '%Y-%m-%d') AS fim, pp.idade_minima_anos, pp.idade_maxima_anos,
                pp.peso_minimo_kg, pp.peso_maximo_kg, pp.sexo,
                (SELECT COUNT(*) FROM protocolo_prescricao_item i WHERE i.protocolo_prescricao_id = pp.id
                   AND i.ativo AND i.excluido_em IS NULL AND i.componente_de_protocolo_prescricao_item_id IS NULL) AS itens
           FROM protocolo_prescricao pp
          WHERE pp.tipo = 'protocolo' AND pp.excluido_em IS NULL
            AND (pp.estabelecimento_id IS NULL OR pp.estabelecimento_id = ?)
          ORDER BY pp.nome, pp.id`,
        [est.id],
        { teto: 100_000 },
      );
      if (ls.length === 0) return [];
      const ids = ls.map((x) => num(x['id']));
      const esp = await l.consultar(
        `SELECT protocolo_prescricao_id AS p, especialidade_medica_id AS e FROM protocolo_prescricao_especialidade
          WHERE protocolo_prescricao_id IN (${lista(ids)}) AND excluido_em IS NULL
          ORDER BY protocolo_prescricao_id, especialidade_medica_id`,
        ids,
        { teto: 100_000 },
      );
      return ls.map((x) => {
        const id = num(x['id']);
        const sexo = String(x['sexo']);
        return {
          id,
          nome: String(x['nome']),
          ativo: verdadeiro(x['ativo']),
          vigenciaInicio: dataDe(x['inicio']),
          vigenciaFim: dataDe(x['fim']),
          idadeMin: numOuNull(x['idade_minima_anos']),
          idadeMax: numOuNull(x['idade_maxima_anos']),
          pesoMin: numOuNull(x['peso_minimo_kg']),
          pesoMax: numOuNull(x['peso_maximo_kg']),
          sexo: sexo === 'feminino' ? 'F' : sexo === 'masculino' ? 'M' : null,
          especialidades: esp.filter((e) => num(e['p']) === id).map((e) => num(e['e'])),
          itens: num(x['itens']),
        };
      });
    });
  }

  /**
   * Especialidades médicas do profissional do login (vínculo vigente): as do profissional (profissional_especialidade
   * ativa) e as das ocupações ativas (especialidade_ocupacao), sem repetir, em ordem.
   */
  especialidadesDoPrescritor(c: ContextoPrescricao, login: string): Promise<number[]> {
    return this.ler(c, 'especialidadesDoPrescritor', async (l) => {
      const ls = await l.consultar(
        `SELECT DISTINCT x.e FROM (
            SELECT pe.especialidade_medica_id AS e
              FROM usuario u
              JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
               AND up.vigencia_inicio <= CURRENT_DATE AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)
              JOIN profissional_especialidade pe ON pe.profissional_id = up.profissional_id AND pe.ativo
               AND pe.excluido_em IS NULL
             WHERE u.login = ? AND u.excluido_em IS NULL
            UNION
            SELECT eo.especialidade_medica_id
              FROM usuario u
              JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
               AND up.vigencia_inicio <= CURRENT_DATE AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)
              JOIN profissional_ocupacao po ON po.profissional_id = up.profissional_id AND po.ativo
               AND po.excluido_em IS NULL
              JOIN especialidade_ocupacao eo ON eo.ocupacao_cbo_id = po.ocupacao_cbo_id AND eo.excluido_em IS NULL
             WHERE u.login = ? AND u.excluido_em IS NULL) x
          ORDER BY x.e`,
        [login, login],
      );
      return ls.map((x) => num(x['e']));
    });
  }

  /**
   * Itens do protocolo (ativos, sem os componentes), na forma de item lido sem horários: o medicamento com o item
   * prescritível vira detalhe de medicamento (dose padrão, unidade e princípio); os demais, detalhe "outro".
   */
  itensDoProtocolo(c: ContextoPrescricao, protocolo: number): Promise<ItemPrescricaoLido[]> {
    return this.ler(c, 'itensDoProtocolo', async (l, est) => {
      const ls = await l.consultar(
        `SELECT i.id, i.protocolo_prescricao_id, i.tipo_item, i.item_prescritivel_id, i.quantidade, i.dose_padrao,
                i.urgente, i.observacao, i.frequencia_administracao_id, f.descricao AS frequencia_nome,
                f.doses_por_dia, COALESCE(v.sigla, v.descricao) AS via, up.sigla AS unidade,
                ip.descricao AS produto_nome, ip.principio_ativo_id, t.id AS tipo_id, t.categoria, t.descricao AS tipo_nome
           FROM protocolo_prescricao_item i
           JOIN protocolo_prescricao pp ON pp.id = i.protocolo_prescricao_id
           LEFT JOIN item_prescritivel ip ON ip.id = i.item_prescritivel_id
           LEFT JOIN tipo_item_prescricao t ON t.id = ip.tipo_item_prescricao_id
           LEFT JOIN frequencia_administracao f ON f.id = i.frequencia_administracao_id
           LEFT JOIN via_de_uso v ON v.id = i.via_de_uso_id
           LEFT JOIN unidade_prescricao up ON up.id = i.unidade_prescricao_id
          WHERE i.protocolo_prescricao_id = ? AND pp.excluido_em IS NULL
            AND (pp.estabelecimento_id IS NULL OR pp.estabelecimento_id = ?)
            AND i.ativo AND i.excluido_em IS NULL AND i.componente_de_protocolo_prescricao_item_id IS NULL
          ORDER BY i.sequencia, i.id`,
        [protocolo, est.id],
      );
      return ls.map((x): ItemPrescricaoLido => {
        const tipoItem = String(x['tipo_item']);
        const categoria = textoOuNull(x['categoria']) ?? tipoItem;
        const plano =
          PLANO_DA_CATEGORIA[categoria] ??
          (x['tipo_id'] === null ? BASE_PLANO_PROPRIO : BASE_PLANO_PROPRIO + num(x['tipo_id']));
        const medicamento = tipoItem === 'medicamento' && x['item_prescritivel_id'] !== null;
        return {
          id: num(x['id']),
          prescricao: num(x['protocolo_prescricao_id']),
          plano,
          planoNome: textoOuNull(x['tipo_nome']),
          numDoses: numOuNull(x['doses_por_dia']),
          frequencia: numOuNull(x['frequencia_administracao_id']),
          frequenciaNome: textoOuNull(x['frequencia_nome']),
          via: textoOuNull(x['via']),
          observacaoEnfermagem: textoOuNull(x['observacao']),
          cboLancamento: 0,
          incluidoEm: null,
          corrigidoEm: null,
          gravacao: null,
          detalhe: medicamento
            ? {
                tipo: 'medicamento',
                id: num(x['id']),
                produto: num(x['item_prescritivel_id']),
                produtoNome: textoOuNull(x['produto_nome']),
                dose: numOuNull(x['dose_padrao']) ?? numOuNull(x['quantidade']),
                unidade: textoOuNull(x['unidade']),
                agora: verdadeiro(x['urgente']),
                naoAjustar: false,
                motivosSeNecessario: [],
                justificativaNaoPadronizado: null,
                justificativaAlergia: null,
                principios: x['principio_ativo_id'] === null ? [] : [num(x['principio_ativo_id'])],
              }
            : { tipo: 'outro', id: null },
          horarios: [],
        };
      });
    });
  }

  // ── Período do atendimento ───────────────────────────────────────────────────────────────────────
  /**
   * Medicamentos em uso no atendimento no período (para a duplicidade): itens de medicamento das prescrições em vigor
   * que se sobrepõem a [inicio, fim] (hora local do estabelecimento), fora os suspensos, cancelados e o `exceto`.
   */
  produtosAtivos(
    c: ContextoPrescricao,
    atendimento: number,
    inicio: string,
    fim: string,
    exceto: number | null,
  ): Promise<{ item: number; produto: number; plano: number }[]> {
    return this.ler(c, 'produtosAtivos', async (l, est) => {
      const ate = instanteDoCivil(`${fim.slice(0, 16)}:59`, est.fuso);
      const desde = instanteDoCivil(inicio.slice(0, 16), est.fuso);
      const ls = await l.consultar(
        `SELECT i.id, COALESCE(m.item_prescritivel_id, i.item_prescritivel_id) AS produto, t.categoria,
                t.id AS tipo_id
           FROM prescricao p
           JOIN prescricao_item i ON i.prescricao_id = p.id AND i.excluido_em IS NULL AND i.situacao NOT IN ${ITEM_FORA}
           JOIN prescricao_item_medicamento m ON m.prescricao_item_id = i.id AND m.excluido_em IS NULL
           JOIN tipo_item_prescricao t ON t.id = i.tipo_item_prescricao_id
          WHERE ${PRESCRICAO_NO_PERIODO} AND (? IS NULL OR i.id <> ?)
          ORDER BY p.prescrito_em, p.id, i.sequencia, i.id`,
        [est.id, atendimento, ate, desde, exceto, exceto],
      );
      return ls.map((x) => ({
        item: num(x['id']),
        produto: numOuNull(x['produto']) ?? 0,
        plano: PLANO_DA_CATEGORIA[String(x['categoria'])] ?? BASE_PLANO_PROPRIO + num(x['tipo_id']),
      }));
    });
  }

  /**
   * Dieta em vigor no período prescrita por outra ocupação (CBO diferente do prescritor): a mais recente, com o login
   * de quem prescreveu; nenhuma, null.
   */
  dietaDeOutro(
    c: ContextoPrescricao,
    atendimento: number,
    inicio: string,
    fim: string,
    cbo: number,
  ): Promise<{ autor: string; prescricao: number; item: number } | null> {
    return this.ler(c, 'dietaDeOutro', async (l, est) => {
      const ate = instanteDoCivil(`${fim.slice(0, 16)}:59`, est.fuso);
      const desde = instanteDoCivil(inicio.slice(0, 16), est.fuso);
      const ls = await l.consultar(
        `SELECT p.id AS prescricao, i.id AS item, o.codigo_cbo,
                ${loginDoProfissional('p.prescritor_profissional_id')} AS autor
           FROM prescricao p
           JOIN prescricao_item i ON i.prescricao_id = p.id AND i.excluido_em IS NULL AND i.situacao NOT IN ${ITEM_FORA}
           JOIN tipo_item_prescricao t ON t.id = i.tipo_item_prescricao_id AND t.categoria = 'dieta'
           LEFT JOIN ocupacao_cbo o ON o.id = p.ocupacao_cbo_id
          WHERE ${PRESCRICAO_NO_PERIODO}
          ORDER BY p.prescrito_em DESC, p.id DESC, i.sequencia, i.id`,
        [est.id, atendimento, ate, desde],
      );
      const x = ls.find((r) => cboDe(r['codigo_cbo']) !== cbo);
      return x
        ? { autor: textoOuNull(x['autor']) ?? '', prescricao: num(x['prescricao']), item: num(x['item']) }
        : null;
    });
  }

  // ── Parâmetros, regras de alerta e interações ────────────────────────────────────────────────────
  /**
   * Parâmetros da prescrição pelo cadastro tipado de parâmetros (o valor do estabelecimento antes do da rede; sem
   * valor, o padrão da definição); sem a definição no cliente, o padrão de mercado (consistir pelos dois critérios,
   * sem cálculo automático de velocidade).
   */
  parametrosPrescricao(c: ContextoPrescricao): Promise<ParametrosPrescricao> {
    return this.ler(c, 'parametrosPrescricao', async (l, est) => {
      const chaves = Object.values(CHAVES_PARAMETROS_PRESCRICAO);
      const ls = await l.consultar(
        `SELECT d.chave, d.valor_padrao,
                (SELECT v.valor FROM parametro_valor v
                  WHERE v.parametro_definicao_id = d.id AND v.vigencia_inicio <= NOW()
                    AND (v.vigencia_fim IS NULL OR v.vigencia_fim > NOW())
                    AND ((v.nivel = 'estabelecimento' AND v.estabelecimento_id = ?) OR v.nivel = 'rede')
                  ORDER BY FIELD(v.nivel, 'estabelecimento', 'rede'), v.vigencia_inicio DESC, v.id DESC
                  LIMIT 1) AS valor
           FROM parametro_definicao d
          WHERE d.ativo AND d.chave IN (${lista(chaves)})`,
        [est.id, ...chaves],
      );
      const valor = (k: keyof ParametrosPrescricao): boolean => {
        const x = ls.find((r) => r['chave'] === CHAVES_PARAMETROS_PRESCRICAO[k]);
        const t = x
          ? textoOuNull(x['valor'] ?? x['valor_padrao'])
              ?.trim()
              .toLowerCase()
          : undefined;
        if (t === 'true' || t === '1' || t === 'sim') return true;
        if (t === 'false' || t === '0' || t === 'nao' || t === 'não') return false;
        return PARAMETROS_PRESCRICAO_PADRAO[k];
      };
      return {
        consistirDuplicidade: valor('consistirDuplicidade'),
        porMedicamento: valor('porMedicamento'),
        porPrincipio: valor('porPrincipio'),
        calcularVelocidade: valor('calcularVelocidade'),
      };
    });
  }

  /**
   * Regras de alerta da prescrição (regra_alerta do estabelecimento ou de todos, cujo cenário é um tipo de alerta
   * da prescrição), ativas e inativas: o nível sai do bloqueio e da justificativa exigida, a versão é a vigente e a
   * vigência é a da versão vigente (sem histórico, o início da vigência da regra); autor é o login de quem criou.
   */
  regrasAlerta(c: ContextoPrescricao): Promise<RegraAlertaLida[]> {
    return this.ler(c, 'regrasAlerta', async (l, est) => {
      const tipos = [...TIPOS_ALERTA];
      const ls = await l.consultar(
        `SELECT r.id, r.codigo, ca.codigo AS tipo, r.bloqueante, r.exige_justificativa, r.numero_versao_vigente,
                COALESCE(
                  (SELECT DATE_FORMAT(rv.vigente_desde, '%Y-%m-%d') FROM regra_alerta_versao rv
                    WHERE rv.regra_alerta_id = r.id AND rv.numero_versao = r.numero_versao_vigente
                    ORDER BY rv.id DESC LIMIT 1),
                  DATE_FORMAT(r.vigencia_inicio, '%Y-%m-%d')) AS vigente_desde,
                r.ativo AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= CURRENT_DATE) AS ativa,
                COALESCE(r.descricao, r.mensagem) AS descricao,
                COALESCE((SELECT u.login FROM usuario u WHERE u.id = r.criado_por), '') AS autor, r.criado_em
           FROM regra_alerta r
           JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id
          WHERE (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?) AND ca.codigo IN (${lista(tipos)})
          ORDER BY r.codigo, r.id`,
        [est.id, ...tipos],
      );
      return ls.map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        tipo: String(x['tipo']),
        nivel: verdadeiro(x['bloqueante'])
          ? 'bloqueio'
          : verdadeiro(x['exige_justificativa'])
            ? 'justificar'
            : 'aviso',
        versao: num(x['numero_versao_vigente']),
        vigenteDesde: dataDe(x['vigente_desde']) ?? '',
        ativa: verdadeiro(x['ativa']),
        descricao: String(x['descricao']),
        autor: String(x['autor']),
        criadaEm: dataHora(x['criado_em'], est.fuso),
      }));
    });
  }

  /**
   * Interações entre os princípios pedidos (interacao_medicamentosa ativa, par guardado em ordem). Sem nenhuma
   * interação ativa cadastrada no cliente, null: a base não está carregada (o domínio trata como base ausente).
   */
  interacoes(c: ContextoPrescricao, principios: readonly number[]): Promise<InteracaoLida[] | null> {
    return this.ler(c, 'interacoes', async (l) => {
      const base = await l.uma(
        `SELECT DATE_FORMAT(MAX(COALESCE(alterado_em, criado_em)), '%Y-%m-%d') AS versao, COUNT(*) AS n
           FROM interacao_medicamentosa WHERE ativo`,
      );
      if (!base || num(base['n']) === 0) return null;
      const ids = [...new Set(principios)].filter((x) => Number.isSafeInteger(x) && x > 0);
      if (ids.length < 2) return [];
      const ls = await l.consultar(
        `SELECT im.principio_ativo_id AS a, im.interagente_principio_ativo_id AS b, g.codigo, g.nivel, im.efeito,
                im.referencia_bibliografica
           FROM interacao_medicamentosa im
           JOIN gravidade_interacao g ON g.id = im.gravidade_interacao_id
          WHERE im.ativo AND im.principio_ativo_id IN (${lista(ids)})
            AND im.interagente_principio_ativo_id IN (${lista(ids)})
          ORDER BY im.principio_ativo_id, im.interagente_principio_ativo_id, im.id`,
        [...ids, ...ids],
      );
      const versaoBase = textoOuNull(base['versao']) ?? '';
      return ls.map((x) => {
        const codigo = String(x['codigo']).toLowerCase();
        const gravidade = (GRAVIDADES as readonly string[]).includes(codigo)
          ? (codigo as InteracaoLida['gravidade'])
          : GRAVIDADES[Math.min(Math.max(num(x['nivel']), 1), 4) - 1]!;
        return {
          a: num(x['a']),
          b: num(x['b']),
          gravidade,
          efeito: String(x['efeito']),
          fonte: textoOuNull(x['referencia_bibliografica']) ?? 'Cadastro de interações do hospital',
          versaoBase,
        };
      });
    });
  }
}
