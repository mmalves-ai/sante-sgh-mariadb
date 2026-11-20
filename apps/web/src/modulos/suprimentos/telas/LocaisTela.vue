<script setup lang="ts">
// Locais de armazenagem e estoque mínimo/máximo (ficha do M28, seção 7): `/suprimentos/locais`. Escolhe o local e
// mostra a grade item × saldo × mínimo × máximo (GELIMLOC), com o item abaixo do mínimo em destaque. A edição dos
// limites é P2 (cadastro pela receita genérica) e segue desligada (POL-3): a tela mostra o motivo.
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { listarSaldos } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { qtd, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const { locais } = usarSuprimentos();
const local = ref('');
const opcoes = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...locais.value.map((l) => ({ valor: String(l.codigo), rotulo: `${l.codigo} · ${l.nome}` })),
]);
const grade = useQuery({
  queryKey: computed(() => ['suprimentos', 'locais', local.value]),
  queryFn: () => listarSaldos({ local: Number(local.value), todos: true }),
  enabled: computed(() => Number(local.value) > 0),
});
const abaixo = (q: number, min: number | null) => min !== null && q < min;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="locais-titulo" data-testid="tela-suprimentos-locais">
    <h1 id="locais-titulo">{{ t('suprimentos.locais.titulo') }}</h1>
    <p>{{ t('suprimentos.locais.texto') }}</p>
    <AvisoSuprimentos :motivo="t('suprimentos.locais.edicaoDesligada')" />
    <table class="tabela" data-testid="locais-lista">
      <caption>
        {{
          t('suprimentos.locais.lista')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('suprimentos.codigo') }}</th>
          <th scope="col">{{ t('suprimentos.nome') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in locais" :key="l.codigo">
          <td>{{ l.codigo }}</td>
          <td>{{ l.nome }}</td>
        </tr>
      </tbody>
    </table>
    <SanteSelecao
      v-model="local"
      :rotulo="t('suprimentos.locais.limitesDo')"
      :opcoes="opcoes"
      data-testid="locais-local"
    />
    <ErroSuprimentos v-if="grade.error.value" :erro="grade.error.value" />
    <table v-if="grade.data.value" class="tabela" data-testid="locais-limites">
      <caption>
        {{
          t('suprimentos.locais.limites')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('suprimentos.item') }}</th>
          <th scope="col">{{ t('suprimentos.saldo') }}</th>
          <th scope="col">{{ t('suprimentos.minimo') }}</th>
          <th scope="col">{{ t('suprimentos.maximo') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in grade.data.value.itens" :key="s.item">
          <td>{{ s.item }} · {{ s.nome }}</td>
          <td>
            {{ qtd(s.quantidade) }} {{ s.unidade }}
            <strong v-if="abaixo(s.quantidade, s.minimo)"> · {{ t('suprimentos.locais.abaixo') }}</strong>
          </td>
          <td>{{ s.minimo === null ? '—' : qtd(s.minimo) }}</td>
          <td>{{ s.maximo === null ? '—' : qtd(s.maximo) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="grade.data.value?.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
