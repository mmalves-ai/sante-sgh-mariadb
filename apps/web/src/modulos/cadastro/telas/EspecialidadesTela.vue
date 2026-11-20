<script setup lang="ts">
// Especialidades, CBOs e procedimentos por especialidade (M11): o CRUD genérico do M08 para as especialidades
// e para a ligação CBO × especialidade (alteração pelo executor; inclusão segue no sistema atual, o motivo
// aparece na tela) e, em consulta paginada no servidor, os procedimentos de uma especialidade.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import DominioTela from '../../config/telas/DominioTela.vue';
import { lerProcedimentos } from '../api-cadastro.js';
import PaginacaoCadastro from '../componentes/PaginacaoCadastro.vue';

const { t } = useI18n();
const codigo = ref('');
const escolhida = ref<number | null>(null);
const pagina = ref(1);
watch(escolhida, () => (pagina.value = 1));
const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'procedimentos', escolhida.value, pagina.value]),
  queryFn: () => lerProcedimentos(escolhida.value!, pagina.value),
  enabled: computed(() => escolhida.value !== null),
});
const r = computed(() => consulta.data.value);
function ver(): void {
  const n = Number(codigo.value);
  if (Number.isInteger(n) && n > 0) escolhida.value = n;
}
</script>

<template>
  <div data-testid="tela-especialidades">
    <DominioTela modulo="cadastro" recurso="especialidade" />
    <DominioTela modulo="cadastro" recurso="cboEspecialidade" secundaria />
    <section class="tela" aria-labelledby="procedimentos-titulo">
      <h2 id="procedimentos-titulo">{{ t('cadastro.especialidades.procedimentos') }}</h2>
      <form class="barra" @submit.prevent="ver">
        <div class="campo">
          <label for="codigo-especialidade">{{ t('cadastro.especialidades.especialidade') }}</label>
          <input
            id="codigo-especialidade"
            v-model="codigo"
            inputmode="numeric"
            maxlength="6"
            data-testid="codigo-especialidade"
          />
        </div>
        <SanteBotao :rotulo="t('cadastro.especialidades.ver')" variante="secundario" tipo="submit" />
      </form>
      <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
      <template v-else-if="r">
        <p v-if="r.itens.length === 0">{{ t('cadastro.nenhum') }}</p>
        <table v-else data-testid="tabela-procedimentos">
          <caption>
            {{
              t('cadastro.especialidades.legenda', { codigo: r.especialidade, total: r.total })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('cadastro.especialidades.codigo') }}</th>
              <th scope="col">{{ t('cadastro.especialidades.descricao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in r.itens" :key="p.procedimento">
              <td>{{ p.procedimento }}</td>
              <td>{{ p.descricao ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <PaginacaoCadastro
          v-model="pagina"
          :total="r.total"
          :por-pagina="r.porPagina"
          :rotulo="t('cadastro.especialidades.procedimentos')"
        />
      </template>
    </section>
  </div>
</template>

<style scoped>
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
}
</style>
