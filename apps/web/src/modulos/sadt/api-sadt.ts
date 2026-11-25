// Cliente das telas do SADT (M26), validado pelos contratos. As gravações vão com o CSRF e a Idempotency-Key (uma por
// intenção de gravar); Problem Details viram ErroApi e o código da recusa (ex.: pedido-suspenso, sem-habilitacao) fica
// em `problema.codigo` para a tela mostrar o texto certo.
import {
  type AmostraDetalhe,
  type ApoioSadt,
  type AutocadastroLido,
  type ColetaRegistrada,
  esquemaAmostraDetalhe,
  esquemaApoioSadt,
  esquemaAutocadastroLido,
  esquemaColetaRegistrada,
  esquemaExameSadt,
  esquemaGravacaoSadt,
  esquemaIndicadoresSadt,
  esquemaItemLiberacao,
  esquemaLaudoEmitido,
  esquemaListaAmostras,
  esquemaListaColeta,
  esquemaListaExamesSadt,
  esquemaListaLiberacao,
  esquemaListaOrcamentos,
  esquemaListaRequisicoes,
  esquemaMapaTrabalho,
  esquemaPacienteSadt,
  esquemaPainelCriticos,
  esquemaParametrosSadt,
  esquemaResultadoDigitacao,
  esquemaResultadoSadt,
  esquemaValorCriticoLido,
  type ExameSadt,
  type GravacaoSadt,
  type IndicadoresSadt,
  type ItemLiberacao,
  type LaudoEmitido,
  type ListaAmostras,
  type ListaColeta,
  type ListaExamesSadt,
  type ListaLiberacao,
  type ListaOrcamentos,
  type ListaRequisicoes,
  type MapaTrabalho,
  type PainelCriticos,
  type ParametrosSadt,
  type ResultadoDigitacao,
  type ResultadoSadt,
  type ValorCriticoLido,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const S = '/api/sadt';
export const CANAL_CRITICOS = `${S}/criticos/eventos`;

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m26.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

const gravar = (url: string, corpo: unknown, chave: string): Promise<ResultadoSadt> =>
  enviar(url, corpo, esquemaResultadoSadt, chave);

const esquemaAtendimento = z.object({
  atendimento: z.number(),
  paciente: esquemaPacienteSadt,
  atend: z.enum(['I', 'E']),
  reg: z.number(),
  convenio: z.object({ codigo: z.number(), nome: z.string() }),
  conta: z.object({ id: z.number(), numero: z.number() }).nullable(),
  retratos: z.object({ htAtendimento: z.number(), htPaciente: z.number() }).nullable(),
});
export type AtendimentoSadt = z.infer<typeof esquemaAtendimento>;
const esquemaProfissionais = z.array(
  z.object({ id: z.number(), nome: z.string(), conselho: z.string(), cbo: z.string() }),
);
const esquemaSolicitantes = z.array(
  z.object({ id: z.number(), nome: z.string(), registro: z.string(), ativo: z.boolean() }),
);
const esquemaLaudos = z.array(
  z.object({
    numero: z.string(),
    codigo: z.string(),
    emitidoEm: z.string(),
    emitidoPor: z.string(),
    segundasVias: z.number(),
  }),
);
const esquemaElementos = z.array(
  z.object({ codigo: z.number(), nome: z.string(), unidade: z.string().nullable() }),
);
const esquemaProtocolo = z.object({ protocolo: z.string(), mensagem: z.string() });

// ── Leituras ──────────────────────────────────────────────────────────────────────────────────────
export const lerGravacaoSadt = (): Promise<GravacaoSadt> => ler(`${S}/gravacao`, esquemaGravacaoSadt);
export const lerApoioSadt = (setor?: string | null): Promise<ApoioSadt> =>
  ler(`${S}/apoio${qs({ setor })}`, esquemaApoioSadt);
export const listarExamesSadt = (f: {
  setor?: string | null;
  data?: string | null;
  situacao?: string | null;
  urgentes?: boolean;
  termo?: string | null;
}): Promise<ListaExamesSadt> =>
  ler(`${S}/exames${qs({ ...f, urgentes: f.urgentes ? 'sim' : null })}`, esquemaListaExamesSadt);
export const lerExameSadt = (id: number): Promise<ExameSadt> => ler(`${S}/exames/${id}`, esquemaExameSadt);
export const lerAtendimentoSadt = (id: number): Promise<AtendimentoSadt> =>
  ler(`${S}/atendimentos/${id}`, esquemaAtendimento);
export const buscarAtendimentosSadt = (numero: number): Promise<AtendimentoSadt[]> =>
  ler(`${S}/atendimentos${qs({ numero })}`, z.array(esquemaAtendimento));
export const buscarProfissionaisSadt = (termo: string) =>
  ler(`${S}/busca/profissionais${qs({ termo })}`, esquemaProfissionais);
export const buscarSolicitantesSadt = (termo: string) =>
  ler(`${S}/busca/solicitantes${qs({ termo })}`, esquemaSolicitantes);
export const listarRequisicoes = (data: string | null, termo: string | null): Promise<ListaRequisicoes> =>
  ler(`${S}/requisicoes${qs({ data, termo })}`, esquemaListaRequisicoes);
export const listarOrcamentos = (termo: string | null): Promise<ListaOrcamentos> =>
  ler(`${S}/orcamentos${qs({ termo })}`, esquemaListaOrcamentos);
export const lerColeta = (
  data: string | null,
  f: { unidade?: number | null; de?: string | null; ate?: string | null } = {},
): Promise<ListaColeta> =>
  ler(
    `${S}/coleta${qs({ data, unidade: f.unidade ? String(f.unidade) : null, de: f.de ?? null, ate: f.ate ?? null })}`,
    esquemaListaColeta,
  );
export const lerMapaTrabalho = (setor: string, data: string | null): Promise<MapaTrabalho> =>
  ler(`${S}/mapa-trabalho${qs({ setor, data })}`, esquemaMapaTrabalho);
export const listarAmostras = (data: string | null, estado: string | null): Promise<ListaAmostras> =>
  ler(`${S}/amostras${qs({ data, estado })}`, esquemaListaAmostras);
export const lerAmostraPorCodigo = (codigo: string): Promise<AmostraDetalhe> =>
  ler(`${S}/amostras/codigo/${encodeURIComponent(codigo)}`, esquemaAmostraDetalhe);
export const lerDigitacao = (id: number): Promise<ResultadoDigitacao> =>
  ler(`${S}/resultados/${id}/digitacao`, esquemaResultadoDigitacao);
export const listarLiberacao = (setor: string | null): Promise<ListaLiberacao> =>
  ler(`${S}/liberacao${qs({ setor })}`, esquemaListaLiberacao);
export const lerConferencia = (id: number): Promise<ItemLiberacao> =>
  ler(`${S}/resultados/${id}/conferencia`, esquemaItemLiberacao);
export const lerPainelCriticos = (inicio: string | null, fim: string | null): Promise<PainelCriticos> =>
  ler(`${S}/criticos${qs({ inicio, fim })}`, esquemaPainelCriticos);
export const listarValoresCriticos = (): Promise<ValorCriticoLido[]> =>
  ler(`${S}/valores-criticos`, z.array(esquemaValorCriticoLido));
export const listarElementos = (exame: string) =>
  ler(`${S}/valores-criticos/elementos${qs({ exame })}`, esquemaElementos);
export const listarLaudosDoExame = (exame: number) => ler(`${S}/laudos${qs({ exame })}`, esquemaLaudos);
export const conferirCodigoLaudo = (codigo: string) =>
  ler(
    `${S}/laudos/codigo/${encodeURIComponent(codigo.trim())}`,
    z.object({
      valido: z.boolean(),
      superado: z.boolean().optional(),
      numero: z.string().nullable(),
      emitidoEm: z.string().nullable(),
      exames: z.number(),
    }),
  );
export const lerParametrosSadt = (setor: string): Promise<ParametrosSadt> =>
  ler(`${S}/parametros${qs({ setor })}`, esquemaParametrosSadt);
export const lerIndicadoresSadt = (
  inicio: string | null,
  fim: string | null,
  setor: string | null,
): Promise<IndicadoresSadt> => ler(`${S}/indicadores${qs({ inicio, fim, setor })}`, esquemaIndicadoresSadt);
export const listarAutocadastros = (): Promise<AutocadastroLido[]> =>
  ler(`${S}/solicitantes/autocadastro`, z.array(esquemaAutocadastroLido));

// ── Gravações ─────────────────────────────────────────────────────────────────────────────────────
export const receberPedidos = (corpo: unknown, chave: string) => gravar(`${S}/exames/receber`, corpo, chave);
export const abrirRequisicao = (corpo: unknown, chave: string) => gravar(`${S}/requisicoes`, corpo, chave);
export const emitirProtocolo = (reg: number, chave: string) =>
  enviar(`${S}/requisicoes/${reg}/protocolo`, {}, esquemaProtocolo, chave);
export const criarOrcamento = (corpo: unknown, chave: string) => gravar(`${S}/orcamentos`, corpo, chave);
export const converterOrcamento = (id: number, corpo: unknown, chave: string) =>
  gravar(`${S}/orcamentos/${id}/converter`, corpo, chave);
export const coletarAmostra = (corpo: unknown, chave: string): Promise<ColetaRegistrada> =>
  enviar(`${S}/coleta`, corpo, esquemaColetaRegistrada, chave);
export const mudarEstadoAmostra = (id: number, corpo: unknown, chave: string): Promise<AmostraDetalhe> =>
  enviar(`${S}/amostras/${id}/estado`, corpo, esquemaAmostraDetalhe, chave);
export const registrarResultado = (id: number, corpo: unknown, chave: string) =>
  gravar(`${S}/resultados/${id}`, corpo, chave);
export const liberarResultado = (id: number, corpo: unknown, chave: string) =>
  gravar(`${S}/resultados/${id}/liberar`, corpo, chave);
export const retificarResultado = (id: number, corpo: unknown, chave: string) =>
  gravar(`${S}/resultados/${id}/retificar`, corpo, chave);
export const comunicarAviso = (id: number, corpo: unknown, chave: string) =>
  gravar(`${S}/criticos/${id}/comunicar`, corpo, chave);
export const gravarValorCritico = (corpo: unknown, chave: string) =>
  gravar(`${S}/valores-criticos`, corpo, chave);
export const emitirLaudo = (corpo: unknown, chave: string): Promise<LaudoEmitido> =>
  enviar(`${S}/laudos`, corpo, esquemaLaudoEmitido, chave);
export const decidirAutocadastro = (id: number, corpo: unknown, chave: string) =>
  gravar(`${S}/solicitantes/autocadastro/${id}`, corpo, chave);
export const cadastrarSolicitante = (corpo: unknown, chave: string) =>
  gravar(`${S}/solicitantes`, corpo, chave);

/** O PDF (base64) como arquivo do navegador por endereço blob: (nunca data:, que o navegador bloqueia). */
export function abrirPdf(base64: string, nome: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}
