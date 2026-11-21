// W0-07 (programa CRUD completo, mercado M1): o alerta de deterioração e de sepse no pronto atendimento. O cálculo é
// do motor dos escores da enfermagem (@sgh/dominio-enfermagem: o NEWS2 do M45, o mesmo que o serviço dos escores da
// enfermagem usa, com o qSOFA e a SIRS ao lado); aqui só se decide de onde vêm os sinais e qual escore vale no chip:
//   - o último escore registrado no PA e não estornado (a aferição completa, com o oxigênio e a consciência); ou
//   - sem ele, o calculado dos sinais mais recentes do atendimento (a classificação e as outras telas dos sinais
//     vitais), marcado "sinais" e parcial quando falta parâmetro (o piso).
import type {
  AlertaEscorePa,
  EscorePaLidoContrato,
  NivelDeterioracaoPa,
  SinaisEscorePa,
} from '@sgh/contratos';
import {
  type Acvpu,
  avaliarDeterioracaoPa,
  type LimiaresSepsePa,
  type ResultadoDeterioracaoPa,
} from '@sgh/dominio-enfermagem';
import type { EscorePaRegistrado, SinaisRecentes } from './tipos.js';

const parcial = (x: { total: number; completo: boolean; faltando: readonly string[] }) => ({
  total: x.total,
  completo: x.completo,
  faltando: [...x.faltando],
});

/** Os sinais vitais do prontuário (a classificação grava pas, fc, fr, temperatura e saturação) nos sinais do PA. */
export function sinaisDoProntuario(s: SinaisRecentes): SinaisEscorePa {
  return {
    fr: s.fr,
    spo2: s.saturacao,
    o2: null,
    pas: s.pas,
    fc: s.fc,
    consciencia: null,
    temperatura: s.temperatura,
    leucocitos: null,
    bastoes10: null,
  };
}

export function calcularEscorePa(
  sinais: SinaisEscorePa,
  limiares: LimiaresSepsePa,
  glasgow: number | null = null,
): ResultadoDeterioracaoPa {
  return avaliarDeterioracaoPa(
    { ...sinais, consciencia: (sinais.consciencia as Acvpu | null) ?? null, glasgow },
    limiares,
  );
}

export function escoreLidoNoContrato(x: EscorePaRegistrado): EscorePaLidoContrato {
  return {
    id: x.id,
    origem: x.origem,
    sinais: {
      ...x.sinais,
      consciencia: (x.sinais.consciencia as SinaisEscorePa['consciencia']) ?? null,
    },
    news2: { total: x.news2, completo: x.news2Completo, faltando: [] },
    qsofa: { total: x.qsofa, completo: x.qsofaCompleto, faltando: [] },
    sirs: { total: x.sirs, completo: x.sirsCompleto, faltando: [] },
    nivel: x.nivel as NivelDeterioracaoPa,
    sugereSepse: x.sugereSepse,
    limiares: { news2: x.limiarNews2, qsofa: x.limiarQsofa },
    substitui: x.substitui,
    motivo: x.motivo,
    aferidoEm: x.aferidoEm,
    usuario: x.usuario,
    estorno: x.estorno,
  };
}

/**
 * O alerta vigente do atendimento. O escore registrado vale com os limiares de agora (a sugestão é recalculada: o
 * protocolo pode ter mudado o limiar depois do registro); o calculado dos sinais só quando não há registro válido.
 */
export function alertaVigente(
  escores: readonly EscorePaRegistrado[],
  sinais: SinaisRecentes | null,
  limiares: LimiaresSepsePa,
  agora: string,
): AlertaEscorePa | null {
  const valido = escores
    .filter((x) => !x.estorno)
    .sort((a, b) => b.aferidoEm.localeCompare(a.aferidoEm) || b.id - a.id)[0];
  if (valido) {
    const r = calcularEscorePa(
      { ...valido.sinais, consciencia: (valido.sinais.consciencia as Acvpu | null) ?? null },
      limiares,
    );
    return {
      id: valido.id,
      origem: valido.origem,
      news2: parcial(r.news2),
      qsofa: parcial(r.qsofa),
      sirs: parcial(r.sirs),
      nivel: r.nivel,
      sugereSepse: r.sugereSepse,
      motivoSepse: [...r.motivoSepse],
      aferidoEm: valido.aferidoEm,
    };
  }
  if (!sinais) return null;
  const r = calcularEscorePa(sinaisDoProntuario(sinais), limiares, sinais.glasgow);
  // Nenhum parâmetro aferido que conte: sem chip.
  if (r.parcelas.every((p) => p.pontos === null)) return null;
  return {
    id: null,
    origem: 'sinais',
    news2: parcial(r.news2),
    qsofa: parcial(r.qsofa),
    sirs: parcial(r.sirs),
    nivel: r.nivel,
    sugereSepse: r.sugereSepse,
    motivoSepse: [...r.motivoSepse],
    aferidoEm: agora,
  };
}
