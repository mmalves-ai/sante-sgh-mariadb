// Porta das obrigações da operadora própria com a ANS (M56, etapa 7, F6): o que a tela dos envios lê e grava,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY (os envios, os itens, o histórico e o arquivo em
//     SGH_OPE_ENVIO_ANS*, as fontes de cada obrigação nas SGH_OPE_* das fatias anteriores e os domínios do banco:
//     CDMOTMOVIMCAD, PSSIBCAMPOALT, PSTPSVIGENCIA e TBSIPANSPROC) e as gravações SGH_OPE_ENVIO_ANS, _ITEM, _EVT e
//     SGH_OPE_BENEF_SIB numa transação SGH_ com a SGH_TRILHA junto; em dev sobre a cópia compartilhada, as gravações são
//     recusadas (`sghSoLeitura`), como nos outros módulos;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre as portas em memória da F1 (beneficiários), da F2 (cobrança) e
//     da F5 (contas médicas), com os domínios SINTÉTICOS; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Nenhuma tabela legada é escrita (seção 5 da ficha).
import type {
  AtivosLidos,
  BeneficiarioDaOperadoraLido,
  BeneficiarioRessarcimentoLido,
  BeneficiarioSibLido,
  CobrancaDiopsLida,
  ComplementoSibLido,
  ComplementoSibSgh,
  EnvioAnsLido,
  EnvioAnsResumoLido,
  EnvioExistenteLido,
  EventoEnvioAnsLido,
  FiltroEnviosLido,
  GeracaoEnvioSgh,
  GuiaMonitoramentoLida,
  ItemEnvioAnsLido,
  ItemSipLido,
  LinhaTrilha,
  ObrigacaoLida,
  OperadoraOpeLida,
  ResultadoItemSgh,
  TotaisEnviosLidos,
  VigenciaSipLida,
} from '@sgh/legado';

export const PORTA_ANS_OPERADORA = Symbol('PORTA_ANS_OPERADORA');

export interface ContextoAns {
  readonly rede: string;
  readonly hospital: string;
}

type SemHospital<T> = Omit<T, 'hospital'>;
type Feito = Promise<{ id: number; versao: number }>;

interface AcaoEnvio {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}

export interface ArquivoGravado {
  readonly nome: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly base64: string;
}

/** O que a gravação SGH_ dos envios faz dentro da transação (com a trilha junto). */
export interface GravadorAns {
  gerar(g: SemHospital<GeracaoEnvioSgh>): Feito;
  transmitir(a: AcaoEnvio & { recibo: string | null; arquivo?: ArquivoGravado | null; texto: string }): Feito;
  retorno(
    a: AcaoEnvio & {
      situacao: 'aceito' | 'aceitoParcial' | 'rejeitado';
      resumo: string | null;
      itens: readonly ResultadoItemSgh[];
      sib: boolean;
      texto: string;
    },
  ): Feito;
  pagar(a: AcaoEnvio & { gru: string; valor: number; data: string }): Feito;
  decidir(
    a: AcaoEnvio & {
      item: number;
      decisao: 'impugnar' | 'aceitar';
      motivo: string | null;
      justificativa: string | null;
      texto: string;
    },
  ): Feito;
  complemento(c: SemHospital<ComplementoSibSgh>): Feito;
}

export interface PortaAnsOperadora {
  readonly destino: 'legado' | 'memoria';
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoAns): Promise<{ hoje: string; agora: string }>;
  operadoras(c: ContextoAns): Promise<OperadoraOpeLida[]>;
  motivosSib(c: ContextoAns): Promise<{ codigo: number; nome: string; grupo: number }[]>;
  camposSib(c: ContextoAns): Promise<{ codigo: number; nome: string }[]>;
  valoresTps(c: ContextoAns): Promise<{ vigencia: string; valorAnual: number; valorTrimestral: number }[]>;
  gruposSip(c: ContextoAns): Promise<{ id: number; nome: string }[]>;
  envios(
    c: ContextoAns,
    f: FiltroEnviosLido,
  ): Promise<{ itens: EnvioAnsResumoLido[]; proxima: number | null }>;
  totais(c: ContextoAns): Promise<TotaisEnviosLidos>;
  envio(c: ContextoAns, id: number): Promise<EnvioAnsLido | null>;
  arquivo(c: ContextoAns, id: number): Promise<{ nome: string; base64: string; sha256: string } | null>;
  itens(c: ContextoAns, id: number): Promise<ItemEnvioAnsLido[]>;
  eventos(c: ContextoAns, id: number): Promise<EventoEnvioAnsLido[]>;
  existentes(
    c: ContextoAns,
    operadora: number,
    obrigacao: ObrigacaoLida,
    competencia: string,
  ): Promise<EnvioExistenteLido[]>;
  beneficiariosSib(
    c: ContextoAns,
    operadora: number,
    apos: number,
  ): Promise<{ itens: BeneficiarioSibLido[]; proxima: number | null }>;
  complementoSib(c: ContextoAns, beneficiario: number): Promise<ComplementoSibLido | null>;
  beneficiarioDaOperadora(c: ContextoAns, beneficiario: number): Promise<BeneficiarioDaOperadoraLido | null>;
  ativosNaData(c: ContextoAns, operadora: number, data: string): Promise<AtivosLidos[]>;
  planos(
    c: ContextoAns,
    operadora: number,
  ): Promise<{ produto: number; nome: string; registroAns: string | null }[]>;
  itensSip(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
    apos: number,
  ): Promise<{ itens: ItemSipLido[]; proxima: number | null }>;
  vigenciasSip(c: ContextoAns, procedimentos: readonly number[]): Promise<VigenciaSipLida[]>;
  cobrancasDiops(
    c: ContextoAns,
    operadora: number,
    meses: readonly string[],
    inicio: string,
    fim: string,
  ): Promise<CobrancaDiopsLida[]>;
  contasDiops(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
  ): Promise<{
    contas: {
      recebidaEm: string;
      apresentado: number;
      glosado: number;
      situacao: 'recebida' | 'analisada' | 'paga' | 'devolvida';
    }[];
    pagamentos: { pagoEm: string; valor: number }[];
  }>;
  guiasMonitoramento(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
    teto: number,
  ): Promise<GuiaMonitoramentoLida[]>;
  beneficiariosRessarcimento(
    c: ContextoAns,
    operadora: number,
    identificacoes: readonly string[],
  ): Promise<BeneficiarioRessarcimentoLido[]>;
  atendimentosJaCobrados(
    c: ContextoAns,
    atendimentos: readonly { tipo: string; numero: string }[],
  ): Promise<Set<string>>;
  gravarSgh<T>(
    c: ContextoAns,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorAns) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_ANS: ReadonlySet<string> = new Set([
  'relogio',
  'operadoras',
  'motivosSib',
  'camposSib',
  'valoresTps',
  'gruposSip',
  'envios',
  'totais',
  'envio',
  'arquivo',
  'itens',
  'eventos',
  'existentes',
  'beneficiariosSib',
  'complementoSib',
  'beneficiarioDaOperadora',
  'ativosNaData',
  'planos',
  'itensSip',
  'vigenciasSip',
  'cobrancasDiops',
  'contasDiops',
  'guiasMonitoramento',
  'beneficiariosRessarcimento',
  'atendimentosJaCobrados',
  'gravarSgh',
]);
