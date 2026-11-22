// Arquivos do módulo documento (ADR 0004): o PDF emitido, o PDF assinado, o arquivo original das cargas de catálogo e
// o conteúdo bruto das integrações vão à porta ArmazemArquivos do núcleo (disco local sob ARQUIVOS_RAIZ, uma pasta por
// banco de cliente, metadado na tabela `arquivo`). Aqui ficam só a escolha da porta pelo ambiente e a porta em memória
// da sessão sintética (dev e CI sem banco próprio), com as mesmas garantias de leitura conferida e de guarda legal.
import {
  type ArmazemArquivos,
  type ArquivoGuardado,
  chaveDoArquivo,
  type ContextoNucleo,
  type ContextoOperacao,
  criarArmazemLocal,
  dataUtc,
  type EntradaGuardar,
  ErroConfiguracao,
  type MetadadoArquivo,
  motivoRecusaExclusao,
  type NucleoArmazem,
  sha256,
  type SituacaoArquivo,
  type VerificacaoCliente,
} from '@sgh/nucleo';
import { ligarMapaEstabelecimentos } from '../../cadastro/contexto-nucleo.js';

/** Porta criada no primeiro uso: a falta de configuração recusa a operação, nunca a subida da API. */
export function armazemSobDemanda(criar: () => ArmazemArquivos): ArmazemArquivos {
  let atual: ArmazemArquivos | null = null;
  const obter = () => (atual ??= criar());
  return {
    guardar: async (e, c, o) => obter().guardar(e, c, o),
    ler: async (c, id) => obter().ler(c, id),
    existe: async (c, id) => obter().existe(c, id),
    metadado: async (c, id) => obter().metadado(c, id),
    verificar: async (c, id) => obter().verificar(c, id),
    excluir: async (id, v, c, o) => obter().excluir(id, v, c, o),
    verificarCliente: async (c) => obter().verificarCliente(c),
  };
}

const porNucleo = new WeakMap<object, ArmazemArquivos>();

/**
 * A porta do processo: com o núcleo e o cliente, o disco local (um adaptador por núcleo); na sessão sintética sem
 * núcleo, a memória; fora disso, indisponível (falha fechada em cada operação).
 */
export function armazemArquivosDoAmbiente(o: {
  readonly nucleo: NucleoArmazem | null;
  readonly cliente: string | null;
  readonly sintetico: boolean;
  readonly env?: NodeJS.ProcessEnv;
}): ArmazemArquivos {
  if (o.nucleo && o.cliente) {
    const nucleo = o.nucleo;
    let a = porNucleo.get(nucleo);
    if (!a) {
      a = armazemSobDemanda(() => criarArmazemLocal(nucleo, { env: o.env ?? process.env }));
      porNucleo.set(nucleo, a);
    }
    return a;
  }
  if (o.sintetico) return new ArmazemArquivosMemoria();
  return armazemSobDemanda(() => {
    throw new ErroConfiguracao('Armazém de arquivos indisponível: sem o banco próprio do cliente.');
  });
}

/** Id do estabelecimento (estabelecimento.id) pelo código; fora do mapa do cliente, recusa. */
export type ResolverEstabelecimento = (codigo: string) => Promise<number>;

/**
 * O estabelecimento do arquivo pelo mapa código → id do banco do cliente (o mesmo da sessão). Código ausente relê o
 * mapa uma vez; continuando fora, recusa (falha fechada): o arquivo nunca cai sem estabelecimento nem em outro.
 */
export function estabelecimentoDoCliente(cliente: string, nucleo: NucleoArmazem): ResolverEstabelecimento {
  return async (codigo) => {
    const mapa = await ligarMapaEstabelecimentos(cliente, nucleo);
    let id = mapa.idDe(codigo);
    if (id === null) {
      await mapa.carregar();
      id = mapa.idDe(codigo);
    }
    if (id === null)
      throw new ErroConfiguracao('Estabelecimento fora do mapa do cliente: o arquivo não foi guardado.');
    return id;
  };
}

/** Id do arquivo guardado a partir do texto do registro dono (só inteiro positivo). */
export function idDoArquivo(texto: string | null | undefined): number | null {
  if (!texto || !/^[1-9]\d{0,15}$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isSafeInteger(n) ? n : null;
}

interface Registro {
  readonly cliente: string;
  readonly metadado: MetadadoArquivo;
  readonly conteudo: Buffer;
  excluido: boolean;
}

/** Porta em memória (sessão sintética e testes de unidade): mesma chave, leitura conferida, exclusão com guarda. */
export class ArmazemArquivosMemoria implements ArmazemArquivos {
  private readonly registros = new Map<number, Registro>();
  private proximo = 1;
  constructor(private readonly agora: () => Date = () => new Date()) {}

  /** Registros ativos (conferência dos testes). */
  get tamanho(): number {
    return [...this.registros.values()].filter((r) => !r.excluido).length;
  }

  async guardar(e: EntradaGuardar, ctx: ContextoOperacao): Promise<ArquivoGuardado> {
    if (!e.conteudo.length) throw new Error('Arquivo vazio.');
    const hash = sha256(e.conteudo);
    const chave = chaveDoArquivo(e.origem ?? 'sistema', ctx.estabelecimento, this.agora(), hash);
    for (const [id, r] of this.registros)
      if (r.cliente === ctx.cliente && !r.excluido && r.metadado.chave === chave)
        return { id, chave, hash, tamanho: r.metadado.tamanho, reaproveitado: true };
    const id = this.proximo++;
    this.registros.set(id, {
      cliente: ctx.cliente,
      excluido: false,
      conteudo: Buffer.from(e.conteudo),
      metadado: {
        id,
        estabelecimento: ctx.estabelecimento,
        entidade: e.entidade ?? null,
        entidadeId: e.entidadeId ?? null,
        finalidade: e.finalidade,
        nomeOriginal: e.nomeOriginal,
        tipoMime: e.tipoMime,
        tamanho: e.conteudo.length,
        hash,
        chave,
        retencaoAte: e.retencaoAte ?? null,
        imutavel: e.imutavel ?? false,
        origem: e.origem ?? 'sistema',
        criadoEm: this.agora(),
        versao: 1,
      },
    });
    return { id, chave, hash, tamanho: e.conteudo.length, reaproveitado: false };
  }

  private ativo(ctx: ContextoNucleo, id: number): Registro | null {
    const r = this.registros.get(id);
    return r && r.cliente === ctx.cliente && !r.excluido ? r : null;
  }

  async ler(ctx: ContextoNucleo, id: number): Promise<{ metadado: MetadadoArquivo; conteudo: Buffer }> {
    const r = this.ativo(ctx, id);
    if (!r) throw new Error('Arquivo não encontrado.');
    if (sha256(r.conteudo) !== r.metadado.hash) throw new Error('Arquivo divergente do registro.');
    return { metadado: r.metadado, conteudo: Buffer.from(r.conteudo) };
  }

  async existe(ctx: ContextoNucleo, id: number): Promise<boolean> {
    return this.ativo(ctx, id) !== null;
  }

  async metadado(ctx: ContextoNucleo, id: number): Promise<MetadadoArquivo | null> {
    return this.ativo(ctx, id)?.metadado ?? null;
  }

  async verificar(ctx: ContextoNucleo, id: number): Promise<SituacaoArquivo> {
    const r = this.ativo(ctx, id);
    if (!r) return 'sem_registro';
    return sha256(r.conteudo) === r.metadado.hash ? 'integro' : 'divergente';
  }

  async excluir(id: number, versao: number, ctx: ContextoOperacao): Promise<void> {
    const r = this.ativo(ctx, id);
    if (!r) throw new Error('Arquivo não encontrado.');
    if (r.metadado.versao !== versao) throw new Error('Versão do arquivo mudou.');
    const motivo = motivoRecusaExclusao(r.metadado.retencaoAte, r.metadado.imutavel, dataUtc(this.agora()));
    if (motivo) throw new Error(motivo);
    r.excluido = true;
  }

  async verificarCliente(ctx: ContextoNucleo): Promise<VerificacaoCliente> {
    const ativos = [...this.registros.values()].filter((r) => r.cliente === ctx.cliente && !r.excluido);
    const divergentes = ativos
      .filter((r) => sha256(r.conteudo) !== r.metadado.hash)
      .map((r) => r.metadado.id);
    return {
      cliente: ctx.cliente,
      conferidos: ativos.length,
      integros: ativos.length - divergentes.length,
      faltando: [],
      divergentes: divergentes.slice(0, 100),
      gravaveis: [],
      totalFaltando: 0,
      totalDivergentes: divergentes.length,
      totalGravaveis: 0,
    };
  }
}
