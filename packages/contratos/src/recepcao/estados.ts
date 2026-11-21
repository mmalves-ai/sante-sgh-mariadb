// Máquina de estados da senha sobre as letras do legado (M19; ficha, seção 5, "Regras comuns"): a situação da senha
// (situação da senha emitida) e o que cada evento grava, medidos no perfil passivo da cópia pc (só agregados; sequências
// de eventos por senha desde 2024):
//   - no guichê (a senha ainda sem atendimento): a chamada põe o guichê e o usuário na senha, sem linha no fluxo
//     (98,5% das senhas "diversos" terminam só com L; o atendimento começa com A); chamar de novo grava C no local do
//     guichê (CL, CCL, CCS); suspender e não localizado gravam S com o motivo e devolvem o guichê a 0 (24.164 "S" com
//     guichê 0); a senha suspensa pode ser chamada de novo (SC…, SL); "diversos" termina com L e o motivo fixo;
//   - no local de atendimento (a senha com atendimento aberto, situação A): chamar ao local põe C (AC/C), cancelar a
//     chamada (X) e não localizado (N) voltam a A (ACX/A, ACXN/A), encaminhar grava E com o local de destino (ACAE/A),
//     liberar do local grava L e a senha fica A (AL/A);
//   - F (finalizar) e I (ignorar) nunca aparecem: recusados (letra nunca vista).
import type { EventoSenha, LetraFluxo } from './vocabulario.js';

export interface EstadoSenha {
  /** Situação da senha emitida (vazio tratado como G). */
  readonly situacao: string;
  /** Guichê que chamou (0 = ninguém). */
  readonly guiche: number;
  /** Tem atendimento aberto (vínculo senha × atendimento). */
  readonly atendida: boolean;
  /** Tipo do gerador de senha ('0' recepção, '5' diversos). */
  readonly tipoGerador: string;
}

/** O que o evento muda: a situação nova (null = não muda), o guichê novo (null = não muda) e a letra do fluxo. */
export interface EfeitoEvento {
  readonly situacao: string | null;
  readonly guiche: 'meu' | 'zero' | null;
  /** Letra gravada no fluxo (null = o evento não grava linha no fluxo). */
  readonly letraFluxo: LetraFluxo | null;
  /** O evento grava o motivo na senha (texto do motivo padronizado). */
  readonly motivo: 'entrada' | 'diversos' | 'nao-localizado' | null;
  /** O usuário da senha passa a ser quem registra o evento. */
  readonly usuario: boolean;
}

export type Recusa = { readonly ok: false; readonly codigo: string; readonly motivo: string };
export type Decisao = { readonly ok: true; readonly efeito: EfeitoEvento } | Recusa;

const recusa = (codigo: string, motivo: string): Recusa => ({ ok: false, codigo, motivo });
const efeito = (e: EfeitoEvento): Decisao => ({ ok: true, efeito: e });

/** Situação normalizada (o CHAR(1) do legado pode vir vazio ou com espaço). */
export function situacaoDe(s: string | null | undefined): string {
  const t = (s ?? '').trim().toUpperCase();
  return t === '' ? 'G' : t;
}

/** Pode ser chamada pela próxima do guichê? (SPSENHAATEND: situação fora de L e S, sem atendimento, guichê livre.) */
export function chamavel(s: EstadoSenha): boolean {
  return situacaoDe(s.situacao) === 'G' && s.guiche === 0 && !s.atendida;
}

/**
 * Decide o evento no estado atual. `meuGuiche`: o número do guichê de quem registra (0 = no local de atendimento).
 * Toda regra de recusa tem um código estável (a tela traduz) e a mensagem em português.
 */
export function decidirEvento(s: EstadoSenha, evento: EventoSenha, meuGuiche: number): Decisao {
  const sit = situacaoDe(s.situacao);
  const doGuiche = meuGuiche > 0 && s.guiche === meuGuiche;
  const naoAtendida = !s.atendida;
  switch (evento) {
    case 'rechamar':
      if (!naoAtendida) return recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
      if (!doGuiche || (sit !== 'G' && sit !== 'S'))
        return recusa('senha-nao-esta-no-guiche', 'Só se chama de novo a senha chamada por este guichê.');
      return efeito({ situacao: null, guiche: null, letraFluxo: 'C', motivo: null, usuario: false });
    case 'retomar':
      if (!naoAtendida) return recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
      if (sit !== 'S') return recusa('senha-nao-suspensa', 'Só a senha suspensa é chamada por aqui.');
      if (s.guiche !== 0 && !doGuiche)
        return recusa('senha-em-outro-guiche', 'A senha suspensa já foi chamada por outro guichê.');
      if (meuGuiche <= 0) return recusa('guiche-fechado', 'Abra o guichê antes de chamar.');
      return efeito({ situacao: null, guiche: 'meu', letraFluxo: 'C', motivo: null, usuario: true });
    case 'liberar':
      if (s.tipoGerador !== '5')
        return recusa(
          'senha-abre-atendimento',
          'A senha deste serviço segue para a abertura do atendimento: ela não se conclui no guichê.',
        );
      if (!naoAtendida) return recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
      if (!doGuiche || (sit !== 'G' && sit !== 'S'))
        return recusa('senha-nao-esta-no-guiche', 'Só se conclui a senha chamada por este guichê.');
      return efeito({ situacao: 'L', guiche: null, letraFluxo: 'L', motivo: 'diversos', usuario: true });
    case 'suspender':
    case 'naoLocalizado': {
      if (!naoAtendida) return recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
      if (sit !== 'G') return recusa('situacao-mudou', 'A senha não está aguardando nem chamada no guichê.');
      if (s.guiche !== 0 && !doGuiche)
        return recusa('senha-em-outro-guiche', 'A senha foi chamada por outro guichê.');
      return efeito({
        situacao: 'S',
        guiche: 'zero',
        letraFluxo: 'S',
        motivo: evento === 'naoLocalizado' ? 'nao-localizado' : 'entrada',
        usuario: true,
      });
    }
    case 'chamarNoLocal':
      if (naoAtendida) return recusa('senha-sem-atendimento', 'A senha ainda não tem atendimento aberto.');
      if (sit !== 'A' && sit !== 'C') return recusa('situacao-mudou', 'A senha não está em atendimento.');
      return efeito({ situacao: 'C', guiche: null, letraFluxo: 'C', motivo: null, usuario: true });
    case 'cancelarChamada':
      if (naoAtendida) return recusa('senha-sem-atendimento', 'A senha ainda não tem atendimento aberto.');
      if (sit !== 'C') return recusa('senha-nao-chamada', 'A senha não está chamada no local.');
      return efeito({ situacao: 'A', guiche: null, letraFluxo: 'X', motivo: null, usuario: true });
    case 'naoLocalizadoNoLocal':
      if (naoAtendida) return recusa('senha-sem-atendimento', 'A senha ainda não tem atendimento aberto.');
      if (sit !== 'C' && sit !== 'A') return recusa('situacao-mudou', 'A senha não está em atendimento.');
      return efeito({ situacao: 'A', guiche: null, letraFluxo: 'N', motivo: null, usuario: true });
    case 'encaminhar':
      if (naoAtendida)
        return recusa(
          'senha-sem-atendimento',
          'O encaminhamento entre locais é da senha com atendimento aberto.',
        );
      if (sit !== 'A') return recusa('situacao-mudou', 'A senha não está em atendimento no local.');
      return efeito({ situacao: null, guiche: null, letraFluxo: 'E', motivo: null, usuario: false });
    case 'liberarDoLocal':
      if (naoAtendida) return recusa('senha-sem-atendimento', 'A senha ainda não tem atendimento aberto.');
      if (sit !== 'A' && sit !== 'C') return recusa('situacao-mudou', 'A senha não está em atendimento.');
      return efeito({ situacao: null, guiche: null, letraFluxo: 'L', motivo: null, usuario: true });
    case 'finalizar':
    case 'ignorar':
      return recusa(
        'letra-nunca-vista',
        'Este evento não é usado nas filas do estabelecimento: nada foi gravado.',
      );
  }
}

/** Eventos que a tela oferece agora para a senha (os demais ficam escondidos). */
export function eventosPossiveis(s: EstadoSenha, meuGuiche: number): EventoSenha[] {
  const todos: EventoSenha[] = [
    'rechamar',
    'retomar',
    'liberar',
    'suspender',
    'naoLocalizado',
    'chamarNoLocal',
    'cancelarChamada',
    'naoLocalizadoNoLocal',
    'encaminhar',
    'liberarDoLocal',
  ];
  return todos.filter((e) => decidirEvento(s, e, meuGuiche).ok);
}
