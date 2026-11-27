<script setup lang="ts">
// F3.8, 07-FIN linha 63 (C1-008): alteração do título a pagar não pago, na ficha do título. O formulário vem preenchido
// com o detalhe; as parcelas (vencimento e valor, mais uma ou menos uma) são conferidas na hora contra o valor do
// documento. Vai ao servidor só o que mudou; o servidor confere de novo (regra no domínio: alteração material reabre a
// alçada, título pago, em borderô ou com nota abatida é recusado).
import type { DetalheTituloPagarResposta } from '@sgh/contratos';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  type AlteracaoTituloPagar,
  alterarTituloPagar,
  conferirParcelasAlteracao,
} from '../api-titulo-pagar-alteracao.js';
import { reais } from '../usar-financeiro.js';

const props = defineProps<{ detalhe: DetalheTituloPagarResposta; parcela: number; podeGravar: boolean }>();
const emit = defineEmits<{ gravado: [mensagem: string] }>();
const { t } = useI18n();

interface Form {
  documento: string;
  serie: string;
  emissao: string;
  valorDocumento: number;
  referente: string;
  observacao: string;
  parcelas: { vencimento: string; valor: number }[];
  justificativa: string;
}
const dia = (v: string | null) => (v ?? '').slice(0, 10);
const doDetalhe = (d: DetalheTituloPagarResposta): Form => ({
  documento: String(d.documento),
  serie: d.serie ?? '',
  emissao: dia(d.emissao),
  valorDocumento: d.valorDocumento,
  referente: d.referente ?? '',
  observacao: '',
  parcelas: d.parcelas.map((p) => ({ vencimento: dia(p.vencimento), valor: p.valor })),
  justificativa: '',
});
const form = ref<Form>(doDetalhe(props.detalhe));
watch(
  () => props.detalhe,
  (d) => (form.value = doDetalhe(d)),
);
const erro = ref<unknown>(null);
const gravando = ref(false);

function maisParcela() {
  const ultima = form.value.parcelas.at(-1);
  form.value.parcelas.push({ vencimento: ultima?.vencimento ?? '', valor: 0 });
}
function menosParcela() {
  if (form.value.parcelas.length > 1) form.value.parcelas.pop();
}

const conferencia = computed(() =>
  conferirParcelasAlteracao(form.value.parcelas, Number(form.value.valorDocumento) || 0),
);
/** O corpo só com o que mudou (o servidor decide o que é material). */
const mudancas = computed((): AlteracaoTituloPagar => {
  const o = doDetalhe(props.detalhe);
  const f = form.value;
  const parcelasMudaram =
    f.parcelas.length !== o.parcelas.length ||
    f.parcelas.some(
      (p, i) =>
        p.vencimento !== o.parcelas[i]?.vencimento || Number(p.valor) !== Number(o.parcelas[i]?.valor),
    );
  return {
    versao: props.detalhe.versao ?? null,
    ...(f.documento.trim() !== o.documento ? { documento: f.documento.trim() } : {}),
    ...(f.serie.trim() !== o.serie ? { serie: f.serie.trim() } : {}),
    ...(f.emissao !== o.emissao ? { emissao: f.emissao } : {}),
    ...(Number(f.valorDocumento) !== o.valorDocumento ? { valorDocumento: Number(f.valorDocumento) } : {}),
    ...(f.referente.trim() !== o.referente ? { referente: f.referente.trim() } : {}),
    ...(f.observacao.trim() ? { observacao: f.observacao.trim() } : {}),
    ...(parcelasMudaram
      ? {
          parcelas: f.parcelas.map((p, i) => ({
            parcela: i + 1,
            vencimento: p.vencimento,
            valor: Number(p.valor),
          })),
        }
      : {}),
    ...(f.justificativa.trim() ? { justificativa: f.justificativa.trim() } : {}),
  };
});
const NAO_MATERIAIS = new Set(['versao', 'referente', 'observacao', 'justificativa']);
const material = computed(() => Object.keys(mudancas.value).some((k) => !NAO_MATERIAIS.has(k)));
const nadaMudou = computed(() =>
  Object.keys(mudancas.value).every((k) => k === 'versao' || k === 'justificativa'),
);
const faltaJustificativa = computed(
  () =>
    material.value &&
    props.detalhe.aprovacoesFeitas.length > 0 &&
    form.value.justificativa.trim().length === 0,
);
const aviso = computed(() => {
  const c = conferencia.value;
  if (c.erro === 'soma-diferente')
    return t('financeiro.alteracaoTitulo.avisos.soma-diferente', {
      soma: reais(c.soma),
      valor: reais(Number(form.value.valorDocumento) || 0),
    });
  if (c.erro) return t(`financeiro.alteracaoTitulo.avisos.${c.erro}`);
  if (faltaJustificativa.value) return t('financeiro.alteracaoTitulo.avisos.justificativa');
  return null;
});
const podeEnviar = computed(() => props.podeGravar && !gravando.value && !aviso.value && !nadaMudou.value);

async function gravar() {
  erro.value = null;
  gravando.value = true;
  try {
    const r = await alterarTituloPagar(props.parcela, mudancas.value, novaChave('alterar-titulo'));
    emit('gravado', r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="tpa-titulo" data-testid="tpa-alteracao">
    <h2 id="tpa-titulo">{{ t('financeiro.alteracaoTitulo.titulo') }}</h2>
    <p class="secundario">{{ t('financeiro.alteracaoTitulo.texto') }}</p>
    <form class="filtros" @submit.prevent="gravar">
      <span class="campo">
        <label for="tpa-documento">{{ t('financeiro.alteracaoTitulo.documento') }}</label>
        <input
          id="tpa-documento"
          v-model="form.documento"
          maxlength="20"
          required
          data-testid="tpa-documento"
        />
      </span>
      <span class="campo">
        <label for="tpa-serie">{{ t('financeiro.alteracaoTitulo.serie') }}</label>
        <input id="tpa-serie" v-model="form.serie" maxlength="3" data-testid="tpa-serie" />
      </span>
      <span class="campo">
        <label for="tpa-emissao">{{ t('financeiro.alteracaoTitulo.emissao') }}</label>
        <input id="tpa-emissao" v-model="form.emissao" type="date" required data-testid="tpa-emissao" />
      </span>
      <span class="campo">
        <label for="tpa-valor">{{ t('financeiro.alteracaoTitulo.valorDocumento') }}</label>
        <input
          id="tpa-valor"
          v-model.number="form.valorDocumento"
          type="number"
          min="0.01"
          step="0.01"
          required
          data-testid="tpa-valor"
        />
      </span>
      <span class="campo">
        <label for="tpa-referente">{{ t('financeiro.alteracaoTitulo.referente') }}</label>
        <input id="tpa-referente" v-model="form.referente" maxlength="60" data-testid="tpa-referente" />
      </span>
      <span class="campo">
        <label for="tpa-observacao">{{ t('financeiro.alteracaoTitulo.observacao') }}</label>
        <input id="tpa-observacao" v-model="form.observacao" maxlength="100" data-testid="tpa-observacao" />
      </span>
      <fieldset data-testid="tpa-parcelas">
        <legend>{{ t('financeiro.alteracaoTitulo.parcelas') }}</legend>
        <span v-for="(p, i) in form.parcelas" :key="i" class="campo">
          <label :for="`tpa-venc-${i + 1}`">{{
            t('financeiro.alteracaoTitulo.vencimento', { n: i + 1 })
          }}</label>
          <input
            :id="`tpa-venc-${i + 1}`"
            v-model="p.vencimento"
            type="date"
            required
            :data-testid="`tpa-venc-${i + 1}`"
          />
          <label :for="`tpa-valor-${i + 1}`">{{ t('financeiro.alteracaoTitulo.valor', { n: i + 1 }) }}</label>
          <input
            :id="`tpa-valor-${i + 1}`"
            v-model.number="p.valor"
            type="number"
            min="0.01"
            step="0.01"
            required
            :data-testid="`tpa-valor-${i + 1}`"
          />
        </span>
        <button type="button" data-testid="tpa-mais" @click="maisParcela">
          {{ t('financeiro.alteracaoTitulo.maisParcela') }}
        </button>
        <button
          type="button"
          :disabled="form.parcelas.length <= 1"
          data-testid="tpa-menos"
          @click="menosParcela"
        >
          {{ t('financeiro.alteracaoTitulo.menosParcela') }}
        </button>
        <p data-testid="tpa-soma">
          {{ t('financeiro.alteracaoTitulo.soma', { soma: reais(conferencia.soma) }) }}
        </p>
      </fieldset>
      <span class="campo">
        <label for="tpa-justificativa">{{ t('financeiro.alteracaoTitulo.justificativa') }}</label>
        <input
          id="tpa-justificativa"
          v-model="form.justificativa"
          maxlength="500"
          :required="faltaJustificativa"
          :aria-invalid="faltaJustificativa"
          data-testid="tpa-justificativa"
        />
      </span>
      <button type="submit" :disabled="!podeEnviar" data-testid="tpa-gravar">
        {{ t('financeiro.alteracaoTitulo.gravar') }}
      </button>
    </form>
    <p v-if="aviso" role="alert" data-testid="tpa-aviso">{{ aviso }}</p>
    <p v-else-if="nadaMudou" class="secundario" data-testid="tpa-aviso">
      {{ t('financeiro.alteracaoTitulo.avisos.nadaMudou') }}
    </p>
    <ErroFaturamento v-if="erro" :erro="erro" />
  </section>
</template>
