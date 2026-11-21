// Respostas do OPME (ficha do M46, etapa 3; seções 4 e 7): as solicitações com as etapas, os itens de OPME com o
// saldo, o contexto do consumo em sala, os consumos com o rastreio e a etiqueta, a conciliação com a conta (com o
// indicador "OPME usado sem cobrança", numerador e denominador) e o rastreio reverso (lote ou série → pacientes).
import type { GravacaoAgenda } from '../agenda/respostas.js';
import type {
  EtapaOpme,
  SituacaoConciliacaoOpme,
  SituacaoOpme,
  ViaEtiquetaOpme,
} from './opme-vocabulario.js';

export interface EtapaOpmeLida {
  readonly seq: number;
  readonly etapa: EtapaOpme;
  /** AAAA-MM-DDTHH:mm */
  readonly em: string;
  readonly quantidade: number | null;
  readonly fornecedor: number | null;
  readonly senha: string | null;
  readonly guia: string | null;
  readonly validade: string | null;
  readonly pedido: { ano: number; doc: number } | null;
  readonly nf: { ano: number; mes: number; doc: number } | null;
  readonly saida: { ano: number; mes: number; doc: number } | null;
  readonly lancamento: number | null;
  readonly consumo: number | null;
  readonly observacao: string | null;
  readonly usuario: string;
}

export interface SolicitacaoOpme {
  readonly id: number;
  readonly agendamento: number;
  readonly sala: number;
  /** AAAA-MM-DDTHH:mm (o início previsto da cirurgia). */
  readonly dataHora: string;
  /** O atendimento (internação) do paciente. */
  readonly atendimento: number;
  readonly item: number;
  readonly itemNome: string | null;
  readonly tuss: string;
  readonly quantidade: number;
  readonly fornecedor: number | null;
  readonly fornecedorNome: string | null;
  readonly justificativa: string;
  readonly situacao: SituacaoOpme;
  readonly autorizada: number;
  readonly consumida: number;
  readonly devolvida: number;
  readonly consignado: boolean;
  readonly senha: string | null;
  readonly guia: string | null;
  readonly validadeSenha: string | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly etapas: readonly EtapaOpmeLida[];
}

/** Um item de OPME do cadastro (classe 50) com o saldo no local e os lotes. */
export interface ItemOpme {
  readonly item: number;
  readonly nome: string;
  readonly unidade: string;
  readonly saldoLocal: number;
  readonly estoque: number;
  readonly consignado: boolean;
  readonly rastreavel: boolean;
  readonly lotes: readonly { lote: string; validade: string; saldo: number }[];
}

export interface ConsumoOpme {
  readonly id: number;
  readonly solicitacao: number | null;
  readonly agendamento: number;
  readonly sala: number;
  readonly dataHora: string;
  readonly atendimento: number;
  readonly item: number;
  readonly itemNome: string | null;
  readonly quantidade: number;
  readonly devolvida: number;
  readonly saida: { ano: number; mes: number; doc: number };
  readonly lancamento: number;
  readonly conta: number;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly fabricante: string;
  readonly modelo: string | null;
  readonly registroAnvisa: string;
  readonly validade: string | null;
  readonly consignado: boolean;
  /** A exceção registrada (o consumo sem a autorização da operadora). */
  readonly semAutorizacao: { por: string; motivo: string } | null;
  readonly usuario: string;
  readonly em: string;
}

/** A etiqueta do consumo em três vias (ZPL), com o SHA-256 gravado no rastreio. */
export interface EtiquetaOpme {
  readonly zpl: string;
  readonly vias: readonly ViaEtiquetaOpme[];
  readonly sha256: string;
}

export interface ConsumoOpmeRegistrado {
  readonly consumo: number;
  readonly saida: { ano: number; mes: number; doc: number };
  readonly lancamento: number;
  readonly etiqueta: EtiquetaOpme;
  readonly repetida: boolean;
}

/** O contexto do consumo em sala de um agendamento. */
export interface ContextoConsumoOpme {
  readonly agendamento: {
    readonly id: number;
    readonly sala: number;
    readonly salaNome: string | null;
    readonly dataHora: string;
    readonly atendimento: number;
    readonly paciente: string | null;
    readonly procedimento: string | null;
    readonly cirurgiao: string | null;
  };
  readonly solicitacoes: readonly SolicitacaoOpme[];
  readonly consumos: readonly ConsumoOpme[];
  readonly locais: readonly { codigo: number; nome: string }[];
  /** O local de estoque sugerido para o bloco (o primeiro local com saldo de OPME; sem nenhum, o primeiro da lista). */
  readonly localSugerido: number | null;
  /** Quem registra pode registrar a exceção (consumo sem autorização da operadora). */
  readonly podeExcecao: boolean;
  readonly gravacao: GravacaoAgenda;
}

export interface LinhaConciliacaoOpme {
  readonly consumo: number;
  readonly solicitacao: number | null;
  readonly atendimento: number;
  readonly conta: number;
  readonly dataHora: string;
  readonly item: number;
  readonly itemNome: string | null;
  readonly tuss: string | null;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly consignado: boolean;
  readonly usada: number;
  readonly naConta: number;
  readonly situacao: SituacaoConciliacaoOpme;
  /** A nota fiscal ligada à solicitação (reposição ou faturamento do consignado), quando há. */
  readonly nf: { ano: number; mes: number; doc: number } | null;
}

export interface ConciliacaoOpme {
  readonly de: string;
  readonly ate: string;
  readonly linhas: readonly LinhaConciliacaoOpme[];
  /** "OPME usado sem cobrança": consumos sem item correspondente na conta / consumos com uso (regra 9). */
  readonly indicador: { numerador: number; denominador: number; percentual: number | null };
  readonly cortada: boolean;
}

export interface ExpostoOpme {
  readonly consumo: number;
  readonly atendimento: number;
  readonly paciente: number | null;
  readonly agendamento: number;
  readonly sala: number;
  readonly dataHora: string;
  /** O cirurgião do agendamento (o vínculo profissional). */
  readonly cirurgiao: number | null;
  readonly quantidade: number;
  readonly devolvida: number;
  readonly saida: { ano: number; mes: number; doc: number };
  readonly lote: string | null;
  readonly serie: string | null;
  readonly registroAnvisa: string;
  readonly usuario: string;
}

/**
 * Uma saída do estoque do lote (lote, item e documento de saída do estoque), feita no consumo em sala ou por outro caminho
 * do estoque durante a coexistência: o atendimento e o paciente da saída, para o recall.
 */
export interface SaidaLoteOpme {
  readonly saida: { ano: number; mes: number; doc: number };
  readonly data: string | null;
  readonly item: number;
  /** O atendimento da saída (0: a saída não é a paciente). */
  readonly atendimento: number;
  readonly paciente: number | null;
  readonly quantidade: number;
  /** A origem: o consumo em sala registrado aqui, ou outra saída do estoque. */
  readonly origem: 'consumo-em-sala' | 'estoque';
}

/** Rastreio reverso (regra 8): do lote, da série ou do registro Anvisa aos pacientes e profissionais (expostos). */
export interface RastreioReversoOpme {
  /** O item buscado (null: a busca só pelo lote, pela série ou pelo registro Anvisa, em qualquer item). */
  readonly item: number | null;
  readonly itemNome: string | null;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly registroAnvisa: string | null;
  readonly expostos: readonly ExpostoOpme[];
  /** Saídas do estoque do mesmo lote (só com o item e o lote; o lote do estoque, quando o item é rastreado). */
  readonly saidasDoLote: number;
  /** As saídas do estoque do lote com o atendimento e o paciente (com teto; ver `cortada`). */
  readonly saidasEstoque: readonly SaidaLoteOpme[];
  readonly cortada: boolean;
}
