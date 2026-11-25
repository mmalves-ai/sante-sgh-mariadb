// Ocorrência na entrega da refeição (F8, 04-HOT linha 143): o que a copa registra sobre a bandeja do mapa de dietas
// fechado (recusa, troca, atraso, paciente ausente, dieta errada) e a providência do serviço de nutrição que a resolve.
//
// Regras (função pura, nada de banco):
//   - a ocorrência é sobre a linha do mapa fechado; a linha cancelada não recebe ocorrência;
//   - a descrição é a justificativa: obrigatória (mínimo de 10 caracteres) quando o tipo exige; sem exigência, vazia
//     vira a descrição do tipo;
//   - o momento da ocorrência não fica no futuro (tolerância de 5 minutos para o relógio do aparelho) nem antes da véspera
//     do dia do mapa;
//   - o tipo fora de uso não é usado em ocorrência nova;
//   - resolver pede a providência (mínimo de 5 caracteres), uma vez só (registro nunca reescrito), em momento não
//     anterior ao da ocorrência; o tipo que gera reposição avisa que a nova refeição tem de ser servida.

export interface TipoOcorrenciaRefeicao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly geraReposicao: boolean;
  readonly exigeJustificativa: boolean;
  readonly ativo: boolean;
}

export interface ProblemaOcorrenciaRefeicao {
  readonly campo: string;
  readonly mensagem: string;
}

export const JUSTIFICATIVA_MINIMA_OCORRENCIA_REFEICAO = 10;
export const PROVIDENCIA_MINIMA_OCORRENCIA_REFEICAO = 5;
const TOLERANCIA_FUTURO_MS = 5 * 60_000;
const DIA_MS = 86_400_000;

export interface EntradaOcorrenciaRefeicao {
  readonly tipo: TipoOcorrenciaRefeicao;
  readonly descricao: string | null;
  /** Instante da ocorrência (Date). */
  readonly ocorridoEm: Date;
  /** Agora (Date), pelo relógio do servidor. */
  readonly agora: Date;
  /** AAAA-MM-DD: o dia do mapa. */
  readonly dataMapa: string;
  /** Situação da linha do mapa. */
  readonly situacaoLinha: string;
}

export interface OcorrenciaRefeicaoValidada {
  readonly descricao: string;
  readonly reposicao: boolean;
}

export function validarOcorrenciaRefeicao(
  e: EntradaOcorrenciaRefeicao,
): { ok: true; valor: OcorrenciaRefeicaoValidada } | { ok: false; problemas: ProblemaOcorrenciaRefeicao[] } {
  const problemas: ProblemaOcorrenciaRefeicao[] = [];
  if (!e.tipo.ativo)
    problemas.push({ campo: 'tipo', mensagem: 'O tipo de ocorrência está fora de uso: escolha outro.' });
  if (e.situacaoLinha === 'cancelado')
    problemas.push({
      campo: 'internacao',
      mensagem: 'A refeição deste paciente foi cancelada no mapa: não há entrega para registrar ocorrência.',
    });
  const texto = (e.descricao ?? '').trim();
  if (e.tipo.exigeJustificativa && texto.length < JUSTIFICATIVA_MINIMA_OCORRENCIA_REFEICAO)
    problemas.push({
      campo: 'descricao',
      mensagem: `Este tipo de ocorrência exige a justificativa (mínimo de ${JUSTIFICATIVA_MINIMA_OCORRENCIA_REFEICAO} caracteres).`,
    });
  if (e.ocorridoEm.getTime() > e.agora.getTime() + TOLERANCIA_FUTURO_MS)
    problemas.push({ campo: 'ocorridoEm', mensagem: 'O momento da ocorrência não pode estar no futuro.' });
  const inicioMapa = Date.parse(`${e.dataMapa}T00:00:00Z`);
  if (Number.isFinite(inicioMapa) && e.ocorridoEm.getTime() < inicioMapa - DIA_MS)
    problemas.push({
      campo: 'ocorridoEm',
      mensagem: 'O momento da ocorrência é anterior ao dia do mapa desta refeição.',
    });
  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    valor: { descricao: texto || e.tipo.descricao, reposicao: e.tipo.geraReposicao },
  };
}

export interface EntradaResolucaoOcorrenciaRefeicao {
  readonly resolvida: boolean;
  readonly providencia: string | null;
  readonly ocorridoEm: Date;
  readonly agora: Date;
}

export function validarResolucaoOcorrencia(
  e: EntradaResolucaoOcorrenciaRefeicao,
): ProblemaOcorrenciaRefeicao[] {
  const problemas: ProblemaOcorrenciaRefeicao[] = [];
  if (e.resolvida)
    problemas.push({
      campo: 'versao',
      mensagem: 'A ocorrência já foi resolvida: a resolução não é reescrita.',
    });
  if ((e.providencia ?? '').trim().length < PROVIDENCIA_MINIMA_OCORRENCIA_REFEICAO)
    problemas.push({
      campo: 'providencia',
      mensagem: `Descreva a providência tomada (mínimo de ${PROVIDENCIA_MINIMA_OCORRENCIA_REFEICAO} caracteres).`,
    });
  if (e.agora.getTime() < e.ocorridoEm.getTime())
    problemas.push({
      campo: 'ocorridoEm',
      mensagem: 'A ocorrência está registrada para depois de agora: confira o momento antes de resolver.',
    });
  return problemas;
}
