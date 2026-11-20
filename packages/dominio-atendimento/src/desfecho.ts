// Desfecho do atendimento externo (ficha do M20, `encerrarAtendimento`, e "Desfecho do PA"): codificado no novo
// (SGH_ATD_DESFECHO), com o motivo de alta do legado correspondente para os indicadores (evasão = 16, regra 8). Ato
// médico (Lei 12.842/2013): alta, encaminhamento, internação, transferência e óbito só por profissional com conselho
// ativo; a recepção registra a evasão e o encerramento administrativo. Regra de acesso, sem efeito na gravação.
import { DESFECHOS, type Desfecho, desfecho as desfechoDe } from '@sgh/contratos';

export interface QuemRegistra {
  /** Tem a permissão do desfecho clínico (atendimento.desfecho.medico). */
  readonly desfechoMedico: boolean;
  /** Profissional com conselho ativo vinculado à sessão. */
  readonly conselhoAtivo: boolean;
}

export interface DecisaoDesfecho {
  readonly pode: boolean;
  readonly motivo: string | null;
}

export function podeRegistrarDesfecho(d: Desfecho, q: QuemRegistra): DecisaoDesfecho {
  const x = desfechoDe(d);
  if (!x) return { pode: false, motivo: 'Desfecho desconhecido.' };
  if (!x.atoMedico) return { pode: true, motivo: null };
  if (!q.desfechoMedico)
    return {
      pode: false,
      motivo: `${x.rotulo} é ato médico: só o profissional com o desfecho clínico registra.`,
    };
  if (!q.conselhoAtivo)
    return {
      pode: false,
      motivo: `${x.rotulo} é ato médico: exige registro ativo no conselho profissional.`,
    };
  return { pode: true, motivo: null };
}

/** Os desfechos que a pessoa pode escolher (a tela mostra os demais desabilitados, com o motivo). */
export function desfechosPermitidos(q: QuemRegistra): Desfecho[] {
  return DESFECHOS.filter((d) => podeRegistrarDesfecho(d.codigo, q).pode).map((d) => d.codigo);
}

export function motivoAltaDoDesfecho(d: Desfecho): number | null {
  return desfechoDe(d)?.motivoAlta ?? null;
}
