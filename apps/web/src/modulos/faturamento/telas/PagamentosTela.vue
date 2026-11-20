<script setup lang="ts">
// Pagamento por Pix e cartão (ficha do M30, seção 7): `/faturamento/particular/pagamentos`. Os pagamentos recebidos, com
// o conector (simulado fora de produção; manual com o comprovante digitado), filtrados no servidor por caixa, período,
// forma e situação, em páginas. O registro e o estorno ficam no caixa (o link leva até ele). O provedor real (PSP e
// adquirente) é decisão nova da diretoria administrativa, antes de ligar produção.
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { listarPagamentos } from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { quando, reais, usarFaturamento } from '../usar-faturamento.js';

const POR_PAGINA = 100;
const FORMAS = ['dinheiro', 'pix', 'cartao-credito', 'cartao-debito', 'transferencia'] as const;
const SITUACOES = ['aprovado', 'pendente', 'recusado', 'estornado'] as const;
const { t, te } = useI18n();
const { motivoFuncionalidade } = usarFaturamento(true);
const campos = ref({ caixa: '', forma: '', situacao: '', desde: '', ate: '' });
const filtro = ref({ ...campos.value });
const pagina = ref(0);
const q = useQuery({
  queryKey: computed(() => ['faturamento', 'pagamentos', filtro.value, pagina.value]),
  queryFn: () => listarPagamentos({ ...filtro.value, pagina: pagina.value }),
});
const opcoesForma = computed(() => [
  { valor: '', rotulo: t('faturamento.todas') },
  ...FORMAS.map((f) => ({ valor: f as string, rotulo: t(`faturamento.caixa.formas.${f}`) })),
]);
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('faturamento.todas') },
  ...SITUACOES.map((s) => ({ valor: s as string, rotulo: t(`faturamento.pagamentos.situacoes.${s}`) })),
]);
const conector = (c: string) =>
  te(`faturamento.pagamentos.conectores.${c}`) ? t(`faturamento.pagamentos.conectores.${c}`) : c;
function buscar() {
  pagina.value = 0;
  filtro.value = { ...campos.value, caixa: campos.value.caixa.trim() };
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pag-titulo" data-testid="tela-faturamento-pagamentos">
    <h1 id="pag-titulo">{{ t('faturamento.pagamentos.titulo') }}</h1>
    <p>{{ t('faturamento.pagamentos.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('pagamentoEletronico')" />
    <p>
      <RouterLink to="/faturamento/particular/caixa" data-testid="pag-caixa">{{
        t('faturamento.pagamentos.registrar')
      }}</RouterLink>
    </p>
    <form class="filtros" data-testid="pag-filtros" @submit.prevent="buscar">
      <span class="campo">
        <label for="pag-caixa">{{ t('faturamento.caixa.titulo') }}</label>
        <input
          id="pag-caixa"
          v-model="campos.caixa"
          inputmode="numeric"
          size="6"
          data-testid="pag-caixa-id"
        />
      </span>
      <span class="campo">
        <label for="pag-desde">{{ t('faturamento.pagamentos.desde') }}</label>
        <input id="pag-desde" v-model="campos.desde" type="date" data-testid="pag-desde" />
      </span>
      <span class="campo">
        <label for="pag-ate">{{ t('faturamento.pagamentos.ate') }}</label>
        <input id="pag-ate" v-model="campos.ate" type="date" data-testid="pag-ate" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="campos.forma"
          :rotulo="t('faturamento.caixa.forma')"
          :opcoes="opcoesForma"
          data-testid="pag-forma"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="campos.situacao"
          :rotulo="t('faturamento.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="pag-situacao"
        />
      </span>
      <button type="submit" data-testid="pag-buscar">{{ t('faturamento.buscar') }}</button>
    </form>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="pag-lista">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{{ t('faturamento.caixa.titulo') }}</th>
            <th scope="col">{{ t('faturamento.caixa.forma') }}</th>
            <th scope="col">{{ t('faturamento.valor') }}</th>
            <th scope="col">{{ t('faturamento.pagamentos.parcelas') }}</th>
            <th scope="col">{{ t('faturamento.situacao') }}</th>
            <th scope="col">{{ t('faturamento.pagamentos.conector') }}</th>
            <th scope="col">{{ t('faturamento.caixa.comprovante') }}</th>
            <th scope="col">{{ t('faturamento.data') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="q.data.value.length === 0">
            <td colspan="9">{{ t('faturamento.nenhum') }}</td>
          </tr>
          <tr v-for="p in q.data.value" :key="p.id">
            <td>{{ p.id }}</td>
            <td>{{ p.caixa }}</td>
            <td>{{ t(`faturamento.caixa.formas.${p.forma}`) }}</td>
            <td>{{ reais(p.valor) }}</td>
            <td>{{ p.parcelas }}</td>
            <td :data-testid="`pag-situacao-${p.id}`">
              {{ t(`faturamento.pagamentos.situacoes.${p.situacao}`) }}
            </td>
            <td>{{ conector(p.conector) }}</td>
            <td>{{ p.comprovante }}</td>
            <td>{{ quando(p.em) }}</td>
          </tr>
        </tbody>
      </table>
      <nav class="filtros" :aria-label="t('faturamento.pagina')">
        <button type="button" :disabled="pagina === 0" data-testid="pag-anterior" @click="pagina -= 1">
          {{ t('faturamento.anterior') }}
        </button>
        <span>{{ t('faturamento.pagina') }} {{ pagina + 1 }}</span>
        <button
          type="button"
          :disabled="q.data.value.length < POR_PAGINA"
          data-testid="pag-proxima"
          @click="pagina += 1"
        >
          {{ t('faturamento.proxima') }}
        </button>
      </nav>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
