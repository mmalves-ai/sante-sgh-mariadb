// Porta de armazenamento de arquivos (ADR 0004): todo arquivo do produto (documento emitido, segunda via, digitalização,
// foto, XML de faturamento, prova do portal, anexo) vai para o disco da máquina que hospeda o sistema, sob
// ARQUIVOS_RAIZ, uma pasta por banco de cliente. É o MESMO desenho do conector (carga de migração, "migracao/<h2>/<hash>"):
//   - endereçado pelo SHA-256 (o mesmo conteúdo é o mesmo arquivo);
//   - gravado UMA vez: temporário com criação exclusiva, fsync, somente leitura e link atômico (nunca sobrescreve);
//   - metadado na tabela `arquivo` do banco do cliente, gravado pelo Executor (trilha, idempotência, auditoria);
//   - versão nova é outro arquivo e outro registro: nunca apaga a anterior;
//   - exclusão recusada antes de `retencao_ate` (guarda legal) e para o imutável sem prazo;
//   - o caminho nunca sai da raiz (recusa "..", absoluto e qualquer caractere fora de [A-Za-z0-9_.-]).
// O vigia do worker confere o hash de cada registro contra o disco (verificarCliente).
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, statfsSync } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { ContextoNucleo } from './contexto.js';
import { ErroConfiguracao, ErroOperacao, recusa, erroRegistroInexistente } from './erros.js';
import { type ContextoOperacao, type Executor, type OpcoesExecucao, definirOperacao } from './executor.js';
import type { Leitor, Linha } from './transacao.js';

export const ORIGENS_ARQUIVO = ['sistema', 'migracao', 'integracao'] as const;
export type OrigemArquivo = (typeof ORIGENS_ARQUIVO)[number];

/** Teto padrão de um arquivo (512 MiB). */
export const TETO_ARQUIVO_PADRAO = 512 * 1024 * 1024;
const SEGMENTO = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export interface EntradaGuardar {
  readonly conteudo: Uint8Array;
  readonly nomeOriginal: string;
  readonly tipoMime: string;
  /** Ex.: documento_assinado, anexo, imagem, logotipo, laudo, xml_faturamento. */
  readonly finalidade: string;
  /** Tabela dona do arquivo (opcional) e o id dela. */
  readonly entidade?: string | null;
  readonly entidadeId?: number | null;
  /** Guarda legal (AAAA-MM-DD): a exclusão é recusada antes dela. */
  readonly retencaoAte?: string | null;
  /** Imutável sem prazo de retenção: nunca excluído. */
  readonly imutavel?: boolean;
  /** Padrão: sistema. A migração é do conector. */
  readonly origem?: Exclude<OrigemArquivo, 'migracao'>;
}

export interface ArquivoGuardado {
  readonly id: number;
  /** Caminho relativo na raiz de arquivos (dentro da pasta do cliente). */
  readonly chave: string;
  readonly hash: string;
  readonly tamanho: number;
  /** O mesmo conteúdo já estava registrado com a mesma chave: devolveu o registro existente. */
  readonly reaproveitado: boolean;
}

export interface MetadadoArquivo {
  readonly id: number;
  readonly estabelecimento: number | null;
  readonly entidade: string | null;
  readonly entidadeId: number | null;
  readonly finalidade: string;
  readonly nomeOriginal: string;
  readonly tipoMime: string;
  readonly tamanho: number;
  readonly hash: string;
  readonly chave: string;
  readonly retencaoAte: string | null;
  readonly imutavel: boolean;
  readonly origem: OrigemArquivo;
  readonly criadoEm: Date;
  readonly versao: number;
}

export type SituacaoArquivo = 'integro' | 'faltando' | 'divergente' | 'gravavel' | 'sem_registro';

export interface VerificacaoCliente {
  readonly cliente: string;
  readonly conferidos: number;
  readonly integros: number;
  /** Ids dos registros (até 100 por lista; as contagens são completas). */
  readonly faltando: readonly number[];
  readonly divergentes: readonly number[];
  /** Arquivo que perdeu o somente leitura. */
  readonly gravaveis: readonly number[];
  readonly totalFaltando: number;
  readonly totalDivergentes: number;
  readonly totalGravaveis: number;
}

/** A porta: vocabulário neutro, sem nada do meio de armazenamento. */
export interface ArmazemArquivos {
  guardar(entrada: EntradaGuardar, ctx: ContextoOperacao, opcoes?: OpcoesExecucao): Promise<ArquivoGuardado>;
  /** Conteúdo conferido pelo hash (divergência ou falta: erro, nunca conteúdo errado). */
  ler(
    ctx: ContextoNucleo,
    id: number,
  ): Promise<{ readonly metadado: MetadadoArquivo; readonly conteudo: Buffer }>;
  existe(ctx: ContextoNucleo, id: number): Promise<boolean>;
  metadado(ctx: ContextoNucleo, id: number): Promise<MetadadoArquivo | null>;
  verificar(ctx: ContextoNucleo, id: number): Promise<SituacaoArquivo>;
  /** Exclusão lógica do registro e remoção do arquivo; recusada antes de retencao_ate. */
  excluir(id: number, versao: number, ctx: ContextoOperacao, opcoes?: OpcoesExecucao): Promise<void>;
  /** Todos os registros ativos do cliente contra o disco (vigia do worker). */
  verificarCliente(ctx: ContextoNucleo): Promise<VerificacaoCliente>;
}

// ---------------------------------------------------------------------------------------------------------------
// Regras puras (sem disco)

/** AAAA-MM-DD do instante, em UTC. */
export function dataUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Exclusão permitida? Recusa antes de retencao_ate e para o imutável sem prazo. */
export function motivoRecusaExclusao(
  retencaoAte: string | null,
  imutavel: boolean,
  hoje: string,
): string | null {
  if (retencaoAte !== null && hoje < retencaoAte)
    return `Arquivo sob guarda legal até ${retencaoAte}: a exclusão só é aceita depois dessa data.`;
  if (retencaoAte === null && imutavel)
    return 'Arquivo imutável sem prazo de retenção: não pode ser excluído.';
  return null;
}

/** Pasta do cliente na raiz: o nome do banco, só [A-Za-z0-9_] (o mesmo saneamento do conector). */
export function pastaDoBanco(banco: string): string {
  const p = banco.replace(/[^A-Za-z0-9_]/g, '_');
  if (!p) throw new ErroConfiguracao('Banco do cliente sem nome.');
  return p;
}

/** Chave (caminho relativo na pasta do cliente): <origem>/<estabelecimento>/<aaaa>/<mm>/<h2>/<hash>. */
export function chaveDoArquivo(
  origem: OrigemArquivo,
  estabelecimento: number | null,
  agora: Date,
  hash: string,
): string {
  if (!HASH.test(hash)) throw new Error('Hash inválido.');
  if (origem === 'migracao') return `migracao/${hash.slice(0, 2)}/${hash}`;
  const a = String(agora.getUTCFullYear());
  const m = String(agora.getUTCMonth() + 1).padStart(2, '0');
  return `${origem}/${estabelecimento ?? 0}/${a}/${m}/${hash.slice(0, 2)}/${hash}`;
}

/** Caminho absoluto de uma chave; recusa absoluto, "..", segmento estranho e qualquer saída da raiz. */
export function caminhoNaRaiz(raiz: string, pasta: string, chave: string): string {
  if (!isAbsolute(raiz)) throw new ErroConfiguracao('ARQUIVOS_RAIZ tem de ser um caminho absoluto.');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(pasta)) throw erroCaminho();
  if (typeof chave !== 'string' || chave.length === 0 || chave.length > 512 || isAbsolute(chave))
    throw erroCaminho();
  const partes = chave.split('/');
  if (partes.some((p) => p === '.' || p === '..' || !SEGMENTO.test(p))) throw erroCaminho();
  const base = resolve(raiz, pasta);
  const alvo = resolve(base, ...partes);
  if (!alvo.startsWith(base + sep)) throw erroCaminho();
  return alvo;
}

function erroCaminho(): ErroOperacao {
  return new ErroOperacao(
    400,
    'caminho-invalido',
    'Caminho inválido',
    'O caminho do arquivo sai da raiz ou é inválido.',
  );
}

function erroIntegridade(codigo: 'arquivo-ausente' | 'arquivo-divergente', id: number): ErroOperacao {
  return new ErroOperacao(
    500,
    codigo,
    'Arquivo íntegro indisponível',
    codigo === 'arquivo-ausente'
      ? `O registro ${id} existe, mas o arquivo não está no armazenamento.`
      : `O arquivo no armazenamento não confere com o hash registrado (registro ${id}).`,
  );
}

export function sha256(conteudo: Uint8Array): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

/** SHA-256 do arquivo em disco, por fluxo (sem carregar inteiro). */
export function sha256DoArquivo(caminho: string): Promise<string> {
  return new Promise((ok, falha) => {
    const h = createHash('sha256');
    createReadStream(caminho)
      .on('data', (b) => h.update(b))
      .on('error', falha)
      .on('end', () => ok(h.digest('hex')));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Disco

async function existeNoDisco(caminho: string): Promise<boolean> {
  try {
    return (await lstat(caminho)).isFile();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

async function sincronizarPasta(pasta: string): Promise<void> {
  try {
    const fh = await open(pasta, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // Sistemas de arquivos sem fsync de pasta: o rename/link já é atômico.
  }
}

/**
 * Grava uma vez: temporário com criação exclusiva, fsync, chmod 0444 e link atômico para o destino (falha se já
 * existir: nunca sobrescreve). Destino existente com o mesmo hash: nada a fazer. Com outro: recusa (divergência).
 */
export async function gravarUmaVez(
  destino: string,
  conteudo: Uint8Array,
  hash: string,
): Promise<'gravado' | 'existente'> {
  if (sha256(conteudo) !== hash)
    throw new ErroOperacao(
      500,
      'arquivo-divergente',
      'Arquivo íntegro indisponível',
      'O conteúdo não confere com o hash.',
    );
  const conferirExistente = async (): Promise<'existente'> => {
    if ((await sha256DoArquivo(destino)) !== hash)
      throw new ErroOperacao(
        500,
        'arquivo-divergente',
        'Arquivo íntegro indisponível',
        'Já existe no armazenamento um arquivo nesse caminho com outro conteúdo; nada foi sobrescrito.',
      );
    return 'existente';
  };
  if (await existeNoDisco(destino)) return conferirExistente();
  const pasta = resolve(destino, '..');
  await mkdir(pasta, { recursive: true, mode: 0o750 });
  const tmp = `${destino}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fh = await open(tmp, 'wx', 0o600);
  try {
    await fh.writeFile(conteudo);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await chmod(tmp, 0o444);
    try {
      await link(tmp, destino);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return await conferirExistente();
      throw e;
    }
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
  await sincronizarPasta(pasta);
  return 'gravado';
}

/** Bytes livres no sistema de arquivos da raiz. */
export function espacoLivreBytes(raiz: string): number {
  const s = statfsSync(raiz);
  return Number(s.bavail) * Number(s.bsize);
}

/** ARQUIVOS_RAIZ do ambiente (vazio: não configurado). */
export function lerRaizArquivos(env: NodeJS.ProcessEnv = process.env): string | null {
  const r = env['ARQUIVOS_RAIZ']?.trim();
  if (!r) return null;
  if (!isAbsolute(r)) throw new ErroConfiguracao('ARQUIVOS_RAIZ tem de ser um caminho absoluto.');
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Operações (pelo Executor: trilha, idempotência e auditoria na mesma transação)

const entradaRegistro = z.object({
  chave: z.string().min(1).max(512),
  hash: z.string().regex(HASH),
  tamanho: z.number().int().positive(),
  nomeOriginal: z.string().trim().min(1).max(255),
  tipoMime: z
    .string()
    .trim()
    .min(3)
    .max(127)
    .regex(/^[\w.+-]+\/[\w.+-]+$/),
  finalidade: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  entidade: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .nullable(),
  entidadeId: z.number().int().positive().nullable(),
  retencaoAte: z.string().regex(DATA).nullable(),
  imutavel: z.boolean(),
  origem: z.enum(['sistema', 'integracao']),
});
type EntradaRegistro = z.infer<typeof entradaRegistro>;

const registrarArquivo = definirOperacao({
  nome: 'nucleo.arquivo.guardar',
  tabelas: ['arquivo'],
  acao: 'inclusao',
  entrada: entradaRegistro,
  async gravar(tx, e, ctx) {
    const valores = {
      estabelecimento_id: ctx.estabelecimento,
      entidade: e.entidade,
      entidade_id: e.entidadeId,
      finalidade: e.finalidade,
      nome_original: e.nomeOriginal,
      tipo_mime: e.tipoMime,
      tamanho_bytes: e.tamanho,
      hash_sha256: e.hash,
      retencao_ate: e.retencaoAte,
      imutavel: e.imutavel,
    };
    const [atual] = await tx.consultarParaAtualizar(
      'SELECT id, versao, excluido_em FROM arquivo WHERE chave_armazenamento = ?',
      [e.chave],
    );
    if (atual) {
      const id = Number(atual['id']);
      if (atual['excluido_em'] === null)
        return { id, chave: e.chave, hash: e.hash, tamanho: e.tamanho, reaproveitado: true };
      // O mesmo conteúdo volta depois de excluído: o registro é reativado (o arquivo foi regravado antes).
      await tx.alterar('arquivo', id, Number(atual['versao']), {
        ...valores,
        excluido_em: null,
        excluido_por: null,
      });
      return { id, chave: e.chave, hash: e.hash, tamanho: e.tamanho, reaproveitado: false };
    }
    const id = await tx.incluir('arquivo', {
      ...valores,
      chave_armazenamento: e.chave,
      origem: e.origem,
    });
    return { id, chave: e.chave, hash: e.hash, tamanho: e.tamanho, reaproveitado: false };
  },
  alvo: (_e, r) => ({ tabela: 'arquivo', id: r.id }),
});

const excluirArquivo = definirOperacao({
  nome: 'nucleo.arquivo.excluir',
  tabelas: ['arquivo'],
  acao: 'exclusao',
  entrada: z.object({
    id: z.number().int().positive(),
    versao: z.number().int().positive(),
    hoje: z.string().regex(DATA),
  }),
  travar: (e) => ({
    tabela: 'arquivo',
    id: e.id,
    colunas: ['retencao_ate', 'imutavel', 'excluido_em', 'chave_armazenamento'],
    versaoEsperada: e.versao,
  }),
  async conferir(_tx, e, _ctx, relido) {
    if (!relido || relido['excluido_em'] !== null) throw erroRegistroInexistente();
    const motivo = motivoRecusaExclusao(
      dataDoBanco(relido['retencao_ate']),
      Boolean(relido['imutavel']),
      e.hoje,
    );
    if (motivo) throw recusa('arquivo-retido', motivo);
  },
  async gravar(tx, e, ctx) {
    const versao = await tx.alterar('arquivo', e.id, e.versao, {
      excluido_em: new Date(),
      excluido_por: ctx.usuario,
    });
    return { id: e.id, versao };
  },
  alvo: (e) => ({ tabela: 'arquivo', id: e.id }),
});

function dataDoBanco(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return dataUtc(v);
  return String(v).slice(0, 10);
}

const COLUNAS_META =
  'id, estabelecimento_id, entidade, entidade_id, finalidade, nome_original, tipo_mime, tamanho_bytes, hash_sha256, chave_armazenamento, retencao_ate, imutavel, origem, criado_em, versao';

function paraMetadado(l: Linha): MetadadoArquivo {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(l['id']),
    estabelecimento: n(l['estabelecimento_id']),
    entidade: (l['entidade'] as string | null) ?? null,
    entidadeId: n(l['entidade_id']),
    finalidade: String(l['finalidade']),
    nomeOriginal: String(l['nome_original']),
    tipoMime: String(l['tipo_mime']),
    tamanho: Number(l['tamanho_bytes']),
    hash: String(l['hash_sha256']),
    chave: String(l['chave_armazenamento']),
    retencaoAte: dataDoBanco(l['retencao_ate']),
    imutavel: Boolean(l['imutavel']),
    origem: String(l['origem']) as OrigemArquivo,
    criadoEm: l['criado_em'] instanceof Date ? l['criado_em'] : new Date(String(l['criado_em'])),
    versao: Number(l['versao']),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Adaptador de disco local

export interface DependenciasArmazemLocal {
  /** Raiz absoluta (ARQUIVOS_RAIZ). */
  readonly raiz: string;
  readonly executor: Executor;
  ler<T>(ctx: ContextoNucleo, fn: (l: Leitor) => Promise<T>): Promise<T>;
  /** Nome do banco do cliente (a pasta dele na raiz). */
  bancoDoCliente(cliente: string): Promise<string>;
  readonly agora?: () => Date;
  readonly tetoBytes?: number;
}

/** O que o adaptador usa do NucleoProprio. */
export interface NucleoArmazem {
  lerSomente<T>(ctx: Partial<ContextoNucleo>, fn: (l: Leitor) => Promise<T>): Promise<T>;
  cliente(codigo: string): Promise<{ readonly banco: string }>;
  criarExecutor(): Executor;
}

/** Atalho: o adaptador sobre o núcleo (executor próprio) e a raiz do ambiente ou a dada. */
export function criarArmazemLocal(
  nucleo: NucleoArmazem,
  opcoes: { readonly raiz?: string; readonly executor?: Executor; readonly env?: NodeJS.ProcessEnv } = {},
): ArmazemArquivosLocal {
  const raiz = opcoes.raiz ?? lerRaizArquivos(opcoes.env);
  if (!raiz) throw new ErroConfiguracao('ARQUIVOS_RAIZ não configurada.');
  return new ArmazemArquivosLocal({
    raiz,
    executor: opcoes.executor ?? nucleo.criarExecutor(),
    ler: (ctx, fn) => nucleo.lerSomente(ctx, fn),
    bancoDoCliente: async (c) => (await nucleo.cliente(c)).banco,
  });
}

export class ArmazemArquivosLocal implements ArmazemArquivos {
  private readonly deps: DependenciasArmazemLocal;
  readonly raiz: string;

  constructor(deps: DependenciasArmazemLocal) {
    if (!isAbsolute(deps.raiz)) throw new ErroConfiguracao('ARQUIVOS_RAIZ tem de ser um caminho absoluto.');
    this.deps = deps;
    this.raiz = resolve(deps.raiz);
  }

  private agora(): Date {
    return this.deps.agora?.() ?? new Date();
  }

  /** Caminho absoluto de uma chave do cliente (sempre dentro da raiz). */
  async caminho(cliente: string, chave: string): Promise<string> {
    return caminhoNaRaiz(this.raiz, pastaDoBanco(await this.deps.bancoDoCliente(cliente)), chave);
  }

  async guardar(
    entrada: EntradaGuardar,
    ctx: ContextoOperacao,
    opcoes: OpcoesExecucao = {},
  ): Promise<ArquivoGuardado> {
    const c = entrada.conteudo;
    if (!(c instanceof Uint8Array) || c.byteLength === 0)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Arquivo vazio.', {
        campos: ['conteudo'],
      });
    if (c.byteLength > (this.deps.tetoBytes ?? TETO_ARQUIVO_PADRAO))
      throw new ErroOperacao(
        413,
        'arquivo-grande-demais',
        'Arquivo grande demais',
        'O arquivo passa do teto aceito.',
      );
    const origem = entrada.origem ?? 'sistema';
    if (!['sistema', 'integracao'].includes(origem))
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Origem inválida.', {
        campos: ['origem'],
      });
    const hash = sha256(c);
    const chave = chaveDoArquivo(origem, ctx.estabelecimento ?? null, this.agora(), hash);
    const registro = {
      chave,
      hash,
      tamanho: c.byteLength,
      nomeOriginal: entrada.nomeOriginal,
      tipoMime: entrada.tipoMime,
      finalidade: entrada.finalidade,
      entidade: entrada.entidade ?? null,
      entidadeId: entrada.entidadeId ?? null,
      retencaoAte: entrada.retencaoAte ?? null,
      imutavel: entrada.imutavel ?? false,
      origem,
    } satisfies EntradaRegistro;
    // Confere a entrada antes de tocar o disco (o executor confere de novo).
    const conferida = entradaRegistro.safeParse(registro);
    if (!conferida.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(conferida.error.issues.map((i) => String(i.path[0])))],
      });
    // Disco primeiro (idempotente pelo hash); depois o registro. Se o registro falhar, sobra um arquivo sem registro,
    // que nunca é servido (toda leitura parte do registro) e o vigia aponta.
    await gravarUmaVez(await this.caminho(ctx.cliente, chave), c, hash);
    const saida = await this.deps.executor.executar(registrarArquivo, ctx.cliente, registro, ctx, opcoes);
    const r = saida.resultado;
    return {
      id: Number(r.id),
      chave: String(r.chave),
      hash: String(r.hash),
      tamanho: Number(r.tamanho),
      reaproveitado: Boolean(r.reaproveitado),
    };
  }

  async metadado(ctx: ContextoNucleo, id: number): Promise<MetadadoArquivo | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const l = await this.deps.ler(ctx, (x) =>
      x.uma(`SELECT ${COLUNAS_META} FROM arquivo WHERE id = ? AND excluido_em IS NULL`, [id]),
    );
    return l ? paraMetadado(l) : null;
  }

  async ler(ctx: ContextoNucleo, id: number): Promise<{ metadado: MetadadoArquivo; conteudo: Buffer }> {
    const m = await this.metadado(ctx, id);
    if (!m) throw erroRegistroInexistente();
    const caminho = await this.caminho(ctx.cliente, m.chave);
    let conteudo: Buffer;
    try {
      conteudo = await readFile(caminho);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw erroIntegridade('arquivo-ausente', id);
      throw e;
    }
    if (conteudo.byteLength !== m.tamanho || sha256(conteudo) !== m.hash)
      throw erroIntegridade('arquivo-divergente', id);
    return { metadado: m, conteudo };
  }

  async existe(ctx: ContextoNucleo, id: number): Promise<boolean> {
    const m = await this.metadado(ctx, id);
    return m !== null && (await existeNoDisco(await this.caminho(ctx.cliente, m.chave)));
  }

  async verificar(ctx: ContextoNucleo, id: number): Promise<SituacaoArquivo> {
    const m = await this.metadado(ctx, id);
    if (!m) return 'sem_registro';
    return this.situacao(await this.caminho(ctx.cliente, m.chave), m.tamanho, m.hash);
  }

  private async situacao(caminho: string, tamanho: number, hash: string): Promise<SituacaoArquivo> {
    let s;
    try {
      s = await stat(caminho);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'faltando';
      throw e;
    }
    if (!s.isFile() || s.size !== tamanho || (await sha256DoArquivo(caminho)) !== hash) return 'divergente';
    if ((s.mode & 0o222) !== 0) return 'gravavel';
    return 'integro';
  }

  async excluir(
    id: number,
    versao: number,
    ctx: ContextoOperacao,
    opcoes: OpcoesExecucao = {},
  ): Promise<void> {
    const m = await this.deps.ler(ctx, (x) =>
      x.uma('SELECT chave_armazenamento FROM arquivo WHERE id = ? AND excluido_em IS NULL', [id]),
    );
    if (!m) throw erroRegistroInexistente();
    const caminho = await this.caminho(ctx.cliente, String(m['chave_armazenamento']));
    await this.deps.executor.executar(
      excluirArquivo,
      ctx.cliente,
      { id, versao, hoje: dataUtc(this.agora()) },
      ctx,
      opcoes,
    );
    // Só depois do COMMIT (nunca numa simulação ou sob a transação de quem chama).
    if (!opcoes.desfazer && !opcoes.escritor) await unlink(caminho).catch(() => undefined);
  }

  async verificarCliente(ctx: ContextoNucleo): Promise<VerificacaoCliente> {
    const pasta = pastaDoBanco(await this.deps.bancoDoCliente(ctx.cliente));
    const faltando: number[] = [];
    const divergentes: number[] = [];
    const gravaveis: number[] = [];
    let conferidos = 0;
    let totalF = 0;
    let totalD = 0;
    let totalG = 0;
    let ultimo = 0;
    for (;;) {
      const lote = await this.deps.ler(ctx, (x) =>
        x.consultar(
          'SELECT id, tamanho_bytes, hash_sha256, chave_armazenamento FROM arquivo WHERE excluido_em IS NULL AND id > ? ORDER BY id LIMIT 1000',
          [ultimo],
          { teto: 1000 },
        ),
      );
      if (lote.length === 0) break;
      for (const l of lote) {
        const id = Number(l['id']);
        ultimo = id;
        conferidos++;
        let s: SituacaoArquivo;
        try {
          s = await this.situacao(
            caminhoNaRaiz(this.raiz, pasta, String(l['chave_armazenamento'])),
            Number(l['tamanho_bytes']),
            String(l['hash_sha256']),
          );
        } catch {
          s = 'divergente';
        }
        if (s === 'faltando') {
          totalF++;
          if (faltando.length < 100) faltando.push(id);
        } else if (s === 'divergente') {
          totalD++;
          if (divergentes.length < 100) divergentes.push(id);
        } else if (s === 'gravavel') {
          totalG++;
          if (gravaveis.length < 100) gravaveis.push(id);
        }
      }
      if (lote.length < 1000) break;
    }
    return {
      cliente: ctx.cliente,
      conferidos,
      integros: conferidos - totalF - totalD - totalG,
      faltando,
      divergentes,
      gravaveis,
      totalFaltando: totalF,
      totalDivergentes: totalD,
      totalGravaveis: totalG,
    };
  }
}

/** Para testes e diagnóstico: o caminho de uma chave dado o banco. */
export function caminhoDoArquivo(raiz: string, banco: string, chave: string): string {
  return caminhoNaRaiz(raiz, pastaDoBanco(banco), chave);
}
