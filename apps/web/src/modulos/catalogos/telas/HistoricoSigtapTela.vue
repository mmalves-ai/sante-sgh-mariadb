<script setup lang="ts">
// Histórico de competências SIGTAP de um procedimento (M13, ficha seção 7): os valores e os atributos de cada
// competência carregada (edição passada nunca é sobrescrita: cada competência tem a sua linha).
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarHistoricoSigtap } from '../api-catalogos.js';

const { t } = useI18n();
const codigo = ref('');
const pedido = ref('');
const historico = useQuery({
  queryKey: computed(() => ['catalogos', 'historico-sigtap', pedido.value]),
  queryFn: () => buscarHistoricoSigtap(pedido.value),
  enabled: computed(() => /^\d{10}$/.test(pedido.value)),
});
const valor = (v: number | null) =>
  v === null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const attrs = (a: Record<string, string | number | null>) =>
  Object.entries(a)
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');
</script>

<template>
  <section class="tela" aria-labelledby="historico-titulo">
    <h1 id="historico-titulo">{{ t('catalogos.historico.titulo') }}</h1>
    <p>{{ t('catalogos.historico.texto') }}</p>
    <form
      class="filtros"
      data-testid="form-historico"
      @submit.prevent="pedido = codigo.trim().padStart(10, '0')"
    >
      <div class="campo">
        <label for="hist-proc">{{ t('catalogos.historico.procedimento') }}</label>
        <input
          id="hist-proc"
          v-model="codigo"
          inputmode="numeric"
          maxlength="10"
          required
          data-testid="historico-procedimento"
        />
      </div>
      <SanteBotao
        :rotulo="t('catalogos.historico.consultar')"
        tipo="submit"
        data-testid="historico-consultar"
      />
    </form>
    <MensagemErro v-if="historico.isError.value" :erro="historico.error.value" />
    <template v-else-if="historico.data.value">
      <h2>{{ historico.data.value.procedimento }} — {{ historico.data.value.nome ?? '' }}</h2>
      <p v-if="historico.data.value.competencias.length === 0">{{ t('catalogos.historico.nenhuma') }}</p>
      <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t('catalogos.comum.tabela')">
        <table data-testid="tabela-historico">
          <caption>
            {{
              t('catalogos.historico.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('catalogos.historico.competencia') }}</th>
              <th scope="col">{{ t('catalogos.historico.valorSh') }}</th>
              <th scope="col">{{ t('catalogos.historico.valorSa') }}</th>
              <th scope="col">{{ t('catalogos.historico.valorSp') }}</th>
              <th scope="col">{{ t('catalogos.historico.atributos') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in historico.data.value.competencias"
              :key="c.competencia"
              :data-testid="`competencia-${c.competencia}`"
            >
              <td>{{ c.competencia }}</td>
              <td>{{ valor(c.valorSh) }}</td>
              <td>{{ valor(c.valorSa) }}</td>
              <td>{{ valor(c.valorSp) }}</td>
              <td>{{ attrs(c.atributos) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
