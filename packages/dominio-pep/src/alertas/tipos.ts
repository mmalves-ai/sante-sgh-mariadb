// Tipos do motor de alertas da prescrição (regras 4 a 8 da ficha do M24; cap-11 §11.2, "Alertas"): cada alerta é
// uma regra versionada (aviso, bloqueio com justificativa, bloqueio total) com vigência e autor; toda decisão do
// prescritor diante de alerta fica registrada. Os alertas do novo valem para quem prescreve no novo.
import type { NivelAlerta, TipoAlerta, TipoItemPrescricao } from '@sgh/contratos';

/** O que o motor sabe de um produto do cadastro (lido do banco do estabelecimento; nenhum dado de paciente). */
export interface ProdutoAlerta {
  readonly produto: number;
  readonly nome: string;
  readonly principiosAtivos: readonly number[];
  readonly padronizado: boolean;
  /** Marca de potencialmente perigoso do cadastro do item (alta vigilância, ISMP). */
  readonly altoAlerta: boolean;
  /** Lista da Portaria 344/98 (A1, B1, C1…) ou psicotrópico sem lista; null quando não controlado. */
  readonly controlado: string | null;
  readonly antimicrobiano: boolean;
  /** Faixa de dose do cadastro do item (por dose, na unidade de prescrição), quando o cadastro consiste a dose. */
  readonly doseMinima: number | null;
  readonly doseMaxima: number | null;
  /** Faixa de dose por unidade de prescrição (maiúsculas), do cadastro do item; vale antes da faixa única. */
  readonly faixasDose?: ReadonlyMap<
    string,
    { readonly minima: number | null; readonly maxima: number | null }
  >;
  /** Dose máxima nas 24 horas, quando conhecida. */
  readonly doseMaximaDia?: number | null;
  /** Período mínimo entre doses (horas), do cadastro do item. */
  readonly periodoMinimoHoras?: number | null;
  /** Vias aceitas pelo cadastro do item (vazio: o cadastro não restringe). */
  readonly viasPermitidas: readonly string[];
  /** Ajuste renal: clearance abaixo do qual a dose máxima muda. */
  readonly ajusteRenal?: { readonly clearanceAbaixoDe: number; readonly doseMaxima: number } | null;
}

/** Item como o motor avalia (normalizado de qualquer tipo; uma linha por produto do item). */
export interface ItemAvaliado {
  readonly chave: string;
  readonly tipo: TipoItemPrescricao;
  readonly produtos: readonly {
    readonly produto: ProdutoAlerta;
    readonly dose: number | null;
    readonly unidade: string | null;
  }[];
  readonly via: string | null;
  readonly dosesNoPeriodo: number;
  readonly intervaloHoras: number | null;
  readonly aCriterio: boolean;
  readonly seNecessario: {
    readonly motivos: readonly number[];
    readonly intervaloMinimoHoras: number;
  } | null;
  readonly fichaAntimicrobiano: boolean;
  /** Item de outra prescrição ativa no período (para a duplicidade e a interação), ou do próprio rascunho. */
  readonly existente?: boolean;
}

export interface AlergiaAtiva {
  readonly alergia: number;
  readonly nome: string;
  /** Princípios ativos ligados à alergia (o cadastro de alergias × princípios). */
  readonly principios: readonly number[];
}

export interface ParInteracao {
  readonly a: number;
  readonly b: number;
  readonly gravidade: 'leve' | 'moderada' | 'grave' | 'contraindicada';
  readonly efeito: string;
}

export interface RegraAlerta {
  readonly codigo: string;
  readonly tipo: TipoAlerta;
  readonly nivel: NivelAlerta;
  readonly versao: number;
  /** Vigência (AAAA-MM-DD); a mais recente vigente vale. */
  readonly vigenteDesde: string;
  readonly ativa: boolean;
  readonly descricao: string;
}

export interface ContextoAlertas {
  readonly alergias: readonly AlergiaAtiva[];
  /** Itens já ativos no período (outras prescrições do atendimento), para duplicidade e interação. */
  readonly ativos: readonly ItemAvaliado[];
  readonly paciente: {
    readonly clearance: number | null;
    readonly pesoKg: number | null;
  };
  readonly tipoAtendimento: 'I' | 'E' | 'U' | 'A';
  readonly alta: boolean;
  readonly regras: readonly RegraAlerta[];
  /** Base de interações de terceiros (null: não contratada; nenhum par é inventado). */
  readonly interacoes: readonly ParInteracao[] | null;
  /** Critério do legado (validação de duplicidade: 1 medicamento, 2 princípio ativo) e se o parâmetro consiste. */
  readonly duplicidade: {
    readonly porMedicamento: boolean;
    readonly porPrincipio: boolean;
    readonly consistir: boolean;
  };
  /** Itens da lista de alta vigilância do hospital (além da marca do cadastro). */
  readonly altaVigilancia: ReadonlySet<number>;
  /** Dieta ativa no período feita por outro profissional (uma só dieta ativa por paciente e período). */
  readonly dietaDeOutro: {
    readonly autor: string;
    readonly prescricao?: number;
    readonly item?: number;
  } | null;
  /** Cobertura do convênio por produto (ausente: sem informação, nenhum alerta). */
  readonly cobertura?: ReadonlyMap<number, boolean>;
  readonly hoje: string;
}

export interface AlertaGerado {
  readonly id: string;
  readonly item: string;
  readonly tipo: TipoAlerta;
  readonly titulo: string;
  readonly detalhe: string;
  /** O item de outra prescrição a que o alerta se refere (a dieta ativa de outro profissional). */
  readonly referencia?: { readonly prescricao: number; readonly item: number };
  /** Nível sugerido pela natureza do achado (a regra vigente pode ser mais branda ou mais dura). */
  readonly gravidade?: 'leve' | 'moderada' | 'grave' | 'contraindicada';
}
