// W0-03, mercado M2: as regras do TRR e da PCR, sem banco (o servidor e a tela usam as mesmas):
//   - a ficha Utstein conferida (a sequência das horas: colapso ≤ RCP ≤ desfibrilação/adrenalina ≤ RCE/fim; a
//     finalizada exige o desfecho e a hora do fim ou do RCE);
//   - o tempo de resposta do time (acionamento → chegada) e do alerta ao acionamento, pela mediana;
//   - os indicadores do período com o numerador e o denominador impressos: PCR por 1.000 pacientes-dia fora da UTI e
//     a chegada do time no prazo (a meta é parâmetro).
// Base: RDC 36/2013 (indicadores de segurança do paciente); o modelo Utstein (Perkins et al., Resuscitation 2015).
import type { DadosPcr } from '@sgh/contratos';
import { diferencaMinutos } from '../tempo.js';

export const META_RESPOSTA_TRR_PADRAO_MINUTOS = 5;

export type ProblemaPcr =
  | 'rcp-antes-do-colapso'
  | 'desfibrilacao-antes-da-rcp'
  | 'adrenalina-antes-da-rcp'
  | 'rce-antes-da-rcp'
  | 'fim-antes-da-rcp'
  | 'finalizada-sem-desfecho'
  | 'rce-sem-hora'
  | 'colapso-no-futuro';

const MENSAGENS: Readonly<Record<ProblemaPcr, string>> = {
  'rcp-antes-do-colapso': 'O início da reanimação não pode ser antes do colapso.',
  'desfibrilacao-antes-da-rcp': 'A primeira desfibrilação não pode ser antes do início da reanimação.',
  'adrenalina-antes-da-rcp': 'A primeira adrenalina não pode ser antes do início da reanimação.',
  'rce-antes-da-rcp': 'O retorno da circulação não pode ser antes do início da reanimação.',
  'fim-antes-da-rcp': 'O fim da reanimação não pode ser antes do início.',
  'finalizada-sem-desfecho':
    'Para finalizar, informe o desfecho e a hora do fim (ou do retorno da circulação).',
  'rce-sem-hora': 'Retorno da circulação sustentado exige a hora do retorno.',
  'colapso-no-futuro': 'A hora do colapso é do futuro.',
};

/** Confere a ficha; devolve o primeiro problema (código e mensagem) ou null. */
export function conferirFichaPcr(
  d: DadosPcr,
  finalizar: boolean,
  agora: string,
): { codigo: ProblemaPcr; mensagem: string } | null {
  const p = (codigo: ProblemaPcr) => ({ codigo, mensagem: MENSAGENS[codigo] });
  if (d.colapsoEm > agora.slice(0, 16)) return p('colapso-no-futuro');
  if (d.rcpEm < d.colapsoEm) return p('rcp-antes-do-colapso');
  if (d.desfibrilacaoEm && d.desfibrilacaoEm < d.rcpEm) return p('desfibrilacao-antes-da-rcp');
  if (d.adrenalinaEm && d.adrenalinaEm < d.rcpEm) return p('adrenalina-antes-da-rcp');
  if (d.rceEm && d.rceEm < d.rcpEm) return p('rce-antes-da-rcp');
  if (d.fimEm && d.fimEm < d.rcpEm) return p('fim-antes-da-rcp');
  if (d.desfecho === 'rceSustentado' && !d.rceEm) return p('rce-sem-hora');
  if (finalizar && (!d.desfecho || (!d.fimEm && !d.rceEm))) return p('finalizada-sem-desfecho');
  return null;
}

/** A mediana (null sem valores), arredondada a uma casa. */
export function mediana(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  return Math.round(v * 10) / 10;
}

export interface AcionamentoParaIndicador {
  readonly alertaEm: string | null;
  readonly acionadoEm: string;
  readonly chegadaEm: string | null;
}

export interface PcrParaIndicador {
  readonly uti: boolean;
  readonly situacao: 'rascunho' | 'finalizada';
}

/**
 * Os indicadores do período. PCR fora da UTI: as fichas finalizadas (a última versão de cada uma) de fora da UTI sobre
 * os pacientes-dia das unidades que não são UTI, × 1.000. Tempo de resposta: a mediana do acionamento à chegada; no
 * prazo, as chegadas até a meta sobre os acionamentos com a chegada registrada.
 */
export function indicadoresTrrPcr(
  acionamentos: readonly AcionamentoParaIndicador[],
  fichas: readonly PcrParaIndicador[],
  pacientesDiaForaUti: number,
  metaMinutos: number,
) {
  const pcr = fichas.filter((f) => !f.uti && f.situacao === 'finalizada').length;
  const respostas = acionamentos
    .filter((a) => a.chegadaEm)
    .map((a) => diferencaMinutos(a.acionadoEm.slice(0, 16), a.chegadaEm!.slice(0, 16)));
  const ateAcionar = acionamentos
    .filter((a) => a.alertaEm)
    .map((a) => Math.max(0, diferencaMinutos(a.alertaEm!.slice(0, 16), a.acionadoEm.slice(0, 16))));
  const noPrazo = respostas.filter((m) => m <= metaMinutos).length;
  return {
    pcrForaUti: {
      numerador: pcr,
      denominador: pacientesDiaForaUti,
      por1000: pacientesDiaForaUti > 0 ? Math.round((pcr / pacientesDiaForaUti) * 1000 * 100) / 100 : null,
    },
    tempoResposta: {
      medianaMinutos: mediana(respostas),
      noPrazo: {
        numerador: noPrazo,
        denominador: respostas.length,
        percentual: respostas.length > 0 ? Math.round((noPrazo / respostas.length) * 1000) / 10 : null,
      },
      metaMinutos,
    },
    alertaAteAcionar: { medianaMinutos: mediana(ateAcionar), n: ateAcionar.length },
  };
}
