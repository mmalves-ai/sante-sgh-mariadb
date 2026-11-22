<script setup lang="ts">
// "Convênios/operadoras, planos e classes" (M12, ficha seção 7): a lista dos convênios do banco do
// estabelecimento com a busca por palavra (no servidor: sem acento, prefixo nos dois sentidos, palavras
// coladas) e o filtro de situação; abrir leva ao contrato em abas (com a aba pedida pelo menu, ?aba=).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import NovoConvenioForm from '../componentes/NovoConvenioForm.vue';
import { listarConvenios } from '../api-precos.js';

const { t } = useI18n();
// ADR 0009, decisão 26: criar convênio, com "credenciar todos os profissionais ativos" na criação.
const podeCriar = computed(() => pode('convenio.contrato.editar'));
const criando = ref(false);
const criado = ref<string | null>(null);
const rota = useRoute();
const busca = ref('');
const situacao = ref('todos');
const opcoesSituacao = computed(() => [
  { valor: 'todos', rotulo: t('precos.comum.todos') },
  { valor: 'ativos', rotulo: t('precos.convenios.ativos') },
  { valor: 'suspensos', rotulo: t('precos.convenios.suspensos') },
]);
const termo = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (b) => {
  clearTimeout(espera);
  espera = setTimeout(() => (termo.value = b), 300);
});
const consulta = useQuery({
  queryKey: computed(() => ['convenios', termo.value, situacao.value]),
  queryFn: () => listarConvenios(termo.value, situacao.value),
});
const aba = computed(() => (typeof rota.query['aba'] === 'string' ? rota.query['aba'] : ''));
const rotuloSituacao = (s: string | null) =>
  s === 'A'
    ? t('precos.convenios.ativo')
    : s === 'I'
      ? t('precos.convenios.suspenso')
      : t('precos.convenios.desconhecida');
const tabelas = (x: {
  honorariosInternacao: number | null;
  honorariosExterna: number | null;
  diarias: number | null;
  matmed: number | null;
}) => [x.honorariosInternacao, x.honorariosExterna, x.diarias, x.matmed].map((v) => v ?? '–').join(' / ');
</script>

<template>
  <section class="tela" aria-labelledby="convenios-titulo">
    <h1 id="convenios-titulo">{{ t('precos.convenios.titulo') }}</h1>
    <p>{{ t('precos.convenios.texto') }}</p>
    <form class="filtros" role="search" @submit.prevent="termo = busca">
      <div class="campo">
        <label for="convenios-busca">{{ t('precos.comum.buscar') }}</label>
        <input id="convenios-busca" v-model="busca" data-testid="convenios-busca" type="search" />
      </div>
      <div class="campo">
        <SanteSelecao
          id="convenios-situacao"
          v-model="situacao"
          :rotulo="t('precos.convenios.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="convenios-situacao"
        />
      </div>
    </form>
    <SanteBotao
      v-if="podeCriar && !criando"
      variante="secundario"
      :rotulo="t('estruturada.novoConvenio.titulo')"
      data-testid="novo-convenio"
      @acionar="((criando = true), (criado = null))"
    />
    <NovoConvenioForm
      v-if="criando"
      @criado="(m) => ((criado = m), (criando = false))"
      @cancelar="criando = false"
    />
    <p v-if="criado" role="status" data-testid="novo-convenio-mensagem">{{ criado }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('precos.comum.carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <p role="status">
        {{ t('precos.convenios.total', { n: consulta.data.value.total }) }}
        <span v-if="consulta.data.value.destino === 'memoria'">{{ t('precos.comum.memoria') }}</span>
      </p>
      <div class="rolagem">
        <table data-testid="tabela-convenios">
          <caption>
            {{
              t('precos.convenios.rotuloLista')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('precos.comum.codigo') }}</th>
              <th scope="col">{{ t('precos.comum.nome') }}</th>
              <th scope="col">{{ t('precos.comum.situacao') }}</th>
              <th scope="col">{{ t('precos.convenios.classificacao') }}</th>
              <th scope="col">{{ t('precos.convenios.tabelas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in consulta.data.value.itens" :key="c.codigo">
              <td>{{ c.codigo }}</td>
              <th scope="row">
                <router-link
                  :to="{ path: `/cadastros/convenios/${c.codigo}`, query: aba ? { aba } : {} }"
                  :data-testid="`abrir-convenio-${c.codigo}`"
                  >{{ c.nome }}</router-link
                >
              </th>
              <td :class="{ suspenso: c.situacao !== 'A' }">{{ rotuloSituacao(c.situacao) }}</td>
              <td>{{ c.classificacao ?? '' }}</td>
              <td>{{ tabelas(c.tabelas) }}</td>
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
.suspenso {
  font-weight: 600;
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
