// Pesquisa clínica (03-PEP L144; Res. CNS 466/2012, RDC ANVISA 9/2015; LGPD art. 11, II, c): o estudo com aprovação
// ética, a equipe, os critérios de elegibilidade, a triagem automática como sugestão à equipe e o acompanhamento dos
// participantes. Regras puras, sem banco.
//   - estudo: código e título; a vigência não volta; fora de "em aprovação" e "cancelado" o estudo tem o parecer do
//     comitê de ética (CAAE e data de aprovação); a passagem de situação segue o ciclo do estudo;
//   - critério: inclusão, exclusão ou saída; a fonte do dado exige a referência (exame, item ou parâmetro) ou a faixa
//     (idade) ou o valor (sexo, diagnóstico pelo prefixo do CID-10); a faixa não se inverte;
//   - triagem: só sugere (nunca inclui); avalia sobre o prontuário os critérios de fonte automática (idade, sexo e
//     diagnóstico); os de outra fonte ficam para a equipe conferir. Grupos de inclusão são alternativos (OU) e os
//     critérios do mesmo grupo valem juntos (E); qualquer exclusão atendida afasta o paciente;
//   - participante: a inclusão exige o termo de consentimento (TCLE) assinado; a saída exige o motivo.

export interface ProblemaPesquisa {
  readonly campo: string;
  readonly mensagem: string;
}

export const FASES_ESTUDO = ['fase_1', 'fase_2', 'fase_3', 'fase_4', 'observacional', 'outro'] as const;
export const SITUACOES_ESTUDO = [
  'em_aprovacao',
  'aprovada',
  'recrutando',
  'em_andamento',
  'suspensa',
  'encerrada',
  'cancelada',
] as const;
export type SituacaoEstudo = (typeof SITUACOES_ESTUDO)[number];
export const PAPEIS_EQUIPE_PESQUISA = [
  'investigador_principal',
  'coordenador',
  'subinvestigador',
  'farmaceutico',
  'enfermeiro',
  'monitor',
  'outro',
] as const;
export const TIPOS_CRITERIO = ['inclusao', 'exclusao', 'saida'] as const;
export type TipoCriterio = (typeof TIPOS_CRITERIO)[number];
export const FONTES_CRITERIO = [
  'diagnostico',
  'exame',
  'prescricao',
  'parametro_vital',
  'idade',
  'sexo',
  'manual',
] as const;
export type FonteCriterio = (typeof FONTES_CRITERIO)[number];
/** As fontes que a triagem avalia sozinha sobre o prontuário; as demais a equipe confere. */
export const FONTES_AUTOMATICAS: readonly FonteCriterio[] = ['diagnostico', 'idade', 'sexo'];

const TRANSICOES_ESTUDO: Readonly<Record<SituacaoEstudo, readonly SituacaoEstudo[]>> = {
  em_aprovacao: ['aprovada', 'cancelada'],
  aprovada: ['recrutando', 'em_andamento', 'suspensa', 'cancelada'],
  recrutando: ['em_andamento', 'suspensa', 'encerrada'],
  em_andamento: ['recrutando', 'suspensa', 'encerrada'],
  suspensa: ['recrutando', 'em_andamento', 'encerrada', 'cancelada'],
  encerrada: [],
  cancelada: [],
};

export interface DadosEstudo {
  readonly codigo: string;
  readonly titulo: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly numeroCaae: string | null;
  readonly aprovacaoEticaEm: string | null;
}

export function conferirEstudo(e: DadosEstudo, situacao: SituacaoEstudo): ProblemaPesquisa[] {
  const p: ProblemaPesquisa[] = [];
  if (!e.codigo.trim()) p.push({ campo: 'codigo', mensagem: 'Informe o código do estudo.' });
  if (!e.titulo.trim()) p.push({ campo: 'titulo', mensagem: 'Informe o título do estudo.' });
  if (e.fim && e.fim < e.inicio)
    p.push({ campo: 'fim', mensagem: 'O fim do estudo não pode ser antes do início.' });
  if (situacao !== 'em_aprovacao' && situacao !== 'cancelada') {
    if (!e.numeroCaae?.trim())
      p.push({
        campo: 'numeroCaae',
        mensagem: 'O estudo só sai de "em aprovação" com o CAAE do comitê de ética (Res. CNS 466/2012).',
      });
    if (!e.aprovacaoEticaEm)
      p.push({ campo: 'aprovacaoEticaEm', mensagem: 'Informe a data da aprovação pelo comitê de ética.' });
  }
  return p;
}

export function conferirTransicaoEstudo(de: SituacaoEstudo, para: SituacaoEstudo): ProblemaPesquisa[] {
  return TRANSICOES_ESTUDO[de].includes(para)
    ? []
    : [{ campo: 'situacao', mensagem: `O estudo não passa de "${de}" para "${para}".` }];
}

/** Só o estudo que recruta recebe triagem e inclusão de participantes. */
export function estudoRecruta(situacao: SituacaoEstudo, permiteInclusao: boolean): boolean {
  return permiteInclusao && situacao === 'recrutando';
}

export interface DadosCriterio {
  readonly tipo: TipoCriterio;
  readonly fonte: FonteCriterio;
  readonly descricao: string;
  readonly exame: number | null;
  readonly item: number | null;
  readonly parametroVital: number | null;
  readonly valorTexto: string | null;
  readonly valorMinimo: number | null;
  readonly valorMaximo: number | null;
}

export function conferirCriterio(c: DadosCriterio): ProblemaPesquisa[] {
  const p: ProblemaPesquisa[] = [];
  if (!c.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Descreva o critério.' });
  if (c.fonte === 'exame' && c.exame === null)
    p.push({ campo: 'exame', mensagem: 'O critério de exame indica o exame.' });
  if (c.fonte === 'prescricao' && c.item === null)
    p.push({ campo: 'item', mensagem: 'O critério de prescrição indica o item prescritível.' });
  if (c.fonte === 'parametro_vital' && c.parametroVital === null)
    p.push({ campo: 'parametroVital', mensagem: 'O critério de sinal vital indica o parâmetro.' });
  if (c.fonte === 'idade' && c.valorMinimo === null && c.valorMaximo === null)
    p.push({
      campo: 'valorMinimo',
      mensagem: 'O critério de idade indica a idade mínima, a máxima ou as duas.',
    });
  if ((c.fonte === 'sexo' || c.fonte === 'diagnostico') && !c.valorTexto?.trim())
    p.push({
      campo: 'valorTexto',
      mensagem:
        c.fonte === 'sexo'
          ? 'O critério de sexo indica o sexo (sigla).'
          : 'O critério de diagnóstico indica o CID-10 (ou o começo dele).',
    });
  if (c.valorMinimo !== null && c.valorMaximo !== null && c.valorMaximo < c.valorMinimo)
    p.push({ campo: 'valorMaximo', mensagem: 'O valor máximo não pode ser menor que o mínimo.' });
  return p;
}

export interface CriterioAvaliavel extends DadosCriterio {
  readonly id: number;
  readonly grupo: number;
}

/** O que o prontuário do paciente diz para a triagem (só do estabelecimento). */
export interface FatosPaciente {
  readonly idadeAnos: number | null;
  readonly sexo: string | null;
  /** Códigos CID-10 dos diagnósticos do paciente, sem ponto (ex.: "C509"). */
  readonly cids: readonly string[];
}

export interface CriterioAtendido {
  readonly criterio: number;
  readonly valor: string;
}

export interface ResultadoTriagem {
  /** Sugere o paciente à equipe do estudo. */
  readonly sugerido: boolean;
  readonly atendidos: readonly CriterioAtendido[];
  /** Critérios de inclusão do grupo atendido que a equipe ainda confere (fonte não automática). */
  readonly aConferir: readonly number[];
}

const cidNormal = (v: string) => v.replace(/[.\s]/g, '').toUpperCase();

/** Avalia um critério de fonte automática; devolve o valor encontrado ou null. */
export function avaliarCriterio(c: DadosCriterio, f: FatosPaciente): string | null {
  if (c.fonte === 'idade') {
    if (f.idadeAnos === null) return null;
    if (c.valorMinimo !== null && f.idadeAnos < c.valorMinimo) return null;
    if (c.valorMaximo !== null && f.idadeAnos > c.valorMaximo) return null;
    return `${f.idadeAnos} anos`;
  }
  if (c.fonte === 'sexo') {
    const quer = (c.valorTexto ?? '').trim().toUpperCase();
    return f.sexo && f.sexo.toUpperCase() === quer ? f.sexo.toUpperCase() : null;
  }
  if (c.fonte === 'diagnostico') {
    const prefixos = (c.valorTexto ?? '').split(/[,;]/).map(cidNormal).filter(Boolean);
    const achado = f.cids.map(cidNormal).find((cid) => prefixos.some((p) => cid.startsWith(p)));
    return achado ?? null;
  }
  return null;
}

/**
 * Triagem de elegibilidade: sugere o paciente quando algum grupo de inclusão tem todos os critérios automáticos
 * atendidos (e ao menos um automático) e nenhum critério automático de exclusão é atendido. Nunca inclui.
 */
export function triarPaciente(criterios: readonly CriterioAvaliavel[], f: FatosPaciente): ResultadoTriagem {
  const auto = (c: CriterioAvaliavel) => FONTES_AUTOMATICAS.includes(c.fonte);
  const exclusao = criterios.filter((c) => c.tipo === 'exclusao' && auto(c));
  if (exclusao.some((c) => avaliarCriterio(c, f) !== null))
    return { sugerido: false, atendidos: [], aConferir: [] };
  const grupos = new Map<number, CriterioAvaliavel[]>();
  for (const c of criterios.filter((x) => x.tipo === 'inclusao'))
    grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c]);
  for (const [, cs] of [...grupos.entries()].sort((a, b) => a[0] - b[0])) {
    const automaticos = cs.filter(auto);
    if (!automaticos.length) continue;
    const atendidos: CriterioAtendido[] = [];
    let todos = true;
    for (const c of automaticos) {
      const v = avaliarCriterio(c, f);
      if (v === null) {
        todos = false;
        break;
      }
      atendidos.push({ criterio: c.id, valor: v });
    }
    if (todos) return { sugerido: true, atendidos, aConferir: cs.filter((c) => !auto(c)).map((c) => c.id) };
  }
  return { sugerido: false, atendidos: [], aConferir: [] };
}

export const SITUACOES_PARTICIPANTE = [
  'elegivel',
  'convidado',
  'recusou',
  'incluido',
  'em_tratamento',
  'em_acompanhamento',
  'concluido',
  'retirado',
  'excluido_por_criterio',
  'obito',
] as const;
export type SituacaoParticipante = (typeof SITUACOES_PARTICIPANTE)[number];
const SAIDAS: readonly SituacaoParticipante[] = ['retirado', 'excluido_por_criterio', 'obito'];
const TRANSICOES_PARTICIPANTE: Readonly<Record<SituacaoParticipante, readonly SituacaoParticipante[]>> = {
  elegivel: ['convidado', 'incluido', 'recusou'],
  convidado: ['incluido', 'recusou'],
  recusou: [],
  incluido: ['em_tratamento', 'em_acompanhamento', 'concluido', ...SAIDAS],
  em_tratamento: ['em_acompanhamento', 'concluido', ...SAIDAS],
  em_acompanhamento: ['concluido', ...SAIDAS],
  concluido: [],
  retirado: [],
  excluido_por_criterio: [],
  obito: [],
};

export interface InclusaoParticipante {
  readonly consentimentoEm: string | null;
  readonly termoArquivo: number | null;
}

/** A inclusão no estudo exige o TCLE assinado: a data do consentimento e o termo arquivado. */
export function conferirInclusao(e: InclusaoParticipante): ProblemaPesquisa[] {
  const p: ProblemaPesquisa[] = [];
  if (!e.consentimentoEm)
    p.push({
      campo: 'consentimentoEm',
      mensagem: 'A inclusão exige a data da assinatura do termo de consentimento (TCLE).',
    });
  if (e.termoArquivo === null)
    p.push({ campo: 'termoArquivo', mensagem: 'Anexe o termo de consentimento assinado.' });
  return p;
}

export function conferirMudancaParticipante(
  de: SituacaoParticipante,
  para: SituacaoParticipante,
  motivo: string | null,
): ProblemaPesquisa[] {
  const p: ProblemaPesquisa[] = [];
  if (!TRANSICOES_PARTICIPANTE[de].includes(para))
    p.push({ campo: 'situacao', mensagem: `O participante não passa de "${de}" para "${para}".` });
  if ((SAIDAS.includes(para) || para === 'recusou') && !motivo?.trim())
    p.push({ campo: 'motivo', mensagem: 'Informe o motivo da saída ou da recusa.' });
  return p;
}

export const participanteSaiu = (s: SituacaoParticipante): boolean => SAIDAS.includes(s);
export const participanteAtivo = (s: SituacaoParticipante): boolean =>
  s === 'incluido' || s === 'em_tratamento' || s === 'em_acompanhamento';

/** Idade em anos completos na data de referência (AAAA-MM-DD). */
export function idadeEmAnos(nascimento: string | null, referencia: string): number | null {
  if (!nascimento) return null;
  const [an, mn, dn] = nascimento.slice(0, 10).split('-').map(Number);
  const [ar, mr, dr] = referencia.slice(0, 10).split('-').map(Number);
  if (!an || !ar) return null;
  return ar - an - (mr! < mn! || (mr === mn && dr! < dn!) ? 1 : 0);
}
