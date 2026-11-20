<script setup lang="ts">
// "Consulta de valor vigente" (M12, ficha seção 7; cap-11 §11.3): quanto vale este item neste contrato nesta
// data, com a cadeia (convênio → tabela da conta → item → vigência de maior data até a data-base) e a
// explicação do modelo de valor. O sistema novo não calcula a conta (o motor é o do SPDATA).
import type { ValorVigente } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { consultarValor, listarConvenios } from '../api-precos.js';

const { t } = useI18n();
const convenios = useQuery({
  queryKey: ['convenios', '', 'todos'],
  queryFn: () => listarConvenios('', 'todos'),
});
const q = reactive({ convenio: '', tipo: 'honorario', conta: 'externa', item: '', data: '' });
const opcoesConvenio = computed(() =>
  (convenios.data.value?.itens ?? []).map((c) => ({
    valor: String(c.codigo),
    rotulo: `${c.codigo} — ${c.nome}`,
  })),
);
const opcoesTipo = computed(() =>
  ['honorario', 'diaria', 'matmed'].map((x) => ({ valor: x, rotulo: t(`precos.consulta.tipos.${x}`) })),
);
const opcoesConta = computed(() =>
  ['externa', 'internacao'].map((x) => ({ valor: x, rotulo: t(`precos.consulta.contas.${x}`) })),
);
const resultado = ref<ValorVigente | null>(null);
const erro = ref<unknown>(null);
const faltaConvenio = ref(false);
async function consultar(): Promise<void> {
  erro.value = null;
  // O convênio é obrigatório (antes garantido pelo required do select nativo).
  faltaConvenio.value = q.convenio === '';
  if (faltaConvenio.value) return;
  try {
    resultado.value = await consultarValor({
      convenio: Number(q.convenio),
      tipo: q.tipo,
      conta: q.conta,
      item: Number(q.item),
      data: q.data || null,
    });
  } catch (e) {
    erro.value = e;
  }
}
const dinheiro = (v: number | null) =>
  v === null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
</script>

<template>
  <section class="tela" aria-labelledby="valor-titulo">
    <h1 id="valor-titulo">{{ t('precos.consulta.titulo') }}</h1>
    <p>{{ t('precos.consulta.texto') }}</p>
    <form class="filtros" data-testid="form-consulta-valor" @submit.prevent="consultar">
      <div class="campo">
        <SanteSelecao
          id="valor-convenio"
          v-model="q.convenio"
          obrigatorio
          :rotulo="t('precos.comum.convenio')"
          :opcoes="opcoesConvenio"
          data-testid="valor-convenio"
        />
      </div>
      <div class="campo">
        <SanteSelecao
          id="valor-tipo"
          v-model="q.tipo"
          :rotulo="t('precos.consulta.tipo')"
          :opcoes="opcoesTipo"
        />
      </div>
      <div class="campo">
        <SanteSelecao
          id="valor-conta"
          v-model="q.conta"
          :rotulo="t('precos.consulta.conta')"
          :opcoes="opcoesConta"
        />
      </div>
      <div class="campo">
        <label for="valor-item">{{ t('precos.consulta.item') }}</label>
        <input id="valor-item" v-model="q.item" inputmode="numeric" required data-testid="valor-item" />
      </div>
      <div class="campo">
        <label for="valor-data">{{ t('precos.comum.data') }}</label>
        <input
          id="valor-data"
          v-model="q.data"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('precos.comum.dataAjuda')"
          data-testid="valor-data"
        />
      </div>
      <SanteBotao :rotulo="t('precos.consulta.consultar')" tipo="submit" data-testid="valor-consultar" />
    </form>
    <p v-if="faltaConvenio" role="alert" data-testid="valor-falta-convenio">
      {{ t('precos.consulta.escolhaConvenio') }}
    </p>
    <MensagemErro v-if="erro" :erro="erro" />
    <section v-if="resultado" aria-labelledby="valor-resultado" data-testid="resultado-valor">
      <h2 id="valor-resultado">{{ t('precos.consulta.resultado', { data: resultado.dataBase }) }}</h2>
      <p class="total" data-testid="valor-total">{{ dinheiro(resultado.total) }}</p>
      <p v-if="resultado.modelo">
        {{ t('precos.consulta.modelo', { modelo: t(`precos.honorarios.modelos.${resultado.modelo}`) }) }}
      </p>
      <p v-if="resultado.estimativaPeloModelo !== null" data-testid="valor-estimativa">
        {{ t('precos.consulta.estimativa', { valor: dinheiro(resultado.estimativaPeloModelo) }) }}
      </p>
      <p v-if="resultado.item">{{ resultado.item.codigo }} — {{ resultado.item.nome }}</p>
      <ol>
        <li v-for="p in resultado.passos" :key="p">{{ p }}</li>
      </ol>
      <p v-if="resultado.falta.length > 0">
        {{ t('precos.consulta.semValor', { falta: resultado.falta.join(', ') }) }}
      </p>
    </section>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.total {
  font-size: 1.5em;
  font-weight: 700;
}
input,
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
