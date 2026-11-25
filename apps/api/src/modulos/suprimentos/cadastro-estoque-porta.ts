// Porta do cadastro do estoque (F3.6, 05-SUP linhas 1, 3 e 6): o item (material e medicamento) com unidades,
// princípios ativos, vias, códigos de barras, apresentações com registro sanitário e estabilidades; o local de estoque
// com setores atendidos e classificação; o escopo do usuário por local, classificação e centro de custo; e a lista de
// separação da requisição a atender. Só a porta própria (MariaDB) grava no banco; em dev/ci com as fontes sintéticas,
// a porta em memória (`cadastro-estoque-porta-memoria.ts`); fora disso, a indisponível (503).
import type {
  ItemEstoqueEntrada,
  LinhaSeparacao,
  LocalEstoqueEntrada,
  PermissaoLocalUsuario,
} from '@sgh/contratos/regras-suprimentos';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';

export const PORTA_CADASTRO_ESTOQUE = Symbol('PORTA_CADASTRO_ESTOQUE');

export interface Opcao {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly grupo?: number;
}

export interface ApoioCadastroEstoque {
  readonly hoje: string;
  readonly grupos: Opcao[];
  readonly subgrupos: Opcao[];
  readonly unidades: Opcao[];
  readonly vias: Opcao[];
  readonly setores: Opcao[];
  readonly centrosCusto: Opcao[];
  readonly locais: Opcao[];
  /** As guardas (condições de armazenamento) e os diluentes (soluções ativas) que a estabilidade escolhe por lista. */
  readonly guardas: Opcao[];
  /** As classificações de despesa ativas (a concessão só por despesa e a do grupo de insumo). */
  readonly despesas: Opcao[];
  readonly diluentes: Opcao[];
}

export interface FichaItemEdicao extends ItemEstoqueEntrada {
  readonly id: number;
  readonly versao: number;
  readonly situacao: 'ativo' | 'inativo' | 'em_analise';
  readonly saldoTotal: number;
  /** A situação de cada registro sanitário na data de hoje (o vencido aparece vencido). */
  readonly registrosNaData: readonly (string | null)[];
  readonly nomesPrincipios: Readonly<Record<number, string>>;
  readonly nomesFabricantes: Readonly<Record<number, string>>;
}

export interface LocalResumo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly ativo: boolean;
  readonly versao: number;
  readonly usuarios: number;
}

export interface FichaLocalEdicao extends LocalEstoqueEntrada {
  readonly id: number;
  readonly versao: number;
  readonly ativo: boolean;
}

export interface EscopoLocalUsuario {
  readonly local: number;
  readonly codigo: string;
  readonly nome: string;
  readonly permissoes: PermissaoLocalUsuario[];
  readonly variacaoValorPct: number | null;
  readonly padrao: boolean;
}
/** O alvo da concessão por classificação: o grupo (e o subgrupo) ou só a classificação de despesa (um dos dois). */
export interface ConcessaoClassificacaoAlvo {
  readonly grupo?: number | null;
  readonly subgrupo?: number | null;
  readonly classificacaoDespesa?: number | null;
}
export interface ConcessaoVigente {
  readonly id: number;
  /** O grupo (ou o centro de custo); nulo na concessão só por classificação de despesa. */
  readonly alvo: number | null;
  readonly alvo2: number | null;
  /** A classificação de despesa da concessão (atravessa grupos); nula na concessão por grupo. */
  readonly despesa?: number | null;
  readonly nome: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly permissoes: string[];
  readonly vigente: boolean;
}
export interface EscopoCompletoUsuario {
  readonly usuario: number;
  readonly login: string;
  readonly nome: string;
  readonly locais: EscopoLocalUsuario[];
  readonly classificacoes: ConcessaoVigente[];
  readonly centrosCusto: ConcessaoVigente[];
}

export interface ListaSeparacao {
  readonly requisicao: number;
  readonly numero: number;
  readonly situacao: string;
  readonly tipo: string;
  readonly local: { readonly id: number; readonly codigo: string; readonly nome: string };
  readonly destino: string;
  readonly solicitadoEm: string;
  readonly urgente: boolean;
  readonly geradaEm: string;
  readonly linhas: LinhaSeparacao[];
  readonly totalFalta: number;
}

export interface ConcessaoEntrada {
  readonly inicio: string;
  readonly fim?: string | null;
  readonly requisitar: boolean;
  readonly movimentar: boolean;
  readonly comprar?: boolean;
}

export interface PortaCadastroEstoque {
  readonly destino: 'banco' | 'memoria' | 'indisponivel';
  apoio(c: ContextoPortaM18): Promise<ApoioCadastroEstoque>;
  buscar(
    c: ContextoPortaM18,
    tipo: 'principios' | 'fabricantes' | 'usuarios',
    termo: string,
  ): Promise<Opcao[]>;
  fichaItem(c: ContextoPortaM18, id: number): Promise<FichaItemEdicao | null>;
  incluirItem(c: ContextoPortaM18, e: ItemEstoqueEntrada): Promise<{ id: number; versao: number }>;
  alterarItem(
    c: ContextoPortaM18,
    id: number,
    versao: number,
    e: ItemEstoqueEntrada,
  ): Promise<{ id: number; versao: number }>;
  situacaoItem(
    c: ContextoPortaM18,
    id: number,
    versao: number,
    ativo: boolean,
    motivo: string,
  ): Promise<{ id: number; versao: number }>;
  locais(c: ContextoPortaM18): Promise<LocalResumo[]>;
  fichaLocal(c: ContextoPortaM18, id: number): Promise<FichaLocalEdicao | null>;
  incluirLocal(c: ContextoPortaM18, e: LocalEstoqueEntrada): Promise<{ id: number; versao: number }>;
  alterarLocal(
    c: ContextoPortaM18,
    id: number,
    versao: number,
    e: LocalEstoqueEntrada,
  ): Promise<{ id: number; versao: number }>;
  situacaoLocal(
    c: ContextoPortaM18,
    id: number,
    versao: number,
    ativo: boolean,
    motivo: string,
  ): Promise<{ id: number; versao: number }>;
  escopoUsuario(c: ContextoPortaM18, usuario: number): Promise<EscopoCompletoUsuario | null>;
  gravarEscopoLocal(
    c: ContextoPortaM18,
    usuario: number,
    local: number,
    e: { permissoes: PermissaoLocalUsuario[]; variacaoValorPct?: number | null; padrao?: boolean },
  ): Promise<{ id: number }>;
  retirarEscopoLocal(c: ContextoPortaM18, usuario: number, local: number): Promise<{ id: number }>;
  concederClassificacao(
    c: ContextoPortaM18,
    usuario: number,
    e: ConcessaoEntrada & ConcessaoClassificacaoAlvo,
  ): Promise<{ id: number }>;
  concederCentroCusto(
    c: ContextoPortaM18,
    usuario: number,
    e: ConcessaoEntrada & { centroCusto: number },
  ): Promise<{ id: number }>;
  retirarConcessao(
    c: ContextoPortaM18,
    tipo: 'classificacao' | 'centro-custo',
    id: number,
    motivo: string,
  ): Promise<{ id: number; fim: string | null; cancelada: boolean }>;
  separacao(c: ContextoPortaM18, requisicao: number): Promise<ListaSeparacao | null>;
}

/** Sem o banco próprio: tudo responde 503 (falha fechada, nada em silêncio). */
export function portaCadastroEstoqueIndisponivel(): PortaCadastroEstoque {
  const falha = () =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Cadastro do estoque indisponível',
        'O cadastro do estoque grava só no banco próprio do cliente.',
        { codigo: 'servico-indisponivel' },
      ),
    );
  // Objeto com os métodos da porta, não um Proxy que responde a qualquer chave: o Nest procura `then` e os ganchos
  // (onModuleInit…) em todo provedor, e um Proxy devolveria a recusa para eles (a montagem do módulo travava).
  return {
    destino: 'indisponivel',
    apoio: falha,
    buscar: falha,
    fichaItem: falha,
    incluirItem: falha,
    alterarItem: falha,
    situacaoItem: falha,
    locais: falha,
    fichaLocal: falha,
    incluirLocal: falha,
    alterarLocal: falha,
    situacaoLocal: falha,
    escopoUsuario: falha,
    gravarEscopoLocal: falha,
    retirarEscopoLocal: falha,
    concederClassificacao: falha,
    concederCentroCusto: falha,
    retirarConcessao: falha,
    separacao: falha,
  };
}
