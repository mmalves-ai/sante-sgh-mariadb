// Scripts das tabelas SGH_ (ficha do M04, campo 6; convencoes.md §8; roteiro 6.4): descoberta em
// packages/legado/src/<grupo>/sgh/NNNN_<descricao>.sql (numeração global de 4 dígitos), hash SHA-256 do
// arquivo, separação em comandos e a conferência de que cada comando só toca objeto SGH_ (CREATE de
// tabela, sequência, índice, papel ou visão SGH_; ALTER/DROP de objeto SGH_ no padrão expandir e contrair;
// GRANT/REVOKE só sobre objeto SGH_ e só para o papel SGH_APLICACAO; nenhum trigger; REFERENCES só para
// SGH_). O plano compara os scripts com SGH_VERSAO_SCRIPT: aplica em ordem os que faltam e recusa script
// já aplicado com hash diferente (script aplicado nunca é editado: mudança é script novo).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const PAPEL_APLICACAO = 'SGH_APLICACAO';
export const TABELA_VERSAO = 'SGH_VERSAO_SCRIPT';
/** Primeiro script: cria SGH_VERSAO_SCRIPT (o registro dele é feito logo depois, em transação própria). */
export const NUMERO_SCRIPT_VERSAO = 1;

export class ErroScriptSgh extends Error {
  override readonly name = 'ErroScriptSgh';
}

export interface ScriptSgh {
  readonly numero: number;
  /** Caminho relativo a packages/legado/src (ex.: config/sgh/0001_versao_script.sql). */
  readonly arquivo: string;
  readonly grupo: string;
  readonly descricao: string;
  readonly hash: string;
  readonly comandos: readonly string[];
}

const NOME_ARQUIVO = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const NOME_SGH = /^SGH_[A-Z0-9_]{1,27}$/;

/** Comandos do script: sem comentários de linha, separados por ";" no fim da linha. */
export function comandosDoScript(sql: string): string[] {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function exigirSgh(nome: string | undefined, comando: string): void {
  const n = (nome ?? '').replace(/"/g, '').toUpperCase();
  if (!NOME_SGH.test(n)) {
    throw new ErroScriptSgh(
      `Objeto sem o prefixo SGH_ (ou com mais de 31 caracteres) em: ${comando.slice(0, 80)}`,
    );
  }
}

const OBJETO = String.raw`"?([A-Za-z0-9_$]+)"?`;
const PADROES: readonly (readonly [RegExp, readonly number[]])[] = [
  [new RegExp(String.raw`^CREATE\s+(?:TABLE|SEQUENCE|GENERATOR|ROLE|VIEW)\s+${OBJETO}`, 'i'), [1]],
  [
    new RegExp(
      String.raw`^CREATE\s+(?:UNIQUE\s+)?(?:(?:ASC|ASCENDING|DESC|DESCENDING)\s+)?INDEX\s+${OBJETO}\s+ON\s+${OBJETO}`,
      'i',
    ),
    [1, 2],
  ],
  [new RegExp(String.raw`^ALTER\s+(?:TABLE|SEQUENCE|INDEX)\s+${OBJETO}`, 'i'), [1]],
  [new RegExp(String.raw`^DROP\s+(?:TABLE|SEQUENCE|GENERATOR|INDEX|VIEW|ROLE)\s+${OBJETO}`, 'i'), [1]],
  [new RegExp(String.raw`^COMMENT\s+ON\s+(?:TABLE|COLUMN|SEQUENCE|INDEX)\s+${OBJETO}`, 'i'), [1]],
];

/**
 * Confere um comando do script: só objetos SGH_, nenhum trigger, nenhuma procedure, nenhuma FK para
 * tabela legada, GRANT/REVOKE só para o papel da aplicação e só sobre objeto SGH_.
 */
export function conferirComandoSgh(comando: string): void {
  const c = comando.trim();
  if (/\bTRIGGER\b/i.test(c))
    throw new ErroScriptSgh(`Trigger não é permitido em script SGH_: ${c.slice(0, 80)}`);
  if (/\b(?:PROCEDURE|FUNCTION|PACKAGE|EXCEPTION|DOMAIN)\b/i.test(c) && !/^GRANT|^REVOKE/i.test(c)) {
    throw new ErroScriptSgh(`Só tabela, sequência, índice, visão e papel SGH_: ${c.slice(0, 80)}`);
  }
  if (/^RECREATE\b/i.test(c))
    throw new ErroScriptSgh(`RECREATE não é permitido (expandir e contrair): ${c.slice(0, 80)}`);
  for (const m of c.matchAll(/\bREFERENCES\s+"?([A-Za-z0-9_$]+)"?/gi)) exigirSgh(m[1], c);
  const grant =
    /^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(?:TABLE\s+|SEQUENCE\s+|GENERATOR\s+)?"?([A-Za-z0-9_$]+)"?\s+(?:TO|FROM)\s+(?:ROLE\s+)?"?([A-Za-z0-9_$]+)"?\s*$/i.exec(
      c,
    );
  if (/^(GRANT|REVOKE)\b/i.test(c)) {
    if (!grant) throw new ErroScriptSgh(`GRANT/REVOKE fora do formato aceito: ${c.slice(0, 80)}`);
    exigirSgh(grant[3], c);
    if ((grant[4] ?? '').toUpperCase() !== PAPEL_APLICACAO) {
      throw new ErroScriptSgh(`Privilégio só para o papel ${PAPEL_APLICACAO}: ${c.slice(0, 80)}`);
    }
    if (/\bWITH\s+GRANT\s+OPTION\b|\bALL\b/i.test(grant[2] ?? '')) {
      throw new ErroScriptSgh(`Privilégio amplo demais (ALL/WITH GRANT OPTION): ${c.slice(0, 80)}`);
    }
    return;
  }
  for (const [re, grupos] of PADROES) {
    const m = re.exec(c);
    if (m) {
      for (const g of grupos) exigirSgh(m[g], c);
      return;
    }
  }
  throw new ErroScriptSgh(`Comando não permitido em script SGH_: ${c.slice(0, 80)}`);
}

export function hashScript(conteudo: string): string {
  return createHash('sha256').update(conteudo, 'utf8').digest('hex');
}

/** Lê e confere um script (nome, comandos). */
export function lerScript(raizSrc: string, caminho: string): ScriptSgh {
  const arquivo = relative(raizSrc, caminho).split('\\').join('/');
  const partes = arquivo.split('/');
  const nome = partes[partes.length - 1] ?? '';
  const m = NOME_ARQUIVO.exec(nome);
  if (partes.length !== 3 || partes[1] !== 'sgh' || !m) {
    throw new ErroScriptSgh(`Script fora do padrão <grupo>/sgh/NNNN_<descricao>.sql: ${arquivo}`);
  }
  const conteudo = readFileSync(caminho, 'utf8');
  const comandos = comandosDoScript(conteudo);
  if (comandos.length === 0) throw new ErroScriptSgh(`Script sem comandos: ${arquivo}`);
  for (const c of comandos) conferirComandoSgh(c);
  return {
    numero: Number(m[1]),
    arquivo,
    grupo: partes[0] as string,
    descricao: (m[2] as string).replace(/_/g, ' '),
    hash: hashScript(conteudo),
    comandos,
  };
}

/** Todos os scripts de packages/legado/src/<grupo>/sgh/, em ordem de número; número repetido é erro. */
export function lerScriptsSgh(raizSrc: string): ScriptSgh[] {
  const scripts: ScriptSgh[] = [];
  for (const grupo of readdirSync(raizSrc).sort()) {
    const pasta = join(raizSrc, grupo, 'sgh');
    let arquivos: string[];
    try {
      if (!statSync(pasta).isDirectory()) continue;
      arquivos = readdirSync(pasta);
    } catch {
      continue;
    }
    for (const a of arquivos.filter((x) => x.endsWith('.sql')).sort())
      scripts.push(lerScript(raizSrc, join(pasta, a)));
  }
  scripts.sort((a, b) => a.numero - b.numero);
  for (let i = 1; i < scripts.length; i++) {
    if (scripts[i]?.numero === scripts[i - 1]?.numero) {
      throw new ErroScriptSgh(
        `Número ${String(scripts[i]?.numero).padStart(4, '0')} repetido: ${scripts[i - 1]?.arquivo} e ${scripts[i]?.arquivo}.`,
      );
    }
  }
  if (scripts.length > 0 && scripts[0]?.numero !== NUMERO_SCRIPT_VERSAO) {
    throw new ErroScriptSgh('O primeiro script tem de ser o 0001 (cria SGH_VERSAO_SCRIPT).');
  }
  return scripts;
}

export interface RegistroAplicado {
  readonly numero: number;
  readonly hash: string;
}

export interface PlanoScripts {
  readonly pendentes: readonly ScriptSgh[];
  readonly jaAplicados: readonly ScriptSgh[];
}

/**
 * Plano: o que falta aplicar. Recusa script registrado com hash diferente do arquivo e registro sem
 * arquivo (script apagado do repositório depois de aplicado).
 */
export function planejarScripts(
  scripts: readonly ScriptSgh[],
  aplicados: readonly RegistroAplicado[],
  /**
   * M11: na cópia compartilhada de dev, os ramos em paralelo (um marco por worktree) aplicam os seus scripts
   * antes de entrar no `fase0`; o registro de outro ramo (número que este repositório não tem) é aceito e
   * listado, nunca em homologação, treino ou produção. O hash dos scripts que este repositório tem continua
   * conferido.
   */
  aceitarDeOutrosRamos = false,
): PlanoScripts {
  const porNumero = new Map(aplicados.map((a) => [a.numero, a]));
  const divergentes = scripts.filter((s) => {
    const a = porNumero.get(s.numero);
    return a !== undefined && a.hash.trim() !== s.hash;
  });
  if (divergentes.length > 0) {
    throw new ErroScriptSgh(
      `Script já aplicado com hash diferente (nunca edite script aplicado; crie um novo): ${divergentes
        .map((d) => d.arquivo)
        .join(', ')}.`,
    );
  }
  const numeros = new Set(scripts.map((s) => s.numero));
  const orfaos = aplicados.filter((a) => !numeros.has(a.numero));
  if (orfaos.length > 0 && !aceitarDeOutrosRamos) {
    throw new ErroScriptSgh(
      `Registro em SGH_VERSAO_SCRIPT sem o arquivo no repositório: ${orfaos.map((o) => String(o.numero).padStart(4, '0')).join(', ')}.`,
    );
  }
  return {
    pendentes: ordemDeAplicacao(scripts.filter((s) => !porNumero.has(s.numero))),
    jaAplicados: scripts.filter((s) => porNumero.has(s.numero)),
  };
}

/**
 * M60 (ensaio da primeira aplicação numa cópia limpa): a ordem é a do número, salvo quando um script cita um
 * objeto SGH_ criado por um script de número MAIOR (marcos construídos em paralelo com faixas de números
 * próprias; ex.: 0950 com FK para tabelas do 0958 e do 0959). Ordenação topológica estável: um script só sai
 * depois dos scripts pendentes que criam os objetos que ele cita; entre os prontos, o de menor número. Nas
 * cópias em que os scripts já foram aplicados, nada muda (os hashes e os arquivos ficam como estão). Ciclo:
 * recusa.
 */
export function ordemDeAplicacao(pendentes: readonly ScriptSgh[]): ScriptSgh[] {
  // O dono de um objeto é o PRIMEIRO script que o cria (um script posterior pode recriá-lo).
  const dono = new Map<string, number>();
  for (const s of [...pendentes].sort((a, b) => a.numero - b.numero)) {
    for (const o of objetosCriados(s)) if (!dono.has(o)) dono.set(o, s.numero);
  }
  const deps = new Map<number, Set<number>>();
  for (const s of pendentes) {
    const d = new Set<number>();
    for (const c of s.comandos) {
      for (const nome of c.toUpperCase().match(/\bSGH_[A-Z0-9_$]+/g) ?? []) {
        const n = dono.get(nome);
        if (n !== undefined && n !== s.numero) d.add(n);
      }
    }
    deps.set(s.numero, d);
  }
  const restantes = [...pendentes].sort((a, b) => a.numero - b.numero);
  const feitos = new Set<number>();
  const ordem: ScriptSgh[] = [];
  while (restantes.length > 0) {
    const i = restantes.findIndex((s) => [...(deps.get(s.numero) ?? [])].every((n) => feitos.has(n)));
    if (i < 0) {
      throw new ErroScriptSgh(
        `Dependência circular entre scripts SGH_: ${restantes.map((s) => s.arquivo).join(', ')}.`,
      );
    }
    const [s] = restantes.splice(i, 1);
    if (!s) break;
    feitos.add(s.numero);
    ordem.push(s);
  }
  return ordem;
}

/** Objetos que um script cria (para recusar reaplicar script cujo objeto já existe sem registro). */
export function objetosCriados(script: Pick<ScriptSgh, 'comandos'>): string[] {
  const r: string[] = [];
  for (const c of script.comandos) {
    const m =
      /^CREATE\s+(?:UNIQUE\s+)?(?:(?:ASC|ASCENDING|DESC|DESCENDING)\s+)?(TABLE|SEQUENCE|GENERATOR|INDEX|ROLE|VIEW)\s+"?([A-Za-z0-9_$]+)"?/i.exec(
        c,
      );
    if (m?.[2]) r.push(m[2].toUpperCase());
  }
  return r;
}
