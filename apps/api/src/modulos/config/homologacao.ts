// Fonte da homologação (M36) para as telas de coexistência: "Testes de assinatura de dados" (rodada de conferência,
// conferências e origem das referências), "Conferência de gravação" (triggers vistos no trace × catálogo) e
// "Verificação de schema" (impressão da cópia × homologada × conferências). Só leitura do painel gerado por
// `pnpm homologacao:roteiro` (docs/homologacao/homologacao.json; nomes de estrutura, estados e contagens, nenhum valor
// de linha). Nenhum acesso ao banco. Arquivo ausente ou fora do esquema: null (a tela diz que não foi gerado).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { esquemaPainelHomologacao, type PainelHomologacao } from '@sgh/contratos';

export interface FonteHomologacao {
  painel(): PainelHomologacao | null;
}

export const FONTE_HOMOLOGACAO = Symbol('FONTE_HOMOLOGACAO');

export function caminhoHomologacao(raiz: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolve(raiz, env['SGH_HOMOLOGACAO'] ?? 'docs/homologacao/homologacao.json');
}

export function fonteArquivoHomologacao(caminho: string): FonteHomologacao {
  let cache: { mtime: number; painel: PainelHomologacao | null } | null = null;
  return {
    painel() {
      if (!existsSync(caminho)) return null;
      try {
        const mtime = statSync(caminho).mtimeMs;
        if (cache && cache.mtime === mtime) return cache.painel;
        const painel = esquemaPainelHomologacao.parse(JSON.parse(readFileSync(caminho, 'utf8')));
        cache = { mtime, painel };
        return painel;
      } catch {
        return null;
      }
    },
  };
}
