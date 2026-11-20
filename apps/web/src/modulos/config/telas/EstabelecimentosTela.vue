<script setup lang="ts">
import type { EstabelecimentosApi } from '@sgh/contratos';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarEstabelecimentos, rotuloEstado } from '../api.js';

const { t } = useI18n();
const dados = ref<EstabelecimentosApi | null>(null);
const erro = ref<string | null>(null);

onMounted(async () => {
  try {
    dados.value = await buscarEstabelecimentos();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <section aria-labelledby="titulo-estab">
    <h1 id="titulo-estab">{{ t('config.estabelecimentos.titulo') }}</h1>
    <p>{{ t('config.estabelecimentos.texto') }}</p>
    <p v-if="erro" role="alert">{{ t('config.estabelecimentos.erro', { erro }) }}</p>
    <table v-if="dados">
      <caption>
        {{
          t('config.estabelecimentos.legenda', { rede: dados.rede })
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('config.estabelecimentos.codigo') }}</th>
          <th scope="col">{{ t('config.estabelecimentos.nomeConfigurado') }}</th>
          <th scope="col">{{ t('config.estabelecimentos.nomeNoBanco') }}</th>
          <th scope="col">{{ t('config.estabelecimentos.cnes') }}</th>
          <th scope="col">{{ t('config.estabelecimentos.unidades') }}</th>
          <th scope="col">{{ t('config.estabelecimentos.situacao') }}</th>
          <th scope="col">{{ t('config.estabelecimentos.schema') }}</th>
          <th scope="col">{{ t('config.estabelecimentos.conexoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in dados.estabelecimentos" :key="e.codigo">
          <th scope="row">{{ e.codigo }}</th>
          <td>{{ e.nomeConfigurado }}</td>
          <td>
            {{ e.nomeNoBanco ?? '—' }}
            <span v-if="e.nomeConfere === false" role="note">{{
              t('config.estabelecimentos.nomeDiverge')
            }}</span>
          </td>
          <td>{{ e.cnes ?? '—' }}</td>
          <td>{{ e.unidades }}</td>
          <td>
            {{
              e.disponivel
                ? t('config.estabelecimentos.disponivel')
                : t('config.estabelecimentos.indisponivel')
            }}<span v-if="e.motivo">{{ t('config.estabelecimentos.motivo', { motivo: e.motivo }) }}</span>
            <span v-if="e.sysdbaDev">{{ t('config.estabelecimentos.sysdbaDev') }}</span>
          </td>
          <td>{{ rotuloEstado(e.estadoSchema) }}</td>
          <td>
            {{
              e.pool
                ? t('config.estabelecimentos.pool', { abertas: e.pool.abertas, livres: e.pool.livres })
                : '—'
            }}
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
