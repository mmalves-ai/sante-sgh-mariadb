<script setup lang="ts">
// Pessoas (CPF/CNPJ) (M11): consulta pelo documento, com onde a pessoa é usada (profissionais e pacientes com
// o CPF). Sem cadastro.paciente.verDocumento o documento sai mascarado pelo servidor. Só consulta nesta fase.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarPessoas } from '../api-cadastro.js';
import { somenteDigitos } from '../formato.js';

const { t } = useI18n();
const documento = ref('');
const pedido = ref<string | null>(null);
const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'pessoas', pedido.value]),
  queryFn: () => buscarPessoas(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const r = computed(() => consulta.data.value);
function buscar(): void {
  const d = somenteDigitos(documento.value);
  if (d.length >= 3) pedido.value = d;
}
</script>

<template>
  <section class="tela" aria-labelledby="pessoas-titulo" data-testid="tela-pessoas">
    <h1 id="pessoas-titulo">{{ t('cadastro.pessoas.titulo') }}</h1>
    <p>{{ t('cadastro.pessoas.texto') }}</p>
    <form class="barra" role="search" @submit.prevent="buscar">
      <div class="campo">
        <label for="documento-pessoa">{{ t('cadastro.pessoas.documento') }}</label>
        <input
          id="documento-pessoa"
          v-model="documento"
          inputmode="numeric"
          maxlength="18"
          data-testid="documento-pessoa"
        />
      </div>
      <SanteBotao :rotulo="t('cadastro.pessoas.buscar')" variante="primario" tipo="submit" />
    </form>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="r">
      <p v-if="r.itens.length === 0" role="status">{{ t('cadastro.nenhum') }}</p>
      <table v-else data-testid="tabela-pessoas">
        <caption>
          {{
            t('cadastro.pessoas.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastro.pessoas.documento') }}</th>
            <th scope="col">{{ t('cadastro.pessoas.tipo') }}</th>
            <th scope="col">{{ t('cadastro.pessoas.profissionais') }}</th>
            <th scope="col">{{ t('cadastro.pessoas.pacientes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in r.itens" :key="p.id">
            <td>{{ p.documento ?? '' }}</td>
            <td>{{ p.tipo ? t(`cadastro.pessoas.tipos.${p.tipo}`) : '' }}</td>
            <td>{{ p.profissionais }}</td>
            <td>{{ p.pacientes }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
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
  margin: var(--sgh-espaco-2) 0;
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
