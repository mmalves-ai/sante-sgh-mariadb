// F7 (08-SGO linha 98): a regra de coparticipação por escopo (C2-116). A operadora cadastra regras do plano
// comercializado ou do contrato, gerais ou restritas a um tipo de guia, a um grupo de procedimentos, a um procedimento e
// a um regime de atendimento, cada uma com os tetos por evento, mês e ano. No lançamento vale a regra mais específica que
// casa com o evento: o procedimento pesa mais que o grupo, o grupo mais que o tipo de guia, e este mais que o regime; no
// mesmo grau, a do contrato prevalece sobre a do plano e, depois, a que começou por último. Assim a operadora isenta a
// consulta de urgência ou cobra outro percentual na internação sem repetir a regra geral (RN ANS 433: o fator moderador
// não pode impedir o acesso; por isso os tetos).
import { problemasDosTetos } from './coparticipacao.js';

export type TipoCoparticipacao = 'nenhuma' | 'percentual' | 'valor_fixo';

/** Os critérios do escopo de uma regra (nulo: vale para todos). */
export interface EscopoCoparticipacao {
  readonly procedimento: number | null;
  readonly grupo: number | null;
  readonly tipoGuia: number | null;
  readonly regime: number | null;
}

/** Uma regra candidata, já filtrada pela operadora, pelo plano ou contrato e pela vigência. */
export interface RegraCandidata extends EscopoCoparticipacao {
  readonly id: number;
  /** A regra é do contrato (prevalece sobre a do plano no mesmo grau de especificidade). */
  readonly doContrato: boolean;
  /** Início da vigência (AAAA-MM-DD). */
  readonly inicio: string;
}

/** O evento a cobrar: o que se sabe dele (nulo: não informado; só a regra que não exige o critério casa). */
export type EventoCoparticipacao = Partial<EscopoCoparticipacao>;

/** O peso de cada critério: o procedimento vale mais que todos os de baixo somados. */
const PESO: Readonly<Record<keyof EscopoCoparticipacao, number>> = {
  procedimento: 8,
  grupo: 4,
  tipoGuia: 2,
  regime: 1,
};
const CRITERIOS = Object.keys(PESO) as (keyof EscopoCoparticipacao)[];

/** A regra casa com o evento quando todo critério que ela exige é igual ao do evento. */
export function regraCasaComEvento(r: EscopoCoparticipacao, ev: EventoCoparticipacao): boolean {
  return CRITERIOS.every((k) => r[k] === null || r[k] === (ev[k] ?? null));
}

/** O grau de especificidade da regra (0: regra geral). */
export function especificidade(r: EscopoCoparticipacao): number {
  return CRITERIOS.reduce((s, k) => s + (r[k] === null ? 0 : PESO[k]), 0);
}

/** A regra que vale para o evento (null: nenhuma casa; o lançamento recusa por falta de coparticipação). */
export function escolherRegraCoparticipacao<T extends RegraCandidata>(
  candidatas: readonly T[],
  evento: EventoCoparticipacao,
): T | null {
  const ordem = (a: T, b: T) =>
    especificidade(b) - especificidade(a) ||
    Number(b.doContrato) - Number(a.doContrato) ||
    b.inicio.localeCompare(a.inicio) ||
    b.id - a.id;
  return [...candidatas].filter((r) => regraCasaComEvento(r, evento)).sort(ordem)[0] ?? null;
}

/** O cadastro de uma regra (a tela do produto e do contrato). */
export interface RegraCoparticipacaoCadastro extends EscopoCoparticipacao {
  readonly codigo: string;
  readonly descricao: string;
  readonly plano: number | null;
  readonly contrato: number | null;
  readonly tipo: TipoCoparticipacao;
  /** Percentual (0 a 100) ou valor fixo em reais, conforme o tipo; nulo em 'nenhuma'. */
  readonly valor: number | null;
  readonly tetoEvento: number | null;
  readonly tetoMensal: number | null;
  readonly tetoAnual: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface ProblemaRegraCoparticipacao {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** As recusas do cadastro, todas de uma vez (a tela mostra cada campo). */
export function problemasDaRegraCoparticipacao(
  r: RegraCoparticipacaoCadastro,
): ProblemaRegraCoparticipacao[] {
  const p: ProblemaRegraCoparticipacao[] = [];
  const add = (codigo: string, campo: string, detalhe: string) => p.push({ codigo, campo, detalhe });
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(r.codigo.trim()))
    add('codigo-invalido', 'codigo', 'Código de 2 a 30 letras, números, ponto, hífen ou sublinhado.');
  if (r.descricao.trim().length < 3)
    add('descricao-curta', 'descricao', 'Descreva a regra (3 caracteres ou mais).');
  if ((r.plano === null) === (r.contrato === null))
    add('escopo-invalido', 'plano', 'A regra é do plano ou do contrato (um dos dois).');
  if (r.tipo === 'percentual' && (r.valor === null || r.valor <= 0 || r.valor > 100))
    add('percentual-invalido', 'valor', 'O percentual fica acima de 0 e até 100.');
  if (r.tipo === 'valor_fixo' && (r.valor === null || r.valor <= 0))
    add('valor-invalido', 'valor', 'O valor fixo é maior que zero.');
  if (r.tipo === 'nenhuma' && r.valor !== null) add('valor-sem-tipo', 'valor', 'Isenção não tem valor.');
  if (r.tipo === 'nenhuma' && (r.tetoEvento !== null || r.tetoMensal !== null || r.tetoAnual !== null))
    add('teto-sem-tipo', 'tetoEvento', 'Isenção não tem teto.');
  else if (
    problemasDosTetos({
      tipo: 1,
      valor: null,
      tetoEvento: r.tetoEvento,
      tetoMensal: r.tetoMensal,
      tetoAnual: r.tetoAnual,
    }).length
  )
    add(
      'coparticipacao-teto-invalido',
      'tetoEvento',
      'Tetos maiores que zero; o do evento até o mensal e o mensal até o anual.',
    );
  if (r.tipo === 'valor_fixo' && r.tetoEvento !== null && r.valor !== null && r.valor > r.tetoEvento)
    add('valor-acima-do-teto', 'tetoEvento', 'O valor fixo passa do teto por evento.');
  if (r.procedimento !== null && r.grupo !== null)
    add('procedimento-e-grupo', 'grupo', 'A regra é de um procedimento ou de um grupo, não dos dois.');
  if (!DATA.test(r.inicio)) add('inicio-invalido', 'inicio', 'Informe o início da vigência.');
  else if (r.fim !== null && (!DATA.test(r.fim) || r.fim < r.inicio))
    add('fim-antes-do-inicio', 'fim', 'O fim da vigência não pode ser antes do início.');
  return p;
}

/** A regra vigente que encerra: o fim na data pedida, nunca antes do início (o histórico fica). */
export function problemasDoEncerramento(
  r: { readonly inicio: string; readonly fim: string | null },
  fim: string,
): ProblemaRegraCoparticipacao[] {
  if (!DATA.test(fim))
    return [{ codigo: 'fim-invalido', campo: 'fim', detalhe: 'Informe o fim da vigência.' }];
  if (fim < r.inicio)
    return [{ codigo: 'fim-antes-do-inicio', campo: 'fim', detalhe: 'O fim não pode ser antes do início.' }];
  if (r.fim !== null && r.fim <= fim)
    return [
      { codigo: 'regra-ja-encerrada', campo: 'fim', detalhe: 'A regra já termina nesta data ou antes.' },
    ];
  return [];
}
