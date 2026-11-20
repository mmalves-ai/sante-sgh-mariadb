// Cliente das contas médicas recebidas pela operadora própria (M56, etapa 6, F5): apoio da tela, lista, ficha,
// demonstrativo, pagamentos e as gravações (receber o lote, glosar, concluir, devolver, recurso, decisão, pagamento),
// validados pelos contratos. Problem Details viram ErroApi.
import {
  type ApoioContas,
  type ContaMedicaDetalhe,
  type Contas,
  type DemonstrativoConta,
  esquemaApoioContas,
  esquemaContaMedicaDetalhe,
  esquemaContas,
  esquemaDemonstrativoConta,
  esquemaPagamentos,
  esquemaResultadoConta,
  type PagamentosPrestadores,
  type ResultadoConta,
} from '@sgh/contratos';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/operadora/contas';

export const lerApoioContas = (): Promise<ApoioContas> => ler(`${C}/apoio`, esquemaApoioContas);

export interface FiltroContasTela {
  busca?: string | null;
  prestador?: number | null;
  competencia?: string | null;
  situacao?: string | null;
  vencidas?: boolean;
  recursos?: boolean;
  apos?: number | null;
}

export function lerContas(f: FiltroContasTela): Promise<Contas> {
  const q = new URLSearchParams();
  if (f.busca) q.set('busca', f.busca);
  if (f.prestador) q.set('prestador', String(f.prestador));
  if (f.competencia) q.set('competencia', f.competencia);
  if (f.situacao) q.set('situacao', f.situacao);
  if (f.vencidas) q.set('vencidas', 'sim');
  if (f.recursos) q.set('recursos', 'sim');
  if (f.apos) q.set('apos', String(f.apos));
  const s = q.toString();
  return ler(`${C}${s ? `?${s}` : ''}`, esquemaContas);
}

export const lerConta = (id: number): Promise<ContaMedicaDetalhe> =>
  ler(`${C}/${id}`, esquemaContaMedicaDetalhe);

export const lerDemonstrativo = (id: number): Promise<DemonstrativoConta> =>
  ler(`${C}/${id}/demonstrativo`, esquemaDemonstrativoConta);
/** W0-10 (M8): o demonstrativo de pagamento do lote quitado. */
export const lerDemonstrativoPagamento = (id: number): Promise<DemonstrativoConta> =>
  ler(`${C}/${id}/demonstrativo-pagamento`, esquemaDemonstrativoConta);

export function lerPagamentos(f: {
  estado: 'a-pagar' | 'pagas' | 'todas';
  prestador?: number | null;
  apos?: number | null;
}): Promise<PagamentosPrestadores> {
  const q = new URLSearchParams({ estado: f.estado });
  if (f.prestador) q.set('prestador', String(f.prestador));
  if (f.apos) q.set('apos', String(f.apos));
  return ler(`/api/operadora/pagamentos-prestadores?${q.toString()}`, esquemaPagamentos);
}

const gravar = (caminho: string, corpo: unknown, chave: string): Promise<ResultadoConta> =>
  enviar(caminho, corpo, esquemaResultadoConta, novaChave(chave));

export const receberConta = (corpo: unknown) => gravar(`${C}/xml`, corpo, 'conta-receber');
export const glosarConta = (id: number, corpo: unknown) => gravar(`${C}/${id}/glosas`, corpo, 'conta-glosar');
export const concluirAnalise = (id: number, corpo: unknown) =>
  gravar(`${C}/${id}/analise`, corpo, 'conta-concluir');
export const devolverConta = (id: number, corpo: unknown) =>
  gravar(`${C}/${id}/devolver`, corpo, 'conta-devolver');
export const registrarRecurso = (id: number, corpo: unknown) =>
  gravar(`${C}/${id}/recurso`, corpo, 'conta-recurso');
export const decidirRecurso = (id: number, corpo: unknown) =>
  gravar(`${C}/${id}/recurso/decisao`, corpo, 'conta-recurso-decisao');
/** W0-10 (M8): a decisão do recurso por item de uma guia (todos os itens recorridos de uma vez). */
export const decidirRecursoItens = (id: number, guia: number, corpo: unknown) =>
  gravar(`${C}/${id}/guias/${guia}/recurso-itens/decisao`, corpo, 'conta-recurso-itens-decisao');
export const pagarConta = (id: number, corpo: unknown) =>
  gravar(`${C}/${id}/pagamento`, corpo, 'conta-pagar');

/** Os bytes do arquivo em base64 (o XML TISS é ISO-8859-1: nunca lido como texto, o hash depende dos bytes). */
export async function arquivoEmBase64(f: Blob): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

/** Baixa o demonstrativo (os bytes exatos do XML). */
export function baixarDemonstrativo(d: DemonstrativoConta): void {
  const bin = atob(d.xmlBase64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = d.nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
