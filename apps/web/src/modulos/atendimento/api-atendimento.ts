// Cliente das telas do atendimento externo e do pronto atendimento (M20), validado pelos contratos. As gravações vão
// com o CSRF e a Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e o código da recusa
// (ex.: conta-fechada, ato-medico) fica em `problema.codigo` para a tela mostrar o texto certo.
import {
  type ApoioAtendimento,
  type AtendimentoDetalhe,
  type AtendimentosDia,
  type ConfiguracaoHeranca,
  type EscoresPaDoAtendimento,
  esquemaApoioAtendimento,
  esquemaAtendimentoDetalhe,
  esquemaAtendimentosDia,
  esquemaConfiguracaoHeranca,
  esquemaEscoresPaDoAtendimento,
  esquemaFilaConsultorio,
  esquemaGravacaoAtendimento,
  esquemaHerancaPaciente,
  esquemaImpressoGerado,
  esquemaImpressosAtendimento,
  esquemaIndicadoresAtendimento,
  esquemaMarcacaoAbertura,
  esquemaObservacaoPa,
  esquemaPreviaCancelamento,
  esquemaQuadroPa,
  esquemaResultadoAtendimento,
  type FilaConsultorio,
  type GravacaoAtendimento,
  type HerancaPaciente,
  type ImpressoGerado,
  type ImpressosAtendimento,
  type IndicadoresAtendimento,
  type MarcacaoAbertura,
  type ObservacaoPa,
  type PreviaCancelamento,
  type QuadroPa,
  type ResultadoAtendimento,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const A = '/api/atendimento';
const PA = '/api/pa';

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m20.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

const gravar = (url: string, corpo: unknown, chave: string): Promise<ResultadoAtendimento> =>
  enviar(url, corpo, esquemaResultadoAtendimento, chave);

const esquemaCid = z.array(z.object({ id: z.number(), codigo: z.string(), nome: z.string() }));
const esquemaSolicitantes = z.array(z.object({ id: z.number(), nome: z.string(), registro: z.string() }));
const esquemaProcedimentos = z.array(z.object({ codigo: z.number(), nome: z.string() }));
const esquemaNaoIdentificados = z.array(
  z.object({
    paciente: z.number(),
    prontuario: z.number(),
    caracteristicas: z.string(),
    marcadoEm: z.string(),
    identificadoEm: z.string().nullable(),
  }),
);
export type NaoIdentificado = z.infer<typeof esquemaNaoIdentificados>[number];

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────
export const lerGravacaoAtendimento = (): Promise<GravacaoAtendimento> =>
  ler(`${A}/gravacao`, esquemaGravacaoAtendimento);
export const lerApoioAtendimento = (): Promise<ApoioAtendimento> =>
  ler(`${A}/apoio`, esquemaApoioAtendimento);
export const listarAtendimentosDia = (f: {
  data?: string | null;
  unidade?: number | null;
  local?: number | null;
  termo?: string | null;
  requisicoes?: boolean;
}): Promise<AtendimentosDia> =>
  ler(
    `${A}/dia${qs({
      data: f.data ?? null,
      unidade: f.unidade ?? null,
      local: f.local ?? null,
      termo: f.termo?.trim() ? f.termo.trim() : null,
      requisicoes: f.requisicoes ? 'sim' : null,
    })}`,
    esquemaAtendimentosDia,
  );
/** O agendamento do dia que a abertura preenche (a leitura vai à trilha). */
export const lerMarcacaoAtendimento = (id: number): Promise<MarcacaoAbertura> =>
  ler(`${A}/marcacoes/${id}`, esquemaMarcacaoAbertura);
/** Os canais de eventos (só avisam que mudou; a tela relê). */
export const CANAL_FILA = `${A}/fila/eventos`;
export const CANAL_QUADRO = `${PA}/quadro/eventos`;
export const lerAtendimento = (reg: number): Promise<AtendimentoDetalhe> =>
  ler(`${A}/${reg}`, esquemaAtendimentoDetalhe);
export const lerFilaConsultorio = (local: number | null, todos = false): Promise<FilaConsultorio> =>
  ler(`${A}/fila${qs({ local, todos: todos ? 'sim' : null })}`, esquemaFilaConsultorio);
export const lerPreviaCancelamento = (reg: number): Promise<PreviaCancelamento> =>
  ler(`${A}/${reg}/cancelamento`, esquemaPreviaCancelamento);
export const lerImpressos = (reg: number): Promise<ImpressosAtendimento> =>
  ler(`${A}/${reg}/impressos`, esquemaImpressosAtendimento);
export const lerIndicadoresAtendimento = (
  inicio: string,
  fim: string,
  unidade: number | null = null,
): Promise<IndicadoresAtendimento> =>
  ler(`${A}/indicadores${qs({ inicio, fim, unidade })}`, esquemaIndicadoresAtendimento);
export const buscarCid = (termo: string) => ler(`${A}/busca/cid${qs({ termo })}`, esquemaCid);
export const buscarSolicitantesAtendimento = (termo: string) =>
  ler(`${A}/busca/solicitantes${qs({ termo })}`, esquemaSolicitantes);
export const buscarProcedimentosAtendimento = (convenio: number, termo: string) =>
  ler(`${A}/busca/procedimentos${qs({ convenio, termo })}`, esquemaProcedimentos);
export const lerHistoricoPaciente = (paciente: number): Promise<HerancaPaciente> =>
  ler(`${A}/pacientes/${paciente}/historico`, esquemaHerancaPaciente);
export const lerConfiguracaoHeranca = (): Promise<ConfiguracaoHeranca> =>
  ler(`${A}/heranca`, esquemaConfiguracaoHeranca);
export const listarNaoIdentificados = () => ler(`${A}/nao-identificados`, esquemaNaoIdentificados);
export const lerQuadroPa = (): Promise<QuadroPa> => ler(`${PA}/quadro`, esquemaQuadroPa);
export const lerObservacaoPa = (): Promise<ObservacaoPa> => ler(`${PA}/observacao`, esquemaObservacaoPa);

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────
export const abrirAtendimento = (p: unknown, k: string) => gravar(A, p, k);
export const alterarSegurado = (reg: number, p: unknown, k: string) => gravar(`${A}/${reg}/segurado`, p, k);
export const lancarProcedimento = (reg: number, p: unknown, k: string) =>
  gravar(`${A}/${reg}/procedimentos`, p, k);
/** W1-05: correção da ficha aberta (só os campos que mudam, a justificativa e o carimbo lido). */
export const alterarAtendimento = (reg: number, p: unknown, k: string) => gravar(`${A}/${reg}/alterar`, p, k);
/** W1-05: correção da quantidade e/ou da data do procedimento extra, com a conta aberta. */
export const corrigirProcedimentoExtra = (reg: number, seq: number, p: unknown, k: string) =>
  gravar(`${A}/${reg}/procedimentos/${seq}/corrigir`, p, k);
/** W1-05: estorno do procedimento extra lançado por engano (justificativa e a senha de novo). */
export const estornarProcedimentoExtra = (reg: number, seq: number, p: unknown, k: string) =>
  gravar(`${A}/${reg}/procedimentos/${seq}/estornar`, p, k);
export const conduzirNoConsultorio = (reg: number, p: unknown, k: string) =>
  gravar(`${A}/${reg}/consultorio`, p, k);
export const encerrarAtendimento = (reg: number, p: unknown, k: string) =>
  gravar(`${A}/${reg}/encerrar`, p, k);
export const cancelarAtendimento = (reg: number, p: unknown, k: string) =>
  gravar(`${A}/${reg}/cancelar`, p, k);
export const alterarHeranca = (p: unknown, k: string) => gravar(`${A}/heranca`, p, k);
export const marcarNaoIdentificado = (paciente: number, p: unknown, k: string) =>
  gravar(`${A}/pacientes/${paciente}/nao-identificado`, p, k);
export const identificarPaciente = (paciente: number, destino: number, k: string) =>
  gravar(`${A}/pacientes/${paciente}/identificar`, { destino }, k);
export const emitirImpresso = (reg: number, p: unknown, k: string): Promise<ImpressoGerado> =>
  enviar(`${A}/${reg}/impressos`, p, esquemaImpressoGerado, k);
export const registrarEtapaPa = (reg: number, p: unknown, k: string) => gravar(`${PA}/${reg}/etapa`, p, k);
export const alocarObservacao = (reg: number, p: unknown, k: string) =>
  gravar(`${PA}/${reg}/observacao`, p, k);
export const liberarObservacao = (reg: number, p: unknown, k: string) =>
  gravar(`${PA}/${reg}/observacao/liberar`, p, k);
/** W0-07: troca de leito na observação numa operação só (liberar e alocar na mesma transação), com o motivo. */
export const transferirObservacao = (reg: number, p: unknown, k: string) =>
  gravar(`${PA}/${reg}/observacao/transferir`, p, k);
export const registrarDesfechoPa = (reg: number, p: unknown, k: string) =>
  gravar(`${PA}/${reg}/desfecho`, p, k);

// W0-07 (M1): o alerta de deterioração e de sepse no PA (NEWS2, qSOFA e SIRS calculados no servidor).
export const lerEscoresPa = (reg: number): Promise<EscoresPaDoAtendimento> =>
  ler(`${PA}/${reg}/escores`, esquemaEscoresPaDoAtendimento);
export const registrarEscorePa = (reg: number, p: unknown, k: string) => gravar(`${PA}/${reg}/escores`, p, k);
export const estornarEscorePa = (reg: number, p: unknown, k: string) =>
  gravar(`${PA}/${reg}/escores/estornar`, p, k);
