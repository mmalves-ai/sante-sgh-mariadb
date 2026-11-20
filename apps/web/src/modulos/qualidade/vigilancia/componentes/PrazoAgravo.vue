<script setup lang="ts">
// O prazo da notificação do agravo (regra 3: imediato em 24 h, semanal em 7 dias): a situação com cor e texto ("Vence
// em 3 h", "Vencido há 2 d"), com a data do prazo no título. As horas vêm do caso ou são contadas pelo relógio do
// servidor (as sugestões da fila).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { classeDoPrazoAgravo, type EstadoPrazo, horasAte, tempoDoPrazo } from '../regras-agravo.js';

const props = defineProps<{
  estado: EstadoPrazo;
  prazoEm: string;
  horas?: number | null;
  agora?: string | null;
}>();
const { t } = useI18n();
const texto = computed(() => {
  if (props.estado === 'cumprido') return t('agravos.prazo.cumprido');
  if (props.estado === 'naoSeAplica') return t('agravos.prazo.naoSeAplica');
  const h = props.horas ?? (props.agora ? horasAte(props.prazoEm, props.agora) : null);
  const x = tempoDoPrazo(h);
  return x ? t(`agravos.prazo.${x.chave}`, { tempo: x.tempo }) : dataHora(props.prazoEm);
});
</script>

<template>
  <span
    :class="classeDoPrazoAgravo(estado)"
    :title="t('agravos.prazo.titulo', { data: dataHora(prazoEm) })"
    :data-estado="estado"
    >{{ texto }}</span
  >
</template>
