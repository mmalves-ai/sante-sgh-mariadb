<script setup lang="ts">
// Etapas de um fluxo sobre o Stepper do OpenVue, com os papéis ARIA corrigidos (DP-51, condição 4).
// O OpenVue marca a raiz com role=tablist e os passos com role=tab sem painéis: o leitor de tela anuncia
// abas que não existem e o axe acusa aria-required-children. Aqui a estrutura vira lista ordenada
// (role=list / listitem) com aria-current="step" no passo atual; o teste axe cobre.
import Step from 'openvue/step';
import StepList from 'openvue/steplist';
import Stepper from 'openvue/stepper';
import { useI18n } from 'vue-i18n';

defineProps<{ passos: readonly { readonly valor: string; readonly rotulo: string }[] }>();
const atual = defineModel<string>({ required: true });
const { t } = useI18n();

const ptRaiz = { root: { role: undefined, 'aria-label': undefined } };
const ptLista = { root: { role: 'list' } };
function ptPasso(ativo: boolean) {
  return {
    root: { role: 'listitem', 'aria-current': ativo ? 'step' : undefined },
    header: { role: undefined, 'aria-controls': undefined },
  };
}
</script>

<template>
  <nav class="sgh-passos" :aria-label="t('ui.passos.rotulo')" data-testid="passos">
    <Stepper v-model:value="atual" :pt="ptRaiz">
      <StepList :pt="ptLista">
        <Step v-for="p in passos" :key="p.valor" :value="p.valor" :pt="ptPasso(p.valor === atual)">{{
          p.rotulo
        }}</Step>
      </StepList>
    </Stepper>
  </nav>
</template>
