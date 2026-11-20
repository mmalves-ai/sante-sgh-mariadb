// Porta da autorização de guias e da auditoria médica da operadora própria (M56, etapa 5, F4): o que a tela das
// autorizações lê e grava, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY (os pedidos e os auditores em SGH_OPE_*, o beneficiário
//     pela carteirinha, os prestadores da rede, os domínios, a terminologia TUSS e o CID do banco do estabelecimento) e as
//     gravações SGH_OPE_AUTORIZACAO, _ITEM, _EVT e SGH_OPE_AUDITOR numa transação SGH_ com a SGH_TRILHA junto; em dev
//     sobre a cópia compartilhada, as gravações são recusadas (`sghSoLeitura`), como nos outros módulos;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre as portas em memória da F1 (beneficiários) e da F3 (rede),
//     com domínios, terminologia e CID SINTÉTICOS; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Nenhuma tabela legada é escrita (seção 5 da ficha); os domínios, a terminologia e o CID são só lidos.
import type {
  AnexoComplementoLido,
  AuditorLido,
  AutorizacaoLida,
  AutorizacaoResumoLida,
  DecisaoSgh,
  DesignacaoSgh,
  DominioAutorizacao,
  ElegibilidadeOpeLida,
  EventoAutorizacaoSghLido,
  FiltroAutorizacoesLido,
  ItemAutorizacaoLido,
  ItemDominioAutorizacaoLido,
  LinhaTrilha,
  OperadoraOpeLida,
  PrestadorLido,
  PrestadorParaAutorizacaoLido,
  ProcedimentoTussLido,
  RegistroAutorizacaoSgh,
  TotaisAutorizacoesLidos,
} from '@sgh/legado';

export const PORTA_AUTORIZACAO_OPERADORA = Symbol('PORTA_AUTORIZACAO_OPERADORA');

export interface ContextoAutorizacao {
  readonly rede: string;
  readonly hospital: string;
}

type SemHospital<T> = Omit<T, 'hospital'>;

interface AcaoSgh {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}

/** O que a gravação SGH_ da autorização faz dentro da transação (com a trilha junto). */
export interface GravadorAutorizacao {
  proximoProtocolo(): Promise<number>;
  proximaSenha(): Promise<number>;
  registrar(r: SemHospital<RegistroAutorizacaoSgh>): Promise<{ id: number; versao: number }>;
  pedirComplemento(a: AcaoSgh & { pedido: string }): Promise<{ id: number; versao: number }>;
  responderComplemento(a: AcaoSgh & { resposta: string }): Promise<{ id: number; versao: number }>;
  /** W0-10: a resposta do prestador pelo portal, com anexos (SGH_OPE_AUT_ANEXO), só a autorização dele. */
  responderComplementoPortal(
    a: AcaoSgh & {
      prestador: number;
      acesso: number;
      resposta: string;
      anexos: readonly { nome: string; bytes: Uint8Array }[];
    },
  ): Promise<{ id: number; versao: number; evento: number; anexos: number[] }>;
  abrirJunta(
    a: AcaoSgh & {
      divergencia: string;
      desempatador: { nome: string; crm: string; uf: string };
      notificadosEm: string;
    },
  ): Promise<{ id: number; versao: number }>;
  decidir(d: SemHospital<DecisaoSgh>): Promise<{ id: number; versao: number }>;
  cancelar(a: AcaoSgh & { motivo: string }): Promise<{ id: number; versao: number }>;
  designar(d: SemHospital<DesignacaoSgh>): Promise<{ id: number }>;
  /** W0-10: com pedidos em análise do auditor, só com `redistribuirPara` (senão 409 auditor-com-autorizacoes). */
  encerrar(
    a: AcaoSgh & { motivo: string; redistribuirPara?: number | null },
  ): Promise<{ id: number; redistribuidos: number }>;
  /** W0-10: os dados da designação ativa, sobre a versão vista. */
  alterar(
    a: AcaoSgh & {
      nome: string;
      categoria: 'medico' | 'enfermeiro';
      conselho: string;
      numero: string;
      uf: string;
      motivo: string;
    },
  ): Promise<{ id: number; versao: number }>;
}

export interface PortaAutorizacaoOperadora {
  readonly destino: 'legado' | 'memoria';
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoAutorizacao): Promise<{ hoje: string; agora: string }>;
  dominios(c: ContextoAutorizacao): Promise<Record<DominioAutorizacao, ItemDominioAutorizacaoLido[]>>;
  operadoras(c: ContextoAutorizacao): Promise<OperadoraOpeLida[]>;
  prestadores(c: ContextoAutorizacao): Promise<PrestadorParaAutorizacaoLido[]>;
  prestador(c: ContextoAutorizacao, id: number): Promise<PrestadorLido | null>;
  elegibilidade(c: ContextoAutorizacao, carteirinha: string): Promise<ElegibilidadeOpeLida | null>;
  procedimentosTuss(c: ContextoAutorizacao, codigos: readonly string[]): Promise<ProcedimentoTussLido[]>;
  buscarTuss(c: ContextoAutorizacao, termo: string): Promise<ProcedimentoTussLido[]>;
  nomeDoCid(c: ContextoAutorizacao, codigo: string): Promise<string | null>;
  autorizacoes(
    c: ContextoAutorizacao,
    f: FiltroAutorizacoesLido,
  ): Promise<{ itens: AutorizacaoResumoLida[]; proxima: number | null }>;
  totais(c: ContextoAutorizacao): Promise<TotaisAutorizacoesLidos>;
  autorizacao(c: ContextoAutorizacao, id: number): Promise<AutorizacaoLida | null>;
  itens(c: ContextoAutorizacao, id: number): Promise<ItemAutorizacaoLido[]>;
  eventos(c: ContextoAutorizacao, id: number): Promise<EventoAutorizacaoSghLido[]>;
  /** W0-10: os anexos das respostas ao complemento (sem o conteúdo) e um anexo com o conteúdo (do prestador, se dado). */
  anexosDoComplemento(c: ContextoAutorizacao, id: number): Promise<AnexoComplementoLido[]>;
  anexoDoComplemento(
    c: ContextoAutorizacao,
    anexo: number,
    prestador?: number,
  ): Promise<{ autorizacao: number; nome: string; tipo: string; sha256: string; bytes: Buffer } | null>;
  auditores(c: ContextoAutorizacao): Promise<AuditorLido[]>;
  auditor(c: ContextoAutorizacao, id: number): Promise<AuditorLido | null>;
  designacoes(c: ContextoAutorizacao, login: string): Promise<AuditorLido[]>;
  gravarSgh<T>(
    c: ContextoAutorizacao,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorAutorizacao) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_AUTORIZACAO: ReadonlySet<string> = new Set([
  'relogio',
  'dominios',
  'operadoras',
  'prestadores',
  'prestador',
  'elegibilidade',
  'procedimentosTuss',
  'buscarTuss',
  'nomeDoCid',
  'autorizacoes',
  'totais',
  'autorizacao',
  'itens',
  'eventos',
  'anexosDoComplemento',
  'anexoDoComplemento',
  'auditores',
  'auditor',
  'designacoes',
  'gravarSgh',
]);
