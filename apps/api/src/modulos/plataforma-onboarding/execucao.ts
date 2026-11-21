// Linha de conector_execucao -> ExecucaoConector (só agregados). Os contadores vêm do motor; daqui sai uma lista
// branca de campos: contagens por entidade de destino e pendências por entidade/regra/gravidade.
import type { ExecucaoConector } from '@sgh/contratos';
import { ESTADOS_EXECUCAO_CONECTOR, TIPOS_EXECUCAO_CONECTOR } from '@sgh/contratos';

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? new Date(String(v).replace(' ', 'T') + 'Z').toISOString() : null;
const GRAVIDADES = ['critica', 'alta', 'media', 'baixa'] as const;

export function execucaoDaLinha(l: Record<string, unknown>): ExecucaoConector {
  let c: Record<string, unknown>;
  try {
    const bruto = l['contadores'];
    c = (typeof bruto === 'string' ? JSON.parse(bruto) : (bruto ?? {})) as Record<string, unknown>;
  } catch {
    c = {};
  }
  const ents = (c['entidades'] ?? {}) as Record<string, Record<string, unknown>>;
  const pend = (c['pendencias'] ?? {}) as Record<string, unknown>;
  const porRegra = Object.entries((pend['por_regra'] ?? {}) as Record<string, unknown>)
    .map(([k, q]) => {
      const [entidade = '', regra = '', gravidade = ''] = k.split(':');
      return { entidade, regra, gravidade, quantidade: num(q) };
    })
    .filter((p): p is ExecucaoConector['pendencias']['porRegra'][number] =>
      (GRAVIDADES as readonly string[]).includes(p.gravidade),
    )
    .sort(
      (a, b) =>
        GRAVIDADES.indexOf(a.gravidade) - GRAVIDADES.indexOf(b.gravidade) || b.quantidade - a.quantidade,
    );
  const estado = String(l['estado']);
  const tipo = String(l['tipo']);
  return {
    id: num(l['id']),
    tipo: (TIPOS_EXECUCAO_CONECTOR as readonly string[]).includes(tipo)
      ? (tipo as ExecucaoConector['tipo'])
      : 'importar',
    estado: (ESTADOS_EXECUCAO_CONECTOR as readonly string[]).includes(estado)
      ? (estado as ExecucaoConector['estado'])
      : 'falhou',
    etapa: l['etapa'] == null ? null : String(l['etapa']),
    percentual: num(l['percentual']),
    motivoFalha: l['motivo_falha'] == null ? null : String(l['motivo_falha']),
    solicitadoEm: iso(l['solicitado_em']),
    iniciadoEm: iso(l['iniciado_em']),
    concluidoEm: iso(l['concluido_em']),
    registrosLidos: c['registros_lidos'] == null ? null : num(c['registros_lidos']),
    arquivoInalterado: c['arquivo_inalterado'] == null ? null : c['arquivo_inalterado'] === true,
    entidades: Object.entries(ents)
      .map(([entidade, e]) => ({
        entidade,
        registrosOrigem: num(e['registros_origem']),
        registrosDestino: num(e['registros_destino']),
        recusados: num(e['recusados']),
        conferido: e['conferido'] === true,
      }))
      .sort((a, b) => a.entidade.localeCompare(b.entidade)),
    pendencias: { total: num(pend['total']), criticas: num(pend['criticas']), porRegra },
  };
}
