// Gerador de horários da agenda (ficha do M17, `agenda.gerarGrade` e regras 4 e 5; ref 01 §2.1, §3.2 e §4.2;
// sante-api: src/services/acoes-grade.js, como especificação de regra, nunca de dado). Monta a PRÉVIA que a
// pessoa aprova antes de gravar; a receita reconfere sob a trava da agenda e grava exatamente a prévia.
//   - Faixa da escala: início inclusivo, fim EXCLUSIVO (08:00 a 12:00 com 15 min → último 11:45); intervalo:
//     nenhum horário COMEÇA dentro de [início, fim). Horas em "HH:MM".
//   - Duração em minutos (5 a 240); uma duração por geração.
//   - Janela até 120 dias e 400 horários; começa hoje ou depois; hoje só a partir de 1 h à frente do relógio do
//     banco (o resto da janela vale inteiro).
//   - Feriados do cadastro pulados (ano 9999 = todo ano); feriado móvel não cadastrado no ano vira alerta (a base
//     de origem só tem os móveis de 2020: Carnaval, Sexta-feira Santa e Corpus Christi vazam na grade).
//   - Bloqueios da agenda pulados; horário que já existe na agenda (mesmo dia e hora) é pulado (a unicidade
//     recusaria e derrubaria a transação).
//   - Sábado e domingo: nunca vistos nas gerações da base de origem (escalas só de segunda a sexta): recusados
//     enquanto o valor não for visto (parâmetro `semanasPermitidas`).
import {
  datasEntre,
  deMinutos,
  diasEntre,
  duracaoEmHoras,
  ErroTempo,
  normalizarHora,
  paraMinutos,
  type Relogio,
  semanaDaData,
  somarDias,
} from './tempo.js';

export const TETO_HORARIOS_GERACAO = 400;
export const MAX_DIAS_GERACAO = 120;
export const DURACAO_MINIMA = 5;
export const DURACAO_MAXIMA = 240;
export const ANTECEDENCIA_HOJE_MIN = 60;
/** Dias da semana que o legado gera (2 = segunda … 6 = sexta). */
export const SEMANAS_VISTAS: readonly number[] = [2, 3, 4, 5, 6];

export const NOME_DO_DIA: Readonly<Record<number, string>> = {
  1: 'domingo',
  2: 'segunda-feira',
  3: 'terça-feira',
  4: 'quarta-feira',
  5: 'quinta-feira',
  6: 'sexta-feira',
  7: 'sábado',
};

export interface FaixaEscala {
  /** 1 = domingo … 7 = sábado. */
  readonly semana: number;
  /** "HH:MM" (a leitura aceita também a hora digitada sem os dois-pontos). */
  readonly inicio: string;
  /** Fim exclusivo da faixa. */
  readonly fim: string;
  readonly intervaloInicio?: string | null;
  readonly intervaloFim?: string | null;
}

export interface Feriado {
  /** AAAA-MM-DD; o ano 9999 vale para todo ano. */
  readonly data: string;
  readonly nome: string;
}

/** Bloqueio do novo: período de datas e, opcionalmente, a faixa de horas do dia (fim exclusivo). */
export interface BloqueioPeriodo {
  readonly inicio: string;
  readonly fim: string;
  readonly horaInicio?: string | null;
  readonly horaFim?: string | null;
}

export interface PedidoGrade {
  readonly de: string;
  readonly ate: string;
  readonly duracaoMinutos: number;
  readonly faixas: readonly FaixaEscala[];
  /** Gera também nos feriados cadastrados (o atendimento vai acontecer). */
  readonly incluirFeriados?: boolean;
}

export interface ContextoGrade {
  readonly relogio: Relogio;
  readonly agendaAtiva: boolean;
  readonly feriados: readonly Feriado[];
  readonly bloqueios: readonly BloqueioPeriodo[];
  /** Chaves 'AAAA-MM-DD HH:MM' que já existem na agenda (qualquer tipo de horário). */
  readonly existentes: ReadonlySet<string>;
  readonly semanasPermitidas?: readonly number[];
  readonly teto?: number;
}

export type CodigoVeto =
  | 'agenda-inativa'
  | 'janela-invalida'
  | 'janela-no-passado'
  | 'janela-longa'
  | 'duracao-invalida'
  | 'faixa-invalida'
  | 'dia-nao-visto'
  | 'sem-horario'
  | 'acima-do-teto';

export class VetoGrade extends Error {
  override readonly name = 'VetoGrade';
  readonly codigo: CodigoVeto;
  constructor(codigo: CodigoVeto, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export interface HorarioPlanejado {
  readonly data: string;
  readonly hora: string;
}

export interface LinhaEscalaPlanejada {
  readonly semana: number;
  /** Duração de um atendimento em horas e minutos ("00:15"). */
  readonly duracao: string;
  readonly horaInicio: string;
  readonly horaFim: string;
  /** null = sem intervalo. */
  readonly intervaloInicio: string | null;
  readonly intervaloFim: string | null;
}

export interface AlertaGrade {
  readonly codigo: 'feriado-movel' | 'corte-hoje' | 'agendavel-imediatamente' | 'feriado-incluido';
  readonly texto: string;
}

export interface PlanoGrade {
  readonly horarios: readonly HorarioPlanejado[];
  readonly duracao: string;
  readonly porDia: readonly { data: string; semana: number; horarios: readonly string[] }[];
  readonly pulados: {
    readonly feriados: readonly { data: string; nome: string }[];
    readonly bloqueados: number;
    readonly existentes: number;
    readonly cortadosHoje: readonly string[];
  };
  readonly escala: readonly LinhaEscalaPlanejada[];
  /** Dias da semana da geração, de domingo a sábado ('T' = gera, 'F' = não gera). */
  readonly semanas: readonly ('T' | 'F')[];
  readonly alertas: readonly AlertaGrade[];
}

/** Intervalo ausente na escala lida (vazio, nulo ou meia-noite nas duas pontas). */
const semIntervalo = (h: string | null | undefined) => !h || paraMinutos(h) === 0;

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Feriados móveis nacionais do ano (os três que o legado cadastrou só para 2020). */
export function feriadosMoveis(ano: number): Feriado[] {
  const p = pascoa(ano);
  return [
    { data: somarDias(p, -47), nome: 'Carnaval' },
    { data: somarDias(p, -2), nome: 'Sexta-feira Santa' },
    { data: somarDias(p, 60), nome: 'Corpus Christi' },
  ];
}

/** Feriado cadastrado que cai na data (ano 9999 = todo ano). */
export function feriadoNaData(data: string, feriados: readonly Feriado[]): Feriado | null {
  const md = data.slice(5);
  return (
    feriados.find((f) => f.data === data) ??
    feriados.find((f) => f.data.startsWith('9999-') && f.data.slice(5) === md) ??
    null
  );
}

function bloqueado(data: string, hora: string, bloqueios: readonly BloqueioPeriodo[]): boolean {
  const m = paraMinutos(hora);
  return bloqueios.some((b) => {
    if (data < b.inicio || data > b.fim) return false;
    if (!b.horaInicio || !b.horaFim) return true;
    return m >= paraMinutos(normalizarHora(b.horaInicio)) && m < paraMinutos(normalizarHora(b.horaFim));
  });
}

export interface FaixaNormal {
  readonly semana: number;
  readonly ini: number;
  readonly fim: number;
  readonly ivIni: number | null;
  readonly ivFim: number | null;
  readonly linha: Omit<LinhaEscalaPlanejada, 'duracao'>;
}

function normalizarFaixa(f: FaixaEscala, duracao: number, permitidas: readonly number[]): FaixaNormal {
  if (!Number.isInteger(f.semana) || f.semana < 1 || f.semana > 7)
    throw new VetoGrade('faixa-invalida', 'Dia da semana inválido (1 = domingo … 7 = sábado).');
  if (!permitidas.includes(f.semana))
    throw new VetoGrade(
      'dia-nao-visto',
      `A agenda não gera horários de ${NOME_DO_DIA[f.semana]}: nenhuma geração de sábado ou domingo foi vista no banco do estabelecimento.`,
    );
  let inicio: string;
  let fim: string;
  try {
    inicio = normalizarHora(f.inicio);
    fim = normalizarHora(f.fim);
  } catch (e) {
    throw new VetoGrade('faixa-invalida', e instanceof ErroTempo ? e.message : 'Faixa inválida.');
  }
  const ini = paraMinutos(inicio);
  const fi = paraMinutos(fim);
  if (fi <= ini) throw new VetoGrade('faixa-invalida', 'O fim da faixa vem antes do início.');
  if (fi - ini < duracao)
    throw new VetoGrade('faixa-invalida', 'A faixa é menor que a duração de um atendimento.');
  let ivIni: number | null = null;
  let ivFim: number | null = null;
  let intervaloInicio: string | null = null;
  let intervaloFim: string | null = null;
  if (f.intervaloInicio && f.intervaloFim) {
    try {
      intervaloInicio = normalizarHora(f.intervaloInicio);
      intervaloFim = normalizarHora(f.intervaloFim);
    } catch {
      throw new VetoGrade('faixa-invalida', 'Intervalo inválido: use HH:MM.');
    }
    ivIni = paraMinutos(intervaloInicio);
    ivFim = paraMinutos(intervaloFim);
    if (ivFim <= ivIni || ivIni < ini || ivFim > fi)
      throw new VetoGrade(
        'faixa-invalida',
        'O intervalo tem de ficar dentro da faixa, com fim depois do início.',
      );
  } else if (f.intervaloInicio || f.intervaloFim) {
    throw new VetoGrade('faixa-invalida', 'Informe o início e o fim do intervalo, ou nenhum dos dois.');
  }
  return {
    semana: f.semana,
    ini,
    fim: fi,
    ivIni,
    ivFim,
    linha: { semana: f.semana, horaInicio: inicio, horaFim: fim, intervaloInicio, intervaloFim },
  };
}

/** Horários de uma faixa num dia (sem o intervalo; o atendimento termina dentro da faixa). */
export function horariosDaFaixa(f: FaixaNormal, duracao: number): string[] {
  const r: string[] = [];
  for (let m = f.ini; m + duracao <= f.fim; m += duracao) {
    if (f.ivIni !== null && f.ivFim !== null && m >= f.ivIni && m < f.ivFim) continue;
    r.push(deMinutos(m));
  }
  return r;
}

/** Prévia da geração (nada é gravado): lança VetoGrade com o motivo em português. */
export function planejarGrade(p: PedidoGrade, c: ContextoGrade): PlanoGrade {
  if (!c.agendaAtiva)
    throw new VetoGrade('agenda-inativa', 'A agenda está inativa: gerar horários nela não serve a ninguém.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.de) || !/^\d{4}-\d{2}-\d{2}$/.test(p.ate) || p.ate < p.de)
    throw new VetoGrade('janela-invalida', 'Período inválido: o fim vem antes do início.');
  if (p.de < c.relogio.hoje)
    throw new VetoGrade(
      'janela-no-passado',
      `O período começa antes de hoje (${c.relogio.hoje}): horário no passado não é oferecido a ninguém.`,
    );
  if (diasEntre(p.de, p.ate) + 1 > MAX_DIAS_GERACAO)
    throw new VetoGrade(
      'janela-longa',
      `O período passa de ${MAX_DIAS_GERACAO} dias: divida a geração em partes menores.`,
    );
  if (
    !Number.isInteger(p.duracaoMinutos) ||
    p.duracaoMinutos < DURACAO_MINIMA ||
    p.duracaoMinutos > DURACAO_MAXIMA
  )
    throw new VetoGrade(
      'duracao-invalida',
      `A duração tem de ficar entre ${DURACAO_MINIMA} e ${DURACAO_MAXIMA} minutos.`,
    );
  if (p.faixas.length === 0) throw new VetoGrade('faixa-invalida', 'Informe ao menos uma faixa de horários.');
  const duracao = p.duracaoMinutos;
  const permitidas = c.semanasPermitidas ?? SEMANAS_VISTAS;
  const faixas = p.faixas.map((f) => normalizarFaixa(f, duracao, permitidas));
  // Faixas sobrepostas no mesmo dia criariam o mesmo horário duas vezes.
  for (const a of faixas)
    for (const b of faixas)
      if (a !== b && a.semana === b.semana && a.ini < b.fim && b.ini < a.fim)
        throw new VetoGrade(
          'faixa-invalida',
          `Faixas sobrepostas na ${NOME_DO_DIA[a.semana]}: separe os horários de cada faixa.`,
        );
  const teto = c.teto ?? TETO_HORARIOS_GERACAO;
  const primeiroHoje = paraMinutos(c.relogio.hhmm) + ANTECEDENCIA_HOJE_MIN;
  // As chaves existentes comparadas na mesma forma ("AAAA-MM-DD HH:MM"), venham com ou sem os dois-pontos.
  const jaExistem = new Set(
    [...c.existentes].map((k) => {
      const [d, h] = k.split(' ');
      return `${d} ${h ? normalizarHora(h) : ''}`;
    }),
  );
  const horarios: HorarioPlanejado[] = [];
  const porDia: { data: string; semana: number; horarios: string[] }[] = [];
  const feriadosPulados: { data: string; nome: string }[] = [];
  const cortadosHoje: string[] = [];
  let bloqueados = 0;
  let existentes = 0;
  const alertas: AlertaGrade[] = [];
  const moveisAvisados = new Set<string>();
  for (const data of datasEntre(p.de, p.ate)) {
    const semana = semanaDaData(data);
    const doDia = faixas.filter((f) => f.semana === semana);
    if (doDia.length === 0) continue;
    const feriado = feriadoNaData(data, c.feriados);
    if (feriado && !p.incluirFeriados) {
      feriadosPulados.push({ data, nome: feriado.nome });
      continue;
    }
    if (feriado && p.incluirFeriados)
      alertas.push({
        codigo: 'feriado-incluido',
        texto: `${data} é feriado (${feriado.nome}) e terá horários, como pedido.`,
      });
    if (!feriado) {
      const movel = feriadosMoveis(Number(data.slice(0, 4))).find((m) => m.data === data);
      if (movel && !moveisAvisados.has(data)) {
        moveisAvisados.add(data);
        alertas.push({
          codigo: 'feriado-movel',
          texto: `${data} é ${movel.nome}, que não está no cadastro de feriados deste ano: confirme se haverá atendimento ou cadastre o feriado.`,
        });
      }
    }
    const dia: string[] = [];
    for (const f of doDia)
      for (const hora of horariosDaFaixa(f, duracao)) {
        if (data === c.relogio.hoje && paraMinutos(hora) < primeiroHoje) {
          cortadosHoje.push(hora);
          continue;
        }
        if (jaExistem.has(`${data} ${hora}`)) {
          existentes++;
          continue;
        }
        if (bloqueado(data, hora, c.bloqueios)) {
          bloqueados++;
          continue;
        }
        dia.push(hora);
      }
    dia.sort();
    if (dia.length > 0) {
      porDia.push({ data, semana, horarios: dia });
      for (const hora of dia) horarios.push({ data, hora });
    }
  }
  if (cortadosHoje.length > 0)
    alertas.push({
      codigo: 'corte-hoje',
      texto: `Hoje os horários só nascem a partir de 1 hora à frente: ${cortadosHoje.length} horário(s) de hoje ficaram de fora.`,
    });
  if (horarios.length === 0)
    throw new VetoGrade(
      'sem-horario',
      existentes > 0
        ? `Nenhum horário novo: os ${existentes} horário(s) da faixa já existem na agenda.`
        : 'Nenhum horário a criar no período (feriados, bloqueios ou corte de hoje).',
    );
  if (horarios.length > teto)
    throw new VetoGrade(
      'acima-do-teto',
      `A geração criaria ${horarios.length} horários, acima do teto de ${teto} por vez: divida o período.`,
    );
  alertas.push({
    codigo: 'agendavel-imediatamente',
    texto: `Os ${horarios.length} horários ficam disponíveis para marcação assim que a geração for gravada.`,
  });
  const dur = duracaoEmHoras(duracao);
  // O modelo da semana é o da escala pedida inteira, também no dia pulado por feriado.
  const escala = faixas
    .map((f) => ({ ...f.linha, duracao: dur }))
    .sort((a, b) => a.semana - b.semana || a.horaInicio.localeCompare(b.horaInicio));
  const pedidas = new Set(faixas.map((f) => f.semana));
  return {
    horarios,
    duracao: dur,
    porDia,
    pulados: { feriados: feriadosPulados, bloqueados, existentes, cortadosHoje },
    escala,
    semanas: [1, 2, 3, 4, 5, 6, 7].map((s) => (pedidas.has(s) ? 'T' : 'F')),
    alertas,
  };
}

/** Linha do modelo da escala como lida (horas "HH:MM"; intervalo nulo = sem intervalo). */
export interface LinhaEscala {
  readonly semana: number;
  readonly duracao: string;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly intervaloInicio: string | null;
  readonly intervaloFim: string | null;
}

export interface MudancaEscala {
  readonly acao: 'incluir' | 'alterar' | 'manter';
  readonly linha: LinhaEscalaPlanejada;
  /** Valores anteriores (alterar), para restaurar na reversão. */
  readonly anterior: Pick<LinhaEscala, 'horaFim' | 'intervaloInicio' | 'intervaloFim'> | null;
}

/** Comparação do modelo: a chave é (dia da semana, duração, início); alterar só o fim e o intervalo. */
export function mudancasDaEscala(
  atual: readonly LinhaEscala[],
  alvo: readonly LinhaEscalaPlanejada[],
): MudancaEscala[] {
  return alvo.map((l) => {
    const a = atual.find(
      (x) => x.semana === l.semana && x.duracao === l.duracao && x.horaInicio === l.horaInicio,
    );
    if (!a) return { acao: 'incluir', linha: l, anterior: null };
    const igual =
      a.horaFim === l.horaFim && a.intervaloInicio === l.intervaloInicio && a.intervaloFim === l.intervaloFim;
    return {
      acao: igual ? 'manter' : 'alterar',
      linha: l,
      anterior: { horaFim: a.horaFim, intervaloInicio: a.intervaloInicio, intervaloFim: a.intervaloFim },
    };
  });
}

/** Faixas da escala como pedido de geração. */
export function faixasDaEscala(linhas: readonly LinhaEscala[]): FaixaEscala[] {
  return linhas.map((l) => ({
    semana: l.semana,
    inicio: l.horaInicio,
    fim: l.horaFim,
    intervaloInicio:
      semIntervalo(l.intervaloInicio) || semIntervalo(l.intervaloFim) ? null : l.intervaloInicio,
    intervaloFim: semIntervalo(l.intervaloInicio) || semIntervalo(l.intervaloFim) ? null : l.intervaloFim,
  }));
}
