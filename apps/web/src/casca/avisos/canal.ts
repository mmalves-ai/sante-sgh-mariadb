// Canal de eventos da central de avisos (regra 8 do M27; cap-09 §9.9): o servidor só diz "mudou" depois do COMMIT e a
// casca relê o estado gravado, então a reconexão nunca perde aviso. Abre só para quem pode ler os avisos (sem a
// permissão o servidor recusaria e o navegador tentaria de novo sem fim). Sem o canal, relê a cada 15 s.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

export const RELEITURA_SEM_CANAL_MS = 15_000;
export const RELEITURA_COM_CANAL_MS = 60_000;

export function usarCanalAvisos(canal: string, ativo: () => boolean, aoMudar: () => void) {
  const conectado = ref(false);
  let fonte: EventSource | null = null;
  const abrir = () => {
    if (fonte || typeof EventSource === 'undefined' || !ativo()) return;
    fonte = new EventSource(canal);
    fonte.addEventListener('open', () => {
      // Reconectou: pode ter havido aviso no intervalo; relê.
      if (!conectado.value) aoMudar();
      conectado.value = true;
    });
    fonte.addEventListener('mudanca', () => aoMudar());
    fonte.addEventListener('error', () => (conectado.value = false));
  };
  const fechar = () => {
    fonte?.close();
    fonte = null;
    conectado.value = false;
  };
  onMounted(abrir);
  watch(ativo, (a) => (a ? abrir() : fechar()));
  onBeforeUnmount(fechar);
  const intervalo = () => (conectado.value ? RELEITURA_COM_CANAL_MS : RELEITURA_SEM_CANAL_MS);
  return { conectado, intervalo };
}
