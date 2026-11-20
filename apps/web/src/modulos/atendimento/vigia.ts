// Avisos de mudança da fila do consultório e do quadro do PA (M20; ficha, seção 4): o canal de eventos do servidor só
// diz "mudou" (as gravações do novo e o vigia de 1 a 2 s das senhas) e a tela relê. Sem o canal (proxy, navegador,
// servidor sem avisos), a tela relê sozinha a cada 15 s. Fecha ao sair da tela.
import { onBeforeUnmount, onMounted, ref } from 'vue';

export const RELEITURA_SEM_CANAL_MS = 15_000;
/** Com o canal ligado, uma releitura de segurança (o que o canal não vê: a ficha aberta sem senha pela outra ponta). */
export const RELEITURA_COM_CANAL_MS = 60_000;

export function usarAvisosAtendimento(canal: string, aoMudar: () => void) {
  const conectado = ref(false);
  let fonte: EventSource | null = null;
  onMounted(() => {
    if (typeof EventSource === 'undefined') return;
    fonte = new EventSource(canal);
    fonte.addEventListener('open', () => (conectado.value = true));
    fonte.addEventListener('mudanca', () => aoMudar());
    fonte.addEventListener('error', () => (conectado.value = false));
  });
  onBeforeUnmount(() => fonte?.close());
  /** O intervalo da releitura para o useQuery (curto sem canal; de segurança com ele). */
  const intervalo = () => (conectado.value ? RELEITURA_COM_CANAL_MS : RELEITURA_SEM_CANAL_MS);
  return { conectado, intervalo };
}
