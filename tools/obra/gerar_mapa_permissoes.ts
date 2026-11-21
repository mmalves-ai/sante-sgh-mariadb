// F2.4 / ADR 0007, item 8: o mapa origem → permissão do produto (conector/mapa/permissoes.tsv) é DADO DO CONECTOR e a
// única fonte da procedência: a declaração da permissão não guarda opção do menu nem marca de usuário de origem. Cada
// linha diz que quem tinha a opção do menu (ou a marca de usuário) no sistema de origem recebe a permissão do produto;
// o conector usa o mapa para importar os grupos e usuários como perfil_acao e usuario_acao_excecao.
// O mapa não é mais gerado do catálogo: é editado à mão (com revisão) e este comando só confere.
// Uso: node --import ./tools/verificadores/src/caminhos-sgh.ts tools/obra/gerar_mapa_permissoes.ts [--conferir]
// Confere: cabeçalho e linhas válidas, sem repetição, em ordem, e toda permissão do mapa existe no catálogo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOGO_DECLARADO } from '@sgh/contratos';
import { CATALOGO_BASE } from '@sgh/contratos/catalogo-base';
import { lerMapaOrigem } from '@sgh/dominio-acesso';
// Mesmo arquivo que tools/verificadores/src/permissoes.ts lê (fronteira do Nx: ferramenta não importa outra por caminho).
const ARQUIVO_MAPA_ORIGEM = resolve(import.meta.dirname, '../../conector/mapa/permissoes.tsv');

const texto = readFileSync(ARQUIVO_MAPA_ORIGEM, 'utf8');
const erros: string[] = [];
if (!texto.startsWith('tipo_origem\tchave_origem\tcodigo_permissao\n')) erros.push('cabeçalho diferente');
const mapa = lerMapaOrigem(texto);
const codigos = new Set([...CATALOGO_BASE, ...CATALOGO_DECLARADO].map((p) => p.codigo));
const chaves = mapa.map((m) => `${m.tipo}\t${m.chave}\t${m.permissao}`);
if (new Set(chaves).size !== chaves.length) erros.push('linha repetida');
const ordenadas = [...chaves].sort((a, b) => {
  const [ta, ca, pa] = a.split('\t');
  const [tb, cb, pb] = b.split('\t');
  return (
    ta!.localeCompare(tb!) || Number(ca) - Number(cb) || ca!.localeCompare(cb!) || pa!.localeCompare(pb!)
  );
});
if (ordenadas.join('\n') !== chaves.join('\n')) erros.push('linhas fora de ordem');
const orfas = new Set(mapa.filter((m) => !codigos.has(m.permissao)).map((m) => m.permissao));
if (orfas.size > 0)
  erros.push(`${orfas.size} permissão(ões) do mapa fora do catálogo: ${[...orfas].slice(0, 5).join(', ')}`);
console.log(
  erros.length === 0 ? `ok (${mapa.length} linhas)` : `conector/mapa/permissoes.tsv: ${erros.join('; ')}`,
);
process.exit(erros.length === 0 ? 0 : 1);
