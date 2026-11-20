<script setup lang="ts">
// Aba Problemas do plano (M54.1): a conferência do plano feita no servidor (máscara, código repetido, conta de nível
// acima, analítica com filhas, grupo e natureza, vínculo referencial), com o texto de cada regra, a gravidade e as
// contagens (erros e avisos, com o total). O plano pode ficar incompleto enquanto se monta; os erros impedem que a
// regra de contabilização use a conta.
import type { PlanoContabil } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ plano: PlanoContabil }>();
const { t, te } = useI18n();
type Filtro = 'todos' | 'erro' | 'aviso';
const filtro = ref<Filtro>('todos');
const opcoes = computed(() =>
  (['todos', 'erro', 'aviso'] as const).map((v) => ({
    valor: v,
    rotulo: t(`contabil.problemas.filtro.${v}`),
  })),
);
const erros = computed(() => props.plano.problemas.filter((p) => p.gravidade === 'erro').length);
const avisos = computed(() => props.plano.problemas.length - erros.value);
const visiveis = computed(() =>
  props.plano.problemas.filter((p) => filtro.value === 'todos' || p.gravidade === filtro.value),
);
const nomeDa = (codigo: string) => props.plano.contas.find((c) => c.codigo === codigo)?.nome ?? '';
const texto = (regra: string) =>
  te(`contabil.plano.problemas.${regra}`) ? t(`contabil.plano.problemas.${regra}`) : regra;
</script>

<template>
  <section class="bloco" aria-labelledby="aba-problemas-titulo" data-testid="aba-problemas">
    <h2 id="aba-problemas-titulo">{{ t('contabil.abas.problemas') }}</h2>
    <p data-testid="problemas-contagem">
      {{ t('contabil.problemas.contagem', { total: plano.problemas.length, erros, avisos }) }}
    </p>
    <p v-if="plano.problemas.length === 0" data-testid="problemas-nenhum">
      {{ t('contabil.problemas.nenhum') }}
    </p>
    <template v-else>
      <div class="campos">
        <SanteSelecao
          v-model="filtro"
          :rotulo="t('contabil.problemas.mostrar')"
          :opcoes="opcoes"
          busca
          data-testid="problemas-filtro"
        />
      </div>
      <div class="rolagem">
        <table class="tabela" data-testid="tabela-problemas">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.plano.codigo') }}</th>
              <th scope="col">{{ t('contabil.plano.nome') }}</th>
              <th scope="col">{{ t('contabil.problemas.gravidade') }}</th>
              <th scope="col">{{ t('contabil.problemas.problema') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(p, i) in visiveis"
              :key="`${p.codigo}-${p.regra}-${i}`"
              :data-testid="`problema-${p.codigo}-${p.regra}`"
            >
              <td>{{ p.codigo }}</td>
              <td>{{ nomeDa(p.codigo) }}</td>
              <td :class="{ erro: p.gravidade === 'erro' }">
                {{ t(`contabil.problemas.gravidades.${p.gravidade}`) }}
              </td>
              <td>{{ texto(p.regra) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
