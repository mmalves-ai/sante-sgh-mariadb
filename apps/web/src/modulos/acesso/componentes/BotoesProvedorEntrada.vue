<script setup lang="ts">
// Login único corporativo (01-ADM L61): um botão por provedor de identidade ativo no estabelecimento escolhido. O
// clique pede ao servidor o endereço do provedor (com estado, nonce e PKCE de uso único) e leva o navegador até lá; a
// volta cai em /entrar/provedor. Sem provedor cadastrado, nada aparece.
import { SanteBotao } from '@sgh/ui';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { mensagemDoErro } from '../../../casca/erros/problem-details.js';
import { iniciarEntradaProvedor, provedoresDaEntrada } from '../api-provedor-identidade.js';

const props = defineProps<{ estabelecimento: string | null; desabilitado?: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      com: 'Entrar com {nome}',
      indo: 'Abrindo o provedor…',
      falhou: 'Não foi possível abrir o provedor de identidade. Tente de novo ou entre com a senha.',
    },
  },
});
const provedores = ref<{ codigo: string; nome: string }[]>([]);
const indo = ref<string | null>(null);
const erro = ref('');

watch(
  () => props.estabelecimento,
  async (e) => {
    provedores.value = e ? await provedoresDaEntrada(e) : [];
  },
  { immediate: true },
);

async function ir(codigo: string): Promise<void> {
  if (!props.estabelecimento || indo.value) return;
  indo.value = codigo;
  erro.value = '';
  try {
    const { url } = await iniciarEntradaProvedor(props.estabelecimento, codigo);
    window.location.assign(url);
  } catch (e) {
    erro.value = mensagemDoErro(e).motivo || t('falhou');
    indo.value = null;
  }
}
</script>

<template>
  <div v-if="provedores.length" class="provedores" data-testid="entrar-provedores">
    <SanteBotao
      v-for="p in provedores"
      :key="p.codigo"
      :rotulo="indo === p.codigo ? t('indo') : t('com', { nome: p.nome })"
      variante="secundario"
      :desabilitado="desabilitado || indo !== null"
      :data-testid="`entrar-provedor-${p.codigo}`"
      @click="ir(p.codigo)"
    />
    <p v-if="erro" role="alert" class="provedores__erro">{{ erro }}</p>
  </div>
</template>

<style scoped>
.provedores {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.provedores__erro {
  margin: 0;
  color: var(--sgh-alerta);
}
</style>
