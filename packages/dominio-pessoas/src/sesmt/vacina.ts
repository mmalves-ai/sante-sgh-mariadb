// Vacinação do colaborador (regra 17, parte das vacinas; NR-32 32.2.4.17; cap-07 §7.1.4): doses com lote e validade
// (lote vencido na data da aplicação é recusado), o esquema de cada vacina do programa e o anti-HBs depois do esquema
// da hepatite B (reagente a partir de 10 mUI/mL). As pendências do painel: hepatite B incompleta, anti-HBs pendente ou
// abaixo do protetor, dupla adulto incompleta ou com o reforço de 10 anos vencido. Só inclusão: a correção é a
// retificação (o registro retificado sai da conta).
import {
  ANTI_HBS_PROTETOR,
  type DoseVacinaSesmt,
  type PendenciaSesmt,
  VACINAS_OBRIGATORIAS_NR32,
  VACINAS_SESMT,
  type VacinaSesmt,
} from '@sgh/contratos';
import { diasEntre } from '../datas.js';
import { somarMeses } from './aso.js';
import { recusaSesmt, type RecusaSesmt } from './recusa.js';

export interface RegistroVacinaLido {
  readonly id: number;
  readonly registro: 'dose' | 'anti-hbs';
  readonly vacina: string;
  readonly dose: DoseVacinaSesmt | null;
  readonly data: string;
  readonly antiHbs: number | null;
  readonly retifica: number | null;
}

export interface EntradaVacina {
  readonly registro: 'dose' | 'anti-hbs';
  readonly vacina: VacinaSesmt;
  readonly dose: DoseVacinaSesmt | null;
  readonly data: string;
  readonly validadeLote: string | null;
  readonly antiHbs: number | null;
}

/** Só os registros em vigor (sem os retificados). */
export function vacinasEmVigor<T extends RegistroVacinaLido>(rs: readonly T[]): T[] {
  const retificados = new Set(rs.map((r) => r.retifica).filter((x): x is number => x !== null));
  return rs.filter((r) => !retificados.has(r.id));
}

/** Confere o registro (regra 17): data não futura, lote válido na data, anti-HBs só da hepatite B. */
export function conferirVacina(
  e: EntradaVacina,
  hoje: string,
  anteriores: readonly RegistroVacinaLido[],
  retifica: number | null = null,
): RecusaSesmt | null {
  if (diasEntre(hoje, e.data) > 0) return recusaSesmt('data-futura', 'A data não pode ser futura.', 'data');
  if (e.registro === 'anti-hbs') {
    if (e.vacina !== 'hepatite-b')
      return recusaSesmt('anti-hbs-outra-vacina', 'O anti-HBs é o exame da hepatite B.', 'vacina');
    if (e.antiHbs === null || e.antiHbs < 0)
      return recusaSesmt('anti-hbs-sem-valor', 'Informe o resultado do anti-HBs em mUI/mL.', 'antiHbs');
    return null;
  }
  if (e.dose === null) return recusaSesmt('dose-ausente', 'Informe a dose aplicada.', 'dose');
  if (e.validadeLote === null || diasEntre(e.data, e.validadeLote) < 0)
    return recusaSesmt(
      'lote-vencido',
      'O lote estava vencido na data da aplicação: confira o lote antes de registrar.',
      'validadeLote',
    );
  const esquema = VACINAS_SESMT[e.vacina].esquema;
  const numero = Number(e.dose);
  if (Number.isInteger(numero) && esquema > 0 && numero > esquema)
    return recusaSesmt(
      'dose-alem-do-esquema',
      `O esquema desta vacina tem ${esquema} dose(s): a seguinte é reforço.`,
      'dose',
    );
  const vigentes = vacinasEmVigor(anteriores).filter(
    (r) => r.id !== retifica && r.registro === 'dose' && r.vacina === e.vacina,
  );
  if (Number.isInteger(numero) && vigentes.some((r) => r.dose === e.dose))
    return recusaSesmt(
      'dose-repetida',
      'Esta dose já está registrada. Para corrigir, use a retificação do registro.',
      'dose',
    );
  return null;
}

export interface SituacaoVacina {
  readonly vacina: VacinaSesmt;
  readonly doses: number;
  readonly esquema: number;
  readonly completo: boolean;
  readonly ultimaDose: string | null;
  /** O reforço vence em (dupla adulto: 10 anos depois da última dose); null sem reforço periódico. */
  readonly reforcoAte: string | null;
  readonly antiHbs: number | null;
  readonly pendencias: readonly PendenciaSesmt[];
}

/** A situação de cada vacina do programa e as pendências NR-32 (hepatite B, dupla adulto e o anti-HBs). */
export function situacaoVacinas(rs: readonly RegistroVacinaLido[], hoje: string): SituacaoVacina[] {
  const vigentes = vacinasEmVigor(rs);
  return (Object.keys(VACINAS_SESMT) as VacinaSesmt[]).map((v) => {
    const cfg = VACINAS_SESMT[v];
    const doses = vigentes
      .filter((r) => r.registro === 'dose' && r.vacina === v)
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id - b.id));
    const basicas = new Set(doses.filter((d) => d.dose && /^\d$/.test(d.dose)).map((d) => d.dose)).size;
    const unica = doses.some((d) => d.dose === 'unica');
    const completo = cfg.esquema === 0 ? doses.length > 0 : unica || basicas >= cfg.esquema;
    const ultimaDose = doses.at(-1)?.data ?? null;
    const reforcoAte = cfg.reforcoAnos && ultimaDose ? somarMeses(ultimaDose, cfg.reforcoAnos * 12) : null;
    const antis = vigentes
      .filter((r) => r.registro === 'anti-hbs' && r.vacina === v)
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id - b.id));
    const ultimoAnti = antis.at(-1) ?? null;
    const pendencias: PendenciaSesmt[] = [];
    if (VACINAS_OBRIGATORIAS_NR32.includes(v)) {
      if (v === 'hepatite-b') {
        if (!completo) pendencias.push('hepatite-b-incompleta');
        else if (!ultimoAnti || (ultimaDose !== null && ultimoAnti.data < ultimaDose))
          pendencias.push('anti-hbs-pendente');
        else if ((ultimoAnti.antiHbs ?? 0) < ANTI_HBS_PROTETOR) pendencias.push('anti-hbs-nao-protetor');
      }
      if (v === 'dupla-adulto') {
        if (!completo) pendencias.push('dupla-incompleta');
        else if (reforcoAte && diasEntre(hoje, reforcoAte) < 0) pendencias.push('dupla-reforco');
      }
    }
    return {
      vacina: v,
      doses: doses.length,
      esquema: cfg.esquema,
      completo,
      ultimaDose,
      reforcoAte,
      antiHbs: ultimoAnti?.antiHbs ?? null,
      pendencias,
    };
  });
}

/** A descrição do domínio para casar: sem acento, maiúsculas, pontuação como espaço, espaços simples. */
export function normalizarDescricaoDominio(t: string): string {
  return ` ${t
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * D-VAC-525: o código da linha do domínio (vacinas ou doses, editável no CRUD genérico e lido na hora) que casa com a
 * vacina ou a dose pelos termos. Só um casamento único vale: nenhum ou mais de um deixa o código vazio (nunca um
 * genérico como "outras").
 */
export function codigoNoDominio(
  dominio: readonly { codigo: number; rotulo: string }[],
  termos: readonly string[],
): number | null {
  const ts = termos.map(normalizarDescricaoDominio);
  const achados = dominio.filter((d) => {
    const r = normalizarDescricaoDominio(d.rotulo);
    return ts.some((t) => r.includes(t));
  });
  return achados.length === 1 ? (achados[0]?.codigo ?? null) : null;
}
