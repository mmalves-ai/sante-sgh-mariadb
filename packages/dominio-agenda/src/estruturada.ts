// ADR 0009: perguntas do paciente respondidas pela agenda estruturada (seção 6 da resposta da Hal-AI): o convênio e o
// subplano que a agenda atende, as restrições (sexo, idade, retorno, encaixe) e o preparo. A regra extraída do texto
// vale logo como estimativa (decisão 27); cada resposta traz os textos originais da agenda para a tela mostrar ao
// lado, com os trechos não interpretados (que continuam valendo pelo texto). Funções puras sobre a leitura da porta.
import type { AgendaEstruturada, SexoAtendido, TextoOrigemAgenda } from '@sgh/contratos';

type Cobertura = AgendaEstruturada['coberturas'][number];
type Restricao = AgendaEstruturada['restricoes'][number];
type Preparo = AgendaEstruturada['preparos'][number];

export interface RespostaAgenda {
  /** Há regra estimada (extraída do texto, ainda não confirmada) na resposta. */
  readonly estimada: boolean;
  readonly motivo: string;
  /** Textos originais da agenda, íntegros, para mostrar ao lado. */
  readonly textos: readonly TextoOrigemAgenda[];
  /** Há trecho do texto que não se interpretou: a resposta pode depender dele. */
  readonly trechoNaoInterpretado: boolean;
}

const vigente = (r: { vigenciaInicio: string; vigenciaFim: string | null }, data: string) =>
  r.vigenciaInicio <= data && (r.vigenciaFim === null || r.vigenciaFim >= data);

function textosAoLado(a: AgendaEstruturada, fontePagadoraId: number | null = null): TextoOrigemAgenda[] {
  return a.textos.filter((t) => t.fontePagadoraId === null || t.fontePagadoraId === fontePagadoraId);
}

function resposta(
  a: AgendaEstruturada,
  regras: readonly { situacaoRevisao: string }[],
  motivo: string,
  fonte: number | null = null,
): RespostaAgenda {
  const textos = textosAoLado(a, fonte);
  return {
    estimada: regras.some((r) => r.situacaoRevisao === 'estimada'),
    motivo,
    textos,
    trechoNaoInterpretado: textos.some((t) => t.trechos.some((x) => !x.interpretado)),
  };
}

// ---------------------------------------------------------------- convênio e subplano

export interface PerguntaConvenio {
  readonly fontePagadoraId: number;
  /** Plano (ou subplano) do paciente; nulo quando ele não sabe. */
  readonly planoId: number | null;
  /** Plano superior do plano do paciente. */
  readonly planoSuperiorId: number | null;
  readonly data: string;
}

export interface RespostaConvenio extends RespostaAgenda {
  readonly atende: boolean;
  /** Atende o convênio, mas a resposta depende do plano (há regra por plano e o paciente não informou). */
  readonly dependeDoPlano: boolean;
}

/**
 * Cobertura: sem linha do convênio, vale o vínculo da agenda com o convênio. "aceita = falso" exclui o convênio
 * inteiro (plano nulo) ou o plano (e os subplanos dele). Linhas "aceita" com plano restringem aos planos listados;
 * "aceita" sem plano libera o convênio inteiro, mesmo sem vínculo.
 */
export function agendaAtendeConvenio(a: AgendaEstruturada, p: PerguntaConvenio): RespostaConvenio {
  const linhas = a.coberturas.filter((c) => c.fontePagadoraId === p.fontePagadoraId && vigente(c, p.data));
  const doPlano = (c: Cobertura) =>
    c.planoId !== null &&
    (c.planoId === p.planoId || (p.planoSuperiorId !== null && c.planoId === p.planoSuperiorId));
  const r = (atende: boolean, motivo: string, usadas: readonly Cobertura[], dependeDoPlano = false) => ({
    ...resposta(a, usadas, motivo, p.fontePagadoraId),
    atende,
    dependeDoPlano,
  });
  const excluiTudo = linhas.filter((c) => !c.aceita && c.planoId === null);
  if (excluiTudo.length) return r(false, 'A agenda não atende este convênio.', excluiTudo);
  const excluiPlano = linhas.filter((c) => !c.aceita && doPlano(c));
  if (excluiPlano.length) return r(false, 'A agenda atende o convênio, exceto este plano.', excluiPlano);
  const aceitaPlanos = linhas.filter((c) => c.aceita && c.planoId !== null);
  const aceitaTudo = linhas.filter((c) => c.aceita && c.planoId === null);
  const vinculo = a.convenios.includes(p.fontePagadoraId) || aceitaTudo.length > 0;
  if (aceitaPlanos.length) {
    const casa = aceitaPlanos.filter(doPlano);
    if (casa.length) return r(true, 'A agenda atende este plano do convênio.', casa);
    if (p.planoId === null)
      return r(
        vinculo,
        'A agenda atende só alguns planos deste convênio: informe o plano.',
        aceitaPlanos,
        true,
      );
    return r(false, 'A agenda atende só outros planos deste convênio.', aceitaPlanos);
  }
  const exclusoesDePlano = linhas.filter((c) => !c.aceita && c.planoId !== null);
  if (vinculo)
    return r(
      true,
      exclusoesDePlano.length && p.planoId === null
        ? 'A agenda atende o convênio, com exceção de alguns planos: informe o plano.'
        : 'A agenda atende este convênio.',
      [...aceitaTudo, ...exclusoesDePlano],
      exclusoesDePlano.length > 0 && p.planoId === null,
    );
  return r(false, 'A agenda não tem este convênio entre os aceitos.', []);
}

// ---------------------------------------------------------------- restrições

export interface PerguntaRestricao {
  readonly data: string;
  readonly idadeAnos?: number | null;
  readonly sexo?: Exclude<SexoAtendido, 'todos'> | null;
  readonly fontePagadoraId?: number | null;
  readonly planoId?: number | null;
  readonly itemAgendavelId?: number | null;
  /** O paciente quer marcar um retorno. */
  readonly retorno?: boolean;
  /** O paciente pede encaixe. */
  readonly encaixe?: boolean;
}

export interface RegrasEfetivas {
  readonly sexoAtendido: SexoAtendido;
  readonly idadeMinimaAnos: number | null;
  readonly idadeMaximaAnos: number | null;
  readonly aceitaRetorno: boolean;
  readonly diasRetorno: number | null;
  readonly permiteEncaixe: boolean;
}

export interface RespostaRestricao extends RespostaAgenda {
  readonly permitido: boolean;
  readonly regras: RegrasEfetivas;
  readonly impedimentos: readonly string[];
}

/** Peso da restrição: a mais específica (item, plano, convênio) sobrepõe a geral; nulo herda. */
function pesoRestricao(r: Restricao): number {
  return (
    (r.itemAgendavelId !== null ? 4 : 0) + (r.planoId !== null ? 2 : 0) + (r.fontePagadoraId !== null ? 1 : 0)
  );
}

export function regrasEfetivas(
  a: AgendaEstruturada,
  p: PerguntaRestricao,
): { regras: RegrasEfetivas; usadas: Restricao[] } {
  const usadas = a.restricoes
    .filter(
      (r) =>
        vigente(r, p.data) &&
        (r.itemAgendavelId === null || r.itemAgendavelId === (p.itemAgendavelId ?? null)) &&
        (r.fontePagadoraId === null || r.fontePagadoraId === (p.fontePagadoraId ?? null)) &&
        (r.planoId === null || r.planoId === (p.planoId ?? null)),
    )
    .sort((x, y) => pesoRestricao(x) - pesoRestricao(y) || x.id - y.id);
  const regras = { ...a.padrao } as RegrasEfetivas & { preparo?: unknown };
  delete regras.preparo;
  const m = regras as { -readonly [K in keyof RegrasEfetivas]: RegrasEfetivas[K] };
  for (const r of usadas) {
    if (r.sexoAtendido !== null) m.sexoAtendido = r.sexoAtendido;
    if (r.idadeMinimaAnos !== null) m.idadeMinimaAnos = r.idadeMinimaAnos;
    if (r.idadeMaximaAnos !== null) m.idadeMaximaAnos = r.idadeMaximaAnos;
    if (r.aceitaRetorno !== null) m.aceitaRetorno = r.aceitaRetorno;
    if (r.diasRetorno !== null) m.diasRetorno = r.diasRetorno;
    if (r.permiteEncaixe !== null) m.permiteEncaixe = r.permiteEncaixe;
  }
  return { regras: m, usadas };
}

export function agendaAtendePaciente(a: AgendaEstruturada, p: PerguntaRestricao): RespostaRestricao {
  const { regras, usadas } = regrasEfetivas(a, p);
  const imp: string[] = [];
  const idade = p.idadeAnos ?? null;
  if (idade !== null && regras.idadeMinimaAnos !== null && idade < regras.idadeMinimaAnos)
    imp.push(`A agenda atende a partir de ${regras.idadeMinimaAnos} anos.`);
  if (idade !== null && regras.idadeMaximaAnos !== null && idade > regras.idadeMaximaAnos)
    imp.push(`A agenda atende até ${regras.idadeMaximaAnos} anos.`);
  if (p.sexo && regras.sexoAtendido !== 'todos' && regras.sexoAtendido !== p.sexo)
    imp.push(`A agenda atende só o sexo ${regras.sexoAtendido}.`);
  if (p.retorno && !regras.aceitaRetorno) imp.push('A agenda não marca retorno.');
  if (p.encaixe && !regras.permiteEncaixe) imp.push('A agenda não aceita encaixe.');
  const motivo = imp.length
    ? imp.join(' ')
    : 'O paciente pode ser atendido nesta agenda' +
      (p.retorno && regras.diasRetorno !== null ? `; retorno em até ${regras.diasRetorno} dias.` : '.');
  return {
    ...resposta(a, usadas, motivo, p.fontePagadoraId ?? null),
    permitido: imp.length === 0,
    regras,
    impedimentos: imp,
  };
}

// ---------------------------------------------------------------- preparo e documentos

export interface RespostaPreparo extends RespostaAgenda {
  readonly precisaPreparo: boolean;
  readonly jejumHoras: number | null;
  readonly preparos: readonly Preparo[];
  readonly documentos: readonly Preparo[];
  /** Preparo em texto do cadastro da agenda (padrão), quando houver. */
  readonly preparoDaAgenda: string | null;
}

/** Preparo, documentos e orientações do exame (ou da agenda inteira): o do item vence o geral do mesmo tipo. */
export function preparoDoExame(
  a: AgendaEstruturada,
  p: { readonly data: string; readonly itemAgendavelId?: number | null },
): RespostaPreparo {
  const item = p.itemAgendavelId ?? null;
  const vale = a.preparos.filter(
    (x) => vigente(x, p.data) && (x.itemAgendavelId === null || x.itemAgendavelId === item),
  );
  const doItem = vale.filter((x) => x.itemAgendavelId !== null);
  const escolhidos = (tipo: Preparo['tipo']) => {
    const proprios = doItem.filter((x) => x.tipo === tipo);
    return proprios.length ? proprios : vale.filter((x) => x.tipo === tipo && x.itemAgendavelId === null);
  };
  const preparos = [...escolhidos('preparo'), ...escolhidos('orientacao')];
  const documentos = escolhidos('documento');
  const jejum = preparos.reduce<number | null>(
    (m, x) => (x.jejumHoras !== null && (m === null || x.jejumHoras > m) ? x.jejumHoras : m),
    null,
  );
  const precisa = preparos.length > 0 || (a.padrao.preparo ?? '').trim() !== '';
  const motivo = precisa
    ? `O exame tem preparo${jejum !== null ? `, com jejum de ${jejum} horas` : ''}.`
    : 'Não há preparo cadastrado para este exame.';
  return {
    ...resposta(a, [...preparos, ...documentos], motivo),
    precisaPreparo: precisa,
    jejumHoras: jejum,
    preparos,
    documentos,
    preparoDaAgenda: a.padrao.preparo,
  };
}
