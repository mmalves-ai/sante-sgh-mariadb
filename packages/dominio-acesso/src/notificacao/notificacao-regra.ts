// Notificação por regra (01-ADM L76): a regra de alerta gravada pela tela, a consolidação dos avisos de uma regra
// num envio só por janela de tempo e o histórico de envio por canal com a resposta do destinatário.
// Regras puras (sem banco): a porta própria lê, chama estas funções e grava o que elas decidem.
//
// Consolidação: avisos do mesmo destinatário com os mesmos valores nos campos de agrupamento, gerados dentro da mesma
// janela, viram um envio só. A janela começa no primeiro aviso e fecha depois de `janelaMinutos` (ou no próximo
// horário de resumo, quando a regra tem um). Só a janela fechada sai; a aberta aguarda. O limite por usuário no
// período retém os grupos que passariam dele: o aviso continua na central do usuário, só o envio pelo canal espera.
//
// Envio: pendente → enviado → entregue → lido; falha volta a pendente por nova tentativa (até TENTATIVAS_MAXIMAS);
// fora de produção o canal externo fica "capturado" (nada sai). Lido e cancelado não mudam mais. A resposta do
// destinatário é a ciência (lido) e, se ele quiser, a resolução dos avisos do envio.

export type RecusaNotificacao =
  | 'janela-invalida'
  | 'agrupamento-invalido'
  | 'limite-sem-periodo'
  | 'formato-invalido'
  | 'horario-invalido'
  | 'codigo-invalido'
  | 'nome-vazio'
  | 'mensagem-vazia'
  | 'idade-invertida'
  | 'vigencia-invertida'
  | 'intervalo-sem-minutos'
  | 'regra-sem-destinatario'
  | 'regra-do-produto'
  | 'transicao-invalida'
  | 'tentativas-esgotadas';

export const MENSAGEM_NOTIFICACAO: Readonly<Record<RecusaNotificacao, string>> = {
  'janela-invalida': 'A janela de consolidação tem de ser de 1 minuto a 7 dias.',
  'agrupamento-invalido': 'Escolha ao menos um campo de agrupamento válido, sem repetir.',
  'limite-sem-periodo': 'O limite de avisos por usuário precisa do período em minutos.',
  'formato-invalido': 'O formato do envio consolidado é lista ou contagem.',
  'horario-invalido': 'O horário do resumo é HH:MM.',
  'codigo-invalido': 'O código usa letras, números, ponto, hífen ou sublinhado (até 30).',
  'nome-vazio': 'Informe o nome.',
  'mensagem-vazia': 'Informe a mensagem do alerta.',
  'idade-invertida': 'A idade máxima não pode ser menor que a mínima.',
  'vigencia-invertida': 'O fim da vigência não pode ser antes do início.',
  'intervalo-sem-minutos': 'A repetição por intervalo precisa dos minutos do intervalo.',
  'regra-sem-destinatario': 'A regra ativa precisa de ao menos um destinatário.',
  'regra-do-produto': 'Regra do produto: só se ativa ou desativa, sem alterar o conteúdo.',
  'transicao-invalida': 'Este envio não pode passar para a situação pedida.',
  'tentativas-esgotadas': 'O envio já passou do número máximo de tentativas.',
};

export const CAMPOS_AGRUPAMENTO = ['regra', 'paciente', 'atendimento', 'entidade', 'assunto'] as const;
export type CampoAgrupamento = (typeof CAMPOS_AGRUPAMENTO)[number];
export const FORMATOS_CONSOLIDACAO = ['lista', 'contagem'] as const;
export const JANELA_MAXIMA_MINUTOS = 7 * 24 * 60;
export const TENTATIVAS_MAXIMAS = 5;

// ── Regra de consolidação ──────────────────────────────────────────────────────────────────────

export interface RegraConsolidacaoEntrada {
  readonly codigo: string;
  readonly nome: string;
  readonly janelaMinutos: number;
  readonly campos: readonly string[];
  readonly limitePorUsuario?: number | null;
  readonly periodoLimiteMinutos?: number | null;
  readonly horarioResumo?: string | null;
  readonly formato: string;
}

const CODIGO = /^[A-Za-z0-9._-]{1,30}$/;
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validarRegraConsolidacao(r: RegraConsolidacaoEntrada): RecusaNotificacao | null {
  if (!CODIGO.test(r.codigo)) return 'codigo-invalido';
  if (r.nome.trim() === '') return 'nome-vazio';
  if (!Number.isInteger(r.janelaMinutos) || r.janelaMinutos < 1 || r.janelaMinutos > JANELA_MAXIMA_MINUTOS)
    return 'janela-invalida';
  if (
    r.campos.length === 0 ||
    new Set(r.campos).size !== r.campos.length ||
    r.campos.some((c) => !(CAMPOS_AGRUPAMENTO as readonly string[]).includes(c))
  )
    return 'agrupamento-invalido';
  const limite = r.limitePorUsuario ?? null;
  const periodo = r.periodoLimiteMinutos ?? null;
  if (limite !== null && (!Number.isInteger(limite) || limite < 1)) return 'limite-sem-periodo';
  if (limite !== null && (periodo === null || !Number.isInteger(periodo) || periodo < 1))
    return 'limite-sem-periodo';
  if (r.horarioResumo != null && !HORARIO.test(r.horarioResumo)) return 'horario-invalido';
  if (!(FORMATOS_CONSOLIDACAO as readonly string[]).includes(r.formato)) return 'formato-invalido';
  return null;
}

/** Os campos gravados em `chave_agrupamento` (lista separada por vírgula) de volta à lista. */
export function camposDaChave(chave: string): CampoAgrupamento[] {
  return chave
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is CampoAgrupamento => (CAMPOS_AGRUPAMENTO as readonly string[]).includes(c));
}

// ── Regra de alerta ────────────────────────────────────────────────────────────────────────────

export interface RegraAlertaEntrada {
  readonly codigo: string;
  readonly nome: string;
  readonly mensagem: string;
  readonly idadeMinima?: number | null;
  readonly idadeMaxima?: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim?: string | null;
  readonly repeticao: string;
  readonly intervaloMinutos?: number | null;
  readonly ativo: boolean;
  readonly destinatarios: number;
}

export function validarRegraAlerta(r: RegraAlertaEntrada): RecusaNotificacao | null {
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(r.codigo)) return 'codigo-invalido';
  if (r.nome.trim() === '') return 'nome-vazio';
  if (r.mensagem.trim() === '') return 'mensagem-vazia';
  const min = r.idadeMinima ?? null;
  const max = r.idadeMaxima ?? null;
  if (min !== null && max !== null && max < min) return 'idade-invertida';
  if (r.vigenciaFim && r.vigenciaFim < r.vigenciaInicio) return 'vigencia-invertida';
  if (r.repeticao === 'intervalo' && !((r.intervaloMinutos ?? 0) > 0)) return 'intervalo-sem-minutos';
  if (r.ativo && r.destinatarios < 1) return 'regra-sem-destinatario';
  return null;
}

/**
 * Regra do produto (editavel = falso): só o ativo pode mudar. `mudouConteudo` diz se algo além do ativo mudou.
 */
export function conferirEdicaoRegra(editavel: boolean, mudouConteudo: boolean): RecusaNotificacao | null {
  return !editavel && mudouConteudo ? 'regra-do-produto' : null;
}

// ── Consolidação dos avisos ────────────────────────────────────────────────────────────────────

export interface AvisoPendente {
  readonly id: number;
  readonly usuario: number;
  readonly regra: number | null;
  readonly paciente: number | null;
  readonly atendimento: number | null;
  readonly entidade: string | null;
  readonly entidadeId: number | null;
  readonly assunto: string | null;
  readonly geradoEm: Date;
}

export interface ConsolidacaoAplicavel {
  readonly janelaMinutos: number;
  readonly campos: readonly CampoAgrupamento[];
  readonly limitePorUsuario: number | null;
  /** Hora local "HH:MM" do resumo; nula: a janela fecha `janelaMinutos` depois do primeiro aviso. */
  readonly horarioResumo: string | null;
}

export interface EnvioConsolidado {
  readonly usuario: number;
  readonly chave: string;
  readonly avisos: readonly number[];
  readonly inicio: Date;
  readonly fim: Date;
}

export interface ResultadoConsolidacao {
  readonly envios: readonly EnvioConsolidado[];
  /** Avisos em janela ainda aberta. */
  readonly aguardando: readonly number[];
  /** Avisos de janela fechada retidos pelo limite por usuário no período. */
  readonly retidos: readonly number[];
}

function valorCampo(a: AvisoPendente, c: CampoAgrupamento): string {
  switch (c) {
    case 'regra':
      return String(a.regra ?? '-');
    case 'paciente':
      return String(a.paciente ?? '-');
    case 'atendimento':
      return String(a.atendimento ?? '-');
    case 'entidade':
      return a.entidade ? `${a.entidade}:${a.entidadeId ?? '-'}` : '-';
    case 'assunto':
      return a.assunto ?? '-';
  }
}

/** Fim da janela que começa em `inicio`: o próximo horário de resumo (estritamente depois) ou inicio + janela. */
export function fimDaJanela(inicio: Date, regra: ConsolidacaoAplicavel): Date {
  if (regra.horarioResumo) {
    const [h, m] = regra.horarioResumo.split(':').map(Number) as [number, number];
    const d = new Date(inicio);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= inicio.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  return new Date(inicio.getTime() + regra.janelaMinutos * 60_000);
}

/**
 * Junta os avisos pendentes em envios. `enviosNoPeriodo` é quantos envios cada usuário já recebeu no período do
 * limite (lidos do histórico). A ordem é determinística: usuário, chave e início da janela.
 */
export function consolidarAvisos(
  avisos: readonly AvisoPendente[],
  regra: ConsolidacaoAplicavel,
  agora: Date,
  enviosNoPeriodo: ReadonlyMap<number, number> = new Map(),
): ResultadoConsolidacao {
  const grupos = new Map<string, AvisoPendente[]>();
  for (const a of [...avisos].sort((x, y) => x.geradoEm.getTime() - y.geradoEm.getTime() || x.id - y.id)) {
    const chave = regra.campos.map((c) => `${c}=${valorCampo(a, c)}`).join('|');
    const k = `${a.usuario}#${chave}`;
    const g = grupos.get(k);
    if (g) g.push(a);
    else grupos.set(k, [a]);
  }
  const prontos: EnvioConsolidado[] = [];
  const aguardando: number[] = [];
  for (const [k, lista] of grupos) {
    const chave = k.slice(k.indexOf('#') + 1);
    let atual: AvisoPendente[] = [];
    let inicio: Date | null = null;
    let fim: Date | null = null;
    const fechar = () => {
      if (!inicio || !fim || atual.length === 0) return;
      if (fim.getTime() <= agora.getTime())
        prontos.push({ usuario: atual[0]!.usuario, chave, avisos: atual.map((a) => a.id), inicio, fim });
      else aguardando.push(...atual.map((a) => a.id));
    };
    for (const a of lista) {
      if (!fim || a.geradoEm.getTime() >= fim.getTime()) {
        fechar();
        inicio = a.geradoEm;
        fim = fimDaJanela(a.geradoEm, regra);
        atual = [];
      }
      atual.push(a);
    }
    fechar();
  }
  prontos.sort(
    (x, y) =>
      x.usuario - y.usuario || x.inicio.getTime() - y.inicio.getTime() || x.chave.localeCompare(y.chave),
  );
  const envios: EnvioConsolidado[] = [];
  const retidos: number[] = [];
  const usados = new Map<number, number>();
  for (const e of prontos) {
    const ja = (enviosNoPeriodo.get(e.usuario) ?? 0) + (usados.get(e.usuario) ?? 0);
    if (regra.limitePorUsuario !== null && ja >= regra.limitePorUsuario) {
      retidos.push(...e.avisos);
      continue;
    }
    usados.set(e.usuario, (usados.get(e.usuario) ?? 0) + 1);
    envios.push(e);
  }
  return { envios, aguardando: aguardando.sort((a, b) => a - b), retidos: retidos.sort((a, b) => a - b) };
}

// ── Situação do envio e resposta ───────────────────────────────────────────────────────────────

export const SITUACOES_ENVIO = [
  'pendente',
  'enviado',
  'entregue',
  'lido',
  'falhou',
  'cancelado',
  'capturado',
] as const;
export type SituacaoEnvio = (typeof SITUACOES_ENVIO)[number];
export const EVENTOS_ENVIO = [
  'enviar',
  'capturar',
  'entregar',
  'ler',
  'falhar',
  'repetir',
  'cancelar',
] as const;
export type EventoEnvio = (typeof EVENTOS_ENVIO)[number];

const TRANSICOES: Readonly<Record<SituacaoEnvio, Partial<Record<EventoEnvio, SituacaoEnvio>>>> = {
  pendente: { enviar: 'enviado', capturar: 'capturado', falhar: 'falhou', cancelar: 'cancelado' },
  enviado: { entregar: 'entregue', ler: 'lido', falhar: 'falhou' },
  entregue: { ler: 'lido' },
  capturado: { ler: 'lido' },
  falhou: { repetir: 'pendente', cancelar: 'cancelado' },
  lido: {},
  cancelado: {},
};

export function transicaoEnvio(
  atual: SituacaoEnvio,
  evento: EventoEnvio,
  tentativas: number,
): { nova: SituacaoEnvio } | { recusa: RecusaNotificacao } {
  const nova = TRANSICOES[atual]?.[evento];
  if (!nova) return { recusa: 'transicao-invalida' };
  if (evento === 'repetir' && tentativas >= TENTATIVAS_MAXIMAS) return { recusa: 'tentativas-esgotadas' };
  return { nova };
}

/** Situação inicial do envio: canal interno já entrega; externo fora de produção fica capturado (nada sai). */
export function situacaoInicialEnvio(externo: boolean, producao: boolean): SituacaoEnvio {
  if (!externo) return 'entregue';
  return producao ? 'pendente' : 'capturado';
}

// ── Medição da resposta ────────────────────────────────────────────────────────────────────────

export interface EnvioMedido {
  readonly canal: string;
  readonly situacao: SituacaoEnvio;
  readonly quantidadeAvisos: number;
  readonly enviadoEm: Date | null;
  readonly lidoEm: Date | null;
}

export interface MedicaoCanal {
  readonly canal: string;
  readonly envios: number;
  readonly avisos: number;
  readonly lidos: number;
  readonly falhas: number;
  readonly aguardando: number;
  /** Lidos ÷ envios que chegaram ao destinatário (envios menos falhas e cancelados), em %, inteiro. */
  readonly taxaLeituraPercentual: number | null;
  /** Mediana dos minutos entre o envio e a leitura (só os lidos com as duas datas). */
  readonly medianaMinutosAteLeitura: number | null;
}

export function medirRespostas(envios: readonly EnvioMedido[]): MedicaoCanal[] {
  const por = new Map<string, EnvioMedido[]>();
  for (const e of envios) por.set(e.canal, [...(por.get(e.canal) ?? []), e]);
  return [...por.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([canal, lista]) => {
      const lidos = lista.filter((e) => e.situacao === 'lido');
      const falhas = lista.filter((e) => e.situacao === 'falhou').length;
      const cancelados = lista.filter((e) => e.situacao === 'cancelado').length;
      const chegaram = lista.length - falhas - cancelados;
      const tempos = lidos
        .filter((e) => e.enviadoEm && e.lidoEm)
        .map((e) => (e.lidoEm!.getTime() - e.enviadoEm!.getTime()) / 60_000)
        .sort((a, b) => a - b);
      const meio = Math.floor(tempos.length / 2);
      const mediana =
        tempos.length === 0
          ? null
          : tempos.length % 2
            ? tempos[meio]!
            : (tempos[meio - 1]! + tempos[meio]!) / 2;
      return {
        canal,
        envios: lista.length,
        avisos: lista.reduce((s, e) => s + e.quantidadeAvisos, 0),
        lidos: lidos.length,
        falhas,
        aguardando: lista.filter((e) => ['pendente', 'enviado', 'entregue', 'capturado'].includes(e.situacao))
          .length,
        taxaLeituraPercentual: chegaram > 0 ? Math.round((lidos.length * 100) / chegaram) : null,
        medianaMinutosAteLeitura: mediana === null ? null : Math.round(mediana),
      };
    });
}
