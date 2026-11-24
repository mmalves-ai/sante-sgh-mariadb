// O processo de enfermagem (M45, etapa 4; regra 7; Res. COFEN 736/2024): cinco etapas — a avaliação, o diagnóstico com
// as características definidoras (diagnóstico real) ou os fatores de risco (diagnóstico de risco) e os fatores
// relacionados, o planejamento com o resultado esperado na escala de 1 a 5 e a meta ("aumentar para", "manter em",
// "diminuir para"), a implementação (a prescrição das atividades, ver prescricao-enfermagem.ts) e a evolução que
// reavalia a meta (ver evolucao.ts). Todo código vem da terminologia em uso e todo ponto da escala e meta, do domínio do
// estabelecimento; o valor nunca visto é recusado (regra 15). A conferência devolve o plano já com as descrições (o
// retrato que fica gravado).
import {
  type ClassificacaoMetaSae,
  type DiagnosticoTermoSae,
  type DominiosSae,
  type EtapaSae,
  ETAPAS_SAE,
  type IntervencaoTermoSae,
  type PontoEscalaSae,
  type ProcessoSaeLido,
  type RegistrarSaeEntrada,
  type SentidoMetaSae,
  type TerminologiaSae,
  type TermoSae,
} from '@sgh/contratos';

export interface RecusaSae {
  readonly ok: false;
  readonly codigo: string;
  readonly mensagem: string;
  readonly campo?: string;
}
const recusa = (codigo: string, mensagem: string, campo?: string): RecusaSae => ({
  ok: false,
  codigo,
  mensagem,
  ...(campo ? { campo } : {}),
});

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** O ponto da escala pelo rótulo do domínio: o primeiro número de 1 a 5; "não se aplica" (NA) é nulo. */
export function interpretarPontoEscala(rotulo: string): number | null {
  const r = sem(rotulo);
  if (/^n\.?\s*a\.?$|nao se aplica/.test(r)) return null;
  const m = /([1-5])/.exec(r);
  return m ? Number(m[1]) : null;
}

/** O sentido da meta pelo rótulo do domínio (aumentar para, manter em, diminuir para); nulo: rótulo nunca visto. */
export function interpretarMeta(rotulo: string): SentidoMetaSae | null {
  const r = sem(rotulo);
  if (/^aument/.test(r)) return 'aumentar';
  if (/^mant/.test(r)) return 'manter';
  if (/^dimin/.test(r)) return 'diminuir';
  return null;
}

/** Os domínios lidos (código e rótulo) já interpretados. */
export function dominiosDaSae(
  escala: readonly { readonly codigo: number; readonly rotulo: string }[],
  metas: readonly { readonly codigo: number; readonly rotulo: string }[],
): DominiosSae {
  return {
    escala: escala.map((p) => ({ ...p, valor: interpretarPontoEscala(p.rotulo) })),
    metas: metas.map((m) => ({ ...m, sentido: interpretarMeta(m.rotulo) })),
  };
}

/** Índice da terminologia por código (consulta rápida na conferência e na tela). */
export interface IndiceTerminologia {
  readonly diagnosticos: ReadonlyMap<string, DiagnosticoTermoSae>;
  readonly resultados: ReadonlyMap<string, TermoSae>;
  readonly intervencoes: ReadonlyMap<string, IntervencaoTermoSae>;
}
export function indexarTerminologia(t: TerminologiaSae): IndiceTerminologia {
  return {
    diagnosticos: new Map(t.diagnosticos.map((d) => [d.codigo, d])),
    resultados: new Map(t.resultados.map((r) => [r.codigo, r])),
    intervencoes: new Map(t.intervencoes.map((i) => [i.codigo, i])),
  };
}

/** O resultado esperado com a meta coerente: aumentar → meta acima de agora; manter → igual; diminuir → abaixo. */
export function metaCoerente(sentido: SentidoMetaSae, atual: number, meta: number): boolean {
  if (sentido === 'aumentar') return meta > atual;
  if (sentido === 'diminuir') return meta < atual;
  return meta === atual;
}

export interface ResultadoPlanejado {
  readonly codigo: string;
  readonly descricao: string;
  readonly escalaAtual: number;
  readonly meta: number;
  readonly escalaMeta: number;
}
export interface DiagnosticoPlanejado {
  readonly codigo: string;
  readonly descricao: string;
  readonly caracteristicas: readonly TermoSae[];
  readonly fatores: readonly TermoSae[];
  readonly resultados: readonly ResultadoPlanejado[];
  readonly intervencoes: readonly TermoSae[];
}
export interface ProcessoPlanejado {
  readonly ok: true;
  readonly avaliacao: string;
  readonly diagnosticos: readonly DiagnosticoPlanejado[];
}

function ponto(dominios: DominiosSae, codigo: number): PontoEscalaSae | undefined {
  return dominios.escala.find((p) => p.codigo === codigo);
}
function classificacao(dominios: DominiosSae, codigo: number): ClassificacaoMetaSae | undefined {
  return dominios.metas.find((m) => m.codigo === codigo);
}

/**
 * Regra 7: confere o processo (avaliação, diagnóstico e planejamento) contra a terminologia em uso e os domínios do
 * estabelecimento, e devolve o plano com as descrições. A versão vista tem de ser a vigente (outra gravada no meio:
 * recusa `sae-mudou`).
 */
export function conferirSae(
  e: RegistrarSaeEntrada,
  terminologia: TerminologiaSae,
  dominios: DominiosSae,
  versaoVigente: number,
): ProcessoPlanejado | RecusaSae {
  if (e.versaoVista !== versaoVigente)
    return recusa(
      'sae-mudou',
      'O processo de enfermagem deste paciente mudou depois da leitura (outra versão foi registrada): confira e registre de novo.',
    );
  const ix = indexarTerminologia(terminologia);
  const vistos = new Set<string>();
  const diagnosticos: DiagnosticoPlanejado[] = [];
  for (const [i, d] of e.diagnosticos.entries()) {
    const campo = `diagnosticos.${i}`;
    const termo = ix.diagnosticos.get(d.codigo);
    if (!termo)
      return recusa(
        'termo-desconhecido',
        `O diagnóstico ${d.codigo} não está na terminologia em uso.`,
        campo,
      );
    if (vistos.has(d.codigo))
      return recusa('diagnostico-repetido', 'O mesmo diagnóstico entrou duas vezes.', campo);
    vistos.add(d.codigo);
    const caracteristicas: TermoSae[] = [];
    for (const c of new Set(d.caracteristicas)) {
      const x = termo.caracteristicas.find((y) => y.codigo === c);
      if (!x)
        return recusa(
          'termo-desconhecido',
          `A característica ${c} não é do diagnóstico ${d.codigo}.`,
          `${campo}.caracteristicas`,
        );
      caracteristicas.push(x);
    }
    const fatores: TermoSae[] = [];
    for (const c of new Set(d.fatores)) {
      const x = termo.fatores.find((y) => y.codigo === c);
      if (!x)
        return recusa(
          'termo-desconhecido',
          `O fator ${c} não é do diagnóstico ${d.codigo}.`,
          `${campo}.fatores`,
        );
      fatores.push(x);
    }
    if (termo.risco) {
      if (caracteristicas.length > 0)
        return recusa(
          'diagnostico-de-risco',
          'Diagnóstico de risco não tem características definidoras: informe os fatores de risco.',
          `${campo}.caracteristicas`,
        );
      if (fatores.length === 0)
        return recusa(
          'sem-fator-de-risco',
          `Informe ao menos um fator de risco de "${termo.descricao}".`,
          `${campo}.fatores`,
        );
    } else if (caracteristicas.length === 0)
      return recusa(
        'sem-caracteristica',
        `Informe ao menos uma característica definidora de "${termo.descricao}".`,
        `${campo}.caracteristicas`,
      );
    const resultados: ResultadoPlanejado[] = [];
    const rVistos = new Set<string>();
    for (const [k, r] of d.resultados.entries()) {
      const cr = `${campo}.resultados.${k}`;
      const rt = ix.resultados.get(r.codigo);
      if (!rt)
        return recusa('termo-desconhecido', `O resultado ${r.codigo} não está na terminologia em uso.`, cr);
      if (rVistos.has(r.codigo))
        return recusa('resultado-repetido', 'O mesmo resultado entrou duas vezes.', cr);
      rVistos.add(r.codigo);
      const atual = ponto(dominios, r.escalaAtual);
      const alvo = ponto(dominios, r.escalaMeta);
      const meta = classificacao(dominios, r.meta);
      if (!atual || !alvo || !meta)
        return recusa('valor-nunca-visto', 'Ponto da escala ou meta fora do domínio do estabelecimento.', cr);
      if (atual.valor === null || alvo.valor === null)
        return recusa(
          'escala-nao-se-aplica',
          'O resultado esperado precisa de um ponto de 1 a 5, agora e na meta.',
          cr,
        );
      if (meta.sentido === null)
        return recusa('valor-nunca-visto', `A classificação da meta "${meta.rotulo}" não é reconhecida.`, cr);
      if (!metaCoerente(meta.sentido, atual.valor, alvo.valor))
        return recusa(
          'meta-incoerente',
          `A meta "${meta.rotulo} ${alvo.valor}" não combina com o ponto de agora (${atual.valor}).`,
          cr,
        );
      resultados.push({
        codigo: rt.codigo,
        descricao: rt.descricao,
        escalaAtual: atual.codigo,
        meta: meta.codigo,
        escalaMeta: alvo.codigo,
      });
    }
    const intervencoes: TermoSae[] = [];
    for (const [k, iv] of d.intervencoes.entries()) {
      const it = ix.intervencoes.get(iv.codigo);
      if (!it)
        return recusa(
          'termo-desconhecido',
          `A intervenção ${iv.codigo} não está na terminologia em uso.`,
          `${campo}.intervencoes.${k}`,
        );
      if (intervencoes.some((x) => x.codigo === it.codigo))
        return recusa('intervencao-repetida', 'A mesma intervenção entrou duas vezes no diagnóstico.', campo);
      intervencoes.push({ codigo: it.codigo, descricao: it.descricao });
    }
    diagnosticos.push({
      codigo: termo.codigo,
      descricao: termo.descricao,
      caracteristicas,
      fatores,
      resultados,
      intervencoes,
    });
  }
  return { ok: true, avaliacao: e.avaliacao, diagnosticos };
}

/** As cinco etapas feitas no processo vigente (a tela mostra o caminho do processo). */
export function etapasDoProcesso(
  p: ProcessoSaeLido | null,
): readonly { readonly etapa: EtapaSae; readonly feita: boolean }[] {
  const feitas: Record<EtapaSae, boolean> = {
    avaliacao: !!p && p.avaliacao.trim().length > 0,
    diagnostico: !!p && p.diagnosticos.length > 0,
    planejamento:
      !!p &&
      p.diagnosticos.some((d) => d.resultados.length > 0) &&
      p.diagnosticos.some((d) => d.intervencoes.length > 0),
    implementacao:
      !!p &&
      p.diagnosticos.some((d) => d.intervencoes.some((i) => i.atividades.some((a) => a.suspensa === null))),
    evolucao: !!p && p.evolucoes.length > 0,
  };
  return ETAPAS_SAE.map((etapa) => ({ etapa, feita: feitas[etapa] }));
}

/** SAE, diagnóstico e prescrição de enfermagem são privativos do enfermeiro; o técnico executa e checa (regra 7). */
export function podeRegistrarSae(categoria: 'enfermeiro' | 'tecnico' | 'outro'): boolean {
  return categoria === 'enfermeiro';
}
export function podeChecarCuidado(categoria: 'enfermeiro' | 'tecnico' | 'outro'): boolean {
  return categoria === 'enfermeiro' || categoria === 'tecnico';
}

/** A terminologia carregada (linhas do banco) montada; sem as linhas, a sintética. */
export function terminologiaDasLinhas(
  linhas: readonly {
    readonly sistema: 'NNN' | 'CIPE';
    readonly versao: string;
    readonly licenca: string;
    readonly tipo: string;
    readonly codigo: string;
    readonly pai: string | null;
    readonly descricao: string;
    readonly risco: boolean;
  }[],
  sintetica: TerminologiaSae,
): TerminologiaSae {
  const primeira = linhas[0];
  if (!primeira) return sintetica;
  const doTipo = (tp: string) => linhas.filter((l) => l.tipo === tp);
  const termo = (l: { codigo: string; descricao: string }): TermoSae => ({
    codigo: l.codigo,
    descricao: l.descricao,
  });
  return {
    sistema: primeira.sistema,
    versao: primeira.versao,
    licenca: primeira.licenca,
    sintetica: false,
    diagnosticos: doTipo('diagnostico').map((d) => ({
      ...termo(d),
      risco: d.risco,
      caracteristicas: doTipo('caracteristica')
        .filter((c) => c.pai === d.codigo)
        .map(termo),
      fatores: doTipo('fator')
        .filter((c) => c.pai === d.codigo)
        .map(termo),
    })),
    resultados: doTipo('resultado').map(termo),
    intervencoes: doTipo('intervencao').map((i) => ({
      ...termo(i),
      atividades: doTipo('atividade')
        .filter((a) => a.pai === i.codigo)
        .map(termo),
    })),
  };
}

/**
 * Confere a terminologia a carregar (DP-19): cada característica e fator aponta um diagnóstico da carga; cada atividade,
 * uma intervenção; o código não repete no tipo e no pai; precisa de ao menos um diagnóstico, um resultado e uma
 * intervenção.
 */
export function conferirTerminologia(
  termos: readonly {
    readonly tipo: string;
    readonly codigo: string;
    readonly pai: string | null;
    readonly risco: boolean;
  }[],
): { ok: true } | RecusaSae {
  const de = (tp: string) => new Set(termos.filter((x) => x.tipo === tp).map((x) => x.codigo));
  const diag = de('diagnostico');
  const interv = de('intervencao');
  if (diag.size === 0 || de('resultado').size === 0 || interv.size === 0)
    return recusa(
      'terminologia-incompleta',
      'A terminologia precisa de diagnósticos, resultados e intervenções.',
      'termos',
    );
  const chaves = new Set<string>();
  for (const [i, x] of termos.entries()) {
    const k = `${x.tipo}|${x.codigo}|${x.pai ?? '-'}`;
    if (chaves.has(k)) return recusa('termo-repetido', `O termo ${x.codigo} repete.`, `termos.${i}`);
    chaves.add(k);
    const comPai = x.tipo === 'caracteristica' || x.tipo === 'fator' || x.tipo === 'atividade';
    if (comPai) {
      const pais = x.tipo === 'atividade' ? interv : diag;
      if (!x.pai || !pais.has(x.pai))
        return recusa(
          'termo-sem-pai',
          `O termo ${x.codigo} aponta um ${x.tipo === 'atividade' ? 'intervenção' : 'diagnóstico'} que não está na carga.`,
          `termos.${i}`,
        );
    } else if (x.pai) return recusa('termo-sem-pai', `O termo ${x.codigo} não tem pai.`, `termos.${i}`);
    if (x.risco && x.tipo !== 'diagnostico')
      return recusa('termo-risco', 'Só o diagnóstico é de risco.', `termos.${i}`);
  }
  return { ok: true };
}

/** O sistema de classificação de enfermagem de uma edição: a chave única do termo é sistema + código + edição. */
export type SistemaEdicaoEnfermagem = 'NANDA-I' | 'NIC' | 'NOC' | 'CIPE';

/**
 * O sistema de cada termo da carga: no pacote NNN, o diagnóstico com as características e os fatores é NANDA-I, o
 * resultado é NOC e a intervenção com as atividades é NIC; no pacote CIPE, tudo é CIPE.
 */
export function sistemaDoTermoSae(pacote: 'NNN' | 'CIPE', tipo: string): SistemaEdicaoEnfermagem {
  if (pacote === 'CIPE') return 'CIPE';
  if (tipo === 'resultado') return 'NOC';
  if (tipo === 'intervencao' || tipo === 'atividade') return 'NIC';
  return 'NANDA-I';
}

export interface EdicaoTerminologiaMontada {
  readonly ok: true;
  /** Uma edição por sistema presente na carga, todas com a mesma versão. */
  readonly edicoes: readonly { readonly sistema: SistemaEdicaoEnfermagem; readonly termos: number }[];
  /** Um termo por sistema + código (a característica que aparece em vários diagnósticos é um termo só). */
  readonly termos: readonly {
    readonly sistema: SistemaEdicaoEnfermagem;
    readonly codigo: string;
    readonly tipo: string;
    readonly descricao: string;
    readonly risco: boolean;
  }[];
  /** A ligação do termo ao superior (característica e fator ao diagnóstico; atividade à intervenção), no mesmo sistema. */
  readonly ligacoes: readonly {
    readonly sistema: SistemaEdicaoEnfermagem;
    readonly codigo: string;
    readonly superior: string;
  }[];
}

/**
 * Monta a edição versionada da terminologia licenciada (NANDA-I, NIC, NOC ou CIPE) a partir da carga: confere a carga
 * (conferirTerminologia), separa os termos por sistema e recusa o mesmo código num sistema com tipo, descrição ou risco
 * diferentes (termo-divergente), porque a chave única do termo é sistema + código + edição.
 */
export function montarEdicaoTerminologia(carga: {
  readonly pacote: 'NNN' | 'CIPE';
  readonly termos: readonly {
    readonly tipo: string;
    readonly codigo: string;
    readonly pai: string | null;
    readonly descricao: string;
    readonly risco: boolean;
  }[];
}): EdicaoTerminologiaMontada | RecusaSae {
  const k = conferirTerminologia(carga.termos);
  if (!k.ok) return k;
  const termos = new Map<string, EdicaoTerminologiaMontada['termos'][number]>();
  const ligacoes = new Map<string, EdicaoTerminologiaMontada['ligacoes'][number]>();
  for (const [i, x] of carga.termos.entries()) {
    const sistema = sistemaDoTermoSae(carga.pacote, x.tipo);
    const chave = `${sistema}|${x.codigo}`;
    const ja = termos.get(chave);
    const descricao = x.descricao.trim();
    if (!ja) termos.set(chave, { sistema, codigo: x.codigo, tipo: x.tipo, descricao, risco: x.risco });
    else if (ja.tipo !== x.tipo || ja.descricao !== descricao || ja.risco !== x.risco)
      return recusa(
        'termo-divergente',
        `O código ${x.codigo} aparece em ${sistema} com tipo, descrição ou risco diferentes: um código é um termo só na edição.`,
        `termos.${i}`,
      );
    if (x.pai) ligacoes.set(`${chave}|${x.pai}`, { sistema, codigo: x.codigo, superior: x.pai });
  }
  const contagem = new Map<SistemaEdicaoEnfermagem, number>();
  for (const t of termos.values()) contagem.set(t.sistema, (contagem.get(t.sistema) ?? 0) + 1);
  return {
    ok: true,
    edicoes: [...contagem].map(([sistema, n]) => ({ sistema, termos: n })),
    termos: [...termos.values()],
    ligacoes: [...ligacoes.values()],
  };
}

// ── A edição vigente e o catálogo de uso (correção da revisão do fecho-1) ──────────────────────────────────────

/** O pacote de uma carga: NNN (NANDA-I, NIC e NOC da mesma versão) ou CIPE. */
export type PacoteSae = 'NNN' | 'CIPE';

export interface EdicaoCarregadaSae {
  readonly pacote: PacoteSae;
  readonly edicao: string;
  readonly licenca: string;
}

export interface EdicoesVigentesSae {
  /** A última edição carregada de cada pacote (NNN antes de CIPE). */
  readonly vigentes: readonly EdicaoCarregadaSae[];
  /** O sistema da terminologia em uso: o pacote da primeira vigente. */
  readonly sistema: PacoteSae;
  /** A versão em uso: a edição, ou o rótulo das edições de cada pacote quando há mais de um ("NNN x + CIPE y"). */
  readonly versao: string;
  readonly licenca: string;
}

/**
 * As edições vigentes: a última carregada de CADA pacote (a carga de uma edição CIPE não esconde a NNN, e vice-versa),
 * nunca só a última linha. `emOrdem` vem na ordem da carga (a mais antiga primeiro). Sem edição, null.
 */
export function edicoesVigentesSae(emOrdem: readonly EdicaoCarregadaSae[]): EdicoesVigentesSae | null {
  const ultima = new Map<PacoteSae, EdicaoCarregadaSae>();
  for (const e of emOrdem) ultima.set(e.pacote, e);
  const vigentes = (['NNN', 'CIPE'] as const).flatMap((p) => {
    const e = ultima.get(p);
    return e ? [e] : [];
  });
  const primeira = vigentes[0];
  if (!primeira) return null;
  const um = vigentes.length === 1;
  return {
    vigentes,
    sistema: primeira.pacote,
    versao: um ? primeira.edicao : vigentes.map((e) => `${e.pacote} ${e.edicao}`).join(' + '),
    licenca: um ? primeira.licenca : vigentes.map((e) => `${e.pacote}: ${e.licenca}`).join('; '),
  };
}

/** Uma linha da terminologia lida (a edição ou o catálogo de uso), no formato que terminologiaDasLinhas monta. */
export interface LinhaTerminologiaSae {
  readonly sistema: PacoteSae;
  readonly versao: string;
  readonly licenca: string;
  readonly tipo: string;
  readonly codigo: string;
  readonly pai: string | null;
  readonly descricao: string;
  readonly risco: boolean;
}

/** O catálogo de uso de cada tipo de termo (a atividade fica só na edição: é texto da intervenção). */
export const CATALOGO_DE_USO_SAE: Readonly<Record<string, string>> = {
  diagnostico: 'diagnostico_enfermagem',
  caracteristica: 'caracteristica_diagnostico_enfermagem',
  fator: 'caracteristica_diagnostico_enfermagem',
  resultado: 'resultado_enfermagem',
  intervencao: 'intervencao_enfermagem',
};

/**
 * A terminologia em uso com edição carregada: os termos das edições vigentes, menos o que o hospital tirou de uso no
 * catálogo de uso (o item inativo e a ligação diagnóstico-característica excluída: a decisão do hospital prevalece),
 * mais os itens próprios ativos do catálogo de uso que não estão na edição (importação é continuidade: o item próprio
 * do hospital segue utilizável). Todas as linhas saem com a versão e a licença das vigentes.
 */
export function comporTerminologiaSae(e: {
  readonly vigentes: EdicoesVigentesSae;
  readonly edicao: readonly (Omit<LinhaTerminologiaSae, 'versao' | 'licenca' | 'sistema'> & {
    readonly pacote: PacoteSae;
  })[];
  readonly proprios: readonly Omit<LinhaTerminologiaSae, 'versao' | 'licenca' | 'sistema'>[];
  /** `tabela|codigo` dos itens inativos do catálogo de uso. */
  readonly inativos: ReadonlySet<string>;
  /** `diagnóstico|característica` das ligações excluídas do catálogo de uso. */
  readonly paresExcluidos: ReadonlySet<string>;
}): LinhaTerminologiaSae[] {
  const { versao, licenca, sistema } = e.vigentes;
  const ordem = new Map(e.vigentes.vigentes.map((v, i) => [v.pacote, i]));
  const fora = (tipo: string, codigo: string, pai: string | null) => {
    const tabela = CATALOGO_DE_USO_SAE[tipo];
    if (tabela && e.inativos.has(`${tabela}|${codigo}`)) return true;
    return (
      (tipo === 'caracteristica' || tipo === 'fator') &&
      pai !== null &&
      e.paresExcluidos.has(`${pai}|${codigo}`)
    );
  };
  const daEdicao = e.edicao
    .filter((x) => !fora(x.tipo, x.codigo, x.pai))
    .sort((a, b) => (ordem.get(a.pacote) ?? 0) - (ordem.get(b.pacote) ?? 0))
    .map(({ pacote, ...x }) => ({ ...x, sistema: pacote, versao, licenca }));
  const chave = (x: { tipo: string; codigo: string; pai: string | null }) =>
    `${CATALOGO_DE_USO_SAE[x.tipo] ?? x.tipo}|${x.codigo}|${x.pai ?? ''}`;
  const naEdicao = new Set(e.edicao.map(chave));
  const codigoNaEdicao = new Set(e.edicao.map((x) => `${CATALOGO_DE_USO_SAE[x.tipo] ?? x.tipo}|${x.codigo}`));
  const proprios = e.proprios
    .filter(
      (x) =>
        !naEdicao.has(chave(x)) &&
        (x.pai !== null || !codigoNaEdicao.has(`${CATALOGO_DE_USO_SAE[x.tipo] ?? x.tipo}|${x.codigo}`)),
    )
    .map((x) => ({ ...x, sistema, versao, licenca }));
  return [...daEdicao, ...proprios];
}

/** Um item do catálogo de uso já cadastrado com um código da edição. */
export interface ItemCatalogoUsoSae {
  readonly tabela: string;
  readonly codigo: string;
  readonly id: number;
  readonly ativo: boolean;
  /** O tipo do item (diagnóstico: real, risco...; característica: caracteristica_definidora, fator_...); null nos demais. */
  readonly tipo: string | null;
}

/** Uma escala de resultado ativa (uma linha por ponto), com os resultados ativos que já usam o mesmo tipo de escala. */
export interface EscalaResultadoSae {
  readonly id: number;
  readonly tipoEscala: string;
  readonly ponto: number;
  readonly usos: number;
}

export interface PlanoCatalogoUsoSae {
  readonly ok: true;
  /** O código que falta no catálogo de uso (com o enunciado da edição). */
  readonly incluir: readonly {
    readonly tabela: string;
    readonly codigo: string;
    readonly descricao: string;
    readonly tipo: string | null;
    readonly escala: number | null;
  }[];
  /** A ligação diagnóstico-característica (ou fator) que falta, pelos códigos, com o papel. */
  readonly ligar: readonly {
    readonly diagnostico: string;
    readonly caracteristica: string;
    readonly papel: string;
  }[];
  /** Itens inativos no catálogo de uso que a edição traz: ficam inativos (decisão do hospital). */
  readonly mantidosInativos: number;
  /** Ligações excluídas no catálogo de uso que a edição traz: ficam excluídas (nunca se incluem de novo). */
  readonly paresExcluidos: number;
}

const TIPOS_FATOR = new Set(['fator_relacionado', 'fator_risco', 'condicao_associada', 'populacao_risco']);

/**
 * A escala do resultado novo (a edição não traz a escala de cada resultado): com um tipo de escala ativo, ele; com
 * vários, o mais usado pelos resultados ativos do hospital; empate ou nenhum uso recusa escala-ambigua (o hospital
 * define a escala antes da carga); sem escala ativa, escala-ausente. A linha escolhida é o primeiro ponto da escala.
 */
export function escolherEscalaResultadoSae(escalas: readonly EscalaResultadoSae[]): number | RecusaSae {
  const tipos = new Map<string, { usos: number; id: number; ponto: number }>();
  for (const e of escalas) {
    const t = tipos.get(e.tipoEscala);
    if (!t) tipos.set(e.tipoEscala, { usos: e.usos, id: e.id, ponto: e.ponto });
    else {
      t.usos = Math.max(t.usos, e.usos);
      if (e.ponto < t.ponto) Object.assign(t, { id: e.id, ponto: e.ponto });
    }
  }
  const lista = [...tipos.values()].sort((a, b) => b.usos - a.usos);
  const [a, b] = lista;
  if (!a)
    return recusa(
      'escala-ausente',
      'Nenhuma escala de resultado de enfermagem ativa: cadastre a escala antes de carregar a terminologia.',
    );
  if (b && b.usos === a.usos)
    return recusa(
      'escala-ambigua',
      'Há mais de uma escala de resultado ativa sem uma predominante: defina a escala dos resultados antes de carregar a terminologia.',
    );
  return a.id;
}

/**
 * O plano de efeito da edição sobre o catálogo de uso (único pelo código): inclui o código que falta com o enunciado da
 * edição; nunca altera o enunciado nem o tipo do que já existe; o item inativo fica inativo e a ligação excluída fica
 * excluída (a decisão do hospital prevalece sobre a edição); o código já cadastrado com outro tipo (diagnóstico real
 * que a edição diz de risco, característica cadastrada como fator e vice-versa) recusa catalogo-tipo-divergente. O
 * fator novo é de risco quando algum diagnóstico dele na edição é de risco; o papel da ligação é "definidora" para a
 * característica e, para o fator, a condição associada ou a população de risco do item, ou senão fator de risco ou
 * relacionado pelo diagnóstico.
 */
export function planejarCatalogoDeUsoSae(
  m: EdicaoTerminologiaMontada,
  existentes: readonly ItemCatalogoUsoSae[],
  pares: readonly {
    readonly diagnostico: string;
    readonly caracteristica: string;
    readonly excluido: boolean;
  }[],
  escalas: readonly EscalaResultadoSae[],
): PlanoCatalogoUsoSae | RecusaSae {
  const ja = new Map(existentes.map((x) => [`${x.tabela}|${x.codigo}`, x]));
  const riscoDoDiag = new Map(
    m.termos.filter((x) => x.tipo === 'diagnostico').map((x) => [x.codigo, x.risco]),
  );
  const tipoDoTermo = new Map(m.termos.map((x) => [`${x.sistema}|${x.codigo}`, x.tipo]));
  const incluir: {
    tabela: string;
    codigo: string;
    descricao: string;
    tipo: string | null;
    escala: number | null;
  }[] = [];
  const tipoIncluido = new Map<string, string | null>();
  let mantidosInativos = 0;
  let escala: number | null = null;
  for (const x of m.termos) {
    const tabela = CATALOGO_DE_USO_SAE[x.tipo];
    if (!tabela) continue;
    const atual = ja.get(`${tabela}|${x.codigo}`);
    if (atual) {
      const divergente =
        x.tipo === 'diagnostico'
          ? (atual.tipo === 'risco') !== x.risco
          : x.tipo === 'caracteristica'
            ? atual.tipo !== 'caracteristica_definidora'
            : x.tipo === 'fator'
              ? !TIPOS_FATOR.has(atual.tipo ?? '')
              : false;
      if (divergente)
        return recusa(
          'catalogo-tipo-divergente',
          `O código ${x.codigo} já está no catálogo de uso com outro tipo (${atual.tipo ?? '-'}): a edição o traz como ${x.tipo}${x.risco ? ' de risco' : ''}.`,
        );
      if (!atual.ativo) mantidosInativos++;
      continue;
    }
    let tipo: string | null = null;
    if (x.tipo === 'diagnostico') tipo = x.risco ? 'risco' : 'real';
    if (x.tipo === 'caracteristica') tipo = 'caracteristica_definidora';
    if (x.tipo === 'fator')
      tipo = m.ligacoes.some(
        (g) => g.sistema === x.sistema && g.codigo === x.codigo && riscoDoDiag.get(g.superior),
      )
        ? 'fator_risco'
        : 'fator_relacionado';
    if (x.tipo === 'resultado' && escala === null) {
      const e = escolherEscalaResultadoSae(escalas);
      if (typeof e !== 'number') return e;
      escala = e;
    }
    incluir.push({
      tabela,
      codigo: x.codigo,
      descricao: x.descricao,
      tipo,
      escala: x.tipo === 'resultado' ? escala : null,
    });
    tipoIncluido.set(`${tabela}|${x.codigo}`, tipo);
  }
  const par = new Map(pares.map((p) => [`${p.diagnostico}|${p.caracteristica}`, p.excluido]));
  const ligar: { diagnostico: string; caracteristica: string; papel: string }[] = [];
  const vistos = new Set<string>();
  let paresExcluidos = 0;
  for (const g of m.ligacoes) {
    const tipo = tipoDoTermo.get(`${g.sistema}|${g.codigo}`);
    if (tipo !== 'caracteristica' && tipo !== 'fator') continue;
    const k = `${g.superior}|${g.codigo}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const excluido = par.get(k);
    if (excluido !== undefined) {
      if (excluido) paresExcluidos++;
      continue;
    }
    const chaveItem = `caracteristica_diagnostico_enfermagem|${g.codigo}`;
    const tipoItem = ja.get(chaveItem)?.tipo ?? tipoIncluido.get(chaveItem) ?? null;
    const papel =
      tipo === 'caracteristica'
        ? 'definidora'
        : tipoItem === 'condicao_associada' || tipoItem === 'populacao_risco'
          ? tipoItem
          : riscoDoDiag.get(g.superior)
            ? 'fator_risco'
            : 'fator_relacionado';
    ligar.push({ diagnostico: g.superior, caracteristica: g.codigo, papel });
  }
  return { ok: true, incluir, ligar, mantidosInativos, paresExcluidos };
}
