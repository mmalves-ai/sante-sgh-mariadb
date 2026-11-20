// Motivos da não administração e a dupla checagem (ficha do M25, regras 6 e 7; cap-05b §5.7 e §5.8):
//   6. o não administrado exige o motivo da lista (recusa, jejum, ausente do leito, falta do item, intercorrência,
//      suspensão médica); o administrado do "se necessário" exige a condição (o motivo do uso);
//   7. o item de alta vigilância (a marca do M24) e o hemocomponente exigem a dupla checagem: o segundo profissional
//      entra com o login próprio, diferente do primeiro, e com a permissão de conferir.
import {
  CODIGOS_MOTIVO_NAO_ADMINISTRACAO,
  MOTIVOS_NAO_ADMINISTRACAO,
  type MotivoNaoAdministracao,
} from '@sgh/contratos';

export function ehMotivoValido(m: string | null | undefined): m is MotivoNaoAdministracao {
  return !!m && (CODIGOS_MOTIVO_NAO_ADMINISTRACAO as readonly string[]).includes(m);
}

/** Regra 6 (e o "se necessário"): o problema da entrada, ou null. */
export function conferirDesfecho(d: {
  readonly desfecho: 'administrado' | 'naoAdministrado';
  readonly motivo: string | null;
  readonly observacao: string | null;
  readonly seNecessario: boolean;
}): string | null {
  if (d.desfecho === 'naoAdministrado') {
    if (!ehMotivoValido(d.motivo)) return 'Escolha o motivo da não administração na lista.';
    return null;
  }
  if (d.motivo !== null) return 'O motivo da lista é só da não administração.';
  if (d.seNecessario && (d.observacao ?? '').trim().length < 3)
    return 'Item "se necessário": informe o motivo da administração (a condição observada).';
  return null;
}

/** A justificativa que vai ao horário (o rótulo do motivo e o complemento, em até 200 caracteres). */
export function justificativaDoDesfecho(d: {
  readonly desfecho: 'administrado' | 'naoAdministrado';
  readonly motivo: string | null;
  readonly observacao: string | null;
}): string | null {
  const obs = (d.observacao ?? '').trim();
  if (d.desfecho === 'naoAdministrado' && ehMotivoValido(d.motivo)) {
    const r = MOTIVOS_NAO_ADMINISTRACAO[d.motivo];
    return (obs ? `${r}: ${obs}` : r).slice(0, 200);
  }
  return obs ? obs.slice(0, 200) : null;
}

/** Regra 7: o horário exige a dupla checagem? */
export function exigeDuplaChecagem(h: {
  readonly altaVigilancia: boolean;
  readonly duplaMarcada: boolean;
  readonly hemocomponente: boolean;
  /** Parâmetro da unidade (alta vigilância exige a dupla checagem; padrão ligado). */
  readonly parametroLigado: boolean;
}): boolean {
  if (h.hemocomponente) return true;
  return h.parametroLigado && (h.altaVigilancia || h.duplaMarcada);
}

export type ResultadoConferente =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly codigo:
        'conferente-ausente' | 'conferente-mesmo' | 'conferente-sem-permissao' | 'conferente-senha';
      readonly mensagem: string;
    };

/** Regra 7: o segundo profissional (login próprio, diferente, com a senha conferida e a permissão de conferir). */
export function conferirConferente(c: {
  readonly exigida: boolean;
  readonly primeiro: string;
  readonly conferente: string | null;
  readonly senhaConferida: boolean;
  readonly podeConferir: boolean;
}): ResultadoConferente {
  if (!c.exigida) return { ok: true };
  if (!c.conferente)
    return {
      ok: false,
      codigo: 'conferente-ausente',
      mensagem: 'Item de alta vigilância ou hemocomponente: a dupla checagem exige o segundo profissional.',
    };
  if (c.conferente.trim().toUpperCase() === c.primeiro.trim().toUpperCase())
    return {
      ok: false,
      codigo: 'conferente-mesmo',
      mensagem: 'O segundo profissional tem de ser outra pessoa, com o login próprio.',
    };
  if (!c.senhaConferida)
    return {
      ok: false,
      codigo: 'conferente-senha',
      mensagem: 'A senha do segundo profissional não conferiu.',
    };
  if (!c.podeConferir)
    return {
      ok: false,
      codigo: 'conferente-sem-permissao',
      mensagem: 'O segundo profissional não tem a permissão de conferir a administração.',
    };
  return { ok: true };
}
