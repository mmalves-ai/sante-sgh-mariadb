<script setup lang="ts">
// Painéis gerenciais (M16; ficha, seção 7; regras 12 a 14): assistencial (ao vivo, pela trajetória), operacional
// e financeiro (na cópia diária; o financeiro nas DUAS réguas, com o nome da régua, e a glosa só dos baixados).
// Cada série é um gráfico próprio (um eixo só) com a tabela dos valores.
import { PAINEIS_GERENCIAIS, type PainelGerencial } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerPainelGerencial } from '../api-internacao.js';
import GraficoSerie from '../componentes/GraficoSerie.vue';
import {
  formatarData,
  formatarDataHora,
  formatarMes,
  formatarValor,
  hojeNoEstabelecimento,
  semMovimentoRecente,
} from '../formato.js';

const props = defineProps<{ painel: string }>();
const { t } = useI18n();
const roteador = useRouter();
const atual = computed<PainelGerencial>(() =>
  (PAINEIS_GERENCIAIS as readonly string[]).includes(props.painel)
    ? (props.painel as PainelGerencial)
    : 'assistencial',
);
const abas = computed(() =>
  PAINEIS_GERENCIAIS.filter((p) => p !== 'financeiro' || pode('relatorio.financeiro.ler')),
);
const de = ref('');
const ate = ref('');
const pedido = ref<{ de?: string; ate?: string }>({});
const dados = useQuery({
  queryKey: computed(() => ['relatorio', 'painel', atual.value, pedido.value]),
  queryFn: () => lerPainelGerencial(atual.value, pedido.value.de, pedido.value.ate),
});
const aplicar = () =>
  (pedido.value = { ...(de.value ? { de: de.value } : {}), ...(ate.value ? { ate: ate.value } : {}) });
const hoje = hojeNoEstabelecimento();
const ultimo = (valores: readonly { valor: number | null; parcial: boolean }[]) =>
  [...valores].reverse().find((v) => !v.parcial && v.valor !== null)?.valor ?? null;
</script>

<template>
  <section class="tela" aria-labelledby="paineis-titulo">
    <h1 id="paineis-titulo">{{ t('internacao.paineis.titulo') }}</h1>
    <p>{{ t('internacao.paineis.texto') }}</p>
    <p v-if="pode('relatorio.bi.acessar')">
      <RouterLink to="/relatorios/bi" data-testid="link-bi">{{ t('internacao.bi.titulo') }}</RouterLink>
    </p>
    <div class="abas" role="group" :aria-label="t('internacao.paineis.titulo')">
      <SanteBotao
        v-for="p in abas"
        :key="p"
        :rotulo="t(`internacao.paineis.abas.${p}`)"
        :variante="atual === p ? 'primario' : 'secundario'"
        :aria-pressed="atual === p"
        :data-testid="`aba-${p}`"
        @acionar="roteador.push(`/relatorios/paineis/${p}`)"
      />
    </div>
    <form class="linha" @submit.prevent="aplicar">
      <label for="painel-de">{{ t('internacao.comum.de') }}</label>
      <input id="painel-de" v-model="de" type="month" min="2020-01" />
      <label for="painel-ate">{{ t('internacao.comum.ate') }}</label>
      <input id="painel-ate" v-model="ate" type="month" min="2020-01" />
      <SanteBotao :rotulo="t('internacao.comum.aplicar')" tipo="submit" />
    </form>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="dados.isPending.value">{{ t('internacao.comum.carregando') }}</p>
    <template v-else-if="dados.data.value">
      <p role="status" data-testid="painel-dados-ate">
        {{ t(`internacao.paineis.fontes.${dados.data.value.fonte}`) }} ·
        {{
          t('internacao.comum.periodo', {
            de: formatarMes(dados.data.value.periodo.de),
            ate: formatarMes(dados.data.value.periodo.ate),
          })
        }}
        · {{ t('internacao.comum.dadosAte', { quando: formatarDataHora(dados.data.value.dadosAte) }) }} ·
        {{ t('internacao.comum.mesParcial') }}
      </p>
      <SanteAlerta
        v-if="semMovimentoRecente(dados.data.value.ultimoMovimento, hoje)"
        :texto="t('internacao.comum.semMovimento', { data: formatarData(dados.data.value.ultimoMovimento) })"
        variante="aviso"
      />
      <ul class="notas">
        <li v-for="n in dados.data.value.notas" :key="n">{{ n }}</li>
      </ul>
      <div class="series">
        <section
          v-for="s in dados.data.value.series"
          :key="s.codigo"
          class="serie"
          :data-testid="`serie-${s.codigo}`"
        >
          <p class="ultimo">
            <strong>{{ s.rotulo }}</strong>
            <span v-if="s.regua">
              · {{ t('internacao.paineis.regua') }}: {{ t(`internacao.paineis.reguas.${s.regua}`) }}</span
            >
            <br />
            {{ t('internacao.paineis.ultimo', { valor: formatarValor(ultimo(s.valores), s.unidade) }) }}
          </p>
          <GraficoSerie
            :titulo="s.rotulo"
            :unidade="s.unidade"
            :series="[{ rotulo: s.rotulo, valores: s.valores }]"
          />
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.abas,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.notas {
  color: var(--sgh-texto-secundario);
}
.series {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 30rem), 1fr));
  gap: var(--sgh-espaco-3);
}
.serie {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.ultimo {
  margin: 0;
}
</style>
