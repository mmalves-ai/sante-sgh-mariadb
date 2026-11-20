// Reavaliação de Braden e Morse (ficha do M45, regra 4; cap-05b §5.8): na admissão, diária e na mudança de quadro. A
// diária e a da admissão são calculadas na hora (da última avaliação, pelo escore do novo ou pelo registro em
// formulário do prontuário, e da entrada na internação); a de mudança de quadro é programada (pelo enfermeiro, ou
// pelo NEWS2 de 5 ou mais, na mesma gravação) e fica até ser cumprida por uma avaliação posterior ou dispensada com o
// motivo. O paciente em risco recebe os cuidados preventivos sugeridos, que o enfermeiro aceita ou recusa com motivo.
import {
  CUIDADOS_PREVENTIVOS,
  type DecisaoCuidado,
  ESCALAS_REAVALIADAS,
  type EscalaReavaliada,
  type FaixaEscore,
  type MotivoReavaliacao,
  type ReavaliacaoLida,
  type SituacaoReavaliacao,
} from '@sgh/contratos';

const p2 = (n: number) => String(n).padStart(2, '0');
/** Hora local + horas (AAAA-MM-DDTHH:mm:ss; aritmética sobre o relógio de parede, sem fuso). */
export function somarHoras(t: string, horas: number): string {
  const d = new Date(Date.parse(`${t.slice(0, 19).padEnd(19, ':00').slice(0, 19)}Z`) + horas * 3_600_000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}
const segundos = (t: string) => (t.length === 16 ? `${t}:00` : t.slice(0, 19));

export interface AvaliacaoFeita {
  readonly escala: EscalaReavaliada;
  readonly quando: string;
  readonly origem: 'escore' | 'formulario';
}

export interface ReavaliacaoGravada {
  readonly id: number;
  readonly escala: EscalaReavaliada;
  readonly motivo: MotivoReavaliacao;
  readonly devidaEm: string;
  readonly prazoEm: string;
  readonly situacao: SituacaoReavaliacao;
  readonly cumpridaEm: string | null;
  readonly cumpridaPor: 'escore' | 'formulario' | null;
}

/** As reavaliações do paciente (as gravadas e as calculadas), com a vencida marcada. */
export function reavaliacoesDoPaciente(e: {
  readonly paciente: number;
  readonly internadoEm: string | null;
  readonly avaliacoes: readonly AvaliacaoFeita[];
  readonly gravadas: readonly ReavaliacaoGravada[];
  readonly agora: string;
  readonly intervaloHoras: number;
}): ReavaliacaoLida[] {
  const agora = segundos(e.agora);
  const r: ReavaliacaoLida[] = [];
  for (const g of e.gravadas) {
    // A programada é cumprida por qualquer avaliação da escala feita depois de devida (mesmo antes de gravada a baixa).
    const cumprida =
      g.situacao === 'pendente'
        ? e.avaliacoes.find((a) => a.escala === g.escala && segundos(a.quando) >= segundos(g.devidaEm))
        : undefined;
    r.push({
      id: g.id,
      paciente: e.paciente,
      escala: g.escala,
      motivo: g.motivo,
      devidaEm: segundos(g.devidaEm),
      prazoEm: segundos(g.prazoEm),
      situacao: cumprida ? 'cumprida' : g.situacao,
      vencida: g.situacao === 'pendente' && !cumprida && segundos(g.prazoEm) < agora,
      calculada: false,
      cumpridaEm: cumprida ? segundos(cumprida.quando) : g.cumpridaEm,
      cumpridaPor: cumprida ? cumprida.origem : g.cumpridaPor,
    });
  }
  for (const escala of ESCALAS_REAVALIADAS) {
    const ultima = e.avaliacoes
      .filter((a) => a.escala === escala)
      .map((a) => segundos(a.quando))
      .sort()
      .at(-1);
    const internado = e.internadoEm ? segundos(e.internadoEm) : null;
    if (!ultima || (internado && ultima < internado)) {
      // Sem avaliação nesta internação: a da admissão (se não estiver programada à mão).
      if (r.some((x) => x.escala === escala && x.motivo === 'admissao' && x.situacao === 'pendente'))
        continue;
      const devida = internado ?? agora;
      const prazo = somarHoras(devida, e.intervaloHoras);
      r.push({
        id: null,
        paciente: e.paciente,
        escala,
        motivo: 'admissao',
        devidaEm: devida,
        prazoEm: prazo,
        situacao: 'pendente',
        vencida: prazo < agora,
        calculada: true,
        cumpridaEm: null,
        cumpridaPor: null,
      });
      continue;
    }
    const devida = somarHoras(ultima, e.intervaloHoras);
    r.push({
      id: null,
      paciente: e.paciente,
      escala,
      motivo: 'diaria',
      devidaEm: devida,
      prazoEm: devida,
      situacao: 'pendente',
      vencida: devida < agora,
      calculada: true,
      cumpridaEm: null,
      cumpridaPor: null,
    });
  }
  return r.sort((a, b) => a.prazoEm.localeCompare(b.prazoEm));
}

/** As programadas pendentes que a avaliação nova cumpre (a baixa na mesma gravação do escore). */
export function cumpridasPelaAvaliacao(
  gravadas: readonly ReavaliacaoGravada[],
  escala: EscalaReavaliada,
  quando: string,
): number[] {
  return gravadas
    .filter(
      (g) => g.escala === escala && g.situacao === 'pendente' && segundos(g.devidaEm) <= segundos(quando),
    )
    .map((g) => g.id);
}

/** NEWS2 de 5 ou mais é mudança de quadro: reavaliar Braden e Morse no prazo (programado na mesma gravação). */
export function programacaoPorMudancaDeQuadro(
  news2: number,
  escore: number | string,
  quando: string,
  intervaloHoras: number,
): {
  escala: EscalaReavaliada;
  motivo: 'mudanca-quadro';
  chave: string;
  devidaEm: string;
  prazoEm: string;
}[] {
  if (news2 < 5) return [];
  const devida = segundos(quando);
  const prazo = somarHoras(devida, Math.min(intervaloHoras, 12));
  return ESCALAS_REAVALIADAS.map((escala) => ({
    escala,
    motivo: 'mudanca-quadro' as const,
    chave: `quadro:news2:${escore}`,
    devidaEm: devida,
    prazoEm: prazo,
  }));
}

/** A chave única da programação feita à mão (uma por escala, motivo e dia). */
export function chaveProgramada(motivo: 'admissao' | 'mudanca-quadro', quando: string): string {
  return `${motivo}:${segundos(quando).slice(0, 16)}`;
}

/** Os cuidados preventivos sugeridos pela faixa de risco de Braden ou Morse. */
export function cuidadosSugeridos(
  escala: string,
  faixa: FaixaEscore,
): readonly { codigo: string; rotulo: string }[] {
  if (!faixa.risco) return [];
  // W0-03, M1: a Braden Q usa os cuidados de lesão por pressão; a Humpty Dumpty, os de queda.
  if (escala === 'braden' || escala === 'bradenq') return CUIDADOS_PREVENTIVOS.braden;
  if (escala === 'morse' || escala === 'humpty') return CUIDADOS_PREVENTIVOS.morse;
  return [];
}

export type ConferenciaCuidados =
  | { readonly ok: true; readonly decisoes: readonly DecisaoCuidado[] }
  | {
      readonly ok: false;
      readonly codigo: 'cuidado-sem-decisao' | 'cuidado-desconhecido' | 'recusa-sem-motivo';
      readonly mensagem: string;
    };

/** Regra 4: todo cuidado sugerido tem decisão; a recusa tem o motivo; nada fora da lista sugerida. */
export function conferirCuidados(
  sugeridos: readonly { codigo: string }[],
  decisoes: readonly DecisaoCuidado[],
): ConferenciaCuidados {
  const codigos = new Set(sugeridos.map((s) => s.codigo));
  const fora = decisoes.filter((d) => !codigos.has(d.codigo));
  if (fora.length)
    return {
      ok: false,
      codigo: 'cuidado-desconhecido',
      mensagem: 'Há decisão de cuidado que não foi sugerido para esta faixa.',
    };
  const faltam = sugeridos.filter((s) => !decisoes.some((d) => d.codigo === s.codigo));
  if (faltam.length)
    return {
      ok: false,
      codigo: 'cuidado-sem-decisao',
      mensagem: `Aceite ou recuse com o motivo cada cuidado preventivo sugerido (faltam ${faltam.length}).`,
    };
  if (decisoes.some((d) => d.decisao === 'recusado' && (d.motivo ?? '').trim().length < 5))
    return {
      ok: false,
      codigo: 'recusa-sem-motivo',
      mensagem: 'A recusa do cuidado preventivo exige o motivo.',
    };
  return { ok: true, decisoes };
}
