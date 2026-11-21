// Porta da manipulação (M46, etapa 4) sobre o banco do cliente, pelo @sgh/nucleo, sempre restrita ao estabelecimento
// da sessão:
//   - leitura: as capelas com os grupos (capela_manipulacao, capela_manipulacao_grupo, grupo_manipulacao); a avaliação
//     farmacêutica do item prescrito (avaliacao_farmaceutica e avaliacao_farmaceutica_item: pendente ou em avaliação =
//     "pendente"; concluída = "decidido", com o parecer do item); a fila de itens a manipular (itens aprovados cujo
//     produto é manipulado, com o leito e as iniciais); as ordens (ordem_manipulacao com o insumo usado em
//     ordem_manipulacao_insumo, a saída do estoque pelo movimento e a conferência); os vínculos profissionais do login
//     (usuario_vinculo_profissional com o CBO da inscrição no conselho);
//   - gravação: a abertura e a dupla conferência da ordem numa operação do executor (trilha, outbox e idempotência
//     pela chave da tela); a baixa do insumo vai pela operação do estoque (suprimentos.registrarSaida), que liga o
//     movimento ao insumo da ordem na mesma transação.
// Melhoria: a capela "funcionando" vem da situação do cadastro (disponível ou em uso), sem marcas S/N; a dupla
// conferência fica no histórico (conferencia_manipulacao) e o banco recusa o mesmo profissional nas duas pontas.
import type {
  CapelaManipulacao,
  ItemAManipular,
  OrdemManipulacao,
  SituacaoManipulacao,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  gravarIdempotencia,
  hashEntrada,
  type Leitor,
  lerIdempotencia,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type ContextoPortaM18,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import {
  type AvaliacaoDoItem,
  type ConferenciaDaManipulacao,
  type GravadorManipulacao,
  METODOS_PORTA_MANIPULACAO,
  type NovaOrdemManipulacao,
  type PortaManipulacao,
} from './manipulacao-porta.js';
import { contextoNucleo } from './operacoes.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

export type NucleoManipulacao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** As tabelas que a abertura e a conferência gravam (o executor confere cada escrita). */
export const TABELAS_MANIPULACAO = [
  'ordem_manipulacao',
  'ordem_manipulacao_insumo',
  'conferencia_manipulacao',
  'sequencia_negocio',
  'idempotencia_operacao',
] as const;

const OP_ABRIR = 'manipulacao.abrir';
const OPERACAO_BAIXA = 'suprimentos.registrarSaida';
const TETO = 200;
type Linha = Record<string, unknown>;
type Fonte = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const instante = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : '';
const hm = (v: unknown): string => instante(v).slice(0, 16);
const coluna = (em: string): string => `${em.slice(0, 10)} ${em.slice(11, 16) || '00:00'}:00`;
const diaSeguinte = (d: string): string => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};
const iniciais = (nome: unknown): string | null => {
  const t = txt(nome);
  if (!t) return null;
  return t
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-ZÀ-Ý]/.test(p))
    .map((p) => p[0]!.toUpperCase())
    .join('');
};
const SITUACOES: readonly SituacaoManipulacao[] = ['aberta', 'conferida', 'reprovada', 'baixada'];
/** No banco, "em preparo" é a ordem ainda aberta; a cancelada não volta à tela como conferível. */
const situacaoLida = (db: unknown): SituacaoManipulacao => {
  const s = String(db);
  if (s === 'em_preparo') return 'aberta';
  if (s === 'cancelada') return 'reprovada';
  return (SITUACOES as readonly string[]).includes(s) ? (s as SituacaoManipulacao) : 'aberta';
};

// ── Leituras comuns (o leitor da sessão ou a transação) ──────────────────────────────────────────────────────────

async function lerAvaliacao(l: Fonte, est: number, itemPrescrito: number): Promise<AvaliacaoDoItem | null> {
  const r = await l.uma<Linha>(
    `SELECT afi.id, af.atendimento_id, af.situacao, afi.parecer, ip.insumo_id
       FROM avaliacao_farmaceutica_item afi
       JOIN avaliacao_farmaceutica af ON af.id = afi.avaliacao_farmaceutica_id AND af.excluido_em IS NULL
       JOIN prescricao_item pi ON pi.id = afi.prescricao_item_id
       LEFT JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
      WHERE afi.prescricao_item_id = ? AND af.estabelecimento_id = ? AND afi.excluido_em IS NULL
      ORDER BY afi.avaliado_em DESC, afi.id DESC LIMIT 1`,
    [itemPrescrito, est],
  );
  if (!r) return null;
  const aberta = ['pendente', 'em_avaliacao'].includes(String(r['situacao']));
  const parecer = String(r['parecer']);
  const decisao = aberta
    ? null
    : parecer === 'aprovado' || parecer === 'aprovado_com_ressalva'
      ? 'valido'
      : parecer === 'recusado'
        ? 'invalido'
        : 'substituido';
  return {
    id: Number(r['id']),
    estado: aberta ? 'pendente' : 'decidido',
    decisao,
    // O atendimento da avaliação (a ordem aberta a partir dela grava este atendimento e o paciente dele).
    reg: Number(r['atendimento_id']),
    produto: nulo(r['insumo_id']),
  };
}

const SQL_ORDEM = `
  SELECT o.id, o.versao, o.situacao, o.prescricao_item_id, o.atendimento_id, o.insumo_id AS produto_id,
         o.capela_manipulacao_id, cap.nome AS capela_nome, o.grupo_manipulacao_id, o.local_estoque_id,
         o.quantidade_prevista, o.validade_em, o.preparado_em, o.conferido_em, o.observacao,
         oi.insumo_id, ins.nome AS insumo_nome, oi.quantidade_utilizada, li.numero_lote, li.validade AS lote_validade,
         oi.movimento_estoque_id, me.documento_estoque_id, me.documento_estoque_item_id, d.numero AS doc_numero,
         d.criado_em AS doc_em, up.login AS preparado_login,
         (SELECT afi.id FROM avaliacao_farmaceutica_item afi
           JOIN avaliacao_farmaceutica af ON af.id = afi.avaliacao_farmaceutica_id AND af.excluido_em IS NULL
          WHERE afi.prescricao_item_id = o.prescricao_item_id AND afi.excluido_em IS NULL
          ORDER BY afi.avaliado_em DESC, afi.id DESC LIMIT 1) AS avaliacao_id,
         (SELECT u.login FROM conferencia_manipulacao cm JOIN usuario u ON u.id = cm.usuario_id
          WHERE cm.ordem_manipulacao_id = o.id AND cm.etapa = 'final'
          ORDER BY cm.ocorrido_em DESC, cm.id DESC LIMIT 1) AS conferido_login,
         (SELECT cm.justificativa FROM conferencia_manipulacao cm
          WHERE cm.ordem_manipulacao_id = o.id AND cm.etapa = 'final'
          ORDER BY cm.ocorrido_em DESC, cm.id DESC LIMIT 1) AS conferencia_obs
    FROM ordem_manipulacao o
    JOIN ordem_manipulacao_insumo oi ON oi.ordem_manipulacao_id = o.id AND oi.sequencia = 1 AND oi.excluido_em IS NULL
    LEFT JOIN insumo ins ON ins.id = oi.insumo_id
    LEFT JOIN lote_insumo li ON li.id = oi.lote_insumo_id
    LEFT JOIN capela_manipulacao cap ON cap.id = o.capela_manipulacao_id
    LEFT JOIN movimento_estoque me ON me.id = oi.movimento_estoque_id
    LEFT JOIN documento_estoque d ON d.id = me.documento_estoque_id
    LEFT JOIN usuario up ON up.id = o.criado_por
   WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.finalidade = 'prescricao'`;

/** A ordem lida. A dose fica na observação da ordem; a observação da tela é a da conferência. */
function ordemDe(r: Linha): OrdemManipulacao {
  const insumo = n(r['insumo_id']);
  const produto = n(r['produto_id']);
  const doc = r['documento_estoque_id'] !== null && r['documento_estoque_id'] !== undefined;
  const em = instante(r['doc_em']);
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    situacao: situacaoLida(r['situacao']),
    itemPrescrito: n(r['prescricao_item_id']),
    avaliacao: n(r['avaliacao_id']),
    atendimento: n(r['atendimento_id']),
    produto: produto && produto !== insumo ? produto : null,
    capela: n(r['capela_manipulacao_id']),
    capelaNome: txt(r['capela_nome']),
    grupo: nulo(r['grupo_manipulacao_id']),
    insumo,
    insumoNome: txt(r['insumo_nome']),
    local: n(r['local_estoque_id']),
    loteInsumo: String(r['numero_lote'] ?? ''),
    validadeInsumo: instante(r['lote_validade']).slice(0, 10),
    quantidade: n(r['quantidade_utilizada']),
    dose: txt(r['observacao']),
    validadeSobra: r['validade_em'] ? hm(r['validade_em']) : null,
    preparadoPor: String(r['preparado_login'] ?? ''),
    preparadoEm: hm(r['preparado_em']),
    conferidoPor: txt(r['conferido_login']),
    conferidoEm: r['conferido_em'] ? hm(r['conferido_em']) : null,
    observacao: txt(r['conferencia_obs']),
    saida: doc ? { ano: Number(em.slice(0, 4)), mes: Number(em.slice(5, 7)), doc: n(r['doc_numero']) } : null,
    lancamento: nulo(r['documento_estoque_item_id']),
  };
}

async function lerOrdens(
  l: Fonte,
  est: number,
  filtro: string,
  args: readonly unknown[],
): Promise<{ itens: OrdemManipulacao[]; cortada: boolean }> {
  const linhas = await l.consultar<Linha>(
    `${SQL_ORDEM} AND ${filtro} ORDER BY o.preparado_em, o.id LIMIT ?`,
    [est, ...args, TETO + 1],
  );
  return { itens: linhas.slice(0, TETO).map(ordemDe), cortada: linhas.length > TETO };
}

// ── O gravador (dentro da operação do executor) ──────────────────────────────────────────────────────────────────

function gravadorSobre(tx: TxOperacao, est: number): GravadorManipulacao {
  const usuario = (): number => {
    const u = tx.contexto.usuario;
    if (u === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    return u;
  };
  /** O profissional vinculado ao usuário no estabelecimento (vínculo vigente mais recente), ou null. */
  const profissionalDe = async (u: number): Promise<number | null> => {
    const r = await tx.uma<Linha>(
      `SELECT profissional_id FROM usuario_vinculo_profissional
        WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND profissional_id IS NOT NULL
          AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
        ORDER BY vigencia_inicio DESC LIMIT 1`,
      [u, est],
    );
    return r ? n(r['profissional_id']) : null;
  };
  const ordemPorId = async (id: number) => (await lerOrdens(tx, est, 'o.id = ?', [id])).itens[0] ?? null;
  return {
    async ordem(id) {
      const trava = await tx.consultarParaAtualizar<Linha>(
        'SELECT id FROM ordem_manipulacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      );
      return trava.length ? ordemPorId(id) : null;
    },

    async ordemPelaChave(chave) {
      const r = await lerIdempotencia(tx, OP_ABRIR, chave);
      return r ? ordemPorId(n(r.resultado['id'])) : null;
    },

    avaliacao: (itemPrescrito) => lerAvaliacao(tx, est, itemPrescrito),

    async ordemEmCurso(itemPrescrito) {
      const r = await tx.uma<Linha>(
        `SELECT id FROM ordem_manipulacao
          WHERE prescricao_item_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
            AND situacao IN ('aberta', 'em_preparo', 'conferida') LIMIT 1`,
        [itemPrescrito, est],
      );
      return !!r;
    },

    async abrir(o: NovaOrdemManipulacao) {
      const ja = await lerIdempotencia(tx, OP_ABRIR, o.chave);
      if (ja) {
        const x = await ordemPorId(n(ja.resultado['id']));
        return { id: n(ja.resultado['id']), versao: x?.versao ?? 1, repetida: true };
      }
      const a = await tx.uma<Linha>(
        'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [o.reg, est],
      );
      if (!a) throw recusa('atendimento-inexistente', 'O atendimento não é deste estabelecimento.');
      const cap = await tx.uma<Linha>(
        `SELECT id FROM capela_manipulacao
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('disponivel', 'em_uso')`,
        [o.capela, est],
      );
      if (!cap) throw recusa('capela-indisponivel', 'A capela não está disponível.', { campos: ['capela'] });
      const local = await tx.uma<Linha>(
        'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [o.local, est],
      );
      if (!local)
        throw recusa('local-inexistente', 'O local de estoque não é deste estabelecimento.', {
          campos: ['local'],
        });
      const ins = await tx.uma<Linha>(
        'SELECT id, estoque_unidade_medida_id FROM insumo WHERE id = ? AND excluido_em IS NULL',
        [o.insumo],
      );
      if (!ins) throw recusa('insumo-inexistente', 'O insumo não está no cadastro.', { campos: ['insumo'] });
      const prod =
        o.produto !== null && o.produto !== o.insumo
          ? await tx.uma<Linha>(
              'SELECT id, estoque_unidade_medida_id FROM insumo WHERE id = ? AND excluido_em IS NULL',
              [o.produto],
            )
          : ins;
      if (!prod)
        throw recusa('produto-inexistente', 'O produto não está no cadastro.', { campos: ['produto'] });
      const lote = await tx.uma<Linha>(
        `SELECT id FROM lote_insumo
          WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND validade = ? AND excluido_em IS NULL
          ORDER BY id LIMIT 1`,
        [est, o.insumo, o.loteInsumo, o.validadeInsumo],
      );
      if (!lote)
        throw recusa('lote-inexistente', 'O lote do insumo não está no estoque deste estabelecimento.', {
          campos: ['loteInsumo'],
        });
      const u = usuario();
      const numero = await tx.proximoNumero('ordem_manipulacao');
      const id = await tx.incluir('ordem_manipulacao', {
        estabelecimento_id: est,
        numero: numero.valor,
        finalidade: 'prescricao',
        prescricao_item_id: o.itemPrescrito,
        atendimento_id: o.reg,
        paciente_id: n(a['paciente_id']),
        insumo_id: n(prod['id']),
        unidade_medida_id: n(prod['estoque_unidade_medida_id']),
        quantidade_prevista: o.quantidade,
        local_estoque_id: o.local,
        capela_manipulacao_id: o.capela,
        grupo_manipulacao_id: o.grupo,
        validade_em: o.validadeSobra ? coluna(o.validadeSobra) : null,
        preparado_por_profissional_id: await profissionalDe(u),
        preparado_em: coluna(o.em),
        situacao: 'aberta',
        observacao: o.dose,
      });
      await tx.incluir('ordem_manipulacao_insumo', {
        ordem_manipulacao_id: id,
        sequencia: 1,
        insumo_id: o.insumo,
        unidade_medida_id: n(ins['estoque_unidade_medida_id']),
        lote_insumo_id: n(lote['id']),
        item_principal: true,
        quantidade_utilizada: o.quantidade,
        pesado_por_usuario_id: u,
        pesado_em: coluna(o.em),
      });
      await gravarIdempotencia(tx, {
        operacao: OP_ABRIR,
        chave: o.chave,
        estabelecimento: est,
        usuario: u,
        hashEntrada: hashEntrada(OP_ABRIR, { ...o, usuario: undefined }),
        resultado: { id },
        trilha: null,
        agora: new Date(),
      });
      return { id, versao: 1, repetida: false };
    },

    async conferir(c: ConferenciaDaManipulacao) {
      const [o] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, situacao, prescricao_item_id, preparado_por_profissional_id, criado_por
           FROM ordem_manipulacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [c.ordem, est],
      );
      if (!o) throw recusa('ordem-inexistente', 'A ordem de manipulação não existe.');
      if (n(o['versao']) !== c.versaoVista)
        throw recusa('ordem-mudou', 'A ordem de manipulação mudou em outra tela: recarregue e confira.');
      if (c.situacao !== 'conferida' && c.situacao !== 'reprovada')
        throw recusa('situacao-invalida', 'A conferência aprova ou reprova a ordem.');
      const u = usuario();
      const prof = await profissionalDe(u);
      if (n(o['criado_por']) === u || (prof !== null && prof === nulo(o['preparado_por_profissional_id'])))
        throw recusa(
          'mesmo-farmaceutico',
          'A dupla conferência é de outro farmacêutico, não de quem preparou.',
        );
      const aprovada = c.situacao === 'conferida';
      const justificativa = c.observacao ?? (aprovada ? null : 'Reprovada na conferência.');
      await tx.incluir('conferencia_manipulacao', {
        operacao: 'inclusao',
        ocorrido_em: coluna(c.em),
        usuario_id: u,
        ordem_manipulacao_id: c.ordem,
        prescricao_item_id: nulo(o['prescricao_item_id']),
        etapa: 'final',
        resultado: aprovada ? 'aprovado' : 'reprovado',
        justificativa,
      });
      const versao = await tx.alterar('ordem_manipulacao', c.ordem, n(o['versao']), {
        situacao: c.situacao,
        conferido_por_profissional_id: prof,
        conferido_em: coluna(c.em),
        motivo_reprovacao: aprovada ? null : justificativa,
      });
      return { versao };
    },
  };
}

export class PortaManipulacaoPropria implements PortaManipulacao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly estoque: PortaSuprimentosPropria;

  constructor(
    private readonly nucleo: NucleoManipulacao,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
    this.estoque = new PortaSuprimentosPropria(nucleo, this.executor);
  }

  private ler<T>(c: ContextoNucleo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoNucleo(c, 'manipulacao'), (l) => fn(l, est));
  }

  /** A baixa do insumo vai pela saída do estoque (o insumo da ordem ligado ao movimento na mesma transação). */
  async podeGravar(c: ContextoPortaM18, op?: string): Promise<LiberacaoGravacao> {
    const nome = op ?? OPERACAO_BAIXA;
    if (nome !== OPERACAO_BAIXA)
      return {
        pode: false,
        codigo: 'operacao-desconhecida',
        motivo: 'Operação desconhecida na manipulação.',
      };
    return this.estoque.podeGravar(c, nome);
  }

  executar(c: ContextoNucleo, op: string, e: unknown, ctx: ContextoOperacao) {
    if (op !== OPERACAO_BAIXA)
      return Promise.reject(recusa('operacao-desconhecida', 'Operação desconhecida na manipulação.'));
    return this.estoque.executar(c, op, e, ctx);
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorManipulacao) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao | null =>
      typeof trilha === 'function' ? (saida ? trilha((saida as { valor: T }).valor) : null) : trilha;
    const op = definirOperacao({
      nome: 'manipulacao.gravacao',
      tabelas: [...TABELAS_MANIPULACAO],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'ordem_manipulacao', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
      eventos: () => [{ tipo: 'manipulacao.gravacao', carga: { id: linha()?.entidadeId ?? null } }],
    });
    // A idempotência da tela é a do gravador (pela chave do pedido); a do executor é por chamada.
    const chave = `manipulacao:${randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      {
        ...contextoNucleo(c, 'manipulacao'),
        chaveIdempotencia: chave,
      },
    );
    if (!saida) throw new Error('Gravação da manipulação sem resultado.');
    return (saida as { valor: T }).valor;
  }

  capelas(c: ContextoNucleo): Promise<CapelaManipulacao[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT c.id, c.nome, c.situacao, g.id AS grupo_id, g.descricao AS grupo_nome
           FROM capela_manipulacao c
           LEFT JOIN capela_manipulacao_grupo cg ON cg.capela_manipulacao_id = c.id AND cg.excluido_em IS NULL
           LEFT JOIN grupo_manipulacao g ON g.id = cg.grupo_manipulacao_id AND g.ativo = TRUE
          WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao <> 'inativa'
          ORDER BY c.nome, c.id, g.descricao`,
        [est],
      );
      const porId = new Map<
        number,
        {
          id: number;
          nome: string;
          funcionando: boolean;
          manipulando: boolean;
          grupos: { id: number; nome: string }[];
        }
      >();
      for (const r of linhas) {
        const id = Number(r['id']);
        let x = porId.get(id);
        if (!x) {
          const situacao = String(r['situacao']);
          x = {
            id,
            nome: String(r['nome']),
            funcionando: situacao === 'disponivel' || situacao === 'em_uso',
            manipulando: situacao === 'em_uso',
            grupos: [],
          };
          porId.set(id, x);
        }
        if (r['grupo_id'] !== null && r['grupo_id'] !== undefined)
          x.grupos.push({ id: Number(r['grupo_id']), nome: String(r['grupo_nome']) });
      }
      return [...porId.values()];
    });
  }

  /**
   * A fila: itens prescritos aprovados pela farmácia desde a data, cujo produto é manipulado, sem ordem já baixada;
   * com o leito da prescrição, as iniciais do paciente e a ordem em curso.
   */
  itensAManipular(c: ContextoPortaM18, desde: string) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT afi.prescricao_item_id, afi.id AS avaliacao_id, af.atendimento_id, lh.codigo AS leito, pf.nome,
                ip.insumo_id, ins.nome AS produto_nome, pr.nome_exibicao AS validado_por,
                COALESCE(afi.avaliado_em, af.concluida_em) AS validado_em,
                (SELECT o.id FROM ordem_manipulacao o
                  WHERE o.prescricao_item_id = afi.prescricao_item_id AND o.estabelecimento_id = af.estabelecimento_id
                    AND o.excluido_em IS NULL AND o.situacao IN ('aberta', 'em_preparo', 'conferida')
                  ORDER BY o.id DESC LIMIT 1) AS ordem
           FROM avaliacao_farmaceutica_item afi
           JOIN avaliacao_farmaceutica af ON af.id = afi.avaliacao_farmaceutica_id AND af.excluido_em IS NULL
           JOIN prescricao_item pi ON pi.id = afi.prescricao_item_id AND pi.excluido_em IS NULL
           JOIN prescricao p ON p.id = pi.prescricao_id
           JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
           JOIN insumo ins ON ins.id = ip.insumo_id AND ins.manipulado = TRUE
           LEFT JOIN leito_hospitalar lh ON lh.id = p.leito_hospitalar_id
           LEFT JOIN paciente pa ON pa.id = af.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           LEFT JOIN profissional pr ON pr.id = COALESCE(afi.liberador_profissional_id, af.farmaceutico_profissional_id)
          WHERE af.estabelecimento_id = ? AND af.situacao = 'concluida' AND afi.excluido_em IS NULL
            AND afi.parecer IN ('aprovado', 'aprovado_com_ressalva')
            AND COALESCE(afi.avaliado_em, af.concluida_em) >= ?
            AND NOT EXISTS (SELECT 1 FROM ordem_manipulacao ob
                             WHERE ob.prescricao_item_id = afi.prescricao_item_id AND ob.situacao = 'baixada'
                               AND ob.excluido_em IS NULL)
          ORDER BY validado_em, afi.id LIMIT ?`,
        [est, desde, TETO + 1],
      );
      const itens = linhas.slice(0, TETO).map((r): ItemAManipular => ({
        itemPrescrito: n(r['prescricao_item_id']),
        avaliacao: n(r['avaliacao_id']),
        atendimento: n(r['atendimento_id']),
        leito: txt(r['leito']),
        iniciais: iniciais(r['nome']),
        produto: nulo(r['insumo_id']),
        produtoNome: txt(r['produto_nome']),
        validadoPor: txt(r['validado_por']) ?? 'automatica',
        validadoEm: hm(r['validado_em']),
        ordem: nulo(r['ordem']),
      }));
      return { itens, cortada: linhas.length > TETO };
    });
  }

  /** A avaliação farmacêutica mais recente do item prescrito no estabelecimento da sessão, ou null. */
  avaliacao(c: ContextoNucleo, itemPrescrito: number): Promise<AvaliacaoDoItem | null> {
    return this.ler(c, (l, est) => lerAvaliacao(l, est, itemPrescrito));
  }

  ordens(c: ContextoPortaM18, de: string, ate: string) {
    return this.ler(c, (l, est) =>
      lerOrdens(l, est, 'o.preparado_em >= ? AND o.preparado_em < ?', [de, diaSeguinte(ate)]),
    );
  }

  ordem(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est) => (await lerOrdens(l, est, 'o.id = ?', [id])).itens[0] ?? null);
  }

  /** Os vínculos profissionais do login no estabelecimento, com o CBO da inscrição principal no conselho. */
  vinculos(c: ContextoPortaM18, login: string) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT uv.profissional_id, cbo.codigo_cbo, ic.situacao,
                (uv.vigencia_inicio <= CURRENT_DATE AND (uv.vigencia_fim IS NULL OR uv.vigencia_fim >= CURRENT_DATE))
                  AS vigente
           FROM usuario u
           JOIN usuario_vinculo_profissional uv ON uv.usuario_id = u.id AND uv.estabelecimento_id = ?
                AND uv.excluido_em IS NULL AND uv.profissional_id IS NOT NULL
           JOIN inscricao_conselho ic ON ic.profissional_id = uv.profissional_id AND ic.excluido_em IS NULL
           JOIN ocupacao_cbo cbo ON cbo.id = ic.ocupacao_cbo_id
          WHERE u.login = ? AND u.excluido_em IS NULL
          ORDER BY ic.principal DESC, ic.id`,
        [est, login],
      );
      return linhas.map((r) => ({
        vinculo: n(r['profissional_id']),
        cbo: String(r['codigo_cbo']),
        ativo: !!n(r['vigente']) && String(r['situacao']) === 'ativa',
      }));
    });
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaManipulacaoIndisponivel(): PortaManipulacao {
  return portaIndisponivel<PortaManipulacao>(METODOS_PORTA_MANIPULACAO);
}
