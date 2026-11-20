// Forma da regra de repasse e do item de produção como o motor (@sgh/dominio-repasse) os vê e a leitura do legado
// (@sgh/legado, repasse/repositorios) os entrega: TBREPGER, TBREPGER_TBCBOPRO e FCLANEXT traduzidos, com o "0" do outro
// sistema, que quer dizer "qualquer", como null. Sem dado de pessoa: só códigos e valores.
import type { BaseCalculoRepasse, BeneficiarioRegra, TipoContaRegra } from './vocabulario.js';

export interface RegraRepasse {
  /** TBREPGER.ID (ou o ID da versão em rascunho, negativo, no simulador). */
  readonly id: number;
  /** Início da vigência (TBREPGER.DATA), AAAA-MM-DD. */
  readonly vigencia: string;
  readonly beneficiario: BeneficiarioRegra;
  /** Profissional do vínculo (TBREPGER_TBCBOPRO.ID_TBCBOPRO), casado com o executante do item; null: qualquer. */
  readonly profissional: number | null;
  /**
   * Código do prestador (TBREPGER.COD; 103.957 regras com COD e 98.406 com vínculo no pc). Só informativo: o motor casa
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
  /** Janela de horário HHMM (TBREPGER.HORA_INI/HORA_FIN; no pc todas 0000–2359). */
  readonly horaInicial: string;
  readonly horaFinal: string;
  /** Percentual (até 4 casas) ou valor fixo em reais: um dos dois maior que zero. */
  readonly percentual: number;
  readonly valorFixo: number;
  readonly percentualFeriado: number;
  readonly percentualFimDeSemana: number;
  /** Base explícita da regra; null: a do parâmetro repasse.basePadrao. */
  readonly base: BaseCalculoRepasse | null;
  /** Evento de RPA (TBREPGER.ID_RPEVENTOS). */
  readonly evento: number | null;
}

/** Item faturado com o executante (FCLANEXT + FCCTAEXT; regra 5). */
export interface ItemProducao {
  /** FCLANEXT.ID. */
  readonly id: number;
  /** Data e hora da realização (AAAA-MM-DD e HHMM). */
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

/** Linha da apuração gravada pelo outro sistema (FCINTEGRPA, valor faturado com valor), para o teste dourado. */
export interface LinhaGravadaRepasse {
  /** FCLANEXT.ID. */
  readonly item: number;
  /** TBREPGER.ID; null quando a linha não guarda a regra. */
  readonly regra: number | null;
  readonly percentual: number;
  readonly valorCentavos: number;
}
