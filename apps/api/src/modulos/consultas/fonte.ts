// Fonte das consultas somente leitura (M14; F2.2): onde as leituras acontecem.
//   - própria (`fonte-propria.ts`): o banco do cliente pelo @sgh/nucleo, em transação somente leitura, nas tabelas do
//     modelo próprio (tabelas.gerado.ts) com a declaração montada das colunas do banco;
//   - `memoria`: a sessão sintética (dev/ci, E2E): linhas sintéticas geradas da declaração sintética (nada vai a banco);
//   - indisponível: fora de dev/ci sem o núcleo: 503 em toda chamada.
import {
  type ConsultaPublica,
  TETO_CONTAGEM_CONSULTA,
  TETO_EXPORTACAO_CONSULTA,
  type ValorCampo,
} from '@sgh/contratos';
import { ErroProblema } from '../../problema.filter.js';
import {
  type DeclaracaoConsulta,
  type DestinoConsulta,
  declaracaoSintetica,
  ErroConsulta,
  ErroEscopo,
  type FiltroConsulta,
  type FiltroEscopo,
} from './declaracao.js';
import { DESTINOS_CONSULTA } from './tabelas.gerado.js';

export const FONTE_CONSULTAS = Symbol('FONTE_CONSULTAS');

export interface CtxConsulta {
  readonly rede: string;
  /** Código do estabelecimento da sessão. */
  readonly hospital: string;
  /** Id do estabelecimento no banco do cliente (null/ausente: a fonte própria resolve pelo código). */
  readonly estabelecimento?: number | null;
  readonly usuario?: number | null;
  readonly correlacao?: string;
  /** Filtro de escopo do M06 da sessão para a permissão da consulta (null: sem restrição). */
  readonly escopo?: FiltroEscopo;
}

/** Justificativa de exportação ativa, como a tela a mostra. */
export interface JustificativaExportacao {
  readonly codigo: number;
  readonly descricao: string;
}

/** Uma página da consulta: as linhas (sem máscara: a API mascara) e a chave da última (null: acabou). */
export interface PaginaConsultaLida {
  readonly linhas: Readonly<Record<string, ValorCampo>>[];
  readonly proxima: readonly (string | number | null)[] | null;
}

/** O destino da consulta declarada: a tabela do modelo e o filtro fixo (null: sem destino, fora do índice). */
export function destinoDaConsulta(p: Pick<ConsultaPublica, 'modulo' | 'recurso'>): DestinoConsulta | null {
  return DESTINOS_CONSULTA[`${p.modulo}.${p.recurso}`] ?? null;
}

/** A tabela do modelo que atende a consulta declarada (null: sem destino no modelo, fora do índice). */
export function tabelaDaConsulta(p: Pick<ConsultaPublica, 'modulo' | 'recurso'>): string | null {
  return destinoDaConsulta(p)?.tabela ?? null;
}

export interface FonteConsultas {
  readonly destino: 'banco' | 'memoria';
  /** A declaração física da consulta (null: a tabela não existe neste banco). */
  declaracao(c: CtxConsulta, publico: ConsultaPublica): Promise<DeclaracaoConsulta | null>;
  pagina(
    c: CtxConsulta,
    d: DeclaracaoConsulta,
    filtros: readonly FiltroConsulta[],
    apos: readonly (string | number | null)[] | null,
    porPagina: number,
  ): Promise<PaginaConsultaLida>;
  contar(
    c: CtxConsulta,
    d: DeclaracaoConsulta,
    filtros: readonly FiltroConsulta[],
  ): Promise<{ valor: number; maisDe: boolean }>;
  registro(
    c: CtxConsulta,
    d: DeclaracaoConsulta,
    chave: readonly string[],
  ): Promise<Record<string, ValorCampo> | null>;
  exportar(
    c: CtxConsulta,
    d: DeclaracaoConsulta,
    filtros: readonly FiltroConsulta[],
  ): Promise<Record<string, ValorCampo>[]>;
  /** Justificativas de exportação ativas (o domínio de auditoria tipo_justificativa_exportacao). */
  justificativas(c: CtxConsulta): Promise<readonly JustificativaExportacao[]>;
}

export class ErroFonteConsultas extends ErroProblema {
  constructor() {
    super(
      'indisponivel',
      503,
      'Banco do estabelecimento indisponível',
      'O banco do estabelecimento não está configurado: nada foi lido.',
    );
  }
}

export function fonteConsultasIndisponivel(): FonteConsultas {
  const recusar = async (): Promise<never> => {
    throw new ErroFonteConsultas();
  };
  return {
    destino: 'banco',
    declaracao: recusar,
    pagina: recusar,
    contar: recusar,
    registro: recusar,
    exportar: recusar,
    justificativas: recusar,
  };
}

/** Linhas sintéticas de uma consulta (5), dos tipos das colunas; nenhuma vem do banco. */
export function linhasSinteticasConsulta(d: DeclaracaoConsulta, n = 5): Record<string, ValorCampo>[] {
  return Array.from({ length: n }, (_, i) =>
    Object.fromEntries(
      d.colunas.map((c) => {
        const v: ValorCampo =
          c.tipo === 'inteiro'
            ? i + 1
            : c.tipo === 'decimal'
              ? 1.5 + i
              : c.tipo === 'data'
                ? `2026-07-0${i + 1}`
                : c.tipo === 'dataHora'
                  ? `2026-07-0${i + 1} 10:0${i}:00`
                  : c.tipo === 'hora'
                    ? `0${i + 1}:30`
                    : `${c.rotulo} ${i + 1}`.slice(0, 40);
        return [c.campo, v];
      }),
    ),
  );
}

function compara(a: ValorCampo | undefined, b: ValorCampo | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/** A mesma regra do repositório (filtro, keyset, teto), sobre linhas sintéticas em memória. */
export function fonteConsultasMemoria(): FonteConsultas {
  const cache = new Map<string, Record<string, ValorCampo>[]>();
  const linhas = (d: DeclaracaoConsulta) => {
    const k = `${d.publico.modulo}.${d.publico.recurso}`;
    let x = cache.get(k);
    if (!x) {
      x = linhasSinteticasConsulta(d);
      cache.set(k, x);
    }
    return x;
  };
  const campoDaChave = (d: DeclaracaoConsulta) =>
    d.chave.map((k) => d.colunas.find((c) => c.coluna === k)?.campo ?? k);
  // O escopo como no repositório: restrito sem coluna declarada falha fechado; com coluna, só os valores aceitos.
  const noEscopo = (d: DeclaracaoConsulta, escopo: FiltroEscopo | undefined) => {
    const regras: [string, readonly string[]][] = [];
    for (const [e, valores] of Object.entries(escopo ?? {})) {
      if (valores === null || valores === undefined) continue;
      const coluna = d.escopos?.[e as keyof NonNullable<DeclaracaoConsulta['escopos']>];
      if (!coluna) throw new ErroEscopo(`Escopo ${e} restrito sem coluna na consulta: leitura recusada.`);
      regras.push([d.colunas.find((c) => c.coluna === coluna)?.campo ?? coluna, valores]);
    }
    return (l: Record<string, ValorCampo>) => regras.every(([c, v]) => v.includes(String(l[c] ?? '')));
  };
  const filtrar = (d: DeclaracaoConsulta, f: readonly FiltroConsulta[], escopo?: FiltroEscopo) =>
    linhas(d)
      .filter(noEscopo(d, escopo))
      .filter((l) =>
        f.every((x) =>
          x.modo === 'igual'
            ? String(l[x.campo] ?? '') === String(x.igual ?? '')
            : (!x.de || String(l[x.campo] ?? '').slice(0, 10) >= x.de) &&
              (!x.ate || String(l[x.campo] ?? '').slice(0, 10) <= x.ate),
        ),
      );
  return {
    destino: 'memoria',
    async declaracao(_c, publico) {
      const tabela = tabelaDaConsulta(publico);
      return tabela ? declaracaoSintetica(publico, tabela) : null;
    },
    async pagina(c, d, f, apos, n) {
      const chave = campoDaChave(d);
      let r = filtrar(d, f, c.escopo).sort((a, b) => {
        for (const k of chave) {
          const x = compara(a[k], b[k]);
          if (x !== 0) return x;
        }
        return 0;
      });
      if (apos && chave.length > 0)
        r = r.filter((l) => {
          for (let i = 0; i < chave.length; i++) {
            const x = compara(l[chave[i]!], apos[i] ?? null);
            if (x !== 0) return x > 0;
          }
          return false;
        });
      else if (apos && chave.length === 0) r = r.slice(Number(apos[0] ?? 0));
      const pagina = r.slice(0, n);
      const mais = r.length > n;
      const ultima = pagina[pagina.length - 1];
      return {
        linhas: pagina,
        proxima:
          mais && ultima
            ? chave.length
              ? chave.map((k) => ultima[k] as string | number)
              : [Number(apos?.[0] ?? 0) + n]
            : null,
      };
    },
    async contar(c, d, f) {
      const n = filtrar(d, f, c.escopo).length;
      return n > TETO_CONTAGEM_CONSULTA
        ? { valor: TETO_CONTAGEM_CONSULTA, maisDe: true }
        : { valor: n, maisDe: false };
    },
    async registro(c, d, k) {
      const chave = campoDaChave(d);
      return (
        linhas(d)
          .filter(noEscopo(d, c.escopo))
          .find((l) => chave.every((c, i) => String(l[c] ?? '') === (k[i] ?? ''))) ?? null
      );
    },
    async exportar(c, d, f) {
      const r = filtrar(d, f, c.escopo);
      if (r.length > TETO_EXPORTACAO_CONSULTA)
        throw new ErroConsulta('exportacao-grande', 'A exportação passa do teto: filtre mais.');
      return r;
    },
    async justificativas() {
      return [1, 2, 3, 4].map((codigo) => ({ codigo, descricao: `Justificativa ${codigo}` }));
    },
  };
}
