// Fonte do M13 na API (catálogos oficiais e importadores): onde as leituras e as gravações acontecem.
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-propria.ts, pelo @sgh/nucleo): a área de preparação
//     (carga_catalogo e carga_catalogo_linha) gravada pelo Executor, com a trilha, o outbox e a idempotência na mesma
//     transação; a PUBLICAÇÃO nas tabelas do catálogo é do worker (lotes curtos na janela fora do pico);
//   - `memoria`: a sessão sintética de dev/ci (E2E e testes HTTP): catálogos SINTÉTICOS em memória, as mesmas
//     regras puras (@sgh/dominio-catalogo) e a publicação logo depois da aprovação (o "worker" da memória);
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo.
// Os tipos são do próprio módulo (vocabulário neutro: ids numéricos, datas ISO, situações por extenso).
import type {
  CargaCatalogo,
  CodigoCatalogo,
  ComparacaoLinha,
  LinhaCargaCatalogo,
  SituacaoCargaCatalogo,
} from '@sgh/contratos';
import type { LeituraDoBanco, SecaoLeiauteCep } from '@sgh/dominio-catalogo';
import { ErroProblema } from '../../problema.filter.js';

export const FONTE_CATALOGOS = Symbol('FONTE_CATALOGOS');

export interface CtxCatalogos {
  readonly rede: string;
  /** Código do estabelecimento ativo na sessão. */
  readonly hospital: string;
  readonly traceId: string;
}

/** O que a ação deixa na trilha (quem, de onde, o quê); a fonte acrescenta a tabela e o id. */
export interface TrilhaCatalogo {
  readonly rede: string;
  readonly hospital: string;
  /** Login de quem opera. */
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly chaveNaturalAlvo: string | null;
  readonly resultado: string;
  readonly estacao: string | null;
  /** IP de origem (null na sessão "como" do suporte ou sem IP conhecido). */
  readonly enderecoIp: string | null;
  readonly correlacao: string;
  /** Chave de idempotência do pedido (cabeçalho Idempotency-Key): o reenvio devolve o resultado anterior. */
  readonly idempotencia: string;
}
/** Nome curto usado pelo controller e pelo serviço. */
export type Trilha = TrilhaCatalogo;

type Valor = string | number | null;
export type CamposCatalogo = Record<string, Valor>;

/** A carga como a fonte a devolve: a resposta pública mais a versão (trava otimista) e o estabelecimento. */
export type CargaDeCatalogo = CargaCatalogo & {
  readonly versao: number;
  readonly hospital: string;
};

/** Uma linha preparada (validada e comparada) da carga, com o lote em que é publicada. */
export interface LinhaPreparadaCatalogo {
  readonly linha: number;
  readonly entidade: string;
  readonly chave: string;
  readonly resultado: 'valida' | 'erro';
  readonly comparacao: ComparacaoLinha | null;
  readonly antes: Readonly<Record<string, Valor>> | null;
  readonly depois: Readonly<Record<string, Valor>> | null;
  readonly motivo: string | null;
  /** Lote em que o item é publicado (null: não vai à publicação). */
  readonly lote: number | null;
}

/** A carga preparada que a fonte grava na área de preparação. */
export interface PreparoCargaCatalogo {
  readonly hospital: string;
  readonly catalogo: string;
  readonly arquivo: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Endereço do original no armazenamento com retenção (null: não guardado). */
  readonly arquivoGuardado: string | null;
  readonly situacao: 'comparada' | 'rejeitada';
  readonly edicao: string | null;
  /** Login de quem enviou. */
  readonly responsavel: string;
  readonly motivo: string | null;
  readonly totais: CargaCatalogo['totais'];
  readonly lotes: { readonly total: number; readonly tamanho: number };
  readonly linhas: readonly LinhaPreparadaCatalogo[];
}

/** Aprovar (comparada → aprovada), rejeitar, cancelar ou marcar a falha, conferindo a versão lida. */
export interface MudancaSituacaoCarga {
  readonly hospital: string;
  readonly id: number;
  readonly versao: number;
  readonly de: readonly SituacaoCargaCatalogo[];
  readonly para: 'aprovada' | 'rejeitada' | 'cancelada' | 'falhou';
  /** Login de quem decide. */
  readonly aprovador: string | null;
  readonly motivo: string | null;
}

/** Recusa de negócio da área de preparação (situação que não permite a ação, carga mudada). */
export class ErroCargaCatalogo extends Error {
  override readonly name = 'ErroCargaCatalogo';
  constructor(
    readonly codigo: 'conflito-concorrente' | 'situacao-invalida' | 'catalogo-sem-mapa',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface ConsultaCatalogo {
  readonly titulo: string;
  readonly colunas: { campo: string; rotulo: string }[];
  readonly itens: CamposCatalogo[];
  readonly total: number;
}

export interface CompetenciaSigtap {
  readonly competencia: string;
  readonly valorSh: number | null;
  readonly valorSa: number | null;
  readonly valorSp: number | null;
  atributos: CamposCatalogo;
}

export interface HistoricoSigtap {
  readonly procedimento: string;
  readonly nome: string | null;
  readonly competencias: CompetenciaSigtap[];
}

export type LinhaDaCarga = LinhaCargaCatalogo & { lote: number | null };

/** Tudo o que as telas do M13 leem e gravam (as fontes implementam). */
export interface FonteCatalogos {
  readonly destino: 'banco' | 'memoria';
  readonly gravacao: { readonly permitida: boolean; readonly motivo: string | null };
  leituraDoBanco(c: CtxCatalogos, catalogo: CodigoCatalogo): LeituraDoBanco;
  leiauteCep(c: CtxCatalogos): Promise<SecaoLeiauteCep[]>;
  responsavel(c: CtxCatalogos, catalogo: CodigoCatalogo): Promise<'novo' | 'externo'>;
  /** Licença vigente do catálogo licenciado no estabelecimento (regra 7). */
  contrato(c: CtxCatalogos, catalogo: CodigoCatalogo): Promise<boolean>;
  edicao(
    c: CtxCatalogos,
    catalogo: CodigoCatalogo,
  ): Promise<{ ultima: string | null; descricao: string; linhas: number }>;
  cargas(c: CtxCatalogos, catalogo: string | null): Promise<CargaDeCatalogo[] | null>;
  carga(c: CtxCatalogos, id: number): Promise<CargaDeCatalogo | null>;
  linhas(
    c: CtxCatalogos,
    id: number,
    f: { pagina: number; porPagina: number; comparacao?: string | null; resultado?: string | null },
  ): Promise<{ itens: LinhaDaCarga[]; total: number }>;
  publicadaComHash(c: CtxCatalogos, catalogo: string, sha256: string): Promise<number | null>;
  gravarCarga(c: CtxCatalogos, nova: PreparoCargaCatalogo, trilha: Trilha): Promise<{ id: number }>;
  mudarSituacao(c: CtxCatalogos, m: MudancaSituacaoCarga, trilha: Trilha): Promise<void>;
  consultar(
    c: CtxCatalogos,
    entidade: string,
    f: { busca: string | null; pagina: number; porPagina: number; competencia?: string | null },
  ): Promise<ConsultaCatalogo | null>;
  historico(c: CtxCatalogos, procedimento: string): Promise<HistoricoSigtap | null>;
  /**
   * Fonte em memória: publica a carga aprovada na hora (os lotes que o worker publicaria). Na fonte do banco
   * não existe: a publicação é do worker.
   */
  publicarAgora?(
    c: CtxCatalogos,
    id: number,
    autor: string,
  ): Promise<{ lotes: number; incluidas: number; alteradas: number }>;
}

export class ErroCatalogosIndisponivel extends ErroProblema {
  constructor() {
    super(
      'indisponivel',
      503,
      'Banco do estabelecimento indisponível',
      'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
    );
  }
}

export function fonteCatalogosIndisponivel(): FonteCatalogos {
  const recusar = () => Promise.reject(new ErroCatalogosIndisponivel());
  return {
    destino: 'banco',
    gravacao: { permitida: false, motivo: 'Banco do estabelecimento indisponível.' },
    leituraDoBanco: () => ({ atuais: recusar, existentes: recusar, edicao: recusar }),
    leiauteCep: recusar,
    responsavel: recusar,
    contrato: recusar,
    edicao: recusar,
    cargas: recusar,
    carga: recusar,
    linhas: recusar,
    publicadaComHash: recusar,
    gravarCarga: recusar,
    mudarSituacao: recusar,
    consultar: recusar,
    historico: recusar,
  };
}
