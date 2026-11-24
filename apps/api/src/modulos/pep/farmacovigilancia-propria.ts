// Farmacovigilância no paciente (03-PEP L103) e lista de uso contínuo com a reconciliação que parte dela (03-PEP
// L104), no banco próprio do cliente. Regras no domínio (@sgh/dominio-pep, farmacovigilancia.ts); aqui ficam a
// leitura por paciente e a gravação pelo executor (trilha na mesma transação).
//
// Reação adversa: reacao_adversa_paciente (o estado atual) e reacao_adversa_evento (cada passo: registro, avaliação
// da farmácia, notificação, encerramento, reabertura, alteração e inativação, com a situação de antes e a nova). Nada
// é apagado: a inativação fica com justificativa e autor. A reação não inativada alerta na prescrição seguinte pelo
// princípio ativo do medicamento suspeito (entra no contexto de alergias do motor de alertas).
//
// Uso contínuo: medicamento_uso_previo é a lista do paciente que atravessa os atendimentos (todos os estabelecimentos
// do cliente). A reconciliação pela lista grava o lote (reconciliacao_medicamentosa) com uma linha por medicamento da
// lista (reconciliacao_item.medicamento_uso_previo_id) e atualiza a lista: suspender tira o medicamento da lista ativa
// com quem, quando e por quê; as outras condutas ficam registradas como a última decisão.
import {
  CONDUTAS_RECONCILIACAO_LISTA,
  condutaNaLista,
  DESFECHOS_REACAO,
  type EtapaReacao,
  FONTES_USO_CONTINUO,
  type FalhaRegra,
  fonteNaReconciliacao,
  NIVEL_GRAVE_PADRAO,
  passoReacao,
  REEXPOSICOES,
  type SituacaoReacao,
  validarNovaReacao,
  validarReconciliacaoDaLista,
  validarUsoContinuo,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { AlergiaLida } from './tipos-pep.js';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Boolean(Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const data = (s: string | null | undefined): Date | null => (s ? new Date(s) : null);
const id = z.number().int().positive();
const quando = z.string().datetime({ offset: true });
const opcional = (m: number) => z.string().trim().max(m).nullable().optional();

export const esquemaReacao = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('registrar'),
      paciente: id,
      atendimento: id.nullable().optional(),
      prescricaoItem: id.nullable().optional(),
      itemPrescritivel: id.nullable().optional(),
      medicamentoDescricao: opcional(200),
      descricao: z.string().trim().min(1).max(4000),
      inicio: quando,
      fim: quando.nullable().optional(),
      gravidade: id,
      esperada: z.boolean().default(false),
      medicamentoSuspenso: z.boolean().default(false),
      reexposicao: z.enum(REEXPOSICOES).default('nao_realizada'),
      conduta: opcional(4000),
    })
    .strict(),
  z
    .object({
      acao: z.enum(['avaliar', 'notificar', 'encerrar', 'reabrir', 'inativar', 'evoluir']),
      reacao: id,
      versao: z.number().int().positive(),
      causalidade: id.nullable().optional(),
      desfecho: z.enum(DESFECHOS_REACAO).nullable().optional(),
      gravidade: id.nullable().optional(),
      fim: quando.nullable().optional(),
      conduta: opcional(4000),
      justificativa: opcional(1000),
      observacao: opcional(2000),
    })
    .strict(),
]);
export type EntradaReacao = z.infer<typeof esquemaReacao>;

export const esquemaUsoContinuo = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('incluir'),
      paciente: id,
      atendimento: id.nullable().optional(),
      itemPrescritivel: id.nullable().optional(),
      descricaoLivre: opcional(200),
      dose: z.number().positive().nullable().optional(),
      unidade: id.nullable().optional(),
      posologia: opcional(500),
      fonte: z.enum(FONTES_USO_CONTINUO),
      inicioUso: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      ultimaTomada: quando.nullable().optional(),
      observacao: opcional(1000),
    })
    .strict(),
  z
    .object({
      acao: z.literal('suspender'),
      uso: id,
      versao: z.number().int().positive(),
      justificativa: z.string().trim().min(5).max(250),
    })
    .strict(),
  z
    .object({
      acao: z.literal('reconciliar'),
      paciente: id,
      atendimento: id,
      momento: z.enum(['admissao', 'transferencia', 'alta']),
      decisoes: z
        .array(
          z
            .object({
              usoContinuo: id,
              conduta: z.enum(CONDUTAS_RECONCILIACAO_LISTA),
              justificativa: z.string().trim().max(250).nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(200),
    })
    .strict(),
]);
export type EntradaUsoContinuo = z.infer<typeof esquemaUsoContinuo>;

export interface NucleoFarmacovigilancia {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoFarmacovigilancia {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoFv = ContextoFarmacovigilancia & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface ReacaoLida {
  readonly id: number;
  readonly versao: number;
  readonly estabelecimentoId: number;
  readonly atendimentoId: number | null;
  readonly prescricaoItemId: number | null;
  readonly itemPrescritivelId: number | null;
  readonly medicamento: string;
  readonly descricao: string;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly gravidade: { id: number; descricao: string; nivel: number };
  readonly causalidade: string | null;
  readonly esperada: boolean;
  readonly medicamentoSuspenso: boolean;
  readonly reexposicao: string;
  readonly conduta: string | null;
  readonly desfecho: string | null;
  readonly situacao: string;
  readonly notificadaEm: string | null;
  readonly exigeNotificacao: boolean;
  readonly eventos: readonly {
    etapa: string;
    de: string | null;
    para: string;
    em: string | null;
    por: string | null;
    observacao: string | null;
  }[];
}

export interface UsoContinuoLido {
  readonly id: number;
  readonly versao: number;
  readonly medicamento: string;
  readonly itemPrescritivelId: number | null;
  readonly dose: number | null;
  readonly posologia: string | null;
  readonly fonte: string;
  readonly inicioUso: string | null;
  readonly ultimaTomada: string | null;
  readonly conduta: string | null;
  readonly suspenso: boolean;
  readonly suspensoEm: string | null;
  readonly justificativaSuspensao: string | null;
  readonly estabelecimentoId: number;
}

export interface FarmacovigilanciaDoPaciente {
  readonly reacoes: readonly ReacaoLida[];
  readonly usoContinuo: readonly UsoContinuoLido[];
  readonly itensPrescritos: readonly { id: number; descricao: string; prescritoEm: string | null }[];
  readonly gravidades: readonly { id: number; descricao: string; nivel: number }[];
  readonly causalidades: readonly { id: number; descricao: string }[];
  readonly nivelGrave: number;
}

const ETAPA_DA_ACAO: Readonly<Record<string, EtapaReacao>> = {
  avaliar: 'avaliacao_farmacia',
  notificar: 'notificacao',
  encerrar: 'encerramento',
  reabrir: 'reabertura',
  inativar: 'inativacao',
};

const recusar = (f: readonly FalhaRegra[]): never => {
  throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '));
};
/**
 * O profissional ligado à conta da sessão, lido dentro da transação (o executor refaz o contexto da operação só com
 * os campos do núcleo; a conta sem profissional já foi recusada antes, quando o registro exige).
 */
async function profDe(tx: TxOperacao): Promise<number | null> {
  const p = await tx.uma(
    'SELECT profissional_id FROM usuario_profissional WHERE usuario_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
    [tx.contexto.usuario],
  );
  return p ? num(p['profissional_id']) : null;
}
const inexistente = (o: string): ErroOperacao =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrado`, `${o} não existe neste cliente.`);

async function nivelGrave(l: Pick<Leitor, 'uma'>): Promise<number> {
  const m = await l.uma('SELECT MAX(nivel) AS n FROM gravidade_reacao_adversa WHERE ativo = TRUE');
  const max = numOuNull(m?.['n']);
  return max === null ? NIVEL_GRAVE_PADRAO : Math.min(NIVEL_GRAVE_PADRAO, max);
}

export class FarmacovigilanciaPropria {
  private executorCache: Executor | null = null;
  // Criado na primeira gravação: a leitura do alerta da prescrição não precisa do executor.
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opReacao = definirOperacao<EntradaReacao, { reacao: number; situacao: string }>({
    nome: 'pep.reacao_adversa',
    tabelas: ['reacao_adversa_paciente', 'reacao_adversa_evento'],
    entrada: esquemaReacao as unknown as z.ZodType<EntradaReacao>,
    gravar: (tx, e, ctx) => this.gravarReacao(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'reacao_adversa_paciente', id: r.reacao }),
  });

  private readonly opUso = definirOperacao<EntradaUsoContinuo, { alvo: number; itens: number }>({
    nome: 'pep.uso_continuo',
    tabelas: ['medicamento_uso_previo', 'reconciliacao_medicamentosa', 'reconciliacao_item'],
    entrada: esquemaUsoContinuo as unknown as z.ZodType<EntradaUsoContinuo>,
    gravar: (tx, e, ctx) => this.gravarUso(tx, e, ctx),
    alvo: (e, r) => ({
      tabela: e.acao === 'reconciliar' ? 'reconciliacao_medicamentosa' : 'medicamento_uso_previo',
      id: r.alvo,
    }),
  });

  constructor(
    private readonly nucleo: NucleoFarmacovigilancia,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private quem(c: ContextoFarmacovigilancia) {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.farmacovigilancia' },
      async (l) => {
        const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
          c.hospital,
        ]);
        if (!e)
          throw new ErroOperacao(
            403,
            'estabelecimento-desconhecido',
            'Estabelecimento',
            'O estabelecimento da sessão não existe no cliente.',
          );
        const u = await l.uma(
          `SELECT u.id, (SELECT up.profissional_id FROM usuario_profissional up
                        WHERE up.usuario_id = u.id AND up.excluido_em IS NULL ORDER BY up.id LIMIT 1) AS profissional
           FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL`,
          [c.login],
        );
        return {
          estabelecimento: num(e['id']),
          usuario: u ? num(u['id']) : null,
          profissional: u ? numOuNull(u['profissional']) : null,
        };
      },
    );
  }

  /** Tudo de farmacovigilância do paciente numa leitura: reações com a evolução, uso contínuo e apoio da tela. */
  async doPaciente(c: ContextoFarmacovigilancia, paciente: number): Promise<FarmacovigilanciaDoPaciente> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.farmacovigilancia', estabelecimento: q.estabelecimento },
      async (l) => {
        const grave = await nivelGrave(l);
        const linhas = await l.consultar(
          `SELECT r.*, g.descricao AS gravidade_desc, g.nivel AS gravidade_nivel, c.descricao AS causalidade_desc,
                  COALESCE(ip.descricao, ipi.descricao, pi.descricao, r.medicamento_descricao) AS medicamento
             FROM reacao_adversa_paciente r
             JOIN gravidade_reacao_adversa g ON g.id = r.gravidade_reacao_adversa_id
             LEFT JOIN causalidade_reacao_adversa c ON c.id = r.causalidade_reacao_adversa_id
             LEFT JOIN item_prescritivel ip ON ip.id = r.item_prescritivel_id
             LEFT JOIN prescricao_item pi ON pi.id = r.prescricao_item_id
             LEFT JOIN item_prescritivel ipi ON ipi.id = pi.item_prescritivel_id
            WHERE r.paciente_id = ? AND r.excluido_em IS NULL
            ORDER BY r.inicio_em DESC, r.id DESC`,
          [paciente],
        );
        const ids = linhas.map((x) => num(x['id']));
        const eventos = ids.length
          ? await l.consultar(
              `SELECT e.reacao_adversa_paciente_id AS reacao, e.etapa, e.situacao_anterior, e.situacao_nova, e.ocorrido_em,
                      e.observacao, u.nome AS por
                 FROM reacao_adversa_evento e LEFT JOIN usuario u ON u.id = e.usuario_id
                WHERE e.reacao_adversa_paciente_id IN (${ids.map(() => '?').join(',')})
                ORDER BY e.ocorrido_em, e.id`,
              ids,
            )
          : [];
        const reacoes: ReacaoLida[] = linhas.map((x) => {
          const nivel = num(x['gravidade_nivel']);
          return {
            id: num(x['id']),
            versao: num(x['versao']),
            estabelecimentoId: num(x['estabelecimento_id']),
            atendimentoId: numOuNull(x['atendimento_id']),
            prescricaoItemId: numOuNull(x['prescricao_item_id']),
            itemPrescritivelId: numOuNull(x['item_prescritivel_id']),
            medicamento: txt(x['medicamento']) ?? 'Medicamento não informado',
            descricao: String(x['descricao']),
            inicio: iso(x['inicio_em']),
            fim: iso(x['fim_em']),
            gravidade: {
              id: num(x['gravidade_reacao_adversa_id']),
              descricao: String(x['gravidade_desc']),
              nivel,
            },
            causalidade: txt(x['causalidade_desc']),
            esperada: bool(x['esperada']),
            medicamentoSuspenso: bool(x['medicamento_suspenso']),
            reexposicao: String(x['reexposicao']),
            conduta: txt(x['conduta']),
            desfecho: txt(x['desfecho']),
            situacao: String(x['situacao']),
            notificadaEm: iso(x['notificado_em']),
            exigeNotificacao: nivel >= grave || x['desfecho'] === 'obito',
            eventos: eventos
              .filter((e) => num(e['reacao']) === num(x['id']))
              .map((e) => ({
                etapa: String(e['etapa']),
                de: txt(e['situacao_anterior']),
                para: String(e['situacao_nova']),
                em: iso(e['ocorrido_em']),
                por: txt(e['por']),
                observacao: txt(e['observacao']),
              })),
          };
        });
        const usos = await l.consultar(
          `SELECT m.*, COALESCE(ip.descricao, m.descricao_livre) AS medicamento
             FROM medicamento_uso_previo m LEFT JOIN item_prescritivel ip ON ip.id = m.item_prescritivel_id
            WHERE m.paciente_id = ? AND m.excluido_em IS NULL
            ORDER BY m.suspenso, m.registrado_em DESC, m.id DESC`,
          [paciente],
        );
        const itens = await l.consultar(
          `SELECT pi.id, COALESCE(ip.descricao, pi.descricao) AS descricao, p.prescrito_em
             FROM prescricao_item pi
             JOIN prescricao p ON p.id = pi.prescricao_id
             LEFT JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
            WHERE p.paciente_id = ? AND p.excluido_em IS NULL AND pi.excluido_em IS NULL
              AND (ip.principio_ativo_id IS NOT NULL OR ip.insumo_id IS NOT NULL OR pi.item_nao_padronizado_id IS NOT NULL)
            ORDER BY p.prescrito_em DESC, pi.sequencia LIMIT 200`,
          [paciente],
        );
        const gravidades = await l.consultar(
          'SELECT id, descricao, nivel FROM gravidade_reacao_adversa WHERE ativo = TRUE ORDER BY nivel',
        );
        const causalidades = await l.consultar(
          'SELECT id, descricao FROM causalidade_reacao_adversa WHERE ativo = TRUE ORDER BY grau, id',
        );
        return {
          reacoes,
          usoContinuo: usos.map((m) => ({
            id: num(m['id']),
            versao: num(m['versao']),
            medicamento: txt(m['medicamento']) ?? 'Medicamento não informado',
            itemPrescritivelId: numOuNull(m['item_prescritivel_id']),
            dose: numOuNull(m['dose']),
            posologia: txt(m['posologia']),
            fonte: String(m['fonte_informacao']),
            inicioUso: m['inicio_uso'] ? iso(m['inicio_uso'])!.slice(0, 10) : null,
            ultimaTomada: iso(m['ultima_tomada_em']),
            conduta: txt(m['conduta']),
            suspenso: bool(m['suspenso']),
            suspensoEm: iso(m['suspenso_em']),
            justificativaSuspensao: txt(m['justificativa_suspensao']),
            estabelecimentoId: num(m['estabelecimento_id']),
          })),
          itensPrescritos: itens.map((i) => ({
            id: num(i['id']),
            descricao: txt(i['descricao']) ?? 'Item prescrito',
            prescritoEm: iso(i['prescrito_em']),
          })),
          gravidades: gravidades.map((g) => ({
            id: num(g['id']),
            descricao: String(g['descricao']),
            nivel: num(g['nivel']),
          })),
          causalidades: causalidades.map((g) => ({ id: num(g['id']), descricao: String(g['descricao']) })),
          nivelGrave: grave,
        };
      },
    );
  }

  /**
   * As reações não inativadas do paciente como alerta da prescrição seguinte: entram no contexto de alergias do
   * motor, pelo princípio ativo do medicamento suspeito (o id negativo separa da alergia de mesmo número).
   */
  alertasDaPrescricao(c: { hospital: string }, paciente: number): Promise<AlergiaLida[]> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.farmacovigilancia.alerta' },
      async (l) => {
        const linhas = await l.consultar(
          `SELECT r.id, COALESCE(ip.descricao, ipi.descricao, r.medicamento_descricao) AS medicamento,
                COALESCE(ip.principio_ativo_id, ipi.principio_ativo_id) AS principio, g.descricao AS gravidade
           FROM reacao_adversa_paciente r
           JOIN gravidade_reacao_adversa g ON g.id = r.gravidade_reacao_adversa_id
           LEFT JOIN item_prescritivel ip ON ip.id = r.item_prescritivel_id
           LEFT JOIN prescricao_item pi ON pi.id = r.prescricao_item_id
           LEFT JOIN item_prescritivel ipi ON ipi.id = pi.item_prescritivel_id
          WHERE r.paciente_id = ? AND r.excluido_em IS NULL AND r.situacao <> 'inativa'
          ORDER BY r.id`,
          [paciente],
        );
        void c;
        return linhas.map((x) => ({
          alergia: -num(x['id']),
          nome: `Reação adversa prévia: ${txt(x['medicamento']) ?? 'medicamento'} (${String(x['gravidade'])})`,
          principios: x['principio'] === null || x['principio'] === undefined ? [] : [num(x['principio'])],
        }));
      },
    );
  }

  private async contexto(
    c: ContextoGravacaoFv,
    exigeProfissional: boolean,
  ): Promise<ContextoOperacao & { profissional: number | null }> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    if (exigeProfissional && q.profissional === null)
      throw recusa(
        'usuario-sem-profissional',
        'O registro clínico exige um profissional ligado à conta da sessão.',
      );
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
      profissional: q.profissional,
    };
  }

  async reacao(c: ContextoGravacaoFv, entrada: unknown) {
    const ctx = await this.contexto(c, true);
    const r = await this.executor.executar(this.opReacao, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  async usoContinuo(c: ContextoGravacaoFv, entrada: unknown) {
    const e = esquemaUsoContinuo.safeParse(entrada);
    const ctx = await this.contexto(c, e.success && e.data.acao === 'reconciliar');
    const r = await this.executor.executar(this.opUso, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async pacienteDoAtendimento(
    tx: TxOperacao,
    paciente: number,
    atendimento: number | null | undefined,
  ) {
    const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente]);
    if (!p) throw inexistente('O paciente');
    if (atendimento) {
      const a = await tx.uma('SELECT paciente_id FROM atendimento WHERE id = ? AND excluido_em IS NULL', [
        atendimento,
      ]);
      if (!a || num(a['paciente_id']) !== paciente)
        throw recusa('atendimento-de-outro-paciente', 'O atendimento não é deste paciente.');
    }
  }

  private async evento(
    tx: TxOperacao,
    reacao: number,
    etapa: string,
    de: SituacaoReacao | null,
    para: SituacaoReacao,
    extra: {
      gravidade?: number | null;
      causalidade?: number | null;
      prescricaoItem?: number | null;
      observacao?: string | null;
      dados?: unknown;
    },
  ) {
    await tx.incluir('reacao_adversa_evento', {
      reacao_adversa_paciente_id: reacao,
      operacao: de === null ? 'inclusao' : 'alteracao',
      dados: extra.dados === undefined ? null : JSON.stringify(extra.dados),
      ocorrido_em: this.agora(),
      usuario_id: tx.contexto.usuario,
      etapa,
      situacao_anterior: de,
      situacao_nova: para,
      gravidade_reacao_adversa_id: extra.gravidade ?? null,
      causalidade_reacao_adversa_id: extra.causalidade ?? null,
      prescricao_item_id: extra.prescricaoItem ?? null,
      profissional_id: await profDe(tx),
      observacao: extra.observacao ?? null,
    });
  }

  private async gravarReacao(tx: TxOperacao, e: EntradaReacao, ctx: ContextoOperacao) {
    const agora = this.agora();
    if (e.acao === 'registrar') {
      await this.pacienteDoAtendimento(tx, e.paciente, e.atendimento);
      let item = e.itemPrescritivel ?? null;
      if (e.prescricaoItem) {
        const pi = await tx.uma(
          `SELECT pi.item_prescritivel_id, p.paciente_id FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id
            WHERE pi.id = ? AND pi.excluido_em IS NULL`,
          [e.prescricaoItem],
        );
        if (!pi || num(pi['paciente_id']) !== e.paciente)
          throw recusa('item-de-outro-paciente', 'O item prescrito não é deste paciente.');
        item = item ?? numOuNull(pi['item_prescritivel_id']);
      }
      const falhas = validarNovaReacao(
        {
          prescricaoItem: e.prescricaoItem ?? null,
          itemPrescritivel: item,
          medicamentoDescricao: e.medicamentoDescricao ?? null,
          descricao: e.descricao,
          inicio: new Date(e.inicio),
          fim: data(e.fim),
        },
        agora,
      );
      if (falhas.length) recusar(falhas);
      const g = await tx.uma('SELECT id FROM gravidade_reacao_adversa WHERE id = ? AND ativo = TRUE', [
        e.gravidade,
      ]);
      if (!g) throw recusa('gravidade-invalida', 'A gravidade escolhida não existe no cadastro.');
      const reacao = await tx.incluir('reacao_adversa_paciente', {
        estabelecimento_id: ctx.estabelecimento,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento ?? null,
        prescricao_item_id: e.prescricaoItem ?? null,
        item_prescritivel_id: item,
        medicamento_descricao: e.medicamentoDescricao?.trim() || null,
        descricao: e.descricao,
        inicio_em: new Date(e.inicio),
        fim_em: data(e.fim),
        gravidade_reacao_adversa_id: e.gravidade,
        esperada: e.esperada,
        medicamento_suspenso: e.medicamentoSuspenso,
        reexposicao: e.reexposicao,
        conduta: e.conduta?.trim() || null,
        situacao: 'registrada',
        registrado_em: agora,
        registrado_por_profissional_id: await profDe(tx),
        origem: 'sistema',
      });
      await this.evento(tx, reacao, 'registro', null, 'registrada', {
        gravidade: e.gravidade,
        prescricaoItem: e.prescricaoItem ?? null,
      });
      return { reacao, situacao: 'registrada' };
    }
    const [r] = await tx.consultarParaAtualizar(
      `SELECT r.id, r.versao, r.situacao, r.desfecho, r.notificado_em, r.avaliado_em, r.inicio_em, r.prescricao_item_id, g.nivel
         FROM reacao_adversa_paciente r JOIN gravidade_reacao_adversa g ON g.id = r.gravidade_reacao_adversa_id
        WHERE r.id = ? AND r.excluido_em IS NULL`,
      [e.reacao],
      { teto: 1 },
    );
    if (!r) throw inexistente('A reação');
    const atual = String(r['situacao']) as SituacaoReacao;
    const versao = num(r['versao']);
    if (versao !== e.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Reação alterada por outra pessoa',
        'Recarregue a reação antes de seguir.',
      );
    const fim = data(e.fim);
    if (
      fim &&
      (fim.getTime() < new Date(r['inicio_em'] as string).getTime() ||
        fim.getTime() > agora.getTime() + 60_000)
    )
      throw recusa('periodo-invalido', 'O fim da reação precisa estar entre o início e agora.');
    if (e.acao === 'evoluir') {
      if (atual === 'inativa' || atual === 'encerrada')
        throw recusa(
          'transicao-invalida',
          'Reação encerrada ou inativada: reabra antes de registrar a evolução.',
        );
      let nivel = num(r['nivel']);
      if (e.gravidade) {
        const g = await tx.uma('SELECT nivel FROM gravidade_reacao_adversa WHERE id = ? AND ativo = TRUE', [
          e.gravidade,
        ]);
        if (!g) throw recusa('gravidade-invalida', 'A gravidade escolhida não existe no cadastro.');
        nivel = num(g['nivel']);
      }
      void nivel; // a gravidade nova é conferida no cadastro antes de gravar
      const valores: Record<string, unknown> = {};
      if (e.gravidade) valores['gravidade_reacao_adversa_id'] = e.gravidade;
      if (e.desfecho !== undefined) valores['desfecho'] = e.desfecho;
      if (e.conduta !== undefined) valores['conduta'] = e.conduta?.trim() || null;
      if (e.fim !== undefined) valores['fim_em'] = fim;
      if (Object.keys(valores).length === 0 && !e.observacao?.trim())
        throw recusa('evolucao-vazia', 'Informe o que mudou na reação.');
      if (Object.keys(valores).length)
        await tx.alterar('reacao_adversa_paciente', e.reacao, versao, valores as never);
      else await tx.alterar('reacao_adversa_paciente', e.reacao, versao, { situacao: atual });
      await this.evento(tx, e.reacao, 'alteracao', atual, atual, {
        gravidade: e.gravidade ?? null,
        observacao: e.observacao ?? null,
        dados: { desfecho: e.desfecho ?? undefined, fim: e.fim ?? undefined },
      });
      return { reacao: e.reacao, situacao: atual };
    }
    const etapa = ETAPA_DA_ACAO[e.acao]!;
    // Notificar ou encerrar pede a avaliação da farmácia antes (o CHECK do banco exige quem avaliou): sem ela, a
    // recusa vem primeiro, antes das outras regras do passo.
    if (['notificacao', 'encerramento'].includes(etapa) && !r['avaliado_em'])
      throw recusa(
        'avaliacao-pendente',
        'A farmácia clínica avalia a reação (causalidade) antes deste passo.',
      );
    const desfecho = e.desfecho ?? txt(r['desfecho']);
    const p = passoReacao({
      etapa,
      situacaoAtual: atual,
      nivelGravidade: num(r['nivel']),
      nivelGrave: await nivelGrave(tx),
      jaNotificada: r['notificado_em'] !== null && r['notificado_em'] !== undefined,
      causalidade: e.causalidade ?? null,
      desfecho,
      justificativa: e.justificativa ?? null,
    });
    if ('falha' in p) recusar([p.falha]);
    const nova = (p as { situacao: SituacaoReacao }).situacao;
    const valores: Record<string, unknown> = { situacao: nova };
    if (etapa === 'avaliacao_farmacia') {
      const c = await tx.uma('SELECT id FROM causalidade_reacao_adversa WHERE id = ? AND ativo = TRUE', [
        e.causalidade,
      ]);
      if (!c) throw recusa('causalidade-invalida', 'A causalidade escolhida não existe no cadastro.');
      Object.assign(valores, {
        causalidade_reacao_adversa_id: e.causalidade,
        avaliado_em: agora,
        avaliado_por_profissional_id: await profDe(tx),
      });
    }
    if (etapa === 'notificacao') valores['notificado_em'] = agora;
    if (etapa === 'encerramento') {
      valores['desfecho'] = desfecho;
      if (fim) valores['fim_em'] = fim;
    }
    if (etapa === 'inativacao') valores['justificativa_inativacao'] = e.justificativa!.trim();
    if (e.conduta !== undefined && e.conduta !== null) valores['conduta'] = e.conduta.trim() || null;
    await tx.alterar('reacao_adversa_paciente', e.reacao, versao, valores as never);
    await this.evento(tx, e.reacao, etapa, atual, nova, {
      causalidade: e.causalidade ?? null,
      observacao: (e.justificativa ?? e.observacao) || null,
      dados: etapa === 'encerramento' ? { desfecho } : undefined,
    });
    return { reacao: e.reacao, situacao: nova };
  }

  private async gravarUso(tx: TxOperacao, e: EntradaUsoContinuo, ctx: ContextoOperacao) {
    const agora = this.agora();
    if (e.acao === 'incluir') {
      await this.pacienteDoAtendimento(tx, e.paciente, e.atendimento);
      const falhas = validarUsoContinuo(
        {
          itemPrescritivel: e.itemPrescritivel ?? null,
          descricaoLivre: e.descricaoLivre ?? null,
          dose: e.dose ?? null,
          unidade: e.unidade ?? null,
          inicioUso: e.inicioUso ? new Date(`${e.inicioUso}T00:00:00Z`) : null,
          ultimaTomada: data(e.ultimaTomada),
        },
        agora,
      );
      if (falhas.length) recusar(falhas);
      const uso = await tx.incluir('medicamento_uso_previo', {
        estabelecimento_id: ctx.estabelecimento,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento ?? null,
        item_prescritivel_id: e.itemPrescritivel ?? null,
        descricao_livre: e.descricaoLivre?.trim() || null,
        dose: e.dose ?? null,
        unidade_prescricao_id: e.unidade ?? null,
        posologia: e.posologia?.trim() || null,
        fonte_informacao: e.fonte,
        inicio_uso: e.inicioUso ?? null,
        ultima_tomada_em: data(e.ultimaTomada),
        registrado_em: agora,
        registrante_usuario_id: ctx.usuario,
        observacao: e.observacao?.trim() || null,
        origem: 'sistema',
      });
      return { alvo: uso, itens: 1 };
    }
    if (e.acao === 'suspender') {
      const [m] = await tx.consultarParaAtualizar(
        'SELECT id, versao, suspenso FROM medicamento_uso_previo WHERE id = ? AND excluido_em IS NULL',
        [e.uso],
        { teto: 1 },
      );
      if (!m) throw inexistente('O medicamento de uso contínuo');
      if (bool(m['suspenso'])) throw recusa('ja-suspenso', 'O medicamento já está suspenso.');
      await tx.alterar('medicamento_uso_previo', e.uso, e.versao, {
        suspenso: true,
        suspenso_em: agora,
        suspensor_usuario_id: ctx.usuario,
        justificativa_suspensao: e.justificativa,
        conduta: 'suspender',
      });
      return { alvo: e.uso, itens: 1 };
    }
    const atd = await tx.uma(
      'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.atendimento, ctx.estabelecimento],
    );
    if (!atd || num(atd['paciente_id']) !== e.paciente)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Atendimento não encontrado',
        'O atendimento do paciente não está nesta unidade.',
      );
    const ativos = await tx.consultarParaAtualizar(
      `SELECT m.id, m.versao, m.item_prescritivel_id, m.fonte_informacao, m.ultima_tomada_em, m.posologia, m.dose,
              COALESCE(ip.descricao, m.descricao_livre) AS medicamento
         FROM medicamento_uso_previo m LEFT JOIN item_prescritivel ip ON ip.id = m.item_prescritivel_id
        WHERE m.paciente_id = ? AND m.suspenso = FALSE AND m.excluido_em IS NULL`,
      [e.paciente],
      { teto: 500 },
    );
    const falhas = validarReconciliacaoDaLista(
      ativos.map((a) => num(a['id'])),
      e.decisoes.map((d) => ({
        usoContinuo: d.usoContinuo,
        conduta: d.conduta,
        justificativa: d.justificativa ?? null,
      })),
    );
    if (falhas.length) recusar(falhas);
    const lote = await tx.incluir('reconciliacao_medicamentosa', {
      estabelecimento_id: ctx.estabelecimento,
      paciente_id: e.paciente,
      atendimento_id: e.atendimento,
      momento: e.momento,
      responsavel_profissional_id: await profDe(tx),
      iniciada_em: agora,
      concluida_em: agora,
      situacao: 'concluida',
      origem: 'sistema',
    });
    for (const [i, d] of e.decisoes.entries()) {
      const a = ativos.find((x) => num(x['id']) === d.usoContinuo)!;
      const just = d.justificativa?.trim() || null;
      await tx.incluir('reconciliacao_item', {
        reconciliacao_medicamentosa_id: lote,
        sequencia: i + 1,
        medicamento_uso_previo_id: d.usoContinuo,
        item_prescritivel_id: numOuNull(a['item_prescritivel_id']),
        descricao: (txt(a['medicamento']) ?? 'Medicamento').slice(0, 200),
        dose: a['dose'] === null ? null : String(a['dose']).slice(0, 60),
        frequencia: txt(a['posologia'])?.slice(0, 60) ?? null,
        ultima_dose_em: a['ultima_tomada_em'] ?? null,
        fonte: fonteNaReconciliacao(String(a['fonte_informacao'])),
        conduta: d.conduta,
        justificativa: just,
        origem: 'sistema',
      });
      await tx.alterar(
        'medicamento_uso_previo',
        d.usoContinuo,
        num(a['versao']),
        d.conduta === 'suspender'
          ? {
              conduta: 'suspender',
              suspenso: true,
              suspenso_em: agora,
              suspensor_usuario_id: ctx.usuario,
              justificativa_suspensao: (just ?? '').slice(0, 250),
            }
          : { conduta: condutaNaLista(d.conduta) },
      );
    }
    return { alvo: lote, itens: e.decisoes.length };
  }
}
