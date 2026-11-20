<script setup lang="ts">
// A comissão obrigatória: tipo, nome, periodicidade das reuniões ordinárias e a composição (o membro com a função e,
// quando usa o sistema, o usuário). A alteração leva a versão lida (outra pessoa ter mudado antes vira aviso).
import { PERIODICIDADES_COMISSAO, TIPOS_COMISSAO } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type ComissaoTela, novaChaveGestao, registrarComissao } from '../api-gestao.js';
import { formularioDaComissao, type MembroForm, montarComissao } from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{ comissao: ComissaoTela | null }>();
const emit = defineEmits<{ gravado: [id: number]; cancelar: [] }>();
const { t } = useI18n();

const inicial = formularioDaComissao(props.comissao);
const f = reactive({
  ...inicial,
  justificativa: inicial.justificativa ?? '',
  membros: inicial.membros.map((m) => ({ ...m })) as MembroForm[],
});
const opTipo = [
  { valor: '', rotulo: '' },
  ...TIPOS_COMISSAO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
const opPeriodicidade = [
  { valor: '', rotulo: '' },
  ...PERIODICIDADES_COMISSAO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('comissao');
async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarComissao(f, props.comissao);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    const r = await registrarComissao(m.entrada, chave);
    chave = novaChaveGestao('comissao');
    emit('gravado', r.id);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="painel-ccih" data-testid="form-comissao" @submit.prevent="gravar">
    <h2>{{ comissao ? comissao.nome : t('gestaoQualidade.comissoes.nova') }}</h2>
    <div class="linha-ccih">
      <SanteSelecao
        v-model="f.tipo"
        :rotulo="t('gestaoQualidade.comissoes.form.tipo')"
        :opcoes="opTipo"
        obrigatorio
        data-testid="com-tipo"
      />
      <SanteSelecao
        v-model="f.periodicidade"
        :rotulo="t('gestaoQualidade.comissoes.form.periodicidade')"
        :opcoes="opPeriodicidade"
        obrigatorio
        data-testid="com-periodicidade"
      />
    </div>
    <SanteCampoTexto
      v-model="f.nome"
      :rotulo="t('gestaoQualidade.comissoes.form.nome')"
      :max-bytes="120"
      obrigatorio
      data-testid="com-nome"
    />
    <label class="marcar-gestao"
      ><input v-model="f.ativa" type="checkbox" data-testid="com-ativa" />
      {{ t('gestaoQualidade.comissoes.form.ativa') }}</label
    >
    <fieldset class="painel-ccih">
      <legend>{{ t('gestaoQualidade.comissoes.form.membros') }}</legend>
      <div v-for="(m, k) in f.membros" :key="k" class="linha-ccih" :data-testid="`com-membro-${k}`">
        <SanteCampoTexto
          v-model="m.nome"
          :rotulo="`${t('gestaoQualidade.comissoes.form.membro', { n: k + 1 })}: ${t('gestaoQualidade.comissoes.form.membroNome')}`"
          :max-bytes="80"
          :data-testid="`com-membro-nome-${k}`"
        />
        <SanteCampoTexto
          v-model="m.funcao"
          :rotulo="t('gestaoQualidade.comissoes.form.membroFuncao')"
          :max-bytes="60"
          :data-testid="`com-membro-funcao-${k}`"
        />
        <SanteCampoTexto
          v-model="m.login"
          :rotulo="t('gestaoQualidade.comissoes.form.membroLogin')"
          :max-bytes="31"
          :data-testid="`com-membro-login-${k}`"
        />
        <SanteBotao
          v-if="f.membros.length > 1"
          variante="texto"
          :rotulo="t('gestaoQualidade.comissoes.form.removerMembro', { n: k + 1 })"
          @acionar="f.membros.splice(k, 1)"
        />
      </div>
      <SanteBotao
        v-if="f.membros.length < 40"
        variante="secundario"
        :rotulo="t('gestaoQualidade.comissoes.form.incluirMembro')"
        data-testid="com-incluir-membro"
        @acionar="f.membros.push({ nome: '', funcao: '', login: '' })"
      />
    </fieldset>
    <template v-if="comissao">
      <p class="secundario">{{ t('gestaoQualidade.comissoes.form.alteracaoAjuda') }}</p>
      <SanteCampoTexto
        v-model="f.justificativa"
        :rotulo="t('qualidade.correcao.justificativa')"
        :max-bytes="500"
        obrigatorio
        data-testid="com-justificativa"
      />
    </template>
    <ErrosFormulario :erros="erros" />
    <ErroGestao v-if="erro" :erro="erro" />
    <div class="linha-ccih">
      <SanteBotao
        tipo="submit"
        :rotulo="t('gestaoQualidade.gravar')"
        :desabilitado="gravando"
        data-testid="com-gravar"
      />
      <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>
