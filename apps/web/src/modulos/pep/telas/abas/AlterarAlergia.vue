<script setup lang="ts">
// Alteração da alergia ativa (03-PEP L100): gravidade, reação, origem da informação, observação e manifestações,
// já preenchidos com o que está gravado (as manifestações vêm do histórico, lido só ao abrir). O agente não muda:
// agente diferente é outra alergia. Cada alteração deixa o evento no histórico, com o motivo quando informado.
import {
  GRAVIDADES_ALERGIA,
  ORIGENS_ALERGIA,
  type AlergiaPep,
  type GravidadeAlergia,
  type ManifestacaoAlergica,
  type OrigemAlergia,
} from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { alterarAlergia, lerHistoricoAlergia } from '../../api-documentos.js';

const props = defineProps<{
  paciente: number;
  alergia: AlergiaPep;
  versao: string;
  catalogo: readonly ManifestacaoAlergica[];
}>();
const { t } = useI18n();
const cliente = useQueryClient();
const aberto = ref(false);
const pronto = ref(false);
const gravidade = ref<GravidadeAlergia | ''>('');
const origem = ref<OrigemAlergia | ''>('');
const reacao = ref('');
const observacao = ref('');
const manifestacoes = ref<number[]>([]);
const motivo = ref('');
const erro = ref<unknown>(null);
const opcoesGravidade = computed<{ valor: GravidadeAlergia | ''; rotulo: string }[]>(() => [
  { valor: '', rotulo: '-' },
  ...GRAVIDADES_ALERGIA.map((g) => ({ valor: g, rotulo: t(`pep.doc.alergias.gravidades.${g}`) })),
]);
const opcoesOrigem = computed<{ valor: OrigemAlergia | ''; rotulo: string }[]>(() => [
  { valor: '', rotulo: '-' },
  ...ORIGENS_ALERGIA.map((o) => ({ valor: o, rotulo: t(`pep.doc.alergias.origens.${o}`) })),
]);

async function abrir(ev: Event): Promise<void> {
  aberto.value = (ev.target as HTMLDetailsElement).open;
  if (!aberto.value || pronto.value) return;
  erro.value = null;
  gravidade.value = props.alergia.gravidade ?? '';
  origem.value = props.alergia.origem ?? '';
  reacao.value = props.alergia.reacao ?? '';
  observacao.value = props.alergia.observacao ?? '';
  try {
    const h = await lerHistoricoAlergia(props.paciente, props.alergia.id);
    manifestacoes.value = h.manifestacoes.map((m) => m.id);
    pronto.value = true;
  } catch (e) {
    erro.value = e;
  }
}
async function gravar(): Promise<void> {
  erro.value = null;
  try {
    await alterarAlergia(props.paciente, props.alergia.id, {
      gravidade: gravidade.value || null,
      reacao: reacao.value.trim() || null,
      origem: origem.value || null,
      observacao: observacao.value.trim() || null,
      manifestacoes: manifestacoes.value,
      ...(motivo.value.trim() ? { motivo: motivo.value.trim() } : {}),
      versao: props.versao,
    });
    motivo.value = '';
    pronto.value = false;
    aberto.value = false;
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <details :open="aberto" :data-testid="`alterar-alergia-${alergia.id}`" @toggle="abrir">
    <summary>{{ t('pep.doc.alergias.alterar') }}</summary>
    <MensagemErro v-if="erro" :erro="erro" />
    <form v-if="pronto" class="form" @submit.prevent="gravar">
      <SanteSelecao
        v-model="gravidade"
        class="campo"
        :rotulo="t('pep.doc.alergias.gravidade')"
        :opcoes="opcoesGravidade"
        :data-testid="`alterar-gravidade-${alergia.id}`"
      />
      <label
        ><span>{{ t('pep.doc.alergias.reacao') }}</span
        ><input v-model="reacao" maxlength="200" :data-testid="`alterar-reacao-${alergia.id}`"
      /></label>
      <SanteSelecao
        v-model="origem"
        class="campo"
        :rotulo="t('pep.doc.alergias.origem')"
        :opcoes="opcoesOrigem"
      />
      <label
        ><span>{{ t('pep.doc.alergias.observacao') }}</span
        ><input v-model="observacao" maxlength="255"
      /></label>
      <fieldset v-if="catalogo.length">
        <legend>{{ t('pep.doc.alergias.manifestacoes') }}</legend>
        <label v-for="m in catalogo" :key="m.id" class="marca"
          ><input
            v-model="manifestacoes"
            type="checkbox"
            :value="m.id"
            :disabled="manifestacoes.length >= 10 && !manifestacoes.includes(m.id)"
            :data-testid="`alterar-manifestacao-${alergia.id}-${m.id}`"
          />{{ m.nome }}</label
        >
      </fieldset>
      <label
        ><span>{{ t('pep.doc.alergias.motivoAlteracao') }}</span
        ><input v-model="motivo" maxlength="500" :data-testid="`alterar-motivo-${alergia.id}`"
      /></label>
      <SanteBotao
        tipo="submit"
        :rotulo="t('pep.doc.alergias.gravarAlteracao')"
        :data-testid="`alterar-gravar-${alergia.id}`"
      />
    </form>
  </details>
</template>

<style scoped src="./abas.css"></style>
