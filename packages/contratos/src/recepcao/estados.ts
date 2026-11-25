// Máquina de estados da senha sobre a situação nominal (SITUACOES_SENHA; ficha F3.2, seção 5, "Regras comuns"):
//   - no guichê (a senha ainda sem atendimento): chamar põe o guichê e a situação "chamada"; chamar de novo mantém;
//     suspender devolve o guichê e deixa "suspensa" com o motivo; o paciente que não atende à chamada fica
//     "nao_compareceu" (o motivo padronizado e o guichê devolvido); a suspensa e a que não compareceu voltam pela
//     retomada (chamada de novo pelo guichê); "diversos" se conclui no guichê ("atendida", com o motivo fixo);
//   - no local de atendimento (a senha com atendimento aberto): chamar ao local deixa "chamada"; cancelar a chamada e
//     não localizado no local voltam a "em_atendimento"; encaminhar deixa "encaminhada" (o local passa a ser o
//     destino); liberar do local volta a "em_atendimento" (o atendimento segue aberto);
//   - F (finalizar) e I (ignorar) nunca aparecem nas filas: recusados.
// As letras ficam só no fluxo da senha (LETRAS_FLUXO), o histórico de eventos; a situação nunca é letra.
import type { EventoSenha, LetraFluxo, SituacaoSenha } from './vocabulario.js';

export interface EstadoSenha {
  /** Situação nominal da senha (SITUACOES_SENHA). */
  readonly situacao: string;
  /** Guichê que chamou (0 = nenhum). */
  readonly guiche: number;
  /** Tem atendimento aberto (vínculo senha × atendimento). */
  readonly atendida: boolean;
  /** Tipo do gerador de senha ('0' recepção, '5' diversos). */
  readonly tipoGerador: string;
}

/** O que o evento muda: a situação nova (null = não muda), o guichê novo (null = não muda) e a letra do fluxo. */
export interface EfeitoEvento {
  readonly situacao: SituacaoSenha | null;
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

/** Situação normalizada (vazia vale "aguardando", a situação de nascimento). */
export function situacaoDe(s: string | null | undefined): string {
  const t = (s ?? '').trim().toLowerCase();
  return t === '' ? 'aguardando' : t;
}

const NO_LOCAL = ['chamada', 'em_atendimento', 'encaminhada'];
const naoVeio = (sit: string) => sit === 'suspensa' || sit === 'nao_compareceu';

/** Pode ser chamada pela próxima do guichê? (aguardando, sem guichê e sem atendimento.) */
export function chamavel(s: EstadoSenha): boolean {
  return situacaoDe(s.situacao) === 'aguardando' && s.guiche === 0 && !s.atendida;
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
      if (!doGuiche || sit !== 'chamada')
        return recusa('senha-nao-esta-no-guiche', 'Só se chama de novo a senha chamada por este guichê.');
      return efeito({ situacao: null, guiche: null, letraFluxo: 'C', motivo: null, usuario: false });
    case 'retomar':
      if (!naoAtendida) return recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
      if (!naoVeio(sit))
        return recusa('senha-nao-suspensa', 'Só a senha suspensa ou que não compareceu é chamada por aqui.');
      if (s.guiche !== 0 && !doGuiche)
        return recusa('senha-em-outro-guiche', 'A senha suspensa já foi chamada por outro guichê.');
      if (meuGuiche <= 0) return recusa('guiche-fechado', 'Abra o guichê antes de chamar.');
      return efeito({ situacao: 'chamada', guiche: 'meu', letraFluxo: 'C', motivo: null, usuario: true });
    case 'liberar':
      if (s.tipoGerador !== '5')
        return recusa(
          'senha-abre-atendimento',
          'A senha deste serviço segue para a abertura do atendimento: ela não se conclui no guichê.',
        );
      if (!naoAtendida) return recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
      if (!doGuiche || sit !== 'chamada')
        return recusa('senha-nao-esta-no-guiche', 'Só se conclui a senha chamada por este guichê.');
      return efeito({
        situacao: 'atendida',
        guiche: null,
        letraFluxo: 'L',
        motivo: 'diversos',
        usuario: true,
      });
    case 'suspender':
    case 'naoLocalizado': {
      if (!naoAtendida) return recusa('senha-em-atendimento', 'A senha já tem atendimento aberto.');
      if (sit !== 'aguardando' && sit !== 'chamada')
        return recusa('situacao-mudou', 'A senha não está aguardando nem chamada no guichê.');
      if (s.guiche !== 0 && !doGuiche)
        return recusa('senha-em-outro-guiche', 'A senha foi chamada por outro guichê.');
      if (evento === 'naoLocalizado' && sit !== 'chamada')
        return recusa('senha-nao-chamada', 'Só a senha chamada pode ficar como não compareceu.');
      return efeito({
        situacao: evento === 'naoLocalizado' ? 'nao_compareceu' : 'suspensa',
        guiche: 'zero',
        letraFluxo: 'S',
        motivo: evento === 'naoLocalizado' ? 'nao-localizado' : 'entrada',
        usuario: true,
      });
    }
    case 'chamarNoLocal':
      if (naoAtendida) return recusa('senha-sem-atendimento', 'A senha ainda não tem atendimento aberto.');
      if (!NO_LOCAL.includes(sit)) return recusa('situacao-mudou', 'A senha não está em atendimento.');
      return efeito({ situacao: 'chamada', guiche: null, letraFluxo: 'C', motivo: null, usuario: true });
    case 'cancelarChamada':
      if (naoAtendida) return recusa('senha-sem-atendimento', 'A senha ainda não tem atendimento aberto.');
      if (sit !== 'chamada') return recusa('senha-nao-chamada', 'A senha não está chamada no local.');
      return efeito({
        situacao: 'em_atendimento',
        guiche: null,
        letraFluxo: 'X',
        motivo: null,
        usuario: true,
      });
    case 'naoLocalizadoNoLocal':
      if (naoAtendida) return recusa('senha-sem-atendimento', 'A senha ainda não tem atendimento aberto.');
      if (!NO_LOCAL.includes(sit)) return recusa('situacao-mudou', 'A senha não está em atendimento.');
      return efeito({
        situacao: 'em_atendimento',
        guiche: null,
        letraFluxo: 'N',
        motivo: null,
        usuario: true,
      });
    case 'encaminhar':
      if (naoAtendida)
        return recusa(
          'senha-sem-atendimento',
          'O encaminhamento entre locais é da senha com atendimento aberto.',
        );
      if (sit !== 'em_atendimento' && sit !== 'encaminhada')
        return recusa('situacao-mudou', 'A senha não está em atendimento no local.');
      return efeito({ situacao: 'encaminhada', guiche: null, letraFluxo: 'E', motivo: null, usuario: false });
    case 'liberarDoLocal':
      if (naoAtendida) return recusa('senha-sem-atendimento', 'A senha ainda não tem atendimento aberto.');
      if (!NO_LOCAL.includes(sit)) return recusa('situacao-mudou', 'A senha não está em atendimento.');
      return efeito({
        situacao: 'em_atendimento',
        guiche: null,
        letraFluxo: 'L',
        motivo: null,
        usuario: true,
      });
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
