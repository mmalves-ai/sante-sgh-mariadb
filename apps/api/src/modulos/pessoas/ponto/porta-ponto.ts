// Porta do ponto, fatia F4 (M52.4; ficha, seções 4 a 6): o que as telas do ponto leem e gravam, independente de onde (a
// API não escreve SQL; fronteira Nx). O colaborador vem da porta da gestão de pessoas e o previsto da porta da escala
// (plantões da escala publicada, regimes e vigências); aqui ficam o arquivo do relógio, as marcações, os ajustes, a
// trilha do período, o banco de horas, os domínios do ramo e os feriados:
//   - `banco`: o banco do cliente pelo @sgh/nucleo (porta-ponto-propria.ts), gravações com a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com os domínios sintéticos; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';
import type { CorrecaoRegistrada } from '../tipos-pessoas.js';
import type {
  AjustePonto,
  ArquivoRelogio,
  DominiosPonto,
  EventoDoPeriodo,
  FeriadoDoPeriodo,
  FiltroArquivosRelogio,
  GravacaoRegraBanco,
  MarcacaoRelogio,
  MovimentoBancoHoras,
  NovaMarcacaoRelogio,
  NovoAjustePonto,
  NovoArquivoRelogio,
  NovoEventoDoPeriodo,
  NovoMovimentoBancoHoras,
  RegraBancoDoRegime,
  VinculoDoCpf,
} from './tipos-ponto.js';

export type * from './tipos-ponto.js';

export const PORTA_PONTO = Symbol('PORTA_PONTO');

export type ContextoPonto = ContextoPortaM18;

/** As gravações da F4 numa transação só, com as releituras dentro dela. */
export interface GravadorPonto {
  arquivoPorHash(hash: string): Promise<ArquivoRelogio | null>;
  nsrsImportados(numeroRep: string, de: number, ate: number): Promise<Set<number>>;
  incluirArquivo(a: NovoArquivoRelogio): Promise<number>;
  /** null: a marcação ficou só no arquivo (CPF sem vínculo no estabelecimento). */
  incluirMarcacao(m: NovaMarcacaoRelogio): Promise<number | null>;
  marcacoes(cpfHmac: string, de: string, ate: string): Promise<MarcacaoRelogio[]>;
  ajuste(id: number): Promise<AjustePonto | null>;
  ajustes(vinculo: number, de: string, ate: string): Promise<AjustePonto[]>;
  incluirAjuste(a: NovoAjustePonto): Promise<number>;
  decidirAjuste(d: {
    id: number;
    versao: number;
    situacao: 'aprovado' | 'recusado';
    motivo: string | null;
    por: string;
  }): Promise<void>;
  eventosPeriodo(vinculo: number): Promise<EventoDoPeriodo[]>;
  incluirEventoPeriodo(p: NovoEventoDoPeriodo): Promise<number>;
  movimentosBanco(vinculo: number): Promise<MovimentoBancoHoras[]>;
  incluirMovimentoBanco(m: NovoMovimentoBancoHoras): Promise<number>;
  regrasBanco(): Promise<RegraBancoDoRegime[]>;
  gravarRegraBanco(r: GravacaoRegraBanco): Promise<number>;
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
  /** W0-06: o valor anterior e o novo na mesma transação da mudança. */
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
  /** Evento na saída de integração (outbox), na mesma transação (a folha do M53 consome o fechamento). */
  outbox(ev: { tipo: string; chave: string; carga: Record<string, string | number> }): Promise<string>;
}

export interface PortaPonto extends PortaGravacaoM18<GravadorPonto> {
  relogio(c: ContextoPonto): Promise<{ hoje: string; agora: string }>;
  dominios(c: ContextoPonto): Promise<DominiosPonto>;
  feriados(c: ContextoPonto, de: string, ate: string): Promise<FeriadoDoPeriodo[]>;
  arquivos(c: ContextoPonto, f: FiltroArquivosRelogio): Promise<ArquivoRelogio[]>;
  arquivo(c: ContextoPonto, id: number): Promise<ArquivoRelogio | null>;
  arquivosDoPeriodo(c: ContextoPonto, de: string, ate: string): Promise<ArquivoRelogio[]>;
  marcacoes(c: ContextoPonto, cpfHmac: string, de: string, ate: string): Promise<MarcacaoRelogio[]>;
  contagemMarcacoes(
    c: ContextoPonto,
    hmacs: readonly string[],
    de: string,
    ate: string,
  ): Promise<Map<string, number>>;
  hmacs(c: ContextoPonto, vinculos: readonly number[]): Promise<Map<number, string>>;
  ajustes(c: ContextoPonto, vinculo: number, de: string, ate: string): Promise<AjustePonto[]>;
  ajuste(c: ContextoPonto, id: number): Promise<AjustePonto | null>;
  pendentesPorVinculo(c: ContextoPonto, de: string, ate: string): Promise<Map<number, number>>;
  eventosPeriodo(c: ContextoPonto, vinculo: number): Promise<EventoDoPeriodo[]>;
  eventosDaCompetencia(c: ContextoPonto, competencia: string): Promise<EventoDoPeriodo[]>;
  regrasBanco(c: ContextoPonto): Promise<RegraBancoDoRegime[]>;
  /** W0-06: o histórico das mudanças dos registros de uma tabela. */
  correcoes(c: ContextoPonto, tabela: string, registros: readonly number[]): Promise<CorrecaoRegistrada[]>;
  movimentosBanco(c: ContextoPonto, vinculo: number): Promise<MovimentoBancoHoras[]>;
  saldosBanco(c: ContextoPonto, vinculos: readonly number[]): Promise<Map<number, number>>;
  vinculosDoLogin(c: ContextoPonto, login: string): Promise<number[]>;
  vinculosPorHmacs(c: ContextoPonto, hmacs: readonly string[]): Promise<Map<string, VinculoDoCpf[]>>;
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
