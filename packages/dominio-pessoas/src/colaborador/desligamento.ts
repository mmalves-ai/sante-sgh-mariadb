// Regra 2 do M52 (cap-07 §7.1.1; ref 01 §6; ficha, seção 5, `acesso.bloquearUsuario` cenário `desligamento`): o
// desligamento bloqueia o acesso no mesmo dia, nos dois sistemas (é o mesmo TBUSERS), sem apagar o usuário. Quem
// trabalha nos dois hospitais tem um TBUSERS em cada banco: cada banco grava em transação própria, só para os
// vínculos daquele hospital. Se a pessoa ainda tem outro vínculo ativo no mesmo hospital, o usuário fica livre
// (D-DESL-52, POL-5). Usuário já bloqueado: só o lado SGH_ é gravado (cenário `recusa-ja-bloqueado`).
import { diasEntre } from '../datas.js';

export interface VinculoParaDesligar {
  readonly id: number;
  readonly hospital: string;
  readonly admissao: string;
  readonly desligamento: string | null;
}

export interface UsuarioRelido {
  readonly hospital: string;
  readonly login: string;
  readonly bloqueado: boolean;
}

export interface PedidoDesligamento {
  readonly vinculo: VinculoParaDesligar;
  readonly data: string;
  readonly hoje: string;
  /** Os usuários da pessoa em cada hospital da Rede, relidos (TBUSERS.BLOQUEADO). */
  readonly usuarios: readonly UsuarioRelido[];
  /** Os OUTROS vínculos ativos da mesma pessoa, com o hospital. */
  readonly outrosVinculosAtivos: readonly { readonly id: number; readonly hospital: string }[];
  /** Login de quem registra: ninguém desliga a si mesmo (o executor do M10 já recusa bloquear a si mesmo). */
  readonly ator: string;
}

export type AcaoUsuario = 'bloquear' | 'jaBloqueado' | 'mantido';

export interface PassoUsuario {
  readonly hospital: string;
  readonly login: string;
  readonly acao: AcaoUsuario;
  readonly motivo: string | null;
}

export type RecusaDesligamento = 'ja-desligado' | 'data-futura' | 'antes-da-admissao' | 'a-si-mesmo';

export type PlanoDesligamento =
  | {
      readonly ok: true;
      /** Passo SGH_ (SGH_PES_VINCULO + SGH_OUTBOX) e, por hospital, o bloqueio pelo executor. */
      readonly usuarios: readonly PassoUsuario[];
      /** Hospitais em que a operação `acesso.bloquearUsuario` roda (uma transação por banco). */
      readonly bloquearEm: readonly string[];
    }
  | { readonly ok: false; readonly recusa: RecusaDesligamento; readonly mensagem: string };

export function planejarDesligamento(p: PedidoDesligamento): PlanoDesligamento {
  if (p.vinculo.desligamento !== null)
    return { ok: false, recusa: 'ja-desligado', mensagem: 'Este vínculo já está desligado.' };
  if (diasEntre(p.hoje, p.data) > 0)
    return {
      ok: false,
      recusa: 'data-futura',
      mensagem: 'O desligamento é registrado no dia em que acontece: a data não pode ser futura.',
    };
  if (diasEntre(p.vinculo.admissao, p.data) < 0)
    return {
      ok: false,
      recusa: 'antes-da-admissao',
      mensagem: 'A data do desligamento vem antes da admissão.',
    };
  const ator = p.ator.trim().toUpperCase();
  if (p.usuarios.some((u) => u.login.trim().toUpperCase() === ator))
    return {
      ok: false,
      recusa: 'a-si-mesmo',
      mensagem: 'Ninguém registra o próprio desligamento. Peça a outra pessoa do RH.',
    };
  const hospitaisComOutroVinculo = new Set(p.outrosVinculosAtivos.map((v) => v.hospital));
  const usuarios = p.usuarios.map((u): PassoUsuario => {
    if (hospitaisComOutroVinculo.has(u.hospital))
      return {
        hospital: u.hospital,
        login: u.login,
        acao: 'mantido',
        motivo: 'A pessoa tem outro vínculo ativo neste estabelecimento.',
      };
    if (u.bloqueado) return { hospital: u.hospital, login: u.login, acao: 'jaBloqueado', motivo: null };
    return { hospital: u.hospital, login: u.login, acao: 'bloquear', motivo: null };
  });
  const bloquearEm = [
    ...new Set(usuarios.filter((u) => u.acao === 'bloquear').map((u) => u.hospital)),
  ].sort();
  return { ok: true, usuarios, bloquearEm };
}
