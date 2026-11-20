<script setup lang="ts">
// O próximo prazo regulatório de uma notificação (regra 3): a situação com cor e texto, e o tempo que falta ou que
// passou ("Vence em 2 d 3 h", "Vencido há 5 h"), com o tipo do prazo no título.
import { type PrazoRegulatorio, TIPOS_PRAZO_REGULATORIO } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { classeDoPrazo, dataHora, duracaoCurta } from '../regras-qualidade.js';

const props = defineProps<{ prazo: PrazoRegulatorio | null }>();
const { t } = useI18n();
const texto = computed(() => {
  const p = props.prazo;
  if (!p) return '';
  if (p.situacao === 'cumprido') return t('qualidade.prazos.cumprido');
  if (p.minutosRestantes === null) return t(`qualidade.prazos.situacoes.${p.situacao}`);
  return p.minutosRestantes < 0
    ? t('qualidade.prazos.vencido', { tempo: duracaoCurta(p.minutosRestantes) })
    : t('qualidade.prazos.venceEm', { tempo: duracaoCurta(p.minutosRestantes) });
});
const titulo = computed(() => {
  const p = props.prazo;
  if (!p) return '';
  const tipo = TIPOS_PRAZO_REGULATORIO.find((x) => x.codigo === p.tipo)?.rotulo ?? p.tipo;
  return `${tipo} · ${dataHora(p.venceEm)}`;
});
</script>

<template>
  <span v-if="prazo" :class="classeDoPrazo(prazo.situacao)" :title="titulo" :data-situacao="prazo.situacao">{{
    texto
  }}</span>
  <span v-else class="secundario">-</span>
</template>
