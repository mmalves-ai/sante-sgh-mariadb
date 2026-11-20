// node tools/instalacao/src/empacotar.ts <pasta montada do pacote>
// M60, etapa 2: grava o manifesto.json da pasta do pacote (resumo + cada arquivo com o sha256). Roda DENTRO do
// contêiner de construção (deploy/ubuntu/construir-no-conteiner.sh), depois de copiar o conteúdo do pacote; o
// versao.json da raiz do pacote (versão, commit e identificação, as mesmas do build da API) vem desse script.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lerScriptsSgh } from '@sgh/legado';
import { ARQUIVO_MANIFESTO, listarArvore } from './arvore.ts';
import { foraDoPacote, montarManifesto, NODE_VERSAO } from './pacote.ts';

const raiz = resolve(process.argv[2] ?? '.');
const versaoBuild = JSON.parse(readFileSync(join(raiz, 'versao.json'), 'utf8')) as {
  produto?: string;
  versao: string;
  commit: string | null;
  construidoEm: string;
  identificacao: string;
};
const arquivos = listarArvore(raiz);
const proibidos = arquivos.filter((a) => foraDoPacote(a.caminho) && !a.caminho.startsWith('node_modules/'));
if (proibidos.length) {
  console.error(
    `Arquivos proibidos no pacote: ${proibidos
      .slice(0, 10)
      .map((a) => a.caminho)
      .join(', ')}.`,
  );
  process.exit(1);
}
const scripts = lerScriptsSgh(join(raiz, 'packages/legado/src'));
const ultimo = scripts.length ? String(Math.max(...scripts.map((s) => s.numero))).padStart(4, '0') : null;
const resumo = montarManifesto(
  {
    produto: versaoBuild.produto ?? 'sante-sgh',
    versao: versaoBuild.versao,
    commit: versaoBuild.commit,
    identificacao: versaoBuild.identificacao,
    construidoEm: versaoBuild.construidoEm,
    node: NODE_VERSAO,
    scriptsSgh: { quantidade: scripts.length, ultimo },
  },
  arquivos,
);
writeFileSync(join(raiz, ARQUIVO_MANIFESTO), `${JSON.stringify({ resumo, arquivos }, null, 1)}\n`);
console.log(
  `manifesto: ${resumo.identificacao}, ${resumo.arquivos} arquivo(s), ${scripts.length} script(s) SGH_.`,
);
