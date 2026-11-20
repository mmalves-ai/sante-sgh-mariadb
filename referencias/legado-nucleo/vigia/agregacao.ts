// Coletor MON$ do Firebird (regra 13 da ficha do M09; cap-09 §9.11, cap-10 §10.11): agregados por sistema
// (novo, SPDATA, sante-api, outros) e por conexão do novo, OIT/OAT/OST, transações longas e alertas. Esta
// parte é pura (classificação e agregação); a leitura das tabelas MON$ fica em coletor.ts. Nunca guarda nem
// devolve o texto SQL de outra conexão, nem o usuário do banco: só contagens, idades e o identificador do
// anexo (MON$ATTACHMENT_ID), que é o que o alerta precisa para apontar a conexão responsável.

export type Sistema = 'novo' | 'spdata' | 'spdata-simulado' | 'sante-api' | 'outros';
export const SISTEMAS: readonly Sistema[] = ['novo', 'spdata', 'spdata-simulado', 'sante-api', 'outros'];

export interface AnexoMon {
  readonly id: number;
  /** MON$REMOTE_PROCESS (caminho do executável do cliente). Usado só para classificar. */
  readonly processo: string | null;
  /** Valor de USER_SESSION.SGH_SISTEMA (marca das conexões do novo). */
  readonly marca: string | null;
  readonly propria: boolean;
}

export interface TransacaoMon {
  readonly anexo: number;
  readonly somenteLeitura: boolean;
  readonly idadeMs: number;
  readonly propria: boolean;
}

export interface ComandoMon {
  readonly anexo: number;
  /** MON$STATE: 0 ocioso, 1 ativo, 2 parado (stalled). */
  readonly estado: number;
  readonly idadeMs: number;
}

/**
 * Contadores de registro por anexo (MON$RECORD_STATS pelo MON$STAT_ID do anexo; acumulados desde a abertura
 * da conexão): travas de registro pedidas, esperas por trava e conflitos de atualização.
 */
export interface TravasMon {
  readonly anexo: number;
  readonly travas: number;
  readonly esperas: number;
  readonly conflitos: number;
}

export interface BancoMon {
  readonly oit: number;
  readonly oat: number;
  readonly ost: number;
  readonly proxima: number;
}

export interface LeituraMon {
  readonly banco: BancoMon;
  readonly anexos: readonly AnexoMon[];
  readonly transacoes: readonly TransacaoMon[];
  readonly comandos: readonly ComandoMon[];
  /** Ausente em leituras antigas (sem MON$RECORD_STATS): contadores zerados. */
  readonly travas?: readonly TravasMon[];
}

export interface AgregadoSistema {
  readonly sistema: Sistema;
  readonly conexoes: number;
  readonly transacoes: number;
  readonly transacoesEscrita: number;
  /** MON$STATE = 1 (executando). */
  readonly comandosAtivos: number;
  /** MON$STATE = 2 (parado: o cliente não buscou o resto do cursor), contado em separado. */
  readonly comandosParados: number;
  readonly transacaoMaisLongaMs: number;
  /** Soma por sistema de MON$RECORD_LOCKS, MON$RECORD_WAITS e MON$RECORD_CONFLICTS (acumulados). */
  readonly travas: number;
  readonly esperasPorTrava: number;
  readonly conflitos: number;
}

export interface ConexaoNovo {
  readonly anexo: number;
  readonly marca: string;
  readonly transacoes: number;
  /** Transações de escrita da conexão (separa o processo medido dos outros processos do novo). */
  readonly transacoesEscrita: number;
  readonly transacaoMaisLongaMs: number;
}

export type TipoAlerta = 'transacao-longa' | 'schema-reprovado' | 'assinatura-divergente';

export interface Alerta {
  readonly tipo: TipoAlerta;
  readonly estabelecimento: string;
  /** Conexão responsável (MON$ATTACHMENT_ID) quando o alerta é de transação. */
  readonly anexo: number | null;
  readonly marca: string | null;
  readonly duracaoMs: number | null;
  readonly detalhe: string;
}

export interface Coleta {
  readonly estabelecimento: string;
  readonly em: string;
  readonly duracaoMs: number;
  readonly banco: BancoMon & {
    /** Próxima − OIT: transações que o coletor de lixo ainda não pode limpar. */
    readonly folgaOit: number;
    readonly folgaOat: number;
  };
  readonly porSistema: readonly AgregadoSistema[];
  readonly conexoesDoNovo: readonly ConexaoNovo[];
  readonly alertas: readonly Alerta[];
}

/** Classificação da conexão: a marca do novo vem primeiro; depois o executável do cliente. */
export function classificarAnexo(a: Pick<AnexoMon, 'processo' | 'marca'>): Sistema {
  const marca = a.marca?.trim();
  if (marca?.startsWith('legado-simulado')) return 'spdata-simulado';
  if (marca?.startsWith('sgh:')) return 'novo';
  const p = (a.processo ?? '').trim();
  if (/\.exe$/i.test(p)) return 'spdata';
  if (/(^|[\\/])node(js)?(\.exe)?$/i.test(p)) return 'sante-api';
  return 'outros';
}

export interface OpcoesAgregacao {
  readonly estabelecimento: string;
  /** Limite de transação do novo; acima dele, alerta direto (parâmetro VIGIA_TRANSACAO_LIMITE_MS). */
  readonly limiteTransacaoMs: number;
  readonly em: string;
  readonly duracaoMs: number;
  /** Alertas que vêm de fora do MON$ (schema-check, teste de assinatura do M03). */
  readonly alertasExternos?: readonly Alerta[];
}

export function agregar(l: LeituraMon, o: OpcoesAgregacao): Coleta {
  const sistemaDe = new Map<number, Sistema>();
  const marcaDe = new Map<number, string>();
  for (const a of l.anexos) {
    if (a.propria) continue;
    sistemaDe.set(a.id, classificarAnexo(a));
    if (a.marca) marcaDe.set(a.id, a.marca);
  }
  const base = () => ({
    conexoes: 0,
    transacoes: 0,
    transacoesEscrita: 0,
    comandosAtivos: 0,
    comandosParados: 0,
    transacaoMaisLongaMs: 0,
    travas: 0,
    esperasPorTrava: 0,
    conflitos: 0,
  });
  const porSistema = new Map<Sistema, ReturnType<typeof base>>(SISTEMAS.map((s) => [s, base()]));
  for (const s of sistemaDe.values()) porSistema.get(s)!.conexoes++;
  const porNovo = new Map<number, { transacoes: number; escrita: number; maisLonga: number }>();
  for (const [id, s] of sistemaDe)
    if (s === 'novo') porNovo.set(id, { transacoes: 0, escrita: 0, maisLonga: 0 });
  for (const t of l.transacoes) {
    if (t.propria) continue;
    const s = sistemaDe.get(t.anexo);
    if (!s) continue;
    const ag = porSistema.get(s)!;
    ag.transacoes++;
    if (!t.somenteLeitura) ag.transacoesEscrita++;
    ag.transacaoMaisLongaMs = Math.max(ag.transacaoMaisLongaMs, t.idadeMs);
    const n = porNovo.get(t.anexo);
    if (n) {
      n.transacoes++;
      if (!t.somenteLeitura) n.escrita++;
      n.maisLonga = Math.max(n.maisLonga, t.idadeMs);
    }
  }
  for (const c of l.comandos) {
    const s = sistemaDe.get(c.anexo);
    if (!s) continue;
    if (c.estado === 1) porSistema.get(s)!.comandosAtivos++;
    else if (c.estado === 2) porSistema.get(s)!.comandosParados++;
  }
  for (const t of l.travas ?? []) {
    const s = sistemaDe.get(t.anexo);
    if (!s) continue;
    const ag = porSistema.get(s)!;
    ag.travas += t.travas;
    ag.esperasPorTrava += t.esperas;
    ag.conflitos += t.conflitos;
  }
  const conexoesDoNovo = [...porNovo].map(([anexo, n]) => ({
    anexo,
    marca: marcaDe.get(anexo) ?? '',
    transacoes: n.transacoes,
    transacoesEscrita: n.escrita,
    transacaoMaisLongaMs: n.maisLonga,
  }));
  const alertas: Alerta[] = conexoesDoNovo
    .filter((c) => c.transacaoMaisLongaMs > o.limiteTransacaoMs)
    .map((c) => ({
      tipo: 'transacao-longa',
      estabelecimento: o.estabelecimento,
      anexo: c.anexo,
      marca: c.marca,
      duracaoMs: c.transacaoMaisLongaMs,
      detalhe: `transação do novo aberta há ${Math.round(c.transacaoMaisLongaMs / 1000)} s (limite ${Math.round(o.limiteTransacaoMs / 1000)} s)`,
    }));
  alertas.push(...(o.alertasExternos ?? []));
  return {
    estabelecimento: o.estabelecimento,
    em: o.em,
    duracaoMs: o.duracaoMs,
    banco: { ...l.banco, folgaOit: l.banco.proxima - l.banco.oit, folgaOat: l.banco.proxima - l.banco.oat },
    porSistema: SISTEMAS.map((s) => ({ sistema: s, ...porSistema.get(s)! })),
    conexoesDoNovo,
    alertas,
  };
}

/** Alerta de schema-check reprovado (marca do núcleo diferente de "homologado"). */
export function alertaSchema(estabelecimento: string, estado: string | null): Alerta | null {
  if (estado === 'homologado') return null;
  return {
    tipo: 'schema-reprovado',
    estabelecimento,
    anexo: null,
    marca: null,
    duracaoMs: null,
    detalhe: `verificação de schema: ${estado ?? 'não verificada'}`,
  };
}
