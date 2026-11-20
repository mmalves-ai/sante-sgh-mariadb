// Regras puras da consulta somente leitura (M14; ficha, seções 4 e 8, regras 5 e 15): filtros só por coluna
// indexada (igual ou período), cursor da paginação por chave (keyset), máscara de dado de pessoa, recusa da
// tabela grande sem filtro e o CSV da exportação. Nada aqui fala com o banco.
import type { ColunaConsulta, ValorCampo } from '@sgh/contratos';

export interface FiltroLido {
  readonly campo: string;
  readonly modo: 'igual' | 'periodo';
  readonly igual?: string | number;
  /** Período: AAAA-MM-DD inclusive. */
  readonly de?: string;
  readonly ate?: string;
}

export class ErroFiltroConsulta extends Error {
  override readonly name = 'ErroFiltroConsulta';
  readonly campos: readonly string[];
  constructor(mensagem: string, campos: readonly string[] = []) {
    super(mensagem);
    this.campos = campos;
  }
}

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function dataValida(v: string): boolean {
  const m = DATA.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

/**
 * Lê os filtros do pedido (`f.<campo>`, `de.<campo>`, `ate.<campo>`): só colunas com filtro declarado, no tipo da
 * coluna; texto exato (sem UPPER nem TRIM: os códigos distinguem maiúsculas, regra 8).
 */
export function lerFiltros(
  pedido: Readonly<Record<string, string | undefined>>,
  colunas: readonly Pick<ColunaConsulta, 'campo' | 'tipo' | 'filtro' | 'rotulo'>[],
): FiltroLido[] {
  const r: FiltroLido[] = [];
  const porCampo = new Map(colunas.map((c) => [c.campo, c]));
  for (const [k, bruto] of Object.entries(pedido)) {
    const m = /^(f|de|ate)\.([a-zA-Z0-9]{1,40})$/.exec(k);
    if (!m || bruto === undefined || bruto === '') continue;
    const c = porCampo.get(m[2] ?? '');
    if (!c || !c.filtro) throw new ErroFiltroConsulta('Filtro só por coluna indexada.', [m[2] ?? k]);
    if (m[1] === 'f') {
      if (c.filtro !== 'igual') throw new ErroFiltroConsulta(`${c.rotulo}: filtre por período.`, [c.campo]);
      if (c.tipo === 'inteiro') {
        if (!/^-?\d{1,15}$/.test(bruto))
          throw new ErroFiltroConsulta(`${c.rotulo}: número inteiro.`, [c.campo]);
        r.push({ campo: c.campo, modo: 'igual', igual: Number(bruto) });
      } else r.push({ campo: c.campo, modo: 'igual', igual: bruto.slice(0, 100) });
    } else {
      if (c.filtro !== 'periodo')
        throw new ErroFiltroConsulta(`${c.rotulo}: filtre pelo valor exato.`, [c.campo]);
      if (!dataValida(bruto)) throw new ErroFiltroConsulta(`${c.rotulo}: data AAAA-MM-DD.`, [c.campo]);
      const atual = r.find((x) => x.campo === c.campo && x.modo === 'periodo');
      const base: FiltroLido = atual ?? { campo: c.campo, modo: 'periodo' };
      const novo: FiltroLido = m[1] === 'de' ? { ...base, de: bruto } : { ...base, ate: bruto };
      if (atual) r.splice(r.indexOf(atual), 1, novo);
      else r.push(novo);
    }
  }
  for (const f of r)
    if (f.modo === 'periodo' && f.de && f.ate && f.de > f.ate)
      throw new ErroFiltroConsulta('Período com o início depois do fim.', [f.campo]);
  return r;
}

/** Tabela grande: sem filtro, a consulta é recusada (ficha, seção 4). */
export function filtroAtendeTabelaGrande(filtros: readonly FiltroLido[]): boolean {
  return filtros.some(
    (f) => f.modo === 'igual' || (f.modo === 'periodo' && (f.de !== undefined || f.ate !== undefined)),
  );
}

/** Máscara do dado de pessoa na lista (o valor só aparece ao abrir o registro, com evento auditado). */
export const MASCARA = '•••';
export function mascarar(v: ValorCampo): ValorCampo {
  return v === null || v === '' ? v : MASCARA;
}

/** Cursor da paginação por chave: os valores da chave da última linha (texto opaco para a tela). */
export function codificarCursor(valores: readonly (string | number | null)[]): string {
  return JSON.stringify(valores);
}

export function decodificarCursor(texto: string, tamanho: number): (string | number | null)[] {
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    throw new ErroFiltroConsulta('Página inválida.');
  }
  if (
    !Array.isArray(v) ||
    v.length !== tamanho ||
    !v.every((x) => x === null || typeof x === 'number' || (typeof x === 'string' && x.length <= 200))
  )
    throw new ErroFiltroConsulta('Página inválida.');
  return v as (string | number | null)[];
}

/** Código do registro (chave composta com "|"), como no CRUD genérico. */
export function codigoDoRegistro(valores: readonly (string | number | null)[]): string {
  return valores
    .map((v) =>
      String(v ?? '')
        .replace(/%/g, '%25')
        .replace(/\|/g, '%7C'),
    )
    .join('|');
}
export function valoresDoCodigo(codigo: string, tamanho: number): string[] {
  const partes = codigo.split('|');
  if (partes.length !== tamanho) throw new ErroFiltroConsulta('Código inválido.');
  return partes.map((p) => p.replace(/%7C/gi, '|').replace(/%25/g, '%'));
}

function celula(v: unknown): string {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV da exportação (separador `;`, fórmula neutralizada), com as colunas e a máscara da lista. */
export function gerarCsvConsulta(
  colunas: readonly Pick<ColunaConsulta, 'campo' | 'rotulo'>[],
  itens: readonly Readonly<Record<string, ValorCampo>>[],
): string {
  const cab = colunas.map((c) => celula(c.rotulo)).join(';');
  const linhas = itens.map((i) => colunas.map((c) => celula(i[c.campo])).join(';'));
  return `${[cab, ...linhas].join('\r\n')}\r\n`;
}
