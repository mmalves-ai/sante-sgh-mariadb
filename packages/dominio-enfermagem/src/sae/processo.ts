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
