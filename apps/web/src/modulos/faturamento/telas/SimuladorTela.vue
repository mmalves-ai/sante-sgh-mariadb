<script setup lang="ts">
// Simulador de preço (ficha do M30, seção 7; 06-FAT linha 11): `/faturamento/simulador`. O preço de um item para um
// convênio e uma data pelo mesmo motor do lançamento (CH e PORTE pelo índice do acordo × quantidade, no regime do tipo
// de conta, no setor e em horário especial), explicado passo a passo, e o impacto de um reajuste por alvo (índice,
// porte, porte anestésico, tabela). Somente leitura: nada é gravado.
import { SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { simular } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { data, num, reais, usarFaturamento } from '../usar-faturamento.js';

const { t } = useI18n();
const { apoio } = usarFaturamento();
const f = ref({ convenio: '', tipoConta: 'E', tipo: '3', codigo: '', quantidade: '1', data: '', setor: '' });
const especial = ref(false);
const ALVOS = ['indice', 'porte', 'porteAnestesico', 'tabela'] as const;
const CAMPO_ALVO = {
  indice: 'reajusteIndice',
  porte: 'reajustePorte',
  porteAnestesico: 'reajustePorteAnestesico',
  tabela: 'reajusteTabela',
} as const;
const reajuste = ref<Record<(typeof ALVOS)[number], string>>({
  indice: '',
  porte: '',
  porteAnestesico: '',
  tabela: '',
});
const opcoesTipoConta = computed(() => [
  { valor: 'E', rotulo: t('faturamento.externa') },
  { valor: 'I', rotulo: t('faturamento.internacao') },
]);
const opcoesGrupo = computed(() =>
  ['1', '2', '3', '4'].map((g) => ({ valor: g, rotulo: t(`faturamento.grupos.${g}`) })),
);
const r = ref<Awaited<ReturnType<typeof simular>> | null>(null);
const erro = ref<unknown>(null);
async function rodar() {
  erro.value = null;
  r.value = null;
  try {
    const pct = Object.fromEntries(
      ALVOS.map((a) => [CAMPO_ALVO[a], reajuste.value[a].trim().replace(',', '.')]),
    ) as Record<(typeof CAMPO_ALVO)[(typeof ALVOS)[number]], string>;
    r.value = await simular({
      ...f.value,
      ...pct,
      horarioEspecial: especial.value ? 'true' : '',
      data: f.value.data || apoio.data.value?.hoje || '',
    });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sim-titulo" data-testid="tela-faturamento-simulador">
    <h1 id="sim-titulo">{{ t('faturamento.simulador.titulo') }}</h1>
    <p>{{ t('faturamento.simulador.texto') }}</p>
    <form class="filtros" @submit.prevent="rodar">
      <span class="campo"
        ><label for="sim-conv">{{ t('faturamento.convenio') }}</label
        ><input id="sim-conv" v-model="f.convenio" inputmode="numeric" size="5" data-testid="sim-conv"
      /></span>
      <span class="campo">
        <SanteSelecao v-model="f.tipoConta" :rotulo="t('faturamento.tipoConta')" :opcoes="opcoesTipoConta" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="f.tipo"
          :rotulo="t('faturamento.grupo')"
          :opcoes="opcoesGrupo"
          data-testid="sim-tipo"
        />
      </span>
      <span class="campo"
        ><label for="sim-cod">{{ t('faturamento.codigo') }}</label
        ><input id="sim-cod" v-model="f.codigo" inputmode="numeric" data-testid="sim-cod"
      /></span>
      <span class="campo"
        ><label for="sim-qtd">{{ t('faturamento.quantidade') }}</label
        ><input id="sim-qtd" v-model="f.quantidade" inputmode="decimal" size="6"
      /></span>
      <span class="campo"
        ><label for="sim-data">{{ t('faturamento.data') }}</label
        ><input id="sim-data" v-model="f.data" type="date"
      /></span>
      <span class="campo"
        ><label for="sim-setor">{{ t('faturamento.simulador.setor') }}</label
        ><input id="sim-setor" v-model="f.setor" inputmode="numeric" size="6" data-testid="sim-setor"
      /></span>
      <span class="campo"
        ><input id="sim-especial" v-model="especial" type="checkbox" data-testid="sim-especial" /><label
          for="sim-especial"
          >{{ t('faturamento.simulador.horarioEspecial') }}</label
        ></span
      >
      <fieldset class="filtros" data-testid="sim-reajuste">
        <legend>{{ t('faturamento.simulador.reajusteTitulo') }}</legend>
        <p>{{ t('faturamento.simulador.reajusteTexto') }}</p>
        <span v-for="a in ALVOS" :key="a" class="campo"
          ><label :for="`sim-pct-${a}`">{{ t(`faturamento.simulador.alvos.${a}`) }}</label
          ><input
            :id="`sim-pct-${a}`"
            v-model="reajuste[a]"
            inputmode="decimal"
            size="7"
            :data-testid="`sim-pct-${a}`"
        /></span>
      </fieldset>
      <button type="submit" data-testid="sim-rodar">{{ t('faturamento.simulador.simular') }}</button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <div v-if="r" data-testid="sim-resultado">
      <p v-if="!r.encontrado">{{ t('faturamento.simulador.naoEncontrado') }}</p>
      <p v-else-if="r.falta" role="alert" data-testid="sim-falta">
        {{ r.nome }} · {{ t('faturamento.simulador.falta') }}: {{ r.falta }}
      </p>
      <p v-else-if="!r.preco">{{ r.nome }} · {{ t('faturamento.simulador.semPreco') }}</p>
      <template v-else>
        <dl>
          <dt>{{ t('faturamento.nome') }}</dt>
          <dd>{{ r.nome }}</dd>
          <dt>{{ t('faturamento.simulador.modelo') }}</dt>
          <dd>{{ r.preco.modelo }}</dd>
          <dt>{{ t('faturamento.simulador.vigencia') }}</dt>
          <dd>{{ data(r.vigencia) }}</dd>
          <dt>{{ t('faturamento.unitario') }}</dt>
          <dd data-testid="sim-unitario">{{ num(r.preco.unitario) }}</dd>
          <dt>{{ t('faturamento.valor') }}</dt>
          <dd data-testid="sim-valor">{{ reais(r.preco.valor) }}</dd>
          <template v-if="r.origem">
            <dt>{{ t('faturamento.simulador.origem') }}</dt>
            <dd data-testid="sim-origem">{{ t(`faturamento.simulador.origens.${r.origem}`) }}</dd>
          </template>
        </dl>
        <section v-if="r.passos?.length" aria-labelledby="sim-explicacao">
          <h2 id="sim-explicacao">{{ t('faturamento.simulador.explicacao') }}</h2>
          <ol data-testid="sim-passos">
            <li v-for="(p, i) in r.passos" :key="i">{{ p }}</li>
          </ol>
        </section>
        <section v-if="r.impacto" aria-labelledby="sim-impacto" data-testid="sim-impacto">
          <h2 id="sim-impacto">{{ t('faturamento.simulador.impacto') }}</h2>
          <p v-if="r.impacto.diferenca === null">{{ t('faturamento.simulador.naoFecha') }}</p>
          <p v-else-if="r.impacto.afetadoPor.length === 0" data-testid="sim-nao-afeta">
            {{ t('faturamento.simulador.naoAfeta') }}
          </p>
          <dl v-else>
            <dt>{{ t('faturamento.simulador.atual') }}</dt>
            <dd data-testid="sim-atual">{{ reais(r.impacto.atual ?? 0) }}</dd>
            <dt>{{ t('faturamento.simulador.novo') }}</dt>
            <dd data-testid="sim-novo">{{ reais(r.impacto.novo ?? 0) }}</dd>
            <dt>{{ t('faturamento.simulador.diferenca') }}</dt>
            <dd data-testid="sim-diferenca">{{ reais(r.impacto.diferenca ?? 0) }}</dd>
            <dt>{{ t('faturamento.simulador.percentual') }}</dt>
            <dd data-testid="sim-percentual">
              {{ r.impacto.percentual === null ? '—' : `${num(r.impacto.percentual)}%` }}
            </dd>
            <dt>{{ t('faturamento.simulador.afetadoPor') }}</dt>
            <dd data-testid="sim-afetado">
              {{ r.impacto.afetadoPor.map((a) => t(`faturamento.simulador.alvos.${a}`)).join(', ') }}
            </dd>
          </dl>
        </section>
      </template>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
