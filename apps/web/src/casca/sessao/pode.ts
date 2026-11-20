// Autorização na tela (ficha do M06, regra 5): as MESMAS regras CASL do servidor (regrasDeAcesso de
// @sgh/dominio-acesso), montadas da sessão (permissões e escopos do legado). A tela só esconde ou desabilita;
// quem decide é o servidor (a guarda recusa o que a tela deixasse passar).
import type { Sessao } from '@sgh/contratos';
import {
  type AbilitySgh,
  criarAbility,
  pode as podeCasl,
  type RegistroComEscopo,
  regrasDeAcesso,
} from '@sgh/dominio-acesso/autorizacao';
import { type Directive, shallowRef, watchEffect } from 'vue';

export function abilityDaSessao(s: Sessao | null | undefined): AbilitySgh {
  return criarAbility(regrasDeAcesso(s?.permissoes ?? [], s?.escopos));
}

const atual = shallowRef<AbilitySgh>(abilityDaSessao(null));
let assinatura = '';

/** A casca chama a cada sessão lida (troca de usuário, de estabelecimento, revalidação de 3 min). */
export function definirSessaoDaTela(s: Sessao | null | undefined): void {
  const k = JSON.stringify([s?.permissoes ?? [], s?.escopos ?? null]);
  if (k === assinatura) return;
  assinatura = k;
  atual.value = abilityDaSessao(s);
}

export function pode(codigo: string, registro?: RegistroComEscopo): boolean {
  return podeCasl(atual.value, codigo, registro);
}

type ValorPode = string | readonly [string, RegistroComEscopo];

interface ElementoPode extends HTMLElement {
  __sghPararPode?: () => void;
}

function aplicar(el: ElementoPode, valor: ValorPode, desabilitar: boolean): void {
  const [codigo, registro] = typeof valor === 'string' ? [valor, undefined] : valor;
  const permitido = pode(codigo, registro);
  if (desabilitar) {
    el.toggleAttribute('disabled', !permitido);
    el.setAttribute('aria-disabled', String(!permitido));
  } else {
    el.hidden = !permitido;
  }
}

/** `v-pode="'acesso.grupo.ler'"` esconde; `v-pode.desabilitar` desabilita; `[codigo, registro]` com escopo. */
export const diretivaPode: Directive<ElementoPode, ValorPode> = {
  mounted(el, binding) {
    el.__sghPararPode = watchEffect(() => aplicar(el, binding.value, !!binding.modifiers['desabilitar']));
  },
  updated(el, binding) {
    aplicar(el, binding.value, !!binding.modifiers['desabilitar']);
  },
  unmounted(el) {
    el.__sghPararPode?.();
  },
};
