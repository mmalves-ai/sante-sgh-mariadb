// Catálogo de operações em tempo de execução (convencoes.md §6; ficha do M04, passo 0 do executor): o
// executor consulta o estado da operação por estabelecimento no catálogo docs/operacoes/catalogo/ (W0-01: um
// arquivo <prefixo>.yaml por prefixo do nome, juntados pelo carregador único de @sgh/contratos,
// juntarFatiasCatalogo, e validados pelo esquema). Pasta ou arquivo ilegível ou inválido, nome repetido entre
// arquivos ou operação no arquivo de outro prefixo: nenhuma operação grava (falha fechada).
// M36 (regra 6): o estado consultado é o efetivo. Uma operação `conferida` ou `liberada` cuja última reexecução das
// assinaturas (tools/assinatura/resultados/<data>/<op>.<cod>.json) divergiu, ou cujo relatório mais recente está
// ilegível, volta a `bloqueada` ali mesmo, sem esperar alguém editar o catálogo.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import {
  type CatalogoOperacoes,
  catalogoUnico,
  CHAVE_RESULTADO_ILEGIVEL,
  type FatiaCatalogo,
  juntarFatiasCatalogo,
  esquemaResultadoOperacao,
  type EstadoOperacao,
  estadoEfetivo,
  estadoEm,
  type ResultadoPorCenario,
} from '@sgh/contratos';
import { parse } from 'yaml';

const ehPasta = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

/**
 * Onde o catálogo está de fato: a pasta das fatias, ou um arquivo único (catálogo de exemplo dos testes). O
 * caminho antigo `…/catalogo.yaml` que não existe mais e tem a pasta `…/catalogo/` ao lado vale como a pasta
 * (arquivo de ambiente de instalação anterior ao W0-01, CATALOGO_OPERACOES/SGH_CATALOGO_OPERACOES).
 */
export function resolverCaminhoCatalogo(caminho: string): string {
  if (!existsSync(caminho) && caminho.endsWith('.yaml') && ehPasta(caminho.slice(0, -'.yaml'.length)))
    return caminho.slice(0, -'.yaml'.length);
  return caminho;
}

/** YAML interpretado; o erro de sintaxe sai com o nome do arquivo (`same.yaml: … at line 84, column 1`). */
function lerYaml(caminho: string, rotulo: string): unknown {
  try {
    return parse(readFileSync(caminho, 'utf8')) as unknown;
  } catch (e) {
    throw new Error(`${rotulo}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

/**
 * Os arquivos `<prefixo>.yaml` da pasta do catálogo, na ordem do nome, com o YAML interpretado. Erro de sintaxe
 * (ex.: conflito de merge mal resolvido numa das fatias) sai com o nome do arquivo.
 */
export function lerFatiasCatalogo(pasta: string): FatiaCatalogo[] {
  return readdirSync(pasta)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => ({ arquivo: f, dados: lerYaml(resolve(pasta, f), f) }));
}

/**
 * Carregador do catálogo a partir do disco: a pasta das fatias (juntarFatiasCatalogo) ou um arquivo único. Recusa
 * o monólito `catalogo.yaml` ao lado da pasta (sobra de integração de ramo anterior ao fatiamento: rode
 * `node planejamento/crud/ferramentas/fatiar-catalogo.mjs`), para que nenhuma operação fique fora do que o
 * executor lê. A ordem das operações é a do nome.
 */
export function lerCatalogoOperacoes(caminho: string): CatalogoOperacoes {
  const alvo = resolverCaminhoCatalogo(caminho);
  if (ehPasta(alvo)) {
    const monolito = `${alvo.replace(/[\\/]+$/, '')}.yaml`;
    if (existsSync(monolito))
      throw new Error(
        `${basename(monolito)} ao lado da pasta do catálogo: junte-o às fatias com planejamento/crud/ferramentas/fatiar-catalogo.mjs.`,
      );
    return juntarFatiasCatalogo(lerFatiasCatalogo(alvo));
  }
  return catalogoUnico(lerYaml(alvo, basename(alvo)));
}

/** Pasta dos relatórios do assinatura:testar ao lado do catálogo (docs/operacoes/catalogo → tools/…). */
export const pastaResultadosDoCatalogo = (caminhoCatalogo: string): string =>
  resolve(dirname(resolve(caminhoCatalogo)), '../../tools/assinatura/resultados');

export interface UltimaReproducao {
  readonly cenarios: ResultadoPorCenario;
  /** Resumo da impressão do schema da cópia (null: relatório sem a impressão, anterior ao M36, ou ilegível). */
  readonly impressaoSchema: string | null;
  readonly executadoEm: string | null;
  readonly data: string;
}

/**
 * Relatório mais recente da operação no estabelecimento (null: nenhuma execução). Arquivo ilegível ou fora do
 * esquema não é "sem execução": volta com `CHAVE_RESULTADO_ILEGIVEL`, que o estado efetivo trata como divergência.
 */
export function ultimaReproducao(pasta: string, operacao: string, cod: string): UltimaReproducao | null {
  if (!existsSync(pasta)) return null;
  let datas: string[];
  try {
    datas = readdirSync(pasta)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();
  } catch {
    return {
      cenarios: { [CHAVE_RESULTADO_ILEGIVEL]: 'ilegivel' },
      impressaoSchema: null,
      executadoEm: null,
      data: '',
    };
  }
  for (const d of datas) {
    const p = resolve(pasta, d, `${operacao}.${cod}.json`);
    if (!existsSync(p)) continue;
    try {
      const r = esquemaResultadoOperacao.parse(JSON.parse(readFileSync(p, 'utf8')));
      return {
        cenarios: Object.fromEntries(r.cenarios.map((c) => [c.cenario, c.resultado])),
        impressaoSchema: r.impressaoSchema ?? null,
        executadoEm: r.executadoEm,
        data: d,
      };
    } catch {
      return {
        cenarios: { [CHAVE_RESULTADO_ILEGIVEL]: 'ilegivel' },
        impressaoSchema: null,
        executadoEm: null,
        data: d,
      };
    }
  }
  return null;
}

export interface FonteCatalogo {
  /** Estado efetivo da operação no estabelecimento; null: a operação não está no catálogo. */
  estado(operacao: string, hospital: string): EstadoOperacao | null;
  /** Por que o estado efetivo difere do declarado (regra 6), ou null. */
  motivo?(operacao: string, hospital: string): string | null;
}

export interface OpcoesFonteCatalogo {
  /** Pasta dos relatórios do assinatura:testar; sem ela, vale o estado declarado. */
  readonly pastaResultados?: string | null;
}

export function fonteCatalogo(cat: CatalogoOperacoes, opcoes: OpcoesFonteCatalogo = {}): FonteCatalogo {
  const memo = new Map<string, { estado: EstadoOperacao; motivo: string | null } | null>();
  const efetivo = (operacao: string, hospital: string) => {
    const k = `${operacao}\u0000${hospital}`;
    if (!memo.has(k)) memo.set(k, calcular(operacao, hospital));
    return memo.get(k) ?? null;
  };
  const calcular = (operacao: string, hospital: string) => {
    const op = cat.operacoes.find((o) => o.nome === operacao);
    if (!op) return null;
    const declarado = estadoEm(op, hospital);
    if ((declarado !== 'conferida' && declarado !== 'liberada') || !opcoes.pastaResultados)
      return { estado: declarado, motivo: null };
    const ef = estadoEfetivo(
      declarado,
      ultimaReproducao(opcoes.pastaResultados, operacao, hospital)?.cenarios ?? null,
    );
    return { estado: ef.estado, motivo: ef.motivo };
  };
  return {
    estado: (operacao, hospital) => efetivo(operacao, hospital)?.estado ?? null,
    motivo: (operacao, hospital) => efetivo(operacao, hospital)?.motivo ?? null,
  };
}

/** Aviso do catálogo recusado (padrão: console.warn). A mensagem só tem nomes de arquivo, de operação e de campo. */
export type AvisoCatalogo = (mensagem: string) => void;

/**
 * Lê o arquivo a cada consulta curta (cache de alguns segundos): mudar o catálogo não exige reiniciar. Os
 * relatórios das reexecuções vêm da pasta ao lado do catálogo (`pastaResultados`, ou null para não aplicar a regra 6).
 * Catálogo recusado: tudo `bloqueada` (falha fechada), e o motivo traz a mensagem do carregador (o que está errado e
 * o comando que resolve, ex.: o monólito ao lado da pasta). O aviso sai uma vez por troca de estado (recusado com
 * outra mensagem, ou legível de novo), não a cada consulta.
 */
export function fonteCatalogoArquivo(
  caminho: string,
  validadeMs = 5_000,
  pastaResultados: string | null = pastaResultadosDoCatalogo(caminho),
  avisar: AvisoCatalogo = (m) => console.warn(m),
): FonteCatalogo {
  let cache: { em: number; fonte: FonteCatalogo | null; erro: string | null } | null = null;
  let ultimoAviso: string | null = null;
  const atual = (): { fonte: FonteCatalogo | null; erro: string | null } => {
    const agora = Date.now();
    if (!cache || agora - cache.em > validadeMs) {
      let fonte: FonteCatalogo | null = null;
      let erro: string | null = null;
      try {
        fonte = fonteCatalogo(lerCatalogoOperacoes(caminho), { pastaResultados });
      } catch (e) {
        erro = e instanceof Error ? e.message : String(e);
      }
      cache = { em: agora, fonte, erro };
      if (erro !== ultimoAviso) {
        avisar(
          erro === null
            ? `[catálogo de operações] legível de novo (${caminho})`
            : `[catálogo de operações] recusado: nenhuma operação grava (${caminho}): ${erro}`,
        );
        ultimoAviso = erro;
      }
    }
    return cache;
  };
  return {
    estado(operacao, hospital) {
      const { fonte } = atual();
      if (!fonte) return 'bloqueada';
      return fonte.estado(operacao, hospital);
    },
    motivo(operacao, hospital) {
      const { fonte, erro } = atual();
      if (!fonte) return `catálogo de operações recusado: ${erro ?? 'ilegível'}`;
      return fonte.motivo?.(operacao, hospital) ?? null;
    },
  };
}
