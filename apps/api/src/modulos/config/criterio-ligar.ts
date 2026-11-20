// Critério do setor ao ligar uma chave pela tela "Chaves de liberação" (M40, regras 1 e 2: quem liga em produção é a
// pessoa designada, pela tela de chaves). O critério de cada setor das ondas clínicas é calculado pelo módulo de
// coexistência (catálogo, itens registrados pelo comitê e teste de invasão); este registro é o ponto em que ele se
// apresenta ao módulo config sem que o config dependa da coexistência (fronteira dos módulos da API). Sem avaliador
// registrado, a chave de um setor da onda 2 não liga fora de dev/ci (falha fechada).
export const CRITERIO_LIGAR_SETOR = Symbol('CRITERIO_LIGAR_SETOR');

export interface ContextoCriterioLigar {
  readonly rede: string;
  readonly hospital: string;
}

/** O que falta para ligar a chave (null: pode ligar, ou a chave não é de setor da onda 2). */
export type AvaliadorLigarSetor = (
  c: ContextoCriterioLigar,
  tipo: 'recurso' | 'operacao',
  chave: string,
) => Promise<string | null>;

export interface CriterioLigarSetor {
  avaliar: AvaliadorLigarSetor | null;
  /**
   * M41 (regra 1 da onda 3): o que falta para ligar a dispensação ou a entrega (a prescrição eletrônica em uso nas
   * unidades atendidas), registrado pelo módulo do estoque. Vale em todo ambiente (é regra de negócio, não critério de
   * homologação); sem o avaliador, a chave da regra 1 não liga (falha fechada).
   */
  regraFarmacia: AvaliadorLigarSetor | null;
  /**
   * M58-F5 (regra 6): o que falta para ligar `entrada.utf8` (a conversão para UTF-8 autorizada, executada e verificada
   * na produção, com o banco e o parâmetro em UTF-8), registrado pelo módulo de coexistência. Vale em todo ambiente;
   * sem o avaliador, a chave não liga (falha fechada).
   */
  regraEntradaUtf8: ((c: ContextoCriterioLigar) => Promise<string | null>) | null;
  /** M41: o mapa da regra 1 (local → unidades atendidas e as que faltam) para o painel da onda 3. */
  mapaRegra1: ((c: ContextoCriterioLigar) => Promise<MapaRegra1>) | null;
}

export interface MapaRegra1 {
  readonly lido: boolean;
  readonly locais: readonly { local: number; unidades: string[]; faltam: string[] }[];
  readonly unidadesComPrescricao: readonly string[];
}

export function criterioLigarSetor(): CriterioLigarSetor {
  return { avaliar: null, regraFarmacia: null, regraEntradaUtf8: null, mapaRegra1: null };
}
