<script setup lang="ts">
// Cartão "Avisos de mudança (vigia)" da tela de conexões (M16; ficha, seção 7; regra 15): por canal e
// estabelecimento, se está em uso, os ciclos, as consultas do último ciclo (a carga fixa), as mudanças, o atraso,
// os erros, as telas que escutam e as releituras (marca de leitura perdida).
import type { SaudeVigia } from '@sgh/contratos';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerSaudeVigia } from '../api-internacao.js';

const { t } = useI18n();
const dados = ref<SaudeVigia | null>(null);
const erro = ref<unknown>(null);
onMounted(async () => {
  try {
    dados.value = await lerSaudeVigia();
  } catch (e) {
    erro.value = e;
  }
});
</script>

<template>
  <section aria-labelledby="vigia-titulo" data-testid="cartao-vigia">
    <h2 id="vigia-titulo">{{ t('internacao.vigia.titulo') }}</h2>
    <p>{{ t('internacao.vigia.texto') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <template v-else-if="dados">
      <p>{{ t('internacao.vigia.marca', { onde: dados.marcaDagua === 'valkey' ? 'Valkey' : 'memória' }) }}</p>
      <p v-if="dados.canais.length === 0">{{ t('internacao.vigia.nenhum') }}</p>
      <table v-else>
        <caption>
          {{
            t('internacao.vigia.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('internacao.vigia.canal') }}</th>
            <th scope="col">{{ t('internacao.vigia.estabelecimento') }}</th>
            <th scope="col">{{ t('internacao.vigia.ligado') }}</th>
            <th scope="col">{{ t('internacao.vigia.ciclos') }}</th>
            <th scope="col">{{ t('internacao.vigia.consultas') }}</th>
            <th scope="col">{{ t('internacao.vigia.mudancas') }}</th>
            <th scope="col">{{ t('internacao.vigia.atraso') }}</th>
            <th scope="col">{{ t('internacao.vigia.erros') }}</th>
            <th scope="col">{{ t('internacao.vigia.telas') }}</th>
            <th scope="col">{{ t('internacao.vigia.releituras') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in dados.canais" :key="`${c.canal}-${c.estabelecimento}`">
            <th scope="row">{{ t(`internacao.vigia.canais.${c.canal}`) }}</th>
            <td>{{ c.estabelecimento }}</td>
            <td>{{ c.ligado ? t('internacao.vigia.sim') : t('internacao.vigia.nao') }}</td>
            <td>{{ c.ciclos }}</td>
            <td>{{ c.consultasUltimoCiclo }}</td>
            <td>{{ c.mudancas }}</td>
            <td>{{ c.atrasoMs === null ? '—' : `${Math.round(c.atrasoMs / 100) / 10} s` }}</td>
            <td>{{ c.erros }}</td>
            <td>{{ c.assinantes }}</td>
            <td>{{ c.releituras }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
