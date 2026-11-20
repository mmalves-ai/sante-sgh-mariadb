// Bolsa no ato (ficha do M47, regra 3; cap-05b §5.11 "Regras, Transfusão"): bolsa vencida, em quarentena ou
// incompatível é bloqueada. Compatibilidade ABO e Rh por classe de hemocomponente (RDC 34/2014 e manuais técnicos):
//   - hemácias: o doador não pode ter antígeno que o receptor não tem (O para todos; A para A e AB; B para B e AB; AB só
//     para AB); Rh positivo em receptor Rh negativo só com a justificativa do médico (falta de estoque, emergência);
//   - plasma: o inverso (AB para todos; A para A e O; B para B e O; O só para O);
//   - plaquetas e crioprecipitado: ABO idêntico de preferência; o não idêntico passa com alerta; Rh positivo em
//     receptor Rh negativo passa com alerta (imunoglobulina anti-D a critério do médico);
//   - receptor sem tipagem: só na extrema urgência, hemácias O e plasma AB (as outras classes passam com alerta).
// A situação da bolsa (quarentena, liberada, reservada…) só existe com o estoque da etapa 2 (agência própria); na
// etapa 1 a bolsa vem do hemocentro já liberada e o novo confere a validade e a tipagem da etiqueta.
import type { ClasseHemocomponente, GrupoAbo, TipagemSanguinea } from '@sgh/contratos';

/** Situações da bolsa no estoque (etapa 2). */
export type SituacaoBolsa =
  'quarentena' | 'liberada' | 'reservada' | 'transfundida' | 'descartada' | 'devolvida';

const ANTIGENOS: Readonly<Record<GrupoAbo, readonly ('A' | 'B')[]>> = {
  O: [],
  A: ['A'],
  B: ['B'],
  AB: ['A', 'B'],
};

/** Hemácias: todo antígeno do doador existe no receptor. */
export function aboCompativelHemacias(doador: GrupoAbo, receptor: GrupoAbo): boolean {
  return ANTIGENOS[doador].every((a) => ANTIGENOS[receptor].includes(a));
}
/** Plasma: o doador tem todo antígeno do receptor (não leva anticorpo contra ele). */
export function aboCompativelPlasma(doador: GrupoAbo, receptor: GrupoAbo): boolean {
  return ANTIGENOS[receptor].every((a) => ANTIGENOS[doador].includes(a));
}

export type BloqueioBolsa =
  | 'bolsa-vencida'
  | 'bolsa-quarentena'
  | 'bolsa-indisponivel'
  | 'abo-incompativel'
  | 'rh-incompativel'
  | 'receptor-sem-tipagem'
  | 'hemocomponente-diferente';

export type AlertaBolsa = 'abo-nao-identico' | 'rh-positivo-em-negativo' | 'receptor-sem-tipagem';

export const MENSAGENS_BOLSA: Readonly<Record<BloqueioBolsa | AlertaBolsa, string>> = {
  'bolsa-vencida': 'A bolsa está vencida: não transfunda e devolva à agência.',
  'bolsa-quarentena': 'A bolsa está em quarentena: ainda não foi liberada para uso.',
  'bolsa-indisponivel': 'A bolsa não está liberada para este paciente.',
  'abo-incompativel': 'O tipo sanguíneo da bolsa é incompatível com o do paciente.',
  'rh-incompativel': 'Bolsa Rh positivo para paciente Rh negativo: só com a justificativa do médico.',
  'receptor-sem-tipagem': 'O paciente não tem tipagem registrada: só bolsa universal na extrema urgência.',
  'hemocomponente-diferente': 'A bolsa não é do hemocomponente requisitado.',
  'abo-nao-identico': 'Tipo sanguíneo compatível, mas não idêntico ao do paciente.',
  'rh-positivo-em-negativo': 'Bolsa Rh positivo em paciente Rh negativo: avalie a imunoglobulina anti-D.',
};

export interface ConferenciaBolsa {
  readonly bloqueios: readonly BloqueioBolsa[];
  readonly alertas: readonly AlertaBolsa[];
}

/** Regra 3: confere a bolsa lida contra o paciente e a requisição. */
export function conferirBolsa(c: {
  readonly classe: ClasseHemocomponente;
  readonly hemocomponenteRequisitado: string;
  readonly hemocomponenteDaBolsa: string;
  readonly bolsa: TipagemSanguinea;
  readonly receptor: TipagemSanguinea;
  /** Validade impressa na etiqueta (ISO). */
  readonly validade: string;
  readonly agora: string;
  /** Situação no estoque (etapa 2); null na etapa 1 (bolsa vinda do hemocentro). */
  readonly situacao: SituacaoBolsa | null;
  readonly extremaUrgencia: boolean;
  readonly justificativaRh: string | null;
}): ConferenciaBolsa {
  const bloqueios: BloqueioBolsa[] = [];
  const alertas: AlertaBolsa[] = [];
  if (c.validade <= c.agora) bloqueios.push('bolsa-vencida');
  if (c.situacao === 'quarentena') bloqueios.push('bolsa-quarentena');
  else if (c.situacao !== null && c.situacao !== 'liberada' && c.situacao !== 'reservada')
    bloqueios.push('bolsa-indisponivel');
  if (c.hemocomponenteRequisitado.trim().toUpperCase() !== c.hemocomponenteDaBolsa.trim().toUpperCase())
    bloqueios.push('hemocomponente-diferente');
  const d = c.bolsa;
  const r = c.receptor;
  if (!d.abo || !d.rh) {
    bloqueios.push('abo-incompativel');
    return { bloqueios, alertas };
  }
  if (!r.abo || !r.rh) {
    const universal = (c.classe === 'hemacias' && d.abo === 'O') || (c.classe === 'plasma' && d.abo === 'AB');
    const outraClasse = c.classe !== 'hemacias' && c.classe !== 'plasma';
    if (c.extremaUrgencia && (universal || outraClasse)) alertas.push('receptor-sem-tipagem');
    else bloqueios.push('receptor-sem-tipagem');
    return { bloqueios, alertas };
  }
  const rhPosEmNeg = d.rh === 'positivo' && r.rh === 'negativo';
  switch (c.classe) {
    case 'hemacias':
      if (!aboCompativelHemacias(d.abo, r.abo)) bloqueios.push('abo-incompativel');
      else if (d.abo !== r.abo) alertas.push('abo-nao-identico');
      if (rhPosEmNeg) {
        if ((c.justificativaRh ?? '').trim().length >= 10) alertas.push('rh-positivo-em-negativo');
        else bloqueios.push('rh-incompativel');
      }
      break;
    case 'plasma':
      if (!aboCompativelPlasma(d.abo, r.abo)) bloqueios.push('abo-incompativel');
      else if (d.abo !== r.abo) alertas.push('abo-nao-identico');
      break;
    default:
      if (d.abo !== r.abo) alertas.push('abo-nao-identico');
      if (rhPosEmNeg) alertas.push('rh-positivo-em-negativo');
  }
  return { bloqueios, alertas };
}
