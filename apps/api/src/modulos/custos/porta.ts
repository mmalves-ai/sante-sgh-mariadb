// Porta da estrutura de custos e das estatísticas (M54, etapa 4): lê os centros de custo onde estão (com a
// classificação do Sante), os domínios de custos, as fontes agregadas da competência e os registros de estatística; grava
// só SGH_CUS_* numa transação SGH_, com a SGH_TRILHA junto.
//   - `legado`: @sgh/legado (TBCENCUS e as fontes READ ONLY; SGH_CUS_CENTRO, SGH_CUS_ESTATISTICA e SGH_CUS_COLETA);
//   - `memoria`: a sessão sintética de dev/ci (E2E), centros e fontes sintéticos por estabelecimento;
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
import type {
  ApuracaoCustosLida,
  ApuracaoParaGravar,
  CodigosExportacaoLidos,
  CustoContaLido,
  FiltroContasCusto,
  FontesCusteioLidas,
  GrupoResultadoLido,
  LinhaCentroLida,
  PeriodoCusteio,
  CentroCustoEstruturaLido,
  ClassificacaoParaGravar,
  ColetaLida,
  ColetaParaGravar,
  DominiosCustosLidos,
  EstatisticaLida,
  FontesEstatisticaLidas,
  LancamentoEstatisticaParaGravar,
  LinhaTrilha,
} from '@sgh/legado';

export const PORTA_CUSTOS = Symbol('PORTA_CUSTOS');

export interface ContextoCustos {
  readonly rede: string;
  readonly hospital: string;
}

export interface PortaCustos {
  readonly destino: 'legado' | 'memoria' | 'indisponivel';
  centros(c: ContextoCustos): Promise<CentroCustoEstruturaLido[]>;
  centro(c: ContextoCustos, id: number): Promise<CentroCustoEstruturaLido | null>;
  dominios(c: ContextoCustos): Promise<DominiosCustosLidos>;
  fontes(
    c: ContextoCustos,
    intervalo: { readonly inicio: string; readonly fim: string; readonly seguinte: string },
  ): Promise<FontesEstatisticaLidas>;
  estatisticas(
    c: ContextoCustos,
    competencia: string,
  ): Promise<{ registros: EstatisticaLida[]; truncado: boolean }>;
  ultimaColeta(c: ContextoCustos, competencia: string): Promise<ColetaLida | null>;
  /** Classifica ou reclassifica o centro, com a trilha na mesma transação (só quando mudou). */
  classificar(
    c: ContextoCustos,
    x: ClassificacaoParaGravar,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ antes: CentroCustoEstruturaLido; depois: CentroCustoEstruturaLido; mudou: boolean } | null>;
  gravarColeta(
    c: ContextoCustos,
    x: ColetaParaGravar,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ id: number; gravadas: number; substituidas: number }>;
  lancar(
    c: ContextoCustos,
    x: LancamentoEstatisticaParaGravar,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ registro: EstatisticaLida; substituidas: number }>;

  // ── Etapa 5: apuração do custo do mês, custo por conta e resultado ──
  /** As fontes do custeio da competência, agregadas no banco (READ ONLY). */
  fontesCusteio(c: ContextoCustos, p: PeriodoCusteio): Promise<FontesCusteioLidas>;
  codigosExportacao(c: ContextoCustos): Promise<CodigosExportacaoLidos>;
  nomesConvenios(c: ContextoCustos, codigos: readonly number[]): Promise<Map<number, string>>;
  apuracoes(c: ContextoCustos, competencia: string): Promise<ApuracaoCustosLida[]>;
  apuracao(c: ContextoCustos, id: number): Promise<ApuracaoCustosLida | null>;
  linhasApuracao(c: ContextoCustos, id: number): Promise<LinhaCentroLida[]>;
  contasApuracao(
    c: ContextoCustos,
    id: number,
    f: FiltroContasCusto,
  ): Promise<{ total: number; contas: CustoContaLido[] }>;
  resultadoAgrupado(
    c: ContextoCustos,
    id: number,
    agrupamento: 'convenio' | 'procedimento' | 'tipoConta' | 'paciente',
  ): Promise<GrupoResultadoLido[]>;
  /** Grava a apuração (substitui a vigente pela versão), com a trilha na mesma transação. */
  gravarApuracao(
    c: ContextoCustos,
    x: ApuracaoParaGravar,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ apuracao: ApuracaoCustosLida; substituida: number | null }>;
  aprovarApuracao(
    c: ContextoCustos,
    id: number,
    versao: number,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ antes: ApuracaoCustosLida; depois: ApuracaoCustosLida } | null>;
}
