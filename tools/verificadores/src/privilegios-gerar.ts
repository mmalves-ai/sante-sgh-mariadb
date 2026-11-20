// pnpm privilegios:gerar -- [--hospital=pc] [--ler-catalogo] [--conferir]
// M59-F1 (ficha do M59, regra 4 e seção 6): gera o alcance por módulo e o par de scripts dos papéis por módulo
// (infra/firebird/fase7/privilegios/<h>/0001_papeis_por_modulo.{aplicar,recolher}.sql). Com --ler-catalogo, antes
// lê da cópia (transação de leitura, só metadado) as dependências dos gatilhos e regrava o retrato versionado; com
// --conferir, só confere que os arquivos versionados estão em dia (sai 1 se não estiverem). Nunca grava no banco:
// os scripts são executados pela TI, um passo por autorização do dono (ESTADO.md › Autorizações).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { lerConfiguracaoNucleo, lerDependenciasGatilhos, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { lerArgumentos } from './argumentos.ts';
import { codigosDaCopia } from './permissoes-copia.ts';
import {
  caminhoAlcance,
  caminhoDependencias,
  caminhoScripts,
  gerarArtefatos,
  NOME_PASSO_PAPEIS,
  RAIZ,
} from './privilegios.ts';

const { opcoes, bandeiras } = lerArgumentos(process.argv.slice(2));
const h = opcoes['hospital'] ?? 'pc';
if (!/^[a-z][a-z0-9]{1,9}$/.test(h)) {
  console.error('--hospital: código inválido.');
  process.exit(1);
}

if (bandeiras.has('ler-catalogo')) {
  const copia = codigosDaCopia();
  if (!copia || !copia.codigos.includes(h)) {
    console.error(`Sem cópia de dev configurada para "${h}" (AMBIENTE=dev, loopback).`);
    process.exit(1);
  }
  const nucleo = new NucleoLegado({
    env: copia.env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(copia.env).bibliotecaCliente }),
    pastaHomologada: resolve(RAIZ, 'tools/schema-check/homologado'),
    aviso: () => undefined,
  });
  try {
    const dep = await nucleo.lerSomente(
      { rede: nucleo.rede, hospital: h, traceId: 'privilegios-gerar' },
      (l) => lerDependenciasGatilhos(l),
    );
    const retrato = {
      formato: 1,
      estabelecimento: h,
      origem:
        'cópia de dev (RDB$TRIGGERS, RDB$PROCEDURES e fontes × RDB$DEPENDENCIES, leitura; fecho por procedure e gatilho da tabela gravada; o que PUBLIC e o próprio objeto têm fora)',
      ...dep,
    };
    writeFileSync(resolve(RAIZ, caminhoDependencias(h)), `${JSON.stringify(retrato, null, 1)}\n`);
    console.log(
      `${caminhoDependencias(h)}: ${Object.keys(dep.generatorsPorTabela).length} tabela(s) com generator, ` +
        `${Object.keys(dep.proceduresPorTabela).length} com procedure, ` +
        `${Object.keys(dep.tabelasPorTabela).length} com tabela usada pelo gatilho.`,
    );
  } finally {
    await nucleo.encerrar();
  }
}

const a = gerarArtefatos(h);
const destinos: [string, string][] = [
  [caminhoAlcance(h), a.alcanceJson],
  [`${caminhoScripts(h)}/${NOME_PASSO_PAPEIS}.aplicar.sql`, a.aplicar],
  [`${caminhoScripts(h)}/${NOME_PASSO_PAPEIS}.recolher.sql`, a.recolher],
];
if (a.semDependencias)
  console.warn(`aviso: sem ${caminhoDependencias(h)}; gatilhos sem dependências no plano.`);
console.log(
  `alcance ${a.versao}: ${a.modulos} módulo(s), ${a.itens} privilégio(s); ${a.descartes.length} uso(s) descartado(s).`,
);
for (const d of a.descartes.slice(0, 40)) console.log(`  descartado: ${d}`);
if (bandeiras.has('conferir')) {
  const fora = destinos.filter(
    ([p, t]) => !existsSync(resolve(RAIZ, p)) || readFileSync(resolve(RAIZ, p), 'utf8') !== t,
  );
  for (const [p] of fora)
    console.error(`desatualizado: ${p} (rode pnpm privilegios:gerar -- --hospital=${h})`);
  process.exit(fora.length > 0 ? 1 : 0);
}
for (const [p, t] of destinos) {
  mkdirSync(dirname(resolve(RAIZ, p)), { recursive: true });
  writeFileSync(resolve(RAIZ, p), t);
  console.log(`gravado: ${p}`);
}
