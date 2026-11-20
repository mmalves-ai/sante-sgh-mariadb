// Responsável legal no portal (M50 etapa 1; ficha, seção 5 `portal.vincularResponsavel` e regra 5; LGPD art. 14; Código
// Civil arts. 1.630, 1.728 e 1.767; Lei 13.146/2015, art. 84): o acesso de quem responde pelo titular só existe com a
// prova de vínculo conferida pelo hospital no documento original; o de pai, mãe, tutor e guardião acaba sozinho na
// maioridade do titular; o do procurador vence com a procuração; o titular maior revoga o de procurador quando quiser.
// O responsável age só no escopo concedido (documentos, consentimentos, pedidos, agendamentos).
import {
  ESCOPO_PADRAO_VINCULO,
  type EscopoVinculo,
  type MotivoFimVinculo,
  PROVAS_ACEITAS,
  type ProvaVinculo,
  type SituacaoVinculo,
  type TipoVinculoResponsavel,
  VINCULOS_COM_VALIDADE,
  VINCULOS_DE_MENOR,
} from '@sgh/contratos';
import { diaEmQueFaz, idadeEm } from './conta.js';

export interface TitularParaVinculo {
  readonly nascimento: string | null;
  readonly obito: boolean;
  readonly ativo: boolean;
}

export interface PedidoVinculoRegra {
  readonly tipo: TipoVinculoResponsavel;
  readonly prova: ProvaVinculo;
  /** Validade do documento (AAAA-MM-DD) ou null. */
  readonly validade: string | null;
  /** O responsável pede para si mesmo? (a conta do titular). */
  readonly paraSiMesmo: boolean;
  /** Já há vínculo pendente ou ativo da mesma conta para o mesmo titular. */
  readonly jaExiste: boolean;
}

export type RecusaVinculo =
  | 'para-si-mesmo'
  | 'repetido'
  | 'titular-inativo'
  | 'obito'
  | 'sem-nascimento'
  | 'titular-maior'
  | 'titular-menor'
  | 'prova-nao-aceita'
  | 'validade-obrigatoria'
  | 'validade-vencida'
  | 'validade-longa';

/**
 * Confere o pedido de vínculo (antes da conferência humana da prova). `titular-maior`: pai, mãe, tutor e guardião só
 * para menor; `titular-menor`: curador e procurador só para maior (o menor é representado pelos pais ou tutor).
 */
export function conferirPedidoVinculo(
  p: PedidoVinculoRegra,
  t: TitularParaVinculo,
  dia: string,
  idadeContaPropria: number,
  validadeMaximaDias: number,
): RecusaVinculo | null {
  if (p.paraSiMesmo) return 'para-si-mesmo';
  if (p.jaExiste) return 'repetido';
  if (!t.ativo) return 'titular-inativo';
  if (t.obito) return 'obito';
  const idade = idadeEm(t.nascimento, dia);
  if (idade === null) return 'sem-nascimento';
  const deMenor = VINCULOS_DE_MENOR.includes(p.tipo);
  if (deMenor && idade >= idadeContaPropria) return 'titular-maior';
  if (!deMenor && idade < idadeContaPropria) return 'titular-menor';
  if (!PROVAS_ACEITAS[p.tipo].includes(p.prova)) return 'prova-nao-aceita';
  return conferirValidade(p.tipo, p.validade, dia, validadeMaximaDias);
}

function conferirValidade(
  tipo: TipoVinculoResponsavel,
  validade: string | null,
  dia: string,
  validadeMaximaDias: number,
): RecusaVinculo | null {
  if (VINCULOS_COM_VALIDADE.includes(tipo) && validade === null) return 'validade-obrigatoria';
  if (validade === null) return null;
  if (validade < dia) return 'validade-vencida';
  const limite = new Date(Date.parse(`${dia}T00:00:00Z`) + validadeMaximaDias * 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (VINCULOS_COM_VALIDADE.includes(tipo) && validade > limite) return 'validade-longa';
  return null;
}

export function mensagemVinculo(r: RecusaVinculo): string {
  switch (r) {
    case 'para-si-mesmo':
      return 'O pedido de responsável é para outra pessoa; os seus dados já aparecem na sua conta.';
    case 'repetido':
      return 'Já existe um pedido ou um acesso seu para esta pessoa.';
    case 'titular-inativo':
    case 'obito':
    case 'sem-nascimento':
      return 'Não foi possível pedir o acesso para estes dados. Procure a recepção.';
    case 'titular-maior':
      return 'A pessoa já atingiu a idade da conta própria: o acesso de pai, mãe, tutor ou guardião não se aplica.';
    case 'titular-menor':
      return 'Para menor de idade, o acesso é de pai, mãe, tutor ou guardião.';
    case 'prova-nao-aceita':
      return 'O documento enviado não prova este tipo de vínculo.';
    case 'validade-obrigatoria':
      return 'Informe a validade da procuração.';
    case 'validade-vencida':
      return 'O documento já venceu.';
    case 'validade-longa':
      return 'A validade passa do prazo máximo aceito para procuração; informe a data do documento.';
  }
}

export interface VinculoRegra {
  readonly tipo: TipoVinculoResponsavel;
  readonly situacao: SituacaoVinculo;
  readonly validade: string | null;
  readonly escopos: readonly EscopoVinculo[];
}

/** Quando o vínculo acaba sozinho (o mais cedo entre a maioridade e a validade), ou null. */
export function terminoDoVinculo(
  v: Pick<VinculoRegra, 'tipo' | 'validade'>,
  nascimentoTitular: string | null,
  idadeContaPropria: number,
): string | null {
  const maioridade =
    VINCULOS_DE_MENOR.includes(v.tipo) && nascimentoTitular
      ? diaEmQueFaz(nascimentoTitular, idadeContaPropria)
      : null;
  // A validade é o último dia do acesso; o término é o dia seguinte.
  const fimValidade =
    v.validade !== null
      ? new Date(Date.parse(`${v.validade}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      : null;
  if (maioridade && fimValidade) return maioridade < fimValidade ? maioridade : fimValidade;
  return maioridade ?? fimValidade;
}

/** O vínculo vale hoje? Se não vale, por quê (o job noturno encerra com esse motivo). */
export function vigenciaDoVinculo(
  v: VinculoRegra,
  titular: TitularParaVinculo,
  dia: string,
  idadeContaPropria: number,
): { readonly vigente: true } | { readonly vigente: false; readonly motivo: MotivoFimVinculo | null } {
  if (v.situacao !== 'ativo') return { vigente: false, motivo: null };
  if (titular.obito) return { vigente: false, motivo: 'obito-do-titular' };
  const fim = terminoDoVinculo(v, titular.nascimento, idadeContaPropria);
  if (fim !== null && dia >= fim) {
    const maioridade =
      VINCULOS_DE_MENOR.includes(v.tipo) && titular.nascimento
        ? diaEmQueFaz(titular.nascimento, idadeContaPropria)
        : null;
    return { vigente: false, motivo: maioridade !== null && dia >= maioridade ? 'maioridade' : 'validade' };
  }
  return { vigente: true };
}

/** O escopo aprovado: o pedido pela conferência, limitado ao padrão do vínculo (procurador: o que a procuração diz). */
export function escoposAprovados(
  tipo: TipoVinculoResponsavel,
  pedidos: readonly EscopoVinculo[],
): EscopoVinculo[] {
  const padrao = ESCOPO_PADRAO_VINCULO[tipo];
  const base = tipo === 'procurador' ? pedidos : pedidos.filter((e) => padrao.includes(e));
  return [...new Set(base)].sort();
}

export type RecusaDecisaoVinculo = 'ja-decidido' | 'quem-pediu-nao-decide' | 'procurador-sem-escopo';

/** Conferir a decisão da conferência (segregação: quem pediu não aprova o próprio pedido). */
export function conferirDecisaoVinculo(
  v: Pick<VinculoRegra, 'situacao' | 'tipo'>,
  decisao: { readonly aprovar: boolean; readonly escopos: readonly EscopoVinculo[] },
  mesmaPessoa: boolean,
): RecusaDecisaoVinculo | null {
  if (v.situacao !== 'pendente') return 'ja-decidido';
  if (mesmaPessoa) return 'quem-pediu-nao-decide';
  if (decisao.aprovar && v.tipo === 'procurador' && decisao.escopos.length === 0)
    return 'procurador-sem-escopo';
  return null;
}

/** Quem revoga o vínculo pelo portal: o titular maior revoga procurador e curador não (só por decisão judicial). */
export function titularPodeRevogar(tipo: TipoVinculoResponsavel): boolean {
  return tipo === 'procurador';
}

export interface TitularDisponivel {
  /** null: o próprio titular da conta. */
  readonly vinculo: string | null;
  readonly escopos: readonly EscopoVinculo[];
}

/**
 * Titulares que a sessão pode ver: o próprio (se tem idade de conta própria) e os representados com vínculo vigente.
 * A conta do próprio titular tem todos os escopos.
 */
export function titularesDaSessao(
  propria: { readonly nascimento: string | null } | null,
  vinculos: readonly (VinculoRegra & { readonly id: string; readonly titular: TitularParaVinculo })[],
  dia: string,
  idadeContaPropria: number,
): TitularDisponivel[] {
  const r: TitularDisponivel[] = [];
  if (propria !== null) {
    const idade = idadeEm(propria.nascimento, dia);
    if (idade !== null && idade >= idadeContaPropria)
      r.push({ vinculo: null, escopos: ['agendamentos', 'consentimentos', 'documentos', 'pedidos'] });
  }
  for (const v of vinculos)
    if (vigenciaDoVinculo(v, v.titular, dia, idadeContaPropria).vigente)
      r.push({ vinculo: v.id, escopos: [...v.escopos].sort() });
  return r;
}

/** A sessão pode agir agora, no titular escolhido, neste escopo? (o servidor confere em cada pedido). */
export function podeAgir(
  disponiveis: readonly TitularDisponivel[],
  escolhido: string | null,
  escopo: EscopoVinculo,
): boolean {
  const t = disponiveis.find((d) => d.vinculo === escolhido);
  return t !== undefined && t.escopos.includes(escopo);
}
