// Guarda do XML TISS (M31; ficha, regra 4; ADR 0004): o XML enviado e recebido vai ao disco da máquina, sob a raiz de
// arquivos (ARQUIVOS_RAIZ), na pasta do banco do cliente, pela porta de arquivos do núcleo (caminho preso na raiz,
// gravação uma vez com fsync, somente leitura e link atômico). A chave é única por lote e hash e é o caminho relativo
// registrado em `arquivo.chave_armazenamento` (ligado ao lote_tiss e ao demonstrativo_analise_conta): a chave já
// ocupada é recusada antes de gravar e nunca é reescrita. Em memória na sessão sintética.
//
// `guardaLocal` é o auxiliar comum das guardas por chave do pós-fechamento (TISS, financeiro, SUS e patrimônio), e
// `registrarArquivoGuardado` é o registro comum em `arquivo` (hash, tamanho, tipo, imutável e guarda legal), feito pela
// operação do módulo na mesma transação da tabela dona: é contra ele que o vigia do worker confere o disco.
import { lstat, readFile, unlink } from 'node:fs/promises';
import type { GuardarXml } from '@sgh/dominio-faturamento';
import { guardaXmlMemoria } from '@sgh/dominio-faturamento';
import {
  type Ambiente,
  criarArmazemLocal,
  ErroConfiguracao,
  ErroOperacao,
  gravarUmaVez,
  type NucleoArmazem,
  sha256,
  type TxOperacao,
} from '@sgh/nucleo';

export interface ArmazemXmlTiss {
  readonly guardar: GuardarXml;
  ler(chave: string): Promise<Uint8Array | null>;
}

export class ErroSobrescritaXml extends Error {
  override readonly name = 'ErroSobrescritaXml';
}

export function armazemXmlMemoria(): ArmazemXmlTiss & { objetos: Map<string, Uint8Array> } {
  const g = guardaXmlMemoria();
  return {
    guardar: g,
    objetos: g.objetos,
    ler: async (chave) => g.objetos.get(chave) ?? null,
  };
}

/** O que a guarda usa da porta de arquivos do núcleo: o caminho absoluto de uma chave do cliente, preso na raiz. */
export interface LocalizadorArquivos {
  caminho(cliente: string, chave: string): Promise<string>;
}

/** A guarda por chave sobre o disco local (pasta do banco do cliente na raiz de arquivos). */
export interface GuardaLocal {
  /**
   * Grava uma vez. Chave já ocupada: com `reaproveitar`, o mesmo conteúdo é aceito (`existente`) e outro é recusado
   * (`arquivo-divergente`); sem ele, `recusar(chave)` é lançado e nada é gravado.
   */
  gravar(
    chave: string,
    bytes: Uint8Array,
    opcoes: { readonly reaproveitar?: boolean; readonly recusar: (chave: string) => Error },
  ): Promise<'gravado' | 'existente'>;
  /** O conteúdo da chave; null se não existe no disco. */
  ler(chave: string): Promise<Uint8Array | null>;
  /**
   * Só na guarda criada com `removivel`: remove o arquivo que ESTA guarda gravou e que ainda não foi fixado (o da
   * transação recusada). Chave fixada, alheia ou gravada por outra guarda: recusa 409 `arquivo-retido`, nada apagado.
   */
  remover(chave: string): Promise<void>;
  /** Confirma a chave gravada (depois do COMMIT): daí em diante `remover` a recusa. */
  fixar(chave: string): void;
}

const retido = (chave: string) =>
  new ErroOperacao(
    409,
    'arquivo-retido',
    'Arquivo retido',
    `O arquivo ${chave} não foi gravado por esta transação ou já foi confirmado: não pode ser removido por aqui.`,
  );

async function existeArquivo(caminho: string): Promise<boolean> {
  try {
    return (await lstat(caminho)).isFile();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

/**
 * A guarda local do cliente. O localizador é pedido só no primeiro uso: sem ARQUIVOS_RAIZ, a gravação e a leitura
 * falham fechadas (erro de configuração), nunca caem num destino alternativo.
 */
export function guardaLocal(
  localizador: () => LocalizadorArquivos,
  cliente: string,
  config: { readonly removivel?: boolean } = {},
): GuardaLocal {
  const caminho = (chave: string) => localizador().caminho(cliente, chave);
  // As chaves gravadas por esta guarda e ainda não fixadas: as únicas que `remover` aceita (só com `removivel`).
  const recentes = new Set<string>();
  return {
    async gravar(chave, bytes, opcoes) {
      const alvo = await caminho(chave);
      if (!opcoes.reaproveitar && (await existeArquivo(alvo))) throw opcoes.recusar(chave);
      const r = await gravarUmaVez(alvo, bytes, sha256(bytes));
      if (r === 'existente' && !opcoes.reaproveitar) throw opcoes.recusar(chave);
      if (r === 'gravado' && config.removivel) recentes.add(chave);
      return r;
    },
    async ler(chave) {
      try {
        return new Uint8Array(await readFile(await caminho(chave)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async remover(chave) {
      if (!recentes.has(chave)) throw retido(chave);
      try {
        await unlink(await caminho(chave));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      recentes.delete(chave);
    },
    fixar(chave) {
      recentes.delete(chave);
    },
  };
}

/** Guarda legal dos documentos fiscais e administrativos guardados (RDC 509; legislação fiscal): 5 anos. */
export const ANOS_GUARDA_LEGAL = 5;

/** A data (AAAA-MM-DD) do fim da guarda: `anos` depois de `base`. */
export function retencaoAte(base: Date, anos: number = ANOS_GUARDA_LEGAL): string {
  const d = new Date(base.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + anos);
  return d.toISOString().slice(0, 10);
}

/** O arquivo já guardado no disco pela guarda local, para o registro em `arquivo`. */
export interface ArquivoParaRegistro {
  readonly estabelecimento: number | null;
  /** Tabela dona; `entidadeId` é ligado depois por `ligarArquivo` quando a linha dona nasce na mesma transação. */
  readonly entidade: string;
  readonly entidadeId?: number | null;
  readonly finalidade: string;
  readonly nomeOriginal: string;
  readonly tipoMime: string;
  readonly tamanhoBytes: number;
  readonly hash: string;
  readonly chave: string;
  readonly retencaoAte: string;
}

/**
 * Registra em `arquivo` (pela transação da operação: trilha e auditoria juntas) o arquivo que a guarda local gravou:
 * chave, SHA-256, tamanho, tipo, imutável e guarda legal. A chave já registrada (UNIQUE) é o mesmo arquivo: devolve o
 * registro existente se o hash confere, e recusa (409 `arquivo-divergente`) se não confere.
 */
export async function registrarArquivoGuardado(
  tx: TxOperacao,
  a: ArquivoParaRegistro,
): Promise<{ id: number; novo: boolean }> {
  const ja = await tx.uma('SELECT id, hash_sha256 FROM arquivo WHERE chave_armazenamento = ?', [a.chave]);
  if (ja) {
    if (String(ja['hash_sha256']) !== a.hash)
      throw new ErroOperacao(
        409,
        'arquivo-divergente',
        'Arquivo divergente',
        `A chave ${a.chave} já está registrada com outro conteúdo.`,
      );
    return { id: Number(ja['id']), novo: false };
  }
  const id = await tx.incluir('arquivo', {
    estabelecimento_id: a.estabelecimento,
    entidade: a.entidade,
    entidade_id: a.entidadeId ?? null,
    finalidade: a.finalidade,
    nome_original: a.nomeOriginal.slice(0, 255),
    tipo_mime: a.tipoMime,
    tamanho_bytes: a.tamanhoBytes,
    hash_sha256: a.hash,
    chave_armazenamento: a.chave,
    retencao_ate: a.retencaoAte,
    imutavel: true,
  });
  return { id, novo: true };
}

/** Liga o registro recém-criado à linha dona (versão 1: o registro acabou de nascer nesta transação). */
export async function ligarArquivo(
  tx: TxOperacao,
  arquivo: { id: number; novo: boolean },
  entidadeId: number,
) {
  if (arquivo.novo) await tx.alterar('arquivo', arquivo.id, 1, { entidade_id: entidadeId });
}

/** A guarda do XML TISS no disco local: a chave existente é recusada (o arquivo guardado é imutável). */
export function armazemXmlLocal(localizador: () => LocalizadorArquivos, cliente: string): ArmazemXmlTiss {
  const g = guardaLocal(localizador, cliente);
  const recusar = (chave: string) =>
    new ErroSobrescritaXml(`O XML ${chave} já está guardado: o arquivo guardado é imutável.`);
  return {
    async guardar(chave, bytes) {
      await g.gravar(chave, bytes, { recusar });
      // A versão é o próprio hash do conteúdo (registrado em `arquivo`): não há versão de objeto à parte.
      return { versao: null };
    },
    ler: (chave) => g.ler(chave),
  };
}

/**
 * O localizador do ambiente: a porta de arquivos do núcleo sobre ARQUIVOS_RAIZ, criada no primeiro uso (uma por
 * guarda). Sem a raiz, `ErroConfiguracao` no uso: a falha é fechada.
 */
export function localizadorDoNucleo(nucleo: NucleoArmazem | null, env: Ambiente): () => LocalizadorArquivos {
  let armazem: LocalizadorArquivos | null = null;
  return () => {
    if (!nucleo) throw new ErroConfiguracao('Guarda de arquivos sem o banco do cliente (núcleo ausente).');
    return (armazem ??= criarArmazemLocal(nucleo, { env }));
  };
}
