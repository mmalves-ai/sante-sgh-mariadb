<script setup lang="ts">
// Estado da troca on-line com a operadora (decisão 53; C2-070, C1-108, C3-007): selo "Simulador" ou "Real", o aviso de
// real neutralizado fora de produção, o de registro à mão quando nada sai e, como o real depende da definição do
// webservice de cada operadora, o que pedir a ela (a mesma lista da central de integrações externas).
import { entradaIntegracaoExterna, type EstadoIntegracaoNaFuncao } from '@sgh/contratos';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerTransporteTiss } from '../api-elegibilidade.js';

const props = defineProps<{ url: string }>();
const { t } = useI18n();
const k = (c: string) => t(`elegibilidade.transporte.${c}`);
const estado = ref<EstadoIntegracaoNaFuncao | null>(null);
const pedir = computed(() =>
  estado.value ? (entradaIntegracaoExterna(estado.value.integracao)?.oQuePedirAoFornecedor ?? []) : [],
);

onMounted(async () => {
  estado.value = await lerTransporteTiss(props.url).catch(() => null);
});
</script>

<template>
  <aside v-if="estado" class="transporte-tiss" :aria-label="k('rotulo')" data-testid="transporte-tiss">
    <p>
      <strong>{{ k('rotulo') }}</strong>
      <span class="selo" :data-modo="estado.modo" data-testid="transporte-tiss-selo">
        {{ estado.modo === 'real' ? k('seloReal') : k('selo') }}
      </span>
    </p>
    <p v-if="estado.modo === 'simulador'" data-testid="transporte-tiss-simulador">{{ k('simulador') }}</p>
    <p v-if="estado.neutralizado" role="status" data-testid="transporte-tiss-neutralizado">
      {{ k('neutralizado') }}
    </p>
    <p v-if="!estado.transmite" role="status" data-testid="transporte-tiss-sem-envio">{{ k('semEnvio') }}</p>
    <div v-if="estado.dependeDefinicaoFornecedor" data-testid="transporte-tiss-fornecedor">
      <p>{{ k('fornecedor') }}</p>
      <ul>
        <li v-for="item in pedir" :key="item">{{ item }}</li>
      </ul>
    </div>
  </aside>
</template>

<style scoped>
.transporte-tiss {
  border: 1px solid var(--sante-cor-borda, #c8cdd4);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin: 0.5rem 0;
}
.selo {
  margin-left: 0.5rem;
  padding: 0 0.4rem;
  border-radius: 4px;
  background: var(--sante-cor-aviso-fundo, #fff4d6);
  color: var(--sante-cor-texto, #1a1a1a);
}
.selo[data-modo='real'] {
  background: var(--sante-cor-sucesso-fundo, #dff3e4);
}
</style>
