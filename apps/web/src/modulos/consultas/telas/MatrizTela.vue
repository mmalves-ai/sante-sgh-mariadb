<script setup lang="ts">
// Painel da matriz de cobertura (M14; ficha, seção 7): resumo, contagem por área e atendimento, a lista das
// tabelas com filtro (tabela, área ou marco), as descartadas com a justificativa e a vigia das tabelas vazias.
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarPainelMatriz } from '../api-matriz.js';

const { t } = useI18n();
const painel = useQuery({ queryKey: ['matriz', 'painel'], queryFn: () => buscarPainelMatriz() });
const filtro = ref('');
const atendimento = ref('');
const ATENDIMENTOS = ['tela', 'consulta', 'importador', 'descartada', 'pendente'] as const;
const opcoesAtendimento = computed(() => [
  { valor: '', rotulo: t('consultas.catalogo.todas') },
  ...ATENDIMENTOS.map((a) => ({ valor: a as string, rotulo: t(`consultas.matriz.estados.${a}`) })),
]);
const tabelas = computed(() => {
  const f = filtro.value.trim().toUpperCase();
  return (painel.data.value?.tabelas ?? []).filter(
    (x) =>
      (!f || x.tabela.includes(f) || x.codigo === f || x.marco === f) &&
      (!atendimento.value || x.atendimento === atendimento.value),
  );
});
const visiveis = computed(() => tabelas.value.slice(0, 200));
const descartadas = computed(() =>
  (painel.data.value?.tabelas ?? []).filter((x) => x.atendimento === 'descartada'),
);
</script>

<template>
  <section class="tela" aria-labelledby="matriz-titulo">
    <h1 id="matriz-titulo">{{ t('consultas.matriz.titulo') }}</h1>
    <p>{{ t('consultas.matriz.texto') }}</p>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="painel.isPending.value">{{ t('consultas.consulta.carregando') }}</p>
    <template v-else-if="painel.data.value">
      <h2>{{ t('consultas.matriz.resumo') }}</h2>
      <ul data-testid="matriz-resumo">
        <li>{{ t('consultas.matriz.total', { n: painel.data.value.resumo.total }) }}</li>
        <li>{{ t('consultas.matriz.atendidas', { n: painel.data.value.resumo.atendidas }) }}</li>
        <li>{{ t('consultas.matriz.descartadas', { n: painel.data.value.resumo.descartadas }) }}</li>
        <li>{{ t('consultas.matriz.pendentes', { n: painel.data.value.resumo.pendentes }) }}</li>
      </ul>
      <h2>{{ t('consultas.matriz.porCodigo') }}</h2>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('consultas.matriz.porCodigo')">
        <table data-testid="matriz-por-codigo">
          <caption>
            {{
              t('consultas.matriz.porCodigo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('consultas.matriz.codigo') }}</th>
              <th v-for="a in ATENDIMENTOS" :key="a" scope="col">{{ t(`consultas.matriz.estados.${a}`) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in painel.data.value.porCodigo" :key="c.codigo">
              <th scope="row">{{ c.codigo }}</th>
              <td v-for="a in ATENDIMENTOS" :key="a">{{ c.porAtendimento[a] ?? 0 }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>{{ t('consultas.matriz.vazias') }}</h2>
      <p v-if="!painel.data.value.vazias" data-testid="matriz-vazias">
        {{ t('consultas.matriz.vaziasSemVerificacao') }}
      </p>
      <template v-else>
        <p data-testid="matriz-vazias">
          {{
            t('consultas.matriz.vaziasResumo', {
              vazias: painel.data.value.vazias.vazias,
              comDados: painel.data.value.vazias.comDados.length,
              registradas: painel.data.value.vazias.registradas,
            })
          }}
        </p>
        <template v-if="painel.data.value.vazias.comDados.length">
          <h3>{{ t('consultas.matriz.comDados') }}</h3>
          <ul>
            <li v-for="v in painel.data.value.vazias.comDados" :key="v.tabela">
              {{ v.tabela }} {{ v.desde ?? '' }}
            </li>
          </ul>
        </template>
      </template>
      <h2>{{ t('consultas.matriz.tabela') }}</h2>
      <div class="filtros">
        <div class="campo">
          <label for="matriz-filtro">{{ t('consultas.matriz.filtrar') }}</label>
          <input id="matriz-filtro" v-model="filtro" maxlength="31" data-testid="matriz-filtro" />
        </div>
        <div class="campo">
          <SanteSelecao
            id="matriz-atendimento"
            v-model="atendimento"
            :rotulo="t('consultas.matriz.estado')"
            :opcoes="opcoesAtendimento"
            data-testid="matriz-atendimento"
          />
        </div>
      </div>
      <p>{{ t('consultas.consulta.contagem', { n: tabelas.length }) }}</p>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('consultas.matriz.tabela')">
        <table data-testid="matriz-tabelas">
          <caption>
            {{
              t('consultas.matriz.tabela')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('consultas.matriz.tabela') }}</th>
              <th scope="col">{{ t('consultas.matriz.codigo') }}</th>
              <th scope="col">{{ t('consultas.matriz.destino') }}</th>
              <th scope="col">{{ t('consultas.matriz.marco') }}</th>
              <th scope="col">{{ t('consultas.matriz.estado') }}</th>
              <th scope="col">{{ t('consultas.matriz.linhas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in visiveis" :key="x.tabela">
              <td>{{ x.tabela }}</td>
              <td>{{ x.codigo }}</td>
              <td>{{ x.destino }}</td>
              <td>{{ x.marco }}</td>
              <td>{{ t(`consultas.matriz.estados.${x.atendimento}`) }}</td>
              <td>{{ x.linhas.toLocaleString('pt-BR') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>{{ t('consultas.matriz.listaDescartadas') }}</h2>
      <dl class="descartadas" data-testid="matriz-descartadas">
        <template v-for="x in descartadas" :key="x.tabela">
          <dt>{{ x.tabela }}</dt>
          <dd>{{ x.justificativa ?? '' }}</dd>
        </template>
      </dl>
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
.descartadas {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.descartadas dt {
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
