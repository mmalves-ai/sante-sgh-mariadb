// Porta da farmácia hospitalar e da farmácia clínica sobre o banco do cliente (M29), pelo @sgh/nucleo: leituras
// somente leitura no modelo próprio (unidade de internação, local de estoque, insumo, lote e saldo, lista de controle
// especial, avaliação e intervenção farmacêutica). Toda leitura filtra o estabelecimento da sessão e os registros
// excluídos; o insumo e as listas de controle especial são da rede inteira (não têm estabelecimento).
// Melhoria: o saldo do controlado e do lote vem do saldo por local (saldo_estoque, saldo_lote), não de recálculo de
// movimentos; a decisão da avaliação vem do parecer por item prescrito (avaliacao_farmaceutica_item) e a intervenção
// tem o aceite do prescritor com data e justificativa (CHECK do banco); horas no fuso do estabelecimento.
// Melhoria: a triagem, a decisão por item, a intervenção e a resposta do prescritor gravam no modelo próprio pelo
// Executor (gravador-avaliacao.ts: avaliacao_farmaceutica, avaliacao_farmaceutica_item e intervencao_farmaceutica),
// com a trilha no alvo gravado de fato e um evento no outbox por gravação.
// Pendências, cada uma com o seu pedido no lote 02-06: a fila de dispensação por horário, a dispensação, a entrega,
// a devolução e o cancelamento da dose e a avaliação pelo horário (contrato com números de situação e documento por
// ano/mês: ver tipos.ts); a perda e a conferência do controlado; o fechamento do livro com o conteúdo e o hash; a
// dispensação ambulatorial; a escrituração do envio nacional; a pendência de revisão médica (parecer sem valor no
// CHECK). Até lá, essas leituras voltam vazias e essas gravações recusam com 'modelo-pendente' (409); nada é gravado
// pela metade.
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaM18,
  type GravacaoFeita,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import { civil, FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import { type ExtrasGravacaoFarmacia, gravadorAvaliacao, pendenteFarmacia, TABELAS_AVALIACAO } from './gravador-avaliacao.js';
import { ENTRADAS_FARMACIA } from './operacoes.js';
import {
  type ContextoFarmacia,
  type GravadorSghFarmacia,
  METODOS_PORTA_FARMACIA,
  type ParametrosIntegracaoLidos,
  type PortaFarmacia,
  type UnidadeLida,
} from './porta.js';
import type { AvaliacaoRegistrada, IntervencaoRegistrada, ItemControlado, ItemFarmacia } from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoFarmacia = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';

/** Teto das listas lidas de uma vez. */
const TETO = 500;

function minutoCivil(v: unknown, fuso: string): string {
  const d = v instanceof Date ? v : new Date(String(v));
  const c = civil(d, fuso);
  return `${c.data}T${c.hhmm.slice(0, 2)}:${c.hhmm.slice(2, 4)}`;
}

export { pendenteFarmacia };

/** Parecer por item (modelo) → decisão da tela. */
const DECISAO_DO_PARECER: Readonly<Record<string, string>> = {
  aprovado: 'valido',
  aprovado_com_ressalva: 'valido',
  recusado: 'nao-aprovado',
  substituido: 'pendencia-revisao-medica',
};

const SQL_INTERVENCAO = `
  SELECT iv.id, iv.avaliacao_farmaceutica_id, iv.prescricao_item_id, ti.codigo AS tipo, iv.proposta,
         iv.realizada_em, iv.aceite, iv.aceite_em, iv.justificativa_recusa, a.atendimento_id,
         ua.login AS autor, ur.login AS respondente,
         (SELECT up.login FROM usuario_vinculo_profissional uv JOIN usuario up ON up.id = uv.usuario_id
           WHERE uv.profissional_id = iv.prescritor_profissional_id AND uv.estabelecimento_id = a.estabelecimento_id
             AND uv.excluido_em IS NULL ORDER BY uv.vigencia_inicio DESC LIMIT 1) AS prescritor
    FROM intervencao_farmaceutica iv
    JOIN avaliacao_farmaceutica a ON a.id = iv.avaliacao_farmaceutica_id
    JOIN tipo_intervencao_farmaceutica ti ON ti.id = iv.tipo_intervencao_farmaceutica_id
    LEFT JOIN usuario ua ON ua.id = iv.criado_por
    LEFT JOIN usuario ur ON ur.id = iv.alterado_por
   WHERE a.estabelecimento_id = ? AND iv.excluido_em IS NULL AND a.excluido_em IS NULL`;

function intervencaoDe(r: Linha, fuso: string): IntervencaoRegistrada {
  const aceite = texto(r['aceite']);
  const respondida = !['pendente', 'sem_resposta'].includes(aceite);
  return {
    id: n(r['id']),
    avaliacao: n(r['avaliacao_farmaceutica_id']),
    item: n(r['prescricao_item_id']),
    tipo: texto(r['tipo']),
    texto: texto(r['proposta']),
    autor: texto(r['autor']),
    prescritor: textoOuNulo(r['prescritor']),
    criadaEm: minutoCivil(r['realizada_em'], fuso),
    estado: respondida ? 'respondida' : 'aberta',
    resposta: aceite === 'recusada' ? 'recusada' : aceite.startsWith('aceita') ? 'aceita' : null,
    justificativa: textoOuNulo(r['justificativa_recusa']),
    respondente: respondida ? textoOuNulo(r['respondente']) : null,
    respondidaEm: r['aceite_em'] ? minutoCivil(r['aceite_em'], fuso) : null,
    atendimento: n(r['atendimento_id']),
  };
}

export class PortaFarmaciaPropria implements PortaFarmacia {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoFarmacia,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoFarmacia, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  private async fuso(l: Leitor, est: number): Promise<string> {
    const r = await l.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [
      est,
    ]);
    return r?.fuso_horario || FUSO_PADRAO;
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(_c: ContextoPortaM18, op: string): Promise<LiberacaoGravacao> {
    if (!ENTRADAS_FARMACIA[op]) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return {
      pode: false,
      codigo: 'modelo-pendente',
      motivo: 'A gravação aguarda a estrutura própria no modelo do banco.',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  async executar(_c: ContextoPortaM18, op: string, entrada: unknown, _ctx: ContextoOperacao): Promise<GravacaoFeita> {
    const esquema = ENTRADAS_FARMACIA[op];
    if (!esquema)
      throw new ErroOperacao(400, 'operacao-desconhecida', 'Operação desconhecida', `A operação ${op} não existe.`);
    // A entrada é conferida antes (o erro de campo vem primeiro); a gravação espera o modelo.
    const a = esquema.safeParse(entrada);
    if (!a.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(a.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    throw pendenteFarmacia(`A operação ${op}`);
  }

  /**
   * As gravações diretas das telas numa operação do Executor (trilha, outbox e idempotência na mesma transação): a
   * triagem, a decisão, a intervenção e a resposta gravam no modelo próprio (gravador-avaliacao.ts); as demais
   * recusam com 'modelo-pendente', cada uma com o seu pedido no lote 02-06.
   */
  async gravarSgh<T>(
    c: ContextoFarmacia,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao) | null,
    fn: (g: GravadorSghFarmacia) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (c.usuario === null) throw recusa('sem-usuario', 'A gravação da farmácia exige o usuário da sessão.');
    const usuario = c.usuario;
    let saida: { valor: T } | null = null;
    const extras: ExtrasGravacaoFarmacia = { alvo: null, eventos: [] };
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const pendente = (oQue: string) => async (): Promise<never> => {
      throw pendenteFarmacia(oQue);
    };
    const op = definirOperacao({
      nome: 'farmacia.gravacao-direta',
      tabelas: TABELAS_AVALIACAO,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        saida = {
          valor: await fn({
            ...gravadorAvaliacao(tx, est, usuario, extras),
            conferirControlado: pendente('A conferência do controlado'),
            fecharLivro: pendente('O fechamento do livro de controlados'),
            dispensarAmbulatorial: pendente('A dispensação ambulatorial'),
            escriturarSngpc: pendente('A escrituração do envio nacional de controlados'),
          }),
        };
        return {} as ResultadoOperacao;
      },
      // O alvo é a linha gravada de fato (não o rótulo da tela).
      alvo: () => extras.alvo ?? { tabela: 'avaliacao_farmaceutica', id: null },
      eventos: () => extras.eventos,
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `farmacia:${randomUUID()}`;
    await this.executor.executar(op, c.cliente, { chave }, { ...contextoDe(c), chaveIdempotencia: chave });
    if (!saida) throw new Error('Gravação da farmácia sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoFarmacia) {
    return this.ler(c, async (l, est) => ({ agora: new Date(), hoje: relogioNoFuso(await this.fuso(l, est)).hoje }));
  }

  /** As unidades de internação do estabelecimento, com quantos internados (internação ativa) cada uma tem. */
  unidades(c: ContextoFarmacia): Promise<UnidadeLida[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT u.codigo, u.descricao,
                  (SELECT COUNT(*) FROM internacao i WHERE i.unidade_internacao_id = u.id AND i.estabelecimento_id = u.estabelecimento_id
                      AND i.situacao IN ('ativa','alta_medica') AND i.excluido_em IS NULL) AS internados
             FROM unidade_internacao u
            WHERE u.estabelecimento_id = ? AND u.excluido_em IS NULL AND u.ativo
            ORDER BY u.descricao LIMIT ${TETO}`,
          [est],
        )
      ).map((r) => ({ unidade: texto(r['codigo']), nome: texto(r['descricao']), internados: n(r['internados']) })),
    );
  }

  /** Os locais de estoque que dispensam (farmácia central ou satélite) e ativos. */
  locais(c: ContextoFarmacia) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, nome FROM local_estoque
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo
              AND tipo IN ('farmacia_central','farmacia_satelite')
            ORDER BY nome LIMIT ${TETO}`,
          [est],
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) })),
    );
  }

  /** Os lotes com saldo do insumo no local (validade primeiro), sem os bloqueados nem os vencidos. */
  lotes(c: ContextoFarmacia, item: number, local: number) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT li.id, li.numero_lote, li.validade, sl.quantidade
             FROM saldo_lote sl
             JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL
             JOIN local_estoque le ON le.id = sl.local_estoque_id
            WHERE sl.estabelecimento_id = ? AND le.estabelecimento_id = ? AND sl.local_estoque_id = ?
              AND li.insumo_id = ? AND sl.excluido_em IS NULL AND sl.quantidade > 0 AND NOT sl.bloqueado
              AND li.situacao = 'liberado' AND li.validade >= CURRENT_DATE
            ORDER BY li.validade, li.numero_lote LIMIT 100`,
          [est, est, local, item],
        )
      ).map((r) => ({
        id: n(r['id']),
        lote: texto(r['numero_lote']),
        validade: dataIso(r['validade']),
        quantidade: n(r['quantidade']),
      })),
    );
  }

  /** O cadastro do insumo (rede inteira): rastreabilidade, lista de controle, classe e código de barras. */
  itens(c: ContextoFarmacia, codigos: readonly number[]): Promise<Map<number, ItemFarmacia>> {
    const ids = [...new Set(codigos)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT i.id, i.controla_lote, i.controlado, i.antimicrobiano, i.codigo_gtin, lc.codigo_lista
           FROM insumo i LEFT JOIN lista_controle_especial lc ON lc.id = i.lista_controle_especial_id
          WHERE i.id IN (${lista(ids.length)}) AND i.excluido_em IS NULL`,
        ids,
      );
      return new Map(
        linhas.map((r) => [
          n(r['id']),
          {
            codigo: n(r['id']),
            rastreavel: verdadeiro(r['controla_lote']),
            portaria: textoOuNulo(r['codigo_lista']),
            psico: verdadeiro(r['controlado']),
            antimicrobiano: verdadeiro(r['antimicrobiano']),
            barras: textoOuNulo(r['codigo_gtin']),
            envioAvaliacao: null,
          },
        ]),
      );
    });
  }

  /** A decisão da avaliação farmacêutica por item prescrito (o parecer mais recente de cada item). */
  avaliacoes(c: ContextoFarmacia, itens: readonly number[]): Promise<Map<number, AvaliacaoRegistrada>> {
    const ids = [...new Set(itens)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT ai.id, ai.prescricao_item_id, ai.parecer, ai.avaliado_em, u.login
           FROM avaliacao_farmaceutica_item ai
           JOIN avaliacao_farmaceutica a ON a.id = ai.avaliacao_farmaceutica_id
           LEFT JOIN usuario u ON u.id = ai.criado_por
          WHERE a.estabelecimento_id = ? AND ai.prescricao_item_id IN (${lista(ids.length)})
            AND ai.excluido_em IS NULL AND a.excluido_em IS NULL
          ORDER BY ai.avaliado_em, ai.id`,
        [est, ...ids],
      );
      const r = new Map<number, AvaliacaoRegistrada>();
      for (const x of linhas)
        r.set(n(x['prescricao_item_id']), {
          id: n(x['id']),
          item: n(x['prescricao_item_id']),
          estado: 'decidido',
          decisao: DECISAO_DO_PARECER[texto(x['parecer'])] ?? null,
          destino: 'humana',
          prioridade: 0,
          achados: [],
          desde: minutoCivil(x['avaliado_em'], fuso),
          farmaceutico: textoOuNulo(x['login']),
        });
      return r;
    });
  }

  intervencoesDosItens(c: ContextoFarmacia, itens: readonly number[]): Promise<IntervencaoRegistrada[]> {
    const ids = [...new Set(itens)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (
        await l.consultar(`${SQL_INTERVENCAO} AND iv.prescricao_item_id IN (${lista(ids.length)}) ORDER BY iv.realizada_em, iv.id`, [
          est,
          ...ids,
        ])
      ).map((r) => intervencaoDe(r, fuso));
    });
  }

  /** As intervenções abertas dirigidas ao prescritor (pelo login vinculado ao profissional). */
  intervencoesDoPrescritor(c: ContextoFarmacia, login: string): Promise<IntervencaoRegistrada[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (
        await l.consultar(
          `${SQL_INTERVENCAO} AND iv.aceite = 'pendente' AND iv.prescritor_profissional_id IN (
             SELECT uv.profissional_id FROM usuario_vinculo_profissional uv JOIN usuario u ON u.id = uv.usuario_id
              WHERE u.login = ? AND uv.estabelecimento_id = ? AND uv.excluido_em IS NULL AND uv.profissional_id IS NOT NULL)
           ORDER BY iv.realizada_em, iv.id LIMIT ${TETO}`,
          [est, login, est],
        )
      ).map((r) => intervencaoDe(r, fuso));
    });
  }

  intervencao(c: ContextoFarmacia, id: number): Promise<IntervencaoRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_INTERVENCAO} AND iv.id = ?`, [est, id]);
      return r ? intervencaoDe(r, await this.fuso(l, est)) : null;
    });
  }

  totaisIntervencoes(c: ContextoFarmacia, desde: Date) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT SUM(iv.aceite = 'pendente') AS abertas, SUM(iv.aceite IN ('aceita','aceita_parcial')) AS aceitas,
                SUM(iv.aceite = 'recusada') AS recusadas
           FROM intervencao_farmaceutica iv JOIN avaliacao_farmaceutica a ON a.id = iv.avaliacao_farmaceutica_id
          WHERE a.estabelecimento_id = ? AND iv.realizada_em >= ? AND iv.excluido_em IS NULL AND a.excluido_em IS NULL`,
        [est, desde],
      );
      return { abertas: n(r?.['abertas']), aceitas: n(r?.['aceitas']), recusadas: n(r?.['recusadas']) };
    });
  }

  /** Os insumos controlados (com lista de controle especial) com o saldo no estabelecimento. */
  controlados(c: ContextoFarmacia): Promise<ItemControlado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT i.id, i.nome, lc.codigo_lista,
                  COALESCE((SELECT SUM(se.quantidade) FROM saldo_estoque se
                             WHERE se.insumo_id = i.id AND se.estabelecimento_id = ? AND se.excluido_em IS NULL), 0) AS estoque
             FROM insumo i JOIN lista_controle_especial lc ON lc.id = i.lista_controle_especial_id
            WHERE i.excluido_em IS NULL AND i.situacao = 'ativo'
            ORDER BY i.nome LIMIT ${TETO}`,
          [est],
        )
      ).map((r) => ({
        item: n(r['id']),
        nome: texto(r['nome']),
        portaria: texto(r['codigo_lista']),
        estoque: n(r['estoque']),
      })),
    );
  }

  async parametrosIntegracao(): Promise<ParametrosIntegracaoLidos> {
    // A integração com o sistema de dispensação automatizada não existe no modelo próprio: nada a configurar.
    return { centros: [], horarios: [], validacaoFarmaceutica: false, tipos: [] };
  }

  // Leituras que esperam o modelo/contrato (pedidos do lote 02-06): vazias, sem inventar dado.
  async filaDaUnidade() {
    return { doses: [], cortada: false };
  }
  async itensPrescritos() {
    return new Map<number, { alergiaJustificada: boolean; produto: number | null }>();
  }
  async dosesDoAtendimento() {
    return [];
  }
  async situacoes() {
    return new Map<number, { situacao: string; em: string | null }>();
  }
  async entregas() {
    return [];
  }
  async dosesDaSaida() {
    return [];
  }
  async leitos() {
    return new Map<number, { leito: string; iniciais: string }>();
  }
  async aceites() {
    return new Map<number, { autor: string; em: string; modo: string }>();
  }
  async substituicoes() {
    return [];
  }
  async movimentos() {
    return [];
  }
  async conferencias() {
    return [];
  }
  async livroFechado() {
    return null;
  }
  async janelaEntregas() {
    return { desde: null };
  }
  async ambulatoriais() {
    return [];
  }
}

function contextoDe(c: ContextoPortaM18) {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'farmacia').slice(0, 64),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaFarmaciaIndisponivel(): PortaFarmacia {
  return portaIndisponivel<PortaFarmacia>(METODOS_PORTA_FARMACIA);
}
