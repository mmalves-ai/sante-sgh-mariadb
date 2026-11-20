// O ciclo do evento e do lote do eSocial (M53-F5): que transição vale, quem pode entrar num lote, que ambiente o lote
// usa (regra 3: fora de `producao` só o coletor) e quando o envio é permitido. Regras puras.
import {
  type AmbienteEsocial,
  definicaoEventoEsocial,
  type EventoEsocial,
  type GrupoEventoEsocial,
  type SituacaoEventoEsocial,
  TETO_EVENTOS_LOTE_ESOCIAL,
} from '@sgh/contratos';

const TRANSICOES: Readonly<Record<SituacaoEventoEsocial, readonly SituacaoEventoEsocial[]>> = {
  gerado: ['validado', 'invalido', 'descartado'],
  invalido: ['descartado'],
  validado: ['em-lote', 'descartado'],
  'em-lote': ['enviado', 'validado'],
  enviado: ['aceito', 'rejeitado'],
  aceito: ['excluido', 'substituido'],
  rejeitado: ['descartado'],
  excluido: [],
  descartado: [],
  substituido: [],
};

export const podeTransitar = (de: SituacaoEventoEsocial, para: SituacaoEventoEsocial): boolean =>
  TRANSICOES[de].includes(para);

/** Situações em que o evento ainda conta como "do Sante SGH" na competência (conciliação). */
export const SITUACOES_TRANSMITIDAS: readonly SituacaoEventoEsocial[] = [
  'enviado',
  'aceito',
  'substituido',
  'excluido',
];

/** Situações que impedem gerar outro evento original para a mesma origem (só retificação ou exclusão). */
export const SITUACOES_EM_VIGOR: readonly SituacaoEventoEsocial[] = [
  'gerado',
  'validado',
  'em-lote',
  'enviado',
  'aceito',
];

export interface EventoParaLote {
  readonly id: number;
  readonly empresa: number;
  readonly evento: EventoEsocial;
  readonly situacao: SituacaoEventoEsocial;
}

export type ConferenciaLote =
  | { readonly ok: true; readonly grupo: GrupoEventoEsocial }
  | {
      readonly ok: false;
      readonly codigo: 'lote-vazio' | 'lote-misto' | 'situacao-invalida';
      readonly ids: readonly number[];
    };

/** O lote tem de 1 a 50 eventos validados, do mesmo empregador e do mesmo grupo. */
export function conferirLote(empresa: number, eventos: readonly EventoParaLote[]): ConferenciaLote {
  if (eventos.length === 0 || eventos.length > TETO_EVENTOS_LOTE_ESOCIAL)
    return { ok: false, codigo: 'lote-vazio', ids: [] };
  const fora = eventos.filter((e) => e.situacao !== 'validado').map((e) => e.id);
  if (fora.length) return { ok: false, codigo: 'situacao-invalida', ids: fora };
  const grupos = new Set(eventos.map((e) => definicaoEventoEsocial(e.evento).grupo));
  const outraEmpresa = eventos.filter((e) => e.empresa !== empresa).map((e) => e.id);
  if (grupos.size > 1 || outraEmpresa.length) return { ok: false, codigo: 'lote-misto', ids: outraEmpresa };
  return { ok: true, grupo: [...grupos][0]! };
}

/** O ambiente do lote: fora de `producao`, sempre o coletor local (regra 3). */
export const ambienteDoLote = (ambienteSistema: string): AmbienteEsocial =>
  ambienteSistema === 'producao' ? 'producao' : 'coletor';

/** O tpAmb do XML: 1 só em produção; o coletor recebe como produção restrita. */
export const tpAmbDoAmbiente = (a: AmbienteEsocial): 1 | 2 => (a === 'producao' ? 1 : 2);

export type DecisaoEnvio =
  | { readonly ok: true; readonly ambiente: AmbienteEsocial }
  | {
      readonly ok: false;
      readonly codigo: 'envio-desligado' | 'transmissor-real-indisponivel';
      readonly motivo: string;
    };

/**
 * D-COLETOR-536 (POL-5): fora de `producao` o lote vai ao coletor (nada sai da máquina) e não depende da chave, para o
 * departamento pessoal ensaiar o ciclo inteiro; em `producao` exige a chave `pessoas.esocial` ligada (com o certificado
 * do empregador como pré-requisito) e o cliente do serviço do eSocial, que entra completo e desligado (POL-3).
 */
export function decidirEnvio(
  ambienteSistema: string,
  chaveLigada: boolean,
  transmissorRealDisponivel: boolean,
): DecisaoEnvio {
  const ambiente = ambienteDoLote(ambienteSistema);
  if (ambiente === 'coletor') return { ok: true, ambiente };
  if (!chaveLigada)
    return {
      ok: false,
      codigo: 'envio-desligado',
      motivo: 'A transmissão ao eSocial está desligada (liberação com o certificado digital do empregador).',
    };
  if (!transmissorRealDisponivel)
    return {
      ok: false,
      codigo: 'transmissor-real-indisponivel',
      motivo: 'O envio ao serviço do eSocial ainda não está disponível neste ambiente.',
    };
  return { ok: true, ambiente };
}
