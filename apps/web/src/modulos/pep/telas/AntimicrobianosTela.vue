<script setup lang="ts">
// Fichas de antimicrobiano (M24; ficha, seção 7): as justificativas registradas na prescrição (indicação, sítio,
// empírico, dirigido ou profilático, cultura e dia de tratamento) e, por paciente, as fichas anteriores em consulta.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { listarFichas } from '../api-prescricao.js';
import { dataHoraBr } from '../formato.js';

const { t } = useI18n();
const texto = ref('');
const paciente = ref<number | null>(null);
const fichas = useQuery({
  queryKey: computed(() => ['presc', 'fichas', paciente.value]),
  queryFn: () => listarFichas(paciente.value),
  staleTime: 0,
});
function filtrar(): void {
  const n = Number(texto.value.trim());
  paciente.value = Number.isInteger(n) && n > 0 ? n : null;
}
</script>

<template>
  <section class="tela" aria-labelledby="atm-titulo" data-testid="tela-antimicrobianos">
    <h1 id="atm-titulo">{{ t('pep.presc.antimicrobianos.titulo') }}</h1>
    <p>{{ t('pep.presc.antimicrobianos.texto') }}</p>
    <form class="barra" @submit.prevent="filtrar">
      <div class="campo">
        <label for="atm-paciente">{{ t('pep.presc.antimicrobianos.paciente') }}</label>
        <input
          id="atm-paciente"
          v-model="texto"
          inputmode="numeric"
          maxlength="12"
          data-testid="atm-paciente"
        />
      </div>
      <SanteBotao :rotulo="t('pep.presc.antimicrobianos.filtrar')" tipo="submit" variante="secundario" />
    </form>
    <MensagemErro v-if="fichas.isError.value" :erro="fichas.error.value" />
    <p v-else-if="!fichas.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
    <p v-else-if="fichas.data.value.length === 0" role="status">{{ t('pep.presc.antimicrobianos.vazio') }}</p>
    <table v-else data-testid="lista-fichas">
      <caption>
        {{
          t('pep.presc.antimicrobianos.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('pep.presc.antimicrobianos.colunas.produto') }}</th>
          <th scope="col">{{ t('pep.presc.antimicrobianos.colunas.indicacao') }}</th>
          <th scope="col">{{ t('pep.presc.antimicrobianos.colunas.sitio') }}</th>
          <th scope="col">{{ t('pep.presc.antimicrobianos.colunas.tipo') }}</th>
          <th scope="col">{{ t('pep.presc.antimicrobianos.colunas.cultura') }}</th>
          <th scope="col">{{ t('pep.presc.antimicrobianos.colunas.dia') }}</th>
          <th scope="col">{{ t('pep.presc.antimicrobianos.colunas.em') }}</th>
          <th scope="col">{{ t('pep.presc.antimicrobianos.colunas.origem') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="f in fichas.data.value" :key="`${f.origem}-${f.id}`">
          <td>{{ f.produto }}</td>
          <td>{{ f.indicacao }}</td>
          <td>{{ f.sitio }}</td>
          <td>{{ f.tipo }}</td>
          <td>{{ f.culturaColhida ? t('pep.presc.farmacia.sim') : t('pep.presc.farmacia.nao') }}</td>
          <td>{{ f.diaTratamento }}</td>
          <td>{{ dataHoraBr(f.registradaEm) }}</td>
          <td>{{ t(`pep.presc.antimicrobianos.origens.${f.origem}`) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.tela {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
</style>
