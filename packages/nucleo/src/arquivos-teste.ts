// Auxiliar comum dos testes que guardam arquivos (ADR 0004): uma pasta temporária por cliente de teste
// (SGH_CLIENTE_TESTE), usada como ARQUIVOS_RAIZ, apagada no fim. Os arquivos guardados ficam somente leitura, mas a
// pasta é do teste e sai inteira. Nunca aponta para a raiz de uma instalação.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PastaArquivosTeste {
  /** Raiz temporária (ARQUIVOS_RAIZ do teste). */
  readonly raiz: string;
  readonly cliente: string;
  /** Apaga a pasta inteira (chame no afterAll). */
  apagar(): Promise<void>;
}

/** Cria a pasta temporária do cliente de teste (padrão: SGH_CLIENTE_TESTE, senão "teste"). */
export async function criarPastaArquivosTeste(cliente?: string): Promise<PastaArquivosTeste> {
  const c = (cliente ?? process.env['SGH_CLIENTE_TESTE'] ?? '').trim() || 'teste';
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(c)) throw new Error('Cliente de teste inválido.');
  const raiz = await mkdtemp(join(tmpdir(), `sgh-arquivos-${c}-`));
  return {
    raiz,
    cliente: c,
    apagar: () => rm(raiz, { recursive: true, force: true }),
  };
}
