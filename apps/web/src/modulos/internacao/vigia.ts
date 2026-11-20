// Avisos de mudança do painel de leitos (M16; regra 15): o canal de eventos do servidor só diz "mudou"; a tela
// relê. Sem o canal (proxy, navegador), a tela relê sozinha a cada 30 s. Fecha ao sair da tela.
import { onBeforeUnmount, onMounted, ref } from 'vue';

export const RELEITURA_SEM_CANAL_MS = 30_000;

export function usarAvisosDeLeitos(aoMudar: () => void) {
  const conectado = ref(false);
  let fonte: EventSource | null = null;
  let reserva: ReturnType<typeof setInterval> | null = null;
  const ligarReserva = () => {
    reserva ??= setInterval(aoMudar, RELEITURA_SEM_CANAL_MS);
  };
  onMounted(() => {
    if (typeof EventSource === 'undefined') {
      ligarReserva();
      return;
    }
    fonte = new EventSource('/api/internacao/leitos/eventos');
    fonte.addEventListener('open', () => {
      conectado.value = true;
      if (reserva) clearInterval(reserva);
      reserva = null;
    });
    fonte.addEventListener('mudanca', () => aoMudar());
    fonte.addEventListener('error', () => {
      conectado.value = false;
      ligarReserva();
    });
  });
  onBeforeUnmount(() => {
    fonte?.close();
    if (reserva) clearInterval(reserva);
  });
  return { conectado };
}
