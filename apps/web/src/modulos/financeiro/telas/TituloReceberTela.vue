<script setup lang="ts">
// Título a receber (ficha do M32, seção 7): `/financeiro/receber/titulos/:id`. As contas do título, a glosa somada dos
// itens, o saldo mostrado (valor − recebido − glosa aceita) e a baixa manual, com o motivo, pela conta do escopo.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import GlosaDoTitulo from '../componentes/GlosaDoTitulo.vue';
import PortadorDoTitulo from '../componentes/PortadorDoTitulo.vue';
import RetencaoSofridaTitulo from '../componentes/RetencaoSofridaTitulo.vue';
import { baixaManual, lerTituloReceber, novaChave } from '../api-financeiro.js';
import { data, opcoesContas, reais, usarFinanceiro } from '../usar-financeiro.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo } = usarFinanceiro();
const n = computed(() => Number(props.id));
const titulo = useQuery({
  queryKey: computed(() => ['financeiro', 'receber', 'titulo', n.value]),
  queryFn: () => lerTituloReceber(n.value),
});
const contas = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.escolha')));
const formas = computed(() =>
  (apoio.data.value?.formasPagamento ?? []).map((f) => ({
    valor: String(f.codigo),
    rotulo: `${f.codigo} — ${f.nome}`,
  })),
);
const form = reactive({ conta: '', dataRecebimento: '', valorRecebido: '', formaPagamento: '1', motivo: '' });
watch(
  () => [apoio.data.value?.hoje, titulo.data.value?.saldo] as const,
  ([h, s]) => {
    if (h && !form.dataRecebimento) form.dataRecebimento = h;
    if (s !== undefined && !form.valorRecebido) form.valorRecebido = String(s);
  },
  { immediate: true },
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function baixar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await baixaManual(
      n.value,
      {
        versao: titulo.data.value?.versao ?? null,
        conta: Number(form.conta),
        dataRecebimento: form.dataRecebimento,
        valorRecebido: Number(String(form.valorRecebido).replace(',', '.')),
        formaPagamento: Number(form.formaPagamento),
        motivo: form.motivo,
      },
      novaChave('baixa-manual'),
    );
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="trd-titulo" data-testid="tela-fin-titulo-receber">
    <h1 id="trd-titulo">{{ t('financeiro.receber.detalhe') }} {{ id }}</h1>
    <RouterLink to="/financeiro/receber/titulos">{{ t('financeiro.voltar') }}</RouterLink>
    <RouterLink
      :to="`/financeiro/gerencial/reclassificar?alvo=titulo_receber&id=${id}`"
      data-testid="trd-reclassificar"
      >{{ t('financeiro.gestao.reclassificar.titulo') }}</RouterLink
    >
    <ErroFaturamento v-if="titulo.error.value" :erro="titulo.error.value" />
    <p v-else-if="titulo.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <template v-else-if="titulo.data.value">
      <dl class="resumo" data-testid="trd-resumo">
        <dt>{{ t('financeiro.receber.devedor') }}</dt>
        <dd>{{ titulo.data.value.devedor }} — {{ titulo.data.value.nome }}</dd>
        <dt>{{ t('financeiro.convenio') }}</dt>
        <dd>{{ titulo.data.value.convenio }}</dd>
        <dt>{{ t('financeiro.documento') }}</dt>
        <dd>{{ titulo.data.value.documento }}</dd>
        <dt>{{ t('financeiro.vencimento') }}</dt>
        <dd>{{ data(titulo.data.value.vencimento) }}</dd>
        <dt>{{ t('financeiro.valor') }}</dt>
        <dd>{{ reais(titulo.data.value.valor) }}</dd>
        <dt>{{ t('financeiro.situacao') }}</dt>
        <dd data-testid="trd-situacao">
          {{ t(`financeiro.situacoesReceber.${titulo.data.value.situacao}`) }}
        </dd>
      </dl>
      <h2>{{ t('financeiro.receber.contasLigadas') }}</h2>
      <ul data-testid="trd-contas">
        <li v-for="c in titulo.data.value.contasLigadas" :key="c.id">
          {{ c.id }} ({{ c.tipo }}, {{ c.competencia }}): {{ reais(c.total) }}
        </li>
      </ul>
      <GlosaDoTitulo :titulo="titulo.data.value" />
      <!-- F8, 07-FIN linha 79: com quem cada parcela está (carteira, banco ou cessionário) e a operação. -->
      <PortadorDoTitulo :titulo="n" />
      <RouterLink :to="`/financeiro/receber/demonstrativos?titulo=${id}`" data-testid="trd-glosa">
        {{ t('financeiro.demonstrativos.registrar') }}
      </RouterLink>
      <!-- F3.8, 07-FIN linha 109: o tributo retido pelo tomador entra antes da baixa; o dinheiro a receber é o que sobra. -->
      <RetencaoSofridaTitulo
        :titulo="n"
        :data="form.dataRecebimento"
        :pode="pode('baixarManual')"
        @saldo="(s) => (form.valorRecebido = String(s))"
      />
      <form
        v-if="titulo.data.value.situacao !== 'recebido'"
        class="formulario"
        data-testid="trd-baixa"
        @submit.prevent="baixar"
      >
        <h2>{{ t('financeiro.receber.baixaManual') }}</h2>
        <span class="campo">
          <SanteSelecao
            v-model="form.conta"
            :rotulo="t('financeiro.conta')"
            :opcoes="contas"
            obrigatorio
            data-testid="trd-conta"
          />
        </span>
        <span class="campo">
          <label for="trd-data">{{ t('financeiro.receber.dataRecebimento') }}</label>
          <input id="trd-data" v-model="form.dataRecebimento" type="date" required data-testid="trd-data" />
        </span>
        <span class="campo">
          <label for="trd-valor">{{ t('financeiro.receber.valorRecebido') }}</label>
          <input
            id="trd-valor"
            v-model="form.valorRecebido"
            inputmode="decimal"
            required
            data-testid="trd-valor"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.formaPagamento"
            :rotulo="t('financeiro.borderos.formaPagamento')"
            :opcoes="formas"
            data-testid="trd-forma"
          />
        </span>
        <span class="campo">
          <label for="trd-motivo">{{ t('financeiro.motivo') }}</label>
          <input id="trd-motivo" v-model="form.motivo" maxlength="100" required data-testid="trd-motivo" />
        </span>
        <button type="submit" :disabled="gravando || !pode('baixarManual')" data-testid="trd-baixar">
          {{ t('financeiro.receber.baixar') }}
        </button>
        <p v-if="!pode('baixarManual')" class="secundario">{{ motivo('baixarManual') }}</p>
      </form>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="trd-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
