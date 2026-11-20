// pnpm instalacao:gerar [-- --conferir]
// M60, etapa 2: gera, do catálogo e do layout, os arquivos do servidor (deploy/ubuntu/gerado/), o modelo comentado do
// arquivo de ambiente (deploy/ubuntu/sante.env.modelo) e o anexo de variáveis e portas
// (docs/implantacao/anexos/variaveis.md). `--conferir`: não grava; falha se algo versionado diverge do gerado ou se o
// catálogo não cobre toda variável lida pelo código de produção (uso no verificar).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { modeloAmbiente } from './ambiente.ts';
import { anexoVariaveis } from './anexo.ts';
import { arquivosGerados } from './artefatos.ts';
import { chavesDoRepositorio } from './repositorio.ts';
import { conferirCatalogo } from './variaveis.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const alvos: Record<string, string> = {
  'deploy/ubuntu/sante.env.modelo': modeloAmbiente(),
  'docs/implantacao/anexos/variaveis.md': anexoVariaveis(),
};
for (const [k, v] of Object.entries(arquivosGerados())) alvos[`deploy/ubuntu/gerado/${k}`] = v;

const catalogo = conferirCatalogo(chavesDoRepositorio(raiz));
if (catalogo.semEntrada.length + catalogo.obsoletas.length > 0) {
  if (catalogo.semEntrada.length)
    console.error(`Variáveis lidas pelo código sem entrada no catálogo: ${catalogo.semEntrada.join(', ')}.`);
  if (catalogo.obsoletas.length)
    console.error(`Variáveis do catálogo que o código não lê mais: ${catalogo.obsoletas.join(', ')}.`);
  console.error('Atualize tools/instalacao/src/variaveis.ts e rode pnpm instalacao:gerar.');
  process.exit(1);
}

if (process.argv.includes('--conferir')) {
  const divergentes = Object.entries(alvos)
    .filter(([k, v]) => {
      const c = resolve(raiz, k);
      return !existsSync(c) || readFileSync(c, 'utf8') !== v;
    })
    .map(([k]) => k);
  if (divergentes.length) {
    console.error(
      `Arquivos de instalação desatualizados: ${divergentes.join(', ')}. Rode pnpm instalacao:gerar.`,
    );
    process.exit(1);
  }
  console.log(`Pacote de instalação em dia: ${Object.keys(alvos).length} arquivo(s) gerado(s).`);
} else {
  for (const [k, v] of Object.entries(alvos)) {
    const c = resolve(raiz, k);
    mkdirSync(dirname(c), { recursive: true });
    writeFileSync(c, v);
  }
  console.log(
    `${Object.keys(alvos).length} arquivo(s) gerado(s) em deploy/ubuntu e docs/implantacao/anexos.`,
  );
}
