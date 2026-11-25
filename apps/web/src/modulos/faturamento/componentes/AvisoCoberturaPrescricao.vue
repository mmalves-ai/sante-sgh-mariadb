<script setup lang="ts">
// Aviso da cobertura da fonte pagadora na prescrição (F7, 09-AREA linha 76). Só leitura e só alerta: a restrição que
// bloquearia o lançamento na conta aparece aqui como aviso, e a prescrição segue (o ato assistencial não é impedido).
// Confere automaticamente quando a lista de itens muda; sem permissão ou sem banco próprio, o aviso some em silêncio.
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  conferirCoberturaPrescricao,
  type ConferenciaCobertura,
  type ItemConferencia,
} from '../api-cobertura.js';

const props = defineProps<{
  atendimentoId: number | null;
  itens: readonly ItemConferencia[];
}>();
const { t } = useI18n();
const resultado = ref<ConferenciaCobertura | null>(null);

const achados = computed(() =>
  (resultado.value?.itens ?? []).flatMap((i) =>
    i.achados
      .filter((a) => a.efeito !== 'liberado')
      .map((a) => ({
        chave: `${i.codigo ?? i.itemId}-${a.origem}-${a.id}`,
        codigo: i.codigo,
        motivo: a.motivo,
      })),
  ),
);

async function conferir() {
  resultado.value = null;
  if (!props.atendimentoId || props.itens.length === 0) return;
  const agora = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  try {
    resultado.value = await conferirCoberturaPrescricao(
      {
        atendimentoId: props.atendimentoId,
        data: `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`,
        hora: `${pad(agora.getHours())}:${pad(agora.getMinutes())}`,
        itens: props.itens.slice(0, 50).map((i) => ({ ...i })),
      },
      crypto.randomUUID(),
    );
  } catch {
    // O aviso é auxiliar: falha na conferência nunca atrapalha a prescrição.
    resultado.value = null;
  }
}
watch(() => [props.atendimentoId, JSON.stringify(props.itens)], conferir, { immediate: true });
</script>

<template>
  <section
    v-if="achados.length"
    class="aviso-cobertura"
    role="status"
    :aria-label="t('cobertura.aviso.titulo')"
    data-testid="aviso-cobertura"
  >
    <h3>{{ t('cobertura.aviso.titulo') }}</h3>
    <p class="secundario">{{ t('cobertura.aviso.explicacao') }}</p>
    <ul>
      <li v-for="a in achados" :key="a.chave" data-testid="aviso-cobertura-item">
        <strong v-if="a.codigo">{{ a.codigo }}</strong> {{ a.motivo }}
      </li>
    </ul>
  </section>
</template>
