<script setup lang="ts">
// Origem e indicação do paciente (F3.1, 02-CAD linha 12): de onde veio e quem indicou, na ficha. As exigências de quem
// indicou vêm do tipo de indicação que o hospital mantém (pede o profissional, pede o complemento); o canal é só o meio de
// chegada e a campanha pede o nome. O servidor confere de novo pela mesma regra do domínio.
import { SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { type Captacao, lerCaptacoes, type Opcoes, registrarCaptacao } from '../api-vinculos.js';

const props = defineProps<{ idPaciente: number; podeEditar: boolean; opcoes: Opcoes | null }>();
const { t } = useI18n();
const canal = (c: string) => t(`vinculos.captacao.canais.${c}`);
const itens = ref<Captacao[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref('');
const f = ref({
  canal: 'espontaneo',
  tipoIndicacao: 0,
  indicadorNome: '',
  indicadorProfissional: 0,
  campanha: '',
});
const tipo = computed(() => props.opcoes?.tiposIndicacao.find((t) => t.id === f.value.tipoIndicacao) ?? null);
const pendencias = computed(() => {
  const r: string[] = [];
  if (!tipo.value) r.push(t('vinculos.captacao.falta.tipo'));
  if (tipo.value?.exigeProfissional && !f.value.indicadorProfissional)
    r.push(t('vinculos.captacao.falta.profissional'));
  if (tipo.value?.exigeComplemento && !f.value.indicadorNome.trim())
    r.push(t('vinculos.captacao.falta.quem'));
  if (f.value.canal === 'campanha' && !f.value.campanha.trim()) r.push(t('vinculos.captacao.falta.campanha'));
  return r;
});
async function carregar(): Promise<void> {
  try {
    itens.value = (await lerCaptacoes(props.idPaciente)).itens;
  } catch (e) {
    erro.value = e;
  }
}
async function registrar(): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  try {
    await registrarCaptacao(props.idPaciente, {
      canal: f.value.canal,
      tipoIndicacao: f.value.tipoIndicacao,
      indicadorNome: f.value.indicadorNome.trim() || null,
      indicadorProfissional: f.value.indicadorProfissional || null,
      campanha: f.value.campanha.trim() || null,
    });
    mensagem.value = t('vinculos.captacao.registrada');
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
void carregar();
</script>

<template>
  <section aria-labelledby="sec-captacao" data-testid="captacao-paciente">
    <h2 id="sec-captacao">{{ t('vinculos.captacao.titulo') }}</h2>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <p v-if="itens.length === 0">{{ t('vinculos.captacao.nenhuma') }}</p>
    <ul v-else>
      <li v-for="i in itens" :key="i.id">
        {{ `${i.captadoEm.slice(0, 10)} — ${canal(i.canal)} — ${i.tipoIndicacao.descricao}` }}
        <template v-if="i.indicador">{{ `: ${i.indicador}` }}</template>
        <template v-if="i.campanha">{{ ` (${i.campanha})` }}</template>
      </li>
    </ul>
    <form v-if="podeEditar && opcoes" data-testid="nova-captacao" @submit.prevent="registrar">
      <SanteSelecao
        v-model="f.canal"
        :rotulo="t('vinculos.captacao.canal')"
        :opcoes="opcoes.canais.map((c) => ({ valor: c, rotulo: canal(c) }))"
      />
      <SanteSelecao
        v-model="f.tipoIndicacao"
        :rotulo="t('vinculos.captacao.tipo')"
        :opcoes="[
          { valor: 0, rotulo: t('vinculos.comum.escolha'), desabilitada: true },
          ...opcoes.tiposIndicacao.map((x) => ({ valor: x.id, rotulo: x.descricao })),
        ]"
      />
      <label v-if="tipo?.exigeProfissional"
        >{{ t('vinculos.captacao.profissional') }}
        <input v-model.number="f.indicadorProfissional" type="number" min="1"
      /></label>
      <label v-if="tipo?.exigeComplemento"
        >{{ t('vinculos.captacao.quemIndicou') }} <input v-model="f.indicadorNome" maxlength="150"
      /></label>
      <label v-if="f.canal === 'campanha'"
        >{{ t('vinculos.captacao.campanha') }} <input v-model="f.campanha" maxlength="100"
      /></label>
      <ul v-if="pendencias.length && f.tipoIndicacao" class="pendencias">
        <li v-for="p in pendencias" :key="p">{{ p }}</li>
      </ul>
      <button type="submit" :disabled="pendencias.length > 0">{{ t('vinculos.captacao.registrar') }}</button>
    </form>
  </section>
</template>
