// Cliente da autorização de guias e da auditoria médica da operadora própria (M56, etapa 5, F4): apoio da tela, lista,
// ficha, terminologia TUSS, as gravações do pedido e a designação dos auditores, validados pelos contratos. Problem
// Details viram ErroApi.
import {
  type ApoioAutorizacoes,
  type AuditoresOperadora,
  type AutorizacaoDetalhe,
  type Autorizacoes,
  esquemaApoioAutorizacoes,
  esquemaAuditores,
  esquemaAutorizacaoDetalhe,
  esquemaAutorizacoes,
  esquemaProcedimentosTuss,
  esquemaResultadoAuditor,
  esquemaResultadoAutorizacao,
  type ProcedimentoTuss,
  type ResultadoAuditor,
  type ResultadoAutorizacao,
} from '@sgh/contratos';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/autorizacoes';
/** W0-10: o download de um anexo da resposta do prestador ao complemento (GET com a sessão interna). */
export const urlAnexoComplemento = (id: number, anexo: number): string => `${A}/${id}/anexos/${anexo}`;

export const lerApoioAutorizacoes = (): Promise<ApoioAutorizacoes> =>
  ler(`${A}/apoio`, esquemaApoioAutorizacoes);

export function lerAutorizacoes(f: {
  busca?: string | null;
  situacao?: string | null;
  vencidas?: boolean;
  apos?: number | null;
}): Promise<Autorizacoes> {
  const q = new URLSearchParams();
  if (f.busca) q.set('busca', f.busca);
  if (f.situacao) q.set('situacao', f.situacao);
  if (f.vencidas) q.set('vencidas', 'sim');
  if (f.apos) q.set('apos', String(f.apos));
  const s = q.toString();
  return ler(`${A}${s ? `?${s}` : ''}`, esquemaAutorizacoes);
}

export const lerAutorizacao = (id: number): Promise<AutorizacaoDetalhe> =>
  ler(`${A}/${id}`, esquemaAutorizacaoDetalhe);

export async function buscarProcedimentos(busca: string): Promise<ProcedimentoTuss[]> {
  const r = await ler(`${A}/procedimentos?busca=${encodeURIComponent(busca)}`, esquemaProcedimentosTuss);
  return r.itens;
}

const gravar = (caminho: string, corpo: unknown, chave: string): Promise<ResultadoAutorizacao> =>
  enviar(caminho, corpo, esquemaResultadoAutorizacao, novaChave(chave));

export const registrarAutorizacao = (corpo: unknown) => gravar(A, corpo, 'aut-registrar');
export const pedirComplemento = (id: number, corpo: unknown) =>
  gravar(`${A}/${id}/complemento`, corpo, 'aut-complemento');
export const responderComplemento = (id: number, corpo: unknown) =>
  gravar(`${A}/${id}/complemento/resposta`, corpo, 'aut-resposta');
export const decidirAutorizacao = (id: number, corpo: unknown) =>
  gravar(`${A}/${id}/decisao`, corpo, 'aut-decidir');
export const abrirJunta = (id: number, corpo: unknown) => gravar(`${A}/${id}/junta`, corpo, 'aut-junta');
export const concluirJunta = (id: number, corpo: unknown) =>
  gravar(`${A}/${id}/junta/conclusao`, corpo, 'aut-junta-conclusao');
export const cancelarAutorizacao = (id: number, corpo: unknown) =>
  gravar(`${A}/${id}/cancelar`, corpo, 'aut-cancelar');

const O = '/api/operadora';
export const lerAuditores = (): Promise<AuditoresOperadora> => ler(`${O}/auditores`, esquemaAuditores);
export const designarAuditor = (corpo: unknown): Promise<ResultadoAuditor> =>
  enviar(`${O}/auditores`, corpo, esquemaResultadoAuditor, novaChave('aut-designar'));
export const encerrarAuditor = (id: number, corpo: unknown): Promise<ResultadoAuditor> =>
  enviar(`${O}/auditores/${id}/encerrar`, corpo, esquemaResultadoAuditor, novaChave('aut-encerrar'));
export const alterarAuditor = (id: number, corpo: unknown): Promise<ResultadoAuditor> =>
  enviar(`${O}/auditores/${id}/alteracao`, corpo, esquemaResultadoAuditor, novaChave('aut-alterar'));
