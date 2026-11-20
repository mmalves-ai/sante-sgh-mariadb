<script setup lang="ts">
// Dados do paciente para o cálculo de dose e os alertas (M24, regra 12): o peso e a altura do cadastro, a última
// creatinina liberada e o clearance estimado, cada um com a data do dado. Sem o dado, o aviso diz o que falta.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{
  dados: {
    pesoKg: number | null;
    alturaCm: number | null;
    dataPeso: string | null;
    idadeAnos: number | null;
    creatinina: number | null;
    dataCreatinina: string | null;
    clearance: number | null;
  };
}>();
const { t } = useI18n();
const n = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const partes = computed(() => {
  const d = props.dados;
  const r: string[] = [];
  r.push(
    d.pesoKg !== null
      ? t('pep.presc.dados.peso', { peso: n(d.pesoKg), data: dataHoraBr(d.dataPeso) || '—' })
      : t('pep.presc.dados.semPeso'),
  );
  if (d.alturaCm !== null) r.push(t('pep.presc.dados.altura', { altura: d.alturaCm }));
  r.push(
    d.creatinina !== null
      ? t('pep.presc.dados.creatinina', { valor: n(d.creatinina), data: dataHoraBr(d.dataCreatinina) || '—' })
      : t('pep.presc.dados.semCreatinina'),
  );
  if (d.clearance !== null) r.push(t('pep.presc.dados.clearance', { valor: n(d.clearance) }));
  return r;
});
</script>

<template>
  <p class="dados-clinicos" data-testid="dados-clinicos">
    <strong>{{ t('pep.presc.dados.titulo') }}</strong> {{ partes.join(' · ') }}
  </p>
</template>

<style scoped>
.dados-clinicos {
  margin: 0;
}
</style>
