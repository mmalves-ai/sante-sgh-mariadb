// Desconto em folha da mensalidade (08-SGO L97, C3-028): remessa à contratante, arquivo, retorno e conferência.
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const A = '/api/operadora/desconto-folha';
const n = z.number();
const gravado = z.object({ id: n, versao: n }).passthrough();
export type Gravado = z.infer<typeof gravado>;

const contratante = z.object({ id: n, codigo: z.string(), nome: z.string() });
export type ContratanteFolha = z.infer<typeof contratante>;

const remessa = z.object({
  id: n,
  versao: n,
  numero: z.string(),
  contratanteNome: z.string(),
  competencia: z.string(),
  tipo: z.string(),
  situacao: z.enum(['gerada', 'enviada', 'retorno_recebido', 'conferida', 'cancelada']),
  valorEnviado: n,
  valorDescontado: n,
  itens: n,
});
export type RemessaFolha = z.infer<typeof remessa>;

const item = z.object({
  sequencia: n,
  cobranca: z.string(),
  matriculaFuncional: z.string(),
  competencia: z.string(),
  valorEnviado: n,
  valorAtrasado: n,
  valorDescontado: n.nullable(),
  situacao: z.string(),
});
const detalhe = remessa.extend({ detalhe: z.array(item) });
export type RemessaFolhaDetalhe = z.infer<typeof detalhe>;

const previa = z.object({
  itens: z.array(
    z.object({
      sequencia: n,
      numero: z.string(),
      matriculaFuncional: z.string(),
      competencia: z.string(),
      valorEnviado: n,
      valorAtrasado: n,
    }),
  ),
  criticas: z.array(z.object({ fatura: n, numero: z.string(), codigo: z.string(), mensagem: z.string() })),
  valorTotal: n,
  valorAtrasado: n,
});
export type PreviaFolha = z.infer<typeof previa>;

export interface EntradaRemessa {
  operadora: number;
  contratante: number;
  competencia: string;
}

export const buscarContratantesFolha = (operadora: number, termo: string) =>
  ler(`${A}/contratantes${qs({ operadora, termo })}`, z.array(contratante));
export const listarRemessasFolha = (operadora: number | null) =>
  ler(`${A}/remessas${qs({ operadora })}`, z.array(remessa));
export const lerRemessaFolha = (id: number) => ler(`${A}/remessas/${id}`, detalhe);
export const arquivoRemessaFolha = (id: number) =>
  ler(
    `${A}/remessas/${id}/arquivo`,
    z.object({ nome: z.string(), tipoMime: z.string(), conteudo: z.string() }),
  );
export const previaRemessaFolha = (e: EntradaRemessa) =>
  enviar(`${A}/previa`, e, previa, novaChave('df-previa'));
export const gerarRemessaFolha = (e: EntradaRemessa & { tipo: string; observacao: string | null }) =>
  enviar(`${A}/remessas`, e, gravado, novaChave('df-gerar'));
export const enviarRemessaFolha = (id: number, versao: number) =>
  enviar(`${A}/remessas/${id}/envio`, { versao }, gravado, novaChave('df-envio'));
export const retornoRemessaFolha = (id: number, versao: number, texto: string, creditoEm: string) =>
  enviar(`${A}/remessas/${id}/retorno`, { versao, texto, creditoEm }, gravado, novaChave('df-retorno'));
export const conferirRemessaFolha = (id: number, versao: number) =>
  enviar(`${A}/remessas/${id}/conferencia`, { versao }, gravado, novaChave('df-conferencia'));
export const cancelarRemessaFolha = (id: number, versao: number, motivo: string) =>
  enviar(`${A}/remessas/${id}/cancelamento`, { versao, motivo }, gravado, novaChave('df-cancelamento'));
