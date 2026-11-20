// Cliente das telas do NIR (M44, etapa 2), validado pelos contratos. As gravações vão com o CSRF e a Idempotency-Key
// (uma por intenção de gravar); Problem Details viram ErroApi e o código da recusa (ex.: leito-reservado,
// leito-incompativel, solicitacao-desatualizada, ato-medico) fica em `problema.codigo` para a tela mostrar o texto certo.
import {
  type ConfiguracaoRegulacao,
  esquemaConfiguracaoRegulacao,
  esquemaTelaRegulacao,
  type TelaRegulacao,
  type AltasPrevistas,
  type Calibragem,
  type DeparaSituacoes,
  esquemaAltasPrevistas,
  esquemaCalibragem,
  esquemaDeparaSituacoes,
  esquemaFilaNir,
  esquemaGravacaoNir,
  esquemaLeitosCompativeis,
  esquemaOrigensNir,
  esquemaQuadroPermanencia,
  esquemaReservasNir,
  esquemaResultadoNir,
  type FilaNir,
  type GravacaoNir,
  type LeitosCompativeis,
  type OrigensNir,
  type QuadroPermanencia,
  type ReservasNir,
  type ResultadoNir,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const N = '/api/nir';
/** O canal do NIR (o mesmo aviso da internação e dos leitos: qualquer mudança relê). */
export const CANAL_NIR = `${N}/eventos`;

let sequencia = 0;
export function novaChaveNir(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m44n.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

const gravar = (url: string, corpo: unknown, chave: string): Promise<ResultadoNir> =>
  enviar(url, corpo, esquemaResultadoNir, chave);

export const lerGravacaoNir = (): Promise<GravacaoNir & { medico: boolean }> =>
  ler(`${N}/gravacao`, esquemaGravacaoNir.extend({ medico: z.boolean() }));
export const lerFilaNir = (): Promise<FilaNir> => ler(`${N}/fila`, esquemaFilaNir);
export const lerOrigensNir = (): Promise<OrigensNir> => ler(`${N}/origens`, esquemaOrigensNir);
export const lerLeitosCompativeis = (id: number): Promise<LeitosCompativeis> =>
  ler(`${N}/solicitacoes/${id}/leitos`, esquemaLeitosCompativeis);
export const lerReservasNir = (): Promise<ReservasNir> => ler(`${N}/reservas`, esquemaReservasNir);
export const lerAltasPrevistas = (): Promise<AltasPrevistas> =>
  ler(`${N}/altas-previstas`, esquemaAltasPrevistas);
export const lerPermanencia = (): Promise<QuadroPermanencia> =>
  ler(`${N}/permanencia`, esquemaQuadroPermanencia);
export const lerCalibragem = (escopo: string): Promise<Calibragem> =>
  ler(`${N}/permanencia/calibragem${qs({ escopo })}`, esquemaCalibragem);
export const lerSituacoesNir = (): Promise<DeparaSituacoes> => ler(`${N}/situacoes`, esquemaDeparaSituacoes);

export const solicitarLeito = (corpo: unknown, chave: string) => gravar(`${N}/solicitacoes`, corpo, chave);
export const transicionarSolicitacao = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/solicitacoes/${id}/transicoes`, corpo, chave);
export const reservarLeito = (corpo: unknown, chave: string) => gravar(`${N}/reservas`, corpo, chave);
export const confirmarReserva = (id: number, chave: string) =>
  gravar(`${N}/reservas/${id}/confirmar`, {}, chave);
export const cancelarReserva = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/reservas/${id}/cancelar`, corpo, chave);
export const registrarDpa = (corpo: unknown, chave: string) => gravar(`${N}/dpa`, corpo, chave);
export const registrarBarreira = (corpo: unknown, chave: string) => gravar(`${N}/barreiras`, corpo, chave);
export const resolverBarreira = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/barreiras/${id}/resolver`, corpo, chave);
export const definirLimite = (corpo: unknown, chave: string) => gravar(`${N}/limites`, corpo, chave);
export const aprovarSituacao = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/situacoes/${id}/aprovar`, corpo, chave);

// ── M44 (etapa 3): regulação estadual ──

export const lerRegulacao = (): Promise<TelaRegulacao> => ler(`${N}/regulacao`, esquemaTelaRegulacao);
export const lerConfiguracaoRegulacao = (): Promise<ConfiguracaoRegulacao> =>
  ler(`${N}/regulacao/configuracao`, esquemaConfiguracaoRegulacao);
export const registrarRegulacao = (corpo: unknown, chave: string): Promise<ResultadoNir> =>
  enviar(`${N}/regulacao`, corpo, esquemaResultadoNir, chave);

// ── W0-07 (programa CRUD completo): correção, alteração e exclusão; todas com o motivo ──
export const corrigirSolicitacao = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/solicitacoes/${id}/corrigir`, corpo, chave);
/** Operação crítica: o corpo leva a senha (reautenticação no diálogo). */
export const excluirSolicitacao = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/solicitacoes/${id}/excluir`, corpo, chave);
export const alterarReserva = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/reservas/${id}/alterar`, corpo, chave);
export const excluirReserva = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/reservas/${id}/excluir`, corpo, chave);
export const retirarDpa = (corpo: unknown, chave: string) => gravar(`${N}/dpa/retirar`, corpo, chave);
export const alterarBarreira = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/barreiras/${id}/alterar`, corpo, chave);
export const encerrarBarreira = (id: number, corpo: unknown, chave: string) =>
  gravar(`${N}/barreiras/${id}/encerrar`, corpo, chave);
export const removerLimite = (corpo: unknown, chave: string) => gravar(`${N}/limites/remover`, corpo, chave);
