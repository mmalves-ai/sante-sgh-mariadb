// pnpm implantacao:ensaio [-- --porta=3361 --sessoes=4 --relatorio=<arquivo.md> --manter]
// M60, etapa 1: ENSAIO DA PRIMEIRA APLICAÇÃO dos scripts SGH_ numa cópia limpa do banco atual, com o sistema
// anterior em uso simulado (ficha do M60, M60-F1; regras 1 a 3).
//  1. cria a cópia numa porta própria, a partir da matriz de ../banco-dev (hash conferido), num contêiner e num
//     volume descartáveis (nunca as cópias compartilhadas 3351/3352, nunca o sante-firebird);
//  2. confere que não há objeto SGH_; tira a impressão legada, a impressão completa e as contagens;
//  3. abre N sessões que leem e gravam tabelas legadas (sempre desfeito; LOCK TIMEOUT = limite) e amostra o MON$;
//  4. M60.1: cria uma conta da aplicação e uma de leitura sintéticas (só na cópia descartável) e roda o próprio
//     `sgh:aplicar`: `--simular` com a conta de leitura (todos pendentes, na ordem de aplicação, com o hash, nada
//     gravado), a aplicação com `--relatorio` (tempo por script e total; papel e SELECT concedidos às contas,
//     conferidos no RDB$USER_PRIVILEGES) e, depois, `--simular` de novo pela conta de leitura (nada pendente);
//  5. impressão legada e contagens (todas as tabelas legadas) depois; `sgh:aplicar --recolher --relatorio`
//     (ordem reversa); impressão completa igual à de antes;
//  6. grava o relatório (docs/marcos/M60/ensaio-primeira-aplicacao.md; os do CLI em docs/marcos/M60/ensaio-cli/)
//     e apaga contêiner e volume.
// As senhas (SYSDBA da cópia e as duas contas sintéticas) são geradas aqui e vivem só neste processo, no
// ambiente dos processos do `sgh:aplicar` que ele lança e no contêiner descartável. Saída só com contagens,
// tempos e nomes de objeto.
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type Ambiente,
  ambienteEfetivo,
  type ConexaoFirebird,
  type DriverFirebird,
  calcularImpressao,
  caminhoArquivoAmbiente,
  lerObjetosSgh,
  lerScriptsSgh,
  NucleoLegado,
  ordemDeAplicacao,
  PORTAS_OCUPADAS,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import {
  type AmostraMon,
  type AmostraSessao,
  avaliarEsperas,
  type ConferenciaCli,
  avaliarMon,
  type Contagens,
  conferirPortaDoEnsaio,
  LIMITE_ESPERA_TRAVA_MS,
  PORTA_ENSAIO_PADRAO,
  type RelatorioCli,
  vereditoDoEnsaio,
} from './ensaio-regras.ts';
import {
  conferirEspaco,
  diferencasDasPartes,
  formatarRelatorioEnsaio,
  impressaoCompleta,
  type ResultadoEnsaio,
  sqlAtualizacao,
  sqlLeitura,
  sqlMon,
  sqlTrava,
  TABELAS_DAS_SESSOES,
} from './ensaio-relatorio.ts';

const raiz = resolve(import.meta.dirname, '../../..');
/** ../banco-dev ao lado do repositório (ou de new-sgh-wt/<marco>, num worktree); --banco-dev=<pasta> força. */
function pastaBancoDev(): string {
  const pedida = process.argv.find((x) => x.startsWith('--banco-dev='))?.slice(12);
  if (pedida) return resolve(pedida);
  for (const c of [resolve(raiz, '../banco-dev'), resolve(raiz, '../../banco-dev')]) {
    if (existsSync(resolve(c, 'backups'))) return c;
  }
  throw new Error('Pasta banco-dev (com backups/) não encontrada ao lado do repositório.');
}
const PASTA_BANCO_DEV = pastaBancoDev();
const MATRIZ = 'pc-20261019.fdb';
const IMAGEM = 'firebirdsql/firebird:3.0.14-jammy';
const CONTEINER = 'sgh-ensaio-m60-pc';
const VOLUME = 'sgh-ensaio-m60-pc-data';
const BANCO = '/var/lib/firebird/data/pc.fdb';
const COD = 'pc';
/** Contas sintéticas, criadas só na cópia descartável (a da aplicação recebe o papel; a de leitura, o SELECT). */
const CONTA_APLICACAO = 'ENSAIO_APLIC';
const CONTA_LEITURA = 'ENSAIO_LEIT';
const PASTA_CLI = resolve(raiz, 'docs/marcos/M60/ensaio-cli');
const PASTA_TMP = resolve(raiz, '.tmp/ensaio-m60');
/**
 * O `sgh:aplicar` exige, fora de produção, a trava da cópia (um `copia.lock` sob flock no processo ou num
 * ancestral). A cópia do ensaio é descartável e só deste processo: a trava é um `copia.lock` próprio.
 */
const TRAVA_PROPRIA = resolve(PASTA_TMP, 'copia.lock');

function opcao(nome: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a?.slice(nome.length + 3);
}
const porta = Number(opcao('porta') ?? PORTA_ENSAIO_PADRAO);
const nSessoes = Math.max(1, Math.min(16, Number(opcao('sessoes') ?? 4)));
const relatorio = resolve(raiz, opcao('relatorio') ?? 'docs/marcos/M60/ensaio-primeira-aplicacao.md');
const manter = process.argv.includes('--manter');

const log = (m: string) => console.log(`[ensaio] ${m}`);
const docker = (args: string[], env?: NodeJS.ProcessEnv) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const agora = () => performance.now();
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Portas publicadas por outros contêineres (a cópia que um ensaio anterior deixou será apagada). */
function portasDocker(): number[] {
  const saida = docker(['ps', '--format', '{{.Names}} {{.Ports}}']);
  return saida
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith(`${CONTEINER} `))
    .flatMap((l) => [...l.matchAll(/:(\d+)->/g)].map((m) => Number(m[1])));
}

async function portaAberta(p: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = connect({ host: '127.0.0.1', port: p }, () => {
      s.destroy();
      ok(true);
    });
    s.on('error', () => ok(false));
  });
}

function apagarCopia(): void {
  try {
    docker(['rm', '-f', CONTEINER]);
  } catch {
    /* já não existe */
  }
  try {
    docker(['volume', 'rm', '-f', VOLUME]);
  } catch {
    /* já não existe */
  }
}

/** Cria o volume, copia a matriz conferindo o hash e sobe o contêiner na porta do ensaio. */
async function criarCopia(senha: string, etapas: Record<string, number>): Promise<void> {
  const t0 = agora();
  apagarCopia();
  docker(['volume', 'create', VOLUME]);
  docker([
    'run',
    '--rm',
    '--name',
    `${CONTEINER}-copia`,
    '-v',
    `${PASTA_BANCO_DEV}/backups:/bk:ro`,
    '-v',
    `${VOLUME}:/destino`,
    IMAGEM,
    'bash',
    '-c',
    `set -e; cp /bk/${MATRIZ} /destino/pc.fdb; chown firebird:firebird /destino/pc.fdb; chmod 660 /destino/pc.fdb;
     a=$(cut -d" " -f1 /bk/${MATRIZ}.sha256); b=$(sha256sum /destino/pc.fdb | cut -d" " -f1);
     [ "$a" = "$b" ] || { echo "hash diverge" >&2; exit 1; }`,
  ]);
  etapas['cópia da matriz (com hash)'] = agora() - t0;
  const t1 = agora();
  // A senha vai ao docker pelo ambiente (-e NOME sem valor): nunca na linha de comando.
  docker(
    [
      'run',
      '-d',
      '--name',
      CONTEINER,
      '-e',
      'FIREBIRD_ROOT_PASSWORD',
      '-e',
      'TZ=America/Sao_Paulo',
      '-p',
      `127.0.0.1:${porta}:3050`,
      '-v',
      `${VOLUME}:/var/lib/firebird/data`,
      IMAGEM,
    ],
    { ...process.env, FIREBIRD_ROOT_PASSWORD: senha },
  );
  for (let i = 0; i < 120 && !(await portaAberta(porta)); i++) await espera(1000);
  if (!(await portaAberta(porta))) throw new Error('A cópia do ensaio não abriu a porta.');
  await espera(3000);
  // Cache de páginas maior (como as cópias de dev): só acelera as contagens; a escrita segue síncrona (forced
  // writes do banco original), para o tempo da aplicação ser o de produção.
  docker([
    'exec',
    CONTEINER,
    'sh',
    '-c',
    `ISC_USER=SYSDBA ISC_PASSWORD="$FIREBIRD_ROOT_PASSWORD" /opt/firebird/bin/gfix -buffers 60000 localhost:${BANCO}`,
  ]);
  etapas['subida da cópia'] = agora() - t1;
}

interface Destino {
  readonly host: string;
  readonly porta: number;
  readonly banco: string;
  readonly usuario: string;
  readonly senha: string;
}

async function lerUm(c: ConexaoFirebird, sql: string): Promise<Record<string, unknown>> {
  const tx = await c.iniciar({ tipo: 'leitura' });
  try {
    const r = await tx.consultar(sql, [], { teto: 1000 });
    return r.linhas[0] ?? {};
  } finally {
    await tx.desfazer();
  }
}

async function lerTodas(c: ConexaoFirebird, sql: string): Promise<Record<string, unknown>[]> {
  const tx = await c.iniciar({ tipo: 'leitura' });
  try {
    return (await tx.consultar(sql, [], { teto: 100000 })).linhas;
  } finally {
    await tx.desfazer();
  }
}

async function contarSgh(c: ConexaoFirebird): Promise<number> {
  const x = await lerUm(
    c,
    `SELECT (SELECT COUNT(*) FROM RDB$RELATIONS WHERE RDB$RELATION_NAME STARTING WITH 'SGH_')
          + (SELECT COUNT(*) FROM RDB$GENERATORS WHERE RDB$GENERATOR_NAME STARTING WITH 'SGH_')
          + (SELECT COUNT(*) FROM RDB$ROLES WHERE RDB$ROLE_NAME STARTING WITH 'SGH_') N FROM RDB$DATABASE`,
  );
  return Number(x['N']);
}

/** Todas as tabelas legadas de usuário: persistentes, sem visões, tabelas externas, temporárias nem SGH_. */
async function tabelasLegadas(c: ConexaoFirebird): Promise<string[]> {
  const linhas = await lerTodas(
    c,
    `SELECT TRIM(RDB$RELATION_NAME) T FROM RDB$RELATIONS
      WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NULL AND RDB$EXTERNAL_FILE IS NULL
        AND COALESCE(RDB$RELATION_TYPE, 0) = 0 AND RDB$RELATION_NAME NOT STARTING WITH 'SGH_' ORDER BY 1`,
  );
  return linhas.map((l) => String(l['T']));
}

/** COUNT(*) de cada tabela (nome entre aspas: vale também para nome fora do padrão). */
async function contagens(c: ConexaoFirebird, tabelas: readonly string[], rotulo: string): Promise<Contagens> {
  const r: Record<string, number> = {};
  let n = 0;
  for (const t of tabelas) {
    r[t] = Number((await lerUm(c, `SELECT COUNT(*) N FROM "${t.replace(/"/g, '""')}"`))['N']);
    if (++n % 250 === 0) log(`${rotulo}: ${n} de ${tabelas.length} tabela(s) contadas`);
  }
  return r;
}

const execFileP = promisify(execFile);

/** Roda o próprio `sgh:aplicar` contra a cópia do ensaio e devolve o relatório JSON que ele gravou. */
async function rodarCli(
  nome: string,
  extras: readonly string[],
  envCli: NodeJS.ProcessEnv,
  comTrava: boolean,
): Promise<RelatorioCli> {
  mkdirSync(PASTA_CLI, { recursive: true });
  const arquivo = resolve(PASTA_CLI, `${nome}.json`);
  rmSync(arquivo, { force: true });
  const cli = [
    process.execPath,
    '--import',
    resolve(raiz, 'tools/verificadores/src/caminhos-sgh.ts'),
    resolve(raiz, 'tools/schema-check/src/sgh-aplicar.ts'),
    `--hospital=${COD}`,
    '--ambiente=dev',
    ...extras,
    `--relatorio=${arquivo}`,
  ];
  const [programa, ...args] = comTrava ? ['flock', TRAVA_PROPRIA, ...cli] : cli;
  const t = agora();
  try {
    await execFileP(programa!, args, { cwd: raiz, env: envCli, maxBuffer: 64 * 2 ** 20 });
  } catch {
    // Saída diferente de zero: o relatório diz o resultado e o erro.
  }
  log(`sgh:aplicar ${extras.join(' ') || '(aplicar)'}: ${Math.round(agora() - t)} ms`);
  if (!existsSync(arquivo)) throw new Error(`O sgh:aplicar (${nome}) não gravou o relatório.`);
  return JSON.parse(readFileSync(arquivo, 'utf8')) as RelatorioCli;
}

interface SenhasDoEnsaio {
  readonly sysdba: string;
  readonly aplicacao: string;
  readonly leitura: string;
}

/** Ambiente do `sgh:aplicar`: só o do ensaio (nenhum arquivo de ambiente), com as três contas. */
function ambienteDoCli(env: Ambiente, senhas: SenhasDoEnsaio): NodeJS.ProcessEnv {
  const p = `FB_${COD.toUpperCase()}`;
  return {
    PATH: process.env['PATH'],
    HOME: process.env['HOME'],
    // O núcleo do legado exige o processo em UTC (o codec das datas recusa fuso com horário de verão).
    TZ: 'UTC',
    ...(process.env['LD_LIBRARY_PATH'] ? { LD_LIBRARY_PATH: process.env['LD_LIBRARY_PATH'] } : {}),
    ...env,
    SGH_ARQUIVO_AMBIENTE: resolve(PASTA_TMP, 'sem-arquivo.env.sante'),
    [`${p}_USUARIO`]: CONTA_APLICACAO,
    [`${p}_SENHA`]: senhas.aplicacao,
    [`${p}_SCRIPTS_USUARIO`]: 'SYSDBA',
    [`${p}_SCRIPTS_SENHA`]: senhas.sysdba,
    [`${p}_LEITURA_USUARIO`]: CONTA_LEITURA,
    [`${p}_LEITURA_SENHA`]: senhas.leitura,
  };
}

/** Cria as duas contas sintéticas na cópia descartável (o contêiner, com o banco de segurança, é apagado). */
async function criarContas(c: ConexaoFirebird, senhas: SenhasDoEnsaio): Promise<void> {
  const tx = await c.iniciar({ tipo: 'escrita', lockTimeoutSegundos: 10 });
  try {
    await tx.executar(`CREATE USER ${CONTA_APLICACAO} PASSWORD '${senhas.aplicacao}'`, []);
    await tx.executar(`CREATE USER ${CONTA_LEITURA} PASSWORD '${senhas.leitura}'`, []);
    await tx.confirmar();
  } catch (e) {
    await tx.desfazer().catch(() => undefined);
    throw e;
  }
}

/** O papel SGH_APLICACAO na conta da aplicação e o SELECT em SGH_VERSAO_SCRIPT na de leitura. */
async function privilegiosDasContas(c: ConexaoFirebird): Promise<{ papel: boolean; leitura: boolean }> {
  const x = await lerUm(
    c,
    `SELECT (SELECT COUNT(*) FROM RDB$USER_PRIVILEGES WHERE RDB$USER = '${CONTA_APLICACAO}'
               AND RDB$RELATION_NAME = 'SGH_APLICACAO' AND RDB$PRIVILEGE = 'M') PAPEL,
            (SELECT COUNT(*) FROM RDB$USER_PRIVILEGES WHERE RDB$USER = '${CONTA_LEITURA}'
               AND RDB$RELATION_NAME = 'SGH_VERSAO_SCRIPT' AND RDB$PRIVILEGE = 'S') LEITURA FROM RDB$DATABASE`,
  );
  return { papel: Number(x['PAPEL']) > 0, leitura: Number(x['LEITURA']) > 0 };
}

const ORFAO_DE_DOMINIO = `P.RDB$OBJECT_TYPE = 9 AND NOT EXISTS (SELECT 1 FROM RDB$FIELDS F
  WHERE F.RDB$FIELD_NAME = P.RDB$RELATION_NAME)`;

async function orfaosDeDominio(c: ConexaoFirebird): Promise<number> {
  return Number(
    (await lerUm(c, `SELECT COUNT(*) N FROM RDB$USER_PRIVILEGES P WHERE ${ORFAO_DE_DOMINIO}`))['N'],
  );
}

async function contagensDoCatalogo(c: ConexaoFirebird): Promise<Record<string, number>> {
  const x = await lerUm(
    c,
    // PRIVILEGIOS sem os órfãos de domínio implícito: o Firebird 3 grava USAGE do dono em cada domínio RDB$n
    // criado com uma coluna e, no DROP TABLE, apaga o domínio mas deixa a linha do privilégio (sem objeto, sem
    // efeito; o Firebird 3 não tem REVOKE USAGE ON DOMAIN). Esses órfãos vão à parte, para o relatório.
    `SELECT (SELECT COUNT(*) FROM RDB$USER_PRIVILEGES P WHERE NOT (${ORFAO_DE_DOMINIO})) PRIVILEGIOS,
            (SELECT COUNT(*) FROM RDB$INDICES) INDICES,
            (SELECT COUNT(*) FROM RDB$RELATIONS) RELACOES,
            (SELECT COUNT(*) FROM RDB$GENERATORS) SEQUENCIAS,
            (SELECT COUNT(*) FROM RDB$ROLES) PAPEIS,
            (SELECT COUNT(*) FROM RDB$TRIGGERS) TRIGGERS,
            (SELECT COUNT(*) FROM RDB$RELATION_CONSTRAINTS) RESTRICOES,
            (SELECT COUNT(*) FROM RDB$FIELDS) DOMINIOS,
            (SELECT COUNT(*) FROM RDB$DEPENDENCIES) DEPENDENCIAS,
            (SELECT COUNT(*) FROM RDB$CHECK_CONSTRAINTS) CHECKS,
            (SELECT COUNT(*) FROM RDB$REF_CONSTRAINTS) REFERENCIAS,
            (SELECT COUNT(*) FROM RDB$USER_PRIVILEGES WHERE RDB$RELATION_NAME STARTING WITH 'SGH_'
                OR RDB$USER STARTING WITH 'SGH_') PRIVILEGIOS_SGH,
            (SELECT COUNT(*) FROM RDB$DEPENDENCIES WHERE RDB$DEPENDED_ON_NAME STARTING WITH 'SGH_'
                OR RDB$DEPENDENT_NAME STARTING WITH 'SGH_') DEPENDENCIAS_SGH FROM RDB$DATABASE`,
  );
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Number(v)]));
}

/**
 * Tabelas legadas que recebem o UPDATE desfeito: sem trigger nenhum (nada dispara, nem as saídas externas da
 * cópia), sem FK de saída nem de entrada, com chave primária de uma coluna e com linhas. Até 4, pelo nome.
 */
async function tabelasAtualizaveis(c: ConexaoFirebird): Promise<Map<string, string>> {
  const linhas = await lerTodas(
    c,
    `SELECT TRIM(RC.RDB$RELATION_NAME) T, MIN(TRIM(S.RDB$FIELD_NAME)) C, COUNT(*) N
       FROM RDB$RELATION_CONSTRAINTS RC
       JOIN RDB$INDEX_SEGMENTS S ON S.RDB$INDEX_NAME = RC.RDB$INDEX_NAME
       JOIN RDB$RELATIONS R ON R.RDB$RELATION_NAME = RC.RDB$RELATION_NAME
      WHERE RC.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY' AND COALESCE(R.RDB$SYSTEM_FLAG, 0) = 0
        AND R.RDB$VIEW_BLR IS NULL AND R.RDB$RELATION_NAME NOT STARTING WITH 'SGH_'
        AND NOT EXISTS (SELECT 1 FROM RDB$TRIGGERS G WHERE G.RDB$RELATION_NAME = RC.RDB$RELATION_NAME)
        AND NOT EXISTS (SELECT 1 FROM RDB$RELATION_CONSTRAINTS F WHERE F.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
                        AND F.RDB$RELATION_NAME = RC.RDB$RELATION_NAME)
        AND NOT EXISTS (SELECT 1 FROM RDB$REF_CONSTRAINTS RF JOIN RDB$RELATION_CONSTRAINTS U
                          ON U.RDB$CONSTRAINT_NAME = RF.RDB$CONST_NAME_UQ
                        WHERE U.RDB$RELATION_NAME = RC.RDB$RELATION_NAME)
      GROUP BY 1 ORDER BY 1`,
  );
  const m = new Map<string, string>();
  for (const l of linhas) {
    if (m.size >= 4) break;
    const t = String(l['T']);
    if (Number(l['N']) !== 1 || !/^[A-Z][A-Z0-9_$]{0,30}$/.test(t)) continue;
    const tem = await lerUm(c, `SELECT COUNT(*) N FROM (SELECT FIRST 5 1 X FROM ${t}) D`);
    if (Number(tem['N']) >= 5) m.set(t, String(l['C']));
  }
  return m;
}

/** Uma sessão do sistema anterior: lê, trava e (onde é seguro) atualiza; sempre desfaz. */
async function sessao(
  driver: DriverFirebird,
  destino: Destino,
  n: number,
  atualizaveis: Map<string, string>,
  parar: { valor: boolean },
  amostras: AmostraSessao[],
  anexos: number[],
): Promise<void> {
  const c = await driver.conectar(destino);
  try {
    anexos.push(Number((await lerUm(c, 'SELECT CURRENT_CONNECTION ID FROM RDB$DATABASE'))['ID']));
    let i = 0;
    while (!parar.valor) {
      const tabela = TABELAS_DAS_SESSOES[(n + i) % TABELAS_DAS_SESSOES.length] ?? 'TBCONVEN';
      const salto = (n * 37 + i * 11) % 500;
      const alvos = [...atualizaveis.entries()];
      const alvo = alvos.length > 0 ? alvos[(n + i) % alvos.length] : undefined;
      const gravar = i % 2 === 1;
      const t0 = agora();
      let erro: string | undefined;
      try {
        if (!gravar) {
          await lerUm(c, sqlLeitura(tabela, salto));
        } else {
          const tx = await c.iniciar({ tipo: 'escrita', lockTimeoutSegundos: LIMITE_ESPERA_TRAVA_MS / 1000 });
          try {
            await tx.consultar(sqlTrava(tabela, salto), [], { teto: 1 });
            if (alvo) await tx.executar(sqlAtualizacao(alvo[0], alvo[1], salto), []);
          } finally {
            await tx.desfazer();
          }
        }
      } catch (e) {
        erro = e instanceof Error ? e.name : 'erro';
      }
      amostras.push({
        sessao: n,
        operacao: gravar ? 'gravacao' : 'leitura',
        ms: agora() - t0,
        ...(erro ? { erro } : {}),
      });
      i++;
      await espera(20);
    }
  } finally {
    await c.fechar();
  }
}

async function amostrarMon(
  driver: DriverFirebird,
  destino: Destino,
  anexos: number[],
  parar: { valor: boolean },
  amostras: AmostraMon[],
): Promise<void> {
  const c = await driver.conectar(destino);
  try {
    while (!parar.valor) {
      if (anexos.length > 0) {
        const x = await lerUm(c, sqlMon(anexos));
        amostras.push({
          instante: Date.now(),
          paradosLegados: Number(x['N'] ?? 0),
          maiorParadoMs: Number(x['MS'] ?? 0),
        });
      }
      await espera(250);
    }
  } finally {
    await c.fechar();
  }
}

function ambienteDoEnsaio(senha: string): Ambiente {
  const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
  return {
    AMBIENTE: 'dev',
    REDE_PADRAO: env['REDE_PADRAO'] ?? 'rede-sante',
    ESTABELECIMENTOS: COD,
    FB_PC_HOST: '127.0.0.1',
    FB_PC_PORTA: String(porta),
    FB_PC_BANCO: BANCO,
    FB_PC_USUARIO: 'SYSDBA',
    // Chave montada: a senha é gerada aqui e só vive neste processo.
    [`FB_${COD.toUpperCase()}_SENHA`]: senha,
    FB_PC_NOME: env['FB_PC_NOME'] ?? 'ProntoCardio',
    SGH_DEV_PERMITIR_SYSDBA: 'sim',
    ...(env['FB_CLIENTE_BIBLIOTECA'] ? { FB_CLIENTE_BIBLIOTECA: env['FB_CLIENTE_BIBLIOTECA'] } : {}),
  };
}

async function principal(): Promise<boolean> {
  const inicio = new Date().toISOString();
  conferirPortaDoEnsaio(porta, [...PORTAS_OCUPADAS, ...portasDocker()]);
  const matriz = resolve(PASTA_BANCO_DEV, 'backups', MATRIZ);
  conferirEspaco(Number(statfsSync('/').bavail) * Number(statfsSync('/').bsize), statSync(matriz).size);
  const nova = () => randomBytes(12).toString('base64url').slice(0, 16);
  const senha = nova();
  const senhas: SenhasDoEnsaio = { sysdba: senha, aplicacao: nova(), leitura: nova() };
  const etapas: Record<string, number> = {};
  const env = ambienteDoEnsaio(senha);
  const driver = criarDriverNativo(
    env['FB_CLIENTE_BIBLIOTECA'] ? { biblioteca: env['FB_CLIENTE_BIBLIOTECA'] } : {},
  );
  const destino: Destino = { host: '127.0.0.1', porta, banco: BANCO, usuario: 'SYSDBA', senha };
  let nucleo: NucleoLegado | undefined;
  let r: ResultadoEnsaio | undefined;
  let erro: string | undefined;
  // Sessões e amostrador: paradas e esperadas também na falha, antes de encerrar o driver.
  const parar = { valor: false };
  const tarefas: Promise<void>[] = [];
  let c: ConexaoFirebird | undefined;
  try {
    log(`criando a cópia limpa na porta ${porta} (matriz ${MATRIZ})`);
    await criarCopia(senha, etapas);
    nucleo = new NucleoLegado({
      env,
      driver,
      pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
      aviso: () => undefined,
    });
    const ctx = { rede: env['REDE_PADRAO'] ?? 'rede-sante', hospital: COD, traceId: 'ensaio-m60' };
    c = await driver.conectar(destino);
    const cx = c;
    let t = agora();
    const objetosSghAntes = await contarSgh(cx);
    const imprimir = async () => calcularImpressao(COD, await nucleo!.lerCatalogoLegado(COD)).resumo;
    const completa = async (legado: string) => ({
      legado,
      objetosSgh: await nucleo!.lerSomente(ctx, (l) => lerObjetosSgh(l)),
      catalogo: await contagensDoCatalogo(cx),
    });
    const legadoAntes = await imprimir();
    const partesAntes = await completa(legadoAntes);
    const completaAntes = impressaoCompleta(partesAntes);
    const orfaosAntes = await orfaosDeDominio(cx);
    const atualizaveis = await tabelasAtualizaveis(cx);
    const legadas = await tabelasLegadas(cx);
    const contagensAntes = await contagens(cx, legadas, 'contagens antes');
    etapas['impressão e contagens antes'] = agora() - t;
    log(`antes: ${objetosSghAntes} objeto(s) SGH_; ${Object.keys(contagensAntes).length} tabela(s) contadas`);
    if (objetosSghAntes > 0) throw new Error('A matriz já tem objetos SGH_: a cópia não é limpa.');

    // M60.1: contas sintéticas e a simulação pelo próprio sgh:aplicar, com a conta de leitura.
    await criarContas(cx, senhas);
    mkdirSync(PASTA_TMP, { recursive: true });
    const envCli = ambienteDoCli(env, senhas);
    const scripts = lerScriptsSgh(resolve(raiz, 'packages/legado/src'));
    const ordemEsperada = ordemDeAplicacao(scripts).map((x) => ({ numero: x.numero, hash: x.hash }));
    t = agora();
    const simulacaoAntes = await rodarCli('simular-antes', ['--simular'], envCli, false);
    etapas['simulação (sgh:aplicar --simular)'] = agora() - t;
    const objetosSghDepoisDaSimulacao = await contarSgh(cx);
    log(`simulação: ${simulacaoAntes.resultado}, ${simulacaoAntes.linhas.length} pendente(s)`);
    if (simulacaoAntes.resultado !== 'ok') {
      throw new Error(`A simulação pelo sgh:aplicar falhou: ${simulacaoAntes.erro ?? 'sem erro'}`);
    }

    // Sessões do sistema anterior em uso + amostras do MON$ durante a aplicação.
    const amostras: AmostraSessao[] = [];
    const mon: AmostraMon[] = [];
    const anexos: number[] = [];
    for (let n = 0; n < nSessoes; n++) {
      tarefas.push(sessao(driver, destino, n, atualizaveis, parar, amostras, anexos));
    }
    tarefas.push(amostrarMon(driver, destino, anexos, parar, mon));
    await espera(5000);
    t = agora();
    log(`aplicando ${scripts.length} script(s) com ${nSessoes} sessão(ões) legada(s) em uso`);
    const ap = await rodarCli('aplicar', [], envCli, true);
    etapas['aplicação (parede, sgh:aplicar --relatorio)'] = agora() - t;
    await espera(3000);
    parar.valor = true;
    await Promise.all(tarefas.splice(0));
    const objetosSghDepoisDaAplicacao = await contarSgh(cx);
    const privilegios = await privilegiosDasContas(cx);
    const simulacaoDepois = await rodarCli('simular-depois', ['--simular'], envCli, false);
    const tempos = ap.linhas.map((x) => ({
      numero: x.numero ?? 0,
      arquivo: x.item,
      ms: x.ms ?? 0,
      situacao: x.resultado,
    }));

    t = agora();
    const legadoDepois = await imprimir();
    const contagensDepois = await contagens(cx, legadas, 'contagens depois');
    etapas['impressão e contagens depois'] = agora() - t;
    log(`aplicação: ${ap.resultado}, ${tempos.length} em ${Math.round(ap.totalMs)} ms; recolhendo`);

    t = agora();
    const rec = await rodarCli('recolher', ['--recolher'], envCli, false);
    etapas['recolhimento (sgh:aplicar --recolher)'] = agora() - t;
    const objetosSghDepois = await contarSgh(cx);
    const partesDepois = await completa(await imprimir());
    const completaDepois = impressaoCompleta(partesDepois);
    const diferencasDoRecolhimento = diferencasDasPartes(partesAntes, partesDepois);
    const orfaos = (await orfaosDeDominio(cx)) - orfaosAntes;
    await cx.fechar();
    c = undefined;

    const esperas = avaliarEsperas(amostras);
    const avMon = avaliarMon(mon);
    const veredito = vereditoDoEnsaio({
      copiaLimpa: { objetosSghAntes },
      aplicacao: {
        ok: ap.resultado === 'ok' && tempos.length === scripts.length,
        scripts: tempos.length,
        totalMs: ap.totalMs,
      },
      impressaoLegadaAntes: legadoAntes,
      impressaoLegadaDepois: legadoDepois,
      contagensAntes,
      contagensDepois,
      esperas,
      mon: avMon,
      recolhimento: {
        ok: rec.resultado === 'ok' && rec.linhas.length > 0,
        impressaoCompletaAntes: completaAntes,
        impressaoCompletaDepois: completaDepois,
        objetosSghDepois,
      },
      cli: {
        simulacaoAntes,
        ordemEsperada,
        objetosSghDepoisDaSimulacao,
        aplicacao: ap,
        papelConcedido: privilegios.papel,
        leituraConcedida: privilegios.leitura,
        simulacaoDepois,
        recolhimento: rec,
      } satisfies ConferenciaCli,
    });
    r = {
      inicio,
      porta,
      matriz: `../banco-dev/backups/${MATRIZ}`,
      sessoes: nSessoes,
      tabelasAtualizadas: [...atualizaveis.keys()].sort(),
      etapasMs: etapas,
      tempos,
      totalMs: ap.totalMs,
      objetosSghDepoisDaAplicacao,
      comandosDoRecolhimento: rec.linhas.length,
      recolhimentoMs: rec.totalMs,
      diferencasDoRecolhimento,
      privilegiosOrfaosDeDominio: orfaos,
      contagensAntes,
      contagensDepois,
      esperas,
      mon: avMon,
      veredito,
      relatoriosCli: ['simular-antes', 'aplicar', 'simular-depois', 'recolher'].map((n) =>
        relative(raiz, resolve(PASTA_CLI, `${n}.json`)),
      ),
    };
  } catch (e) {
    erro = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[ensaio] falhou: ${erro}`);
  } finally {
    parar.valor = true;
    await Promise.allSettled(tarefas);
    await c?.fechar().catch(() => undefined);
    await nucleo?.encerrar().catch(() => undefined);
    await driver.encerrar().catch(() => undefined);
    if (manter) log(`cópia mantida (--manter): contêiner ${CONTEINER}, volume ${VOLUME}`);
    else {
      apagarCopia();
      log('cópia apagada (contêiner e volume)');
    }
  }
  if (r) {
    mkdirSync(dirname(relatorio), { recursive: true });
    writeFileSync(relatorio, formatarRelatorioEnsaio(erro ? { ...r, erro } : r));
    log(`relatório: ${relatorio}`);
    for (const k of r.veredito.criterios) log(`${k.ok ? 'ok    ' : 'FALHOU'} ${k.nome}: ${k.detalhe}`);
    return r.veredito.ok && !erro;
  }
  return false;
}

process.exit((await principal()) ? 0 : 1);
