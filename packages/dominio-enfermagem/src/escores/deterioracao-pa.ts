// W0-07 (programa CRUD completo, mercado M1): o alerta de deterioração e de sepse no pronto atendimento. O motor dos
// escores da enfermagem (o NEWS2 de `news2.ts`, RCP 2017, o mesmo do M45) somado ao qSOFA (Sepsis-3, adotado no
// protocolo de sepse do ILAS, Instituto Latino-Americano de Sepse) e à SIRS (os critérios clássicos da triagem do ILAS).
// A conta é toda do servidor; a tela só mostra o chip e a sugestão.
//
// Sinais incompletos (o quadro calcula também dos sinais da classificação, que não trazem o oxigênio nem a consciência):
// cada escore é a soma dos critérios AFERIDOS, e o que falta só pode somar. A soma parcial é, portanto, um piso: se o
// piso já atinge o limiar, o limiar está atingido; se não atinge, o escore fica "parcial" e a tela pede a aferição
// completa (nunca se presume o normal para chegar a "sem alerta").
import {
  calcularNews2,
  pontosConsciencia,
  pontosFc,
  pontosFr,
  pontosPas,
  pontosSpo2,
  pontosTemperatura,
} from './news2.js';

/** A consciência pela escala ACVPU (Alerta, Confusão nova, Voz, Dor, Sem resposta). */
export const ESCALA_ACVPU = ['A', 'C', 'V', 'P', 'U'] as const;
export type Acvpu = (typeof ESCALA_ACVPU)[number];

/** Os sinais do PA (null: não aferido). A temperatura em °C; o oxigênio suplementar em L/min (0 = ar ambiente). */
export interface SinaisDeterioracao {
  readonly fr: number | null;
  readonly spo2: number | null;
  readonly o2: number | null;
  readonly pas: number | null;
  readonly fc: number | null;
  readonly consciencia: Acvpu | null;
  /** A escala de Glasgow (só quando a consciência ACVPU não veio: Glasgow abaixo de 15 vale como "alterada"). */
  readonly glasgow?: number | null;
  readonly temperatura: number | null;
  /** Leucócitos por mm³ (a SIRS; null quando não há hemograma). */
  readonly leucocitos?: number | null;
  /** Bastões acima de 10% no hemograma (a SIRS). */
  readonly bastoes10?: boolean | null;
}

export interface LimiaresSepsePa {
  /** NEWS2 a partir do qual o quadro sugere o protocolo de sepse (padrão de mercado 5). */
  readonly news2: number;
  /** qSOFA a partir do qual o quadro sugere o protocolo de sepse (padrão de mercado 2). */
  readonly qsofa: number;
}

export const LIMIARES_SEPSE_PA_PADRAO: LimiaresSepsePa = { news2: 5, qsofa: 2 };

export interface EscoreParcial {
  /** A soma dos critérios aferidos (o piso quando incompleto). */
  readonly total: number;
  readonly completo: boolean;
  /** Os critérios sem valor (o que a aferição completa ainda precisa). */
  readonly faltando: readonly string[];
}

export interface ParcelaDeterioracao {
  readonly escore: 'news2' | 'qsofa' | 'sirs';
  readonly criterio: string;
  readonly valor: number | string | boolean | null;
  readonly pontos: number | null;
}

export type NivelDeterioracao = 'baixo' | 'baixoMedio' | 'medio' | 'alto' | 'indeterminado';

export interface ResultadoDeterioracaoPa {
  readonly news2: EscoreParcial;
  readonly qsofa: EscoreParcial;
  readonly sirs: EscoreParcial;
  readonly parcelas: readonly ParcelaDeterioracao[];
  /** O nível do NEWS2 (RCP 2017): 0 a 4 baixo; 3 num parâmetro, baixo a médio; 5 a 6, médio; 7 ou mais, alto. */
  readonly nivel: NivelDeterioracao;
  /** O limiar parametrizado foi atingido (pelo NEWS2 ou pelo qSOFA): sugerir abrir o protocolo de sepse. */
  readonly sugereSepse: boolean;
  /** Qual limiar disparou a sugestão. */
  readonly motivoSepse: readonly ('news2' | 'qsofa')[];
  readonly conduta: string;
}

const temValor = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A consciência alterada pela ACVPU (qualquer letra além do A) ou, sem ela, pelo Glasgow abaixo de 15. */
export function conscienciaAlterada(s: Pick<SinaisDeterioracao, 'consciencia' | 'glasgow'>): boolean | null {
  if (s.consciencia) return s.consciencia !== 'A';
  if (temValor(s.glasgow)) return s.glasgow < 15;
  return null;
}

/** qSOFA (Sepsis-3): FR de 22 ou mais, PAS de 100 ou menos, consciência alterada; 1 ponto cada. */
export function calcularQsofa(s: SinaisDeterioracao): EscoreParcial & { parcelas: ParcelaDeterioracao[] } {
  const alt = conscienciaAlterada(s);
  const parcelas: ParcelaDeterioracao[] = [
    { escore: 'qsofa', criterio: 'fr', valor: s.fr, pontos: temValor(s.fr) ? (s.fr >= 22 ? 1 : 0) : null },
    {
      escore: 'qsofa',
      criterio: 'pas',
      valor: s.pas,
      pontos: temValor(s.pas) ? (s.pas <= 100 ? 1 : 0) : null,
    },
    { escore: 'qsofa', criterio: 'consciencia', valor: alt, pontos: alt === null ? null : alt ? 1 : 0 },
  ];
  return resumo(parcelas);
}

/**
 * SIRS: temperatura acima de 38 °C ou abaixo de 36 °C; FC acima de 90; FR acima de 20; leucócitos acima de 12.000 ou
 * abaixo de 4.000 por mm³ (ou bastões acima de 10%). 1 ponto cada (positiva com 2 ou mais).
 */
export function calcularSirs(s: SinaisDeterioracao): EscoreParcial & { parcelas: ParcelaDeterioracao[] } {
  const leuco =
    temValor(s.leucocitos) || typeof s.bastoes10 === 'boolean'
      ? (temValor(s.leucocitos) && (s.leucocitos > 12_000 || s.leucocitos < 4_000)) || s.bastoes10 === true
      : null;
  const parcelas: ParcelaDeterioracao[] = [
    {
      escore: 'sirs',
      criterio: 'temperatura',
      valor: s.temperatura,
      pontos: temValor(s.temperatura) ? (s.temperatura > 38 || s.temperatura < 36 ? 1 : 0) : null,
    },
    { escore: 'sirs', criterio: 'fc', valor: s.fc, pontos: temValor(s.fc) ? (s.fc > 90 ? 1 : 0) : null },
    { escore: 'sirs', criterio: 'fr', valor: s.fr, pontos: temValor(s.fr) ? (s.fr > 20 ? 1 : 0) : null },
    {
      escore: 'sirs',
      criterio: 'leucocitos',
      valor: s.leucocitos ?? null,
      pontos: leuco === null ? null : leuco ? 1 : 0,
    },
  ];
  return resumo(parcelas);
}

/** NEWS2 dos sinais do PA: completo pelo motor do M45; incompleto, a soma dos parâmetros aferidos (o piso). */
export function calcularNews2Pa(s: SinaisDeterioracao): EscoreParcial & {
  parcelas: ParcelaDeterioracao[];
  parametroIsoladoTres: boolean;
} {
  const alt = conscienciaAlterada(s);
  const acvpu = s.consciencia ? ESCALA_ACVPU.indexOf(s.consciencia) : alt === null ? null : alt ? 1 : 0;
  if (
    temValor(s.fr) &&
    temValor(s.spo2) &&
    temValor(s.o2) &&
    temValor(s.pas) &&
    temValor(s.fc) &&
    acvpu !== null &&
    temValor(s.temperatura)
  ) {
    const r = calcularNews2({
      fr: s.fr,
      spo2: s.spo2,
      o2: s.o2,
      pas: s.pas,
      fc: s.fc,
      acvpu,
      temperatura: s.temperatura,
    });
    return {
      total: r.total,
      completo: true,
      faltando: [],
      parametroIsoladoTres: r.parametroIsoladoTres,
      parcelas: r.parcelas.map((p) => ({
        escore: 'news2',
        criterio: p.parametro,
        valor: p.valor,
        pontos: p.pontos,
      })),
    };
  }
  const emO2 = temValor(s.o2) ? s.o2 > 0 : false;
  const parcelas: ParcelaDeterioracao[] = [
    { escore: 'news2', criterio: 'fr', valor: s.fr, pontos: temValor(s.fr) ? pontosFr(s.fr) : null },
    {
      escore: 'news2',
      criterio: 'spo2',
      valor: s.spo2,
      // Sem saber do oxigênio, a escala 1 (a padrão) não depende dele.
      pontos: temValor(s.spo2) ? pontosSpo2(s.spo2, 1, emO2) : null,
    },
    { escore: 'news2', criterio: 'o2', valor: s.o2, pontos: temValor(s.o2) ? (s.o2 > 0 ? 2 : 0) : null },
    { escore: 'news2', criterio: 'pas', valor: s.pas, pontos: temValor(s.pas) ? pontosPas(s.pas) : null },
    { escore: 'news2', criterio: 'fc', valor: s.fc, pontos: temValor(s.fc) ? pontosFc(s.fc) : null },
    {
      escore: 'news2',
      criterio: 'acvpu',
      valor: s.consciencia ?? (alt === null ? null : alt),
      pontos: acvpu === null ? null : pontosConsciencia(acvpu),
    },
    {
      escore: 'news2',
      criterio: 'temperatura',
      valor: s.temperatura,
      pontos: temValor(s.temperatura) ? pontosTemperatura(s.temperatura) : null,
    },
  ];
  return { ...resumo(parcelas), parametroIsoladoTres: parcelas.some((p) => p.pontos === 3) };
}

function resumo(parcelas: ParcelaDeterioracao[]): EscoreParcial & { parcelas: ParcelaDeterioracao[] } {
  const faltando = parcelas.filter((p) => p.pontos === null).map((p) => p.criterio);
  return {
    total: parcelas.reduce((a, p) => a + (p.pontos ?? 0), 0),
    completo: faltando.length === 0,
    faltando,
    parcelas,
  };
}

/** O alerta do PA: os três escores, o nível pelo NEWS2 e a sugestão de sepse pelo limiar parametrizado. */
export function avaliarDeterioracaoPa(
  s: SinaisDeterioracao,
  limiares: LimiaresSepsePa = LIMIARES_SEPSE_PA_PADRAO,
): ResultadoDeterioracaoPa {
  const news2 = calcularNews2Pa(s);
  const qsofa = calcularQsofa(s);
  const sirs = calcularSirs(s);
  const motivoSepse: ('news2' | 'qsofa')[] = [];
  if (news2.total >= limiares.news2) motivoSepse.push('news2');
  if (qsofa.total >= limiares.qsofa) motivoSepse.push('qsofa');
  let nivel: NivelDeterioracao;
  if (news2.total >= 7) nivel = 'alto';
  else if (news2.total >= 5) nivel = 'medio';
  else if (news2.parametroIsoladoTres) nivel = 'baixoMedio';
  else nivel = news2.completo ? 'baixo' : 'indeterminado';
  const sugereSepse = motivoSepse.length > 0;
  const partes: string[] = [];
  if (nivel === 'alto')
    partes.push(`NEWS2 ${news2.total}: avaliação médica imediata e monitorização contínua.`);
  else if (nivel === 'medio')
    partes.push(`NEWS2 ${news2.total}: avaliação médica urgente; reaferir de hora em hora.`);
  else if (nivel === 'baixoMedio') partes.push('Um parâmetro do NEWS2 em 3 pontos: avisar o médico.');
  else if (nivel === 'indeterminado')
    partes.push(
      `Escores parciais (faltam: ${[...new Set([...news2.faltando, ...qsofa.faltando])].join(', ')}): completar a aferição.`,
    );
  else partes.push(`NEWS2 ${news2.total}: manter a reavaliação conforme a classificação de risco.`);
  if (sugereSepse)
    partes.push(
      `Limiar de sepse atingido (${motivoSepse
        .map((m) =>
          m === 'news2'
            ? `NEWS2 ${news2.total} ≥ ${limiares.news2}`
            : `qSOFA ${qsofa.total} ≥ ${limiares.qsofa}`,
        )
        .join('; ')}): avaliar foco infeccioso e abrir o protocolo de sepse.`,
    );
  return {
    news2: { total: news2.total, completo: news2.completo, faltando: news2.faltando },
    qsofa: { total: qsofa.total, completo: qsofa.completo, faltando: qsofa.faltando },
    sirs: { total: sirs.total, completo: sirs.completo, faltando: sirs.faltando },
    parcelas: [...news2.parcelas, ...qsofa.parcelas, ...sirs.parcelas],
    nivel,
    sugereSepse,
    motivoSepse,
    conduta: partes.join(' '),
  };
}
