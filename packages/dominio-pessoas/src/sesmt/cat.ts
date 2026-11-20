// Acidente de trabalho e CAT (regra 18; NR32-02; cap-07 §7.1.4; Lei 8.213/1991, art. 22): o acidente com material
// biológico pede a avaliação da profilaxia pós-exposição e o acompanhamento sorológico (marcos de 0, 30, 90 e 180 dias),
// e todo acidente tem o prazo da CAT, em dias úteis depois do acidente (parâmetro, 1 por padrão; óbito: no mesmo dia).
// A fonte do material biológico nunca é identificada: só se é conhecida e o teste rápido dela.
import {
  CODIGOS_MARCO_SOROLOGIA,
  type ExposicaoBiologica,
  MARCOS_SOROLOGIA,
  type MarcoSorologia,
  type MaterialBiologico,
  type PendenciaSesmt,
  PRAZO_CAT_DIAS_UTEIS,
  type SituacaoProfilaxia,
  type TesteFonte,
} from '@sgh/contratos';
import { dataDe, diaUtc, diasEntre } from '../datas.js';
import { recusaSesmt, type RecusaSesmt } from './recusa.js';

const p2 = (x: number) => String(x).padStart(2, '0');
function deUtc(dia: number): string {
  const d = new Date(dia * 86_400_000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
export function somarDias(data: string, dias: number): string {
  return deUtc(diaUtc(data) + dias);
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), para a Sexta-feira Santa. */
function pascoa(ano: number): string {
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

const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

/** Feriado nacional (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023) ou a Sexta-feira Santa. */
export function feriadoNacional(data: string): boolean {
  if (FIXOS.includes(data.slice(5))) return true;
  return somarDias(pascoa(Number(data.slice(0, 4))), -2) === data;
}

export function diaUtil(data: string): boolean {
  const semana = new Date(diaUtc(data) * 86_400_000).getUTCDay();
  return semana !== 0 && semana !== 6 && !feriadoNacional(data);
}

/**
 * O prazo da CAT (regra 18): o n-ésimo dia útil depois do dia do acidente; óbito: o próprio dia (comunicação
 * imediata à autoridade). Os feriados estaduais e municipais ficam fora (o prazo só fica mais curto, nunca mais longo).
 */
export function prazoCat(
  ocorridoEm: string,
  obito: boolean,
  diasUteis: number = PRAZO_CAT_DIAS_UTEIS,
): string {
  const dia = dataDe(ocorridoEm);
  if (obito || diasUteis <= 0) return dia;
  let d = dia;
  let n = 0;
  while (n < diasUteis) {
    d = somarDias(d, 1);
    if (diaUtil(d)) n++;
  }
  return d;
}

export interface ExposicaoAcidente {
  readonly biologico: boolean;
  readonly perfurocortante: boolean;
  readonly exposicao: ExposicaoBiologica | null;
  readonly material: MaterialBiologico | null;
  readonly fonteTeste: TesteFonte | null;
}

/**
 * A profilaxia é avaliada em toda exposição a material biológico de risco (percutânea, mucosa ou pele não íntegra a
 * sangue ou fluido com sangue) que não seja de fonte sabidamente não reagente; a pele íntegra e o fluido sem sangue
 * não indicam a profilaxia (PCDT de PEP). A decisão final é do médico; aqui, a sugestão inicial.
 */
export function profilaxiaSugerida(a: ExposicaoAcidente): SituacaoProfilaxia {
  if (!a.biologico) return 'nao-indicada';
  const exposicaoDeRisco = a.exposicao !== null && a.exposicao !== 'pele-integra';
  const materialDeRisco = a.material === 'sangue' || a.material === 'fluido-com-sangue';
  if (!exposicaoDeRisco || !materialDeRisco) return 'nao-indicada';
  return a.fonteTeste === 'nao-reagente' ? 'nao-indicada' : 'indicada';
}

/** Os marcos do acompanhamento sorológico do acidente com material biológico. Sem material biológico: nenhum. */
export function marcosSorologia(
  ocorridoEm: string,
  biologico: boolean,
): { marco: MarcoSorologia; prevista: string }[] {
  if (!biologico) return [];
  const dia = dataDe(ocorridoEm);
  return CODIGOS_MARCO_SOROLOGIA.map((m) => ({
    marco: m,
    prevista: somarDias(dia, MARCOS_SOROLOGIA[m].dias),
  }));
}

export interface EntradaAcidente extends ExposicaoAcidente {
  readonly ocorridoEm: string;
  readonly obito: boolean;
  readonly profilaxia: SituacaoProfilaxia;
  readonly profilaxiaEm: string | null;
}

/** Confere o registro (regra 18). */
export function conferirAcidente(e: EntradaAcidente, agora: string, admissao: string): RecusaSesmt | null {
  if (e.ocorridoEm > agora)
    return recusaSesmt('acidente-futuro', 'A data e a hora do acidente não podem ser futuras.', 'ocorridoEm');
  if (diasEntre(admissao, dataDe(e.ocorridoEm)) < 0)
    return recusaSesmt(
      'acidente-antes-admissao',
      'O acidente é anterior à admissão do vínculo.',
      'ocorridoEm',
    );
  if (e.biologico && (e.exposicao === null || e.material === null))
    return recusaSesmt(
      'biologico-incompleto',
      'No acidente com material biológico, informe o tipo de exposição e o material.',
      'exposicao',
    );
  if (!e.biologico && e.profilaxia !== 'nao-indicada')
    return recusaSesmt(
      'profilaxia-sem-biologico',
      'A profilaxia pós-exposição só se aplica ao acidente com material biológico.',
      'profilaxia',
    );
  if (e.profilaxia === 'iniciada' && e.profilaxiaEm === null)
    return recusaSesmt('profilaxia-sem-hora', 'Informe quando a profilaxia foi iniciada.', 'profilaxiaEm');
  if (e.profilaxiaEm !== null && (e.profilaxiaEm < e.ocorridoEm || e.profilaxiaEm > agora))
    return recusaSesmt(
      'profilaxia-fora-da-janela',
      'O início da profilaxia fica entre o acidente e agora.',
      'profilaxiaEm',
    );
  return null;
}

export interface AcidenteParaSituacao {
  readonly estado: 'aberto' | 'encerrado';
  readonly catNumero: string | null;
  readonly catPrazo: string;
  readonly profilaxia: SituacaoProfilaxia;
  readonly sorologias: readonly { readonly prevista: string; readonly resultado: string | null }[];
}

/** As pendências do acidente no dia: CAT a emitir ou atrasada, profilaxia a iniciar e sorologia atrasada. */
export function pendenciasAcidente(a: AcidenteParaSituacao, hoje: string): PendenciaSesmt[] {
  const r: PendenciaSesmt[] = [];
  if (a.catNumero === null) r.push(diasEntre(a.catPrazo, hoje) > 0 ? 'cat-atrasada' : 'cat-prazo');
  if (a.estado === 'encerrado') return r;
  if (a.profilaxia === 'indicada') r.push('profilaxia-indicada');
  if (a.sorologias.some((s) => s.resultado === null && diasEntre(s.prevista, hoje) > 7))
    r.push('sorologia-atrasada');
  return r;
}

/** O encerramento do acompanhamento pede a CAT emitida e os marcos sorológicos registrados. */
export function conferirEncerramento(a: AcidenteParaSituacao): RecusaSesmt | null {
  if (a.estado === 'encerrado') return recusaSesmt('ja-encerrado', 'O acompanhamento já está encerrado.');
  if (a.catNumero === null)
    return recusaSesmt('sem-cat', 'Registre a emissão da CAT antes de encerrar o acompanhamento.');
  if (a.sorologias.some((s) => s.resultado === null))
    return recusaSesmt(
      'sorologia-pendente',
      'Há sorologia do acompanhamento sem registro: registre o resultado ou a ausência do colaborador.',
    );
  return null;
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** O código da CAT inicial no domínio de tipos de CAT lido (pelo rótulo "Inicial", nunca por um número fixo). */
export function tipoCatInicial(tipos: readonly { codigo: number; rotulo: string }[]): number | null {
  return tipos.find((t) => /\bINICIAL\b/.test(semAcento(t.rotulo)))?.codigo ?? null;
}

/**
 * A emissão da CAT (regra 18; D-CAT-525): o acidente guarda uma única emissão, a CAT inicial, que nunca é substituída
 * (dado de saúde só de inclusão). Recusa o tipo fora do domínio, a CAT inicial repetida, a de reabertura ou de óbito sem
 * a inicial e, com a inicial já emitida, a de reabertura ou de óbito (que precisa de um registro próprio por emissão,
 * para não apagar a inicial). Devolve se a emissão é a inicial (o prazo só vale para ela).
 */
export function conferirEmissaoCat(
  tipoCat: number,
  tipos: readonly { codigo: number; rotulo: string }[],
  catAtual: string | null,
): RecusaSesmt | { readonly inicial: boolean } {
  if (!tipos.some((t) => t.codigo === tipoCat))
    return recusaSesmt('tipo-cat', 'Escolha o tipo da CAT.', 'tipoCat');
  const inicial = tipoCatInicial(tipos);
  if (inicial === null)
    return recusaSesmt(
      'tipo-cat-inicial',
      'O domínio de tipos de CAT não tem o tipo "Inicial": confira a tabela de tipos de CAT.',
      'tipoCat',
    );
  if (tipoCat === inicial)
    return catAtual === null
      ? { inicial: true }
      : recusaSesmt('cat-ja-emitida', 'A CAT inicial já foi emitida e fica preservada.', 'tipoCat');
  if (catAtual === null)
    return recusaSesmt(
      'sem-cat-inicial',
      'Emita antes a CAT inicial: a de reabertura e a de óbito se referem a ela.',
      'tipoCat',
    );
  return recusaSesmt(
    'cat-reabertura-pendente',
    'A CAT de reabertura ou de óbito ainda não é registrada aqui: cada emissão terá o seu próprio registro, para que a CAT inicial nunca seja substituída. A CAT inicial continua valendo.',
    'tipoCat',
  );
}
