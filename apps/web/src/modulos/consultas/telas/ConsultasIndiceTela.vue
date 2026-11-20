<script setup lang="ts">
// Índice das consultas somente leitura (M14): só as que a pessoa lê (o servidor filtra pelas mesmas regras
// CASL), agrupadas pela área, com a busca pelo nome e os marcadores (grande, dado de pessoa, clínica).
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarIndiceConsultas } from '../api-consultas.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['consultas', 'indice'], queryFn: () => buscarIndiceConsultas() });
const busca = ref('');
const sem = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const grupos = computed(() => {
  const termo = sem(busca.value.trim());
  const r = new Map<string, NonNullable<typeof consulta.data.value>['consultas']>();
  for (const c of consulta.data.value?.consultas ?? []) {
    if (termo && !sem(c.rotulo).includes(termo)) continue;
    r.set(c.modulo, [...(r.get(c.modulo) ?? []), c]);
  }
  return [...r].sort(([a], [b]) => a.localeCompare(b));
});
</script>

<template>
  <section class="tela" aria-labelledby="consultas-titulo">
    <h1 id="consultas-titulo">{{ t('consultas.indice.titulo') }}</h1>
    <p>{{ t('consultas.indice.texto') }}</p>
    <div class="campo">
      <label for="consultas-busca">{{ t('consultas.indice.buscar') }}</label>
      <input
        id="consultas-busca"
        v-model="busca"
        type="search"
        maxlength="60"
        data-testid="busca-consultas"
      />
    </div>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('consultas.consulta.carregando') }}</p>
    <p v-else-if="grupos.length === 0">{{ t('consultas.indice.nenhuma') }}</p>
    <section v-for="[modulo, lista] in grupos" :key="modulo" :aria-labelledby="`consultas-${modulo}`">
      <h2 :id="`consultas-${modulo}`">{{ t('consultas.indice.modulos', { modulo }) }}</h2>
      <ul class="lista">
        <li v-for="c in lista" :key="`${c.modulo}.${c.recurso}`">
          <RouterLink :to="c.rota" :data-testid="`consulta-${c.modulo}.${c.recurso}`">{{
            c.rotulo
          }}</RouterLink>
          <span v-if="c.grande" class="marca">{{ t('consultas.indice.grande') }}</span>
          <span v-if="c.classe === 'pessoal'" class="marca">{{ t('consultas.indice.pessoal') }}</span>
          <span v-if="c.classe === 'clinica'" class="marca">{{ t('consultas.indice.clinica') }}</span>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 28rem;
  margin: var(--sgh-espaco-2) 0;
}
.lista {
  display: grid;
  gap: var(--sgh-espaco-1);
  padding-left: var(--sgh-espaco-3);
}
.lista a {
  display: inline-block;
  min-height: 24px;
  padding: 2px 0;
}
.marca {
  margin-left: var(--sgh-espaco-2);
  color: var(--sgh-texto-secundario);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
