// Avisos de mudança do quadro do bloco (M46, etapa 2; ficha, seção 7: "tempo real"): o canal de eventos do servidor só diz
// "mudou" (as gravações do bloco neste processo e o canal "bloco" do vigia de mudanças, que vê em 1 a 2 s o agendamento,
// o cancelamento, o estado, a APA, a ficha, o checklist e a movimentação gravados por qualquer caminho); a tela relê.
// Sem o canal (proxy, navegador), a tela relê sozinha a cada 15 s; com ele, ainda relê a cada 60 s por segurança (o dia
// escolhido diferente de hoje, que o vigia não recorta). Fecha ao sair da tela.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { CANAL_QUADRO_BLOCO } from './api-bloco-seguro.js';

export const RELEITURA_SEM_CANAL_BLOCO_MS = 15_000;
export const RELEITURA_COM_CANAL_BLOCO_MS = 60_000;

export function usarAvisosDoBloco(aoMudar: () => void) {
  const conectado = ref(false);
  let fonte: EventSource | null = null;
  let reserva: ReturnType<typeof setInterval> | null = null;
  const ligarReserva = (ms = RELEITURA_SEM_CANAL_BLOCO_MS) => {
    if (reserva) clearInterval(reserva);
    reserva = setInterval(aoMudar, ms);
  };
  onMounted(() => {
    if (typeof EventSource === 'undefined') {
      ligarReserva();
      return;
    }
    fonte = new EventSource(CANAL_QUADRO_BLOCO);
    let caiu = false;
    fonte.addEventListener('open', () => {
      conectado.value = true;
      ligarReserva(RELEITURA_COM_CANAL_BLOCO_MS);
      // O servidor não reenvia o que mudou durante a queda: relê ao reconectar (não na primeira abertura).
      if (caiu) aoMudar();
      caiu = false;
    });
    fonte.addEventListener('mudanca', () => aoMudar());
    fonte.addEventListener('error', () => {
      if (conectado.value || !reserva) ligarReserva();
      conectado.value = false;
      caiu = true;
    });
  });
  onBeforeUnmount(() => {
    fonte?.close();
    if (reserva) clearInterval(reserva);
  });
  return { conectado };
}
