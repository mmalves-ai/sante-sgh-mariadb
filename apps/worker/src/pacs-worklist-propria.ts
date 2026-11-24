// Porta própria da geração automática da lista de trabalho de imagem (M47, etapa 3; lote F2.2 05-16) sobre o banco do
// cliente, pelo @sgh/nucleo. Tabelas: exame_item, requisicao_exame, exame, modalidade_imagem, estabelecimento (leitura),
// item_lista_trabalho_imagem e exame_item (gravação), parceiro_dados e parametro_valor (o destino do estabelecimento).
// Leituras somente leitura, filtradas pelo estabelecimento do código; gravação pelo Executor (trilha, evento da fila
// comum e idempotência na mesma transação).
// Melhoria: o número de acesso é um só por exame. O exame que já tem número (migração, lançamento manual) o reaproveita
// no item; o exame sem número ganha o da regra do domínio (accessionDoItem), gravado também em exame_item.numero_acesso,
// que o laudo e o arquivo de imagens usam. Só quando o número do exame ficou preso a um item cancelado do mesmo exame
// (a chave única do item é por estabelecimento e número) o item novo ganha número novo e o exame passa a ele, na mesma
// transação; toda gravação no exame confere as linhas afetadas (nada diverge em silêncio).
// Melhoria: exame de imagem sem modalidade no cadastro (ou com modalidade inativa) vira item 'sem_modalidade' (sem
// evento à modalidade), visível na tela de pendências; quando o cadastro ganha a modalidade, o próprio worker promove o
// item a 'a_enviar' e manda o evento. Nenhum exame de imagem fica fora da lista sem registro.
// Melhoria: a chave de idempotência leva a geração do pedido (quantos itens o exame já teve) ou o item promovido: um
// item cancelado não trava o exame para sempre, e a mesma chave nunca recebe entrada diferente.
// Melhoria: a criação trava o exame (FOR UPDATE) e confere o item vigente na mesma transação: dois consumidores não
// duplicam o item mesmo sem chave única por exame no banco (pedido de DDL no saida/05-16.json).
// Melhoria: processo automático sem usuário (usuario null), com a correlação do exame.
import { randomBytes } from 'node:crypto';
import { EVENTO_OUTBOX_MWL } from '@sgh/contratos';
import { accessionDoItem, chaveIdempotenciaMwl } from '@sgh/dominio-sadt';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { idDoEstabelecimento, valorDoParametro } from './clientes-worker.js';
import { destinoDaWorklistNoEstabelecimento } from './integracao/destino-worklist.js';

export interface ModalidadeDoExame {
  readonly id: number;
  readonly sigla: string;
  readonly ativa: boolean;
}

export interface ExameSemItem {
  readonly exame: number;
  readonly paciente: number;
  readonly setor: number;
  readonly urgente: boolean;
  /** null: o exame não tem modalidade no cadastro. */
  readonly modalidade: ModalidadeDoExame | null;
  /** Quantos itens o exame já teve (cancelados e excluídos inclusive): a geração do pedido. */
  readonly geracao: number;
  /** Item 'sem_modalidade' do exame à espera do cadastro (null: nenhum). */
  readonly itemPendente: number | null;
}

export type SituacaoItemCriado = 'a_enviar' | 'sem_modalidade';

export interface ItemRegistrado {
  readonly id: number;
  readonly accession: string;
  readonly situacao: SituacaoItemCriado;
}

export interface PortaWorklist {
  /**
   * O destino da lista de trabalho do estabelecimento (sem chave de liberação): o parceiro do parâmetro
   * `pacs.parceiroWorklist` dele, ativo e com o evento; null sem destino (nada é gerado).
   */
  destinoConfigurado(cod: string, agora: Date): Promise<string | null>;
  /** O parâmetro `pacs.janelaDias` vigente no estabelecimento (null: sem valor). */
  janelaDias(cod: string, agora: Date): Promise<number | null>;
  /**
   * Os exames de imagem da janela sem item vigente, e os que têm item 'sem_modalidade' e já ganharam modalidade ativa
   * (para promover). O exame com item 'sem_modalidade' ainda sem modalidade não volta (já está registrado).
   */
  examesSemItem(
    cod: string,
    desde: Date,
    ate: Date,
    teto: number,
  ): Promise<{ itens: ExameSemItem[]; cortada: boolean }>;
  /**
   * Cria o item (modalidade null: item 'sem_modalidade', sem evento) ou promove o item pendente; null quando o exame já
   * tem item vigente (outro consumidor).
   */
  registrarItem(
    cod: string,
    x: ExameSemItem,
    modalidade: { readonly id: number; readonly sigla: string } | null,
  ): Promise<ItemRegistrado | null>;
}

export interface NucleoWorklist {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const ENTRADA = z.object({
  estabelecimento: z.number().int().positive(),
  hospital: z.string().min(1).max(30),
  exame: z.number().int().positive(),
  modalidade: z.number().int().positive().nullable(),
  setor: z.number().int().positive(),
  urgente: z.boolean(),
  /** Item 'sem_modalidade' a promover (null: criar item novo). */
  itemPendente: z.number().int().positive().nullable(),
});
type EntradaItem = z.infer<typeof ENTRADA>;
type ItemCriado = ResultadoOperacao & ItemRegistrado;

const SITUACOES_A_FAZER = ['solicitado', 'autorizado', 'agendado'] as const;
/** O formato do número de acesso aceito pela modalidade (o mesmo CHECK do banco). */
const FORMATO_ACESSO = /^[A-Z0-9]{4,16}$/;

/** A chave de idempotência da gravação: a do exame no domínio mais a geração do pedido (ou o item promovido). */
export function chaveDoPedido(
  cod: string,
  x: Pick<ExameSemItem, 'exame' | 'geracao' | 'itemPendente'>,
): string {
  const sufixo = x.itemPendente !== null ? `p${x.itemPendente}` : `g${x.geracao}`;
  return `${chaveIdempotenciaMwl(cod, x.exame)}:${sufixo}`;
}

/** O número de acesso do item novo, sem dar ao exame um segundo número sem registro. */
async function numeroDoItem(
  tx: Leitor & { executar(sql: string, p?: readonly unknown[]): Promise<number> },
  e: EntradaItem,
  doExame: string | null,
  id: number,
): Promise<string> {
  if (doExame !== null) {
    if (!FORMATO_ACESSO.test(doExame))
      throw recusa(
        'numero-acesso-invalido',
        'O número de acesso do exame não segue o formato da modalidade.',
      );
    const usado = await tx.uma(
      'SELECT exame_item_id FROM item_lista_trabalho_imagem WHERE estabelecimento_id = ? AND numero_acesso = ? AND id <> ?',
      [e.estabelecimento, doExame, id],
    );
    if (!usado) return doExame;
    if (Number(usado['exame_item_id']) !== e.exame)
      throw recusa(
        'numero-acesso-divergente',
        'O número de acesso do exame já é de outro exame na lista de trabalho.',
      );
    // O número ficou num item cancelado deste exame: o item novo ganha número novo e o exame passa a ele.
  }
  const novo = accessionDoItem(e.hospital, id);
  const linhas = await tx.executar(
    `UPDATE exame_item SET numero_acesso = ?, alterado_em = ?, versao = versao + 1
      WHERE id = ? AND ${doExame === null ? 'numero_acesso IS NULL' : 'numero_acesso = ?'}`,
    doExame === null ? [novo, new Date(), e.exame] : [novo, new Date(), e.exame, doExame],
  );
  if (linhas !== 1)
    throw recusa('numero-acesso-concorrente', 'O número de acesso do exame mudou durante a gravação.');
  return novo;
}

/** A operação de criação (ou promoção) do item (exportada para os testes conferirem nome e tabelas). */
export const OPERACAO_ITEM_WORKLIST = definirOperacao<EntradaItem, ItemCriado>({
  nome: 'sadt.enviar_worklist',
  tabelas: ['item_lista_trabalho_imagem', 'exame_item'],
  entrada: ENTRADA,
  gravar: async (tx, e) => {
    const [exame] = await tx.consultarParaAtualizar(
      'SELECT id, numero_acesso FROM exame_item WHERE id = ? AND excluido_em IS NULL',
      [e.exame],
      { teto: 1 },
    );
    if (!exame) throw recusa('exame-inexistente', 'O exame não existe ou foi excluído.');
    if (e.itemPendente !== null) {
      if (e.modalidade === null)
        throw recusa('sem-modalidade', 'A promoção do item exige a modalidade do exame.');
      const [item] = await tx.consultarParaAtualizar(
        `SELECT id, numero_acesso FROM item_lista_trabalho_imagem
          WHERE id = ? AND exame_item_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'sem_modalidade'`,
        [e.itemPendente, e.exame, e.estabelecimento],
        { teto: 1 },
      );
      if (!item) throw recusa('ja-na-worklist', 'O item do exame já saiu da espera pela modalidade.');
      const linhas = await tx.executar(
        `UPDATE item_lista_trabalho_imagem SET modalidade_imagem_id = ?, situacao = 'a_enviar', alterado_em = ?, versao = versao + 1
          WHERE id = ? AND situacao = 'sem_modalidade'`,
        [e.modalidade, new Date(), e.itemPendente],
      );
      if (linhas !== 1) throw recusa('ja-na-worklist', 'O item do exame já saiu da espera pela modalidade.');
      return { id: e.itemPendente, accession: String(item['numero_acesso']), situacao: 'a_enviar' };
    }
    const ja = await tx.uma(
      `SELECT id FROM item_lista_trabalho_imagem WHERE exame_item_id = ? AND excluido_em IS NULL
          AND situacao NOT IN ('cancelado', 'descontinuado')`,
      [e.exame],
    );
    if (ja) throw recusa('ja-na-worklist', 'O exame já tem item na lista de trabalho de imagem.');
    const situacao: SituacaoItemCriado = e.modalidade === null ? 'sem_modalidade' : 'a_enviar';
    // Número provisório só dentro da transação (a regra do número usa o id do item).
    const provisorio = `T${randomBytes(8).toString('hex').toUpperCase().slice(0, 15)}`;
    const id = await tx.incluir('item_lista_trabalho_imagem', {
      estabelecimento_id: e.estabelecimento,
      exame_item_id: e.exame,
      modalidade_imagem_id: e.modalidade,
      setor_diagnostico_id: e.setor,
      numero_acesso: provisorio,
      situacao,
      situacao_entrega: 'pendente',
      forma_envio: 'automatico',
      urgente: e.urgente,
      origem: 'sistema',
    });
    const doExame =
      exame['numero_acesso'] === null || exame['numero_acesso'] === undefined
        ? null
        : String(exame['numero_acesso']);
    const accession = await numeroDoItem(tx, e, doExame, id);
    await tx.executar('UPDATE item_lista_trabalho_imagem SET numero_acesso = ? WHERE id = ?', [
      accession,
      id,
    ]);
    return { id, accession, situacao };
  },
  // O item 'sem_modalidade' não vai à modalidade: o evento só sai com a modalidade (na criação ou na promoção).
  eventos: (e, r) =>
    r.situacao === 'a_enviar'
      ? [{ tipo: EVENTO_OUTBOX_MWL, carga: { hospital: e.hospital, exame: e.exame, item: r.id } }]
      : [],
  alvo: (_e, r) => ({ tabela: 'item_lista_trabalho_imagem', id: r.id }),
});

const bool = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (typeof v === 'bigint' && v === 1n);
const idOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class PortaWorklistPropria implements PortaWorklist {
  private readonly executor: Executor;
  private readonly ids = new Map<string, number>();

  constructor(
    private readonly nucleo: NucleoWorklist,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pacs-worklist' }, fn);
  }

  private async estabelecimento(cod: string): Promise<number> {
    const ja = this.ids.get(cod);
    if (ja !== undefined) return ja;
    const id = await this.ler((l) => idDoEstabelecimento(l, cod));
    if (id === null) throw recusa('estabelecimento-desconhecido', 'O estabelecimento não está cadastrado.');
    this.ids.set(cod, id);
    return id;
  }

  destinoConfigurado(cod: string, agora: Date): Promise<string | null> {
    return this.ler((l) => destinoDaWorklistNoEstabelecimento(l, cod, agora));
  }

  async janelaDias(cod: string, agora: Date): Promise<number | null> {
    const id = await this.estabelecimento(cod);
    const v = await this.ler((l) =>
      valorDoParametro(
        l,
        'pacs.janelaDias',
        { cliente: this.cliente, estabelecimento: { id, codigo: cod } },
        agora,
      ),
    );
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  async examesSemItem(
    cod: string,
    desde: Date,
    ate: Date,
    teto: number,
  ): Promise<{ itens: ExameSemItem[]; cortada: boolean }> {
    const n = Math.max(1, Math.min(5_000, Math.trunc(teto)));
    // LEFT JOIN: o exame sem modalidade no cadastro também é lido (vira item 'sem_modalidade'), nunca some.
    const linhas = await this.ler((l) =>
      l.consultar(
        `SELECT ei.id, q.paciente_id, COALESCE(ei.setor_diagnostico_id, q.setor_diagnostico_id) AS setor,
                ei.urgente, q.prioridade, mi.id AS modalidade_id, mi.sigla_padrao, mi.ativo AS modalidade_ativa,
                (SELECT COUNT(*) FROM item_lista_trabalho_imagem g WHERE g.exame_item_id = ei.id) AS geracao,
                (SELECT MAX(sm.id) FROM item_lista_trabalho_imagem sm
                  WHERE sm.exame_item_id = ei.id AND sm.excluido_em IS NULL AND sm.situacao = 'sem_modalidade') AS item_pendente
           FROM exame_item ei
           JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id AND q.excluido_em IS NULL
           JOIN estabelecimento e ON e.id = q.estabelecimento_id
           JOIN exame ex ON ex.id = ei.exame_id
           LEFT JOIN modalidade_imagem mi ON mi.id = ex.modalidade_imagem_id
          WHERE e.codigo = ? AND ex.tipo_servico = 'imagem' AND ei.excluido_em IS NULL AND ei.situacao IN (?, ?, ?)
            AND q.solicitado_em >= ? AND q.solicitado_em <= ?
            AND NOT EXISTS (SELECT 1 FROM item_lista_trabalho_imagem it
                             WHERE it.exame_item_id = ei.id AND it.excluido_em IS NULL
                               AND it.situacao NOT IN ('cancelado', 'descontinuado', 'sem_modalidade'))
            AND (mi.ativo = 1 OR NOT EXISTS (SELECT 1 FROM item_lista_trabalho_imagem sp
                                              WHERE sp.exame_item_id = ei.id AND sp.excluido_em IS NULL
                                                AND sp.situacao = 'sem_modalidade'))
          ORDER BY ei.id LIMIT ${n + 1}`,
        [cod, ...SITUACOES_A_FAZER, desde, ate],
        { teto: n + 1 },
      ),
    );
    const itens = linhas.slice(0, n).map((x) => ({
      exame: Number(x['id']),
      paciente: Number(x['paciente_id']),
      setor: Number(x['setor']),
      urgente: bool(x['urgente']) || (x['prioridade'] !== undefined && x['prioridade'] !== 'rotina'),
      modalidade:
        x['modalidade_id'] === null || x['modalidade_id'] === undefined
          ? null
          : {
              id: Number(x['modalidade_id']),
              sigla: String(x['sigla_padrao']),
              ativa: bool(x['modalidade_ativa']),
            },
      geracao: Number(x['geracao'] ?? 0),
      itemPendente: idOuNulo(x['item_pendente']),
    }));
    return { itens, cortada: linhas.length > n };
  }

  async registrarItem(
    cod: string,
    x: ExameSemItem,
    modalidade: { readonly id: number; readonly sigla: string } | null,
  ): Promise<ItemRegistrado | null> {
    const estabelecimento = await this.estabelecimento(cod);
    try {
      const s = await this.executor.executar(
        OPERACAO_ITEM_WORKLIST,
        this.cliente,
        {
          estabelecimento,
          hospital: cod,
          exame: x.exame,
          modalidade: modalidade?.id ?? null,
          setor: x.setor,
          urgente: x.urgente,
          itemPendente: x.itemPendente,
        },
        {
          cliente: this.cliente,
          estabelecimento,
          usuario: null,
          correlacao: `pacs-${cod}-${x.exame}`.slice(0, 64),
          chaveIdempotencia: chaveDoPedido(cod, x),
        },
      );
      // Repetida (a mesma chave já confirmada por outro consumidor): o item é o dele; este não conta como criado.
      if (s.repetida) return null;
      return { id: s.resultado.id, accession: s.resultado.accession, situacao: s.resultado.situacao };
    } catch (erro) {
      if (erro instanceof ErroOperacao && erro.problema.codigo === 'ja-na-worklist') return null;
      throw erro;
    }
  }
}
