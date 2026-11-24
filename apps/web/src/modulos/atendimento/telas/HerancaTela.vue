<script setup lang="ts">
// Herança do atendimento anterior (ficha do M20, seção 5): `/recepcao/atendimento/heranca`. O que a ficha nova traz
// preenchido do último atendimento do paciente (convênio, profissional, carteirinha, plano…). A configuração vale
// para o estabelecimento ou, marcando "só para mim", para o usuário (a dele vence); a gravação confere a configuração
// lida (outra estação mudou: o aviso e a releitura).
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { alterarHeranca, lerConfiguracaoHeranca, novaChave } from '../api-atendimento.js';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { pode } = usarAtendimento();
const cfg = useQuery({ queryKey: ['atendimento', 'heranca'], queryFn: () => lerConfiguracaoHeranca() });
const marcas = ref<Record<string, boolean>>({});
watch(
  () => cfg.data.value,
  (c) => {
    if (c) marcas.value = Object.fromEntries(c.campos.map((x) => [x.campo, x.herda]));
  },
  { immediate: true },
);
const podeGravar = pode('atendimento.alterarHeranca');
const mudou = computed(() => (cfg.data.value?.campos ?? []).some((c) => marcas.value[c.campo] !== c.herda));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const paraMim = ref(false);
async function gravar(): Promise<void> {
  const c = cfg.data.value;
  if (!c) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await alterarHeranca(
      {
        versao: c.versao,
        ...(paraMim.value ? { paraMim: true } : {}),
        marcas: Object.fromEntries(
          c.campos
            .filter((x) => marcas.value[x.campo] !== x.herda)
            .map((x) => [x.campo, marcas.value[x.campo]]),
        ),
      },
      novaChave('heranca'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
    await cfg.refetch();
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="heranca-titulo" data-testid="tela-heranca">
    <h1 id="heranca-titulo">{{ t('atendimento.heranca.titulo') }}</h1>
    <p>{{ t('atendimento.heranca.texto') }}</p>
    <ErroAtendimento v-if="cfg.isError.value" :erro="cfg.error.value" />
    <p v-else-if="!cfg.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <form v-else class="painel" @submit.prevent="gravar">
      <fieldset class="filtros">
        <legend>{{ t('atendimento.heranca.campos') }}</legend>
        <label v-for="c in cfg.data.value.campos" :key="c.campo">
          <input
            v-model="marcas[c.campo]"
            type="checkbox"
            :disabled="!podeGravar"
            :data-testid="`heranca-${c.campo}`"
          />
          {{ c.rotulo }}
        </label>
      </fieldset>
      <label v-if="podeGravar">
        <input v-model="paraMim" type="checkbox" data-testid="heranca-para-mim" />
        {{ t('atendimento.heranca.paraMim') }}
      </label>
      <p class="acoes">
        <SanteBotao
          v-if="podeGravar"
          tipo="submit"
          :rotulo="t('atendimento.gravar')"
          :desabilitado="!mudou || ocupado"
          data-testid="botao-gravar-heranca"
        />
      </p>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <ErroAtendimento v-if="erro" :erro="erro" />
    </form>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
