// Porta da rede credenciada da operadora própria (M56, etapa 4, F3): o que a tela da rede lê e grava, independente de
// onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY e as gravações SGH_OPE_PRESTADOR e
//     SGH_OPE_PRESTADOR_MOV numa transação SGH_ com a SGH_TRILHA junto; em dev sobre a cópia compartilhada, as gravações
//     são recusadas (`sghSoLeitura`), como nos outros módulos;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com prestadores e convênios SINTÉTICOS; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Nenhuma tabela legada é escrita (seção 5 da ficha); o convênio e os domínios são só lidos.
import type {
  AlteracaoSgh,
  ConvenioLido,
  CredenciamentoSgh,
  DescredenciamentoSgh,
  DominioRede,
  FiltroPrestadoresLido,
  ItemDominioRedeLido,
  LinhaTrilha,
  MovimentoRpsLido,
  PrestadorLido,
  ReinclusaoSgh,
  TotaisRedeLidos,
} from '@sgh/legado';

export const PORTA_REDE_OPERADORA = Symbol('PORTA_REDE_OPERADORA');

export interface ContextoRede {
  readonly rede: string;
  readonly hospital: string;
}

type SemHospital<T> = Omit<T, 'hospital'>;

/** O que a gravação SGH_ da rede faz dentro da transação (com a trilha junto). */
export interface GravadorRede {
  credenciar(c: SemHospital<CredenciamentoSgh>): Promise<{ id: number; versao: number; movimento: number }>;
  alterar(a: SemHospital<AlteracaoSgh>): Promise<{ id: number; versao: number; movimento: number | null }>;
  descredenciar(
    d: SemHospital<DescredenciamentoSgh>,
  ): Promise<{ id: number; versao: number; movimento: number }>;
  reincluir(r: SemHospital<ReinclusaoSgh>): Promise<{ id: number; versao: number; movimento: number }>;
}

export interface FiltroMovimentosPorta {
  readonly situacao?: 'pendente' | 'enviado';
  readonly prestador?: number;
  readonly apos?: number;
}

export interface PortaRedeOperadora {
  readonly destino: 'legado' | 'memoria';
  /** A data de hoje no relógio do banco (AAAA-MM-DD). */
  hoje(c: ContextoRede): Promise<string>;
  dominios(c: ContextoRede): Promise<Record<DominioRede, ItemDominioRedeLido[]>>;
  convenios(c: ContextoRede): Promise<ConvenioLido[]>;
  prestadores(
    c: ContextoRede,
    f: FiltroPrestadoresLido,
  ): Promise<{ itens: PrestadorLido[]; proxima: { nome: string; id: number } | null }>;
  prestador(c: ContextoRede, id: number): Promise<PrestadorLido | null>;
  totais(c: ContextoRede): Promise<TotaisRedeLidos>;
  movimentos(
    c: ContextoRede,
    f: FiltroMovimentosPorta,
  ): Promise<{ itens: MovimentoRpsLido[]; proxima: number | null }>;
  gravarSgh<T>(
    c: ContextoRede,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorRede) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_REDE: ReadonlySet<string> = new Set([
  'hoje',
  'dominios',
  'convenios',
  'prestadores',
  'prestador',
  'totais',
  'movimentos',
  'gravarSgh',
]);
