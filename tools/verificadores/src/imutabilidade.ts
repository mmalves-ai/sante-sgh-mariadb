// M59-F3 (ficha do M59, regra 6; cap-08 §8.16; SBIS-26): a imutabilidade clínica imposta por privilégio. Daqui saem:
//   - a lista gerada das tabelas clínicas do legado (packages/contratos/src/acesso/tabelas-clinicas.gerado.ts), a
//     partir da matriz de cobertura (módulo PEP, naturezas de registro); o spec confere que o arquivo está em dia;
//   - a conferência do repositório: operações do catálogo e plano dos papéis por módulo sem DELETE clínico fora das
//     exceções, e nenhum GRANT de DELETE em tabela SGH_ clínica ao papel SGH_APLICACAO nos scripts SGH_;
//   - o par de scripts 0002_imutabilidade_clinica (REVOKE DELETE da conta ampla da aplicação, a partir do retrato dos
//     privilégios dela lido ANTES), executado pela TI com autorização do dono (regra 4 da Fase 7).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CRITERIOS_CLINICOS_MATRIZ,
  EXCECOES_DELETE_CLINICO,
  MODULOS_CLINICOS_MATRIZ,
  NATUREZAS_REGISTRO_CLINICO,
  deleteClinicoProibido,
  telaClinica,
} from '@sgh/contratos';
import { lerScriptsSgh, operacoesComDeleteClinicoDoCatalogo } from '@sgh/legado';
import { RAIZ } from './privilegios.ts';

export const CAMINHO_MATRIZ = 'planejamento/referencias/matriz-cobertura-1503-tabelas.tsv';
export const CAMINHO_TABELAS_CLINICAS = 'packages/contratos/src/acesso/tabelas-clinicas.gerado.ts';
export const NOME_PASSO_IMUTABILIDADE = '0002_imutabilidade_clinica';

/** Tabelas clínicas do legado pela matriz (módulo clínico, tela do registro e natureza de registro), em ordem. */
export function tabelasClinicasDaMatriz(tsv: string): string[] {
  const [cab, ...linhas] = tsv.split('\n');
  const col = (cab ?? '').split('\t');
  const iT = col.indexOf('tabela');
  const iM = col.indexOf('modulo');
  const iN = col.indexOf('natureza');
  const iF = col.indexOf('tela_funcao');
  if (iT < 0 || iM < 0 || iN < 0 || iF < 0)
    throw new Error(`${CAMINHO_MATRIZ}: cabeçalho sem tabela, modulo, tela_funcao ou natureza.`);
  const criterios = new Map(CRITERIOS_CLINICOS_MATRIZ.map((c) => [c.modulo, c]));
  const naturezas = new Set<string>(NATUREZAS_REGISTRO_CLINICO);
  const saida = new Set<string>();
  for (const l of linhas) {
    const c = l.split('\t');
    const t = c[iT]?.trim();
    const criterio = criterios.get(c[iM]?.trim() ?? '');
    if (t && criterio && naturezas.has(c[iN]?.trim() ?? '') && telaClinica(criterio, c[iF] ?? ''))
      saida.add(t);
  }
  return [...saida].sort();
}

/** O texto exato do arquivo gerado (o spec compara byte a byte). */
export function textoTabelasClinicas(tabelas: readonly string[]): string {
  return [
    '// Gerado por tools/verificadores/src/imutabilidade.ts a partir da matriz de cobertura (M59-F3, regra 6).',
    `// Tabelas dos módulos ${MODULOS_CLINICOS_MATRIZ.join(', ')} (telas do registro) de natureza ${NATUREZAS_REGISTRO_CLINICO.join(', ')}. Não edite à mão:`,
    '// ./pnpm imutabilidade:gerar regrava.',
    'export const TABELAS_CLINICAS_LEGADO: readonly string[] = [',
    ...tabelas.map((t) => `  '${t}',`),
    '];',
    '',
  ].join('\n');
}

export function gerarTabelasClinicas(raiz = RAIZ): string {
  return textoTabelasClinicas(tabelasClinicasDaMatriz(readFileSync(resolve(raiz, CAMINHO_MATRIZ), 'utf8')));
}

export interface AchadoImutabilidade {
  readonly origem: 'operacao' | 'script-sgh';
  readonly onde: string;
  readonly tabela: string;
}

/** Operações do catálogo com DELETE em tabela clínica fora das exceções (a regra mora no adaptador). */
export function operacoesComDeleteClinico(
  ops?: Parameters<typeof operacoesComDeleteClinicoDoCatalogo>[0],
): AchadoImutabilidade[] {
  return operacoesComDeleteClinicoDoCatalogo(ops).map((o) => ({
    origem: 'operacao',
    onde: o.operacao,
    tabela: o.tabela,
  }));
}

const GRANT =
  /GRANT\s+([^;]*?)\s+ON\s+(?:TABLE\s+)?"?(SGH_[A-Z0-9_]+)"?\s+TO\s+(?:ROLE\s+)?"?SGH_APLICACAO"?/gi;

/** GRANT de DELETE em tabela SGH_ clínica ao papel da aplicação nos scripts SGH_ (fora das exceções). */
export function grantsDeleteClinicoSgh(
  scripts: readonly { arquivo: string; sql: string }[],
): AchadoImutabilidade[] {
  const r: AchadoImutabilidade[] = [];
  for (const s of scripts) {
    for (const m of s.sql.matchAll(GRANT)) {
      const acoes = (m[1] ?? '').toUpperCase();
      const tabela = (m[2] ?? '').toUpperCase();
      if ((/\bDELETE\b/.test(acoes) || /\bALL\b/.test(acoes)) && deleteClinicoProibido(tabela))
        r.push({ origem: 'script-sgh', onde: s.arquivo, tabela });
    }
  }
  return r;
}

export function scriptsSghDoRepositorio(raiz = RAIZ): { arquivo: string; sql: string }[] {
  return lerScriptsSgh(resolve(raiz, 'packages/legado/src')).map((s) => ({
    arquivo: s.arquivo,
    sql: s.comandos.join(';\n'),
  }));
}

export { EXCECOES_DELETE_CLINICO };
