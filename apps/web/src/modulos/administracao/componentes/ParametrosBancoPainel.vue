<script setup lang="ts">
// Parâmetros gravados no banco (M10, ficha seção 7): as 40 tabelas de parâmetros por módulo, só consulta, com o
// tipo, a descrição e a origem de cada campo; credencial e dado pessoal ocultos; nas tabelas por usuário, o login
// exato; nas de vigência, a vigente; nas de lista, todas as linhas pela chave.
import { useQuery } from '@tanstack/vue-query';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarIndiceParametros, buscarParametrosBanco } from '../api.js';

const { t } = useI18n();
const indice = useQuery({ queryKey: ['adm', 'parametros-banco'], queryFn: () => buscarIndiceParametros() });
const chave = ref('');
const login = ref('');
const pedido = ref<{ chave: string; login: string } | null>(null);
const escolhida = computed(() => indice.data.value?.tabelas.find((x) => x.chave === chave.value) ?? null);
const tabela = useQuery({
  queryKey: computed(() => ['adm', 'parametros-banco', pedido.value]),
  queryFn: () => buscarParametrosBanco(pedido.value?.chave ?? '', pedido.value?.login || undefined),
  enabled: computed(() => pedido.value !== null),
});
const opcoesTabela = computed(() => [
  { valor: '', rotulo: '—' },
  ...(indice.data.value?.tabelas ?? []).map((x) => ({ valor: x.chave, rotulo: `${x.modulo} · ${x.rotulo}` })),
]);
const ver = () => (pedido.value = chave.value ? { chave: chave.value, login: login.value.trim() } : null);
</script>

<template>
  <section aria-labelledby="parametros-banco-titulo" data-testid="parametros-banco">
    <h2 id="parametros-banco-titulo">{{ t('adm.parametrosBanco.titulo') }}</h2>
    <p>{{ t('adm.parametrosBanco.texto') }}</p>
    <MensagemErro v-if="indice.isError.value" :erro="indice.error.value" />
    <form v-else class="filtros" @submit.prevent="ver">
      <div class="campo">
        <SanteSelecao
          id="pb-tabela"
          v-model="chave"
          :rotulo="t('adm.parametrosBanco.tabela')"
          :opcoes="opcoesTabela"
          data-testid="pb-tabela"
        />
      </div>
      <div v-if="escolhida?.porUsuario" class="campo">
        <label for="pb-login">{{ t('adm.parametrosBanco.login') }}</label>
        <input id="pb-login" v-model="login" maxlength="31" />
      </div>
      <SanteBotao :rotulo="t('adm.comum.consultar')" tipo="submit" data-testid="pb-ver" />
    </form>
    <MensagemErro v-if="tabela.isError.value" :erro="tabela.error.value" />
    <template v-else-if="tabela.data.value">
      <p role="status">{{ t('adm.parametrosBanco.linhas', { n: tabela.data.value.linhas }) }}</p>
      <p v-if="tabela.data.value.criterio" data-testid="pb-criterio">
        {{ t(`adm.parametrosBanco.criterios.${tabela.data.value.criterio}`) }}
      </p>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('adm.comum.rolagem')">
        <table data-testid="pb-parametros">
          <caption>
            {{
              tabela.data.value.rotulo
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('adm.parametrosBanco.descricao') }}</th>
              <th scope="col">{{ t('adm.parametrosBanco.valor') }}</th>
              <th scope="col">{{ t('adm.parametrosBanco.tipo') }}</th>
              <th scope="col">{{ t('adm.parametrosBanco.origem') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in tabela.data.value.parametros" :key="p.origem">
              <th scope="row">
                <template v-if="p.descricao !== 'a confirmar'">{{ p.descricao }}</template>
                <em v-else>{{ t('adm.parametrosBanco.aConfirmar') }}</em>
              </th>
              <td>
                {{ p.situacao === 'valor' ? p.valor : t(`adm.parametrosBanco.situacoes.${p.situacao}`) }}
              </td>
              <td>{{ p.tipo }}</td>
              <td>
                <code>{{ p.origem }}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="tabela.data.value.registros.length"
        class="rolagem"
        tabindex="0"
        role="region"
        :aria-label="t('adm.parametrosBanco.registros', { n: tabela.data.value.registros.length })"
      >
        <table data-testid="pb-registros">
          <caption>
            {{
              t('adm.parametrosBanco.registros', { n: tabela.data.value.registros.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('adm.parametrosBanco.chave') }}</th>
              <th v-for="p in tabela.data.value.parametros" :key="p.origem" scope="col">
                <code>{{ p.campo }}</code>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in tabela.data.value.registros" :key="r.chave">
              <th scope="row">{{ r.chave }}</th>
              <td v-for="(v, i) in r.valores" :key="i">{{ v ?? '—' }}</td>
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
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.rolagem {
  overflow-x: auto;
  max-height: 32rem;
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
input,
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
