// Entrada de produtos recebidos em doação (C1-126, 09-AREA linha 79), sobre o MariaDB do cliente pelo Executor do núcleo
// (trilha na mesma transação, versão conferida, Idempotency-Key). A regra pura mora em `@sgh/contratos/regras-suprimentos`
// (entrada-doacao): doador, termo, data, itens e o custo de referência (valor justo do termo ou último preço de compra,
// NBC TG 07). Aqui fica a gravação: o recebimento (nota_entrada com doacao = TRUE, sem pedido nem título a pagar, o
// doador empresa no emitente ou o doador pessoa em doador_pessoa_fisica_id, o termo no número do documento), os itens
// com o critério do custo, os lotes, o movimento "entrada_doacao" (propriedade doação, custo médio novo) e a parte
// doada do saldo (quantidade_doada). O último preço de compra do item não muda. Nada é apagado.
import {
  avisosValorJusto,
  buscaDoDoador,
  conferirEntradaDoacao,
  CRITERIOS_CUSTO_DOACAO,
  type CriterioCustoDoacao,
  custoDaDoacao,
  type ItemDoacaoParaConferir,
  type RecusaSuprimentos,
  TIPOS_DOADOR,
  type TipoDoador,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { conferirPolitica } from './politica-local-propria.js';
import {
  exigirMesAberto,
  hojeNoEstabelecimento,
  insumoAtivo,
  localDoEstabelecimento,
  lotesDaEntrada,
  movimentar,
  tipoMovimentoId,
} from './porta-propria.js';

export const PORTA_ENTRADA_DOACAO = Symbol('PORTA_ENTRADA_DOACAO');
export const OPERACAO_ENTRADA_DOACAO = 'suprimentos.doacao.registrar';
export const TABELAS_ENTRADA_DOACAO = [
  'nota_entrada',
  'nota_entrada_item',
  'saldo_estoque',
  'saldo_lote',
  'lote_insumo',
  'movimento_estoque',
  'movimento_lote',
] as const;

const id = z.number().int().positive();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const esquemaEntradaDoacao = z
  .object({
    doador: z.object({ tipo: z.enum(TIPOS_DOADOR), id }).strict(),
    termo: z.string().trim().min(1).max(20),
    recebidaEm: dataIso,
    local: id,
    observacao: z.string().trim().max(2000).nullable().optional(),
    itens: z
      .array(
        z
          .object({
            item: id,
            quantidade: z.number().positive().max(999_999_999),
            criterio: z.enum(CRITERIOS_CUSTO_DOACAO),
            valorJusto: z.number().nonnegative().max(999_999_999).nullable(),
            lotes: z
              .array(
                z
                  .object({
                    lote: z.string().trim().min(1).max(30),
                    validade: dataIso,
                    quantidade: z.number().positive(),
                  })
                  .strict(),
              )
              .max(50)
              .default([]),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type EntradaDoacao = z.infer<typeof esquemaEntradaDoacao>;

export interface DoadorOpcao {
  readonly tipo: TipoDoador;
  readonly id: number;
  readonly nome: string;
  /** Documento mascarado (só os 4 últimos dígitos), para distinguir homônimos. */
  readonly documento: string | null;
}
export interface ReferenciaItemDoacao {
  readonly item: number;
  readonly nome: string;
  readonly controlaLote: boolean;
  readonly ultimoPreco: number | null;
}
export interface DoacaoRecebida {
  readonly id: number;
  readonly numero: number;
  readonly termo: string;
  readonly recebidaEm: string;
  readonly doador: string;
  readonly tipoDoador: TipoDoador;
  readonly local: string;
  readonly itens: number;
  readonly valorTotal: number;
}
export interface ResultadoDoacao {
  readonly id: number;
  readonly numero: number;
  readonly itens: number;
  readonly valorTotal: number;
  /** Itens cujo valor justo difere mais de 50% do último preço de compra (gravado, só aviso). */
  readonly avisos: readonly number[];
}
/** O que a operação devolve ao Executor (só valores simples; os avisos vão como lista de ids separada por vírgula). */
type GravadoDoacao = {
  readonly id: number;
  readonly numero: number;
  readonly itens: number;
  readonly valorTotal: number;
  readonly avisos: string;
};

export interface PortaEntradaDoacao {
  readonly destino: 'banco' | 'indisponivel';
  doadores(c: ContextoPortaM18, termo: string): Promise<DoadorOpcao[]>;
  referencia(c: ContextoPortaM18, item: number): Promise<ReferenciaItemDoacao>;
  recebidas(c: ContextoPortaM18): Promise<DoacaoRecebida[]>;
  registrar(c: ContextoPortaM18, e: EntradaDoacao, chave: string): Promise<ResultadoDoacao>;
}

const n = (v: unknown) => Number(v ?? 0);
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const qtd = (x: number) => Math.round(x * 10_000) / 10_000;
const dia = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : t(v).slice(0, 10);
const mascara = (doc: unknown): string | null => {
  const d = t(doc).replace(/\D/g, '');
  return d.length >= 4 ? `…${d.slice(-4)}` : null;
};

function recusar(r: RecusaSuprimentos | undefined): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : undefined);
}

/** O último preço de compra (custo por unidade do estoque) do item no estabelecimento; nulo se nunca comprado. */
async function ultimoPrecoDeCompra(l: Leitor, est: number, insumo: number): Promise<number | null> {
  const r = await l.uma<Linha>(
    `SELECT ni.custo_unitario FROM nota_entrada_item ni
       JOIN nota_entrada ne ON ne.id = ni.nota_entrada_id
      WHERE ne.estabelecimento_id = ? AND ni.insumo_id = ? AND ne.doacao = FALSE AND ne.situacao = 'confirmada'
        AND ne.excluido_em IS NULL AND ni.excluido_em IS NULL AND ni.custo_unitario > 0
      ORDER BY ne.data_entrada DESC, ni.id DESC LIMIT 1`,
    [est, insumo],
  );
  return r ? n(r['custo_unitario']) : null;
}

/** O doador do cadastro, ativo (empresa) ou existente (pessoa). */
async function conferirDoador(tx: TxOperacao, d: EntradaDoacao['doador']): Promise<void> {
  const r =
    d.tipo === 'empresa'
      ? await tx.uma(
          "SELECT id FROM empresa_fornecedora WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
          [d.id],
        )
      : await tx.uma('SELECT id FROM pessoa_fisica WHERE id = ? AND excluido_em IS NULL', [d.id]);
  if (!r)
    throw recusa('doador-inexistente', 'O doador não está no cadastro (ou não está ativo).', {
      campos: ['doador'],
    });
}

async function registrarDoacao(
  tx: TxOperacao,
  est: number,
  e: EntradaDoacao,
  hoje: string,
): Promise<GravadoDoacao> {
  const usuario = tx.contexto.usuario;
  if (usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  // O último preço de cada item, para o critério e o aviso (a regra confere antes de qualquer gravação).
  const paraConferir: ItemDoacaoParaConferir[] = [];
  for (const it of e.itens)
    paraConferir.push({
      item: it.item,
      quantidade: it.quantidade,
      criterio: it.criterio,
      valorJusto: it.valorJusto,
      ultimoPreco: await ultimoPrecoDeCompra(tx, est, it.item),
    });
  recusar(
    conferirEntradaDoacao({
      doador: e.doador,
      termo: e.termo,
      recebidaEm: e.recebidaEm,
      hoje,
      itens: paraConferir,
    })[0],
  );
  await exigirMesAberto(tx, est, hoje);
  await localDoEstabelecimento(tx, est, e.local);
  recusar(
    (await conferirPolitica(tx, {
      est,
      usuario,
      itens: e.itens.map((i) => i.item),
      acao: 'movimentar',
      locaisQueGuardam: [e.local],
    })) ?? undefined,
  );
  await conferirDoador(tx, e.doador);
  const termo = e.termo.trim();
  const repetido = await tx.uma(
    `SELECT id FROM nota_entrada WHERE estabelecimento_id = ? AND doacao = TRUE AND numero_documento = ?
        AND empresa_fornecedora_id <=> ? AND doador_pessoa_fisica_id <=> ? AND situacao <> 'cancelada' AND excluido_em IS NULL`,
    [
      est,
      termo,
      e.doador.tipo === 'empresa' ? e.doador.id : null,
      e.doador.tipo === 'pessoa' ? e.doador.id : null,
    ],
  );
  if (repetido)
    throw recusa('termo-repetido', 'Este termo de doação do doador já foi lançado.', { campos: ['termo'] });
  const tipoEntrada = await tx.uma<Linha>(
    "SELECT id FROM tipo_entrada_estoque WHERE codigo = 'doacao' AND natureza = 'doacao' AND ativo = TRUE",
  );
  if (!tipoEntrada)
    throw recusa(
      'tipo-entrada-nao-configurado',
      'O tipo de entrada "doação" não está no catálogo do estoque deste cliente.',
    );
  const tipoMov = await tipoMovimentoId(tx, 'entrada_doacao');
  const custos = custoDaDoacao(paraConferir);
  const numero = await tx.proximoNumero('nota_entrada');
  const agora = new Date();
  const nota = await tx.incluir('nota_entrada', {
    estabelecimento_id: est,
    numero: numero.valor,
    empresa_fornecedora_id: e.doador.tipo === 'empresa' ? e.doador.id : null,
    doador_pessoa_fisica_id: e.doador.tipo === 'pessoa' ? e.doador.id : null,
    local_estoque_id: e.local,
    tipo_entrada_estoque_id: n(tipoEntrada['id']),
    modelo_documento: 'recibo',
    numero_documento: termo,
    data_emissao: e.recebidaEm,
    data_entrada: hoje,
    recebido_em: agora,
    recebido_por_usuario_id: usuario,
    valor_produtos: custos.total,
    valor_total: custos.total,
    doacao: true,
    situacao: 'confirmada',
    confirmada_em: agora,
    confirmada_por_usuario_id: usuario,
    observacao: e.observacao ?? null,
  });
  for (const [k, it] of e.itens.entries()) {
    const insumo = await insumoAtivo(tx, it.item);
    const custo = custos.itens[k]!;
    const lotes = await lotesDaEntrada(tx, est, insumo, it.quantidade, it.lotes, hoje);
    const ni = await tx.incluir('nota_entrada_item', {
      nota_entrada_id: nota,
      sequencia: k + 1,
      insumo_id: it.item,
      unidade_medida_id: n(insumo['estoque_unidade_medida_id']),
      fator_conversao: 1,
      quantidade: qtd(it.quantidade),
      quantidade_estoque: qtd(it.quantidade),
      valor_unitario: custo.custoUnitario,
      valor_total: custo.valorTotal,
      custo_unitario: custo.custoUnitario,
      lote_insumo_id: lotes.length === 1 ? lotes[0]!.id : null,
      criterio_custo_doacao: it.criterio,
    });
    await movimentar(tx, est, {
      local: e.local,
      insumo: it.item,
      quantidade: qtd(it.quantidade),
      natureza: 'entrada',
      tipoMovimento: tipoMov,
      valorEntrada: custo.valorTotal,
      lotes,
      hoje,
      notaItem: ni,
      fornecedor: e.doador.tipo === 'empresa' ? e.doador.id : null,
      doacao: true,
    });
  }
  return {
    id: nota,
    numero: numero.valor,
    itens: e.itens.length,
    valorTotal: custos.total,
    avisos: avisosValorJusto(paraConferir).join(','),
  };
}

export class PortaEntradaDoacaoPropria implements PortaEntradaDoacao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'entrada-doacao',
    };
  }

  doadores(c: ContextoPortaM18, termo: string): Promise<DoadorOpcao[]> {
    const busca = termo.trim().slice(0, 60);
    if (busca.length < 2) return Promise.resolve([]);
    const ctx = this.contexto(c);
    const like = `%${busca.replace(/[%_\\]/g, '\\$&')}%`;
    // LGPD (minimização): a pessoa nova do cadastro só pelo CPF completo e válido; pelo nome, só quem já doou aqui.
    const pessoa = buscaDoDoador(busca);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const empresas = await l.consultar<Linha>(
        `SELECT id, COALESCE(nome_fantasia, razao_social) AS nome, COALESCE(cnpj, cpf) AS doc FROM empresa_fornecedora
          WHERE situacao = 'ativo' AND excluido_em IS NULL AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj = ?)
          ORDER BY razao_social LIMIT 15`,
        [like, like, busca.replace(/\D/g, '')],
      );
      const pessoas = pessoa.cpf
        ? await l.consultar<Linha>(
            'SELECT id, nome, cpf AS doc FROM pessoa_fisica WHERE excluido_em IS NULL AND cpf = ? LIMIT 1',
            [pessoa.cpf],
          )
        : pessoa.nome
          ? await l.consultar<Linha>(
              `SELECT pf.id, pf.nome, pf.cpf AS doc FROM pessoa_fisica pf
                WHERE pf.excluido_em IS NULL AND pf.nome LIKE ?
                  AND EXISTS (SELECT 1 FROM nota_entrada ne
                               WHERE ne.doador_pessoa_fisica_id = pf.id AND ne.estabelecimento_id = ?
                                 AND ne.doacao = TRUE AND ne.excluido_em IS NULL)
                ORDER BY pf.nome LIMIT 15`,
              [`%${pessoa.nome.replace(/[%_\\]/g, '\\$&')}%`, ctx.estabelecimento],
            )
          : [];
      return [
        ...empresas.map((r) => ({
          tipo: 'empresa' as const,
          id: n(r['id']),
          nome: t(r['nome']),
          documento: mascara(r['doc']),
        })),
        ...pessoas.map((r) => ({
          tipo: 'pessoa' as const,
          id: n(r['id']),
          nome: t(r['nome']),
          documento: mascara(r['doc']),
        })),
      ];
    });
  }

  referencia(c: ContextoPortaM18, item: number): Promise<ReferenciaItemDoacao> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const r = await l.uma<Linha>(
        "SELECT id, nome, controla_lote FROM insumo WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
        [item],
      );
      if (!r)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Item não encontrado',
          'O item não existe ou está inativo.',
        );
      return {
        item: n(r['id']),
        nome: t(r['nome']),
        controlaLote: Boolean(n(r['controla_lote'])),
        ultimoPreco: await ultimoPrecoDeCompra(l, ctx.estabelecimento, item),
      };
    });
  }

  recebidas(c: ContextoPortaM18): Promise<DoacaoRecebida[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT ne.id, ne.numero, ne.numero_documento, ne.data_emissao, ne.valor_total,
                  COALESCE(ef.nome_fantasia, ef.razao_social, pf.nome) AS doador,
                  ne.doador_pessoa_fisica_id, le.nome AS local_nome,
                  (SELECT COUNT(*) FROM nota_entrada_item ni WHERE ni.nota_entrada_id = ne.id AND ni.excluido_em IS NULL) AS itens
             FROM nota_entrada ne
             LEFT JOIN empresa_fornecedora ef ON ef.id = ne.empresa_fornecedora_id
             LEFT JOIN pessoa_fisica pf ON pf.id = ne.doador_pessoa_fisica_id
             JOIN local_estoque le ON le.id = ne.local_estoque_id
            WHERE ne.estabelecimento_id = ? AND ne.doacao = TRUE AND ne.excluido_em IS NULL
            ORDER BY ne.data_entrada DESC, ne.id DESC LIMIT 100`,
          [ctx.estabelecimento],
        )
      ).map((r) => ({
        id: n(r['id']),
        numero: n(r['numero']),
        termo: t(r['numero_documento']),
        recebidaEm: dia(r['data_emissao']),
        doador: t(r['doador']),
        tipoDoador: r['doador_pessoa_fisica_id'] ? ('pessoa' as const) : ('empresa' as const),
        local: t(r['local_nome']),
        itens: n(r['itens']),
        valorTotal: n(r['valor_total']),
      })),
    );
  }

  async registrar(c: ContextoPortaM18, e: EntradaDoacao, chave: string): Promise<ResultadoDoacao> {
    const ctxN = this.contexto(c);
    const hoje = await this.nucleo.lerSomente(ctxN, (l) => hojeNoEstabelecimento(l, ctxN.estabelecimento));
    const op = definirOperacao({
      nome: OPERACAO_ENTRADA_DOACAO,
      tabelas: [...TABELAS_ENTRADA_DOACAO],
      entrada: esquemaEntradaDoacao,
      gravar: (tx: TxOperacao, x: EntradaDoacao) => registrarDoacao(tx, ctxN.estabelecimento, x, hoje),
      alvo: (_e, r: GravadoDoacao) => ({ tabela: 'nota_entrada', id: r.id }),
      trilha: (x: EntradaDoacao) => ({
        dados: { termo: x.termo, local: x.local, itens: x.itens.length, tipoDoador: x.doador.tipo },
        motivo: null,
      }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, e, ctx);
    const r = resultado as GravadoDoacao;
    return { ...r, avisos: r.avisos ? r.avisos.split(',').map(Number) : [] };
  }
}

export function portaEntradaDoacaoIndisponivel(): PortaEntradaDoacao {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A entrada por doação exige o banco próprio.');
  };
  return { destino: 'indisponivel', doadores: falha, referencia: falha, recebidas: falha, registrar: falha };
}

export type { CriterioCustoDoacao };
