// Cliente dos envios da operadora própria à ANS (M56, etapa 7, F6): apoio da tela, lista com as contagens, ficha, arquivo,
// prévia, as gravações (gerar, transmitir, retorno, GRU, aviso de ressarcimento, decisão do atendimento) e as pendências e
// o complemento do SIB, validados pelos contratos. Problem Details viram ErroApi.
import {
  type ApoioAns,
  type ArquivoEnvioAns,
  type ComplementoSib,
  type EnvioAnsDetalhe,
  type EnviosAns,
  esquemaApoioAns,
  esquemaArquivoEnvioAns,
  esquemaEnvioAnsDetalhe,
  esquemaEnviosAns,
  esquemaPendenciasSib,
  esquemaRespostaComplementoSib,
  esquemaRespostaPreviaAns,
  esquemaResultadoEnvioAns,
  type PendenciasSib,
  type PreviaEnvioAns,
  type ResultadoEnvioAns,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { enviar, ler, lerJson, novaChave, qs } from '../exames/api-exames.js';

const A = '/api/operadora/ans';
export type ResultadoAns = ResultadoEnvioAns & { mensagem: string };

export const lerApoioAns = (): Promise<ApoioAns> => ler(`${A}/apoio`, esquemaApoioAns);

export interface FiltroEnviosTela {
  operadora?: number | null;
  obrigacao?: string | null;
  competencia?: string | null;
  situacao?: string | null;
  apos?: number | null;
}

export const lerEnviosAns = (f: FiltroEnviosTela): Promise<EnviosAns> =>
  ler(
    `${A}/envios${qs({
      operadora: f.operadora,
      obrigacao: f.obrigacao,
      competencia: f.competencia,
      situacao: f.situacao,
      apos: f.apos,
    })}`,
    esquemaEnviosAns,
  );

export const lerEnvioAns = (id: number): Promise<EnvioAnsDetalhe> =>
  ler(`${A}/envios/${id}`, esquemaEnvioAnsDetalhe);

export const lerArquivoAns = (id: number): Promise<ArquivoEnvioAns> =>
  ler(`${A}/envios/${id}/arquivo`, esquemaArquivoEnvioAns);

/** A prévia não grava: a chave de idempotência é só a do navegador (o servidor não a guarda para leitura). */
export const previaEnvioAns = (corpo: unknown): Promise<PreviaEnvioAns> =>
  enviar(`${A}/previa`, corpo, esquemaRespostaPreviaAns, novaChave('ans-previa'));

const gravar = (caminho: string, corpo: unknown, chave: string): Promise<ResultadoAns> =>
  enviar(caminho, corpo, esquemaResultadoEnvioAns, novaChave(chave));

export const gerarEnvioAns = (corpo: unknown) => gravar(`${A}/envios`, corpo, 'ans-gerar');
export const transmitirEnvioAns = (id: number, corpo: unknown) =>
  gravar(`${A}/envios/${id}/envio`, corpo, 'ans-transmitir');
export const registrarRetornoAns = (id: number, corpo: unknown) =>
  gravar(`${A}/envios/${id}/retorno`, corpo, 'ans-retorno');
export const registrarGruAns = (id: number, corpo: unknown) =>
  gravar(`${A}/envios/${id}/pagamento`, corpo, 'ans-gru');
export const registrarAvisoRessarcimento = (corpo: unknown) =>
  gravar(`${A}/ressarcimento`, corpo, 'ans-aviso');
export const decidirAtendimentoSus = (id: number, item: number, corpo: unknown) =>
  gravar(`${A}/envios/${id}/itens/${item}/decisao`, corpo, 'ans-decisao');

export const lerPendenciasSib = (operadora: number, apos: number | null): Promise<PendenciasSib> =>
  ler(`${A}/sib/pendencias${qs({ operadora, apos })}`, esquemaPendenciasSib);

export const lerComplementoSib = (beneficiario: number): Promise<ComplementoSib> =>
  ler(`${A}/sib/beneficiarios/${beneficiario}`, esquemaRespostaComplementoSib);

export async function gravarComplementoSib(beneficiario: number, corpo: unknown): Promise<ComplementoSib> {
  const r = await fetch(`${A}/sib/beneficiarios/${beneficiario}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('ans-complemento'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, esquemaRespostaComplementoSib);
}

/** Baixa o arquivo gerado (os bytes exatos: o SHA-256 da ficha é o destes bytes). */
export function baixarArquivoAns(a: ArquivoEnvioAns): void {
  const bin = atob(a.base64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: a.tipo }));
  const el = document.createElement('a');
  el.href = url;
  el.download = a.nome;
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
