<script setup lang="ts">
// Hora do dia (regra 8): a tela aceita HH:MM, H:MM, HHMM e HMM; o modelo carrega sempre "HH:MM" (formatacao/hora).
import { FORMATO_HORA, lerHoraDigitada } from '@sgh/contratos';
import InputText from 'openvue/inputtext';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { traduzirErro } from '../validacao/traduzir.js';
import SanteAlerta from './SanteAlerta.vue';

const props = withDefaults(defineProps<{ rotulo?: string; editavel?: boolean }>(), {
  rotulo: '',
  editavel: false,
});
const valor = defineModel<string | null>({ required: true });
const { t } = useI18n();
const id = `sgh-hora-${useId()}`;
const texto = ref('');
const erro = ref<string | null>(null);
type SituacaoHora =
  | { readonly tipo: 'vazia' }
  | { readonly tipo: 'valida'; readonly texto: string }
  | { readonly tipo: 'invalida'; readonly bruto: string };
/** Valor fora de "HH:MM" aparece como veio, com alerta: nunca é "corrigido" em silêncio (regra 7). */
function classificar(v: string | null | undefined): SituacaoHora {
  if (v === null || v === undefined || v.trim() === '') return { tipo: 'vazia' };
  return FORMATO_HORA.test(v.trim()) ? { tipo: 'valida', texto: v.trim() } : { tipo: 'invalida', bruto: v };
}
const situacao = computed(() => classificar(valor.value));
/** Texto mostrado no campo na última carga do valor: só se grava quando o usuário mudou o texto. */
let textoCarregado = '';
watch(
  valor,
  () => {
    if (!props.editavel || erro.value === null) {
      const s = situacao.value;
      // Hora inválida aparece como veio (bruta), com alerta; nunca "corrigida".
      texto.value = s.tipo === 'valida' ? s.texto : s.tipo === 'invalida' ? s.bruto : '';
      textoCarregado = texto.value;
    }
  },
  { immediate: true },
);

function confirmar(): void {
  if (texto.value === textoCarregado && erro.value === null) return;
  if (texto.value.trim() === '') {
    valor.value = null;
    erro.value = null;
    return;
  }
  try {
    const h = lerHoraDigitada(texto.value);
    valor.value = h;
    texto.value = h ?? '';
    textoCarregado = texto.value;
    erro.value = null;
  } catch (e) {
    erro.value = traduzirErro(t, e);
  }
}
</script>

<template>
  <div v-if="editavel" class="sgh-hora">
    <label :for="id" class="sgh-hora__rotulo">{{ rotulo }}</label>
    <SanteAlerta
      v-if="situacao.tipo === 'invalida'"
      variante="aviso"
      :texto="t('ui.hora.invalida', { valor: situacao.bruto })"
      data-testid="hora-invalida"
    />
    <InputText
      :id="id"
      v-model="texto"
      inputmode="numeric"
      :placeholder="t('ui.hora.ajuda')"
      :invalid="erro !== null"
      :aria-invalid="erro !== null"
      :aria-describedby="`${id}-erro`"
      class="sgh-hora__entrada"
      @blur="confirmar"
      @keydown.enter="confirmar"
    />
    <span :id="`${id}-erro`" class="sgh-hora__erro" aria-live="polite">{{ erro ?? '' }}</span>
  </div>
  <SanteAlerta
    v-else-if="situacao.tipo === 'invalida'"
    variante="aviso"
    :texto="t('ui.hora.invalida', { valor: situacao.bruto })"
    data-testid="hora-invalida"
  />
  <span v-else class="sgh-hora">{{ situacao.tipo === 'valida' ? situacao.texto : t('ui.hora.vazia') }}</span>
</template>

<style scoped>
.sgh-hora {
  font-variant-numeric: tabular-nums;
}
div.sgh-hora {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.sgh-hora__rotulo {
  font-weight: 600;
}
.sgh-hora__entrada {
  min-height: var(--sgh-alvo-minimo);
  max-width: 7em;
}
.sgh-hora__erro {
  color: var(--sgh-alerta);
  font-size: var(--sgh-fonte-pequena);
}
</style>
