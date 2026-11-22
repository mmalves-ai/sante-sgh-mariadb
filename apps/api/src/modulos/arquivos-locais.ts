// Ponte dos módulos da API para a porta de arquivos do núcleo (ADR 0004: só disco local, sob ARQUIVOS_RAIZ, uma pasta
// por banco de cliente; o metadado na tabela `arquivo`, gravado pelo Executor com trilha e idempotência). Os módulos
// (fotos da higienização e da portaria, digitalização certificada, provas do portal) falam por código de
// estabelecimento da sessão; aqui ele vira o contexto do núcleo pelo mapa da API. A tabela dona guarda o id do arquivo.
// O código fora do mapa do cliente recusa (403, falha fechada): nunca grava nem lê sem estabelecimento. A idempotência
// do registro é por tentativa (a deduplicação já é a da chave de armazenamento, pelo hash): o reenvio depois de uma
// exclusão reativa o registro, e o mesmo conteúdo em outro mês vira outro registro, sem conflito de idempotência.
// Sem núcleo (sessão sintética de dev/ci), o módulo usa o armazém em memória dele (`arquivosDoAmbiente` devolve null).
// Com núcleo e sem ARQUIVOS_RAIZ: indisponível (503 em toda chamada; falha fechada, nunca conteúdo vazio).
import { randomUUID } from 'node:crypto';
import {
  type ArmazemArquivos,
  type ContextoNucleo,
  type ContextoOperacao,
  criarArmazemLocal,
  definirOperacao,
  type EntradaGuardar,
  type Executor,
  lerRaizArquivos,
  type MetadadoArquivo,
  type NucleoArmazem,
  recusa,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../problema.filter.js';
import { contextoDoEstabelecimento } from './cadastro/contexto-nucleo.js';

export type EntradaArquivoModulo = Omit<EntradaGuardar, 'origem'>;

export interface ArquivoDoModulo {
  readonly id: number;
  readonly hash: string;
  readonly reaproveitado: boolean;
}

/** A porta de arquivos vista por um módulo da API (pelo código do estabelecimento da sessão). */
export interface ArquivosDoModulo {
  guardar(hospital: string, entrada: EntradaArquivoModulo): Promise<ArquivoDoModulo>;
  /** Metadado do arquivo ativo do estabelecimento (outro estabelecimento, excluído ou inexistente: null). */
  metadado(hospital: string, id: number): Promise<MetadadoArquivo | null>;
  /** Conteúdo conferido pelo hash (falta ou divergência no disco: erro 500, nunca conteúdo errado). */
  ler(hospital: string, id: number): Promise<{ metadado: MetadadoArquivo; conteudo: Buffer } | null>;
  /** Exclusão lógica e remoção do arquivo (recusada antes da guarda legal). Inexistente: nada a fazer. */
  excluir(hospital: string, id: number): Promise<void>;
  /**
   * Guarda legal depois do COMMIT de quem é dono: `retencao_ate` passa a `ate` (só estende, nunca encurta). Inexistente
   * ou de outro estabelecimento: 404.
   */
  fixarRetencao(hospital: string, id: number, ate: string): Promise<void>;
}

/** O id do arquivo no fim da chave do módulo (`.../arquivo-<id>.<ext>`). */
export const ID_NA_CHAVE = /arquivo-([1-9]\d{0,14})\.[a-z]{3,4}$/;
export const idNaChave = (chave: string): number | null => {
  const m = ID_NA_CHAVE.exec(chave);
  return m ? Number(m[1]) : null;
};

/** AAAA-MM-DD daqui a `anos` anos (guarda legal), em UTC. */
export function dataDaqui(anos: number, agora: Date = new Date()): string {
  const d = new Date(agora.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + anos);
  return d.toISOString().slice(0, 10);
}

/** Dev e CI: sem guarda legal (o armazenamento é descartável). */
export const ambienteCurto = (env: NodeJS.ProcessEnv) => {
  const a = (env['AMBIENTE'] ?? 'dev').trim() || 'dev';
  return a === 'dev' || a === 'ci';
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

const dataDoBanco = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

/** A guarda legal fixada depois do COMMIT do dono (só estende; o registro excluído recusa). */
const fixarRetencaoArquivo = definirOperacao({
  nome: 'arquivo.fixar_retencao',
  tabelas: ['arquivo'],
  acao: 'alteracao',
  entrada: z.object({
    id: z.number().int().positive(),
    versao: z.number().int().positive(),
    retencaoAte: z.string().regex(DATA),
  }),
  travar: (e) => ({
    tabela: 'arquivo',
    id: e.id,
    colunas: ['retencao_ate', 'excluido_em'],
    versaoEsperada: e.versao,
  }),
  async conferir(_tx, e, _ctx, relido) {
    if (!relido || relido['excluido_em'] !== null)
      throw recusa('arquivo-inexistente', 'O arquivo não existe ou foi excluído.');
    const atual = dataDoBanco(relido['retencao_ate']);
    if (atual !== null && atual > e.retencaoAte)
      throw recusa('retencao-menor', `A guarda legal vigente (${atual}) não é encurtada.`);
  },
  async gravar(tx, e) {
    const versao = await tx.alterar('arquivo', e.id, e.versao, { retencao_ate: e.retencaoAte });
    return { id: e.id, versao };
  },
  alvo: (e) => ({ tabela: 'arquivo', id: e.id }),
});

const foraDoMapa = (): ErroProblema =>
  new ErroProblema(
    'sem-permissao',
    403,
    'Estabelecimento sem mapa',
    'O estabelecimento da sessão não está no banco do cliente: nada foi lido nem gravado.',
    { codigo: 'estabelecimento-fora-do-mapa' },
  );

export function arquivosDoModulo(
  armazem: ArmazemArquivos,
  cliente: string,
  executor: Executor | null = null,
): ArquivosDoModulo {
  /** Falha fechada: o código sem mapa no cliente (ou de outro cliente) recusa antes de qualquer leitura ou gravação. */
  const contexto = (hospital: string): ContextoNucleo & { readonly estabelecimento: number } => {
    const m = contextoDoEstabelecimento(hospital);
    if (m.cliente !== cliente || m.estabelecimento === null) throw foraDoMapa();
    return { cliente, estabelecimento: m.estabelecimento, usuario: null, correlacao: `arq-${randomUUID()}` };
  };
  /** Idempotência por tentativa (nunca derivada só do conteúdo). */
  const operacao = (hospital: string, prefixo: string): ContextoOperacao => ({
    ...contexto(hospital),
    chaveIdempotencia: `arq:${prefixo}:${randomUUID()}`,
  });
  const metadado = async (hospital: string, id: number) => {
    const c = contexto(hospital);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const m = await armazem.metadado(c, id);
    // A chave do módulo vale só no estabelecimento que a gravou (como a pasta por hospital de antes).
    if (!m || m.estabelecimento !== c.estabelecimento) return null;
    return m;
  };
  return {
    async guardar(hospital, e) {
      const g = await armazem.guardar(e, operacao(hospital, 'guardar'));
      return { id: g.id, hash: g.hash, reaproveitado: g.reaproveitado };
    },
    metadado,
    async ler(hospital, id) {
      const m = await metadado(hospital, id);
      if (!m) return null;
      const r = await armazem.ler(contexto(hospital), id);
      return { metadado: r.metadado, conteudo: r.conteudo };
    },
    async excluir(hospital, id) {
      const m = await metadado(hospital, id);
      if (!m) return;
      await armazem.excluir(id, m.versao, operacao(hospital, 'excluir'));
    },
    async fixarRetencao(hospital, id, ate) {
      if (!DATA.test(ate)) throw new Error('data de retenção inválida');
      const m = await metadado(hospital, id);
      if (!m)
        throw new ErroProblema('nao-encontrado', 404, 'Arquivo não encontrado', 'O arquivo não existe.');
      if (m.retencaoAte !== null && m.retencaoAte >= ate) return;
      if (!executor) throw new Error('a fixação da guarda legal exige o executor do núcleo');
      await executor.executar(
        fixarRetencaoArquivo,
        cliente,
        { id, versao: m.versao, retencaoAte: ate },
        operacao(hospital, 'fixar'),
      );
    },
  };
}

/** Com núcleo e sem ARQUIVOS_RAIZ (ou sem cliente): 503 em toda chamada. */
export function arquivosIndisponiveis(): ArquivosDoModulo {
  const indisponivel = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Armazenamento de arquivos indisponível',
        'A raiz de arquivos (ARQUIVOS_RAIZ) não está configurada: nada foi lido nem gravado.',
      ),
    );
  return {
    guardar: indisponivel,
    metadado: indisponivel,
    ler: indisponivel,
    excluir: indisponivel,
    fixarRetencao: indisponivel,
  };
}

/**
 * A porta pelo ambiente do processo: sem núcleo, null (o módulo usa a memória dele); com núcleo, o disco local sob
 * ARQUIVOS_RAIZ (ou `raiz`, nos testes); sem raiz ou sem cliente, indisponível.
 */
export function arquivosDoAmbiente(
  nucleo: NucleoArmazem | null | undefined,
  cliente: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  raiz?: string,
): ArquivosDoModulo | null {
  if (!nucleo) return null;
  const r = raiz ?? lerRaizArquivos(env);
  if (!cliente || !r) return arquivosIndisponiveis();
  const executor = nucleo.criarExecutor();
  return arquivosDoModulo(criarArmazemLocal(nucleo, { raiz: r, executor }), cliente, executor);
}
