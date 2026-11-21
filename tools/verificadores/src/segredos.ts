// verificadores:segredos (ficha do M00, regra 2): nenhum valor de segredo em arquivo versionado
// e o .env da raiz intocado (permissão, tamanho e data iguais ao registro).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compararEnv, lerRegistro, medirEnv } from './env-raiz.ts';
import { cobertoPelaRegra } from './sem-pessoal.ts';

export interface Achado {
  readonly arquivo: string;
  readonly linha: number;
  readonly chave: string;
}

// Chaves cujo valor nunca pode estar em arquivo versionado.
const CHAVE_SEGREDO = /^(DB_[A-Z0-9_]+|FB_[A-Z0-9]+_SENHA|[A-Z0-9_]*_SEGREDO|[A-Z0-9_]*_SENHA)$/;
// Linha de atribuição: CHAVE=valor, export CHAVE=valor, CHAVE: valor, "CHAVE": "valor".
const ATRIBUICAO = /^\s*(?:export\s+)?["']?([A-Z][A-Z0-9_]*)["']?\s*[=:]\s*(.*)$/;

function valorVazio(bruto: string, estruturaJsonPermitida: boolean): boolean {
  const v = bruto
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/,$/, '')
    .replace(/^["'](.*)["']$/, '$1')
    .trim();
  // Vazio, referência a variável ou marcador de lugar não é valor de segredo.
  // Abertura de objeto ou lista JSON (`"COLUNA_SENHA": {` num perfil de assinatura, M03) é estrutura, não
  // valor, SÓ nos arquivos de perfil e assinatura (que o sem-pessoal confere); em outro arquivo, um segredo
  // aninhado (`"X_SENHA": { "valor": … }`) continua achado.
  return (
    v === '' ||
    v.startsWith('${') ||
    v.startsWith('$(') ||
    /^<[^>]*>$/.test(v) ||
    v === 'null' ||
    (estruturaJsonPermitida && (v === '{' || v === '['))
  );
}

// Em código TypeScript/JavaScript, um valor que é só um identificador (`X_SENHA: SENHA_DE_TESTE,`) é referência a uma
// constante, não valor de segredo: um segredo literal teria de estar entre aspas (e continua achado) e a constante
// referida é conferida onde é definida. Em .env, YAML, JSON e shell o identificador nu continua achado.
const CODIGO = /\.(?:[cm]?[jt]s|tsx|jsx|vue)$/;
const IDENTIFICADOR = /^[A-Za-z_$][\w$]*,?$/;

export function procurarSegredos(conteudo: string, arquivo: string): Achado[] {
  const achados: Achado[] = [];
  const estrutura = cobertoPelaRegra(arquivo);
  const codigo = CODIGO.test(arquivo);
  conteudo.split(/\r?\n/).forEach((texto, i) => {
    const m = ATRIBUICAO.exec(texto);
    if (!m) return;
    const chave = m[1] ?? '';
    const valor = (m[2] ?? '').trim();
    if (codigo && IDENTIFICADOR.test(valor)) return;
    if (CHAVE_SEGREDO.test(chave) && !valorVazio(m[2] ?? '', estrutura))
      achados.push({ arquivo, linha: i + 1, chave });
  });
  return achados;
}

function arquivosDoRepositorio(raiz: string): string[] {
  const listar = (args: string[]): string[] =>
    execFileSync('git', args, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean);
  // Versionados e os que serão versionados (não ignorados).
  return [
    ...new Set([
      ...listar(['ls-files', '-z']),
      ...listar(['ls-files', '-z', '--others', '--exclude-standard']),
    ]),
  ];
}

function tamanhoDe(caminho: string): number | null {
  try {
    return statSync(caminho).size;
  } catch {
    return null;
  }
}

function principal(): number {
  const raiz = resolve(import.meta.dirname, '../../..');
  const achados: Achado[] = [];
  for (const arquivo of arquivosDoRepositorio(raiz)) {
    const caminho = join(raiz, arquivo);
    const tamanho = tamanhoDe(caminho);
    if (tamanho === null || tamanho > 5 * 1024 * 1024) continue; // apagado na árvore ou grande demais
    const bytes = readFileSync(caminho);
    if (bytes.includes(0)) continue; // binário
    achados.push(...procurarSegredos(bytes.toString('utf8'), arquivo));
  }
  for (const a of achados) console.error(`SEGREDO: ${a.arquivo}:${a.linha} tem valor na chave ${a.chave}`);

  const registro = lerRegistro(join(raiz, 'tools/verificadores/env-raiz.json'));
  const medido = medirEnv(join(raiz, '.env'));
  // Na raiz registrada o .env do legado tem de existir e estar igual; num clone, cópia limpa ou CI ele
  // não existe e não há o que conferir. Se existir em qualquer lugar, tem de bater com o registro.
  const naRaizRegistrada = raiz === registro.raiz;
  const conferir = medido !== null || naRaizRegistrada;
  const diferencas = conferir ? compararEnv(registro, medido) : [];
  for (const d of diferencas) console.error(`.env DA RAIZ ALTERADO: ${d}`);

  const situacao = !conferir
    ? `ausente fora da raiz registrada (${registro.raiz ?? '?'}): não conferido`
    : diferencas.length
      ? 'ALTERADO'
      : 'intocado';
  const ok = achados.length === 0 && diferencas.length === 0;
  console.log(
    `[segredos] ${achados.length} valor(es) de segredo em arquivo versionado; .env da raiz ${situacao} → ${
      ok ? 'verde' : 'VERMELHO'
    }`,
  );
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(principal());
