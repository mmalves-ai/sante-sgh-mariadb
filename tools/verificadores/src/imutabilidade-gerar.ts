// pnpm imutabilidade:gerar -- [--conferir] [--hospital=pc --conta=<CONTA> --autorizacao="<texto>"]
// M59-F3 (ficha do M59, regra 6): regrava a lista gerada das tabelas clínicas (a partir da matriz de cobertura) e
// confere o repositório (operações e scripts SGH_ sem DELETE clínico fora das exceções). Com --conta, lê na cópia
// (transação de leitura, só metadado: RDB$USER_PRIVILEGES) os privilégios da conta e grava o par de scripts
// infra/firebird/fase7/privilegios/<h>/0002_imutabilidade_clinica.{aplicar,recolher}.sql, que a TI executa com
// autorização do dono (regra 4 da Fase 7). Nunca grava no banco. Com --conferir, só confere (sai 1 se desatualizado).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gerarScriptsImutabilidade } from '@sgh/dominio-acesso';
import { lerConfiguracaoNucleo, lerPrivilegiosReais, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { lerArgumentos } from './argumentos.ts';
import {
  CAMINHO_TABELAS_CLINICAS,
  gerarTabelasClinicas,
  grantsDeleteClinicoSgh,
  NOME_PASSO_IMUTABILIDADE,
  operacoesComDeleteClinico,
  scriptsSghDoRepositorio,
} from './imutabilidade.ts';
import { codigosDaCopia } from './permissoes-copia.ts';
import { caminhoScripts, gerarArtefatos, RAIZ } from './privilegios.ts';

const { opcoes, bandeiras } = lerArgumentos(process.argv.slice(2));
const texto = gerarTabelasClinicas();
const caminho = resolve(RAIZ, CAMINHO_TABELAS_CLINICAS);
const emDia = existsSync(caminho) && readFileSync(caminho, 'utf8') === texto;
const achados = [...operacoesComDeleteClinico(), ...grantsDeleteClinicoSgh(scriptsSghDoRepositorio())];
for (const a of achados) console.error(`DELETE clínico: ${a.origem} ${a.onde} → ${a.tabela}`);
let falha = achados.length > 0;
try {
  gerarArtefatos(opcoes['hospital'] ?? 'pc');
} catch (e) {
  console.error((e as Error).message);
  falha = true;
}
if (bandeiras.has('conferir')) {
  if (!emDia) console.error(`desatualizado: ${CAMINHO_TABELAS_CLINICAS} (rode pnpm imutabilidade:gerar)`);
  process.exit(falha || !emDia ? 1 : 0);
}
if (!emDia) {
  writeFileSync(caminho, texto);
  console.log(`gravado: ${CAMINHO_TABELAS_CLINICAS}`);
}

const conta = opcoes['conta']?.trim();
if (conta) {
  const h = opcoes['hospital'] ?? 'pc';
  const autorizacao = opcoes['autorizacao']?.trim();
  if (!/^[a-z][a-z0-9]{1,9}$/.test(h) || !autorizacao) {
    console.error(
      '--hospital=<código> e --autorizacao="<linha de ESTADO.md › Autorizações>" são obrigatórios com --conta.',
    );
    process.exit(1);
  }
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
    const antes = await nucleo.lerSomente(
      { rede: nucleo.rede, hospital: h, traceId: 'imutabilidade-gerar' },
      (l) => lerPrivilegiosReais(l, { conta }),
    );
    const s = gerarScriptsImutabilidade(conta, antes, {
      hospital: h,
      versao: new Date().toISOString().slice(0, 10),
      autorizacao,
    });
    for (const [sufixo, t] of [
      ['aplicar', s.aplicar],
      ['recolher', s.recolher],
    ] as const) {
      const p = resolve(RAIZ, `${caminhoScripts(h)}/${NOME_PASSO_IMUTABILIDADE}.${sufixo}.sql`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t);
    }
    console.log(`${NOME_PASSO_IMUTABILIDADE}: ${s.tabelas.length} tabela(s) clínica(s) com DELETE na conta.`);
  } finally {
    await nucleo.encerrar();
  }
}
process.exit(falha ? 1 : 0);
