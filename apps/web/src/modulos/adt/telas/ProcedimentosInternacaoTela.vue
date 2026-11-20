<script setup lang="ts">
// Procedimentos extras e APAC da internação (ficha do M21, seção 7): `/internacao/:reg/procedimentos`, consulta. As
// contas da internação (a principal e as parciais do faturamento) e os procedimentos extras lançados nelas.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import ErroAdt from '../componentes/ErroAdt.vue';
import ResumoInternacao from '../componentes/ResumoInternacao.vue';
import { usarInternacao } from '../usar-internacao.js';

const props = defineProps<{ reg: string }>();
const { t, te } = useI18n();
const reg = computed(() => Number(props.reg));
const { ficha } = usarInternacao(reg);
const tipoConta = (x: string) => (te(`adt.procedimentos.tipos.${x}`) ? t(`adt.procedimentos.tipos.${x}`) : x);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="proc-int-titulo" data-testid="tela-procedimentos-internacao">
    <h1 id="proc-int-titulo">{{ t('adt.procedimentos.titulo') }}</h1>
    <p>{{ t('adt.procedimentos.texto') }}</p>
    <ErroAdt v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <ResumoInternacao :internacao="ficha.data.value" atalhos />
      <table class="tabela" data-testid="tabela-contas">
        <caption class="secundario">
          {{
            t('adt.procedimentos.contas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.procedimentos.conta') }}</th>
            <th scope="col">{{ t('adt.guias.inicio') }}</th>
            <th scope="col">{{ t('adt.procedimentos.tipoConta') }}</th>
            <th scope="col">{{ t('adt.procedimentos.guias') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in ficha.data.value.contas" :key="c.conta">
            <td>{{ c.conta }}</td>
            <td>{{ dataBr(c.inicio) }}</td>
            <td>{{ tipoConta(c.tipo) }}</td>
            <td>{{ c.guias }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="ficha.data.value.procedimentosExtras.length === 0" data-testid="sem-extras">
        {{ t('adt.procedimentos.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-extras">
        <caption class="secundario">
          {{
            t('adt.procedimentos.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.procedimentos.conta') }}</th>
            <th scope="col">{{ t('adt.procedimentos.procedimento') }}</th>
            <th scope="col">{{ t('adt.procedimentos.sequencia') }}</th>
            <th scope="col">{{ t('adt.procedimentos.apac') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in ficha.data.value.procedimentosExtras" :key="`${p.conta}-${p.sequencia}`">
            <td>{{ p.conta }}</td>
            <td>{{ p.procedimento }}</td>
            <td>{{ p.sequencia }}</td>
            <td>{{ p.apac ? dataBr(p.dataApac) || t('adt.sim') : t('adt.nao') }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
