// Atalho "/" (ir para a busca da lista atual): a lista visível registra a sua caixa de busca aqui e a
// casca foca a mais recente. Sem lista registrada, o atalho não aparece nem faz nada.
import { shallowRef } from 'vue';

const pilha = shallowRef<readonly HTMLElement[]>([]);

export function registrarBuscaDaLista(el: HTMLElement): () => void {
  pilha.value = [...pilha.value, el];
  return () => {
    pilha.value = pilha.value.filter((x) => x !== el);
  };
}

export function buscaDaListaAtual(): HTMLElement | null {
  const el = pilha.value.at(-1) ?? null;
  return el?.querySelector?.('input') ?? el;
}

export function haBuscaDaLista(): boolean {
  return pilha.value.length > 0;
}
