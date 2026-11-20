// Porta do ponto, fatia F4 (M52.4; ficha, seções 4 a 6): o que as telas do ponto leem e gravam, independente de onde (a
// API não escreve SQL; fronteira Nx). O colaborador vem da porta da gestão de pessoas e o previsto da porta da escala
// (plantões da escala publicada, regimes e vigências); aqui ficam o arquivo do relógio, as marcações, os ajustes, a
// trilha do período, o banco de horas, os domínios do ramo e os feriados:
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações numa transação só SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com os domínios sintéticos; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  AjustePontoLido,
  ArquivoAfdLido,
  FiltroArquivosAfdSgh,
  DominiosPonto,
  EventoPeriodoLidoSgh,
  FeriadoLido,
  MarcacaoPontoLida,
  MovimentoBancoLidoSgh,
  NovaMarcacaoSgh,
  NovoAjustePontoSgh,
  NovoArquivoAfdSgh,
  NovoEventoPeriodoSgh,
  NovoMovimentoBancoSgh,
  RegraBancoLida,
  CorrecaoPesLida,
  RegraBancoSgh,
  VinculoPorHmacLido,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_PONTO = Symbol('PORTA_PONTO');

export type ContextoPonto = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações SGH_ da F4 numa transação só SGH_, com as releituras dentro dela. */
export interface GravadorPonto {
  arquivoPorHash(hash: string): Promise<ArquivoAfdLido | null>;
  nsrsImportados(numeroRep: string, de: number, ate: number): Promise<Set<number>>;
  incluirArquivo(a: SemHospital<NovoArquivoAfdSgh>): Promise<number>;
  incluirMarcacao(m: SemHospital<NovaMarcacaoSgh>): Promise<number>;
  marcacoes(cpfHmac: string, de: string, ate: string): Promise<MarcacaoPontoLida[]>;
  ajuste(id: number): Promise<AjustePontoLido | null>;
  ajustes(vinculo: number, de: string, ate: string): Promise<AjustePontoLido[]>;
  incluirAjuste(a: SemHospital<NovoAjustePontoSgh>): Promise<number>;
  decidirAjuste(d: {
    id: number;
    versao: number;
    situacao: 'aprovado' | 'recusado';
    motivo: string | null;
    por: string;
  }): Promise<void>;
  eventosPeriodo(vinculo: number): Promise<EventoPeriodoLidoSgh[]>;
  incluirEventoPeriodo(p: SemHospital<NovoEventoPeriodoSgh>): Promise<number>;
  movimentosBanco(vinculo: number): Promise<MovimentoBancoLidoSgh[]>;
  incluirMovimentoBanco(m: SemHospital<NovoMovimentoBancoSgh>): Promise<number>;
  regrasBanco(): Promise<RegraBancoLida[]>;
  gravarRegraBanco(r: SemHospital<RegraBancoSgh>): Promise<number>;
  /** W0-06: desistência do ajuste pendente pelo próprio solicitante (o banco confere quem pediu). */
  desistirAjuste(d: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
  /** W0-06: desativa ou reativa a regra do banco do regime (versão lida), com o motivo. */
  situacaoRegraBanco(s: {
    regime: number;
    versao: number;
    ativo: boolean;
    motivo: string;
    por: string;
  }): Promise<number>;
  /** W0-06: o valor anterior e o novo (SGH_PES_CORRECAO), na mesma transação da mudança. */
  registrarCorrecao(x: {
    tabela: string;
    registro: number;
    operacao: string;
    antes: Record<string, unknown>;
    depois: Record<string, unknown>;
    motivo: string;
    por: string;
  }): Promise<void>;
  /** Trava a pessoa do vínculo até o fim da transação (fechamento e ajuste simultâneos do mesmo colaborador). */
  travarPessoa(pessoa: number): Promise<void>;
  /** Evento na SGH_OUTBOX, na mesma transação (a folha do M53 consome o fechamento). */
  outbox(ev: { tipo: string; chave: string; carga: Record<string, string | number> }): Promise<string>;
}

export interface PortaPonto extends PortaGravacaoM18<GravadorPonto> {
  relogio(c: ContextoPonto): Promise<{ hoje: string; agora: string }>;
  dominios(c: ContextoPonto): Promise<DominiosPonto>;
  feriados(c: ContextoPonto, de: string, ate: string): Promise<FeriadoLido[]>;
  arquivos(c: ContextoPonto, f: FiltroArquivosAfdSgh): Promise<ArquivoAfdLido[]>;
  arquivo(c: ContextoPonto, id: number): Promise<ArquivoAfdLido | null>;
  arquivosDoPeriodo(c: ContextoPonto, de: string, ate: string): Promise<ArquivoAfdLido[]>;
  marcacoes(c: ContextoPonto, cpfHmac: string, de: string, ate: string): Promise<MarcacaoPontoLida[]>;
  contagemMarcacoes(
    c: ContextoPonto,
    hmacs: readonly string[],
    de: string,
    ate: string,
  ): Promise<Map<string, number>>;
  hmacs(c: ContextoPonto, vinculos: readonly number[]): Promise<Map<number, string>>;
  ajustes(c: ContextoPonto, vinculo: number, de: string, ate: string): Promise<AjustePontoLido[]>;
  ajuste(c: ContextoPonto, id: number): Promise<AjustePontoLido | null>;
  pendentesPorVinculo(c: ContextoPonto, de: string, ate: string): Promise<Map<number, number>>;
  eventosPeriodo(c: ContextoPonto, vinculo: number): Promise<EventoPeriodoLidoSgh[]>;
  eventosDaCompetencia(c: ContextoPonto, competencia: string): Promise<EventoPeriodoLidoSgh[]>;
  regrasBanco(c: ContextoPonto): Promise<RegraBancoLida[]>;
  /** W0-06: o histórico das mudanças (SGH_PES_CORRECAO) dos registros de uma tabela. */
  correcoes(c: ContextoPonto, tabela: string, registros: readonly number[]): Promise<CorrecaoPesLida[]>;
  movimentosBanco(c: ContextoPonto, vinculo: number): Promise<MovimentoBancoLidoSgh[]>;
  saldosBanco(c: ContextoPonto, vinculos: readonly number[]): Promise<Map<number, number>>;
  vinculosDoLogin(c: ContextoPonto, login: string): Promise<number[]>;
  vinculosPorHmacs(c: ContextoPonto, hmacs: readonly string[]): Promise<Map<string, VinculoPorHmacLido[]>>;
}

export const METODOS_PORTA_PONTO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'dominios',
  'feriados',
  'arquivos',
  'arquivo',
  'arquivosDoPeriodo',
  'marcacoes',
  'contagemMarcacoes',
  'hmacs',
  'ajustes',
  'ajuste',
  'pendentesPorVinculo',
  'eventosPeriodo',
  'eventosDaCompetencia',
  'regrasBanco',
  'correcoes',
  'movimentosBanco',
  'saldosBanco',
  'vinculosDoLogin',
  'vinculosPorHmacs',
]);
