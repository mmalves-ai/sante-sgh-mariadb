// Cliente do portal do prestador credenciado da operadora própria (M56, etapa 8, F7): a sessão é própria do portal (cookie
// HttpOnly) com o CSRF por token duplo (o cookie sgh_portal_prestador_csrf repetido no cabeçalho
// x-csrf-portal-prestador). Nunca manda quem é o prestador nem a origem do pedido: o servidor tira os dois da conta.
import {
  type AbrirProtocoloPortalEntrada,
  type ApoioPortalPrestador,
  type AutenticadorNovoPortalPrestador,
  type AutorizacaoPortal,
  CABECALHO_CSRF_PORTAL_PRESTADOR,
  COOKIE_CSRF_PORTAL_PRESTADOR,
  esquemaApoioPortalPrestador,
  esquemaAutenticadorNovoPortalPrestador,
  esquemaAutorizacaoPortal,
  esquemaComplementoPortal,
  esquemaConsultasElegibilidadePortal,
  esquemaElegibilidadePortal,
  type ConsultasElegibilidadePortal,
  type ContasPortal,
  type DemonstrativoConta,
  esquemaContasPortal,
  esquemaDemonstrativoConta,
  esquemaGlosasContaPortal,
  type GlosasContaPortal,
  type RegistrarRecursoItensEntrada,
  esquemaResultadoConta,
  type ResultadoConta,
  type ElegibilidadePortal,
  esquemaProtocoloPortal,
  esquemaProcedimentosTuss,
  esquemaResultadoAutorizacao,
  esquemaSessaoPortalPrestador,
  type ProcedimentoTuss,
  type ProtocoloPortal,
  TIPO_CORPO_ANEXOS_PORTAL,
  type ResultadoAutorizacao,
  type SessaoPortalPrestador,
} from '@sgh/contratos';
import { z } from 'zod';
import { lerJson, qs } from '../exames/api-exames.js';

const P = '/api/portal-prestador';
const JSON_ACEITO = { accept: 'application/json' };

function csrfPortal(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === COOKIE_CSRF_PORTAL_PRESTADOR) return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}
const ler = async <T>(url: string, esquema: z.ZodType<T>): Promise<T> =>
  lerJson(await fetch(url, { headers: JSON_ACEITO, credentials: 'same-origin' }), esquema);
const postar = async <T>(
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  csrf = true,
  tipo = 'application/json',
): Promise<T> =>
  lerJson(
    await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        ...JSON_ACEITO,
        'content-type': tipo,
        ...(csrf ? { [CABECALHO_CSRF_PORTAL_PRESTADOR]: csrfPortal() } : {}),
      },
      body: JSON.stringify(corpo ?? {}),
    }),
    esquema,
  );

const esquemaAtivacao = z.object({ otpauth: z.string(), mensagem: z.string() });
const esquemaPedidos = z.object({
  itens: z.array(esquemaAutorizacaoPortal),
  proxima: z.number().int().nullable(),
});
const esquemaPedidoPortal = esquemaAutorizacaoPortal.extend({
  itens: z.array(
    z.object({
      codigo: z.string(),
      descricao: z.string(),
      solicitada: z.number(),
      autorizada: z.number().nullable(),
    }),
  ),
  /** W0-10: o que o auditor pediu de complemento e as respostas dadas (texto e anexos). */
  complemento: esquemaComplementoPortal.nullable().default(null),
});
export type PedidoPortal = z.infer<typeof esquemaPedidoPortal>;

export const ativarPortalPrestador = (
  hospital: string,
  e: { login: string; codigo: string; senha: string },
): Promise<{ otpauth: string; mensagem: string }> =>
  postar(`${P}/${encodeURIComponent(hospital)}/ativacao`, e, esquemaAtivacao, false);
export const entrarPortalPrestador = (
  hospital: string,
  e: { login: string; senha: string; codigo: string },
): Promise<SessaoPortalPrestador> =>
  postar(`${P}/${encodeURIComponent(hospital)}/entrada`, e, esquemaSessaoPortalPrestador, false);
export const sairPortalPrestador = (): Promise<unknown> => postar(`${P}/saida`, {}, z.unknown());
export const sessaoPortalPrestador = (): Promise<SessaoPortalPrestador> =>
  ler(`${P}/sessao`, esquemaSessaoPortalPrestador);
export const apoioPortalPrestador = (): Promise<ApoioPortalPrestador> =>
  ler(`${P}/apoio`, esquemaApoioPortalPrestador);
export async function procedimentosPortalPrestador(busca: string): Promise<ProcedimentoTuss[]> {
  return (await ler(`${P}/procedimentos${qs({ busca })}`, esquemaProcedimentosTuss)).itens;
}
export const pedidosPortalPrestador = (
  f: { busca?: string | null; apos?: number | null } = {},
): Promise<{ itens: AutorizacaoPortal[]; proxima: number | null }> =>
  ler(`${P}/autorizacoes${qs({ busca: f.busca || null, apos: f.apos ?? null })}`, esquemaPedidos);
export const pedidoPortalPrestador = (id: number): Promise<PedidoPortal> =>
  ler(`${P}/autorizacoes/${id}`, esquemaPedidoPortal);
export const solicitarPortalPrestador = (corpo: unknown): Promise<ResultadoAutorizacao> =>
  postar(`${P}/autorizacoes`, corpo, esquemaResultadoAutorizacao);
export const cancelarPedidoPortalPrestador = (
  id: number,
  e: { versao: number; motivo: string },
): Promise<ResultadoAutorizacao> =>
  postar(`${P}/autorizacoes/${id}/cancelar`, e, esquemaResultadoAutorizacao);
export const protocoloPortalPrestador = (numero: string): Promise<ProtocoloPortal> =>
  ler(`${P}/protocolos/${encodeURIComponent(numero)}`, esquemaProtocoloPortal);
// W0-10: o prestador abre um protocolo de atendimento (a operadora, o prestador e o canal saem da conta, no servidor).
const esquemaProtocoloAberto = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  protocolo: z.string(),
  prazoEm: z.string(),
  mensagem: z.string(),
});
export const abrirProtocoloPortalPrestador = (
  e: AbrirProtocoloPortalEntrada,
): Promise<z.infer<typeof esquemaProtocoloAberto>> => postar(`${P}/protocolos`, e, esquemaProtocoloAberto);

// W0-10: a troca da senha e do autenticador pelo próprio prestador (o servidor confere a sessão, o CSRF e as credenciais).
const esquemaMensagem = z.object({ mensagem: z.string() });
export const trocarSenhaPortalPrestador = (e: {
  senhaAtual: string;
  codigo: string;
  senhaNova: string;
}): Promise<{ mensagem: string }> => postar(`${P}/conta/senha`, e, esquemaMensagem);
export const iniciarAutenticadorPortalPrestador = (e: {
  senha: string;
  codigo: string;
}): Promise<AutenticadorNovoPortalPrestador> =>
  postar(`${P}/conta/autenticador`, e, esquemaAutenticadorNovoPortalPrestador);
export const confirmarAutenticadorPortalPrestador = (codigo: string): Promise<{ mensagem: string }> =>
  postar(`${P}/conta/autenticador/confirmacao`, { codigo }, esquemaMensagem);

// W0-10: a resposta ao complemento pedido pelo auditor (até 5 anexos) e a resposta a uma interação da operadora no
// protocolo (um anexo). O corpo vai com o tipo próprio dos anexos (teto maior no servidor); o tipo do arquivo é
// conferido pelos primeiros bytes no servidor, nunca pelo nome.
export interface AnexoEnviado {
  nome: string;
  conteudo: string;
}
const esquemaResultadoResposta = z.object({ versao: z.number().int(), mensagem: z.string() }).passthrough();
export const responderComplementoPortalPrestador = (
  id: number,
  e: { versao: number; resposta: string; anexos: AnexoEnviado[] },
): Promise<{ versao: number; mensagem: string }> =>
  postar(`${P}/autorizacoes/${id}/complemento`, e, esquemaResultadoResposta, true, TIPO_CORPO_ANEXOS_PORTAL);
export const responderInteracaoPortalPrestador = (
  id: number,
  evento: number,
  e: { versao: number; texto: string; anexo: AnexoEnviado | null },
): Promise<{ versao: number; mensagem: string }> =>
  postar(
    `${P}/protocolos/${id}/interacoes/${evento}/resposta`,
    e,
    esquemaResultadoResposta,
    true,
    TIPO_CORPO_ANEXOS_PORTAL,
  );
/** Os endereços de download (GET com o cookie do portal; o servidor confere que o anexo é do prestador da sessão). */
export const urlAnexoComplementoPortal = (id: number, anexo: number): string =>
  `${P}/autorizacoes/${id}/anexos/${anexo}`;
export const urlAnexoProtocoloPortal = (id: number, resposta: number): string =>
  `${P}/protocolos/${id}/respostas/${resposta}/anexo`;

// W0-10 (M7): a elegibilidade pela carteirinha (o servidor registra cada consulta) e as últimas consultas do prestador.
export const consultarElegibilidadePortalPrestador = (e: {
  carteirinha: string;
  data?: string;
}): Promise<ElegibilidadePortal> => postar(`${P}/elegibilidade`, e, esquemaElegibilidadePortal);
export const consultasElegibilidadePortalPrestador = (): Promise<ConsultasElegibilidadePortal> =>
  ler(`${P}/elegibilidade`, esquemaConsultasElegibilidadePortal);

// W0-10 (M8): o envio do lote XML TISS (os bytes em base64; o servidor confere versão, XSD, hash e se o lote é do
// prestador da sessão), os lotes do prestador e o demonstrativo de análise.
export const enviarLotePortalPrestador = (e: {
  arquivo: string;
  nome: string | null;
}): Promise<ResultadoConta> => postar(`${P}/contas`, e, esquemaResultadoConta);
export const contasPortalPrestador = (apos?: number): Promise<ContasPortal> =>
  ler(`${P}/contas${qs({ apos })}`, esquemaContasPortal);
export const demonstrativoPortalPrestador = (id: number): Promise<DemonstrativoConta> =>
  ler(`${P}/contas/${id}/demonstrativo`, esquemaDemonstrativoConta);
export const demonstrativoPagamentoPortalPrestador = (id: number): Promise<DemonstrativoConta> =>
  ler(`${P}/contas/${id}/demonstrativo-pagamento`, esquemaDemonstrativoConta);

// W0-10 (M8): as glosas do lote (guias, itens glosados e o recurso de cada item) e o recurso item a item de uma guia.
export const glosasPortalPrestador = (id: number): Promise<GlosasContaPortal> =>
  ler(`${P}/contas/${id}/glosas`, esquemaGlosasContaPortal);
export const recorrerPortalPrestador = (
  id: number,
  e: RegistrarRecursoItensEntrada,
): Promise<ResultadoConta> => postar(`${P}/contas/${id}/recursos`, e, esquemaResultadoConta);
