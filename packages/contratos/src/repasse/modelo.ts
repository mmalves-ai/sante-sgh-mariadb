// Forma da regra de repasse e do item de produção como o motor (@sgh/dominio-repasse) os vê e a porta do banco os
// entrega: a regra (com o profissional), o item faturado com o executante e o "qualquer" como null. Sem dado de pessoa:
// só códigos e valores. Horas no formato "HH:MM".
import type { BaseCalculoRepasse, BeneficiarioRegra, TipoContaRegra } from './vocabulario.js';

export interface RegraRepasse {
  /** Id da regra (ou o da versão em rascunho, negativo, no simulador). */
  readonly id: number;
  /** Início da vigência, AAAA-MM-DD. */
  readonly vigencia: string;
  readonly beneficiario: BeneficiarioRegra;
  /** Profissional da regra (id), casado com o executante do item; null: qualquer. */
  readonly profissional: number | null;
  /**
   * Código do prestador (103.957 regras com código e 98.406 com profissional na cópia). Só informativo: o motor casa
   * pelo vínculo; se o teste dourado mostrar que o outro sistema casa pelo COD, a leitura passa a preencher o
   * profissional a partir dele.
   */
  readonly prestador: number | null;
  readonly convenio: number | null;
  readonly procedimentoInicial: number | null;
  /** null ou igual ao inicial: um procedimento só; maior: faixa. */
  readonly procedimentoFinal: number | null;
  readonly especialidade: number | null;
  readonly ato: number | null;
  readonly local: number | null;
  readonly unidade: number | null;
  readonly centroCusto: number | null;
  readonly cooperativa: number | null;
  readonly tipoLancamento: number | null;
  readonly tipoConta: TipoContaRegra;
  /** Janela de horário "HH:MM" (na cópia, todas de 00:00 a 23:59). */
  readonly horaInicial: string;
  readonly horaFinal: string;
  /** Percentual (até 4 casas) ou valor fixo em reais: um dos dois maior que zero. */
  readonly percentual: number;
  readonly valorFixo: number;
  readonly percentualFeriado: number;
  readonly percentualFimDeSemana: number;
  /** Base explícita da regra; null: a do parâmetro repasse.basePadrao. */
  readonly base: BaseCalculoRepasse | null;
  /** Evento de RPA (id do evento de repasse). */
  readonly evento: number | null;
}

/** Item faturado com o executante (item da conta; regra 5). */
export interface ItemProducao {
  /** Id do item da produção. */
  readonly id: number;
  /** Data e hora da realização (AAAA-MM-DD e "HH:MM"). */
  readonly data: string;
  readonly hora: string;
  readonly convenio: number;
  readonly procedimento: number;
  readonly especialidade: number | null;
  readonly ato: number | null;
  readonly local: number | null;
  readonly unidade: number | null;
  readonly centroCusto: number | null;
  readonly cooperativa: number | null;
  readonly tipoLancamento: number | null;
  readonly tipoConta: 'E' | 'I';
  /** Executante do item (equipe da nota de sala, laudo, consulta); null: pendência. */
  readonly executante: number | null;
  /** Valores do item em reais. */
  readonly cobrado: number;
  readonly pago: number;
  readonly recursoDeferido: number;
  /** Item conciliado com o demonstrativo do convênio (M31). */
  readonly conciliado: boolean;
}

/** Linha da apuração gravada pelo outro sistema (valor faturado com valor), para o teste dourado. */
export interface LinhaGravadaRepasse {
  /** Id do item da produção. */
  readonly item: number;
  /** Id da regra; null quando a linha não guarda a regra. */
  readonly regra: number | null;
  readonly percentual: number;
  readonly valorCentavos: number;
}
