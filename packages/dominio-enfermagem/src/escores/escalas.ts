// As escalas registradas na tela (ficha do M45, regras 2 a 4; cap-05b §5.8): Braden, Morse, Glasgow, RASS, CAM-ICU e
// dor. O total é SEMPRE calculado dos itens (regra 3: o valor digitado não vale); item que falta ou com ponto fora das
// opções é recusado (regra 15: valor nunca visto). A faixa vem da regra versionada vigente; o gatilho, da escala: o
// risco de Braden e Morse pede os cuidados preventivos; Glasgow grave, RASS agitado ou o delirium avisam o médico; a dor
// moderada ou intensa pede a reavaliação depois da analgesia.
import {
  type EscalaEscore,
  type FaixaEscore,
  type GatilhoEscore,
  itensDaEscala,
  type ModoDor,
  type RegraEscore,
} from '@sgh/contratos';
import { faixaDe, FAIXAS_DOR_COMPORTAMENTAL, REGRAS_PADRAO } from './regras.js';

export type EscalaDaTela = Exclude<EscalaEscore, 'news2'>;

export interface ResultadoEscala {
  readonly total: number;
  readonly itens: Readonly<Record<string, number>>;
  readonly faixa: FaixaEscore;
  readonly gatilho: GatilhoEscore;
  readonly conduta: string;
}

export type RecusaEscala =
  | {
      readonly ok: false;
      readonly codigo: 'item-faltando';
      readonly mensagem: string;
      readonly itens: string[];
    }
  | {
      readonly ok: false;
      readonly codigo: 'valor-nunca-visto';
      readonly mensagem: string;
      readonly itens: string[];
    }
  | {
      readonly ok: false;
      readonly codigo: 'avaliacao-impossivel';
      readonly mensagem: string;
      readonly itens: string[];
    };

/** O total dos itens com a conferência de cada um contra as opções da escala (regra 3 e regra 15). */
export function totalDosItens(
  escala: EscalaDaTela,
  respostas: Readonly<Record<string, number>>,
  modo: ModoDor = 'numerica',
): { ok: true; total: number; itens: Record<string, number> } | RecusaEscala {
  const defs = itensDaEscala(escala, modo);
  const faltam = defs.filter((d) => respostas[d.codigo] === undefined).map((d) => d.codigo);
  if (faltam.length)
    return {
      ok: false,
      codigo: 'item-faltando',
      mensagem: `Responda todos os itens da escala (faltam ${faltam.length}).`,
      itens: faltam,
    };
  const conhecidos = new Set(defs.map((d) => d.codigo));
  const invalidos = [
    ...Object.keys(respostas).filter((k) => !conhecidos.has(k)),
    ...defs.filter((d) => !d.opcoes.some((o) => o.valor === respostas[d.codigo])).map((d) => d.codigo),
  ];
  if (invalidos.length)
    return {
      ok: false,
      codigo: 'valor-nunca-visto',
      mensagem: 'Há resposta fora das opções da escala: escolha uma das opções.',
      itens: invalidos,
    };
  const itens: Record<string, number> = {};
  for (const d of defs) itens[d.codigo] = respostas[d.codigo]!;
  return { ok: true, total: Object.values(itens).reduce((a, b) => a + b, 0), itens };
}

const gatilhoPadrao = (escala: EscalaDaTela, faixa: FaixaEscore): GatilhoEscore => {
  if (!faixa.risco) return 'nenhum';
  switch (escala) {
    case 'braden':
    case 'morse':
    case 'bradenq':
    case 'humpty':
      return 'prevencao';
    case 'dor':
    case 'nips':
    case 'flacc':
      return 'reavaliar';
    case 'caprini':
    case 'padua':
      return 'profilaxia';
    case 'pews':
      return faixa.codigo === 'alto' ? 'trr' : 'avisar-medico';
    case 'glasgow':
      return faixa.codigo === 'grave' ? 'avisar-medico' : 'reavaliar';
    default:
      return 'avisar-medico';
  }
};

const CONDUTAS: Readonly<Record<GatilhoEscore, (escala: EscalaDaTela, faixa: FaixaEscore) => string>> = {
  nenhum: (_, f) => `${f.rotulo}: manter a rotina de reavaliação.`,
  prevencao: (e, f) =>
    `${f.rotulo}: aplicar os cuidados preventivos de ${e === 'braden' || e === 'bradenq' ? 'lesão por pressão' : 'queda'} (aceite ou recuse cada um com o motivo).`,
  reavaliar: (e, f) =>
    e === 'dor' || e === 'nips' || e === 'flacc'
      ? `${f.rotulo}: aplicar a analgesia prescrita e reavaliar a dor.`
      : `${f.rotulo}: reavaliar e registrar a evolução.`,
  'avisar-medico': (_, f) => `${f.rotulo}: avisar o médico.`,
  trr: (_, f) => `${f.rotulo}: acionar o Time de Resposta Rápida.`,
  sepse: (_, f) => `${f.rotulo}: abrir o protocolo de sepse.`,
  profilaxia: (e, f) => `${f.rotulo}: ${sugestaoProfilaxia(e, f.codigo)} Pendência enviada ao prescritor.`,
};

/**
 * W0-03, M1: a profilaxia de TEV sugerida pela faixa (Gould et al., ACCP 2012, para a Caprini; Barbar et al., 2010, para
 * a Padua). É sugestão ao prescritor: a ordem na prescrição é dele, que também confere o risco de sangramento.
 */
export function sugestaoProfilaxia(escala: string, faixa: string): string {
  if (escala === 'padua')
    return faixa === 'alto'
      ? 'Profilaxia farmacológica sugerida, se não houver risco alto de sangramento (senão, mecânica).'
      : 'Sem profilaxia farmacológica: deambulação precoce.';
  switch (faixa) {
    case 'baixo':
      return 'Profilaxia mecânica sugerida (compressão pneumática intermitente).';
    case 'moderado':
      return 'Profilaxia farmacológica ou mecânica sugerida, conforme o risco de sangramento.';
    case 'alto':
      return 'Profilaxia farmacológica associada à mecânica sugerida, se não houver risco alto de sangramento.';
    default:
      return 'Sem profilaxia específica: deambulação precoce.';
  }
}

/**
 * Calcula a escala: total pelos itens, faixa pela regra vigente e o gatilho. O CAM-ICU é delirium quando as
 * características 1 e 2 estão presentes e a 3 ou a 4; com RASS -4 ou -5 não se avalia (recusado).
 */
export function calcularEscala(
  escala: EscalaDaTela,
  respostas: Readonly<Record<string, number>>,
  o: { regra?: RegraEscore; modoDor?: ModoDor; rassAtual?: number | null } = {},
): ({ ok: true } & ResultadoEscala) | RecusaEscala {
  const modo = o.modoDor ?? 'numerica';
  const t = totalDosItens(escala, respostas, modo);
  if (!t.ok) return t;
  let total = t.total;
  if (escala === 'camicu') {
    if (o.rassAtual !== undefined && o.rassAtual !== null && o.rassAtual <= -4)
      return {
        ok: false,
        codigo: 'avaliacao-impossivel',
        mensagem: 'Com RASS -4 ou -5 o paciente não é avaliável pelo CAM-ICU: reavalie quando despertar.',
        itens: [],
      };
    const i = t.itens;
    total =
      i['inicioAgudo'] === 1 && i['desatencao'] === 1 && (i['consciencia'] === 1 || i['pensamento'] === 1)
        ? 1
        : 0;
  }
  const regra = o.regra ?? REGRAS_PADRAO[escala];
  const faixas = escala === 'dor' && modo === 'comportamental' ? FAIXAS_DOR_COMPORTAMENTAL : regra.faixas;
  const faixa = faixaDe(faixas, total);
  if (!faixa)
    return {
      ok: false,
      codigo: 'valor-nunca-visto',
      mensagem: 'O total ficou fora das faixas da escala vigente.',
      itens: [],
    };
  const gatilho = gatilhoPadrao(escala, faixa);
  return { ok: true, total, itens: t.itens, faixa, gatilho, conduta: CONDUTAS[gatilho](escala, faixa) };
}
