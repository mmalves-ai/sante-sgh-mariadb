// Fonte do M13 na API (catálogos oficiais e importadores): onde as leituras e as gravações acontecem.
//   - `legado`: o núcleo do legado (READ ONLY nas leituras; a área de preparação SGH_ pela transação SGH_ do núcleo,
//     com a trilha junto). A PUBLICAÇÃO no banco do estabelecimento é do worker (lotes curtos na janela fora do
//     pico, pelo executor do M04); a API só aprova;
//   - `memoria`: a sessão sintética de dev/ci (E2E e testes HTTP): catálogos SINTÉTICOS em memória, as mesmas
//     regras puras (@sgh/dominio-catalogo) e a publicação logo depois da aprovação (o "worker" da memória);
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo.
// Em dev com ACESSO_FONTE_DEV=copia, a leitura é da cópia e a gravação SGH_ fica recusada com o motivo na tela.
import type { CodigoCatalogo, LinhaCargaCatalogo } from '@sgh/contratos';
import type { LeituraDoBanco, SecaoLeiauteCep } from '@sgh/dominio-catalogo';
import {
  cargaPublicadaComHash,
  type CargaCatalogoLida,
  chavesExistentesDoCatalogo,
  codigosReferenciadosExistentes,
  consultarCatalogo,
  contratoVigenteDoCatalogo,
  edicaoNoBanco,
  gravarCargaCatalogo,
  historicoSigtap,
  itensAtuaisDoCatalogo,
  leiauteCepDoBanco,
  lerCargaCatalogo,
  type Leitor,
  type LinhaTrilha,
  linhasDaCargaCatalogo,
  listarCargasCatalogo,
  mudarSituacaoCargaCatalogo,
  type NovaCargaCatalogo,
  type NucleoLegado,
  responsavelDoCatalogo,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';

export const FONTE_CATALOGOS = Symbol('FONTE_CATALOGOS');

export interface CtxCatalogos {
  readonly rede: string;
  readonly hospital: string;
  readonly traceId: string;
}

export type Trilha = Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo'>;
export type ConsultaLida = NonNullable<Awaited<ReturnType<typeof consultarCatalogo>>>;
export type HistoricoLido = NonNullable<Awaited<ReturnType<typeof historicoSigtap>>>;
export type LinhaLida = LinhaCargaCatalogo & { lote: number | null };

/** Tudo o que as telas do M13 leem e gravam (as fontes implementam). */
export interface FonteCatalogos {
  readonly destino: 'legado' | 'memoria';
  readonly gravacao: { readonly permitida: boolean; readonly motivo: string | null };
  leituraDoBanco(c: CtxCatalogos, catalogo: CodigoCatalogo): LeituraDoBanco;
  leiauteCep(c: CtxCatalogos): Promise<SecaoLeiauteCep[]>;
  responsavel(c: CtxCatalogos, catalogo: CodigoCatalogo): Promise<'novo' | 'externo'>;
  contrato(c: CtxCatalogos, catalogo: CodigoCatalogo): Promise<boolean>;
  edicao(
    c: CtxCatalogos,
    catalogo: CodigoCatalogo,
  ): Promise<{ ultima: string | null; descricao: string; linhas: number }>;
  cargas(c: CtxCatalogos, catalogo: string | null): Promise<CargaCatalogoLida[] | null>;
  carga(c: CtxCatalogos, id: number): Promise<CargaCatalogoLida | null>;
  linhas(
    c: CtxCatalogos,
    id: number,
    f: { pagina: number; porPagina: number; comparacao?: string | null; resultado?: string | null },
  ): Promise<{ itens: LinhaLida[]; total: number }>;
  publicadaComHash(c: CtxCatalogos, catalogo: string, sha256: string): Promise<number | null>;
  gravarCarga(c: CtxCatalogos, nova: NovaCargaCatalogo, trilha: Trilha): Promise<{ id: number }>;
  mudarSituacao(
    c: CtxCatalogos,
    m: Parameters<typeof mudarSituacaoCargaCatalogo>[1],
    trilha: Trilha,
  ): Promise<void>;
  consultar(
    c: CtxCatalogos,
    entidade: string,
    f: { busca: string | null; pagina: number; porPagina: number; competencia?: string | null },
  ): Promise<ConsultaLida | null>;
  historico(c: CtxCatalogos, procedimento: string): Promise<HistoricoLido | null>;
  /**
   * Fonte em memória: publica a carga aprovada na hora (os lotes que o worker publicaria). Na fonte do legado
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

export function fonteCatalogosLegado(
  nucleo: NucleoLegado,
  opcoes: { readonly gravacaoPermitida: boolean; readonly motivoSemGravacao?: string },
): FonteCatalogos {
  const ler = <T>(c: CtxCatalogos, fn: (l: Leitor) => Promise<T>): Promise<T> => nucleo.lerSomente(c, fn);
  const recusar = () => {
    if (!opcoes.gravacaoPermitida)
      throw new ErroProblema(
        'operacao-bloqueada',
        409,
        'Gravação desligada',
        opcoes.motivoSemGravacao ?? undefined,
        {
          codigo: 'gravacao-desligada',
        },
      );
  };
  return {
    destino: 'legado',
    gravacao: {
      permitida: opcoes.gravacaoPermitida,
      motivo: opcoes.gravacaoPermitida ? null : (opcoes.motivoSemGravacao ?? null),
    },
    leituraDoBanco: (c, catalogo) => ({
      atuais: (entidade, chaves) => ler(c, (l) => itensAtuaisDoCatalogo(l, entidade, chaves)),
      existentes: (entidade, escopo) => ler(c, (l) => chavesExistentesDoCatalogo(l, entidade, escopo)),
      edicao: () => ler(c, (l) => edicaoNoBanco(l, catalogo)),
      referencias: (tabela, codigos) => ler(c, (l) => codigosReferenciadosExistentes(l, tabela, codigos)),
    }),
    leiauteCep: (c) => ler(c, (l) => leiauteCepDoBanco(l)),
    responsavel: (c, cat) => ler(c, (l) => responsavelDoCatalogo(l, c.hospital, cat)),
    contrato: (c, cat) => ler(c, (l) => contratoVigenteDoCatalogo(l, c.hospital, cat)),
    edicao: (c, cat) => ler(c, (l) => edicaoNoBanco(l, cat)),
    cargas: (c, cat) => ler(c, (l) => listarCargasCatalogo(l, c.hospital, cat)),
    carga: (c, id) => ler(c, (l) => lerCargaCatalogo(l, c.hospital, id)),
    linhas: (c, id, f) => ler(c, (l) => linhasDaCargaCatalogo(l, id, f)),
    publicadaComHash: (c, cat, sha) => ler(c, (l) => cargaPublicadaComHash(l, c.hospital, cat, sha)),
    async gravarCarga(c, nova, trilha) {
      recusar();
      return nucleo.gravarSgh(c, (e) => gravarCargaCatalogo(e, nova, trilha));
    },
    async mudarSituacao(c, m, trilha) {
      recusar();
      await nucleo.gravarSgh(c, (e) => mudarSituacaoCargaCatalogo(e, m, trilha));
    },
    consultar: (c, ent, f) => ler(c, (l) => consultarCatalogo(l, ent, f)),
    historico: (c, p) => ler(c, (l) => historicoSigtap(l, p)),
  };
}

export function fonteCatalogosIndisponivel(): FonteCatalogos {
  const recusar = () => Promise.reject(new ErroCatalogosIndisponivel());
  return {
    destino: 'legado',
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
