// Cliente das telas do estoque, do almoxarifado e das compras (M28), validado pelos contratos. As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção de gravar: repetir o pedido não grava duas vezes); Problem Details viram
// ErroApi e a recusa de negócio traz o texto em português do servidor (saldo insuficiente, lote vencido…).
import {
  type ConferenciaNumericaOnda3,
  esquemaConferenciaNumerica,
  esquemaPainelOnda3,
  type PainelOnda3,
  type AprovacaoPendente,
  type ApoioSuprimentos,
  type ConsumoEstoque,
  type DocumentoDetalhe,
  type EscopoUsuarioEstoque,
  type FichaItem,
  esquemaAprovacaoPendente,
  esquemaApoioSuprimentos,
  esquemaConsumo,
  esquemaDocumentoDetalhe,
  esquemaEscopoUsuarioEstoque,
  esquemaFechamentos,
  esquemaFichaItem,
  esquemaFornecedorLido,
  esquemaPrestadorLido,
  esquemaTerceiroLido,
  esquemaGravacaoSuprimentos,
  esquemaHistoricoCompra,
  esquemaInventarioLido,
  esquemaItemBusca,
  esquemaKitRastreavel,
  esquemaListaDocumentos,
  esquemaListaPedidosCompra,
  esquemaListaRequisicoesEstoque,
  esquemaListaSaldos,
  esquemaLoteSaldo,
  esquemaLotesDoPaciente,
  esquemaParametrosEstoque,
  esquemaPedidoDetalhe,
  esquemaPosicaoMensal,
  esquemaRastreioLote,
  esquemaRecalculos,
  esquemaResultadoSuprimentos,
  esquemaSugestaoCompra,
  esquemaTransferenciaEnviada,
  type FechamentosEstoque,
  type GravacaoSuprimentos,
  type HistoricoCompra,
  type InventarioLido,
  type ItemBusca,
  type KitRastreavel,
  type ListaDocumentos,
  type ListaPedidosCompra,
  type ListaRequisicoesEstoque,
  type ListaSaldos,
  type LoteSaldo,
  type LotesDoPaciente,
  type ParametrosEstoque,
  type PedidoDetalhe,
  type PosicaoMensal,
  type RastreioLote,
  type RecalculosEstoque,
  type ResultadoSuprimentos,
  type SugestaoCompra,
  type TipoDocumentoEstoque,
  type TransferenciaEnviada,
} from '@sgh/contratos';
import { z } from 'zod';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { enviar, ler, qs } from '../exames/api-exames.js';

const S = '/api/suprimentos';

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m28.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

/** O texto da recusa de negócio (o servidor responde em português: saldo, lote, escopo, mês fechado…). */
export function textoDaRecusa(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  if (![400, 403, 409, 422].includes(e.status)) return null;
  const d = (e.problema as { detail?: unknown } | null)?.detail;
  return typeof d === 'string' && d.trim() ? d : null;
}

const gravar = (url: string, corpo: unknown, chave: string): Promise<ResultadoSuprimentos> =>
  enviar(url, corpo, esquemaResultadoSuprimentos, chave);

// ── Situação e apoio ─────────────────────────────────────────────────────────────────────────────────

export const lerGravacao = (): Promise<GravacaoSuprimentos> =>
  ler(`${S}/gravacao`, esquemaGravacaoSuprimentos);
export const lerApoio = (): Promise<ApoioSuprimentos> => ler(`${S}/apoio`, esquemaApoioSuprimentos);
export const buscarItens = (termo: string): Promise<ItemBusca[]> =>
  ler(`${S}/itens${qs({ termo })}`, z.array(esquemaItemBusca));

// ── Saldos, lotes e rastreio ─────────────────────────────────────────────────────────────────────────

export const listarSaldos = (f: {
  item?: number | null;
  local?: number | null;
  termo?: string;
  todos?: boolean;
}): Promise<ListaSaldos> =>
  ler(
    `${S}/saldos${qs({ item: f.item, local: f.local, termo: f.termo, todos: f.todos ? 'sim' : '' })}`,
    esquemaListaSaldos,
  );
export const lerFichaItem = (item: number): Promise<FichaItem> =>
  ler(`${S}/itens/${item}/ficha`, esquemaFichaItem);
export const lerPosicao = (item: number): Promise<PosicaoMensal> =>
  ler(`${S}/saldos/${item}/posicao`, esquemaPosicaoMensal);
export const lotesDoLocal = (item: number, local: number): Promise<LoteSaldo[]> =>
  ler(`${S}/lotes${qs({ item, local })}`, z.array(esquemaLoteSaldo));
export const rastrearLote = (item: number, lote: string): Promise<RastreioLote> =>
  ler(`${S}/lotes/rastreio${qs({ item, lote })}`, esquemaRastreioLote);
export const lotesDoPaciente = (atendimento: number): Promise<LotesDoPaciente> =>
  ler(`${S}/lotes/paciente/${atendimento}`, esquemaLotesDoPaciente);
export const corrigirValidade = (lote: number, c: { validade: string; motivo: string }, chave: string) =>
  gravar(`${S}/lotes/${lote}/validade`, c, chave);

// ── Documentos ───────────────────────────────────────────────────────────────────────────────────────

export const listarDocumentos = (
  tipo: TipoDocumentoEstoque,
  f: { local?: number | null; inicio?: string; fim?: string; pagina?: number },
): Promise<ListaDocumentos> => ler(`${S}/documentos/${tipo}${qs(f)}`, esquemaListaDocumentos);
export const lerDocumento = (
  tipo: TipoDocumentoEstoque,
  c: { ano: number; mes: number; doc: number },
): Promise<DocumentoDetalhe> =>
  ler(`${S}/documentos/${tipo}/${c.ano}/${c.mes}/${c.doc}`, esquemaDocumentoDetalhe);
export const desconsolidar = (c: unknown, chave: string) => gravar(`${S}/documentos/desconsolidar`, c, chave);

// ── Saída, requisição, devolução, movimento direto ───────────────────────────────────────────────────

export const registrarSaida = (e: unknown, chave: string) => gravar(`${S}/saidas`, e, chave);
export const listarRequisicoes = (local: number | null): Promise<ListaRequisicoesEstoque> =>
  ler(`${S}/requisicoes${qs({ local })}`, esquemaListaRequisicoesEstoque);
export const requisitar = (e: unknown, chave: string) => gravar(`${S}/requisicoes`, e, chave);
export const autorizarRequisicao = (r: { ano: number; mes: number; doc: number }, chave: string) =>
  gravar(`${S}/requisicoes/${r.ano}/${r.mes}/${r.doc}/autorizar`, {}, chave);
export const atenderRequisicao = (e: unknown, chave: string) => gravar(`${S}/requisicoes/atender`, e, chave);
export const registrarDevolucao = (e: unknown, chave: string) => gravar(`${S}/devolucoes`, e, chave);
export const registrarMovimentoDireto = (e: unknown, chave: string) =>
  gravar(`${S}/movimento-direto`, e, chave);

// ── Transferência ────────────────────────────────────────────────────────────────────────────────────

export const listarEnvios = (f: { local?: number | null; etapa?: string }): Promise<TransferenciaEnviada[]> =>
  ler(`${S}/transferencias/envios${qs(f)}`, z.array(esquemaTransferenciaEnviada));
export const enviarTransferencia = (e: unknown, chave: string) =>
  gravar(`${S}/transferencias/envios`, e, chave);
export const receberTransferencia = (envio: number, e: unknown, chave: string) =>
  gravar(`${S}/transferencias/envios/${envio}/receber`, e, chave);
export const cancelarEnvio = (envio: number, motivo: string, chave: string) =>
  gravar(`${S}/transferencias/envios/${envio}/cancelar`, { motivo }, chave);
export const transferirDireto = (e: unknown, chave: string) => gravar(`${S}/transferencias`, e, chave);

// ── Nota fiscal ──────────────────────────────────────────────────────────────────────────────────────

export const registrarNota = (e: unknown, chave: string) => gravar(`${S}/notas`, e, chave);
const esquemaNotaXml = z.object({
  cnpjEmitente: z.string(),
  nomeEmitente: z.string(),
  numero: z.number(),
  serie: z.string(),
  emissao: z.string(),
  itens: z.array(
    z.object({
      codigoFornecedor: z.string(),
      descricao: z.string(),
      unidade: z.string(),
      quantidade: z.number(),
      valorUnitario: z.number(),
      lotes: z.array(z.object({ lote: z.string(), validade: z.string(), quantidade: z.number() })),
    }),
  ),
});
export type NotaDoXml = z.infer<typeof esquemaNotaXml>;
export const lerXmlNota = (xml: string): Promise<NotaDoXml> =>
  enviar(`${S}/notas/xml`, { xml }, esquemaNotaXml, novaChave('xml'));

// ── Compras ──────────────────────────────────────────────────────────────────────────────────────────

export const listarPedidos = (f: { ano?: number; situacao?: number | null }): Promise<ListaPedidosCompra> =>
  ler(`${S}/pedidos${qs(f)}`, esquemaListaPedidosCompra);
export const lerPedido = (ano: number, doc: number): Promise<PedidoDetalhe> =>
  ler(`${S}/pedidos/${ano}/${doc}`, esquemaPedidoDetalhe);
export const criarPedido = (e: unknown, chave: string) => gravar(`${S}/pedidos`, e, chave);
export const registrarProposta = (
  p: { ano: number; doc: number },
  proposta: number,
  e: { valorUnitario: number; marca?: string },
  chave: string,
) => gravar(`${S}/pedidos/${p.ano}/${p.doc}/propostas/${proposta}`, e, chave);
/** C3-008 (05-SUP linha 19): o mapa devolvido pelo portal ou pelo fornecedor (troca por arquivo). */
export const importarRespostasCotacao = (
  p: { ano: number; doc: number },
  e: { arquivo: string; conteudo: string },
  chave: string,
) => gravar(`${S}/pedidos/${p.ano}/${p.doc}/respostas-portal`, e, chave);
export const definirVencedor = (p: { ano: number; doc: number }, e: unknown, chave: string) =>
  gravar(`${S}/pedidos/${p.ano}/${p.doc}/vencedor`, e, chave);
export const listarAprovacoes = (): Promise<AprovacaoPendente[]> =>
  ler(`${S}/aprovacoes`, z.array(esquemaAprovacaoPendente));
export const aprovarPedido = (
  p: { ano: number; doc: number },
  e: { decisao: 'aprovado' | 'reprovado'; justificativa: string },
  chave: string,
) => gravar(`${S}/pedidos/${p.ano}/${p.doc}/aprovacao`, e, chave);
export const lerHistorico = (item: number): Promise<HistoricoCompra> =>
  ler(`${S}/historico-compras/${item}`, esquemaHistoricoCompra);
export const urlHistoricoCsv = (item: number) => `${S}/historico-compras/${item}/csv`;
export const lerSugestao = (local: number | null): Promise<SugestaoCompra> =>
  ler(`${S}/sugestao-compra${qs({ local })}`, esquemaSugestaoCompra);
export const gerarPedidoDaSugestao = (e: unknown, chave: string) =>
  gravar(`${S}/sugestao-compra/pedido`, e, chave);
export const definirPontoPedido = (e: unknown, chave: string) => gravar(`${S}/pontos-pedido`, e, chave);

// ── Consumo, fechamento, recálculos, parâmetros, usuários ────────────────────────────────────────────

export const lerConsumo = (ano: number, mes: number): Promise<ConsumoEstoque> =>
  ler(`${S}/consumo${qs({ ano, mes })}`, esquemaConsumo);
export const urlConsumoCsv = (ano: number, mes: number) => `${S}/consumo/csv${qs({ ano, mes })}`;
export const lerFechamentos = (): Promise<FechamentosEstoque> => ler(`${S}/fechamentos`, esquemaFechamentos);
export const fecharMes = (e: { ano: number; mes: number }, chave: string) =>
  gravar(`${S}/fechamentos`, e, chave);
export const reabrirMes = (e: { ano: number; mes: number; motivo: string }, chave: string) =>
  gravar(`${S}/fechamentos/reabrir`, e, chave);
export const lerRecalculos = (): Promise<RecalculosEstoque> => ler(`${S}/recalculos`, esquemaRecalculos);
export const lerParametros = (): Promise<ParametrosEstoque> =>
  ler(`${S}/parametros`, esquemaParametrosEstoque);
export const listarFornecedores = (termo: string) =>
  ler(
    `${S}/fornecedores${qs({ termo })}`,
    z.object({ itens: z.array(esquemaFornecedorLido), cortada: z.boolean() }),
  );
export const listarTerceiros = (termo: string) =>
  ler(
    `${S}/terceiros${qs({ termo })}`,
    z.object({ itens: z.array(esquemaTerceiroLido), cortada: z.boolean() }),
  );
export const listarPrestadores = (termo: string) =>
  ler(
    `${S}/prestadores${qs({ termo })}`,
    z.object({ itens: z.array(esquemaPrestadorLido), cortada: z.boolean() }),
  );
export const listarUsuariosEstoque = (termo: string) =>
  ler(
    `${S}/usuarios-estoque${qs({ termo })}`,
    z.array(z.object({ usuario: z.string(), nome: z.string(), locais: z.number() })),
  );
export const lerUsuarioEstoque = (login: string): Promise<EscopoUsuarioEstoque> =>
  ler(`${S}/usuarios-estoque/${encodeURIComponent(login)}`, esquemaEscopoUsuarioEstoque);

// ── Kits e inventário ────────────────────────────────────────────────────────────────────────────────

export const listarKits = (): Promise<KitRastreavel[]> => ler(`${S}/kits`, z.array(esquemaKitRastreavel));
export const conferirCarrinho = (kit: number, e: unknown, chave: string) =>
  gravar(`${S}/kits/${kit}/conferencia`, e, chave);
export const listarKitsPadrao = () =>
  ler(
    `${S}/kits-padrao`,
    z.array(
      z.object({
        codigo: z.number(),
        nome: z.string(),
        itens: z.array(z.object({ item: z.number(), nome: z.string(), quantidade: z.number() })),
      }),
    ),
  );
const esquemaInventarioResumo = z.object({
  id: z.number(),
  local: z.number(),
  tipo: z.string(),
  situacao: z.string(),
  abertoEm: z.string(),
});
export const listarInventarios = () => ler(`${S}/inventarios`, z.array(esquemaInventarioResumo));
export const lerInventario = (id: number): Promise<InventarioLido> =>
  ler(`${S}/inventarios/${id}`, esquemaInventarioLido);
export const abrirInventario = (e: unknown, chave: string) => gravar(`${S}/inventarios`, e, chave);
export const registrarContagem = (id: number, e: { item: number; quantidade: number }, chave: string) =>
  gravar(`${S}/inventarios/${id}/contagens`, e, chave);
export const decidirInventario = (
  id: number,
  e: { decisao: 'aprovado' | 'cancelado'; justificativa: string },
  chave: string,
) => gravar(`${S}/inventarios/${id}/decisao`, e, chave);
export const gravarBalanco = (id: number, chave: string) =>
  gravar(`${S}/inventarios/${id}/balanco`, {}, chave);
export const listarEstoqueInicial = () =>
  ler(
    `${S}/estoque-inicial`,
    z.array(z.object({ doc: z.number(), data: z.string(), local: z.number(), itens: z.number() })),
  );

// ── Onda 3 (M41): efeito no estoque dos documentos do novo e a conferência numérica ───────────────────────

export const lerPainelOnda3 = (f: { dia?: string; local?: number | null }): Promise<PainelOnda3> =>
  ler(`${S}/onda3/painel${qs({ dia: f.dia, local: f.local })}`, esquemaPainelOnda3);
export const lerRetratoNumerico = (f: {
  dia?: string;
  local?: number | null;
}): Promise<ConferenciaNumericaOnda3> =>
  ler(`${S}/onda3/conferencia-numerica${qs({ dia: f.dia, local: f.local })}`, esquemaConferenciaNumerica);
/** Leitura que compara (nada grava): o POST leva a chave só porque o cliente manda uma em todo POST. */
export const conferirNumerica = (
  dia: string,
  esperado: readonly { item: number; local: number | null; saldo: number; precoMedio: number }[],
): Promise<ConferenciaNumericaOnda3> =>
  enviar(
    `${S}/onda3/conferencia-numerica`,
    { dia, esperado },
    esquemaConferenciaNumerica,
    novaChave('conferencia'),
  );
