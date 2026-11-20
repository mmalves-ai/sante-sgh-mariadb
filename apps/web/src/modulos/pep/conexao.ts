// Regra offline da prescrição (M24; ficha, seção 7): sem conexão, a tela avisa e não grava; nada da prescrição é
// guardado no aparelho (nem rascunho local), porque a prescrição só vale assinada no banco do estabelecimento.
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export function conectado(nav: { onLine?: boolean } | undefined = globalThis.navigator): boolean {
  return nav?.onLine !== false;
}

/** O estado da conexão do navegador, atualizado pelos eventos online/offline. */
export function useConexao(
  alvo: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): Ref<boolean> {
  const online = ref(conectado());
  const atualizar = () => {
    online.value = conectado();
  };
  onMounted(() => {
    alvo.addEventListener('online', atualizar);
    alvo.addEventListener('offline', atualizar);
  });
  onBeforeUnmount(() => {
    alvo.removeEventListener('online', atualizar);
    alvo.removeEventListener('offline', atualizar);
  });
  return online;
}
