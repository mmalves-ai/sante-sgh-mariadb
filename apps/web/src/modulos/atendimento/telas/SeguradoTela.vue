<script setup lang="ts">
// Segurado e carteirinha (ficha do M20, seção 7): `/recepcao/atendimento/:reg/segurado`. A carteirinha, a validade, a
// guia, a senha do convênio, a validade da senha e o plano do atendimento aberto; a gravação confere o carimbo da
// ficha (alterada por outra estação desde a leitura: o aviso de colisão e a releitura).
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAvisoColisao, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { alterarSegurado, lerAtendimento, novaChave } from '../api-atendimento.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import ResumoAtendimento from '../componentes/ResumoAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivoAmbulatorio } = usarAtendimento();
const reg = computed(() => Number(props.reg));
const ficha = useQuery({
  queryKey: computed(() => ['atendimento', 'ficha', reg.value]),
  queryFn: () => lerAtendimento(reg.value),
});
const matricula = ref('');
const validade = ref('');
const guia = ref('');
const senhaConvenio = ref('');
const validadeSenha = ref('');
const plano = ref('');
watch(
  () => ficha.data.value,
  (f) => {
    if (!f) return;
    matricula.value = f.matricula;
    validade.value = f.validadeCarteira ?? '';
    guia.value = f.guia;
    senhaConvenio.value = f.senhaConvenio;
    validadeSenha.value = f.validadeSenha ?? '';
    plano.value = f.plano;
  },
  { immediate: true },
);
const podeGravar = computed(() => pode('atendimento.alterarSegurado').value && !ficha.data.value?.desfecho);
const chave = ref(novaChave('segurado'));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const colisao = computed(() =>
  erro.value instanceof ErroApi &&
  erro.value.problema &&
  tipoDoProblema(erro.value.problema) === 'conflito-de-versao'
    ? erro.value.problema
    : null,
);

async function gravar(): Promise<void> {
  const f = ficha.data.value;
  if (!f) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await alterarSegurado(
      reg.value,
      {
        versao: f.versao,
        matricula: matricula.value,
        validadeCarteira: validade.value || null,
        guia: guia.value,
        senhaConvenio: senhaConvenio.value,
        validadeSenha: validadeSenha.value || null,
        plano: plano.value,
      },
      chave.value,
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
  } finally {
    chave.value = novaChave('segurado');
    ocupado.value = false;
  }
}
async function reler(): Promise<void> {
  erro.value = null;
  await ficha.refetch();
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="segurado-titulo" data-testid="tela-segurado">
    <h1 id="segurado-titulo">{{ t('atendimento.segurado.titulo') }}</h1>
    <p>{{ t('atendimento.segurado.texto') }}</p>
    <AvisoAtendimento :motivo="motivoAmbulatorio" />
    <ErroAtendimento v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <ResumoAtendimento :atendimento="ficha.data.value" atalhos />
      <form class="painel" @submit.prevent="gravar">
        <div class="filtros">
          <SanteCampoTexto
            v-model="matricula"
            :rotulo="t('atendimento.segurado.matricula')"
            :max-bytes="24"
          />
          <div class="campo">
            <label for="seg-validade">{{ t('atendimento.segurado.validade') }}</label>
            <input id="seg-validade" v-model="validade" type="date" />
          </div>
          <SanteCampoTexto v-model="guia" :rotulo="t('atendimento.segurado.guia')" :max-bytes="20" />
          <SanteCampoTexto
            v-model="senhaConvenio"
            :rotulo="t('atendimento.segurado.senhaConvenio')"
            :max-bytes="20"
          />
          <div class="campo">
            <label for="seg-validade-senha">{{ t('atendimento.segurado.validadeSenha') }}</label>
            <input id="seg-validade-senha" v-model="validadeSenha" type="date" />
          </div>
          <SanteCampoTexto v-model="plano" :rotulo="t('atendimento.segurado.plano')" :max-bytes="40" />
        </div>
        <p class="acoes">
          <SanteBotao
            v-if="podeGravar"
            tipo="submit"
            :rotulo="t('atendimento.gravar')"
            :desabilitado="ocupado"
            data-testid="botao-gravar-segurado"
          />
          <span v-else class="secundario">{{ t('atendimento.semAcao') }}</span>
        </p>
        <p v-if="mensagem" role="status" data-testid="segurado-gravado">{{ mensagem }}</p>
      </form>
      <SanteAvisoColisao v-if="colisao" :problema="colisao" @rever="reler" @descartar="reler" />
      <ErroAtendimento v-else-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
