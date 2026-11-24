// Pacotes de dados de parceiros e as entregas agendadas (F3.9, linha 08-INTG L134). O pacote diz o que vai (campos com
// justificativa, para minimização), em que formato, por que meio, com que agenda e com que anonimização; cada entrega
// registra o período coberto, o volume, o hash e a confirmação. Tudo puro: a porta grava, o domínio decide.

export const FORMATOS_PACOTE = ['csv', 'json', 'xml', 'fhir', 'parquet', 'pdf'] as const;
export type FormatoPacote = (typeof FORMATOS_PACOTE)[number];
export const MEIOS_ENTREGA = ['api', 'webhook', 'sftp', 'arquivo_seguro', 'email_seguro'] as const;
export type MeioEntrega = (typeof MEIOS_ENTREGA)[number];
export const PERIODICIDADES_PACOTE = ['sob_demanda', 'diaria', 'semanal', 'mensal'] as const;
export type PeriodicidadePacote = (typeof PERIODICIDADES_PACOTE)[number];
export const ANONIMIZACOES = ['nenhuma', 'pseudonimizada', 'anonimizada', 'agregada'] as const;
export type Anonimizacao = (typeof ANONIMIZACOES)[number];
export const TRATAMENTOS_CAMPO = [
  'original',
  'pseudonimizado',
  'mascarado',
  'generalizado',
  'agregado',
] as const;
export type TratamentoCampo = (typeof TRATAMENTOS_CAMPO)[number];
export const SITUACOES_ENTREGA = ['gerada', 'enviada', 'confirmada', 'rejeitada', 'falhou'] as const;
export type SituacaoEntrega = (typeof SITUACOES_ENTREGA)[number];

export interface ErroPacote {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}
const erro = (campo: string, codigo: string, mensagem: string): ErroPacote => ({ campo, codigo, mensagem });

export interface CampoPacote {
  readonly sequencia: number;
  readonly entidade: string;
  readonly campo: string;
  readonly rotuloSaida: string;
  readonly tratamento: TratamentoCampo;
  readonly dadoSensivel: boolean;
  readonly justificativa: string;
}

export interface Pacote {
  readonly codigo: string;
  readonly nome: string;
  readonly conteudo: string;
  readonly formato: FormatoPacote;
  readonly meioEntrega: MeioEntrega;
  readonly periodicidade: PeriodicidadePacote;
  readonly agenda: string | null;
  readonly anonimizacao: Anonimizacao;
  readonly janelaDias: number | null;
}

/** O meio aceita o formato? FHIR só por API ou webhook; arquivo binário (parquet, pdf) não vai por webhook. */
export function meioAceitaFormato(meio: MeioEntrega, formato: FormatoPacote): boolean {
  if (formato === 'fhir') return meio === 'api' || meio === 'webhook';
  if (formato === 'parquet' || formato === 'pdf') return meio !== 'webhook' && meio !== 'api';
  return true;
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;

export type AgendaLida =
  | { readonly tipo: 'diaria'; readonly minuto: number }
  | { readonly tipo: 'semanal'; readonly diaSemana: number; readonly minuto: number }
  | { readonly tipo: 'mensal'; readonly dia: number; readonly minuto: number };

/**
 * Lê a agenda: diária "HH:MM"; semanal "seg HH:MM" (dom a sab); mensal "DD HH:MM" (dia 1 a 28, para caber em todo mês).
 * null quando não confere com a periodicidade.
 */
export function lerAgenda(periodicidade: PeriodicidadePacote, agenda: string | null): AgendaLida | null {
  if (periodicidade === 'sob_demanda' || !agenda) return null;
  const hora = (h: string) => {
    const m = /^(\d{2}):(\d{2})$/.exec(h);
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const partes = agenda.trim().toLowerCase().split(/\s+/);
  if (periodicidade === 'diaria') {
    const m = partes.length === 1 ? hora(partes[0]!) : null;
    return m === null ? null : { tipo: 'diaria', minuto: m };
  }
  if (partes.length !== 2) return null;
  const m = hora(partes[1]!);
  if (m === null) return null;
  if (periodicidade === 'semanal') {
    const d = (DIAS_SEMANA as readonly string[]).indexOf(partes[0]!);
    return d < 0 ? null : { tipo: 'semanal', diaSemana: d, minuto: m };
  }
  const dia = /^\d{1,2}$/.test(partes[0]!) ? Number(partes[0]) : 0;
  return dia >= 1 && dia <= 28 ? { tipo: 'mensal', dia, minuto: m } : null;
}

/** Conferência do pacote e dos campos na hora do cadastro (vazio = aceito). */
export function validarPacote(p: Pacote, campos: readonly CampoPacote[]): ErroPacote[] {
  const e: ErroPacote[] = [];
  if (!p.codigo.trim()) e.push(erro('codigo', 'codigo-obrigatorio', 'Informe o código do pacote.'));
  if (!p.nome.trim()) e.push(erro('nome', 'nome-obrigatorio', 'Informe o nome do pacote.'));
  if (!p.conteudo.trim()) e.push(erro('conteudo', 'conteudo-obrigatorio', 'Descreva o conteúdo do pacote.'));
  if (!meioAceitaFormato(p.meioEntrega, p.formato))
    e.push(
      erro('formato', 'formato-incompativel', `O meio ${p.meioEntrega} não leva o formato ${p.formato}.`),
    );
  if (p.periodicidade !== 'sob_demanda' && !lerAgenda(p.periodicidade, p.agenda))
    e.push(
      erro(
        'agenda',
        'agenda-invalida',
        p.periodicidade === 'diaria'
          ? 'Agenda diária no formato HH:MM.'
          : p.periodicidade === 'semanal'
            ? 'Agenda semanal no formato "seg HH:MM".'
            : 'Agenda mensal no formato "DD HH:MM", dia de 1 a 28.',
      ),
    );
  if (p.periodicidade === 'sob_demanda' && p.agenda)
    e.push(erro('agenda', 'agenda-sem-periodicidade', 'Pacote sob demanda não tem agenda.'));
  if (p.janelaDias !== null && (p.janelaDias < 1 || p.janelaDias > 366))
    e.push(erro('janelaDias', 'janela-invalida', 'A janela de dados vai de 1 a 366 dias.'));
  if (!campos.length) e.push(erro('campos', 'sem-campos', 'O pacote precisa de pelo menos um campo.'));
  const seq = new Set<number>();
  const chave = new Set<string>();
  campos.forEach((c, i) => {
    const k = `${c.entidade}.${c.campo}`;
    if (seq.has(c.sequencia))
      e.push(erro(`campos.${i}.sequencia`, 'sequencia-repetida', 'Sequência repetida.'));
    if (chave.has(k)) e.push(erro(`campos.${i}.campo`, 'campo-repetido', `Campo ${k} repetido.`));
    seq.add(c.sequencia);
    chave.add(k);
    if (!c.entidade.trim() || !c.campo.trim() || !c.rotuloSaida.trim())
      e.push(erro(`campos.${i}`, 'campo-incompleto', 'Informe a entidade, o campo e o rótulo de saída.'));
    if (c.justificativa.trim().length < 10)
      e.push(
        erro(
          `campos.${i}.justificativa`,
          'justificativa-obrigatoria',
          'Justifique por que o parceiro precisa do campo (minimização).',
        ),
      );
    if (c.dadoSensivel && c.tratamento === 'original' && p.anonimizacao !== 'nenhuma')
      e.push(
        erro(
          `campos.${i}.tratamento`,
          'sensivel-sem-tratamento',
          `O pacote é ${p.anonimizacao}: o campo sensível ${k} não pode sair original.`,
        ),
      );
    if (p.anonimizacao === 'agregada' && c.tratamento !== 'agregado' && c.tratamento !== 'generalizado')
      e.push(
        erro(
          `campos.${i}.tratamento`,
          'agregada-com-individual',
          `O pacote é agregado: o campo ${k} tem de sair agregado ou generalizado.`,
        ),
      );
  });
  return e;
}

const MIN = 60_000;
const DIA = 24 * 60 * MIN;

/** O último instante agendado (local, pelo fuso) que já chegou até agora. */
export function ultimoAgendado(agenda: AgendaLida, agora: Date, fusoMinutos = -180): Date {
  const local = new Date(agora.getTime() + fusoMinutos * MIN);
  const meiaNoite = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const paraUtc = (localMs: number) => new Date(localMs - fusoMinutos * MIN);
  if (agenda.tipo === 'diaria') {
    const hoje = meiaNoite + agenda.minuto * MIN;
    return paraUtc(hoje <= local.getTime() ? hoje : hoje - DIA);
  }
  if (agenda.tipo === 'semanal') {
    const recuo = (local.getUTCDay() - agenda.diaSemana + 7) % 7;
    const alvo = meiaNoite - recuo * DIA + agenda.minuto * MIN;
    return paraUtc(alvo <= local.getTime() ? alvo : alvo - 7 * DIA);
  }
  const doMes = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), agenda.dia) + agenda.minuto * MIN;
  if (doMes <= local.getTime()) return paraUtc(doMes);
  return paraUtc(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, agenda.dia) + agenda.minuto * MIN);
}

/**
 * A próxima entrega devida: o período vai do fim da última entrega (ou do agendado menos a janela/periodicidade, na
 * primeira) até o último instante agendado. null quando nada está devido (ainda não chegou a hora ou o período já foi
 * entregue). Pacote sob demanda: o período é informado por quem pede.
 */
export function entregaDevida(p: {
  readonly periodicidade: PeriodicidadePacote;
  readonly agenda: string | null;
  readonly janelaDias: number | null;
  readonly ultimoFim: Date | null;
  readonly agora: Date;
  readonly fusoMinutos?: number;
}): { inicio: Date; fim: Date } | null {
  const a = lerAgenda(p.periodicidade, p.agenda);
  if (!a) return null;
  const fim = ultimoAgendado(a, p.agora, p.fusoMinutos);
  if (p.ultimoFim && p.ultimoFim.getTime() >= fim.getTime()) return null;
  const passo = a.tipo === 'diaria' ? DIA : a.tipo === 'semanal' ? 7 * DIA : 0;
  let inicio: Date;
  if (p.janelaDias !== null) inicio = new Date(fim.getTime() - p.janelaDias * DIA);
  else if (passo) inicio = new Date(fim.getTime() - passo);
  else {
    const f = new Date(fim);
    inicio = new Date(
      Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes()),
    );
  }
  if (p.ultimoFim && p.janelaDias === null) inicio = p.ultimoFim;
  return { inicio, fim };
}

const TRANSICOES: Readonly<Record<SituacaoEntrega, readonly SituacaoEntrega[]>> = {
  gerada: ['enviada', 'falhou'],
  enviada: ['confirmada', 'rejeitada', 'falhou'],
  confirmada: [],
  rejeitada: [],
  falhou: [],
};

/** A entrega só anda para a frente: gerada → enviada → confirmada ou rejeitada; falha a qualquer momento antes. */
export function podeMudarEntrega(atual: SituacaoEntrega, nova: SituacaoEntrega): boolean {
  return TRANSICOES[atual].includes(nova);
}

/** A revisão do pacote (a minimização) venceu? */
export function revisaoVencida(proximaRevisao: string | null, hoje: string): boolean {
  return proximaRevisao !== null && proximaRevisao < hoje;
}
