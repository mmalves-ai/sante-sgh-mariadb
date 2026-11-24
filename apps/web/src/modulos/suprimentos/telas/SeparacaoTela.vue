<script setup lang="ts">
// Lista de separação da requisição (F3.6, 05-SUP linha 6): `/suprimentos/requisicoes/:id/separacao`. Na tela e na
// impressão: na ordem do endereço no armazém, só o que falta atender, os lotes de validade mais próxima e a falta
// quando o saldo não cobre. O separador marca o que já pôs na caixa (só na tela, para não perder o fio).
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { listaSeparacao } from '../api-cadastro-estoque.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { qtd } from '../usar-suprimentos.js';

const { t } = useI18n();
const rota = useRoute();
const id = computed(() => Number(rota.params['id']));
const lista = useQuery({
  queryKey: computed(() => ['suprimentos', 'separacao', id.value]),
  queryFn: () => listaSeparacao(id.value),
  enabled: computed(() => id.value > 0),
});
const separado = reactive<Record<number, boolean>>({});
const imprimir = () => globalThis.print?.();
const dataHora = (s: string) => s.replace('T', ' ').slice(0, 16);
</script>

<template>
  <section
    class="tela-agenda separacao"
    aria-labelledby="sep-titulo"
    data-testid="tela-suprimentos-separacao"
  >
    <ErroSuprimentos v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value">{{ t('cadastroEstoque.carregando') }}</p>
    <template v-else>
      <h1 id="sep-titulo">{{ t('cadastroEstoque.separacao.titulo', { n: lista.data.value.numero }) }}</h1>
      <p class="nao-imprime">{{ t('cadastroEstoque.separacao.texto') }}</p>
      <p data-testid="separacao-cabecalho">
        {{ lista.data.value.local.codigo }} · {{ lista.data.value.local.nome }} ·
        {{ t('cadastroEstoque.separacao.destino') }}: {{ lista.data.value.destino }} ·
        {{ dataHora(lista.data.value.solicitadoEm) }}
        <strong v-if="lista.data.value.urgente"> · {{ t('cadastroEstoque.separacao.urgente') }}</strong>
        · {{ t('cadastroEstoque.separacao.geradaEm') }} {{ dataHora(lista.data.value.geradaEm) }}
      </p>
      <p v-if="lista.data.value.totalFalta" role="alert" data-testid="separacao-faltas">
        {{ t('cadastroEstoque.separacao.faltas', { n: lista.data.value.totalFalta }) }}
      </p>
      <p class="nao-imprime">
        <button type="button" class="botao" data-testid="separacao-imprimir" @click="imprimir">
          {{ t('cadastroEstoque.separacao.imprimir') }}
        </button>
      </p>
      <p v-if="lista.data.value.linhas.length === 0">{{ t('cadastroEstoque.separacao.vazia') }}</p>
      <table v-else class="tabela" data-testid="separacao-linhas">
        <caption>
          {{
            t('cadastroEstoque.separacao.abrir')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastroEstoque.separacao.separado') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.endereco') }}</th>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.aSeparar') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.lotes') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.saldo') }}</th>
            <th scope="col">{{ t('cadastroEstoque.separacao.falta') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in lista.data.value.linhas"
            :key="l.sequencia"
            :class="{ feito: separado[l.sequencia] }"
            :data-testid="`separacao-item-${l.item}`"
          >
            <td>
              <input
                :id="`sep-${l.sequencia}`"
                v-model="separado[l.sequencia]"
                type="checkbox"
                :aria-label="`${t('cadastroEstoque.separacao.separado')} ${l.nome}`"
              />
            </td>
            <td>
              <strong>{{ l.endereco ?? t('cadastroEstoque.separacao.semEndereco') }}</strong>
              <small v-if="l.outrosEnderecos.length">{{ ` (${l.outrosEnderecos.join(', ')})` }}</small>
            </td>
            <td>{{ l.item }} · {{ l.nome }}</td>
            <td>{{ qtd(l.aSeparar) }} {{ l.unidade }}</td>
            <td>
              <span v-for="x in l.lotes" :key="x.lote">{{
                `${x.lote} (${x.validade}): ${qtd(x.quantidade)}; `
              }}</span>
            </td>
            <td>{{ qtd(l.saldo) }}</td>
            <td :data-testid="`separacao-falta-${l.item}`">
              <strong v-if="l.falta > 0">{{ qtd(l.falta) }}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.feito td {
  text-decoration: line-through;
  opacity: 0.6;
}
@media print {
  .nao-imprime {
    display: none;
  }
}
</style>
