// Leitura incremental dos fatos (M54-F1; ficha, seção 4 e regra 1; seção 10, "leitura incremental sem perder linha
// alterada durante a leitura"). O worker lê cada fonte em ciclos curtos, fora do pico, e grava só em SGH_CTB_FATO.
//
// Por que a chave e não o carimbo: nenhuma coluna DATA_HORA_ULTIMA_ATUALIZACAO das fontes é indexada (catálogo do
// banco), e ~2 a 73% das linhas de algumas fontes não têm carimbo (MFLANCTO: 26.571 de 36.385 no pc). Então:
//   1. NOVOS: `chave > marca ORDER BY chave` em lotes (índice da chave).
//   2. REVISÃO: a faixa `(marca − folga, marca]` é relida a cada ciclo. Ela pega
//      (a) a linha cuja chave saiu do gerador antes, mas cuja transação confirmou DEPOIS do lote que avançou a marca
//          (o buraco que um `chave > marca` puro perderia para sempre), e
//      (b) a linha recente alterada, com ou sem carimbo (a impressão do conteúdo decide).
//   3. VARREDURA de revisão por faixas antigas (rodízio), para alteração tardia (conta reaberta meses depois), sempre
//      por faixa de chave e com o carimbo só como filtro dentro da faixa.
// A impressão (hash do conteúdo relevante) torna tudo idempotente: reler a mesma linha igual não gera nada.
import type { LinhaFonte, ValorCampoFato } from '@sgh/contratos';

export interface EstadoFonte {
  readonly tabela: string;
  /** Maior chave já lida pela leitura de novos. */
  readonly marca: number;
  /** Próxima faixa da varredura de revisão (rodízio do início ao fim). */
  readonly varredura: number;
}

export interface OpcoesCiclo {
  readonly lote: number;
  readonly folga: number;
  /** Tamanho da faixa de revisão antiga por ciclo. */
  readonly faixaVarredura: number;
}

export interface PlanoCiclo {
  readonly novos: { readonly acimaDe: number; readonly lote: number };
  readonly revisao: { readonly de: number; readonly ate: number } | null;
  readonly varredura: { readonly de: number; readonly ate: number } | null;
}

/** O que ler neste ciclo. Faixas fechadas nas duas pontas (`BETWEEN de AND ate`). */
export function planoDoCiclo(e: EstadoFonte, o: OpcoesCiclo): PlanoCiclo {
  if (!(o.lote > 0) || o.folga < 0 || !(o.faixaVarredura > 0))
    throw new RangeError('Opções do ciclo inválidas.');
  const de = Math.max(1, e.marca - o.folga + 1);
  const revisao = e.marca > 0 && o.folga > 0 ? { de, ate: e.marca } : null;
  // A varredura cobre só o que está abaixo da janela de revisão (o resto já é relido todo ciclo).
  const limite = revisao ? revisao.de - 1 : e.marca;
  let varredura: PlanoCiclo['varredura'] = null;
  if (limite >= 1) {
    const ini = e.varredura >= 1 && e.varredura <= limite ? e.varredura : 1;
    varredura = { de: ini, ate: Math.min(limite, ini + o.faixaVarredura - 1) };
  }
  return { novos: { acimaDe: e.marca, lote: o.lote }, revisao, varredura };
}

/** O estado depois do ciclo: a marca sobe à maior chave lida em novos; a varredura avança (e volta ao início). */
export function estadoDepoisDoCiclo(
  e: EstadoFonte,
  p: PlanoCiclo,
  chavesNovas: readonly number[],
): EstadoFonte {
  const marca = chavesNovas.reduce((m, c) => (c > m ? c : m), e.marca);
  // Passar do limite volta ao início no próximo `planoDoCiclo` (que confere a faixa contra a janela de revisão).
  return { tabela: e.tabela, marca, varredura: p.varredura ? p.varredura.ate + 1 : 1 };
}

/** Forma canônica dos valores (chaves em ordem; números sem notação variável; datas como vieram). */
export function conteudoCanonico(valores: Readonly<Record<string, ValorCampoFato>>): string {
  return Object.keys(valores)
    .sort()
    .map((k) => {
      const v = valores[k];
      return `${k}=${v === null || v === undefined ? '∅' : typeof v === 'number' ? String(v) : JSON.stringify(v)}`;
    })
    .join('|');
}

/**
 * Impressão do conteúdo (FNV-1a de 64 bits, em hexadecimal). Não é segurança: é detecção de mudança, estável entre
 * execuções e máquinas. A trilha guarda o SHA-256 quando precisa de prova (a API calcula com node:crypto).
 */
export function impressaoDaLinha(valores: Readonly<Record<string, ValorCampoFato>>): string {
  let h = 0xcbf29ce484222325n;
  const primo = 0x100000001b3n;
  for (const b of new TextEncoder().encode(conteudoCanonico(valores))) {
    h ^= BigInt(b);
    h = (h * primo) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export type ClasseLinha = 'novo' | 'alterado' | 'igual';

/** Compara a linha lida com o que SGH_CTB_FATO já tem (chave → última impressão vista). */
export function classificarLinha(l: LinhaFonte, conhecidas: ReadonlyMap<number, string>): ClasseLinha {
  const anterior = conhecidas.get(l.id);
  if (anterior === undefined) return 'novo';
  return anterior === impressaoDaLinha(l.valores) ? 'igual' : 'alterado';
}

export interface ResumoLote {
  readonly novos: LinhaFonte[];
  readonly alterados: LinhaFonte[];
  readonly iguais: number;
}

/** Separa um lote lido (novos, revisão e varredura juntos; a mesma chave lida duas vezes conta uma vez). */
export function separarLote(
  linhas: readonly LinhaFonte[],
  conhecidas: ReadonlyMap<number, string>,
): ResumoLote {
  const vistas = new Set<number>();
  const novos: LinhaFonte[] = [];
  const alterados: LinhaFonte[] = [];
  let iguais = 0;
  for (const l of [...linhas].sort((a, b) => a.id - b.id)) {
    if (vistas.has(l.id)) continue;
    vistas.add(l.id);
    const c = classificarLinha(l, conhecidas);
    if (c === 'novo') novos.push(l);
    else if (c === 'alterado') alterados.push(l);
    else iguais += 1;
  }
  return { novos, alterados, iguais };
}
