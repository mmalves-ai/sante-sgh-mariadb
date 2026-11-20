// Fonte das consultas somente leitura (M14): onde as leituras acontecem.
//   - `legado`: o núcleo (READ ONLY; fora de dev/ci, e em dev com ACESSO_FONTE_DEV=copia, a cópia: consulta não
//     grava nada, então ler a cópia em dev é seguro);
//   - `memoria`: a sessão sintética (dev/ci, E2E): linhas sintéticas geradas da declaração (nada vai à cópia);
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em toda chamada.
import type { ValorCampo } from '@sgh/contratos';
import {
  contarConsulta,
  type DeclaracaoConsulta,
  declaracao,
  ErroEscopo,
  type FiltroConsulta,
  type FiltroEscopo,
  linhasParaExportar,
  listarDominio,
  type NucleoLegado,
  paginaDaConsulta,
  type PaginaConsultaLida,
  lerTabelasVazias,
  registroDaConsulta,
  type TabelaVaziaLida,
} from '@sgh/legado';
import { TETO_CONTAGEM_CONSULTA, TETO_EXPORTACAO_CONSULTA } from '@sgh/contratos';
import { ErroProblema } from '../../problema.filter.js';

export const FONTE_CONSULTAS = Symbol('FONTE_CONSULTAS');

export interface CtxConsulta {
  readonly rede: string;
  readonly hospital: string;
  /** Correção do M14: filtro de escopo do M06 da sessão para a permissão da consulta (null: sem restrição). */
  readonly escopo?: FiltroEscopo;
}

/** Justificativa de exportação ativa, como a tela a mostra. */
export interface JustificativaExportacao {
  readonly codigo: number;
  readonly descricao: string;
}

export interface FonteConsultas {
  readonly destino: 'legado' | 'memoria';
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
  /** Justificativas de exportação ativas (PRTIPO_JUSTIF_EXPORTACAO, o domínio de auditoria do M08). */
  justificativas(c: CtxConsulta): Promise<readonly JustificativaExportacao[]>;
  /** Vigia das tabelas vazias do estabelecimento (null: ainda não rodou). */
  tabelasVazias(c: CtxConsulta): Promise<readonly TabelaVaziaLida[] | null>;
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

async function justificativasDe(ler: (fn: Parameters<NucleoLegado['lerSomente']>[1]) => Promise<unknown>) {
  const d = declaracao('auditoria.justificativaExportacao');
  if (!d) return [];
  const lida = (await ler((l) => listarDominio(l, d))) as Awaited<ReturnType<typeof listarDominio>>;
  return lida.itens
    .filter((i) => i.ativo)
    .map((i) => ({ codigo: Number(i.codigo), descricao: String(i.valores[d.descricao] ?? i.codigo) }));
}

export function fonteConsultasLegado(nucleo: NucleoLegado): FonteConsultas {
  const ler = <T>(c: CtxConsulta, fn: Parameters<NucleoLegado['lerSomente']>[1]) =>
    nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: 'consulta-generica' }, fn) as Promise<T>;
  return {
    destino: 'legado',
    pagina: (c, d, f, apos, n) => ler(c, (l) => paginaDaConsulta(l, d, f, apos, n, c.escopo)),
    contar: (c, d, f) => ler(c, (l) => contarConsulta(l, d, f, c.escopo)),
    registro: (c, d, k) => ler(c, (l) => registroDaConsulta(l, d, k, c.escopo)),
    exportar: (c, d, f) => ler(c, (l) => linhasParaExportar(l, d, f, c.escopo)),
    justificativas: (c) => justificativasDe((fn) => ler(c, fn)),
    tabelasVazias: (c) => ler(c, (l) => lerTabelasVazias(l)),
  };
}

export function fonteConsultasIndisponivel(): FonteConsultas {
  const recusar = async (): Promise<never> => {
    throw new ErroFonteConsultas();
  };
  return {
    destino: 'legado',
    pagina: recusar,
    contar: recusar,
    registro: recusar,
    exportar: recusar,
    justificativas: recusar,
    tabelasVazias: recusar,
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
      if (r.length > TETO_EXPORTACAO_CONSULTA) throw new Error('exportação grande');
      return r;
    },
    async justificativas() {
      return [1, 2, 3, 4].map((codigo) => ({ codigo, descricao: `Justificativa ${codigo}` }));
    },
    async tabelasVazias() {
      return null;
    },
  };
}
