<script setup lang="ts">
// W0-08, parte 10 (mercado M4): o relatório do PMOC do período (Lei 13.589/2018; Portaria GM/MS 3.523/1998) em PDF/A,
// com os planos do modelo PMOC, as execuções do período e a assinatura do responsável técnico (cadastro do dono, nos
// parâmetros da manutenção). Sem o responsável cadastrado ou com o período errado, a recusa vem traduzida.
import { SanteBotao, SanteData } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { baixarRelatorioPmoc } from '../api-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{ hoje: string }>();
const { t } = useI18n();
const de = ref(`${props.hoje.slice(0, 4)}-01-01`);
const ate = ref(props.hoje);
const erro = ref<unknown>(null);
const gerando = ref(false);
const gerado = ref<string | null>(null);

async function gerar() {
  erro.value = null;
  gerado.value = null;
  gerando.value = true;
  try {
    const a = await baixarRelatorioPmoc(de.value, ate.value);
    const url = URL.createObjectURL(a.conteudo);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.nome;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    gerado.value = a.nome;
  } catch (x) {
    erro.value = x;
  } finally {
    gerando.value = false;
  }
}
</script>

<template>
  <form class="bloco" data-testid="pmoc-relatorio" @submit.prevent="gerar">
    <h3>{{ t('manutencao.plano.pmoc.titulo') }}</h3>
    <p class="secundario">{{ t('manutencao.plano.pmoc.ajuda') }}</p>
    <div class="campos">
      <SanteData v-model="de" editavel :rotulo="t('manutencao.plano.pmoc.de')" data-testid="pmoc-de" />
      <SanteData
        v-model="ate"
        editavel
        :rotulo="t('manutencao.plano.pmoc.ate')"
        :maximo="hoje"
        data-testid="pmoc-ate"
      />
    </div>
    <ErroManutencao v-if="erro" :erro="erro" grupo="pmoc" />
    <p v-if="gerado" role="status" data-testid="pmoc-gerado">
      {{ t('manutencao.plano.pmoc.gerado', { nome: gerado }) }}
    </p>
    <div class="acoes">
      <SanteBotao
        tipo="submit"
        :rotulo="t('manutencao.plano.pmoc.gerar')"
        :desabilitado="gerando || !de || !ate"
        data-testid="pmoc-gerar"
      />
    </div>
  </form>
</template>

<style scoped src="./estilo-manutencao.css"></style>
