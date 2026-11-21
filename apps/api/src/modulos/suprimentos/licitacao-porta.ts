// Porta do processo formal de compra (M55, etapa 4; ficha, seções 4, 5 e 7), independente de onde (a API não escreve
// SQL; fronteira Nx):
//   - `legado`: as leituras READ ONLY (SGH_SUP_LICITACAO*, os pedidos de compra marcados como licitação, o pedido ligado
//     pelo ID, os fornecedores); as gravações numa transação SGH_ com a SGH_TRILHA junto (o processo travado pela versão
//     e as regras conferidas sobre o estado relido na MESMA transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas, sobre fornecedores e pedidos
//     sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Nada é gravado em tabela do legado: o pedido de compra nasce pela tela de compras (suprimentos.criarPedido) e é só
// ligado ao processo.
import type {
  AlterarLicitacaoEntrada,
  AvancarLicitacaoEntrada,
  CriarLicitacaoEntrada,
  DescartarPrecoLicitacaoEntrada,
  EncerrarLicitacaoEntrada,
  EtapaLicitacao,
  FiltroLicitacoes,
  HomologarLicitacaoEntrada,
  LicitacaoDetalhe,
  LicitacaoResumo,
  PainelLicitacoes,
  ParametrosLicitacao,
  PedidoMarcadoLicitacao,
  RegistrarEventoLicitacaoEntrada,
  RegistrarPrecoLicitacaoEntrada,
  RegistrarPropostaLicitacaoEntrada,
  SituacaoPropostaLicitacaoEntrada,
} from '@sgh/contratos';
import type { DocumentoEmitidoLicitacao } from '@sgh/contratos/regras-suprimentos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';
import type { FornecedorContrato, UsuarioContrato } from './contrato-porta.js';

export const PORTA_LICITACAO = Symbol('PORTA_LICITACAO');

interface Base {
  readonly usuario: string;
  readonly parametros: ParametrosLicitacao;
}

/** O resultado comum das gravações do processo. */
export interface LicitacaoGravacao {
  readonly licitacao: number;
  /** O registro gravado (o processo, o preço, a proposta ou o evento). */
  readonly registro: number;
  readonly etapa: EtapaLicitacao;
  readonly repetido: boolean;
}

/** As gravações numa transação, com a trilha junto. */
export interface GravadorLicitacao {
  criar(m: Base & { entrada: CriarLicitacaoEntrada }): Promise<LicitacaoGravacao>;
  alterar(m: Base & { id: number; entrada: AlterarLicitacaoEntrada }): Promise<LicitacaoGravacao>;
  preco(m: Base & { licitacao: number; entrada: RegistrarPrecoLicitacaoEntrada }): Promise<LicitacaoGravacao>;
  /** O descarte de um preço da pesquisa, com a justificativa (fora da conta; o preço fica gravado). */
  descartarPreco(
    m: Base & { licitacao: number; preco: number; entrada: DescartarPrecoLicitacaoEntrada },
  ): Promise<LicitacaoGravacao>;
  proposta(
    m: Base & { licitacao: number; entrada: RegistrarPropostaLicitacaoEntrada },
  ): Promise<LicitacaoGravacao>;
  situacaoProposta(
    m: Base & { licitacao: number; proposta: number; entrada: SituacaoPropostaLicitacaoEntrada },
  ): Promise<LicitacaoGravacao>;
  avancar(m: Base & { licitacao: number; entrada: AvancarLicitacaoEntrada }): Promise<LicitacaoGravacao>;
  homologar(m: Base & { licitacao: number; entrada: HomologarLicitacaoEntrada }): Promise<LicitacaoGravacao>;
  encerrar(m: Base & { licitacao: number; entrada: EncerrarLicitacaoEntrada }): Promise<LicitacaoGravacao>;
  evento(
    m: Base & { licitacao: number; entrada: RegistrarEventoLicitacaoEntrada },
  ): Promise<LicitacaoGravacao>;
  /** Regra 10: o documento emitido ligado ao processo (o evento `documento`; não muda a etapa nem a versão). */
  documento(m: {
    licitacao: number;
    documento: DocumentoEmitidoLicitacao;
    usuario: string;
  }): Promise<LicitacaoGravacao>;
}

export interface PortaLicitacao extends PortaGravacaoM18<GravadorLicitacao> {
  listar(
    c: ContextoPortaM18,
    f: FiltroLicitacoes,
  ): Promise<{ hoje: string; itens: LicitacaoResumo[]; pagina: number; cortada: boolean }>;
  detalhar(
    c: ContextoPortaM18,
    id: number,
    o: { parametros: ParametrosLicitacao; usuario: string; conduz: boolean },
  ): Promise<LicitacaoDetalhe | null>;
  painel(c: ContextoPortaM18): Promise<PainelLicitacoes>;
  /** Os pedidos de compra marcados como licitação no cadastro de pedidos (a consulta inteira, sem teto). */
  pedidosMarcados(c: ContextoPortaM18): Promise<PedidoMarcadoLicitacao[]>;
  /** Os fornecedores do cadastro pelo nome ou código (a busca da tela). */
  fornecedores(
    c: ContextoPortaM18,
    termo: string,
  ): Promise<{ itens: FornecedorContrato[]; cortada: boolean }>;
  /** Os usuários ativos e sem bloqueio (o agente de contratação; teto de 50). */
  usuarios(c: ContextoPortaM18, termo: string): Promise<UsuarioContrato[]>;
}

export const METODOS_PORTA_LICITACAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'listar',
  'detalhar',
  'painel',
  'pedidosMarcados',
  'fornecedores',
  'usuarios',
]);
