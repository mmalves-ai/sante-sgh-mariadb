// Porta das contas médicas recebidas pela operadora própria (M56, etapa 6, F5): o que a tela das contas lê e grava,
// independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY (os lotes, as guias, os itens e o histórico em
//     SGH_OPE_CONTA_*, as operadoras, o prestador pelo documento, o beneficiário pela carteirinha, as autorizações pela
//     senha, os auditores designados e os motivos de glosa da tabela 38 do banco do estabelecimento) e as gravações
//     SGH_OPE_CONTA, _GUIA, _ITEM e _EVT numa transação SGH_ com a SGH_TRILHA junto; em dev sobre a cópia compartilhada,
//     as gravações são recusadas (`sghSoLeitura`), como nos outros módulos;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre as portas em memória da F1 (beneficiários), da F3 (rede) e da
//     F4 (autorizações e auditores), com os motivos de glosa SINTÉTICOS; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Nenhuma tabela legada é escrita (seção 5 da ficha); os motivos de glosa são só lidos.
import type { MotivoGlosaLido } from '@sgh/contratos';
import type {
  AuditorLido,
  AutorizacaoDaSenhaLida,
  ContaOpeLida,
  ContaOpeResumoLida,
  DecisaoItemSgh,
  DecisaoRecursoItem,
  ElegibilidadeOpeLida,
  EventoContaOpeLido,
  FiltroContasLido,
  FiltroPagamentosLido,
  GlosaItemSgh,
  GuiaContaOpeLida,
  ItemContaOpeLido,
  ItemRecorridoSgh,
  LinhaTrilha,
  OperadoraOpeLida,
  PrestadorLido,
  RecebimentoContaSgh,
  RecursoItemLido,
  TotaisContasLidos,
} from '@sgh/legado';

export const PORTA_CONTAS_OPERADORA = Symbol('PORTA_CONTAS_OPERADORA');

export interface ContextoContas {
  readonly rede: string;
  readonly hospital: string;
}

type SemHospital<T> = Omit<T, 'hospital'>;

interface AcaoSgh {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}

type Feito = Promise<{ id: number; versao: number }>;

/** O que a gravação SGH_ das contas faz dentro da transação (com a trilha junto). */
export interface GravadorContas {
  proximoProtocolo(): Promise<number>;
  receber(r: SemHospital<RecebimentoContaSgh>): Feito;
  glosar(a: AcaoSgh & { itens: readonly GlosaItemSgh[]; texto: string; desfeita: boolean }): Feito;
  concluir(
    a: AcaoSgh & {
      auditor: number;
      situacao: 'analisada' | 'paga';
      observacao: string | null;
      texto: string;
    },
  ): Feito;
  devolver(a: AcaoSgh & { motivo: string }): Feito;
  registrarRecurso(
    a: AcaoSgh & { guia: number; valor: number; justificativa: string; situacao: 'analisada' | 'paga' },
  ): Feito;
  decidirRecurso(
    a: AcaoSgh & {
      guia: number;
      valorAcatado: number;
      situacaoRecurso: 'acatado' | 'parcial' | 'mantido';
      parecer: string;
      situacao: 'analisada' | 'paga';
    },
  ): Feito;
  pagar(
    a: AcaoSgh & { valor: number; data: string; documento: string; situacao: 'analisada' | 'paga' },
  ): Feito;
  /** W0-10 (M8): o recurso por item do prestador pelo portal (a guia recebe a soma; uma linha por item). */
  registrarRecursoItens(
    a: AcaoSgh & {
      guia: number;
      itens: readonly ItemRecorridoSgh[];
      justificativa: string;
      situacao: 'analisada' | 'paga';
      acesso: number;
    },
  ): Promise<{ id: number; versao: number; recursos: number[] }>;
  /** W0-10 (M8): a decisão do recurso por item (todos os itens de uma vez; a guia pela soma; outra pessoa). */
  decidirRecursoItens(
    a: AcaoSgh & {
      guia: number;
      decisoes: readonly DecisaoItemSgh[];
      parecer: string;
      situacao: 'analisada' | 'paga';
    },
  ): Promise<{ id: number; versao: number; decisao: DecisaoRecursoItem; valorAcatado: number }>;
}

export interface PortaContasOperadora {
  readonly destino: 'legado' | 'memoria';
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoContas): Promise<{ hoje: string; agora: string }>;
  operadoras(c: ContextoContas): Promise<OperadoraOpeLida[]>;
  /** Os prestadores da rede (o filtro da lista e o seletor). */
  prestadores(c: ContextoContas): Promise<{ id: number; nome: string }[]>;
  prestadorPorDocumento(c: ContextoContas, documento: string): Promise<PrestadorLido | null>;
  elegibilidade(c: ContextoContas, carteirinha: string): Promise<ElegibilidadeOpeLida | null>;
  autorizacoesPorSenha(c: ContextoContas, senhas: readonly string[]): Promise<AutorizacaoDaSenhaLida[]>;
  guiasJaApresentadas(c: ContextoContas, prestador: number, numeros: readonly string[]): Promise<Set<string>>;
  loteJaRecebido(
    c: ContextoContas,
    x: { operadora: number; prestador: number; numeroLote: string; sha256: string },
  ): Promise<boolean>;
  motivos(c: ContextoContas): Promise<MotivoGlosaLido[]>;
  designacoes(c: ContextoContas, login: string): Promise<AuditorLido[]>;
  contas(
    c: ContextoContas,
    f: FiltroContasLido,
  ): Promise<{ itens: ContaOpeResumoLida[]; proxima: number | null }>;
  totais(c: ContextoContas): Promise<TotaisContasLidos>;
  conta(c: ContextoContas, id: number): Promise<ContaOpeLida | null>;
  guias(c: ContextoContas, id: number): Promise<GuiaContaOpeLida[]>;
  itens(c: ContextoContas, id: number): Promise<ItemContaOpeLido[]>;
  eventos(c: ContextoContas, id: number): Promise<EventoContaOpeLido[]>;
  /** W0-10 (M8): os recursos por item do lote, com a decisão de cada um. */
  recursosItens(c: ContextoContas, id: number): Promise<RecursoItemLido[]>;
  pagamentos(
    c: ContextoContas,
    f: FiltroPagamentosLido,
  ): Promise<{ itens: ContaOpeResumoLida[]; proxima: number | null }>;
  gravarSgh<T>(
    c: ContextoContas,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorContas) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_CONTAS: ReadonlySet<string> = new Set([
  'relogio',
  'operadoras',
  'prestadores',
  'prestadorPorDocumento',
  'elegibilidade',
  'autorizacoesPorSenha',
  'guiasJaApresentadas',
  'loteJaRecebido',
  'motivos',
  'designacoes',
  'contas',
  'totais',
  'conta',
  'guias',
  'itens',
  'eventos',
  'recursosItens',
  'pagamentos',
  'gravarSgh',
]);
