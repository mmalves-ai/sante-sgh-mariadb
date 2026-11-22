// Cliente das telas de coexistência (M02), validado pelos contratos compartilhados.
import {
  esquemaPainelConexoes,
  esquemaPainelGravacao,
  type PainelConexoes,
  type PainelGravacao,
  type EstabelecimentosApi,
  esquemaEstabelecimentos,
  esquemaPainelAssinaturas,
  type PainelAssinaturas,
  esquemaVerificacaoSchema,
  type VerificacaoSchemaApi,
  type CargaProntidao,
  esquemaCargaProntidao,
  esquemaRelatorioProntidao,
  type RelatorioProntidao,
  esquemaPainelHomologacao,
  type PainelHomologacao,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';

async function ler<T>(resposta: Response, esquema: { parse(v: unknown): T }): Promise<T> {
  if (!resposta.ok) throw new Error(`A API respondeu ${resposta.status}.`);
  return esquema.parse(await resposta.json());
}

export async function buscarEstabelecimentos(buscar: typeof fetch = fetch): Promise<EstabelecimentosApi> {
  return ler(
    await buscar('/api/config/estabelecimentos', { headers: { accept: 'application/json' } }),
    esquemaEstabelecimentos,
  );
}

export async function buscarVerificacaoSchema(buscar: typeof fetch = fetch): Promise<VerificacaoSchemaApi> {
  return ler(
    await buscar('/api/config/schema', { headers: { accept: 'application/json' } }),
    esquemaVerificacaoSchema,
  );
}

export async function verificarSchemaAgora(buscar: typeof fetch = fetch): Promise<VerificacaoSchemaApi> {
  return ler(
    // Muda estado: com a sessão real, a guarda exige o CSRF por token duplo.
    await buscar('/api/config/schema/verificar', {
      method: 'POST',
      headers: { accept: 'application/json', 'x-csrf': tokenCsrf() },
    }),
    esquemaVerificacaoSchema,
  );
}

const ESTADOS: Record<string, string> = {
  homologado: 'Igual ao homologado',
  divergente: 'Diferente do homologado (escritas bloqueadas)',
  'sem-homologacao': 'Sem impressão homologada (escritas bloqueadas)',
  indisponivel: 'Indisponível (escritas bloqueadas)',
};

export function rotuloEstado(estado: string | null): string {
  return estado === null ? 'Não verificado' : (ESTADOS[estado] ?? estado);
}

/** "tabelas: 2 alterados; triggers: 1 ausente" a partir das diferenças por categoria. */
export function resumoDiferencas(d: VerificacaoSchemaApi['marcas'][number]['diferencas']): string {
  const partes = Object.entries(d).map(([cat, x]) => {
    const itens = [
      x.ausentes.length && `${x.ausentes.length} ausente(s)`,
      x.novos.length && `${x.novos.length} novo(s)`,
      x.alterados.length && `${x.alterados.length} alterado(s)`,
    ].filter(Boolean);
    return `${cat}: ${itens.join(', ')}`;
  });
  return partes.length === 0 ? 'nenhuma' : partes.join('; ');
}

export async function buscarPainelAssinaturas(buscar: typeof fetch = fetch): Promise<PainelAssinaturas> {
  return ler(
    await buscar('/api/config/assinaturas', { headers: { accept: 'application/json' } }),
    esquemaPainelAssinaturas,
  );
}

export type GrupoRotulo = 'estadosOperacao' | 'origens' | 'resultados';

/**
 * Rótulo de um código da tela de assinaturas (estado, origem, resultado) pelo i18n
 * (`config.assinaturas.<grupo>.<código com _ no lugar de ->`); código desconhecido sai como está.
 */
export function rotuloCodigo(
  grupo: GrupoRotulo,
  codigo: string,
  t: (chave: string) => string,
  te: (chave: string) => boolean,
): string {
  const chave = `config.assinaturas.${grupo}.${codigo.replace(/-/g, '_')}`;
  return te(chave) ? t(chave) : codigo;
}

/** "classe: 2; formato: 1" a partir das diferenças por tipo. */
export function resumoPorTipo(d: Readonly<Record<string, number>>): string {
  const partes = Object.entries(d)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, n]) => `${t}: ${n}`);
  return partes.join('; ');
}

export interface FiltroAssinaturas {
  readonly modulo: string;
  readonly estado: string;
  readonly estabelecimento: string;
}

/** Filtro da lista (módulo, estado e estabelecimento; '' é "todos"). */
export function filtrarOperacoes(
  ops: PainelAssinaturas['operacoes'],
  f: FiltroAssinaturas,
): PainelAssinaturas['operacoes'] {
  return ops.filter((o) => {
    if (f.modulo && o.modulo !== f.modulo) return false;
    const estados = f.estabelecimento ? [o.estados[f.estabelecimento]] : Object.values(o.estados);
    if (f.estado && !estados.includes(f.estado as never)) return false;
    return true;
  });
}

// M36: painel da homologação sobre a cópia (rodadas, conferências, triggers vistos, impressões, pentest).
export async function buscarPainelHomologacao(
  buscar: typeof fetch = fetch,
): Promise<PainelHomologacao | null> {
  return (
    await ler(
      await buscar('/api/config/homologacao', { headers: { accept: 'application/json' } }),
      z.object({ painel: esquemaPainelHomologacao.nullable() }),
    )
  ).painel;
}

/** Triggers do catálogo não vistos no rastreamento e os vistos fora do catálogo (cenário controlado). */
export function conferirTriggers(t: PainelHomologacao['operacoes'][number]['triggers']): {
  ausentes: string[];
  aMais: string[];
} {
  if (t.vistos === null) return { ausentes: [], aMais: [] };
  const vistos = new Set(t.vistos);
  const catalogo = new Set(t.catalogo);
  return {
    ausentes: t.catalogo.filter((x) => !vistos.has(x)),
    aMais: t.vistos.filter((x) => !catalogo.has(x)),
  };
}

// M04: conferência de gravação e saúde das conexões (só leitura).
export async function buscarPainelGravacao(buscar: typeof fetch = fetch): Promise<PainelGravacao> {
  return ler(
    await buscar('/api/config/gravacao', { headers: { accept: 'application/json' } }),
    esquemaPainelGravacao,
  );
}

export async function buscarPainelConexoes(buscar: typeof fetch = fetch): Promise<PainelConexoes> {
  return ler(
    await buscar('/api/config/conexoes', { headers: { accept: 'application/json' } }),
    esquemaPainelConexoes,
  );
}

/** Total de colisões de uma linha (todas as horas). */
export function totalColisoes(porHora: Readonly<Record<string, number>>): number {
  return Object.values(porHora).reduce((a, b) => a + b, 0);
}

// M35: prontidão por setor (aba da tela de assinaturas) e a carga somada (tela de conexões): o relatório gerado.
const esquemaRespostaProntidao = z.object({ relatorio: esquemaRelatorioProntidao.nullable() });
const esquemaRespostaCarga = z.object({ carga: esquemaCargaProntidao.nullable() });

export async function buscarProntidao(buscar: typeof fetch = fetch): Promise<RelatorioProntidao | null> {
  return (
    await ler(
      await buscar('/api/config/prontidao', { headers: { accept: 'application/json' } }),
      esquemaRespostaProntidao,
    )
  ).relatorio;
}

export async function buscarCarga(buscar: typeof fetch = fetch): Promise<CargaProntidao | null> {
  return (
    await ler(
      await buscar('/api/config/carga', { headers: { accept: 'application/json' } }),
      esquemaRespostaCarga,
    )
  ).carga;
}

/** Setores de um estabelecimento agrupados por onda (0 a 5), na ordem. */
export function setoresPorOnda(
  h: RelatorioProntidao['hospitais'][number],
): { onda: number; setores: RelatorioProntidao['hospitais'][number]['setores'] }[] {
  const ondas = [...new Set(h.setores.map((s) => s.onda))].sort((a, b) => a - b);
  return ondas.map((onda) => ({ onda, setores: h.setores.filter((s) => s.onda === onda) }));
}

/** Contagem para exibir: abaixo de 5 vira "<5"; sem medida, travessão. */
export function contagemExibida(n: number | null, menorQue5: boolean): string {
  if (menorQue5) return '<5';
  return n === null ? '—' : String(n);
}
