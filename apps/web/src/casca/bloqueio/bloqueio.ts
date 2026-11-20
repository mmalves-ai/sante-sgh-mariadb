// Camada de bloqueio de sessão (regra 16; cap-08 §8.8): oculta todo dado de paciente e volta à mesma tela
// com o digitado (nada é desmontado). Ligada aos eventos de sessão: o M05 emite "bloquear" (inatividade
// sinalizada pelo servidor, troca rápida de usuário); até lá, inatividade local e o botão "Bloquear a tela".
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type EventoSessao = 'bloquear' | 'desbloquear';
type Ouvinte = (e: EventoSessao) => void;

/** Barramento de eventos de sessão (o M05 publica aqui). */
export class EventosSessao {
  private readonly ouvintes = new Set<Ouvinte>();
  ouvir(o: Ouvinte): () => void {
    this.ouvintes.add(o);
    return () => this.ouvintes.delete(o);
  }
  emitir(e: EventoSessao): void {
    for (const o of this.ouvintes) o(e);
  }
}
export const eventosSessao = new EventosSessao();

/** Relógio de inatividade: dispara depois de `segundos` sem atividade; 0 desliga. */
export class RelogioInatividade {
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private segundos: number,
    private readonly aoEsgotar: () => void,
  ) {}
  configurar(segundos: number): void {
    this.segundos = segundos;
    this.atividade();
  }
  atividade(): void {
    clearTimeout(this.temporizador);
    if (this.segundos > 0) this.temporizador = setTimeout(this.aoEsgotar, this.segundos * 1000);
  }
  parar(): void {
    clearTimeout(this.temporizador);
  }
}

export const usarBloqueio = defineStore('bloqueio', () => {
  const bloqueada = ref(false);
  function bloquear(): void {
    bloqueada.value = true;
  }
  function desbloquear(): void {
    bloqueada.value = false;
  }
  eventosSessao.ouvir((e) => (e === 'bloquear' ? bloquear() : desbloquear()));
  return { bloqueada, bloquear, desbloquear };
});

/**
 * Isola tudo o que está fora da casca enquanto a tela está bloqueada: diálogos, popovers e menus do
 * OpenVue são desenhados direto no `body` (fora de `.casca__conteudo`) e ficariam visíveis e acessíveis.
 * Cada filho do `body` que não contém `raiz` recebe `inert`, `aria-hidden` e `visibility: hidden`; os que
 * aparecerem durante o bloqueio também. Devolve a função que desfaz tudo, restaurando os valores originais.
 */
export function isolarForaDaCasca(raiz: Element, corpo: HTMLElement = document.body): () => void {
  const originais = new Map<
    HTMLElement,
    { inert: boolean; ariaHidden: string | null; visibilidade: string }
  >();
  const isolar = (el: Element): void => {
    if (!(el instanceof HTMLElement) || el.contains(raiz) || originais.has(el)) return;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TEMPLATE') return;
    originais.set(el, {
      inert: el.hasAttribute('inert'),
      ariaHidden: el.getAttribute('aria-hidden'),
      visibilidade: el.style.visibility,
    });
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
    el.style.visibility = 'hidden';
  };
  Array.from(corpo.children).forEach(isolar);
  const observador = new MutationObserver((mudancas) => {
    for (const m of mudancas) m.addedNodes.forEach((n) => n instanceof Element && isolar(n));
  });
  observador.observe(corpo, { childList: true });
  return () => {
    observador.disconnect();
    for (const [el, o] of originais) {
      el.toggleAttribute('inert', o.inert);
      if (o.ariaHidden === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', o.ariaHidden);
      el.style.visibility = o.visibilidade;
    }
    originais.clear();
  };
}
