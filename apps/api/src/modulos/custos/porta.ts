// Porta da estrutura de custos, das estatísticas e da apuração (M54, etapas 4 e 5): lê os centros de custo do
// estabelecimento com a classificação para o custeio, os domínios de custos, as fontes agregadas da competência e as
// estatísticas; grava a classificação e as estatísticas com a trilha na mesma transação.
//   - própria (`porta-propria.ts`): o banco do cliente pelo @sgh/nucleo (centro_custo, classificacao_centro_custo,
//     tipo_dado_estatistico, unidade_mensuracao_custo, grupo_exportacao_custo, estatistica_centro_mes, apuracao_custo);
//   - `memoria`: a sessão sintética de dev/ci (E2E), centros e fontes sintéticos por estabelecimento;
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
import type {
  ApuracaoCustosRegistrada,
  ApuracaoParaGravar,
  CentroCustoCadastrado,
  ClassificacaoParaGravar,
  CodigosExportacao,
  ColetaParaGravar,
  ColetaRegistrada,
  ContextoCustos,
  CustoContaApuracao,
  DominiosCustos,
  EstatisticaRegistrada,
  FiltroContasCusto,
  FontesCusteio,
  FontesEstatistica,
  GrupoResultadoApurado,
  LancamentoEstatisticaParaGravar,
  LinhaCentroApuracao,
  PeriodoCusteio,
  TrilhaCustos,
} from './tipos.js';

export type { ContextoCustos } from './tipos.js';

export const PORTA_CUSTOS = Symbol('PORTA_CUSTOS');

export interface PortaCustos {
  readonly destino: 'banco' | 'memoria' | 'indisponivel';
  centros(c: ContextoCustos): Promise<CentroCustoCadastrado[]>;
  centro(c: ContextoCustos, id: number): Promise<CentroCustoCadastrado | null>;
  dominios(c: ContextoCustos): Promise<DominiosCustos>;
  fontes(
    c: ContextoCustos,
    intervalo: { readonly inicio: string; readonly fim: string; readonly seguinte: string },
  ): Promise<FontesEstatistica>;
  estatisticas(
    c: ContextoCustos,
    competencia: string,
  ): Promise<{ registros: EstatisticaRegistrada[]; truncado: boolean }>;
  ultimaColeta(c: ContextoCustos, competencia: string): Promise<ColetaRegistrada | null>;
  /** Classifica ou reclassifica o centro, com a trilha na mesma transação (só quando mudou). */
  classificar(
    c: ContextoCustos,
    x: ClassificacaoParaGravar,
    por: string,
    trilha: TrilhaCustos,
  ): Promise<{ antes: CentroCustoCadastrado; depois: CentroCustoCadastrado; mudou: boolean } | null>;
  gravarColeta(
    c: ContextoCustos,
    x: ColetaParaGravar,
    por: string,
    trilha: TrilhaCustos,
  ): Promise<{ id: number; gravadas: number; substituidas: number }>;
  lancar(
    c: ContextoCustos,
    x: LancamentoEstatisticaParaGravar,
    por: string,
    trilha: TrilhaCustos,
  ): Promise<{ registro: EstatisticaRegistrada; substituidas: number }>;

  // ── Etapa 5: apuração do custo do mês, custo por conta e resultado ──
  /** As fontes do custeio da competência, agregadas no banco (READ ONLY). */
  fontesCusteio(c: ContextoCustos, p: PeriodoCusteio): Promise<FontesCusteio>;
  codigosExportacao(c: ContextoCustos): Promise<CodigosExportacao>;
  nomesConvenios(c: ContextoCustos, codigos: readonly number[]): Promise<Map<number, string>>;
  apuracoes(c: ContextoCustos, competencia: string): Promise<ApuracaoCustosRegistrada[]>;
  apuracao(c: ContextoCustos, id: number): Promise<ApuracaoCustosRegistrada | null>;
  linhasApuracao(c: ContextoCustos, id: number): Promise<LinhaCentroApuracao[]>;
  contasApuracao(
    c: ContextoCustos,
    id: number,
    f: FiltroContasCusto,
  ): Promise<{ total: number; contas: CustoContaApuracao[] }>;
  resultadoAgrupado(
    c: ContextoCustos,
    id: number,
    agrupamento: 'convenio' | 'procedimento' | 'tipoConta' | 'paciente',
  ): Promise<GrupoResultadoApurado[]>;
  /** Grava a apuração (substitui a vigente pela versão), com a trilha na mesma transação. */
  gravarApuracao(
    c: ContextoCustos,
    x: ApuracaoParaGravar,
    por: string,
    trilha: TrilhaCustos,
  ): Promise<{ apuracao: ApuracaoCustosRegistrada; substituida: number | null }>;
  aprovarApuracao(
    c: ContextoCustos,
    id: number,
    versao: number,
    por: string,
    trilha: TrilhaCustos,
  ): Promise<{ antes: ApuracaoCustosRegistrada; depois: ApuracaoCustosRegistrada } | null>;
}
