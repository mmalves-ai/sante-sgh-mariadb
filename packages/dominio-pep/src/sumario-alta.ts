// Sumário de alta estruturado (ficha do M23, regra 13; CIT 33/2017; Portaria GM/MS 8.026/2025): montado do episódio
// (diagnósticos, procedimentos, medicamentos, alergias, exames), editável antes de efetivar; a alta médica dada no
// novo exige sumário finalizado (parâmetro por tipo de atendimento); a do outro sistema segue as regras dele. O FHIR é
// gerado e guardado, sem envio (RNDS na Fase 5), no perfil BR Core de versão fixada no projeto (DP-47.6).
import { jcs, sha256Hex, type SumarioAltaEstruturado } from '@sgh/contratos';
import {
  pendenciasDasSecoes,
  PISO_LEGAL_SUMARIO,
  SECOES_PADRAO,
  type SecaoVigente,
  textoDaSecao,
} from './sumario-alta-secoes.js';

/** Perfil fixado (DP-47.6: BR Core 1.6.1 em 2026-10-19). */
export const PERFIL_FHIR_SUMARIO = 'br-core-1.6.1';

export interface EpisodioAlta {
  readonly motivoInternacao: string | null;
  readonly diagnosticos: readonly { cid: string | null; descricao: string }[];
  readonly procedimentos: readonly string[];
  readonly alergias: readonly string[];
  readonly medicamentos: readonly string[];
  readonly exames: readonly string[];
}

/** O sumário montado do episódio (ponto de partida editável). */
export function montarSumario(e: EpisodioAlta): SumarioAltaEstruturado {
  return {
    ...(e.motivoInternacao ? { motivoInternacao: e.motivoInternacao } : {}),
    diagnosticos: e.diagnosticos.map((d) =>
      d.cid ? { cid: d.cid, descricao: d.descricao } : { descricao: d.descricao },
    ),
    procedimentos: [...e.procedimentos],
    medicamentosAlta: [...e.medicamentos],
    alergias: e.alergias.length > 0 ? [...e.alergias] : [],
    encaminhamentos: [],
    ...(e.exames.length > 0 ? { evolucao: `Exames do episódio: ${e.exames.join('; ')}.` } : {}),
  };
}

export interface PendenciaSumario {
  readonly campo: string;
  readonly motivo: string;
}

/**
 * O que falta para finalizar, pelas seções que valem para o atendimento (sem configuração, o conjunto padrão:
 * diagnóstico, plano ou encaminhamento e condição na alta). A configuração do estabelecimento manda na
 * obrigatoriedade; só o piso legal (o diagnóstico) é exigido sempre.
 */
export function pendenciasDoSumario(
  s: SumarioAltaEstruturado,
  secoes: readonly SecaoVigente[] = SECOES_PADRAO,
): PendenciaSumario[] {
  const r: PendenciaSumario[] = pendenciasDasSecoes(secoes, s);
  if (
    PISO_LEGAL_SUMARIO.includes('diagnosticos') &&
    s.diagnosticos.length === 0 &&
    !r.some((p) => p.campo === 'diagnosticos')
  )
    r.unshift({ campo: 'diagnosticos', motivo: 'Informe ao menos um diagnóstico.' });
  return r;
}

/**
 * Texto do sumário (o que vai ao documento e ao PDF): as seções vigentes na ordem cadastrada, com a descrição do
 * cadastro como título; a seção retirada de uso não aparece. Sem configuração, o conjunto padrão.
 */
export function textoDoSumario(
  s: SumarioAltaEstruturado,
  secoes: readonly SecaoVigente[] = SECOES_PADRAO,
): string {
  const lista = (t: string, linhas: readonly string[]) =>
    linhas.length ? [`${t}:`, ...linhas.map((l) => `- ${l}`), ''] : [];
  const bloco = (t: string, texto: string | undefined) => (texto?.trim() ? [`${t}:`, texto.trim(), ''] : []);
  const parte = (x: SecaoVigente): string[] => {
    switch (x.tipoConteudo) {
      case 'diagnosticos':
        return lista(
          x.descricao,
          s.diagnosticos.map((d) => (d.cid ? `${d.cid} ${d.descricao}` : d.descricao)),
        );
      case 'procedimentos':
        return lista(x.descricao, s.procedimentos);
      case 'evolucao_clinica':
        return bloco(x.descricao, s.evolucao);
      case 'alergias':
        return lista(x.descricao, s.alergias.length ? s.alergias : ['Sem alergias registradas']);
      case 'medicamentos':
        return lista(x.descricao, s.medicamentosAlta);
      case 'plano_terapeutico':
        return [...bloco(x.descricao, s.plano), ...lista('Encaminhamentos', s.encaminhamentos)];
      case 'condicao_alta':
        return bloco(x.descricao, s.condicaoAlta);
      case 'texto_livre':
        return bloco(
          x.descricao,
          textoDaSecao(s, x.codigo) || (x.codigo === 'motivo' ? s.motivoInternacao : undefined),
        );
      default:
        return bloco(x.descricao, textoDaSecao(s, x.codigo));
    }
  };
  return [...secoes]
    .sort((a, b) => a.ordem - b.ordem)
    .flatMap(parte)
    .join('\n')
    .trim();
}

export async function hashDoSumario(
  atendimento: number,
  versao: number,
  s: SumarioAltaEstruturado,
): Promise<string> {
  return sha256Hex(jcs({ atendimento, versao, sumario: s }));
}

/**
 * FHIR (Bundle document com Composition) do sumário, sem envio. Identificadores só por referência local (o paciente
 * e o profissional entram como referência ao recurso do estabelecimento; nenhum documento pessoal aqui).
 */
export function fhirDoSumario(p: {
  readonly id: string;
  readonly paciente: number;
  readonly atendimento: number;
  readonly autor: string;
  readonly data: string;
  readonly sumario: SumarioAltaEstruturado;
}): string {
  const s = p.sumario;
  const secao = (titulo: string, codigo: string, linhas: readonly string[]) => ({
    title: titulo,
    code: { coding: [{ system: 'http://loinc.org', code: codigo }] },
    text: {
      status: 'generated',
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${linhas.map((l) => `<p>${escaparHtml(l)}</p>`).join('')}</div>`,
    },
  });
  const composicao = {
    resourceType: 'Composition',
    id: `${p.id}-composicao`,
    meta: {
      profile: [`http://www.saude.gov.br/fhir/r4/StructureDefinition/BRSumarioAlta-${PERFIL_FHIR_SUMARIO}`],
    },
    status: 'final',
    type: { coding: [{ system: 'http://loinc.org', code: '18842-5', display: 'Discharge summary' }] },
    subject: { reference: `Patient/${p.paciente}` },
    encounter: { reference: `Encounter/${p.atendimento}` },
    date: p.data,
    author: [{ display: p.autor }],
    title: 'Sumário de alta',
    section: [
      secao(
        'Diagnósticos',
        '11535-2',
        s.diagnosticos.map((d) => (d.cid ? `${d.cid} ${d.descricao}` : d.descricao)),
      ),
      secao('Procedimentos', '47519-4', s.procedimentos),
      secao('Alergias', '48765-2', s.alergias),
      secao('Medicamentos na alta', '10183-2', s.medicamentosAlta),
      secao('Plano', '18776-5', [s.plano ?? '', ...s.encaminhamentos].filter(Boolean)),
    ].filter((x) => !x.text.div.endsWith('"></div>')),
  };
  return JSON.stringify({
    resourceType: 'Bundle',
    id: p.id,
    type: 'document',
    timestamp: p.data,
    entry: [{ fullUrl: `urn:uuid:${p.id}-composicao`, resource: composicao }],
  });
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A alta médica dada no novo exige o sumário finalizado quando o parâmetro do tipo de atendimento manda. */
export function altaExigeSumario(tipoAtendimento: string, exigidoPara: ReadonlySet<string>): boolean {
  return exigidoPara.has(tipoAtendimento);
}

/** Os tipos de atendimento do parâmetro `pep.sumarioAlta.exigidoNaAlta` (texto separado por vírgula). */
export function tiposQueExigemSumario(valor: string | null | undefined): Set<string> {
  return new Set(
    (valor ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x === 'internacao' || x === 'externo'),
  );
}
