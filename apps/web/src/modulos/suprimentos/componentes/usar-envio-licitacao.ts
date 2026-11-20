// O envio de uma gravação da tela da licitação: guarda o erro (problem details) e o "enviando", e avisa o painel do
// processo com a mensagem do servidor para ele reler o detalhe e a lista.
import { ref } from 'vue';

export function usarEnvioLicitacao(aoGravar: (mensagem: string) => void) {
  const erro = ref<unknown>(null);
  const enviando = ref(false);
  async function executar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
    erro.value = null;
    enviando.value = true;
    try {
      const r = await fn();
      aoGravar(r.mensagem);
      return true;
    } catch (e) {
      erro.value = e;
      return false;
    } finally {
      enviando.value = false;
    }
  }
  return { erro, enviando, executar };
}
