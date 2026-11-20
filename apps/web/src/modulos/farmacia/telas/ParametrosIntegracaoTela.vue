<script setup lang="ts">
// Parâmetros da integração prescrição × estoque (ficha do M29, seção 7): `/farmacia/parametros`. Consulta: o parâmetro
// por centro de custo e tipo de prescrição, os horários de medicação e a validação farmacêutica obrigatória; mudar é
// decisão da área (muda também o outro sistema).
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { lerParametros } from '../api-farmacia.js';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';

const { t } = useI18n();
const p = useQuery({ queryKey: ['farmacia', 'parametros'], queryFn: () => lerParametros() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="par-titulo" data-testid="tela-farmacia-parametros">
    <h1 id="par-titulo">{{ t('farmacia.parametros.titulo') }}</h1>
    <p>{{ t('farmacia.parametros.texto') }}</p>
    <ErroFarmacia v-if="p.error.value" :erro="p.error.value" />
    <template v-if="p.data.value">
      <p>
        {{
          t('farmacia.parametros.validacao', { v: p.data.value.validacaoFarmaceuticaLigada ? 'sim' : 'não' })
        }}
      </p>
      <table class="tabela">
        <caption>
          {{
            t('farmacia.parametros.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('farmacia.parametros.centro') }}</th>
            <th scope="col">{{ t('farmacia.parametros.tipoPrescricao') }}</th>
            <th scope="col">{{ t('farmacia.parametros.tipoIntegracao') }}</th>
            <th scope="col">{{ t('farmacia.parametros.momento') }}</th>
            <th scope="col">{{ t('farmacia.parametros.envio') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in p.data.value.centros" :key="`${c.centroCusto}-${c.tipoPrescricao}`">
            <td>{{ c.centroCusto }} · {{ c.nome }}</td>
            <td>{{ c.tipoPrescricao }}</td>
            <td>{{ c.tipoIntegracao }}</td>
            <td>{{ c.momento }}</td>
            <td>{{ c.tipoEnvioAvaliacaoNome }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela">
        <caption>
          {{
            t('farmacia.parametros.horarios')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('farmacia.parametros.codigo') }}</th>
            <th scope="col">{{ t('farmacia.parametros.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in p.data.value.horarios" :key="h.codigo">
            <td>{{ h.codigo }}</td>
            <td>{{ h.valor }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
