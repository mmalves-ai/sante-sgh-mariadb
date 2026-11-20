// Cliente das telas da classificação de risco no PA (M44, etapa 1), validado pelos contratos. As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e o código da recusa fica em
// `problema.codigo` para a tela mostrar o texto certo.
import {
  esquemaGerenciadoComConteudo,
  esquemaRelogioProtocolos,
  esquemaResultadoProtocoloGerenciado,
  type GerenciadoComConteudo,
  type RelogioProtocolos,
  type ResultadoProtocoloGerenciado,
  type CorLegadoConsulta,
  esquemaCorLegadoConsulta,
  esquemaFilaClassificacao,
  esquemaIndicadoresClassificacao,
  esquemaProtocoloComConteudo,
  esquemaResultadoClassificacao,
  esquemaResultadoSimulacaoProtocolo,
  esquemaTelaClassificacao,
  esquemaVersaoProtocoloResumo,
  type FilaClassificacao,
  type IndicadoresClassificacaoPa,
  type ProtocoloComConteudo,
  type ResultadoClassificacao,
  type ResultadoSimulacaoProtocolo,
  type TelaClassificacao,
  type VersaoProtocoloResumo,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const PA = '/api/pa';
/** O canal do quadro do PA (M20): a classificação gravada também avisa por ele. */
export const CANAL_CLASSIFICACAO = `${PA}/quadro/eventos`;

let sequencia = 0;
export function novaChaveClassificacao(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m44.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export const lerFilaClassificacao = (): Promise<FilaClassificacao> =>
  ler(`${PA}/classificacao/fila`, esquemaFilaClassificacao);
export const lerTelaClassificacao = (reg: number): Promise<TelaClassificacao> =>
  ler(`${PA}/classificacao/${reg}`, esquemaTelaClassificacao);
export const lerIndicadoresClassificacao = (
  inicio: string | null,
  fim: string | null,
): Promise<IndicadoresClassificacaoPa> =>
  ler(`${PA}/classificacao/indicadores${qs({ inicio, fim })}`, esquemaIndicadoresClassificacao);
export const lerVersoesProtocolo = (): Promise<VersaoProtocoloResumo[]> =>
  ler(`${PA}/protocolos`, z.array(esquemaVersaoProtocoloResumo));
export const lerVersaoProtocolo = (id: number): Promise<ProtocoloComConteudo> =>
  ler(`${PA}/protocolos/${id}`, esquemaProtocoloComConteudo);
export const lerCoresAnteriores = (): Promise<CorLegadoConsulta[]> =>
  ler(`${PA}/cores-legado`, z.array(esquemaCorLegadoConsulta));

export const classificar = (reg: number, corpo: unknown, chave: string): Promise<ResultadoClassificacao> =>
  enviar(`${PA}/classificacao/${reg}`, corpo, esquemaResultadoClassificacao, chave);
export const reclassificar = (reg: number, corpo: unknown, chave: string): Promise<ResultadoClassificacao> =>
  enviar(`${PA}/classificacao/${reg}/reclassificar`, corpo, esquemaResultadoClassificacao, chave);
export const registrarSinaisTriagem = (reg: number, corpo: unknown, chave: string) =>
  enviar(
    `${PA}/classificacao/${reg}/sinais`,
    corpo,
    z.object({ registrados: z.number(), mensagem: z.string() }),
    chave,
  );
export const simularProtocolo = (corpo: unknown): Promise<ResultadoSimulacaoProtocolo> =>
  enviar(
    `${PA}/protocolos/simular`,
    corpo,
    esquemaResultadoSimulacaoProtocolo,
    novaChaveClassificacao('simular'),
  );
export const publicarProtocolo = (corpo: unknown, chave: string) =>
  enviar(
    `${PA}/protocolos`,
    corpo,
    z.object({ id: z.number(), protocolo: z.number(), versao: z.number(), mensagem: z.string() }),
    chave,
  );

// ── M44 (etapa 3): protocolos gerenciados ──

const GER = `${PA}/protocolos-gerenciados`;
export const lerRelogioProtocolos = (): Promise<RelogioProtocolos> =>
  ler(`${GER}/relogio`, esquemaRelogioProtocolos);
export const lerDefinicoesGerenciadas = (): Promise<GerenciadoComConteudo[]> =>
  ler(`${GER}/definicoes`, z.array(esquemaGerenciadoComConteudo));
export const publicarDefinicaoGerenciada = (corpo: unknown, chave: string) =>
  enviar(
    `${GER}/definicoes`,
    corpo,
    z.object({ id: z.number(), versao: z.number(), mensagem: z.string() }),
    chave,
  );
export const iniciarProtocoloGerenciado = (
  corpo: unknown,
  chave: string,
): Promise<ResultadoProtocoloGerenciado> => enviar(GER, corpo, esquemaResultadoProtocoloGerenciado, chave);
export const registrarMetaProtocolo = (
  id: number,
  corpo: unknown,
  chave: string,
): Promise<ResultadoProtocoloGerenciado> =>
  enviar(`${GER}/${id}/metas`, corpo, esquemaResultadoProtocoloGerenciado, chave);
export const encerrarProtocoloGerenciado = (
  id: number,
  corpo: unknown,
  chave: string,
): Promise<ResultadoProtocoloGerenciado> =>
  enviar(`${GER}/${id}/encerrar`, corpo, esquemaResultadoProtocoloGerenciado, chave);
