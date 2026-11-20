// Fonte da tela "Prontidão por setor" (M35; aba da tela de testes de assinatura) e do painel da carga somada na tela
// de saúde das conexões: só leitura do relatório gerado por `pnpm prontidao:relatorio` (docs/prontidao/
// prontidao.json; contagens e nomes de estrutura, nenhum valor de linha). Nenhum acesso ao banco. Arquivo ausente ou
// fora do esquema: null (a tela diz que o relatório ainda não foi gerado).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { esquemaRelatorioProntidao, type RelatorioProntidao } from '@sgh/contratos';

export interface FonteProntidao {
  relatorio(): RelatorioProntidao | null;
}

export const FONTE_PRONTIDAO = Symbol('FONTE_PRONTIDAO');

export function caminhoProntidao(raiz: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolve(raiz, env['SGH_PRONTIDAO'] ?? 'docs/prontidao/prontidao.json');
}

export function fonteArquivoProntidao(caminho: string): FonteProntidao {
  return {
    relatorio() {
      if (!existsSync(caminho)) return null;
      try {
        return esquemaRelatorioProntidao.parse(JSON.parse(readFileSync(caminho, 'utf8')));
      } catch {
        return null;
      }
    },
  };
}
