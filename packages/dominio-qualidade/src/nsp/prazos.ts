// Regra 3 do M48 (cap-05b §5.11, Prazos legais; cap-13 §13.7 ponto 11; RDC 36/2013, art. 10; NT GVIMS/GGTES/Anvisa
// 05/2019; DP-47.8):
//   - evento adverso com óbito: notificar ao Notivisa em até 72 h da ocorrência;
//   - demais eventos adversos: até o 15º dia útil do mês seguinte ao da ocorrência (fim do dia);
//   - óbito e never event: completar a análise de causa raiz (etapas 5 a 10 do formulário) em até 60 dias corridos.
//     Base: a data da OCORRÊNCIA (decisão do preparo, D-PRAZO-48.1): a nota técnica conta da notificação, que é sempre
//     depois da ocorrência; contar da ocorrência nunca deixa o prazo passar (fica igual ou mais cedo);
//   - a contagem regressiva usa o calendário configurado (cadastro de feriados; ano 9999 = todo ano). Feriado móvel
//     que não está no cadastro do ano NÃO é inventado (o prazo fica igual ou mais cedo, nunca depois): a tela avisa
//     (`feriadosMoveisAusentes`), como a geração da agenda do M17.
// Instantes são locais (o horário de parede do estabelecimento, `AAAA-MM-DDTHH:mm:ss`), como o núcleo do legado lê;
// o Brasil não tem horário de verão desde 2019, e a conta é feita em UTC sobre o texto local.
import type {
  ClassificacaoOms,
  GrauDano,
  PrazoRegulatorio,
  SituacaoPrazo,
  TipoPrazoRegulatorio,
} from '@sgh/contratos';
import { ehObito, notivisaObrigatorio } from './classificacao.js';

const MIN = 60_000;
const DIA = 86_400_000;

/** Antecedência padrão do aviso "vence em breve" (minutos): 24 h. */
export const ANTECEDENCIA_AVISO_MIN = 24 * 60;
export const HORAS_NOTIVISA_OBITO = 72;
export const DIA_UTIL_NOTIVISA_MENSAL = 15;
export const DIAS_ANALISE_CAUSA_RAIZ = 60;

export interface FeriadoCadastrado {
  /** AAAA-MM-DD; ano 9999 vale todo ano. */
  readonly data: string;
  readonly nome?: string;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Texto local → milissegundos (o texto lido como se fosse UTC). */
export function msLocal(instante: string): number {
  const t =
    instante.length === 10 ? `${instante}T00:00:00` : instante.length === 16 ? `${instante}:00` : instante;
  const ms = Date.parse(`${t.slice(0, 19)}Z`);
  if (Number.isNaN(ms)) throw new Error(`Instante inválido: ${instante}`);
  return ms;
}

/** Milissegundos → texto local `AAAA-MM-DDTHH:mm:ss`. */
export function instanteDeMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/** O calendário de feriados dos anos pedidos (os recorrentes do ano 9999 expandidos). */
export function calendarioDeFeriados(
  feriados: readonly FeriadoCadastrado[],
  anos: readonly number[],
): ReadonlySet<string> {
  const s = new Set<string>();
  for (const f of feriados) {
    const d = f.data.slice(0, 10);
    if (d.startsWith('9999-')) for (const a of anos) s.add(`${a}${d.slice(4)}`);
    else s.add(d);
  }
  return s;
}

/** Segunda a sexta e fora dos feriados do calendário. */
export function diaUtil(data: string, feriados: ReadonlySet<string>): boolean {
  const semana = new Date(msLocal(data.slice(0, 10))).getUTCDay();
  return semana >= 1 && semana <= 5 && !feriados.has(data.slice(0, 10));
}

/** O n-ésimo dia útil do mês (1 a 12), AAAA-MM-DD. */
export function enesimoDiaUtilDoMes(
  ano: number,
  mes: number,
  n: number,
  feriados: ReadonlySet<string>,
): string {
  if (!Number.isInteger(n) || n < 1 || n > 23) throw new Error('Dia útil fora do mês.');
  let ms = Date.UTC(ano, mes - 1, 1);
  let contados = 0;
  for (;;) {
    const d = instanteDeMs(ms).slice(0, 10);
    if (Number(d.slice(5, 7)) !== mes) throw new Error('O mês não tem tantos dias úteis.');
    if (diaUtil(d, feriados) && ++contados === n) return d;
    ms += DIA;
  }
}

/** Prazo do óbito: 72 h depois da ocorrência. */
export function prazoNotivisaObito(ocorridoEm: string): string {
  return instanteDeMs(msLocal(ocorridoEm) + HORAS_NOTIVISA_OBITO * 3_600_000);
}

/** Prazo mensal: o fim do 15º dia útil do mês seguinte ao da ocorrência. */
export function prazoNotivisaMensal(ocorridoEm: string, feriados: ReadonlySet<string>): string {
  const ano = Number(ocorridoEm.slice(0, 4));
  const mes = Number(ocorridoEm.slice(5, 7));
  const [a, m] = mes === 12 ? [ano + 1, 1] : [ano, mes + 1];
  return `${enesimoDiaUtilDoMes(a, m, DIA_UTIL_NOTIVISA_MENSAL, feriados)}T23:59:59`;
}

/** Prazo da análise de causa raiz: o fim do 60º dia corrido depois da ocorrência. */
export function prazoAnaliseCausaRaiz(ocorridoEm: string): string {
  return `${instanteDeMs(msLocal(ocorridoEm.slice(0, 10)) + DIAS_ANALISE_CAUSA_RAIZ * DIA).slice(0, 10)}T23:59:59`;
}

/** Situação de um prazo no instante `agora` (cumprido quando há a data de cumprimento). */
export function situacaoDoPrazo(
  venceEm: string,
  agora: string,
  cumpridoEm: string | null,
  antecedenciaMin = ANTECEDENCIA_AVISO_MIN,
): { readonly situacao: SituacaoPrazo; readonly minutosRestantes: number | null } {
  if (cumpridoEm !== null) return { situacao: 'cumprido', minutosRestantes: null };
  const resta = Math.floor((msLocal(venceEm) - msLocal(agora)) / MIN);
  if (resta < 0) return { situacao: 'vencido', minutosRestantes: resta };
  return { situacao: resta <= antecedenciaMin ? 'venceEmBreve' : 'noPrazo', minutosRestantes: resta };
}

/** O que os prazos de uma notificação precisam saber. */
export interface EstadoParaPrazos {
  readonly ocorridoEm: string;
  /** A classificação da triagem ou, antes dela, a proposta do que o notificador respondeu (o relógio já corre). */
  readonly classificacao: ClassificacaoOms;
  readonly dano: GrauDano;
  readonly neverEvent: boolean;
  /** Quando o NSP registrou a transcrição no Notivisa (cumpre o prazo do Notivisa). */
  readonly notivisaTranscritaEm: string | null;
  /** Quando a análise de causa raiz foi concluída (etapa 2; cumpre o prazo de 60 dias). */
  readonly analiseConcluidaEm: string | null;
  /** Descartada na triagem: nenhum prazo corre. */
  readonly descartada: boolean;
}

function prazo(
  tipo: TipoPrazoRegulatorio,
  venceEm: string,
  agora: string,
  cumpridoEm: string | null,
  antecedenciaMin: number,
): PrazoRegulatorio {
  return { tipo, venceEm, ...situacaoDoPrazo(venceEm, agora, cumpridoEm, antecedenciaMin) };
}

/** Os prazos regulatórios da notificação (regra 3). */
export function prazosDaNotificacao(
  e: EstadoParaPrazos,
  agora: string,
  feriados: ReadonlySet<string>,
  antecedenciaMin = ANTECEDENCIA_AVISO_MIN,
): PrazoRegulatorio[] {
  if (e.descartada) return [];
  const r: PrazoRegulatorio[] = [];
  const obito = ehObito(e.classificacao, e.dano);
  if (obito)
    r.push(
      prazo(
        'notivisaObito',
        prazoNotivisaObito(e.ocorridoEm),
        agora,
        e.notivisaTranscritaEm,
        antecedenciaMin,
      ),
    );
  else if (notivisaObrigatorio(e.classificacao))
    r.push(
      prazo(
        'notivisaMensal',
        prazoNotivisaMensal(e.ocorridoEm, feriados),
        agora,
        e.notivisaTranscritaEm,
        antecedenciaMin,
      ),
    );
  if (obito || e.neverEvent)
    r.push(
      prazo(
        'analiseCausaRaiz',
        prazoAnaliseCausaRaiz(e.ocorridoEm),
        agora,
        e.analiseConcluidaEm,
        antecedenciaMin * 7,
      ),
    );
  return r;
}

/** O prazo aberto que vence primeiro (a ordem da fila de prazos), ou null. */
export function proximoPrazoAberto(prazos: readonly PrazoRegulatorio[]): PrazoRegulatorio | null {
  let melhor: PrazoRegulatorio | null = null;
  for (const p of prazos)
    if (p.situacao !== 'cumprido' && (melhor === null || p.venceEm < melhor.venceEm)) melhor = p;
  return melhor;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), AAAA-MM-DD. */
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
  return `${ano}-${p2(mes)}-${p2(dia)}`;
}

/** Os feriados móveis nacionais (Carnaval segunda e terça, Sexta-feira Santa, Corpus Christi) do ano. */
export function feriadosMoveis(ano: number): { readonly data: string; readonly nome: string }[] {
  const p = msLocal(pascoa(ano));
  const em = (dias: number) => instanteDeMs(p + dias * DIA).slice(0, 10);
  return [
    { data: em(-48), nome: 'Carnaval (segunda-feira)' },
    { data: em(-47), nome: 'Carnaval (terça-feira)' },
    { data: em(-2), nome: 'Sexta-feira Santa' },
    { data: em(60), nome: 'Corpus Christi' },
  ];
}

/** Os feriados móveis do ano que não estão no calendário (a tela de prazos avisa para cadastrar). */
export function feriadosMoveisAusentes(
  ano: number,
  feriados: ReadonlySet<string>,
): { readonly data: string; readonly nome: string }[] {
  return feriadosMoveis(ano).filter((f) => !feriados.has(f.data));
}
