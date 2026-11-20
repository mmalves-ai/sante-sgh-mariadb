// Contexto clínico da tela aberta (M48, etapa 1; preparo §3.4): as telas que abrem um atendimento (o prontuário do
// paciente) dizem à casca qual é ele, para o diálogo "Notificar incidente" já sair com o paciente e o local. O diálogo
// mostra só o rótulo que a tela já mostrava e manda só o ID do atendimento: o servidor relê o resto pelo ID (o nome do
// paciente nunca sai do navegador na notificação). Sair da tela limpa o contexto (só a dona do contexto limpa).
import { onUnmounted, readonly, shallowRef, watch } from 'vue';

export interface ContextoClinico {
  /** ID do atendimento aberto na tela. */
  readonly atendimento: number;
  /** O que a tela já mostrava (nome e atendimento), para quem notifica conferir. */
  readonly rotulo: string;
}

const atual = shallowRef<ContextoClinico | null>(null);

/** O contexto clínico da tela aberta (somente leitura). */
export const contextoClinico = readonly(atual);

/** A tela abriu um atendimento. Devolve a função que limpa (só se o contexto ainda for o dela). */
export function definirContextoClinico(c: ContextoClinico): () => void {
  const meu: ContextoClinico = { atendimento: c.atendimento, rotulo: c.rotulo.slice(0, 160) };
  atual.value = meu;
  return () => {
    if (atual.value === meu) atual.value = null;
  };
}

export function limparContextoClinico(): void {
  atual.value = null;
}

/** O rótulo do paciente no diálogo: nome social antes do civil, com o atendimento que a tela mostrava. */
export function rotuloDoPaciente(p: {
  readonly nomeSocial: string | null;
  readonly nomeCivil: string;
  readonly atendimento: string;
}): string {
  return [p.nomeSocial || p.nomeCivil, p.atendimento].filter(Boolean).join(' · ');
}

/**
 * Para as telas clínicas (etapa 2, D-CONTEXTO-48.2: checagem, transfusão à beira do leito, checklist de cirurgia
 * segura): o contexto acompanha o atendimento que a tela mostra e é solto quando ela sai. Chamar no setup.
 */
export function usarContextoClinico(fonte: () => ContextoClinico | null): void {
  let soltar: (() => void) | null = null;
  watch(
    () => {
      const c = fonte();
      return c ? `${String(c.atendimento)}\u0000${c.rotulo}` : null;
    },
    () => {
      soltar?.();
      soltar = null;
      const c = fonte();
      if (c && Number.isInteger(c.atendimento) && c.atendimento > 0) soltar = definirContextoClinico(c);
    },
    { immediate: true },
  );
  onUnmounted(() => soltar?.());
}
