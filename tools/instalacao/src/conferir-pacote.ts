// node tools/instalacao/src/conferir-pacote.ts <pasta da versão>
// M60, etapa 2: confere a árvore desempacotada contra o manifesto.json do pacote (arquivos a menos, a mais, alterados
// e o hash do conjunto). Usado pelo instalar.sh e pelo atualizar.sh antes de trocar a versão em uso.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ARQUIVO_MANIFESTO, listarArvore } from './arvore.ts';
import { type ArquivoManifesto, conferirArvore, hashDoConjunto, type Manifesto } from './pacote.ts';

const raiz = resolve(process.argv[2] ?? '.');
const m = JSON.parse(readFileSync(join(raiz, ARQUIVO_MANIFESTO), 'utf8')) as {
  resumo: Manifesto;
  arquivos: ArquivoManifesto[];
};
const r = conferirArvore(m.arquivos, listarArvore(raiz));
const conjunto = hashDoConjunto(m.arquivos) === m.resumo.sha256Conjunto;
if (r.faltam.length + r.sobram.length + r.alterados.length > 0 || !conjunto) {
  const mostrar = (t: string, l: string[]) =>
    l.length
      ? console.error(`  ${t}: ${l.length} (${l.slice(0, 5).join(', ')}${l.length > 5 ? ', …' : ''})`)
      : 0;
  mostrar('faltam', r.faltam);
  mostrar('sobram', r.sobram);
  mostrar('alterados', r.alterados);
  if (!conjunto) console.error('  o hash do conjunto não confere com o resumo do manifesto.');
  console.error('Pacote recusado: a árvore não confere com o manifesto.');
  process.exit(1);
}
console.log(`Pacote conferido: ${m.resumo.identificacao}, ${m.arquivos.length} arquivo(s).`);
