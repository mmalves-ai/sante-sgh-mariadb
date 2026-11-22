// ADR 0009: regras puras da edição das regras da agenda pela tela (cobertura por convênio e por plano/subplano,
// restrições e preparo). O formulário guarda texto (campos de tela) e estas funções montam a entrada do contrato, ou
// devolvem a chave da mensagem do primeiro problema. A regra incluída pela tela entra confirmada; o texto de origem é
// opcional e liga a regra ao trecho do texto livre que ela substitui (o texto continua ao lado, inteiro).
import type {
  EntradaCoberturaAgenda,
  EntradaPreparoAgenda,
  EntradaRestricaoAgenda,
  SexoAtendido,
} from '@sgh/contratos';

/** Sim, não ou herda da agenda (vazio). */
export type TriEstado = '' | 'sim' | 'nao';
export type Montagem<T> = { ok: true; entrada: T } | { ok: false; erro: string };

export interface CamposComuns {
  vigenciaInicio: string;
  vigenciaFim: string;
  textoOrigemId: number | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const triParaBool = (v: TriEstado): boolean | null => (v === '' ? null : v === 'sim');
/** Inteiro digitado no intervalo; '' = nulo; undefined = inválido. */
export function inteiroOpcional(
  v: string | number | null,
  min: number,
  max: number,
): number | null | undefined {
  if (v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function comuns(c: CamposComuns): Montagem<{
  vigenciaInicio: string;
  vigenciaFim: string | null;
  situacaoRevisao: 'confirmada';
  textoOrigemId: number | null;
}> {
  if (!DATA.test(c.vigenciaInicio)) return { ok: false, erro: 'estruturada.edicao.erros.inicio' };
  if (c.vigenciaFim && (!DATA.test(c.vigenciaFim) || c.vigenciaFim < c.vigenciaInicio))
    return { ok: false, erro: 'estruturada.preco.vigenciaInvalida' };
  return {
    ok: true,
    entrada: {
      vigenciaInicio: c.vigenciaInicio,
      vigenciaFim: c.vigenciaFim || null,
      situacaoRevisao: 'confirmada',
      textoOrigemId: c.textoOrigemId,
    },
  };
}

export interface CamposCobertura extends CamposComuns {
  fontePagadoraId: number | null;
  planoId: number | null;
  aceita: boolean;
}
export function montarCobertura(agendaId: number, c: CamposCobertura): Montagem<EntradaCoberturaAgenda> {
  if (!c.fontePagadoraId) return { ok: false, erro: 'estruturada.edicao.erros.convenio' };
  const v = comuns(c);
  if (!v.ok) return v;
  return {
    ok: true,
    entrada: {
      agendaId,
      fontePagadoraId: c.fontePagadoraId,
      planoId: c.planoId || null,
      aceita: c.aceita,
      observacao: null,
      ...v.entrada,
    },
  };
}

export interface CamposRestricao extends CamposComuns {
  fontePagadoraId: number | null;
  planoId: number | null;
  sexoAtendido: '' | SexoAtendido;
  idadeMinimaAnos: string;
  idadeMaximaAnos: string;
  aceitaRetorno: TriEstado;
  diasRetorno: string;
  permiteEncaixe: TriEstado;
}
export function montarRestricao(agendaId: number, c: CamposRestricao): Montagem<EntradaRestricaoAgenda> {
  const min = inteiroOpcional(c.idadeMinimaAnos, 0, 130);
  const max = inteiroOpcional(c.idadeMaximaAnos, 0, 130);
  const dias = inteiroOpcional(c.diasRetorno, 0, 3650);
  if (min === undefined || max === undefined) return { ok: false, erro: 'estruturada.edicao.erros.idade' };
  if (min !== null && max !== null && min > max)
    return { ok: false, erro: 'estruturada.edicao.erros.idadeOrdem' };
  if (dias === undefined) return { ok: false, erro: 'estruturada.edicao.erros.dias' };
  if (c.planoId && !c.fontePagadoraId)
    return { ok: false, erro: 'estruturada.edicao.erros.planoSemConvenio' };
  const sexo = c.sexoAtendido === '' ? null : c.sexoAtendido;
  const retorno = triParaBool(c.aceitaRetorno);
  const encaixe = triParaBool(c.permiteEncaixe);
  if (sexo === null && min === null && max === null && retorno === null && dias === null && encaixe === null)
    return { ok: false, erro: 'estruturada.edicao.erros.restricaoVazia' };
  const v = comuns(c);
  if (!v.ok) return v;
  return {
    ok: true,
    entrada: {
      agendaId,
      fontePagadoraId: c.fontePagadoraId || null,
      planoId: c.planoId || null,
      itemAgendavelId: null,
      sexoAtendido: sexo,
      idadeMinimaAnos: min,
      idadeMaximaAnos: max,
      aceitaRetorno: retorno,
      diasRetorno: dias,
      permiteEncaixe: encaixe,
      observacao: null,
      ...v.entrada,
    },
  };
}

export interface CamposPreparo extends CamposComuns {
  tipo: 'preparo' | 'documento' | 'orientacao';
  descricao: string;
  jejumHoras: string;
}
export function montarPreparo(agendaId: number, c: CamposPreparo): Montagem<EntradaPreparoAgenda> {
  const descricao = c.descricao.trim();
  if (!descricao) return { ok: false, erro: 'estruturada.edicao.erros.descricao' };
  const jejum = inteiroOpcional(c.jejumHoras, 1, 72);
  if (jejum === undefined) return { ok: false, erro: 'estruturada.edicao.erros.jejum' };
  const v = comuns(c);
  if (!v.ok) return v;
  return {
    ok: true,
    entrada: { agendaId, itemAgendavelId: null, tipo: c.tipo, descricao, jejumHoras: jejum, ...v.entrada },
  };
}

/** Nomes por id a partir do que a agenda estruturada já traz (convênios aceitos, coberturas e restrições). */
export function nomesDaAgenda(a: {
  conveniosAceitos: readonly { fontePagadoraId: number; nome: string }[];
  coberturas: readonly {
    fontePagadoraId: number;
    fontePagadoraNome: string;
    planoId: number | null;
    planoNome: string | null;
    planoSuperiorId: number | null;
    planoSuperiorNome: string | null;
  }[];
  restricoes: readonly {
    fontePagadoraId: number | null;
    fontePagadoraNome: string | null;
    planoId: number | null;
    planoNome: string | null;
  }[];
}): { convenios: Record<number, string>; planos: Record<number, string> } {
  const convenios: Record<number, string> = {};
  const planos: Record<number, string> = {};
  for (const c of a.conveniosAceitos) convenios[c.fontePagadoraId] = c.nome;
  for (const c of a.coberturas) {
    convenios[c.fontePagadoraId] = c.fontePagadoraNome;
    if (c.planoId !== null && c.planoNome !== null) planos[c.planoId] = c.planoNome;
    if (c.planoSuperiorId !== null && c.planoSuperiorNome !== null)
      planos[c.planoSuperiorId] = c.planoSuperiorNome;
  }
  for (const r of a.restricoes) {
    if (r.fontePagadoraId !== null && r.fontePagadoraNome !== null)
      convenios[r.fontePagadoraId] = r.fontePagadoraNome;
    if (r.planoId !== null && r.planoNome !== null) planos[r.planoId] = r.planoNome;
  }
  return { convenios, planos };
}
