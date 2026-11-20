// Cliente das telas das especialidades sob demanda e do lactário (M45, etapa 6; DP-32), validado pelos contratos. As
// gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e o código
// da recusa (ex.: dose-divergente, conferente-e-preparador) fica em `problema.codigo`.
import {
  esquemaDependenciasProtocolo,
  type DependenciasProtocolo,
  type CadastrosOftalmologia,
  esquemaCadastrosOftalmologia,
  esquemaEtiquetasLactario,
  esquemaFilaValidacaoOnco,
  esquemaGravacaoEspecialidade,
  esquemaListaInternacoesEspecialidade,
  esquemaObstetriciaPaciente,
  esquemaOftalmologiaPaciente,
  esquemaOncologiaPaciente,
  esquemaPrescricoesDoCiclo,
  esquemaProducaoLactario,
  esquemaProtocolosOncologicos,
  esquemaResultadoEspecialidade,
  type EtiquetasLactario,
  type FilaValidacaoOnco,
  type GravacaoEspecialidade,
  type ListaInternacoesEspecialidade,
  type ObstetriciaPaciente,
  type OftalmologiaPaciente,
  type OncologiaPaciente,
  type PrescricoesDoCiclo,
  type ProducaoLactario,
  type ProtocolosOncologicos,
  type ResultadoEspecialidade,
} from '@sgh/contratos';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

export type NomeEspecialidade = 'oftalmologia' | 'oncologia' | 'obstetricia' | 'lactario';

const E = '/api/especialidades';
const L = '/api/nutricao/lactario';
const base = (nome: NomeEspecialidade) => (nome === 'lactario' ? L : `${E}/${nome}`);

let sequencia = 0;
export function novaChaveEspecialidade(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m45e.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export const lerGravacaoEspecialidade = (nome: NomeEspecialidade): Promise<GravacaoEspecialidade> =>
  ler(`${base(nome)}/gravacao`, esquemaGravacaoEspecialidade);
export const lerInternacoesEspecialidade = (
  nome: NomeEspecialidade,
  termo: string,
): Promise<ListaInternacoesEspecialidade> =>
  ler(`${base(nome)}/internacoes${qs({ termo: termo || null })}`, esquemaListaInternacoesEspecialidade);

export const lerCadastrosOftalmologia = (): Promise<CadastrosOftalmologia> =>
  ler(`${E}/oftalmologia/cadastros`, esquemaCadastrosOftalmologia);
export const lerOftalmologia = (reg: number): Promise<OftalmologiaPaciente> =>
  ler(`${E}/oftalmologia/internacoes/${reg}`, esquemaOftalmologiaPaciente);
export const registrarExameOftalmologico = (corpo: unknown, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${E}/oftalmologia/exames`, corpo, esquemaResultadoEspecialidade, chave);

export const lerProtocolos = (): Promise<ProtocolosOncologicos> =>
  ler(`${E}/oncologia/protocolos`, esquemaProtocolosOncologicos);
export const publicarProtocolo = (corpo: unknown, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${E}/oncologia/protocolos`, corpo, esquemaResultadoEspecialidade, chave);
export const lerOncologia = (reg: number): Promise<OncologiaPaciente> =>
  ler(`${E}/oncologia/internacoes/${reg}`, esquemaOncologiaPaciente);
export const registrarCiclo = (corpo: unknown, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${E}/oncologia/ciclos`, corpo, esquemaResultadoEspecialidade, chave);
export const lerPrescricoesDoCiclo = (id: number): Promise<PrescricoesDoCiclo> =>
  ler(`${E}/oncologia/ciclos/${id}/prescricoes`, esquemaPrescricoesDoCiclo);
export const vincularPrescricao = (
  id: number,
  corpo: unknown,
  chave: string,
): Promise<ResultadoEspecialidade> =>
  enviar(`${E}/oncologia/ciclos/${id}/prescricoes`, corpo, esquemaResultadoEspecialidade, chave);
export const lerFilaValidacao = (): Promise<FilaValidacaoOnco> =>
  ler(`${E}/oncologia/validacao`, esquemaFilaValidacaoOnco);
export const validarCiclo = (id: number, corpo: unknown, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${E}/oncologia/ciclos/${id}/validar`, corpo, esquemaResultadoEspecialidade, chave);

export const lerObstetricia = (reg: number): Promise<ObstetriciaPaciente> =>
  ler(`${E}/obstetricia/internacoes/${reg}`, esquemaObstetriciaPaciente);
export const registrarPartograma = (corpo: unknown, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${E}/obstetricia/partograma`, corpo, esquemaResultadoEspecialidade, chave);
export const registrarRecemNascido = (corpo: unknown, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${E}/obstetricia/recem-nascidos`, corpo, esquemaResultadoEspecialidade, chave);

export const lerLactario = (data: string | null): Promise<ProducaoLactario> =>
  ler(`${L}${qs({ data })}`, esquemaProducaoLactario);
export const registrarOrdemLactario = (corpo: unknown, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${L}/ordens`, corpo, esquemaResultadoEspecialidade, chave);
export const conferirOrdemLactario = (id: number, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${L}/ordens/${id}/conferir`, {}, esquemaResultadoEspecialidade, chave);
export const gerarEtiquetasLactario = (id: number, chave: string): Promise<EtiquetasLactario> =>
  enviar(`${L}/ordens/${id}/etiquetas`, {}, esquemaEtiquetasLactario, chave);

// ── W0-05: o ciclo de vida do protocolo e do ciclo; a alteração e o cancelamento da ordem do lactário ──

const O = `${E}/oncologia`;
export const lerDependenciasProtocolo = (id: number): Promise<DependenciasProtocolo> =>
  ler(`${O}/protocolos/${id}/dependencias`, esquemaDependenciasProtocolo);
/** Crítica: com a senha de novo; com ciclos em andamento, só com a ciência (senão 409 com a lista). */
export const revogarVersaoProtocolo = (
  id: number,
  corpo: unknown,
  chave: string,
): Promise<ResultadoEspecialidade> =>
  enviar(`${O}/protocolos/${id}/revogar`, corpo, esquemaResultadoEspecialidade, chave);
/** A inativação é crítica (senha de novo); a reativação, não. */
export const mudarProtocolo = (
  id: number,
  acao: 'inativar' | 'reativar',
  corpo: unknown,
  chave: string,
): Promise<ResultadoEspecialidade> =>
  enviar(`${O}/protocolos/${id}/${acao}`, corpo, esquemaResultadoEspecialidade, chave);
export const ajustarCiclo = (id: number, corpo: unknown, chave: string): Promise<ResultadoEspecialidade> =>
  enviar(`${O}/ciclos/${id}/ajustar`, corpo, esquemaResultadoEspecialidade, chave);
/** Suspender e cancelar pedem a categoria e o motivo; cancelar é crítico (senha de novo); retomar, só o motivo. */
export const mudarAndamentoCiclo = (
  id: number,
  acao: 'suspender' | 'retomar' | 'cancelar',
  corpo: unknown,
  chave: string,
): Promise<ResultadoEspecialidade> =>
  enviar(`${O}/ciclos/${id}/${acao}`, corpo, esquemaResultadoEspecialidade, chave);
export const desligarPrescricao = (
  id: number,
  prescricao: number,
  motivo: string,
  chave: string,
): Promise<ResultadoEspecialidade> =>
  enviar(
    `${O}/ciclos/${id}/prescricoes/${prescricao}/desligar`,
    { motivo },
    esquemaResultadoEspecialidade,
    chave,
  );
export const alterarOrdemLactario = (
  id: number,
  corpo: unknown,
  chave: string,
): Promise<ResultadoEspecialidade> =>
  enviar(`${L}/ordens/${id}/alterar`, corpo, esquemaResultadoEspecialidade, chave);
export const cancelarOrdemLactario = (
  id: number,
  motivo: string,
  chave: string,
): Promise<ResultadoEspecialidade> =>
  enviar(`${L}/ordens/${id}/cancelar`, { motivo }, esquemaResultadoEspecialidade, chave);
