// Tipos de negócio do repasse médico (F2.2): o que a porta lê e grava, com vocabulário neutro. O prestador é o
// profissional favorecido (profissional.id); a competência é "AAAA-MM"; datas "AAAA-MM-DD".

/** Apuração do período (estado da tela: aberta, conferida, aprovada, titulada). */
export interface ApuracaoRepasseRegistrada {
  readonly id: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly estado: string;
  readonly simulacao: boolean;
  readonly itens: number;
  readonly comRepasse: number;
  readonly pendentes: number;
  /** Pendências por motivo, em JSON. */
  readonly pendencias: string;
  readonly base: number;
  readonly valor: number;
  readonly apuradoPor: string;
  readonly conferidoPor: string | null;
  readonly aprovadoPor: string | null;
}

/** Lançamento de repasse: `tipo` M (médico) ou E (empresa); `origem` do lançamento. */
export interface LancamentoRepasseRegistrado {
  readonly id: number;
  readonly tipo: 'M' | 'E';
  readonly prestador: number;
  readonly data: string | null;
  readonly evento: number;
  readonly valor: number;
  readonly origem: string;
  readonly emRpa: number | null;
  readonly registro: number | null;
}

/** Memória de cálculo de um item da apuração. */
export interface MemoriaCalculoRegistrada {
  readonly item: number;
  readonly prestador: number | null;
  readonly regra: number | null;
  readonly dimensoes: string;
  readonly ignoradas: string;
  readonly base: string | null;
  readonly baseValor: number;
  readonly percentual: number;
  readonly valorFixo: number;
  readonly valorSemAdicional: number;
  readonly adicional: string | null;
  readonly valor: number;
  readonly pendencia: string | null;
  /** Fonte pagadora da conta do item (a apuração lança por profissional e fonte); ausente na fonte sem conta. */
  readonly fontePagadora?: number | null;
}

export type MemoriaCalculoParaGravar = MemoriaCalculoRegistrada;

/** Item pendente da apuração com a referência de negócio para agir nele (a conta, o atendimento, o procedimento). */
export interface ItemPendenteRegistrado extends MemoriaCalculoRegistrada {
  readonly contaId: number;
  readonly contaNumero: string;
  readonly atendimentoNumero: string;
  readonly prontuario: string;
  readonly procedimento: string;
  readonly procedimentoDescricao: string;
  /** Data e hora local do item (AAAA-MM-DD HH:MM). */
  readonly realizadoEm: string | null;
  readonly profissionalNome: string | null;
}

/** Página de itens pendentes: os da página e o total do filtro. */
export interface PaginaItensPendentes {
  readonly itens: readonly ItemPendenteRegistrado[];
  readonly total: number;
}

export interface TotaisApuracao {
  readonly itens: number;
  readonly comRepasse: number;
  readonly pendentes: number;
  readonly pendencias: string;
  readonly base: number;
  readonly valor: number;
}

export interface PrestadorRepasse {
  readonly prestador: number;
  readonly registro: number;
  readonly nome: string;
  readonly conselho: string;
}

export interface RpaRegistrado {
  readonly id: number;
  readonly serie: string;
  readonly numero: number;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly emissao: string | null;
  readonly tipo: string;
  readonly prestador: number;
  readonly situacao: string;
  readonly lancamentos: number;
}

export interface RpaDetalhe {
  readonly rpa: RpaRegistrado;
  readonly lancamentos: readonly { id: number; data: string | null; evento: number; valor: number }[];
  readonly retencoes: {
    bruto: number;
    baseInss: number;
    inss: number;
    baseIrrf: number;
    irrf: number;
    iss: number;
    liquido: number;
  } | null;
  readonly titulo: { id: number; valor: number; vencimento: string | null } | null;
  readonly contribuinte: { nome: string; conselho: string; documento: string } | null;
}

export interface VersaoRegraRegistrada {
  readonly id: number;
  readonly estado: string;
  readonly substitui: number | null;
  /** A regra proposta, em JSON. */
  readonly proposta: string;
  readonly justificativa: string;
  readonly simulada: boolean;
  readonly autor: string;
  readonly propostaEm: string | null;
  readonly decididaPor: string | null;
  readonly decididaEm: string | null;
  readonly justificativaDecisao: string | null;
  readonly regraIncluida: number | null;
}

/** Primeiro e último dia da competência "AAAA-MM". */
export function limitesCompetencia(competencia: string): { inicio: string; fim: string } {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${competencia}-01`, fim: `${competencia}-${String(ultimo).padStart(2, '0')}` };
}
