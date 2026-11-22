// Linha de conector_execucao -> ExecucaoConector (só agregados). Os contadores vêm do motor; daqui sai uma lista
// branca de campos: contagens por entidade de destino e pendências por entidade/regra/gravidade.
import type { ExecucaoConector, RelatorioConector } from '@sgh/contratos';
import { ESTADOS_EXECUCAO_CONECTOR, TIPOS_EXECUCAO_CONECTOR, esquemaRelatorioConector } from '@sgh/contratos';

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? new Date(String(v).replace(' ', 'T') + 'Z').toISOString() : null;
const GRAVIDADES = ['critica', 'alta', 'media', 'baixa'] as const;

function sincronizarDe(bruto: unknown): ExecucaoConector['sincronizar'] {
  if (!bruto || typeof bruto !== 'object') return null;
  const s = bruto as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    atualizadas: num(s['atualizadas']),
    conflitos: num(s['conflitos']),
    excluidas: num(s['excluidas']),
    reativadas: num(s['reativadas']),
    exclusoesSemSuporte: num(s['exclusoes_sem_suporte']),
    // lista branca: a entidade de destino, nunca a tabela da origem
    alertasExclusaoEmMassa: lista(s['alertas_exclusao_em_massa']).map((a) => ({
      entidade: String(a['entidade'] ?? ''),
      apagadas: num(a['apagadas']),
      ativas: num(a['ativas']),
    })),
    conflitosItens: lista(s['conflitos_itens']).map((x) => ({
      tabelaDestino: String(x['tabela_destino'] ?? ''),
      idDestino: num(x['id_destino']),
      colunas: (Array.isArray(x['colunas']) ? x['colunas'] : []).map(String),
    })),
  };
}

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
    sincronizar: sincronizarDe(c['sincronizar']),
    relatorio: relatorioDe(c['relatorio']),
  };
}

/** L10: o relatório do motor passa pelo contrato (lista branca); fora dele, nenhum. */
function relatorioDe(bruto: unknown): RelatorioConector | null {
  const r = esquemaRelatorioConector.safeParse(bruto);
  return r.success ? r.data : null;
}

export interface FiltroRelatorio {
  entidade?: string | undefined;
  regra?: string | undefined;
}

/** Filtro por entidade e regra (painel e exportação): pendências por regra, decisões do cliente e recusados. */
export function filtrarRelatorio(r: RelatorioConector, f: FiltroRelatorio): RelatorioConector {
  const ent = f.entidade?.trim() || null;
  const reg = f.regra?.trim() || null;
  if (!ent && !reg) return r;
  const porRegra = r.porRegra.filter((p) => (!ent || p.entidade === ent) && (!reg || p.regra === reg));
  const decisoes = new Map<string, RelatorioConector['decisoesCliente'][number]>();
  for (const p of porRegra) {
    if (p.decisao !== 'cliente' || !p.abertas) continue;
    const base = r.decisoesCliente.find((d) => d.regra === p.regra);
    const d = decisoes.get(p.regra) ?? {
      regra: p.regra,
      gravidade: p.gravidade,
      quantidade: 0,
      entidades: 0,
      acao: base?.acao ?? p.acao,
    };
    d.quantidade += p.abertas;
    d.entidades += 1;
    decisoes.set(p.regra, d);
  }
  return {
    ...r,
    porRegra,
    decisoesCliente: [...decisoes.values()],
    naoCarregado: {
      ...r.naoCarregado,
      recusados: r.naoCarregado.recusados.filter((x) => !ent || x.entidade === ent),
    },
  };
}

const GRAV_TXT: Record<string, string> = { critica: 'crítica', alta: 'alta', media: 'média', baixa: 'baixa' };
const csv = (v: unknown): string => {
  const t = String(v ?? '');
  // célula que começa por = + - @ seria fórmula na planilha: prefixada por apóstrofo
  const s = /^[=+\-@]/.test(t) ? `'${t}` : t;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Exportação do relatório em CSV (separador `;`, UTF-8 com BOM para a planilha): uma seção por bloco. */
export function relatorioCsv(e: ExecucaoConector, f: FiltroRelatorio = {}): string {
  const linhas: unknown[][] = [];
  const r = e.relatorio ? filtrarRelatorio(e.relatorio, f) : null;
  linhas.push(['secao', 'execucao', 'tipo', 'estado', 'concluida_em']);
  linhas.push(['execucao', e.id, e.tipo, e.estado, e.concluidoEm ?? '']);
  if (r) {
    const t = r.totais;
    linhas.push([]);
    linhas.push([
      'secao',
      'entidades',
      'conferidas',
      'registros_origem',
      'registros_destino',
      'recusados',
      'pendencias_abertas',
      'criticas',
      'resolvidas',
      'decisoes_cliente',
      'saidas_externas',
    ]);
    linhas.push([
      'totais',
      t.entidades,
      t.conferidas,
      t.registrosOrigem,
      t.registrosDestino,
      t.recusados,
      t.abertas,
      t.criticas,
      t.resolvidas,
      t.decisoesCliente,
      r.saidasExternas,
    ]);
  }
  linhas.push([]);
  linhas.push(['secao', 'entidade', 'registros_origem', 'registros_destino', 'recusados', 'conferido']);
  for (const x of e.entidades.filter((x) => !f.entidade || x.entidade === f.entidade))
    linhas.push([
      'entidade',
      x.entidade,
      x.registrosOrigem,
      x.registrosDestino,
      x.recusados,
      x.conferido ? 'sim' : 'não',
    ]);
  if (r) {
    linhas.push([]);
    linhas.push(['secao', 'entidade', 'regra', 'gravidade', 'abertas', 'resolvidas', 'decisao', 'acao']);
    for (const p of r.porRegra)
      linhas.push([
        'pendencia',
        p.entidade,
        p.regra,
        GRAV_TXT[p.gravidade],
        p.abertas,
        p.resolvidas,
        p.decisao,
        p.acao,
      ]);
    linhas.push([]);
    linhas.push(['secao', 'regra', 'gravidade', 'quantidade', 'entidades', 'acao']);
    for (const d of r.decisoesCliente)
      linhas.push(['decisao_cliente', d.regra, GRAV_TXT[d.gravidade], d.quantidade, d.entidades, d.acao]);
    linhas.push([]);
    linhas.push([
      'secao',
      'causa',
      'tabelas',
      'registros',
      'provas_conferidas',
      'provas_falhas',
      'sem_prova',
    ]);
    linhas.push([
      'nao_carregado',
      'fora_do_mapa',
      r.naoCarregado.semMapa.tabelas,
      r.naoCarregado.semMapa.registros,
    ]);
    linhas.push([
      'nao_carregado',
      'bloqueada',
      r.naoCarregado.bloqueadas.tabelas,
      r.naoCarregado.bloqueadas.registros,
    ]);
    for (const c of r.naoCarregado.semCarga)
      linhas.push([
        'nao_carregado',
        c.causa,
        c.tabelas,
        c.registros,
        c.provasConferidas,
        c.provasFalhas,
        c.semProva,
      ]);
    for (const x of r.naoCarregado.recusados) linhas.push(['recusados', x.entidade, '', x.recusados]);
    linhas.push([]);
    linhas.push([
      'secao',
      'destino',
      'causa',
      'tipo',
      'linhas_origem',
      'iguais',
      'divergentes',
      'faltando',
      'sobrando',
      'conferido',
    ]);
    for (const p of r.provas)
      linhas.push([
        'prova',
        p.destino,
        p.causa,
        p.tipo,
        p.linhasOrigem,
        p.iguais,
        p.divergentes,
        p.faltandoNoDestino,
        p.sobrandoNoDestino,
        p.conferido ? 'sim' : 'não',
      ]);
  }
  return '\uFEFF' + linhas.map((l) => l.map(csv).join(';')).join('\r\n') + '\r\n';
}
