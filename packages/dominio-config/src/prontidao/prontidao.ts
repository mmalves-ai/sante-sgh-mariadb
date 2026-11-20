// Prontidão por setor e hospital (ficha do M35, regras 1, 2, 5, 6, 7 e 8; cap-15 §15.2.1, §15.3.2, §15.3.3,
// §15.4.1, §15.5). Regras puras: o veredito de cada setor a partir do estado das operações no catálogo, do quadro
// de marcos, da carga somada e do material de treinamento; o público por papel a partir da contagem agregada por
// grupo; a proposta das ondas 0 e 1. "Pronto para homologar" não é liberação: nenhuma chave é ligada aqui.
import {
  type CargaProntidao,
  type DefinicaoSetor,
  type EstadoOperacao,
  type HospitalProntidao,
  type PublicoPapel,
  type SetorProntidao,
  type SituacaoItemProntidao,
  PAPEIS,
  SEM_GRUPO,
  SETORES_PRONTIDAO,
  operacoesDoSetor,
} from '@sgh/contratos';

/** Estado de uma operação do catálogo num estabelecimento, com o motivo quando não está em `verde`. */
export interface OperacaoNoHospital {
  readonly nome: string;
  readonly estado: EstadoOperacao;
  readonly motivo: string;
}

const VERDE: readonly EstadoOperacao[] = ['verde', 'conferida', 'liberada'];

/** Status de um marco no quadro do ESTADO.md: construído (aceito ou aguardando validação) ou não. */
export function marcoConstruido(status: string | undefined): boolean {
  return status !== undefined && /^(aceito|aguardando-validacao)/.test(status.trim());
}

/** Lê o quadro de marcos do ESTADO.md (`| M28 | 3 | D | pendente | … |`). */
export function lerQuadroMarcos(texto: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const l of texto.split('\n')) {
    const m = /^\|\s*(M\d{2})\s*\|\s*\d\s*\|[^|]*\|\s*([^|]+?)\s*\|/.exec(l);
    if (m?.[1] && m[2] && !(m[1] in r)) r[m[1]] = m[2];
  }
  return r;
}

/** Chave do grupo (sem acento, maiúsculas, espaços simples), como o mapa dos grupos do M06. */
export function chaveDoGrupo(nome: string): string {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Contagem para exibir: abaixo de 5 vira "<5" (nunca o número exato de poucas pessoas). */
export function contagemSegura(n: number | null): string {
  if (n === null) return '—';
  return n > 0 && n < 5 ? '<5' : String(n);
}

const pequeno = (n: number | null) => n !== null && n > 0 && n < 5;

/**
 * Público por papel (cap-15 §15.4.1): a soma dos grupos de cada papel na contagem agregada do banco; o grupo
 * contado que nenhum papel nomeia entra em "Outros" (a soma fecha com o total). Sem medida (sem a cópia), só as
 * referências.
 */
export function publicoPorPapel(
  porGrupo: Readonly<Record<string, number>> | null,
  guiasPorPapel: Readonly<Record<string, number>>,
): PublicoPapel[] {
  const medida = new Map<string, number>();
  for (const [g, n] of Object.entries(porGrupo ?? {}))
    medida.set(chaveDoGrupo(g), (medida.get(chaveDoGrupo(g)) ?? 0) + n);
  const nomeados = new Set(PAPEIS.flatMap((p) => p.grupos.map(chaveDoGrupo)));
  const avulsos = [...medida.keys()].filter((g) => !nomeados.has(g)).sort();
  return PAPEIS.map((p) => {
    const grupos = p.id === 'outros' ? [...p.grupos, ...avulsos] : [...p.grupos];
    const parcelas = grupos.map((g) => {
      const n = porGrupo ? (medida.get(chaveDoGrupo(g)) ?? 0) : null;
      return {
        grupo: g,
        usuarios: pequeno(n) ? null : n,
        menorQue5: pequeno(n),
        referencia: p.referencia[g] ?? null,
      };
    });
    const soma = porGrupo ? grupos.reduce((t, g) => t + (medida.get(chaveDoGrupo(g)) ?? 0), 0) : null;
    return {
      papel: p.id,
      nome: p.nome,
      usuarios: pequeno(soma) ? null : soma,
      menorQue5: pequeno(soma),
      referencia: Object.values(p.referencia).reduce((t, n) => t + n, 0),
      parcelas,
      ondas: [...p.ondas],
      cargaHoraria: p.cargaHoraria,
      guias: guiasPorPapel[p.id] ?? 0,
    };
  });
}

export interface EntradaSetor {
  readonly setor: DefinicaoSetor;
  readonly operacoes: readonly OperacaoNoHospital[];
  readonly marcos: Readonly<Record<string, string>>;
  readonly carga: CargaProntidao | null;
  readonly guiasPorPapel: Readonly<Record<string, number>>;
  /**
   * Guias por papel e por onda da tarefa (regra 5: treinamento por papel e por onda). Com ele, o item treinamento do
   * setor conta só os guias dos papéis do setor com onda da tarefa ≤ onda do setor (o setor de consultas da onda 0
   * não soma os guias de prescrever ou de checar da onda 2). Sem ele, todos os guias do papel contam.
   */
  readonly guiasPorPapelOnda?: Readonly<Record<string, Readonly<Record<number, number>>>>;
  /** Motivo do bloqueio do estabelecimento inteiro (HS-1), ou null. */
  readonly bloqueio: string | null;
}

/** Guias que treinam o setor: dos papéis dele e, com a onda das tarefas, só das ondas até a do setor (regra 5). */
export function guiasDoSetor(
  setor: Pick<DefinicaoSetor, 'papeis' | 'onda'>,
  guiasPorPapel: Readonly<Record<string, number>>,
  guiasPorPapelOnda?: Readonly<Record<string, Readonly<Record<number, number>>>>,
): number {
  if (!guiasPorPapelOnda) return setor.papeis.reduce((t, p) => t + (guiasPorPapel[p] ?? 0), 0);
  return setor.papeis.reduce(
    (t, p) =>
      t +
      Object.entries(guiasPorPapelOnda[p] ?? {})
        .filter(([onda]) => Number(onda) <= setor.onda)
        .reduce((u, [, n]) => u + n, 0),
    0,
  );
}

const ordemMarco = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));

/** Veredito e lista do cap-15 §15.3.2 de um setor num estabelecimento. */
export function avaliarSetor(e: EntradaSetor): SetorProntidao {
  const { setor } = e;
  const nomes = operacoesDoSetor(
    setor,
    e.operacoes.map((o) => o.nome),
  );
  const ops = e.operacoes.filter((o) => nomes.includes(o.nome));
  const fora = ops
    .filter((o) => !VERDE.includes(o.estado))
    .map((o) => ({ nome: o.nome, estado: o.estado, motivo: o.motivo || 'sem motivo registrado' }));
  const marcos = setor.marcos.map((m) => ({ marco: m, status: e.marcos[m] ?? 'pendente' }));
  const pendentes = marcos
    .filter((m) => !marcoConstruido(m.status))
    .map((m) => m.marco)
    .sort(ordemMarco);
  const faltam = e.carga?.metasNaoMedidas ?? [];
  const guias = guiasDoSetor(setor, e.guiasPorPapel, e.guiasPorPapelOnda);
  const item = (
    it: SetorProntidao['itens'][number]['item'],
    situacao: SituacaoItemProntidao,
    detalhe: string,
  ) => ({
    item: it,
    situacao: e.bloqueio ? ('bloqueado' as const) : situacao,
    detalhe: e.bloqueio ? e.bloqueio : detalhe,
  });
  const itens: SetorProntidao['itens'] = [
    item(
      'construcao',
      pendentes.length ? 'nao-atendido' : 'atendido',
      pendentes.length
        ? `em construção: ${pendentes.join(', ')} (continua na Fase 4, cap-15 §15.5)`
        : `construído: ${marcos.map((m) => m.marco).join(', ')}`,
    ),
    item(
      'operacoes',
      ops.length === 0 ? 'atendido' : fora.length ? 'com-ressalva' : 'atendido',
      ops.length === 0
        ? 'só leitura: basta a conferência do chave-usuário (cap-15 §15.3.1)'
        : `${ops.length - fora.length} de ${ops.length} verdes na cópia; ${fora.length} fora da liberação com o motivo`,
    ),
    item('aceite', 'fase4', 'aceite do chave-usuário na homologação (DP-3; pacote do setor pronto)'),
    item(
      'treinamento',
      guias > 0 ? 'fase4' : 'nao-atendido',
      guias > 0
        ? `${guias} guia(s) gerado(s) das jornadas automáticas; a trilha dos usuários é da Fase 4 (M37)`
        : 'sem jornada automática para gerar o guia (o setor não está construído)',
    ),
    item('estacoes', 'fase4', 'estações, impressoras de etiqueta e leitores conferidos pela TI'),
    item(
      'carga',
      e.carga === null || e.carga.resultado !== 'verde'
        ? 'nao-atendido'
        : faltam.length
          ? 'com-ressalva'
          : 'atendido',
      e.carga === null
        ? 'sem medição da carga somada'
        : `${e.carga.cenario} com ${e.carga.usuarios} usuários: ${e.carga.resultado}${e.carga.indicativo ? ' (indicativo, DP-15; o limite é aceito pela TI na Fase 4)' : ''}${faltam.length ? `; parcial: metas não medidas: ${faltam.map((m) => `${m.meta} (${m.alvo})`).join('; ')}` : ''}`,
    ),
    item('apoio', 'fase4', 'apoio no setor nos primeiros dias e canal de chamados aberto'),
    item('pentest', 'fase4', 'teste de invasão externo antes da primeira liberação (M36)'),
  ];
  const veredito: SetorProntidao['veredito'] = e.bloqueio
    ? 'bloqueado'
    : pendentes.length
      ? 'nao-construido'
      : fora.length
        ? 'pronto-com-ressalvas'
        : 'pronto-para-homologar';
  return {
    id: setor.id,
    nome: setor.nome,
    onda: setor.onda,
    veredito,
    marcos,
    operacoes: { total: ops.length, verdes: ops.length - fora.length, fora },
    leituras: [...setor.leituras],
    recursos: [...setor.recursos],
    itens,
    duvidas: [...setor.duvidas],
    ordemFase4: pendentes,
  };
}

export interface EntradaHospital {
  readonly codigo: string;
  readonly nome: string;
  readonly bloqueio: string | null;
  readonly operacoes: readonly OperacaoNoHospital[];
  readonly marcos: Readonly<Record<string, string>>;
  readonly carga: CargaProntidao | null;
  readonly porGrupo: Readonly<Record<string, number>> | null;
  readonly guiasPorPapel: Readonly<Record<string, number>>;
  /** Guias por papel e por onda da tarefa (ver EntradaSetor.guiasPorPapelOnda). */
  readonly guiasPorPapelOnda?: Readonly<Record<string, Readonly<Record<number, number>>>>;
  readonly chaves: { readonly preparadas: number; readonly ligadas: number } | null;
  readonly setores?: readonly DefinicaoSetor[];
}

const pronto = (s: SetorProntidao) =>
  s.veredito === 'pronto-para-homologar' || s.veredito === 'pronto-com-ressalvas';

/** O relatório de um estabelecimento: setores, público, chaves preparadas e a proposta das ondas 0 e 1. */
export function avaliarHospital(e: EntradaHospital): HospitalProntidao {
  const setores = (e.setores ?? SETORES_PRONTIDAO).map((setor) =>
    avaliarSetor({
      setor,
      operacoes: e.operacoes,
      marcos: e.marcos,
      carga: e.carga,
      guiasPorPapel: e.guiasPorPapel,
      ...(e.guiasPorPapelOnda ? { guiasPorPapelOnda: e.guiasPorPapelOnda } : {}),
      bloqueio: e.bloqueio,
    }),
  );
  const publico = publicoPorPapel(e.bloqueio ? null : e.porGrupo, e.guiasPorPapel);
  const iniciais = setores.filter((s) => s.onda <= 1);
  const foraDaProposta = iniciais
    .filter((s) => !pronto(s))
    .map((s) => ({
      setor: s.id,
      motivo:
        s.veredito === 'bloqueado'
          ? `${e.bloqueio ?? ''}`.trim() || 'sem a cópia'
          : `em construção: ${s.ordemFase4.join(', ')}`,
    }));
  return {
    codigo: e.codigo,
    nome: e.nome,
    bloqueio: e.bloqueio,
    setores,
    publico,
    publicoTotal: e.bloqueio || !e.porGrupo ? null : Object.values(e.porGrupo).reduce((t, n) => t + n, 0),
    chavesPreparadas: e.chaves?.preparadas ?? null,
    chavesLigadas: e.chaves?.ligadas ?? null,
    proposta: {
      onda0: iniciais.filter((s) => s.onda === 0 && pronto(s)).map((s) => s.id),
      onda1: iniciais.filter((s) => s.onda === 1 && pronto(s)).map((s) => s.id),
      foraDaProposta,
    },
  };
}

/** Chaves de liberação a preparar no estabelecimento: recurso × grupo dos papéis do setor (todas desligadas). */
export function chavesAPreparar(
  setores: readonly DefinicaoSetor[] = SETORES_PRONTIDAO,
): { readonly recurso: string; readonly grupos: readonly string[]; readonly setores: readonly string[] }[] {
  const porRecurso = new Map<string, { grupos: Set<string>; setores: Set<string> }>();
  for (const s of setores) {
    const grupos = PAPEIS.filter((p) => s.papeis.includes(p.id))
      .flatMap((p) => p.grupos)
      .filter((g) => g !== SEM_GRUPO);
    for (const r of s.recursos) {
      const x = porRecurso.get(r) ?? { grupos: new Set<string>(), setores: new Set<string>() };
      for (const g of grupos) x.grupos.add(g);
      x.setores.add(s.id);
      porRecurso.set(r, x);
    }
  }
  return [...porRecurso.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([recurso, x]) => ({ recurso, grupos: [...x.grupos].sort(), setores: [...x.setores].sort() }));
}
