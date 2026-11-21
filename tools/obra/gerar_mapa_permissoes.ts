// F2.4: mapa origem → permissão do produto, como DADO DO CONECTOR (conector/mapa/permissoes.tsv). Cada linha diz que
// quem tinha a opção do menu (ou a marca de usuário) no sistema de origem recebe a permissão do produto; o conector usa
// o mapa para importar os grupos e usuários como perfil_acao e usuario_acao_excecao. O produto não guarda a origem.
// Uso: node --import ./tools/verificadores/src/caminhos-sgh.ts tools/obra/gerar_mapa_permissoes.ts [--conferir]
// --conferir: só compara com o arquivo gravado (sai 1 se diferir).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOGO_DECLARADO, type DeclaracaoPermissao } from '@sgh/contratos';
import { CATALOGO_LEGADO } from '@sgh/contratos/catalogo-legado';

const raiz = resolve(import.meta.dirname, '../..');
const arquivo = resolve(raiz, 'conector/mapa/permissoes.tsv');

export function linhasDoMapa(catalogo: readonly DeclaracaoPermissao[]): string[] {
  const linhas = new Set<string>();
  for (const p of catalogo) {
    for (const o of p.opcoesLegado) linhas.add(`opcao_menu\t${o}\t${p.codigo}`);
    for (const f of p.flagsLegado ?? []) linhas.add(`marca_usuario\t${f.tabela}.${f.coluna}\t${p.codigo}`);
  }
  return [...linhas].sort((a, b) => {
    const [ta, ca, pa] = a.split('\t');
    const [tb, cb, pb] = b.split('\t');
    return (
      ta!.localeCompare(tb!) || Number(ca) - Number(cb) || ca!.localeCompare(cb!) || pa!.localeCompare(pb!)
    );
  });
}

const texto =
  'tipo_origem\tchave_origem\tcodigo_permissao\n' +
  linhasDoMapa([...CATALOGO_LEGADO, ...CATALOGO_DECLARADO]).join('\n') +
  '\n';
if (process.argv.includes('--conferir')) {
  const igual = existsSync(arquivo) && readFileSync(arquivo, 'utf8') === texto;
  console.log(igual ? 'ok' : 'conector/mapa/permissoes.tsv difere do catálogo: rode sem --conferir');
  process.exit(igual ? 0 : 1);
}
writeFileSync(arquivo, texto, 'utf8');
const n = texto.split('\n').length - 2;
console.log(`gravado conector/mapa/permissoes.tsv (${n} linhas)`);
