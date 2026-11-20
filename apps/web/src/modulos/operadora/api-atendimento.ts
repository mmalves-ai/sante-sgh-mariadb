// Cliente do atendimento ao beneficiário com protocolo e das contas do portal do prestador (M56, etapa 8, F7): apoio,
// lista com as contagens, ficha com as ações que valem agora, as gravações do protocolo e as contas do portal, validados
// pelos contratos. Problem Details viram ErroApi.
import {
  type AcessosPortalPrestador,
  type ApoioProtocolos,
  type ConsultaProtocolo,
  esquemaAcessosPortal,
  esquemaApoioProtocolos,
  esquemaConsultaProtocolo,
  esquemaProtocoloDetalhe,
  esquemaProtocolos,
  INSTANCIAS_PROTOCOLO,
  type ProtocoloDetalhe,
  type Protocolos,
  type ResultadoAcessoPortal,
  type ResultadoProtocoloOpe,
  SITUACOES_ACESSO_PORTAL,
  SITUACOES_PROTOCOLO_OPE,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const P = '/api/operadora/protocolos';
const A = '/api/operadora/portal/acessos';
/** W0-10: o download do anexo de uma resposta do prestador pelo portal (GET com a sessão interna). */
export const urlAnexoRespostaPrestador = (id: number, resposta: number): string =>
  `${P}/${id}/respostas/${resposta}/anexo`;

const esquemaResultadoProtocolo: z.ZodType<ResultadoProtocoloOpe> = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  versao: z.number().int(),
  situacao: z.enum(SITUACOES_PROTOCOLO_OPE),
  protocolo: z.string(),
  mensagem: z.string(),
});
const esquemaResultadoAcesso: z.ZodType<ResultadoAcessoPortal> = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  versao: z.number().int(),
  situacao: z.enum(SITUACOES_ACESSO_PORTAL),
  codigoAtivacao: z.string().nullable(),
  ativacaoValidaAte: z.string().nullable(),
  mensagem: z.string(),
});

export const lerApoioProtocolos = (): Promise<ApoioProtocolos> => ler(`${P}/apoio`, esquemaApoioProtocolos);

export interface FiltroTelaProtocolos {
  busca?: string | null;
  situacao?: string | null;
  instancia?: (typeof INSTANCIAS_PROTOCOLO)[number] | null;
  natureza?: string | null;
  vencidos?: boolean;
  apos?: number | null;
}
export const lerProtocolos = (f: FiltroTelaProtocolos): Promise<Protocolos> =>
  ler(
    `${P}${qs({
      busca: f.busca || null,
      situacao: f.situacao ?? null,
      instancia: f.instancia ?? null,
      natureza: f.natureza ?? null,
      vencidos: f.vencidos ? 'sim' : null,
      apos: f.apos ?? null,
    })}`,
    esquemaProtocolos,
  );
export const lerProtocolo = (id: number): Promise<ProtocoloDetalhe> =>
  ler(`${P}/${id}`, esquemaProtocoloDetalhe);
export const consultarProtocolo = (numero: string): Promise<ConsultaProtocolo> =>
  ler(`${P}/consulta${qs({ numero })}`, esquemaConsultaProtocolo);

const gravar = (caminho: string, corpo: unknown, rotulo: string): Promise<ResultadoProtocoloOpe> =>
  enviar(caminho, corpo, esquemaResultadoProtocolo, novaChave(rotulo));

export const registrarProtocolo = (corpo: unknown) => gravar(P, corpo, 'prot-registrar');
/** As ações da ficha, pelo nome da ação do contrato (`acoes` da ficha). */
export const CAMINHO_DA_ACAO = {
  analisar: 'analise',
  interagir: 'interacao',
  prorrogar: 'prorrogacao',
  responder: 'resposta',
  pedirEscrita: 'escrita',
  enviarEscrita: 'escrita/envio',
  encerrar: 'encerrar',
  cancelar: 'cancelar',
  reanalise: 'reanalise',
} as const;
export type AcaoDaFicha = keyof typeof CAMINHO_DA_ACAO;
export const agirNoProtocolo = (id: number, acao: AcaoDaFicha, corpo: unknown) =>
  gravar(`${P}/${id}/${CAMINHO_DA_ACAO[acao]}`, corpo, `prot-${acao}`);

// ── Contas do portal do prestador (credenciamento) ──
export const lerAcessosPortal = (): Promise<AcessosPortalPrestador> => ler(A, esquemaAcessosPortal);
const gravarAcesso = (caminho: string, corpo: unknown, rotulo: string): Promise<ResultadoAcessoPortal> =>
  enviar(caminho, corpo, esquemaResultadoAcesso, novaChave(rotulo));
export const criarAcessoPortal = (corpo: unknown) => gravarAcesso(A, corpo, 'portal-criar');
export const alterarAcessoPortal = (id: number, corpo: unknown) =>
  gravarAcesso(`${A}/${id}`, corpo, 'portal-alterar');
export const reemitirAcessoPortal = (id: number, corpo: unknown) =>
  gravarAcesso(`${A}/${id}/reemissao`, corpo, 'portal-reemitir');
export const encerrarAcessoPortal = (id: number, corpo: unknown) =>
  gravarAcesso(`${A}/${id}/encerrar`, corpo, 'portal-encerrar');
