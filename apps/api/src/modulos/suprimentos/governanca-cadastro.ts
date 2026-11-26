// Governança do cadastro de itens do estoque (C2-082, 05-SUP linha 2), sobre o MariaDB do cliente pelo Executor do núcleo
// (trilha na mesma transação, versão conferida, Idempotency-Key). A regra pura mora em `@sgh/contratos/regras-suprimentos`
// (governanca-cadastro): solicitação de item novo, alteração ou inativação decidida pela comissão de padronização (quem
// pede não decide), unificação de itens duplicados (aprovada por outra pessoa) e substituição (de-para) entre itens.
// Aqui fica a gravação:
// - a solicitação nasce enviada (sem rascunho: um clique a menos); a aprovação da inclusão cria o item (padronizado) e
//   conclui; a da alteração aplica a descrição nova e conclui; a da inativação confere o saldo e inativa o item;
// - a execução da unificação transfere, local a local, o saldo do absorvido para o que permanece (saída
//   "unificacao_saida" e entrada "unificacao_entrada", convertida pelo fator e com o mesmo valor; lote por lote quando
//   há lote), repassa as referências do cadastro (código de barras, fornecedor, preço de referência, kits, item
//   prescritível e o item de referência) sem duplicar o que já existe no que permanece, liga o absorvido ao que
//   permanece como substituição de apresentação e deixa o absorvido inativo, bloqueado para compra e nunca apagado.
// Nada é apagado: o histórico de movimentos continua ligado ao absorvido e a correspondência fica em
// unificacao_insumo_item.
import {
  conferirDuplicidadeInclusao,
  conferirInativacaoItem,
  conferirItensDaUnificacao,
  conferirSaldoTransferivel,
  conferirSolicitacaoCadastro,
  conferirSubstituicao,
  conferirUnificacao,
  fatorReferenciaConvertido,
  proximaSituacaoSolicitacao,
  proximaSituacaoUnificacao,
  quantidadeConvertida,
  type RecusaSuprimentos,
  type SituacaoSolicitacaoCadastro,
  type SituacaoUnificacao,
  TIPOS_SOLICITACAO_CADASTRO,
  TIPOS_SUBSTITUICAO,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { exigirMesAberto, hojeNoEstabelecimento, movimentar, tipoMovimentoId } from './porta-propria.js';

export const PORTA_GOVERNANCA_CADASTRO = Symbol('PORTA_GOVERNANCA_CADASTRO');
export const OPERACOES_GOVERNANCA_CADASTRO = {
  solicitar: 'suprimentos.cadastro_solicitacao.criar',
  decidirSolicitacao: 'suprimentos.cadastro_solicitacao.decidir',
  unificar: 'suprimentos.unificacao.criar',
  decidirUnificacao: 'suprimentos.unificacao.decidir',
  substituir: 'suprimentos.substituicao.gravar',
} as const;

const TABELAS_SOLICITACAO = ['solicitacao_cadastro_insumo', 'sequencia_negocio', 'insumo'] as const;
const TABELAS_UNIFICACAO = [
  'unificacao_insumo',
  'unificacao_insumo_item',
  'sequencia_negocio',
  'insumo',
  'insumo_estabelecimento',
  'saldo_estoque',
  'saldo_lote',
  'lote_insumo',
  'movimento_estoque',
  'movimento_lote',
  'insumo_codigo_barras',
  'insumo_fornecedor',
  'insumo_referencia_preco',
  'kit_material_item',
  'kit_prescricao_item',
  'item_prescritivel',
  'substituicao_insumo',
] as const;

const id = z.number().int().positive();
const textoOpc = (max: number) => z.string().trim().max(max).nullable().optional();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaSolicitacaoCadastro = z
  .object({
    tipo: z.enum(TIPOS_SOLICITACAO_CADASTRO),
    item: id.nullable(),
    descricao: z.string().trim().min(1).max(150),
    unidade: textoOpc(30),
    especificacao: textoOpc(4000),
    justificativa: z.string().trim().min(1).max(2000),
    grupo: id.nullable().optional(),
  })
  .strict();
export type SolicitacaoCadastro = z.infer<typeof esquemaSolicitacaoCadastro>;

export const esquemaDecisaoSolicitacao = z
  .object({
    versao: z.number().int().positive(),
    acao: z.enum(['aprovar', 'reprovar', 'cancelar']),
    parecer: textoOpc(2000),
    motivo: textoOpc(500),
    /** Só na aprovação da inclusão: o código, o tipo, o grupo e a unidade de estoque do item novo. */
    codigo: z.string().trim().min(1).max(30).optional(),
    tipoItem: z.string().trim().min(2).max(20).optional(),
    grupo: id.optional(),
    unidadeEstoque: id.optional(),
  })
  .strict();
export type DecisaoSolicitacao = z.infer<typeof esquemaDecisaoSolicitacao>;

export const esquemaUnificacao = z
  .object({
    permanece: id,
    absorvidos: z
      .array(z.object({ item: id, fator: z.number().positive().max(1_000_000) }).strict())
      .min(1)
      .max(20),
    motivo: z.string().trim().min(1).max(500),
  })
  .strict();
export type Unificacao = z.infer<typeof esquemaUnificacao>;

export const esquemaDecisaoUnificacao = z
  .object({
    versao: z.number().int().positive(),
    acao: z.enum(['aprovar', 'executar', 'cancelar']),
    motivo: textoOpc(500),
  })
  .strict();
export type DecisaoUnificacao = z.infer<typeof esquemaDecisaoUnificacao>;

export const esquemaSubstituicao = z
  .object({
    item: id,
    substituto: id,
    tipo: z.enum(TIPOS_SUBSTITUICAO),
    fator: z.number().positive().max(1_000_000),
    exigeAvisoPrescritor: z.boolean().default(true),
    regra: textoOpc(500),
    vigenciaInicio: dataIso.nullable().default(null),
    vigenciaFim: dataIso.nullable().default(null),
    ativo: z.boolean().default(true),
  })
  .strict();
export type Substituicao = z.infer<typeof esquemaSubstituicao>;

export interface ItemCadastro {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly ativo: boolean;
}
export interface SolicitacaoListada {
  readonly id: number;
  readonly numero: number;
  readonly tipo: string;
  readonly item: string | null;
  readonly descricao: string;
  readonly justificativa: string;
  readonly situacao: SituacaoSolicitacaoCadastro;
  readonly solicitante: number;
  readonly solicitadoEm: string;
  readonly parecer: string | null;
  readonly motivoReprovacao: string | null;
  readonly criadoItem: number | null;
  readonly versao: number;
}
export interface UnificacaoListada {
  readonly id: number;
  readonly numero: string;
  readonly permanece: string;
  readonly absorvidos: string;
  readonly motivo: string;
  readonly situacao: SituacaoUnificacao;
  readonly solicitante: number;
  readonly solicitadoEm: string;
  readonly executadoEm: string | null;
  readonly referenciasTransferidas: number;
  readonly versao: number;
}
export interface SubstituicaoListada {
  readonly id: number;
  readonly item: string;
  readonly substituto: string;
  readonly tipo: string;
  readonly fator: number;
  readonly exigeAvisoPrescritor: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}
export type Gravado = { readonly id: number; readonly situacao: string };

export interface PortaGovernancaCadastro {
  readonly destino: 'banco' | 'indisponivel';
  itens(c: ContextoPortaM18, termo: string): Promise<ItemCadastro[]>;
  solicitacoes(c: ContextoPortaM18): Promise<SolicitacaoListada[]>;
  unificacoes(c: ContextoPortaM18): Promise<UnificacaoListada[]>;
  substituicoes(c: ContextoPortaM18, item: number | null): Promise<SubstituicaoListada[]>;
  solicitar(c: ContextoPortaM18, s: SolicitacaoCadastro, chave: string): Promise<Gravado>;
  decidirSolicitacao(c: ContextoPortaM18, id: number, d: DecisaoSolicitacao, chave: string): Promise<Gravado>;
  unificar(c: ContextoPortaM18, u: Unificacao, chave: string): Promise<Gravado>;
  decidirUnificacao(c: ContextoPortaM18, id: number, d: DecisaoUnificacao, chave: string): Promise<Gravado>;
  substituir(c: ContextoPortaM18, s: Substituicao, chave: string): Promise<Gravado>;
}

const n = (v: unknown) => Number(v ?? 0);
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const sim = (v: unknown) => v === true || v === 1 || v === '1';
const qtd = (x: number) => Math.round(x * 10_000) / 10_000;
const instante = (v: unknown): string => (v instanceof Date ? v.toISOString() : t(v));
const dia = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : t(v).slice(0, 10);

function recusar(r: RecusaSuprimentos | null | undefined): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : undefined);
}
function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  recusar(rs[0]);
}
function usuarioDe(tx: TxOperacao): number {
  const u = tx.contexto.usuario;
  if (u === null || u === undefined) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return u;
}
function transicao<S>(r: { readonly situacao: S } | RecusaSuprimentos): S {
  if ('codigo' in r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : undefined);
  return r.situacao;
}

async function itemDoCadastro(l: Leitor, item: number, campo: string): Promise<Linha> {
  const r = await l.uma<Linha>(
    'SELECT id, codigo, nome, tipo, situacao, controla_lote, versao FROM insumo WHERE id = ? AND excluido_em IS NULL',
    [item],
  );
  if (!r) throw recusa('item-inexistente', `O item ${item} não existe no cadastro.`, { campos: [campo] });
  return r;
}
const paraConferir = (r: Linha) => ({
  id: n(r['id']),
  nome: t(r['nome']),
  tipo: t(r['tipo']),
  ativo: r['situacao'] === 'ativo',
});

// ---------------------------------------------------------------- solicitação

async function gravarSolicitacao(tx: TxOperacao, est: number, s: SolicitacaoCadastro): Promise<Gravado> {
  const usuario = usuarioDe(tx);
  recusarTodas(
    conferirSolicitacaoCadastro({
      tipo: s.tipo,
      item: s.item,
      descricao: s.descricao,
      justificativa: s.justificativa,
    }),
  );
  if (s.item !== null) await itemDoCadastro(tx, s.item, 'item');
  if (s.tipo === 'inclusao') {
    const parecidos = await tx.consultar<Linha>(
      "SELECT id, nome FROM insumo WHERE situacao = 'ativo' AND excluido_em IS NULL AND nome LIKE ? LIMIT 200",
      [`%${s.descricao.trim().slice(0, 4)}%`],
    );
    recusar(
      conferirDuplicidadeInclusao(
        s.descricao,
        parecidos.map((p) => ({ id: n(p['id']), nome: t(p['nome']) })),
      ),
    );
    const aberta = await tx.uma(
      "SELECT id FROM solicitacao_cadastro_insumo WHERE tipo = 'inclusao' AND descricao_proposta = ? AND situacao IN ('rascunho','enviada','em_analise','aprovada') AND excluido_em IS NULL",
      [s.descricao.trim()],
    );
    if (aberta)
      throw recusa('solicitacao-em-aberto', 'Já há um pedido em aberto para este item.', {
        campos: ['descricao'],
      });
  }
  const agora = new Date();
  const maior = await tx.uma<Linha>(
    'SELECT COALESCE(MAX(numero), 0) AS maior FROM solicitacao_cadastro_insumo WHERE estabelecimento_id = ?',
    [est],
  );
  await garantirSequencia(
    tx,
    { tipo: 'solicitacao_cadastro_insumo', estabelecimento: est, inicio: n(maior?.['maior']) + 1 },
    { usuario, agora },
  );
  const numero = (await tx.proximoNumero('solicitacao_cadastro_insumo')).valor;
  const novo = await tx.incluir('solicitacao_cadastro_insumo', {
    estabelecimento_id: est,
    numero,
    tipo: s.tipo,
    insumo_id: s.item,
    descricao_proposta: s.descricao.trim(),
    unidade_proposta: s.unidade ?? null,
    especificacao: s.especificacao ?? null,
    justificativa: s.justificativa.trim(),
    grupo_insumo_id: s.grupo ?? null,
    solicitante_usuario_id: usuario,
    solicitado_em: agora,
    situacao: 'enviada',
  });
  return { id: novo, situacao: 'enviada' };
}

async function decidirSolicitacao(
  tx: TxOperacao,
  est: number,
  idSol: number,
  d: DecisaoSolicitacao,
): Promise<Gravado> {
  const usuario = usuarioDe(tx);
  const [s] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM solicitacao_cadastro_insumo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [idSol, est],
  );
  if (!s) throw new ErroProblema('nao-encontrado', 404, 'Solicitação não encontrada.');
  const situacao = transicao(
    proximaSituacaoSolicitacao({
      situacao: t(s['situacao']) as SituacaoSolicitacaoCadastro,
      acao: d.acao,
      solicitante: n(s['solicitante_usuario_id']),
      usuario,
      parecer: d.parecer ?? null,
      motivo: d.motivo ?? null,
    }),
  );
  const agora = new Date();
  const valores: Record<string, unknown> = {};
  let final: SituacaoSolicitacaoCadastro = situacao;
  if (d.acao === 'cancelar') Object.assign(valores, { cancelado_em: agora, motivo_reprovacao: d.motivo });
  else {
    Object.assign(valores, {
      parecerista_usuario_id: usuario,
      parecer: d.parecer ?? null,
      parecer_em: agora,
    });
    if (d.acao === 'reprovar') valores['motivo_reprovacao'] = d.motivo;
  }
  if (d.acao === 'aprovar') {
    const tipo = t(s['tipo']);
    if (tipo === 'inclusao') {
      const grupo = d.grupo ?? (s['grupo_insumo_id'] ? n(s['grupo_insumo_id']) : null);
      if (!d.codigo || !d.tipoItem || !grupo || !d.unidadeEstoque)
        throw recusa(
          'item-novo-incompleto',
          'Para aprovar a inclusão informe o código, o tipo, o grupo e a unidade de estoque do item novo.',
          { campos: ['codigo', 'tipoItem', 'grupo', 'unidadeEstoque'] },
        );
      if (await tx.uma('SELECT id FROM insumo WHERE codigo = ?', [d.codigo]))
        throw recusa('codigo-repetido', 'Já existe item com este código.', { campos: ['codigo'] });
      const criado = await tx.incluir('insumo', {
        codigo: d.codigo,
        nome: t(s['descricao_proposta']),
        tipo: d.tipoItem,
        grupo_insumo_id: grupo,
        subgrupo_insumo_id: s['subgrupo_insumo_id'] ?? null,
        estoque_unidade_medida_id: d.unidadeEstoque,
        situacao: 'ativo',
        padronizado: true,
      });
      valores['criado_insumo_id'] = criado;
    } else {
      const item = await itemDoCadastro(tx, n(s['insumo_id']), 'item');
      if (tipo === 'alteracao')
        await tx.alterar('insumo', n(item['id']), n(item['versao']), {
          nome: t(s['descricao_proposta']),
        });
      else {
        const saldo = await tx.uma<Linha>(
          'SELECT COALESCE(SUM(quantidade), 0) AS q FROM saldo_estoque WHERE insumo_id = ? AND excluido_em IS NULL',
          [item['id']],
        );
        const r = conferirInativacaoItem({
          motivo: t(s['justificativa']),
          saldoTotal: qtd(n(saldo?.['q'])),
        });
        if (r) throw recusa(r.codigo, r.mensagem);
        await tx.alterar('insumo', n(item['id']), n(item['versao']), { situacao: 'inativo' });
      }
    }
    final = transicao(
      proximaSituacaoSolicitacao({
        situacao,
        acao: 'concluir',
        solicitante: n(s['solicitante_usuario_id']),
        usuario,
      }),
    );
  }
  valores['situacao'] = final;
  await tx.alterar('solicitacao_cadastro_insumo', idSol, d.versao, valores);
  return { id: idSol, situacao: final };
}

// ---------------------------------------------------------------- unificação

async function gravarUnificacao(tx: TxOperacao, u: Unificacao): Promise<Gravado> {
  const usuario = usuarioDe(tx);
  recusarTodas(conferirUnificacao(u));
  const permanece = await itemDoCadastro(tx, u.permanece, 'permanece');
  const absorvidos: Linha[] = [];
  for (const a of u.absorvidos) absorvidos.push(await itemDoCadastro(tx, a.item, 'absorvidos'));
  recusar(conferirItensDaUnificacao(paraConferir(permanece), absorvidos.map(paraConferir)));
  const emAberto = await tx.uma<Linha>(
    `SELECT i.insumo_absorvido_id FROM unificacao_insumo_item i JOIN unificacao_insumo u ON u.id = i.unificacao_insumo_id
      WHERE u.situacao IN ('rascunho','aguardando_aprovacao','aprovada','em_execucao') AND u.excluido_em IS NULL
        AND i.insumo_absorvido_id IN (${u.absorvidos.map(() => '?').join(',')}) LIMIT 1`,
    u.absorvidos.map((a) => a.item),
  );
  if (emAberto)
    throw recusa('unificacao-em-aberto', 'Um dos itens já está numa unificação em aberto.', {
      campos: ['absorvidos'],
    });
  const agora = new Date();
  await garantirSequencia(
    tx,
    { tipo: 'unificacao_insumo', estabelecimento: null, prefixo: 'UNI-', inicio: 1 },
    { usuario, agora },
  );
  const numero = (await tx.proximoNumero('unificacao_insumo', { porCliente: true })).formatado;
  const novo = await tx.incluir('unificacao_insumo', {
    numero,
    insumo_permanece_id: u.permanece,
    situacao: 'aguardando_aprovacao',
    motivo: u.motivo.trim(),
    solicitante_usuario_id: usuario,
    solicitado_em: agora,
  });
  for (const [k, a] of u.absorvidos.entries()) {
    const ab = absorvidos[k]!;
    const un = await tx.uma<Linha>('SELECT estoque_unidade_medida_id FROM insumo WHERE id = ?', [a.item]);
    await tx.incluir('unificacao_insumo_item', {
      unificacao_insumo_id: novo,
      sequencia: k + 1,
      insumo_absorvido_id: a.item,
      descricao_absorvido: t(ab['nome']).slice(0, 240),
      unidade_medida_absorvido_id: un?.['estoque_unidade_medida_id'] ?? null,
      fator_conversao: a.fator,
    });
  }
  return { id: novo, situacao: 'aguardando_aprovacao' };
}

/** Transfere o saldo do absorvido, local a local (e lote a lote), para o item que permanece. */
async function transferirSaldo(
  tx: TxOperacao,
  absorvido: Linha,
  permanece: Linha,
  fator: number,
  hoje: string,
): Promise<number> {
  const saldos = await tx.consultar<Linha>(
    `SELECT s.estabelecimento_id, s.local_estoque_id, s.quantidade, s.quantidade_reservada, s.quantidade_consignada,
            le.nome AS local_nome,
            (SELECT COALESCE(SUM(sl.quantidade), 0) FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id
              WHERE sl.local_estoque_id = s.local_estoque_id AND li.insumo_id = s.insumo_id AND sl.excluido_em IS NULL) AS em_lotes
       FROM saldo_estoque s JOIN local_estoque le ON le.id = s.local_estoque_id
      WHERE s.insumo_id = ? AND s.excluido_em IS NULL AND (s.quantidade > 0 OR s.quantidade_reservada > 0 OR s.quantidade_consignada > 0)`,
    [absorvido['id']],
  );
  if (!saldos.length) return 0;
  const saida = await tipoMovimentoId(tx, 'unificacao_saida');
  const entrada = await tipoMovimentoId(tx, 'unificacao_entrada');
  let total = 0;
  for (const s of saldos) {
    recusar(
      conferirSaldoTransferivel(
        {
          local: t(s['local_nome']),
          quantidade: n(s['quantidade']),
          reservada: n(s['quantidade_reservada']),
          consignada: n(s['quantidade_consignada']),
          emLotes: n(s['em_lotes']),
        },
        sim(permanece['controla_lote']),
      ),
    );
    const est = n(s['estabelecimento_id']);
    const local = n(s['local_estoque_id']);
    const quantidade = qtd(n(s['quantidade']));
    if (quantidade <= 0) continue;
    await exigirMesAberto(tx, est, hoje);
    const lotes = await tx.consultar<Linha>(
      `SELECT sl.lote_insumo_id, sl.quantidade, li.numero_lote, li.validade, li.origem FROM saldo_lote sl
         JOIN lote_insumo li ON li.id = sl.lote_insumo_id
        WHERE sl.local_estoque_id = ? AND li.insumo_id = ? AND sl.quantidade > 0 AND sl.excluido_em IS NULL`,
      [local, absorvido['id']],
    );
    const lotesSaida = lotes.map((l) => ({
      id: n(l['lote_insumo_id']),
      quantidade: qtd(n(l['quantidade'])),
    }));
    const mov = await movimentar(tx, est, {
      local,
      insumo: n(absorvido['id']),
      quantidade,
      natureza: 'saida',
      tipoMovimento: saida,
      lotes: lotesSaida,
      hoje,
    });
    const lotesEntrada: { id: number; quantidade: number }[] = [];
    for (const l of lotes) {
      const validade = dia(l['validade']);
      const achado = await tx.uma<Linha>(
        // `<=>`: o lote migrado sem validade (nula) também se reencontra no item que permanece.
        'SELECT id FROM lote_insumo WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND validade <=> ?',
        [est, permanece['id'], l['numero_lote'], validade],
      );
      const loteId = achado
        ? n(achado['id'])
        : await tx.incluir('lote_insumo', {
            estabelecimento_id: est,
            insumo_id: permanece['id'],
            numero_lote: l['numero_lote'],
            validade,
            // A origem segue a do lote original: o migrado sem validade continua aceito pelo banco.
            origem: l['origem'] ?? 'sistema',
          });
      lotesEntrada.push({ id: loteId, quantidade: quantidadeConvertida(n(l['quantidade']), fator) });
    }
    const convertida = quantidadeConvertida(quantidade, fator);
    await movimentar(tx, est, {
      local,
      insumo: n(permanece['id']),
      quantidade: convertida,
      natureza: 'entrada',
      tipoMovimento: entrada,
      valorEntrada: mov.valor,
      lotes: lotesEntrada,
      hoje,
    });
    total = qtd(total + convertida);
  }
  return total;
}

/** Repassa as referências do cadastro do absorvido ao que permanece; devolve [transferidas, mantidas]. */
async function repassarReferencias(
  tx: TxOperacao,
  absorvido: number,
  permanece: number,
  fator: number,
): Promise<[number, number]> {
  let feitas = 0;
  let mantidas = 0;
  const barras = await tx.consultar<Linha>(
    'SELECT id, versao FROM insumo_codigo_barras WHERE insumo_id = ? ORDER BY sequencia',
    [absorvido],
  );
  for (const b of barras) {
    const maior = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) AS m FROM insumo_codigo_barras WHERE insumo_id = ?',
      [permanece],
    );
    await tx.alterar('insumo_codigo_barras', n(b['id']), n(b['versao']), {
      insumo_id: permanece,
      sequencia: n(maior?.['m']) + 1,
    });
    feitas++;
  }
  for (const f of await tx.consultar<Linha>(
    'SELECT id, versao, empresa_fornecedora_id, codigo_no_fornecedor FROM insumo_fornecedor WHERE insumo_id = ? AND excluido_em IS NULL',
    [absorvido],
  )) {
    const ja = await tx.uma(
      'SELECT id FROM insumo_fornecedor WHERE insumo_id = ? AND empresa_fornecedora_id = ? AND codigo_no_fornecedor = ?',
      [permanece, f['empresa_fornecedora_id'], f['codigo_no_fornecedor']],
    );
    if (ja) mantidas++;
    else {
      await tx.alterar('insumo_fornecedor', n(f['id']), n(f['versao']), { insumo_id: permanece });
      feitas++;
    }
  }
  for (const p of await tx.consultar<Linha>(
    'SELECT id, versao, item_referencia_matmed_id, vigencia_inicio, fator_conversao FROM insumo_referencia_preco WHERE insumo_id = ? AND excluido_em IS NULL',
    [absorvido],
  )) {
    const ja = await tx.uma(
      'SELECT id FROM insumo_referencia_preco WHERE insumo_id = ? AND item_referencia_matmed_id = ? AND vigencia_inicio = ?',
      [permanece, p['item_referencia_matmed_id'], dia(p['vigencia_inicio'])],
    );
    if (ja) mantidas++;
    else {
      await tx.alterar('insumo_referencia_preco', n(p['id']), n(p['versao']), {
        insumo_id: permanece,
        fator_conversao: fatorReferenciaConvertido(n(p['fator_conversao']), fator),
      });
      feitas++;
    }
  }
  for (const k of await tx.consultar<Linha>(
    'SELECT id, versao, kit_material_id, quantidade FROM kit_material_item WHERE insumo_id = ? AND excluido_em IS NULL',
    [absorvido],
  )) {
    const ja = await tx.uma('SELECT id FROM kit_material_item WHERE kit_material_id = ? AND insumo_id = ?', [
      k['kit_material_id'],
      permanece,
    ]);
    if (ja) mantidas++;
    else {
      await tx.alterar('kit_material_item', n(k['id']), n(k['versao']), {
        insumo_id: permanece,
        quantidade: quantidadeConvertida(n(k['quantidade']), fator),
      });
      feitas++;
    }
  }
  for (const k of await tx.consultar<Linha>(
    'SELECT id, versao FROM kit_prescricao_item WHERE insumo_id = ? AND excluido_em IS NULL',
    [absorvido],
  )) {
    await tx.alterar('kit_prescricao_item', n(k['id']), n(k['versao']), { insumo_id: permanece });
    feitas++;
  }
  for (const i of await tx.consultar<Linha>(
    'SELECT id, versao FROM item_prescritivel WHERE insumo_id = ? AND excluido_em IS NULL',
    [absorvido],
  )) {
    await tx.alterar('item_prescritivel', n(i['id']), n(i['versao']), { insumo_id: permanece });
    feitas++;
  }
  for (const i of await tx.consultar<Linha>(
    'SELECT id, versao FROM insumo WHERE referencia_insumo_id = ? AND id <> ? AND excluido_em IS NULL',
    [absorvido, permanece],
  )) {
    await tx.alterar('insumo', n(i['id']), n(i['versao']), { referencia_insumo_id: permanece });
    feitas++;
  }
  return [feitas, mantidas];
}

/** O absorvido sai das substituições ativas e passa a apontar para o que permanece (apresentação). */
async function ligarSubstituicao(tx: TxOperacao, absorvido: number, permanece: number, fator: number) {
  for (const s of await tx.consultar<Linha>(
    'SELECT id, versao FROM substituicao_insumo WHERE (insumo_id = ? OR substituto_insumo_id = ?) AND ativo = TRUE AND excluido_em IS NULL',
    [absorvido, absorvido],
  ))
    await tx.alterar('substituicao_insumo', n(s['id']), n(s['versao']), { ativo: false });
  const ja = await tx.uma<Linha>(
    'SELECT id, versao FROM substituicao_insumo WHERE insumo_id = ? AND substituto_insumo_id = ?',
    [absorvido, permanece],
  );
  const valores = {
    tipo: 'apresentacao',
    fator_conversao: Math.round(fator * 10_000) / 10_000 || 0.0001,
    exige_aviso_prescritor: false,
    regra: 'Unificação do cadastro',
    ativo: true,
  };
  if (ja) await tx.alterar('substituicao_insumo', n(ja['id']), n(ja['versao']), valores);
  else
    await tx.incluir('substituicao_insumo', {
      insumo_id: absorvido,
      substituto_insumo_id: permanece,
      ...valores,
    });
}

async function decidirUnificacao(
  tx: TxOperacao,
  idUni: number,
  d: DecisaoUnificacao,
  hoje: string,
): Promise<Gravado> {
  const usuario = usuarioDe(tx);
  const [u] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM unificacao_insumo WHERE id = ? AND excluido_em IS NULL',
    [idUni],
  );
  if (!u) throw new ErroProblema('nao-encontrado', 404, 'Unificação não encontrada.');
  const situacao = transicao(
    proximaSituacaoUnificacao({
      situacao: t(u['situacao']) as SituacaoUnificacao,
      acao: d.acao,
      solicitante: n(u['solicitante_usuario_id']),
      usuario,
      motivo: d.motivo ?? null,
    }),
  );
  const agora = new Date();
  if (d.acao === 'aprovar') {
    await tx.alterar('unificacao_insumo', idUni, d.versao, {
      situacao,
      aprovador_usuario_id: usuario,
      aprovado_em: agora,
    });
    return { id: idUni, situacao };
  }
  if (d.acao === 'cancelar') {
    await tx.alterar('unificacao_insumo', idUni, d.versao, {
      situacao,
      cancelado_em: agora,
      motivo_cancelamento: d.motivo,
    });
    return { id: idUni, situacao };
  }
  const permanece = await itemDoCadastro(tx, n(u['insumo_permanece_id']), 'permanece');
  const itens = await tx.consultar<Linha>(
    "SELECT id, versao, insumo_absorvido_id, fator_conversao FROM unificacao_insumo_item WHERE unificacao_insumo_id = ? AND situacao = 'pendente' AND excluido_em IS NULL ORDER BY sequencia",
    [idUni],
  );
  const absorvidos: Linha[] = [];
  for (const i of itens) absorvidos.push(await itemDoCadastro(tx, n(i['insumo_absorvido_id']), 'absorvidos'));
  recusar(conferirItensDaUnificacao(paraConferir(permanece), absorvidos.map(paraConferir)));
  for (const [k, i] of itens.entries()) {
    const ab = absorvidos[k]!;
    const abId = n(ab['id']);
    const fator = n(i['fator_conversao']);
    const transferida = await transferirSaldo(tx, ab, permanece, fator, hoje);
    const [feitas, mantidas] = await repassarReferencias(tx, abId, n(permanece['id']), fator);
    await ligarSubstituicao(tx, abId, n(permanece['id']), fator);
    for (const ie of await tx.consultar<Linha>(
      'SELECT id, versao FROM insumo_estabelecimento WHERE insumo_id = ?',
      [abId],
    ))
      await tx.alterar('insumo_estabelecimento', n(ie['id']), n(ie['versao']), {
        ativo: false,
        padronizado: false,
      });
    const atual = await tx.uma<Linha>('SELECT versao FROM insumo WHERE id = ?', [abId]);
    await tx.alterar('insumo', abId, n(atual?.['versao']), {
      situacao: 'inativo',
      padronizado: false,
      bloqueado_compra: true,
    });
    await tx.alterar('unificacao_insumo_item', n(i['id']), n(i['versao']), {
      situacao: 'transferido',
      transferido_em: agora,
      quantidade_saldo_transferida: transferida,
      referencias_transferidas: feitas,
      referencias_mantidas: mantidas,
    });
  }
  await tx.alterar('unificacao_insumo', idUni, d.versao, { situacao, executado_em: agora });
  return { id: idUni, situacao };
}

// ---------------------------------------------------------------- substituição

async function gravarSubstituicao(tx: TxOperacao, s: Substituicao): Promise<Gravado> {
  recusarTodas(conferirSubstituicao(s));
  await itemDoCadastro(tx, s.item, 'item');
  const sub = await itemDoCadastro(tx, s.substituto, 'substituto');
  if (s.ativo && sub['situacao'] !== 'ativo')
    throw recusa('substituto-inativo', `O substituto ${t(sub['nome'])} está inativo.`, {
      campos: ['substituto'],
    });
  const valores = {
    tipo: s.tipo,
    fator_conversao: s.fator,
    exige_aviso_prescritor: s.exigeAvisoPrescritor,
    regra: s.regra ?? null,
    vigencia_inicio: s.vigenciaInicio,
    vigencia_fim: s.vigenciaFim,
    ativo: s.ativo,
  };
  const ja = await tx.uma<Linha>(
    'SELECT id, versao FROM substituicao_insumo WHERE insumo_id = ? AND substituto_insumo_id = ? AND excluido_em IS NULL',
    [s.item, s.substituto],
  );
  if (ja) {
    await tx.alterar('substituicao_insumo', n(ja['id']), n(ja['versao']), valores);
    return { id: n(ja['id']), situacao: s.ativo ? 'ativa' : 'inativa' };
  }
  if (!s.ativo) throw recusa('sem-substituicao', 'Não há esta substituição para desativar.');
  const novo = await tx.incluir('substituicao_insumo', {
    insumo_id: s.item,
    substituto_insumo_id: s.substituto,
    ...valores,
  });
  return { id: novo, situacao: 'ativa' };
}

// ---------------------------------------------------------------- porta

export class PortaGovernancaCadastroPropria implements PortaGovernancaCadastro {
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
      correlacao: c.correlacao || 'governanca-cadastro',
    };
  }

  private async executar<E>(
    c: ContextoPortaM18,
    nome: string,
    tabelas: readonly string[],
    esquema: z.ZodType<E>,
    entrada: E,
    chave: string,
    gravar: (tx: TxOperacao, x: E, est: number, hoje: string) => Promise<Gravado>,
    trilha: (x: E) => unknown,
  ): Promise<Gravado> {
    const ctxN = this.contexto(c);
    const hoje = await this.nucleo.lerSomente(ctxN, (l) => hojeNoEstabelecimento(l, ctxN.estabelecimento));
    const op = definirOperacao({
      nome,
      tabelas: [...tabelas],
      entrada: esquema,
      gravar: (tx: TxOperacao, x: E) => gravar(tx, x, ctxN.estabelecimento, hoje),
      alvo: (_e, r: Gravado) => ({ tabela: tabelas[0]!, id: r.id }),
      trilha: (x: E) => ({ dados: trilha(x), motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as Gravado;
  }

  async itens(c: ContextoPortaM18, termo: string): Promise<ItemCadastro[]> {
    const ctx = this.contexto(c);
    const q = termo.trim();
    if (q.length < 2) return [];
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          'SELECT id, codigo, nome, tipo, situacao FROM insumo WHERE excluido_em IS NULL AND (nome LIKE ? OR codigo = ?) ORDER BY nome LIMIT 30',
          [`%${q}%`, q],
        )
      ).map((r) => ({
        id: n(r['id']),
        codigo: t(r['codigo']),
        nome: t(r['nome']),
        tipo: t(r['tipo']),
        ativo: r['situacao'] === 'ativo',
      })),
    );
  }

  async solicitacoes(c: ContextoPortaM18): Promise<SolicitacaoListada[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT s.id, s.numero, s.tipo, i.nome AS item_nome, s.descricao_proposta, s.justificativa, s.situacao,
                  s.solicitante_usuario_id, s.solicitado_em, s.parecer, s.motivo_reprovacao, s.criado_insumo_id, s.versao
             FROM solicitacao_cadastro_insumo s LEFT JOIN insumo i ON i.id = s.insumo_id
            WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL
            ORDER BY s.solicitado_em DESC, s.id DESC LIMIT 200`,
          [ctx.estabelecimento],
        )
      ).map((r) => ({
        id: n(r['id']),
        numero: n(r['numero']),
        tipo: t(r['tipo']),
        item: r['item_nome'] ? t(r['item_nome']) : null,
        descricao: t(r['descricao_proposta']),
        justificativa: t(r['justificativa']),
        situacao: t(r['situacao']) as SituacaoSolicitacaoCadastro,
        solicitante: n(r['solicitante_usuario_id']),
        solicitadoEm: instante(r['solicitado_em']),
        parecer: r['parecer'] ? t(r['parecer']) : null,
        motivoReprovacao: r['motivo_reprovacao'] ? t(r['motivo_reprovacao']) : null,
        criadoItem: r['criado_insumo_id'] ? n(r['criado_insumo_id']) : null,
        versao: n(r['versao']),
      })),
    );
  }

  async unificacoes(c: ContextoPortaM18): Promise<UnificacaoListada[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT u.id, u.numero, p.nome AS permanece, u.motivo, u.situacao, u.solicitante_usuario_id, u.solicitado_em,
                  u.executado_em, u.versao,
                  (SELECT GROUP_CONCAT(i.descricao_absorvido ORDER BY i.sequencia SEPARATOR '; ') FROM unificacao_insumo_item i
                    WHERE i.unificacao_insumo_id = u.id AND i.excluido_em IS NULL) AS absorvidos,
                  (SELECT COALESCE(SUM(i.referencias_transferidas), 0) FROM unificacao_insumo_item i
                    WHERE i.unificacao_insumo_id = u.id AND i.excluido_em IS NULL) AS referencias
             FROM unificacao_insumo u JOIN insumo p ON p.id = u.insumo_permanece_id
            WHERE u.excluido_em IS NULL ORDER BY u.solicitado_em DESC, u.id DESC LIMIT 200`,
          [],
        )
      ).map((r) => ({
        id: n(r['id']),
        numero: t(r['numero']),
        permanece: t(r['permanece']),
        absorvidos: t(r['absorvidos']),
        motivo: t(r['motivo']),
        situacao: t(r['situacao']) as SituacaoUnificacao,
        solicitante: n(r['solicitante_usuario_id']),
        solicitadoEm: instante(r['solicitado_em']),
        executadoEm: r['executado_em'] ? instante(r['executado_em']) : null,
        referenciasTransferidas: n(r['referencias']),
        versao: n(r['versao']),
      })),
    );
  }

  async substituicoes(c: ContextoPortaM18, item: number | null): Promise<SubstituicaoListada[]> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT s.id, a.nome AS item_nome, b.nome AS substituto_nome, s.tipo, s.fator_conversao,
                  s.exige_aviso_prescritor, s.vigencia_inicio, s.vigencia_fim, s.ativo
             FROM substituicao_insumo s JOIN insumo a ON a.id = s.insumo_id JOIN insumo b ON b.id = s.substituto_insumo_id
            WHERE s.excluido_em IS NULL AND (? IS NULL OR s.insumo_id = ? OR s.substituto_insumo_id = ?)
            ORDER BY s.ativo DESC, a.nome, s.prioridade LIMIT 200`,
          [item, item, item],
        )
      ).map((r) => ({
        id: n(r['id']),
        item: t(r['item_nome']),
        substituto: t(r['substituto_nome']),
        tipo: t(r['tipo']),
        fator: n(r['fator_conversao']),
        exigeAvisoPrescritor: sim(r['exige_aviso_prescritor']),
        vigenciaInicio: dia(r['vigencia_inicio']),
        vigenciaFim: dia(r['vigencia_fim']),
        ativo: sim(r['ativo']),
      })),
    );
  }

  solicitar(c: ContextoPortaM18, s: SolicitacaoCadastro, chave: string): Promise<Gravado> {
    return this.executar(
      c,
      OPERACOES_GOVERNANCA_CADASTRO.solicitar,
      TABELAS_SOLICITACAO,
      esquemaSolicitacaoCadastro,
      s,
      chave,
      (tx, x, est) => gravarSolicitacao(tx, est, x),
      (x) => ({ tipo: x.tipo, item: x.item }),
    );
  }

  decidirSolicitacao(c: ContextoPortaM18, idSol: number, d: DecisaoSolicitacao, chave: string) {
    return this.executar(
      c,
      OPERACOES_GOVERNANCA_CADASTRO.decidirSolicitacao,
      TABELAS_SOLICITACAO,
      esquemaDecisaoSolicitacao,
      d,
      chave,
      (tx, x, est) => decidirSolicitacao(tx, est, idSol, x),
      (x) => ({ solicitacao: idSol, acao: x.acao }),
    );
  }

  unificar(c: ContextoPortaM18, u: Unificacao, chave: string): Promise<Gravado> {
    return this.executar(
      c,
      OPERACOES_GOVERNANCA_CADASTRO.unificar,
      TABELAS_UNIFICACAO,
      esquemaUnificacao,
      u,
      chave,
      (tx, x) => gravarUnificacao(tx, x),
      (x) => ({ permanece: x.permanece, absorvidos: x.absorvidos.map((a) => a.item) }),
    );
  }

  decidirUnificacao(c: ContextoPortaM18, idUni: number, d: DecisaoUnificacao, chave: string) {
    return this.executar(
      c,
      OPERACOES_GOVERNANCA_CADASTRO.decidirUnificacao,
      TABELAS_UNIFICACAO,
      esquemaDecisaoUnificacao,
      d,
      chave,
      (tx, x, _est, hoje) => decidirUnificacao(tx, idUni, x, hoje),
      (x) => ({ unificacao: idUni, acao: x.acao }),
    );
  }

  substituir(c: ContextoPortaM18, s: Substituicao, chave: string): Promise<Gravado> {
    return this.executar(
      c,
      OPERACOES_GOVERNANCA_CADASTRO.substituir,
      ['substituicao_insumo', 'insumo'],
      esquemaSubstituicao,
      s,
      chave,
      (tx, x) => gravarSubstituicao(tx, x),
      (x) => ({ item: x.item, substituto: x.substituto, tipo: x.tipo, ativo: x.ativo }),
    );
  }
}

export function portaGovernancaCadastroIndisponivel(): PortaGovernancaCadastro {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A governança do cadastro exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    itens: falha,
    solicitacoes: falha,
    unificacoes: falha,
    substituicoes: falha,
    solicitar: falha,
    decidirSolicitacao: falha,
    unificar: falha,
    decidirUnificacao: falha,
    substituir: falha,
  };
}
