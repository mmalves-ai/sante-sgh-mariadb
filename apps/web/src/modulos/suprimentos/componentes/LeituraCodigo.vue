<script setup lang="ts">
// Campo de leitura do código (F3.6, 05-SUP linha 14): o leitor de código de barras ou DataMatrix "digita" e manda o
// Enter; a API resolve pelo padrão configurado, pela leitura GS1 ou pelo código do item e devolve o item, o lote, a
// validade, a quantidade e os alertas. A recusa aparece na hora e o campo volta limpo para a próxima leitura.
import { SanteBotao } from '@sgh/ui';
import { ref, useId } from 'vue';
import { type LeituraCodigo, lerCodigoEstoque } from '../api-etiqueta.js';
import { mensagensEtiqueta as M } from '../i18n-etiqueta.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ testid?: string }>();
const emit = defineEmits<{ lido: [leitura: LeituraCodigo] }>();
const id = useId();
const codigo = ref('');
const ultimo = ref<LeituraCodigo | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const tid = (s: string) => `${props.testid ?? 'leitura'}-${s}`;
const dataBr = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';

async function ler(): Promise<void> {
  const c = codigo.value;
  if (!c.trim() || ocupado.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await lerCodigoEstoque(c);
    ultimo.value = r;
    emit('lido', r);
  } catch (x) {
    ultimo.value = null;
    erro.value = x;
  } finally {
    codigo.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <div class="filtros">
    <span class="campo">
      <label :for="`leitura-${id}`">{{ M.leitura }}</label>
      <input
        :id="`leitura-${id}`"
        v-model="codigo"
        autocomplete="off"
        maxlength="200"
        :data-testid="tid('codigo')"
        @keydown.enter.prevent="ler"
      />
    </span>
    <SanteBotao variante="secundario" :rotulo="M.ler" :data-testid="tid('ler')" @acionar="ler" />
  </div>
  <p v-if="ultimo" role="status" :data-testid="tid('resultado')">
    {{ M.lido }}: {{ ultimo.item.nome }} · {{ ultimo.quantidade }} {{ ultimo.item.unidade }}
    <template v-if="ultimo.lote"> · {{ M.lote }} {{ ultimo.lote }}</template>
    · {{ M.validade }} {{ dataBr(ultimo.validade) }} ·
    {{ ultimo.origem === 'etiqueta' ? M.origemEtiqueta : M.origemItem }}
  </p>
  <p v-for="a in ultimo?.alertas ?? []" :key="a" role="alert" :data-testid="tid(`alerta-${a}`)">
    {{ M.alertas[a] ?? a }}
  </p>
  <ErroSuprimentos v-if="erro" :erro="erro" />
</template>
