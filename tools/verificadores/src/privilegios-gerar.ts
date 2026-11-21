// pnpm privilegios:gerar -- [--conferir]
// M59-F1 (regra 4): gera o alcance por módulo e o par de scripts dos papéis por módulo do banco próprio
// (infra/mariadb/privilegios/0001_papeis_por_modulo.{aplicar,recolher}.sql). Com --conferir, só confere que os
// arquivos versionados estão em dia (sai 1 se não estiverem). Nunca grava no banco: os scripts são executados pela TI,
// um passo por autorização do dono.
// Melhoria: plano recusado (nome dinâmico sem catálogo, DELETE clínico, UPDATE na trilha) sai 1 sem gravar nada.
// Melhoria: não lê banco nenhum (o alcance sai do código e do DDL); o mesmo par de scripts vale para todo cliente.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { lerArgumentos } from './argumentos.ts';
import {
  caminhoAlcance,
  caminhoScript,
  gerarArtefatos,
  PlanoPrivilegioRecusado,
  RAIZ,
  type Artefatos,
} from './privilegios.ts';

const { bandeiras } = lerArgumentos(process.argv.slice(2));
let a: Artefatos;
try {
  a = gerarArtefatos();
} catch (e) {
  if (!(e instanceof PlanoPrivilegioRecusado)) throw e;
  // Plano recusado (nome dinâmico sem catálogo, DELETE clínico, UPDATE na trilha...): nada é gravado.
  for (const m of e.motivos) console.error(`recusado: ${m}`);
  process.exit(1);
}
const destinos: [string, string][] = [
  [caminhoAlcance(), a.alcanceJson],
  [caminhoScript('aplicar'), a.aplicar],
  [caminhoScript('recolher'), a.recolher],
];
console.log(
  `alcance ${a.versao}: ${a.modulos} módulo(s), ${a.itens} privilégio(s); ${a.descartes.length} uso(s) descartado(s).`,
);
for (const d of a.descartes.slice(0, 40)) console.warn(`  aviso, descartado: ${d}`);
for (const d of a.avisos) console.warn(`  aviso: ${d}`);
if (bandeiras.has('conferir')) {
  const fora = destinos.filter(
    ([p, t]) => !existsSync(resolve(RAIZ, p)) || readFileSync(resolve(RAIZ, p), 'utf8') !== t,
  );
  for (const [p] of fora) console.error(`desatualizado: ${p} (rode pnpm privilegios:gerar)`);
  process.exit(fora.length > 0 ? 1 : 0);
}
for (const [p, t] of destinos) {
  mkdirSync(dirname(resolve(RAIZ, p)), { recursive: true });
  writeFileSync(resolve(RAIZ, p), t);
  console.log(`gravado: ${p}`);
}
