<script setup lang="ts">
// Aba "Vigilância diária em produção" da tela de testes de assinatura (ficha do M38, campo 1 e campo 11): por
// estabelecimento e período, o resultado diário da vigilância de gravação (SGH_CFG_COEX_VIGIA): quantas gravações do
// Sante SGH foram amostradas, quantas divergiram da referência vigente e onde (tabela, coluna e o tipo da diferença).
// Só estrutura: nenhum conteúdo de registro. Só leitura (config.assinatura.ler).
import { SanteAlerta, SanteBotao, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { mensagemDoErro } from '../../../casca/erros/problem-details.js';
import AbasAssinaturas from '../../config/componentes/AbasAssinaturas.vue';
import { buscarVigia, type FiltroVigia, resumoVigia } from '../api-onda0.js';

const { t } = useI18n();
const hospital = ref('');
const de = ref<string | null>(null);
const ate = ref<string | null>(null);
const filtro = ref<FiltroVigia>({});
const painel = useQuery({
  queryKey: computed(() => ['onda0', 'vigia', filtro.value]),
  queryFn: () => buscarVigia(filtro.value),
  staleTime: 30_000,
});
const dados = computed(() => painel.data.value);
const opcoesHospital = computed(() => [
  { valor: '', rotulo: t('config.assinaturas.vigia.daSessao') },
  ...(dados.value?.estabelecimentos ?? []).map((e) => ({ valor: e, rotulo: e })),
]);
const resumo = computed(() => resumoVigia(dados.value));
const alertas = computed(() =>
  (dados.value?.execucoes ?? []).filter((e) => e.resultado.divergentes > 0).map((e) => e.resultado),
);
const erro = computed(() => (painel.isError.value ? t(mensagemDoErro(painel.error.value).texto) : null));

function aplicar(): void {
  filtro.value = {
    ...(hospital.value ? { hospital: hospital.value } : {}),
    ...(de.value ? { de: de.value } : {}),
    ...(ate.value ? { ate: ate.value } : {}),
  };
}

function rotuloElemento(x: { tabela: string; coluna: string | null; tipo: string }): string {
  return x.coluna
    ? t('config.assinaturas.vigia.elemento', { tabela: x.tabela, coluna: x.coluna, tipo: x.tipo })
    : t('config.assinaturas.vigia.elementoTabela', { tabela: x.tabela, tipo: x.tipo });
}
</script>

<template>
  <section class="tela" aria-labelledby="vigia-titulo" data-testid="tela-vigia">
    <h1 id="vigia-titulo">{{ t('config.assinaturas.titulo') }}</h1>
    <AbasAssinaturas atual="vigia" />
    <h2>{{ t('config.assinaturas.vigia.titulo') }}</h2>
    <p>{{ t('config.assinaturas.vigia.texto') }}</p>
    <form class="filtros" data-testid="filtros-vigia" @submit.prevent="aplicar">
      <SanteSelecao
        v-model="hospital"
        :rotulo="t('config.assinaturas.estabelecimento')"
        :opcoes="opcoesHospital"
        data-testid="vigia-hospital"
      />
      <SanteData v-model="de" :rotulo="t('config.assinaturas.vigia.de')" editavel data-testid="vigia-de" />
      <SanteData v-model="ate" :rotulo="t('config.assinaturas.vigia.ate')" editavel data-testid="vigia-ate" />
      <SanteBotao
        :rotulo="t('config.assinaturas.vigia.aplicar')"
        variante="primario"
        tipo="submit"
        data-testid="vigia-aplicar"
      />
    </form>
    <SanteAlerta
      v-if="erro"
      :texto="t('config.assinaturas.vigia.erro', { erro })"
      variante="alerta"
      data-testid="vigia-erro"
    />
    <template v-if="dados">
      <p data-testid="vigia-resumo">
        {{ t('config.assinaturas.vigia.resumo', resumo) }}
      </p>
      <SanteAlerta
        v-for="a in alertas"
        :key="`${a.data}-${a.operacao}`"
        :texto="t('config.assinaturas.vigia.alerta', { hospital: a.hospital, dia: a.data })"
        variante="alerta"
        data-testid="vigia-alerta"
      />
      <p v-if="dados.execucoes.length === 0" data-testid="vigia-nenhuma">
        {{ t('config.assinaturas.vigia.nenhuma') }}
      </p>
      <table v-else data-testid="tabela-vigia">
        <caption>
          {{
            t('config.assinaturas.vigia.legenda', { hospital: dados.hospital, de: dados.de, ate: dados.ate })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('config.assinaturas.vigia.dia') }}</th>
            <th scope="col">{{ t('config.assinaturas.vigia.operacao') }}</th>
            <th scope="col">{{ t('config.assinaturas.vigia.amostradas') }}</th>
            <th scope="col">{{ t('config.assinaturas.vigia.divergentes') }}</th>
            <th scope="col">{{ t('config.assinaturas.vigia.elementos') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in dados.execucoes"
            :key="`${e.resultado.data}-${e.resultado.operacao}`"
            :data-testid="`vigia-${e.resultado.data}`"
          >
            <td>{{ e.resultado.data }}</td>
            <td>{{ e.resultado.operacao }}</td>
            <td>{{ e.resultado.amostradas }}</td>
            <td :class="{ divergente: e.resultado.divergentes > 0 }">{{ e.resultado.divergentes }}</td>
            <td>
              <template v-if="e.resultado.elementos.length === 0">{{
                t('config.assinaturas.vigia.semDivergencia')
              }}</template>
              <ul v-else>
                <li v-for="(x, i) in e.resultado.elementos" :key="i">
                  {{ rotuloElemento(x) }} ({{ x.ocorrencias }})
                </li>
              </ul>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-end;
  margin-block: var(--sgh-espaco-3);
}
table {
  border-collapse: collapse;
  inline-size: 100%;
}
th,
td {
  padding: var(--sgh-espaco-2);
  border-block-end: 1px solid var(--sgh-borda);
  text-align: start;
  vertical-align: top;
}
.divergente {
  font-weight: 700;
}
ul {
  margin: 0;
  padding-inline-start: var(--sgh-espaco-4);
}
</style>
