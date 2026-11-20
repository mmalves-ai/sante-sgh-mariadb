// Ouvidoria, SAC e pesquisa de satisfação (M48, etapa 5; manual m17; D-PESQ-50: as respostas da pesquisa do portal
// ficam na tabela do portal e a ouvidoria as lê). A manifestação tem protocolo, prazo de resposta em dias úteis do
// calendário do estabelecimento (D-PRAZO-OUV-48.5) e o ciclo aberta → encaminhada → respondida. O NPS sai com as
// parcelas (promotores 9 e 10; neutros 7 e 8; detratores 0 a 6).
import {
  DIAS_UTEIS_RESPOSTA_OUVIDORIA,
  type ManifestacaoLida,
  type NpsCompetencia,
  type SituacaoManifestacao,
} from '@sgh/contratos';
import { diaUtil, msLocal } from '../nsp/prazos.js';
import { noFuturo, numeroBr, somarDiasData } from './comum.js';

/** Antecedência do aviso "vencendo" (um dia antes do prazo). */
const AVISO_MS = 24 * 3_600_000;

/** O protocolo da manifestação: OUV-AAAA-NNNNNN (o número é o da sequência do banco). */
export function protocoloManifestacao(recebidaEm: string, numero: number): string {
  return `OUV-${recebidaEm.slice(0, 4)}-${String(numero % 1_000_000).padStart(6, '0')}`;
}

/** O prazo da resposta: o fim do décimo dia útil depois do recebimento (o dia do recebimento não conta). */
export function prazoRespostaOuvidoria(
  recebidaEm: string,
  feriados: ReadonlySet<string>,
  diasUteis = DIAS_UTEIS_RESPOSTA_OUVIDORIA,
): string {
  let d = recebidaEm.slice(0, 10);
  let contados = 0;
  while (contados < diasUteis) {
    d = somarDiasData(d, 1);
    if (diaUtil(d, feriados)) contados++;
  }
  return `${d}T23:59:59`;
}

export function estadoPrazoManifestacao(
  m: {
    readonly situacao: SituacaoManifestacao;
    readonly prazoEm: string;
    readonly respondidaEm: string | null;
  },
  agora: string,
): ManifestacaoLida['estadoPrazo'] {
  const prazo = msLocal(m.prazoEm);
  if (m.situacao === 'respondida')
    return m.respondidaEm !== null && msLocal(m.respondidaEm) > prazo ? 'respondidaComAtraso' : 'cumprido';
  const a = msLocal(agora);
  if (a > prazo) return 'vencido';
  return prazo - a <= AVISO_MS ? 'vencendo' : 'noPrazo';
}

export type RecusaOuvidoria =
  | 'recebida-no-futuro'
  | 'recebida-antiga'
  | 'versao-desatualizada'
  | 'manifestacao-respondida'
  | 'pesquisa-ja-convertida'
  | 'pesquisa-inexistente'
  | 'paciente-inexistente'
  | 'manifestacao-inexistente'
  | 'procedencia-obrigatoria';

/** Até quantos dias para trás a ouvidoria registra (o relato antigo entra, mas com a data de verdade). */
export const DIAS_MAXIMOS_RECEBIMENTO = 60;

export function recusaRegistroManifestacao(recebidaEm: string, agora: string): RecusaOuvidoria | null {
  if (noFuturo(recebidaEm, agora)) return 'recebida-no-futuro';
  if (msLocal(agora) - msLocal(recebidaEm) > DIAS_MAXIMOS_RECEBIMENTO * 86_400_000) return 'recebida-antiga';
  return null;
}

/** Encaminhar ou responder: só a manifestação não respondida, na versão lida. */
export function recusaAndamentoManifestacao(
  m: { readonly versao: number; readonly situacao: SituacaoManifestacao },
  versao: number,
): RecusaOuvidoria | null {
  if (m.situacao === 'respondida') return 'manifestacao-respondida';
  if (m.versao !== versao) return 'versao-desatualizada';
  return null;
}

/** A resposta da reclamação e da denúncia diz se procedeu (orienta a não conformidade). */
export function recusaResposta(tipo: string, procedente: boolean | null): RecusaOuvidoria | null {
  return (tipo === 'reclamacao' || tipo === 'denuncia') && procedente === null
    ? 'procedencia-obrigatoria'
    : null;
}

/** NPS = % promotores − % detratores, com as parcelas impressas (nulo sem resposta). */
export function npsDasNotas(competencia: string, notas: readonly number[]): NpsCompetencia {
  const promotores = notas.filter((n) => n >= 9).length;
  const detratores = notas.filter((n) => n <= 6).length;
  const neutros = notas.length - promotores - detratores;
  const respostas = notas.length;
  if (respostas === 0)
    return { competencia, respostas, promotores, neutros, detratores, nps: null, conta: null };
  const nps = Math.round(((promotores - detratores) / respostas) * 1000) / 10;
  return {
    competencia,
    respostas,
    promotores,
    neutros,
    detratores,
    nps,
    conta: `(${promotores} − ${detratores}) ÷ ${respostas} × 100 = ${numeroBr(nps, 1)}`,
  };
}
