// Central de comando assistencial (C2-053, 01-ADM L117): o quadro de risco da unidade, com as regras clínicas como
// dado configurável pelo hospital. Tudo aqui é regra pura, sem banco:
//   - a regra de risco (tema, gravidade, público por sexo e idade, combinação "todos" ou "qualquer", janela de
//     avaliação, vigência) e os seus critérios por exame (faixa do resultado), medicamento (e dose), diagnóstico
//     (código ou prefixo CID-10), sinal vital (faixa da aferição) e tempo de permanência, cada um podendo valer pela
//     ausência do achado (profilaxia não prescrita, por exemplo);
//   - a apuração: quais regras acendem para cada paciente internado, com a evidência dos critérios atendidos, e o que
//     fazer com a ocorrência já aberta (manter, abrir, encerrar porque os critérios deixaram de ocorrer);
//   - a vida da ocorrência (aberta → reconhecida → resolvida ou descartada, nunca apagada);
//   - os alertas de fluxo da unidade (espera, ocupação, alta pendente, leitos bloqueados ou em higienização,
//     indicador) pelos limites de atenção e crítico;
//   - as metas das 24 horas por paciente (checklist diário do cuidado: segurança, mobilização, sedação e dor,
//     nutrição, dispositivos, exames, alta, família), com prazo, cumprimento e justificativa do não cumprimento.

export const TIPOS_CRITERIO_RISCO = [
  'exame',
  'medicamento',
  'dose',
  'diagnostico',
  'sinal_vital',
  'permanencia',
] as const;
export type TipoCriterioRisco = (typeof TIPOS_CRITERIO_RISCO)[number];
export const GRAVIDADES_REGRA_RISCO = ['baixa', 'moderada', 'alta', 'critica'] as const;
export type GravidadeRegraRisco = (typeof GRAVIDADES_REGRA_RISCO)[number];
export type GravidadeOcorrencia = 'baixa' | 'media' | 'alta' | 'critica';
export type SituacaoOcorrenciaRisco = 'aberta' | 'reconhecida' | 'resolvida' | 'descartada';

export interface CriterioRisco {
  readonly tipo: TipoCriterioRisco;
  readonly exame: number | null;
  readonly item: number | null;
  readonly cid: string | null;
  readonly parametroVital: number | null;
  readonly valorMinimo: number | null;
  readonly valorMaximo: number | null;
  readonly permanenciaMinimaHoras: number | null;
  readonly negado: boolean;
}

export interface RegraRisco {
  readonly codigo: string;
  readonly nome: string;
  readonly gravidade: GravidadeRegraRisco;
  readonly sexo: 'feminino' | 'masculino' | 'ambos';
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly combinacao: 'todos' | 'qualquer';
  readonly janelaHoras: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly criterios: readonly CriterioRisco[];
}

export const MENSAGENS_REGRA_RISCO = {
  'codigo-invalido': 'O código da regra tem de 2 a 30 letras, números, ponto, hífen ou sublinhado.',
  'nome-curto': 'Dê à regra um nome com pelo menos 3 letras.',
  'sem-criterio': 'A regra precisa de pelo menos um critério ativo.',
  'idade-invertida': 'A idade máxima não pode ser menor que a mínima.',
  'vigencia-invertida': 'O fim da vigência não pode ser antes do início.',
  'janela-invalida': 'A janela de avaliação vai de 1 a 720 horas.',
  'criterio-sem-alvo':
    'Cada critério precisa do alvo do seu tipo (exame, item prescrito, CID-10, sinal vital ou horas).',
  'faixa-invertida': 'O valor máximo do critério não pode ser menor que o mínimo.',
  'cid-invalido': 'O CID-10 do critério é uma letra seguida de 1 a 3 dígitos (ex.: I21 ou I219).',
  'so-negados':
    'A regra não pode ter só critérios pela ausência: ao menos um critério precisa de um achado presente.',
  'dose-sem-faixa': 'O critério de dose precisa do limite mínimo ou máximo da dose.',
} as const;
export type ProblemaRegraRisco = keyof typeof MENSAGENS_REGRA_RISCO;

const CODIGO = /^[A-Za-z0-9._-]{2,30}$/;
const CID = /^[A-Z]\d{1,3}$/;

export const normalizarCid = (c: string): string => c.trim().toUpperCase().replace(/[.\s]/g, '');

/** O alvo que cada tipo de critério exige (a mesma regra do CHECK do banco, conferida antes, na tela). */
function problemaDoCriterio(c: CriterioRisco): ProblemaRegraRisco | null {
  const alvo =
    (c.tipo === 'exame' && c.exame !== null) ||
    ((c.tipo === 'medicamento' || c.tipo === 'dose') && c.item !== null) ||
    (c.tipo === 'diagnostico' && !!c.cid) ||
    (c.tipo === 'sinal_vital' && c.parametroVital !== null) ||
    (c.tipo === 'permanencia' && c.permanenciaMinimaHoras !== null && c.permanenciaMinimaHoras >= 0);
  if (!alvo) return 'criterio-sem-alvo';
  if (c.tipo === 'diagnostico' && !CID.test(normalizarCid(c.cid!))) return 'cid-invalido';
  if (c.valorMinimo !== null && c.valorMaximo !== null && c.valorMaximo < c.valorMinimo)
    return 'faixa-invertida';
  if (c.tipo === 'dose' && c.valorMinimo === null && c.valorMaximo === null) return 'dose-sem-faixa';
  return null;
}

/** Os problemas da regra, na ordem em que a tela os mostra (vazio: a regra pode ser gravada). */
export function problemasDaRegraRisco(r: RegraRisco): ProblemaRegraRisco[] {
  const p: ProblemaRegraRisco[] = [];
  if (!CODIGO.test(r.codigo)) p.push('codigo-invalido');
  if (r.nome.trim().length < 3) p.push('nome-curto');
  if (r.idadeMinimaDias !== null && r.idadeMaximaDias !== null && r.idadeMaximaDias < r.idadeMinimaDias)
    p.push('idade-invertida');
  if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio) p.push('vigencia-invertida');
  if (r.janelaHoras !== null && (r.janelaHoras < 1 || r.janelaHoras > 720)) p.push('janela-invalida');
  if (r.criterios.length === 0) p.push('sem-criterio');
  for (const c of r.criterios) {
    const x = problemaDoCriterio(c);
    if (x && !p.includes(x)) p.push(x);
  }
  if (r.criterios.length > 0 && r.criterios.every((c) => c.negado)) p.push('so-negados');
  return p;
}

/** A gravidade da ocorrência pela da regra (a ocorrência usa "media" onde a regra diz "moderada"). */
export const gravidadeDaOcorrencia = (g: GravidadeRegraRisco): GravidadeOcorrencia =>
  g === 'moderada' ? 'media' : g;

export const PESO_GRAVIDADE: Readonly<Record<GravidadeOcorrencia, number>> = {
  baixa: 1,
  media: 2,
  alta: 3,
  critica: 4,
};

/** Os achados do paciente que a apuração cruza com os critérios (já filtrados pela janela da regra mais longa). */
export interface FatosRisco {
  readonly sexo: 'feminino' | 'masculino' | null;
  readonly idadeDias: number | null;
  readonly permanenciaHoras: number;
  /** Resultados numéricos liberados: exame e valor, com o momento (ISO). */
  readonly exames: readonly { exame: number; valor: number | null; critico: boolean; em: string }[];
  /** Itens prescritos ativos: item e dose. */
  readonly itens: readonly { item: number; dose: number | null; em: string }[];
  /** Códigos CID-10 dos diagnósticos ativos. */
  readonly cids: readonly string[];
  readonly sinais: readonly { parametro: number; valor: number | null; em: string }[];
}

export interface EvidenciaCriterio {
  readonly sequencia: number;
  readonly tipo: TipoCriterioRisco;
  readonly negado: boolean;
  readonly valor: number | string | null;
  readonly em: string | null;
}

const naFaixa = (v: number | null, min: number | null, max: number | null): boolean =>
  min === null && max === null
    ? true
    : v !== null && (min === null || v >= min) && (max === null || v <= max);

/** O achado que atende ao critério (o mais recente dentro da janela), ou nulo. */
function achado(
  c: CriterioRisco,
  f: FatosRisco,
  desde: string | null,
): { valor: number | string | null; em: string | null } | null {
  const dentro = (em: string) => desde === null || em >= desde;
  const maisRecente = <T extends { em: string }>(xs: T[]): T | null =>
    xs.length ? xs.reduce((a, b) => (b.em > a.em ? b : a)) : null;
  switch (c.tipo) {
    case 'exame': {
      const x = maisRecente(
        f.exames.filter(
          (e) =>
            e.exame === c.exame &&
            dentro(e.em) &&
            (c.valorMinimo === null && c.valorMaximo === null
              ? e.critico
              : naFaixa(e.valor, c.valorMinimo, c.valorMaximo)),
        ),
      );
      return x ? { valor: x.valor, em: x.em } : null;
    }
    case 'medicamento':
    case 'dose': {
      const x = maisRecente(
        f.itens.filter(
          (i) =>
            i.item === c.item && (c.tipo === 'medicamento' || naFaixa(i.dose, c.valorMinimo, c.valorMaximo)),
        ),
      );
      return x ? { valor: x.dose, em: x.em } : null;
    }
    case 'diagnostico': {
      const p = normalizarCid(c.cid ?? '');
      const cid = f.cids.map(normalizarCid).find((x) => x.startsWith(p));
      return cid ? { valor: cid, em: null } : null;
    }
    case 'sinal_vital': {
      const x = maisRecente(
        f.sinais.filter(
          (s) =>
            s.parametro === c.parametroVital &&
            dentro(s.em) &&
            naFaixa(s.valor, c.valorMinimo, c.valorMaximo),
        ),
      );
      return x ? { valor: x.valor, em: x.em } : null;
    }
    case 'permanencia':
      return f.permanenciaHoras >= (c.permanenciaMinimaHoras ?? 0)
        ? { valor: f.permanenciaHoras, em: null }
        : null;
  }
}

/** O instante ISO `horas` antes de `agora`. */
export const horasAntes = (agora: string, horas: number): string =>
  new Date(Date.parse(agora) - horas * 3_600_000).toISOString();

/** A regra vale para o paciente hoje (vigência, sexo e idade)? */
export function regraAplicavel(r: RegraRisco, f: FatosRisco, hoje: string): boolean {
  if (hoje < r.vigenciaInicio || (r.vigenciaFim !== null && hoje > r.vigenciaFim)) return false;
  if (r.sexo !== 'ambos' && f.sexo !== r.sexo) return false;
  if (r.idadeMinimaDias !== null && (f.idadeDias === null || f.idadeDias < r.idadeMinimaDias)) return false;
  if (r.idadeMaximaDias !== null && (f.idadeDias === null || f.idadeDias > r.idadeMaximaDias)) return false;
  return true;
}

/**
 * A regra acende para o paciente? Cada critério é atendido pela presença do achado (ou pela ausência, se negado);
 * "todos" exige todos, "qualquer" basta um. A evidência traz só os critérios atendidos.
 */
export function avaliarRegraRisco(
  r: RegraRisco,
  f: FatosRisco,
  agora: string,
): { acende: boolean; evidencia: EvidenciaCriterio[] } {
  if (!regraAplicavel(r, f, agora.slice(0, 10)) || r.criterios.length === 0)
    return { acende: false, evidencia: [] };
  const desde = r.janelaHoras !== null ? horasAntes(agora, r.janelaHoras) : null;
  const evidencia: EvidenciaCriterio[] = [];
  const atendidos = r.criterios.map((c, i) => {
    const a = achado(c, f, desde);
    const ok = c.negado ? a === null : a !== null;
    if (ok)
      evidencia.push({
        sequencia: i + 1,
        tipo: c.tipo,
        negado: c.negado,
        valor: a?.valor ?? null,
        em: a?.em ?? null,
      });
    return ok;
  });
  const acende = r.combinacao === 'todos' ? atendidos.every(Boolean) : atendidos.some(Boolean);
  return { acende, evidencia: acende ? evidencia : [] };
}

/**
 * O que a apuração faz com a ocorrência da regra para o atendimento: abrir (acendeu e não há aberta), manter (acendeu
 * e já há aberta ou reconhecida: não duplica), encerrar (há aberta, mas os critérios deixaram de ocorrer) ou nada.
 */
export function acaoDaApuracao(acende: boolean, aberta: boolean): 'abrir' | 'manter' | 'encerrar' | 'nada' {
  if (acende) return aberta ? 'manter' : 'abrir';
  return aberta ? 'encerrar' : 'nada';
}

export const MENSAGENS_OCORRENCIA = {
  'ja-reconhecida': 'A ocorrência já foi reconhecida.',
  'ja-encerrada': 'A ocorrência já foi encerrada (resolvida ou descartada): o histórico fica como está.',
  'resolucao-curta': 'Descreva a conduta ou o motivo com pelo menos 10 letras.',
} as const;
export type ProblemaOcorrencia = keyof typeof MENSAGENS_OCORRENCIA;

/** A passagem pedida na ocorrência é permitida? (nulo: sim) */
export function problemaDaPassagem(
  atual: SituacaoOcorrenciaRisco,
  acao: 'reconhecer' | 'resolver' | 'descartar',
  resolucao: string | null,
): ProblemaOcorrencia | null {
  if (atual === 'resolvida' || atual === 'descartada') return 'ja-encerrada';
  if (acao === 'reconhecer') return atual === 'reconhecida' ? 'ja-reconhecida' : null;
  if ((resolucao ?? '').trim().length < 10) return 'resolucao-curta';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Alertas de fluxo da unidade.

export const TIPOS_ALERTA_FLUXO = [
  'tempo_espera',
  'ocupacao',
  'alta_pendente',
  'leito_bloqueado',
  'leito_higienizacao',
  'indicador',
] as const;
export type TipoAlertaFluxo = (typeof TIPOS_ALERTA_FLUXO)[number];
export type UnidadeLimite = 'minutos' | 'percentual' | 'quantidade';

/** A unidade de medida natural de cada tipo de alerta (a tela sugere; o indicador pode usar qualquer uma). */
export const UNIDADE_DO_ALERTA: Readonly<Record<Exclude<TipoAlertaFluxo, 'indicador'>, UnidadeLimite>> = {
  tempo_espera: 'minutos',
  ocupacao: 'percentual',
  alta_pendente: 'minutos',
  leito_bloqueado: 'quantidade',
  leito_higienizacao: 'quantidade',
};

export const MENSAGENS_ALERTA_FLUXO = {
  'unidade-incoerente': 'A unidade do limite não combina com o tipo de alerta.',
  'limite-negativo': 'Os limites não podem ser negativos.',
  'atencao-acima-critico': 'O limite de atenção tem de ficar abaixo do crítico.',
  'percentual-acima-100': 'O limite em percentual vai até 100.',
  'indicador-obrigatorio': 'O alerta por indicador precisa do indicador.',
} as const;
export type ProblemaAlertaFluxo = keyof typeof MENSAGENS_ALERTA_FLUXO;

export interface AlertaFluxo {
  readonly tipo: TipoAlertaFluxo;
  readonly unidadeLimite: UnidadeLimite;
  readonly limiteAtencao: number | null;
  readonly limiteCritico: number;
  readonly indicador: number | null;
}

export function problemasDoAlertaFluxo(a: AlertaFluxo): ProblemaAlertaFluxo[] {
  const p: ProblemaAlertaFluxo[] = [];
  if (a.tipo !== 'indicador' && UNIDADE_DO_ALERTA[a.tipo] !== a.unidadeLimite) p.push('unidade-incoerente');
  if (a.tipo === 'indicador' && a.indicador === null) p.push('indicador-obrigatorio');
  if (a.limiteCritico < 0 || (a.limiteAtencao !== null && a.limiteAtencao < 0)) p.push('limite-negativo');
  if (a.limiteAtencao !== null && a.limiteAtencao >= a.limiteCritico) p.push('atencao-acima-critico');
  if (a.unidadeLimite === 'percentual' && a.limiteCritico > 100) p.push('percentual-acima-100');
  return p;
}

export type NivelAlertaCentral = 'normal' | 'atencao' | 'critico' | 'sem_medida';

/** O nível do alerta pela medida da unidade: crítico ao atingir o crítico; atenção ao atingir a atenção. */
export function nivelDoAlerta(
  a: Pick<AlertaFluxo, 'limiteAtencao' | 'limiteCritico'>,
  medida: number | null,
): NivelAlertaCentral {
  if (medida === null) return 'sem_medida';
  if (medida >= a.limiteCritico) return 'critico';
  if (a.limiteAtencao !== null && medida >= a.limiteAtencao) return 'atencao';
  return 'normal';
}

/** A ocupação em percentual (uma casa), nula sem leito operacional. */
export const percentualOcupacao = (ocupados: number, operacionais: number): number | null =>
  operacionais > 0 ? Math.round((ocupados / operacionais) * 1000) / 10 : null;

// ---------------------------------------------------------------------------------------------------------------
// Metas das 24 horas.

export const CATEGORIAS_META_24H = [
  'seguranca',
  'mobilizacao',
  'sedacao_dor',
  'nutricao',
  'dispositivo',
  'exame',
  'alta',
  'familia',
  'outra',
] as const;
export type CategoriaMeta24h = (typeof CATEGORIAS_META_24H)[number];
export type SituacaoMeta24h = 'pendente' | 'cumprida' | 'nao_cumprida' | 'cancelada';

export const MENSAGENS_META_24H = {
  'descricao-curta': 'Descreva a meta com pelo menos 5 letras.',
  'prazo-passado': 'O prazo da meta não pode ser antes de agora.',
  'prazo-longe': 'A meta é das próximas 24 horas: o prazo vai até 24 horas a partir de agora.',
  'meta-encerrada': 'A meta já foi encerrada: o registro fica como está.',
  'justificativa-obrigatoria':
    'Diga por que a meta não foi cumprida ou foi cancelada (pelo menos 10 letras).',
} as const;
export type ProblemaMeta24h = keyof typeof MENSAGENS_META_24H;

export function problemaDaNovaMeta(
  descricao: string,
  prazoEm: string,
  agora: string,
): ProblemaMeta24h | null {
  if (descricao.trim().length < 5) return 'descricao-curta';
  const p = Date.parse(prazoEm);
  const a = Date.parse(agora);
  if (p < a - 60_000) return 'prazo-passado';
  if (p > a + 24 * 3_600_000 + 60_000) return 'prazo-longe';
  return null;
}

export function problemaDoEncerramentoMeta(
  atual: SituacaoMeta24h,
  nova: Exclude<SituacaoMeta24h, 'pendente'>,
  justificativa: string | null,
): ProblemaMeta24h | null {
  if (atual !== 'pendente') return 'meta-encerrada';
  if (nova !== 'cumprida' && (justificativa ?? '').trim().length < 10) return 'justificativa-obrigatoria';
  return null;
}

/** A meta pendente cujo prazo passou está atrasada (a tela pinta e a ordena primeiro). */
export const metaAtrasada = (situacao: SituacaoMeta24h, prazoEm: string, agora: string): boolean =>
  situacao === 'pendente' && Date.parse(prazoEm) < Date.parse(agora);

/** O cumprimento das metas do dia: cumpridas sobre as que valem (as canceladas não contam). */
export function cumprimentoMetas(situacoes: readonly SituacaoMeta24h[]): {
  total: number;
  cumpridas: number;
  pendentes: number;
  percentual: number | null;
} {
  const validas = situacoes.filter((s) => s !== 'cancelada');
  const cumpridas = validas.filter((s) => s === 'cumprida').length;
  const pendentes = validas.filter((s) => s === 'pendente').length;
  return {
    total: validas.length,
    cumpridas,
    pendentes,
    percentual: validas.length ? Math.round((cumpridas / validas.length) * 100) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// O quadro: pacientes da unidade na ordem de quem precisa primeiro.

export interface LinhaQuadro {
  readonly atendimento: number;
  readonly maiorGravidade: GravidadeOcorrencia | null;
  readonly riscosAbertos: number;
  readonly metasAtrasadas: number;
  readonly escorePiora: number | null;
  readonly leito: string | null;
}

/** Maior gravidade aberta primeiro, depois metas atrasadas, depois o escore de piora mais alto, depois o leito. */
export function ordemDoQuadro(a: LinhaQuadro, b: LinhaQuadro): number {
  const g = (x: LinhaQuadro) => (x.maiorGravidade ? PESO_GRAVIDADE[x.maiorGravidade] : 0);
  return (
    g(b) - g(a) ||
    b.riscosAbertos - a.riscosAbertos ||
    b.metasAtrasadas - a.metasAtrasadas ||
    (b.escorePiora ?? -1) - (a.escorePiora ?? -1) ||
    (a.leito ?? '~').localeCompare(b.leito ?? '~') ||
    a.atendimento - b.atendimento
  );
}
