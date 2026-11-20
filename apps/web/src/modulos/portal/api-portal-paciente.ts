// Cliente do portal do paciente (M50, etapa 1): outro domínio de identidade, com a sessão própria do portal (cookie
// HttpOnly) e o CSRF por token duplo próprio (o cookie sgh_pac_csrf repetido no cabeçalho x-csrf-paciente). Nunca
// manda o ID do paciente: o servidor tira o titular da sessão. As respostas são validadas pelos contratos.
import {
  type AtivacaoIniciada,
  type ConsentimentoPortalItem,
  type CopiaPortalItem,
  type DocumentoPortalAberto,
  esquemaAtivacaoIniciada,
  esquemaConsentimentoPortalItem,
  esquemaCopiaPortalItem,
  esquemaDocumentoPortalAberto,
  esquemaLaudoPortalAberto,
  esquemaListaDocumentosPortal,
  esquemaManifestacaoPortalItem,
  esquemaPedidoTitularPortalItem,
  esquemaRelatorioAcessosTitular,
  esquemaSessaoContaPortal,
  esquemaTrocaEmailPedida,
  esquemaVinculoResumo,
  type LaudoPortalAberto,
  type ListaDocumentosPortal,
  type ManifestacaoPortalItem,
  type PedidoTitularPortalItem,
  type RelatorioAcessosTitular,
  type SessaoContaPortal,
  type TrocaEmailPedida,
  type VinculoResumo,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/paciente';
const JSON_ACEITO = { accept: 'application/json' };

function csrfPaciente(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === 'sgh_pac_csrf') return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}

async function json<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
async function vazio(r: Response): Promise<void> {
  if (!r.ok) throw await erroDaResposta(r);
}
const escrever = (metodo: string, url: string, corpo?: unknown) =>
  fetch(url, {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      'x-csrf-paciente': csrfPaciente(),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
const ler = <T>(url: string, esquema: z.ZodType<T>) =>
  fetch(url, { headers: JSON_ACEITO }).then((r) => json(r, esquema));

export const esquemaEstabelecimentoPortal = z.object({
  estabelecimento: z.string().nullable(),
  termoUso: z.string(),
  politica: z.string(),
  consentimento: z.string(),
});
export type EstabelecimentoPortal = z.infer<typeof esquemaEstabelecimentoPortal>;

export const estabelecimentoPortal = () => ler(`${P}/estabelecimento`, esquemaEstabelecimentoPortal);

// ── Primeiro acesso e entrada ──
export const conferirConvite = (hospital: string, corpo: { codigo: string; nascimento: string }) =>
  escrever('POST', `${P}/${hospital}/convite`, corpo).then(vazio);
export const iniciarAtivacao = (corpo: unknown): Promise<AtivacaoIniciada> =>
  escrever('POST', `${P}/ativacao`, corpo).then((r) => json(r, esquemaAtivacaoIniciada));
export const confirmarSegundoFator = (codigo: string): Promise<SessaoContaPortal> =>
  escrever('POST', `${P}/ativacao/segundo-fator`, { codigo }).then((r) => json(r, esquemaSessaoContaPortal));
export const entrarPortal = (hospital: string, corpo: { email: string; senha: string; codigo: string }) =>
  escrever('POST', `${P}/${hospital}/entrada`, corpo).then((r) => json(r, esquemaSessaoContaPortal));
export const euPortalPaciente = (): Promise<SessaoContaPortal> => ler(`${P}/eu`, esquemaSessaoContaPortal);
export const sairPortalPaciente = () => escrever('DELETE', `${P}/sessao`).then(() => undefined);
export const escolherTitular = (vinculo: string | null): Promise<SessaoContaPortal> =>
  escrever('PUT', `${P}/titular`, { vinculo }).then((r) => json(r, esquemaSessaoContaPortal));

// ── Conta e segurança ──
export const esquemaSegurancaPortal = z.object({
  emailMascarado: z.string().nullable(),
  ultimoAcessoEm: z.string().nullable(),
  ativadaEm: z.string().nullable(),
  /** W0-10: a troca do e-mail pendente (o link foi ao e-mail novo). */
  trocaEmail: esquemaTrocaEmailPedida.nullable(),
});
export const segurancaPortal = () => ler(`${P}/seguranca`, esquemaSegurancaPortal);
export const trocarSenhaPortal = (corpo: {
  atual: string;
  nova: string;
  confirmacao: string;
  codigo: string;
}) => escrever('POST', `${P}/senha`, corpo).then(vazio);

// W0-10: a troca do e-mail (o link vai ao e-mail novo; a conta só muda quando ele é aberto) e do autenticador.
export const pedirTrocaEmailPortal = (corpo: {
  email: string;
  senha: string;
  codigo: string;
}): Promise<TrocaEmailPedida> =>
  escrever('POST', `${P}/email`, corpo).then((r) => json(r, esquemaTrocaEmailPedida));
export const cancelarTrocaEmailPortal = () => escrever('DELETE', `${P}/email/troca`).then(vazio);
export const confirmarTrocaEmailPortal = (hospital: string, token: string) =>
  escrever('POST', `${P}/${hospital}/email/confirmacao`, { token }).then((r) =>
    json(r, z.object({ emailMascarado: z.string().nullable() })),
  );
export const iniciarTrocaSegundoFatorPortal = (corpo: {
  senha: string;
  codigo: string;
}): Promise<AtivacaoIniciada> =>
  escrever('POST', `${P}/segundo-fator/troca`, corpo).then((r) => json(r, esquemaAtivacaoIniciada));
export const confirmarTrocaSegundoFatorPortal = (codigo: string) =>
  escrever('POST', `${P}/segundo-fator/troca/confirmacao`, { codigo }).then(vazio);

// ── Resultados e documentos ──
export const documentosPortal = (pagina = 1): Promise<ListaDocumentosPortal> =>
  ler(`${P}/documentos?pagina=${pagina}`, esquemaListaDocumentosPortal);
export const abrirResultadoPortal = (item: string): Promise<LaudoPortalAberto> =>
  escrever('POST', `${P}/documentos/resultado/${encodeURIComponent(item)}`, {}).then((r) =>
    json(r, esquemaLaudoPortalAberto),
  );
export const abrirDocumentoPortal = (item: string): Promise<DocumentoPortalAberto> =>
  escrever('POST', `${P}/documentos/documento/${encodeURIComponent(item)}`, {}).then((r) =>
    json(r, esquemaDocumentoPortalAberto),
  );
export const enderecoPdfDocumento = (item: string) =>
  `${P}/documentos/documento/${encodeURIComponent(item)}/pdf`;

// ── Responsáveis ──
export const esquemaVinculosPortal = z.object({
  meus: z.array(esquemaVinculoResumo),
  deMim: z.array(esquemaVinculoResumo),
  recusa: z.string().nullable(),
});
export type VinculosPortal = z.infer<typeof esquemaVinculosPortal>;
export const vinculosPortal = (): Promise<VinculosPortal> => ler(`${P}/vinculos`, esquemaVinculosPortal);
export const enviarProva = (tipo: string, conteudo: string) =>
  escrever('POST', `${P}/vinculos/arquivo`, { tipo, conteudo }).then((r) =>
    json(r, z.object({ arquivo: z.string() })),
  );
export const pedirVinculo = (corpo: unknown): Promise<VinculoResumo> =>
  escrever('POST', `${P}/vinculos`, corpo).then((r) => json(r, esquemaVinculoResumo));
export const revogarVinculo = (vinculo: string) =>
  escrever('DELETE', `${P}/vinculos/${encodeURIComponent(vinculo)}`).then(vazio);

// ── Consentimentos e privacidade ──
export const consentimentosPortal = (): Promise<ConsentimentoPortalItem[]> =>
  ler(`${P}/consentimentos`, z.array(esquemaConsentimentoPortalItem));
export const registrarConsentimentoPortal = (corpo: unknown): Promise<ConsentimentoPortalItem[]> =>
  escrever('POST', `${P}/consentimentos`, corpo).then((r) =>
    json(r, z.array(esquemaConsentimentoPortalItem)),
  );
export const pedidosPortal = (): Promise<PedidoTitularPortalItem[]> =>
  ler(`${P}/pedidos`, z.array(esquemaPedidoTitularPortalItem));
export const registrarPedidoPortal = (corpo: { tipo: string; descricao: string | null }) =>
  escrever('POST', `${P}/pedidos`, corpo).then((r) =>
    json(r, z.object({ protocolo: z.string(), prazo: z.string() })),
  );
/** W0-10: o titular cancela com motivo o pedido não respondido (o respondido devolve 409). */
export const cancelarPedidoPortal = (
  protocolo: string,
  corpo: { motivo: string; observacao: string | null },
) =>
  escrever('POST', `${P}/pedidos/${encodeURIComponent(protocolo)}/cancelamento`, corpo).then(() => undefined);
/** W0-10 (M1): as manifestações à ouvidoria feitas pelo portal e a nova manifestação (protocolo e prazo). */
export const manifestacoesPortal = (): Promise<ManifestacaoPortalItem[]> =>
  ler(`${P}/manifestacoes`, z.array(esquemaManifestacaoPortalItem));
export const registrarManifestacaoPortal = (corpo: { tipo: string; area: string | null; relato: string }) =>
  escrever('POST', `${P}/manifestacoes`, corpo).then((r) =>
    json(r, z.object({ protocolo: z.string(), prazoEm: z.string() })),
  );
/** W0-10 (M2): as cópias do prontuário pedidas (etapa e prazo), o pedido novo e o PDF entregue pelo portal. */
export const copiasPortal = (): Promise<CopiaPortalItem[]> =>
  ler(`${P}/copias`, z.array(esquemaCopiaPortalItem));
export const pedirCopiaPortal = (corpo: { observacao: string | null }) =>
  escrever('POST', `${P}/copias`, corpo).then((r) =>
    json(r, z.object({ protocolo: z.string(), prazo: z.string() })),
  );
export const enderecoPdfCopia = (protocolo: string) => `${P}/copias/${encodeURIComponent(protocolo)}/pdf`;
/** W0-10 (M3): o pacote de portabilidade FHIR/IPS do pedido atendido (o download vai à trilha). */
export const enderecoPacoteIps = (protocolo: string) =>
  `${P}/portabilidade/${encodeURIComponent(protocolo)}/ips`;
export const acessosPortal = (de: string, ate: string, pagina = 1): Promise<RelatorioAcessosTitular> =>
  ler(`${P}/acessos?de=${de}&ate=${ate}&pagina=${pagina}`, esquemaRelatorioAcessosTitular);

/** Reduz a foto (lado maior até 1600 px, JPEG 0,8) para caber no limite do envio; o PDF vai como está. */
export async function arquivoParaEnvio(arquivo: File): Promise<{ tipo: string; conteudo: string }> {
  const b64 = (buf: ArrayBuffer) => {
    let s = '';
    const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  if (arquivo.type === 'application/pdf')
    return { tipo: 'application/pdf', conteudo: b64(await arquivo.arrayBuffer()) };
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const tela = document.createElement('canvas');
  tela.width = Math.round(bitmap.width * escala);
  tela.height = Math.round(bitmap.height * escala);
  tela.getContext('2d')?.drawImage(bitmap, 0, 0, tela.width, tela.height);
  const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, 'image/jpeg', 0.8));
  if (!blob) throw new Error('Não foi possível ler a imagem.');
  return { tipo: 'image/jpeg', conteudo: b64(await blob.arrayBuffer()) };
}
