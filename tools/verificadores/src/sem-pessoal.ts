// verificadores:sem-pessoal (M03, regra 1; convencoes.md §7 e §11; cap-15 §15.10.1): os arquivos de
// assinatura e de perfil não guardam conteúdo de linha. Falha com CPF, CNS, telefone, e-mail ou data de
// linha em qualquer texto desses arquivos, com valor (constante, domínio, lista de valores) em coluna da
// lista de pessoais, sensíveis e identificadores (tools/assinatura/colunas-pessoais.yaml), com contagem de
// 1 a 4 publicada como número (valores, sentinelas, padrões de coocorrência, ligações) e com coluna sensível
// na coocorrência. Roda em `pnpm verificar`.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

export interface AchadoPessoal {
  readonly arquivo: string;
  readonly caminho: string;
  readonly motivo: string;
}

const PADROES: readonly (readonly [RegExp, string])[] = [
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, 'CPF'],
  [/(?<![\d.])\d{11}(?![\d.])/, 'CPF (só dígitos)'],
  [/(?<![\d.])[1-2789]\d{14}(?![\d.])/, 'CNS'],
  [/\(?\b\d{2}\)?\s?9?\d{4}-\d{4}\b/, 'telefone'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'e-mail'],
];

/** Data de linha (AAAA-MM-DD) que não é sentinela nem data de geração/janela (só em valores de domínio). */
const DATA = /^\d{4}-\d{2}-\d{2}/;
const SENTINELAS = new Set(['1899-12-30', '2099']);

export interface ListaPessoais {
  readonly pessoais: RegExp[];
  /** Sensíveis (também em `pessoais`): nem na coocorrência podem aparecer. */
  readonly sensiveis?: RegExp[];
  readonly identificadores: RegExp[];
}

/** Contagem publicada abaixo deste número é recusada (tem de sair como "<5"). */
const CONTAGEM_MINIMA = 5;
const pequena = (v: unknown) => typeof v === 'number' && v > 0 && v < CONTAGEM_MINIMA;

export function lerListaPessoais(raiz: string): ListaPessoais {
  const y = parse(readFileSync(resolve(raiz, 'tools/assinatura/colunas-pessoais.yaml'), 'utf8')) as {
    pessoais: string[];
    sensiveis?: string[];
    identificadores: string[];
  };
  const re = (p: string) => new RegExp(`^(?:${p})$`, 'i');
  return {
    pessoais: [...y.pessoais, ...(y.sensiveis ?? [])].map(re),
    sensiveis: (y.sensiveis ?? []).map(re),
    identificadores: y.identificadores.map(re),
  };
}

export function colunaRestrita(lista: ListaPessoais, coluna: string): boolean {
  return [...lista.pessoais, ...lista.identificadores].some((r) => r.test(coluna));
}

/** Arquivos que a regra cobre: assinaturas, perfis, domínios vistos e resultados da ferramenta. */
export function cobertoPelaRegra(arquivo: string): boolean {
  return (
    /\.assinatura\.json$/.test(arquivo) ||
    /(^|\/)perfil-[A-Z0-9_$]+(\.[a-z0-9]+)?\.json$/.test(arquivo) ||
    /(^|\/)dominios-vistos\.json$/.test(arquivo) ||
    /^tools\/assinatura\/resultados\/.+\.(json|txt)$/.test(arquivo) ||
    // M14: o levantamento do lote (estrutura e perfil resumido das tabelas do marco).
    /^tools\/matriz\/dados\/levantamento-[a-z0-9]+\.[a-z0-9]+\.json$/.test(arquivo)
  );
}

function textos(v: unknown, caminho: string, saida: [string, string][]): void {
  if (typeof v === 'string') saida.push([caminho, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => textos(x, `${caminho}[${i}]`, saida));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      saida.push([`${caminho}.<chave>`, k]);
      textos(x, `${caminho}.${k}`, saida);
    }
  }
}

const temValor = (classe: unknown) =>
  typeof classe === 'string' && (classe.startsWith('constante:') || classe.startsWith('dominio:'));

/** Procura dado pessoal num arquivo de assinatura, perfil, domínios ou resultado. */
export function procurarPessoal(conteudo: string, arquivo: string, lista: ListaPessoais): AchadoPessoal[] {
  const achados: AchadoPessoal[] = [];
  const add = (caminho: string, motivo: string) => achados.push({ arquivo, caminho, motivo });
  let json: unknown = null;
  try {
    json = JSON.parse(conteudo);
  } catch {
    // texto (resumo.txt): só os padrões
  }
  const todos: [string, string][] = [];
  if (json === null) todos.push(['$', conteudo]);
  else textos(json, '$', todos);
  // campos de metadados que podem ter data (geração, janela, execução) não são dado de linha
  const ehMetadado = (c: string) =>
    /\.(geradoEm|executadoEm|janela|inicio|fim|data|origem\.[^.]+|impressaoSchema|motivo|decisao)$/.test(c);
  for (const [c, t] of todos) {
    // padrão de coocorrência (só 0 e 1, um por coluna) não é número de documento
    const soBinario = /\.coocorrencia\.padroes\[\d+\]\.padrao$/.test(c) && /^[01]+$/.test(t);
    for (const [re, nome] of PADROES) {
      if (soBinario) continue;
      if (nome !== 'CPF' && nome !== 'e-mail' && ehMetadado(c)) continue; // hash e datas de metadado
      if (re.test(t)) add(c, nome);
    }
  }
  // Correção do M21: o resultado da comparação (o esperado e o obtido de uma coluna restrita, como o conselho do
  // médico) também não leva valor: nem no JSON (`elemento` …colunas.<C>) nem na linha do resumo em texto.
  const valorDeClasse = (v: unknown) =>
    typeof v === 'string' && /^(constante|dominio):(?!<omitido>$)./.test(v);
  if (json === null) {
    conteudo.split('\n').forEach((l, i) => {
      const m = /colunas\.([A-Z0-9_$]+)\b/.exec(l);
      if (m?.[1] && colunaRestrita(lista, m[1]) && /\b(constante|dominio):(?!<omitido>)[^;)\s]+/.test(l))
        add(`$:${i + 1}`, 'valor em coluna pessoal no resultado');
    });
  } else {
    const andar = (v: unknown, caminho: string) => {
      if (Array.isArray(v)) return v.forEach((x, i) => andar(x, `${caminho}[${i}]`));
      if (!v || typeof v !== 'object') return;
      const r = v as Record<string, unknown>;
      const m = typeof r['elemento'] === 'string' ? /\.colunas\.([A-Z0-9_$]+)$/.exec(r['elemento']) : null;
      if (
        m?.[1] &&
        colunaRestrita(lista, m[1]) &&
        (valorDeClasse(r['esperado']) || valorDeClasse(r['obtido']))
      )
        add(caminho, 'valor em coluna pessoal no resultado');
      for (const [k, x] of Object.entries(r)) andar(x, `${caminho}.${k}`);
    };
    andar(json, '$');
  }
  if (!json || typeof json !== 'object') return achados;
  const o = json as Record<string, unknown>;
  // M14: levantamento do lote (tabelas.<T>.perfil.colunas): cada tabela passa pelas regras do perfil.
  if (o['tabelas'] && typeof o['tabelas'] === 'object' && !Array.isArray(o['tabelas']) && 'hospital' in o) {
    for (const [t, x] of Object.entries(o['tabelas'] as Record<string, { perfil?: { colunas?: unknown } }>)) {
      const perfil = JSON.stringify({ tabela: t, colunas: x.perfil?.colunas ?? {} });
      for (const a of procurarPessoal(perfil, arquivo, lista))
        achados.push({ ...a, caminho: a.caminho.replace(/^\$/, `$.tabelas.${t}.perfil`) });
    }
  }
  // perfil: colunas.<C>.{classe, valores}
  if (o['colunas'] && typeof o['colunas'] === 'object' && 'tabela' in o) {
    for (const [col, c] of Object.entries(o['colunas'] as Record<string, Record<string, unknown>>)) {
      if (!colunaRestrita(lista, col)) {
        for (const v of Object.keys((c['valores'] as Record<string, unknown> | undefined) ?? {})) {
          if (DATA.test(v) && !SENTINELAS.has(v))
            add(`$.colunas.${col}.valores`, 'data de linha em valor de domínio');
        }
        continue;
      }
      if (c['valores'] !== undefined) add(`$.colunas.${col}.valores`, 'valores em coluna pessoal');
      if (temValor(c['classe'])) add(`$.colunas.${col}.classe`, 'valor em coluna pessoal');
      if (typeof c['distintos'] === 'number')
        add(`$.colunas.${col}.distintos`, 'distintos em coluna pessoal');
    }
  }
  // contagens pequenas: padrões de coocorrência, ligações e sentinelas (só "<5"); coluna sensível na
  // coocorrência
  const cooc = o['coocorrencia'] as
    { colunas?: unknown; padroes?: { linhas?: unknown }[] } | null | undefined;
  if (cooc && typeof cooc === 'object') {
    (cooc.padroes ?? []).forEach((p, i) => {
      if (pequena(p.linhas))
        add(`$.coocorrencia.padroes[${i}].linhas`, 'contagem abaixo de 5 na coocorrência');
    });
    if (Array.isArray(cooc.colunas)) {
      for (const c of cooc.colunas) {
        if (typeof c === 'string' && (lista.sensiveis ?? []).some((r) => r.test(c)))
          add('$.coocorrencia.colunas', 'coluna sensível na coocorrência');
      }
    }
  }
  if (Array.isArray(o['ligacoes']) && 'tabela' in o) {
    (o['ligacoes'] as Record<string, unknown>[]).forEach((l, i) => {
      if (pequena(l['total']) || pequena(l['comCorrespondente']))
        add(`$.ligacoes[${i}]`, 'contagem abaixo de 5 na ligação');
    });
  }
  if (o['colunas'] && typeof o['colunas'] === 'object' && 'tabela' in o) {
    for (const [col, c] of Object.entries(o['colunas'] as Record<string, Record<string, unknown>>)) {
      for (const [k, v] of Object.entries((c['sentinelas'] as Record<string, unknown> | undefined) ?? {}))
        if (pequena(v)) add(`$.colunas.${col}.sentinelas.${k}`, 'contagem abaixo de 5 na sentinela');
      for (const [k, v] of Object.entries((c['valores'] as Record<string, unknown> | undefined) ?? {}))
        if (pequena(v)) add(`$.colunas.${col}.valores.${k}`, 'contagem abaixo de 5 em valor');
    }
  }
  // domínios vistos: colunas."T.C".valores
  if (o['colunas'] && typeof o['colunas'] === 'object' && 'grupo' in o) {
    for (const k of Object.keys(o['colunas'] as object)) {
      const col = k.split('.')[1] ?? '';
      if (colunaRestrita(lista, col)) add(`$.colunas.${k}`, 'domínio exportado de coluna pessoal');
    }
  }
  // assinatura: tabelas[].colunas.<C>.classe
  if (Array.isArray(o['tabelas'])) {
    (o['tabelas'] as Record<string, unknown>[]).forEach((t, i) => {
      for (const [col, c] of Object.entries(
        (t['colunas'] as Record<string, Record<string, unknown>>) ?? {},
      )) {
        if (colunaRestrita(lista, col) && temValor(c['classe']))
          add(`$.tabelas[${i}].colunas.${col}.classe`, 'valor em coluna pessoal');
      }
    });
  }
  return achados;
}

function arquivosDoRepositorio(raiz: string): string[] {
  const listar = (args: string[]): string[] =>
    execFileSync('git', args, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean);
  return [
    ...new Set([
      ...listar(['ls-files', '-z']),
      ...listar(['ls-files', '-z', '--others', '--exclude-standard']),
    ]),
  ];
}

export function verificarRepositorio(raiz: string): { arquivos: number; achados: AchadoPessoal[] } {
  const lista = lerListaPessoais(raiz);
  const alvos = arquivosDoRepositorio(raiz).filter(cobertoPelaRegra);
  const achados: AchadoPessoal[] = [];
  for (const a of alvos) {
    const p = join(raiz, a);
    try {
      if (statSync(p).size > 20 * 1024 * 1024) {
        achados.push({ arquivo: a, caminho: '$', motivo: 'arquivo grande demais para conferir' });
        continue;
      }
    } catch {
      continue; // apagado na árvore
    }
    achados.push(...procurarPessoal(readFileSync(p, 'utf8'), a, lista));
  }
  return { arquivos: alvos.length, achados };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const raiz = resolve(import.meta.dirname, '../../..');
  const { arquivos, achados } = verificarRepositorio(raiz);
  // Só o caminho e o motivo: o valor achado nunca é impresso.
  for (const a of achados) console.error(`PESSOAL: ${a.arquivo} ${a.caminho}: ${a.motivo}`);
  console.log(
    `sem-pessoal: ${arquivos} arquivo(s) de assinatura, perfil, domínios e resultados; ${achados.length} achado(s).`,
  );
  process.exit(achados.length === 0 ? 0 : 1);
}
