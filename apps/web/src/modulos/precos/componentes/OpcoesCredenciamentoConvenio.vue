<script setup lang="ts">
// ADR 0009, no cadastro do convênio: as opções de credenciamento (decisão 25: atender sem credenciamento só alerta,
// salvo "bloqueia"; decisão 26: "convênio novo credencia todos os médicos ativos") e a lista dos profissionais
// credenciados. Gravar pede a permissão de editar o contrato do convênio; a lista, a de ler o credenciamento.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { novaChave } from '../../agenda/api-agenda.js';
import { definirOpcoesCredenciamento, lerOpcoesCredenciamento } from '../../agenda/api-estruturada.js';
import CredenciamentoConvenios from '../../cadastro/componentes/CredenciamentoConvenios.vue';

const props = defineProps<{ codigo: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({
  queryKey: computed(() => ['convenio', 'credenciamento', props.codigo]),
  queryFn: () => lerOpcoesCredenciamento(props.codigo),
});
const bloqueia = ref(false);
const credenciaTodos = ref(false);
watch(
  () => consulta.data.value,
  (o) => {
    if (!o) return;
    bloqueia.value = o.bloqueiaSemCredenciamento;
    credenciaTodos.value = o.credenciaTodosAoCriar;
  },
  { immediate: true },
);
const podeEditar = computed(() => pode('convenio.contrato.editar'));
const podeLerCredenciados = computed(() => pode('convenio.credenciamento.ler'));
const mudou = computed(
  () =>
    !!consulta.data.value &&
    (bloqueia.value !== consulta.data.value.bloqueiaSemCredenciamento ||
      credenciaTodos.value !== consulta.data.value.credenciaTodosAoCriar),
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const chave = ref(novaChave('opcoes-credenciamento'));

async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await definirOpcoesCredenciamento(
      props.codigo,
      { bloqueiaSemCredenciamento: bloqueia.value, credenciaTodosAoCriar: credenciaTodos.value },
      chave.value,
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['convenio', 'credenciamento'] });
  } catch (e) {
    erro.value = e;
  } finally {
    chave.value = novaChave('opcoes-credenciamento');
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="opcoes" aria-labelledby="opcoes-cred-titulo" data-testid="opcoes-credenciamento">
    <h2 id="opcoes-cred-titulo">{{ t('estruturada.opcoesConvenio.titulo') }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!consulta.data.value" role="status">{{ t('estruturada.carregando') }}</p>
    <form v-else @submit.prevent="gravar">
      <label class="marca">
        <input v-model="bloqueia" type="checkbox" :disabled="!podeEditar" data-testid="opcao-bloqueia" />
        {{ t('estruturada.opcoesConvenio.bloqueia') }}
      </label>
      <p class="ajuda">{{ t('estruturada.opcoesConvenio.bloqueiaAjuda') }}</p>
      <label class="marca">
        <input
          v-model="credenciaTodos"
          type="checkbox"
          :disabled="!podeEditar"
          data-testid="opcao-credencia-todos"
        />
        {{ t('estruturada.opcoesConvenio.credenciaTodos') }}
      </label>
      <p class="ajuda">{{ t('estruturada.opcoesConvenio.credenciaTodosAjuda') }}</p>
      <SanteBotao
        v-if="podeEditar"
        tipo="submit"
        :rotulo="t('estruturada.opcoesConvenio.gravar')"
        :desabilitado="ocupado || !mudou"
        data-testid="opcoes-gravar"
      />
      <p v-if="mensagem" role="status" data-testid="opcoes-mensagem">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </form>
    <CredenciamentoConvenios
      v-if="consulta.data.value && podeLerCredenciados"
      :fonte-pagadora-id="consulta.data.value.fontePagadoraId"
      :pode-editar="podeEditar"
    />
  </section>
</template>

<style scoped>
.opcoes {
  margin-top: var(--sgh-espaco-3, 1.5rem);
}
.marca {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.ajuda {
  margin: 0 0 var(--sgh-espaco-2) calc(var(--sgh-espaco-2) + 1em);
  color: var(--sgh-texto-secundario, inherit);
}
</style>
