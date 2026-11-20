// Textos de produto (decisão do dono, 20/10/2026: "o nosso lado tem de sobreviver sem o SP Data como muleta").
// Nenhum texto que o usuário vê cita o sistema antigo: falha se aparecer "SPDATA", "legado", "sistema atual"
// ou "sistema antigo" e "fornecedor anterior" (revisão do M44.3; nos módulos de ESCOPO_ESTRITO, também "sistema em uso", "outro sistema" e "sistema anterior") (1) nos valores dos arquivos de i18n, (2) no texto e nos atributos estáticos dos
// templates `.vue` e (3) na área, no caminho e no título dos itens do menu que têm tela. Código, comentários,
// chaves de i18n, nomes internos e docs técnicos podem continuar citando o legado. Exceção só nominal (arquivo
// + trecho) e justificada; exceção que não casa mais com nada também falha (não fica lixo na lista).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARVORE_MENU, type ItemMenu } from '@sgh/contratos';
import { CONSULTAS_LEGADO, DECLARACOES } from '@sgh/legado';

/** Termos proibidos em texto de produto (sem diferenciar maiúsculas; "SP Data" e "SP-DATA" também). */
export const TERMO_PROIBIDO =
  /\bSP[\s-]?DATA\b|\blegad[oa]s?\b|\bsistemas? (?:atual|atuais|antigos?)\b|\bfornecedor(?:es)? anterior(?:es)?\b/i;

/**
 * Sinônimos do sistema atual ("sistema em uso", "outro sistema"). Correção do M30: valem nos módulos listados em
 * ESCOPO_ESTRITO; os demais módulos ainda usam "outro sistema" para avisos de coexistência (rascunho e registro
 * alterados fora) e entram na lista conforme forem revistos.
 */
export const TERMO_ESTRITO = /\bsistemas? em uso\b|\boutros? sistemas?\b|\bsistemas? anterior(?:es)?\b/i;
export const ESCOPO_ESTRITO = /^apps\/(?:web|api)\/src\/modulos\/(?:faturamento|financeiro)\//;

/**
 * Textos que mandam o usuário fazer no outro sistema sem citá-lo pelo nome (diretriz do dono: o Sante administra
 * tudo): "registre como hoje", "continua no editor de origem", "faça no outro sistema".
 */
export const MANDA_PARA_FORA =
  /\bcomo hoje\b|\beditor (?:de [\wà-ú]+ )?de origem\b|\b(?:fa[çc]a|registre|use|continue|altere|mude|edite)\b[^.;:]{0,60}\bno outro sistema\b/i;

const proibido = (t: string, arquivo = '') =>
  TERMO_PROIBIDO.test(t) ||
  MANDA_PARA_FORA.test(t) ||
  (ESCOPO_ESTRITO.test(arquivo) && TERMO_ESTRITO.test(t));

export interface ExcecaoTexto {
  /** Caminho do arquivo a partir da raiz (ou `menu:<id>` para um item do menu). */
  readonly arquivo: string;
  /** Trecho exato do texto excetuado. */
  readonly trecho: string;
  readonly justificativa: string;
}

/**
 * Exceções nominais. Hoje nenhuma: as telas técnicas usam "banco de dados" e "integridade de gravação", e as
 * mensagens de senha mandam procurar o administrador do sistema. Para acrescentar uma, diga por que o usuário
 * precisa ler o nome do sistema antigo naquele ponto (e não um termo neutro).
 */
export const EXCECOES: readonly ExcecaoTexto[] = [];

export interface AchadoTexto {
  readonly arquivo: string;
  readonly linha: number;
  readonly texto: string;
}

function linhaDe(conteudo: string, indice: number): number {
  return conteudo.slice(0, indice).split('\n').length;
}

/** Troca comentários por espaços (preserva índices e linhas), sem tocar nos literais. */
function semComentarios(codigo: string): string {
  return codigo.replace(
    /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (m) => (m.startsWith('/') ? m.replace(/[^\n]/g, ' ') : m),
  );
}

const LITERAL = /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;

/** Valores de texto de um arquivo de i18n: literais que não são chave (`'chave': ...`) nem importação. */
export function textosDeI18n(conteudo: string): { texto: string; indice: number }[] {
  const codigo = semComentarios(conteudo);
  const textos: { texto: string; indice: number }[] = [];
  for (const m of codigo.matchAll(LITERAL)) {
    const depois = codigo.slice(m.index + m[0].length);
    const antes = codigo.slice(0, m.index);
    if (/^\s*:/.test(depois)) continue; // chave entre aspas
    if (/\b(?:from|import)\s*\(?\s*$/.test(antes)) continue; // módulo importado
    textos.push({ texto: m[0].slice(1, -1), indice: m.index });
  }
  return textos;
}

/** Atributos sem texto para o usuário (identificadores, estilos, destinos). */
const ATRIBUTO_TECNICO =
  /^(?:class|id|key|ref|name|for|type|href|to|role|src|style|autocomplete|inputmode|variante|tamanho|method|action|lang|scope|rel|target|slot|is|tag|as|lado|cor|icone|tabindex|accept|pattern|step|min|max|data-[\w-]+)$/i;

/**
 * Texto visível de um `.vue`: dentro de `<template>`, os nós de texto (sem `{{ }}`) e os valores dos
 * atributos estáticos que podem aparecer (placeholder, title, aria-label, props de texto). Atributos ligados
 * (`:x`, `v-bind`, `@x`, `v-*`, `#slot`) são código e ficam de fora.
 */
export function textosDeTemplate(conteudo: string): { texto: string; indice: number }[] {
  const ini = conteudo.indexOf('<template');
  const fim = conteudo.lastIndexOf('</template>');
  if (ini < 0 || fim < 0) return [];
  const textos: { texto: string; indice: number }[] = [];
  const template = conteudo.slice(0, fim).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const TAG = /<\/?[A-Za-z][\w.-]*((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*\/?>/g;
  let ultimo = ini;
  for (const t of template.slice(ini).matchAll(TAG)) {
    const pos = ini + t.index;
    const entre = template.slice(ultimo, pos).replace(/\{\{[\s\S]*?\}\}/g, (m) => ' '.repeat(m.length));
    if (entre.trim()) textos.push({ texto: entre.trim(), indice: ultimo });
    for (const a of (t[1] ?? '').matchAll(/([^\s=>/]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/g)) {
      const nome = a[1]!;
      if (!a[2] || /^[:@#]|^v-/.test(nome) || ATRIBUTO_TECNICO.test(nome)) continue;
      textos.push({ texto: a[2].slice(1, -1), indice: pos });
    }
    ultimo = pos + t[0].length;
  }
  return textos;
}

/** Textos do menu que o usuário vê: área, caminho e título dos itens com tela. */
export function textosDoMenu(itens: readonly ItemMenu[]): { id: string; texto: string }[] {
  return itens
    .filter((i) => i.rota !== null)
    .flatMap((i) => [i.area, ...i.caminho].map((texto) => ({ id: i.id, texto })));
}

/**
 * Correção do M14: os textos das declarações geradas que a tela mostra — rótulos de domínio, de campo e de
 * consulta, e os motivos de só consulta e de sem inclusão. Nos motivos, também o nome de tabela ou de coluna do
 * banco (palavra em maiúsculas com sublinhado, ou de 5 letras ou mais que não é sigla conhecida) e a citação de
 * regra interna ("regra 9").
 */
export interface TextoDeclarado {
  readonly id: string;
  readonly texto: string;
  readonly motivo: boolean;
}

const SIGLAS =
  /^(?:SADT|TISS|CNPJ|SIGTAP|APAC|SINAN|NANDA|CIPE|APACHE|SOFA|SAPS|GERINT|GERCON|ONA|BRASINDICE|SIMPRO|CBHPM|SESMT|ESOCIAL|CAGED|SEFIP|FGTS|RAIS|SPED|NFSE|ICMS|INSS|HTML|UNIMED|IBGE)$/;
/** Nome do banco num texto de produto (tabela, coluna) ou citação de regra interna. */
export function nomeDoBanco(texto: string): string | null {
  for (const m of texto.matchAll(/\b[A-Z][A-Z0-9$]*(?:_[A-Z0-9$]+)+\b|\b[A-Z]{5,}[0-9]*\b/g))
    if (!SIGLAS.test(m[0])) return m[0];
  const r = /\bregra \d+\b/i.exec(texto);
  return r ? r[0] : null;
}

export function textosDasDeclaracoes(): TextoDeclarado[] {
  const r: TextoDeclarado[] = [];
  for (const d of DECLARACOES) {
    const id = `dominio:${d.publico.modulo}.${d.publico.recurso}`;
    r.push({ id, texto: d.publico.rotulo.plural, motivo: false });
    r.push({ id, texto: d.publico.rotulo.singular, motivo: false });
    if (d.publico.motivoSomenteLeitura) r.push({ id, texto: d.publico.motivoSomenteLeitura, motivo: true });
    if (d.publico.semInclusao) r.push({ id, texto: d.publico.semInclusao, motivo: true });
    for (const c of d.colunas) r.push({ id, texto: c.rotulo, motivo: false });
    for (const c of d.textosLongos ?? []) r.push({ id, texto: c.rotulo, motivo: false });
  }
  for (const c of CONSULTAS_LEGADO) {
    const id = `consulta:${c.publico.modulo}.${c.publico.recurso}`;
    r.push({ id, texto: c.publico.rotulo, motivo: false });
    for (const x of c.colunas) r.push({ id, texto: x.rotulo, motivo: false });
  }
  return r;
}

export interface Resultado {
  readonly achados: AchadoTexto[];
  readonly excecoesSemUso: ExcecaoTexto[];
}

export function verificarTextos(
  arquivos: readonly { arquivo: string; conteudo: string }[],
  menu: readonly ItemMenu[],
  excecoes: readonly ExcecaoTexto[] = EXCECOES,
  declarados: readonly TextoDeclarado[] = [],
): Resultado {
  const usadas = new Set<ExcecaoTexto>();
  const achados: AchadoTexto[] = [];
  const conferir = (arquivo: string, linha: number, texto: string) => {
    if (!proibido(texto, arquivo)) return;
    const e = excecoes.find((x) => x.arquivo === arquivo && texto.includes(x.trecho));
    if (e) usadas.add(e);
    else achados.push({ arquivo, linha, texto });
  };
  for (const { arquivo, conteudo } of arquivos) {
    const textos = arquivo.endsWith('.vue')
      ? textosDeTemplate(conteudo)
      : MENSAGENS_DA_API.test(arquivo)
        ? textosDeI18n(conteudo).filter((t) => FRASE.test(t.texto))
        : textosDeI18n(conteudo);
    for (const t of textos) conferir(arquivo, linhaDe(conteudo, t.indice), t.texto);
  }
  for (const t of textosDoMenu(menu)) conferir(`menu:${t.id}`, 0, t.texto);
  for (const t of declarados) {
    conferir(t.id, 0, t.texto);
    const nome = t.motivo ? nomeDoBanco(t.texto) : null;
    if (nome) achados.push({ arquivo: t.id, linha: 0, texto: `${t.texto} [cita ${nome}]` });
  }
  return { achados, excecoesSemUso: excecoes.filter((e) => !usadas.has(e)) };
}

/**
 * Módulos da API cujas mensagens (motivos, detalhes do Problem Details) o usuário lê: só as frases contam (um
 * literal com espaço e pontuação final), não os identificadores. Hoje, os do PEP (M15 e M22) e os do faturamento
 * (M30: avisos e recusas do ResultadoFaturamento).
 */
export const MENSAGENS_DA_API = /^apps\/api\/src\/modulos\/(?:pep|faturamento)\/(?!.*\.spec\.ts$)[^/]+\.ts$/;
const FRASE = /\s\S+\s.*[.!?:]$/;

/** Arquivos de i18n (valores: `i18n/*.ts`, `i18n-*.ts` e o `i18n.ts` de cada módulo), componentes `.vue` e as mensagens da API do PEP. */
export function arquivosDeTexto(raiz: string): string[] {
  const saida = execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages'], {
    cwd: raiz,
    encoding: 'utf8',
  });
  return saida
    .split('\0')
    .filter(Boolean)
    .filter(
      (f) =>
        f.endsWith('.vue') ||
        MENSAGENS_DA_API.test(f) ||
        (/\/i18n\/[^/]+\.ts$|\/i18n-[\w-]+\.ts$|\/modulos\/[\w-]+\/i18n\.ts$/.test(f) &&
          !/\.spec\.ts$/.test(f)),
    );
}

function principal(): number {
  const raiz = resolve(import.meta.dirname, '../../..');
  const arquivos = arquivosDeTexto(raiz).map((arquivo) => ({
    arquivo,
    conteudo: readFileSync(resolve(raiz, arquivo), 'utf8'),
  }));
  const declarados = textosDasDeclaracoes();
  const { achados, excecoesSemUso } = verificarTextos(arquivos, ARVORE_MENU, EXCECOES, declarados);
  for (const a of achados)
    console.error(`[textos-de-produto] ${a.arquivo}${a.linha ? `:${a.linha}` : ''}: "${a.texto}"`);
  for (const e of excecoesSemUso)
    console.error(`[textos-de-produto] exceção sem uso (tire da lista): ${e.arquivo} "${e.trecho}"`);
  const ok = achados.length === 0 && excecoesSemUso.length === 0;
  console.log(
    `[textos-de-produto] ${arquivos.length} arquivo(s) de i18n e .vue e ${textosDoMenu(ARVORE_MENU).length} texto(s) ` +
      `do menu e ${declarados.length} das declarações geradas; ${achados.length} achado(s) → ${ok ? 'verde' : 'VERMELHO'}`,
  );
  return ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(principal());
