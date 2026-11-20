<script setup lang="ts">
// Aceite do termo de uso do prontuário (M10, ficha seção 7; cap-08 §8.12): com a sessão marcada com o termo
// pendente, a casca abre este diálogo antes de qualquer tela; aceitar grava o aceite (receita do executor, ou a
// memória em desenvolvimento) e a sessão segue; sair encerra. Sem o aceite possível (POL-3), o motivo aparece.
import { type Sessao } from '@sgh/contratos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from './MensagemErro.vue';
import { CHAVE_SESSAO, usarSaida } from './sessao/sessao.js';
import { aceitarTermo, buscarTermoDaSessao } from '../modulos/administracao/api.js';

const props = defineProps<{ sessao: Sessao | null | undefined }>();
const { t } = useI18n();
const cliente = useQueryClient();
const sair = usarSaida();
const pendente = computed(() => !!props.sessao?.termoPendente);
const termo = useQuery({
  queryKey: ['termo-da-sessao'],
  queryFn: () => buscarTermoDaSessao(),
  enabled: pendente,
});
const visivel = computed({ get: () => pendente.value, set: () => undefined });
const erro = ref<unknown>(null);
const enviando = ref(false);
async function aceitar(): Promise<void> {
  const id = termo.data.value?.termo?.id;
  if (!id) return;
  enviando.value = true;
  erro.value = null;
  try {
    await aceitarTermo(id);
    await cliente.invalidateQueries({ queryKey: CHAVE_SESSAO });
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('adm.termo.dialogoTitulo')" largura="40rem">
    <div data-testid="dialogo-termo">
      <p>{{ t('adm.termo.dialogoTexto') }}</p>
      <MensagemErro v-if="termo.isError.value" :erro="termo.error.value" />
      <template v-else-if="termo.data.value?.termo">
        <div class="texto" tabindex="0" data-testid="texto-termo">{{ termo.data.value.termo.texto }}</div>
        <SanteAlerta
          v-if="!termo.data.value.aceitePossivel && termo.data.value.motivo"
          :texto="termo.data.value.motivo"
          variante="aviso"
        />
      </template>
      <MensagemErro v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('adm.termo.aceitar')"
          :desabilitado="enviando || !termo.data.value?.aceitePossivel || !termo.data.value?.termo"
          data-testid="aceitar-termo"
          @acionar="aceitar"
        />
        <SanteBotao :rotulo="t('adm.termo.sair')" variante="texto" data-testid="sair-termo" @acionar="sair" />
      </div>
    </div>
  </SanteDialogo>
</template>

<style scoped>
.texto {
  white-space: pre-wrap;
  max-height: 20rem;
  overflow: auto;
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
</style>
