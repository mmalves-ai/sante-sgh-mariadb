<script setup lang="ts">
// Lançamento automático por regra (ficha do M30, seção 7): `/faturamento/lancamento-automatico`. O que os lançamentos
// automáticos puseram na conta na competência, por origem (estoque, exames, internação, recepção), e a fila dos
// lançamentos feitos com a conta já fechada, apresentada ou emitida (regra 5: nunca somem), com a decisão.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { decidirTardio, lerPainel, novaChave } from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { competenciaAtual, data, reais, usarFaturamento } from '../usar-faturamento.js';

const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivoFuncionalidade, apoio } = usarFaturamento();
const { permissoes } = usarSessao();
const podeVerExcecoes = computed(() => permissoes.value.has('faturamento.regra.ler'));
const competencia = ref('');
const comp = computed(() => competencia.value || competenciaAtual(apoio.data.value?.hoje));
const p = useQuery({
  queryKey: computed(() => ['faturamento', 'painel', comp.value]),
  queryFn: () => lerPainel(comp.value),
});
const decisao = ref<Record<number, string>>({});
const opcoesDecisao = computed(() =>
  (['reabrir', 'complementar', 'descartar'] as const).map((d) => ({
    valor: d as string,
    rotulo: t(`faturamento.automatico.${d}`),
  })),
);
const motivo = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
async function decidir(r: number) {
  erro.value = null;
  mensagem.value = null;
  try {
    const x = await decidirTardio(
      r,
      { decisao: decisao.value[r] ?? 'complementar', motivo: motivo.value[r] ?? '' },
      novaChave('tardio'),
    );
    mensagem.value = x.mensagem;
    avisos.value = x.avisos;
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="aut-titulo" data-testid="tela-faturamento-automatico">
    <h1 id="aut-titulo">{{ t('faturamento.automatico.titulo') }}</h1>
    <p>{{ t('faturamento.automatico.texto') }}</p>
    <p class="secundario">{{ t('faturamento.regua') }}</p>
    <p v-if="podeVerExcecoes">
      <RouterLink to="/faturamento/lancamento-automatico/excecoes" data-testid="aut-excecoes">{{
        t('excecaoRegra.titulo')
      }}</RouterLink>
    </p>
    <div class="filtros">
      <span class="campo"
        ><label for="aut-comp">{{ t('faturamento.competencia') }}</label
        ><input id="aut-comp" v-model="competencia" type="month"
      /></span>
    </div>
    <AvisoFaturamento :motivo="motivoFuncionalidade('lancamentoTardio')" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="aut-mensagem" />
    <ErroFaturamento v-if="p.error.value" :erro="p.error.value" />
    <p v-else-if="!p.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="aut-origens">
        <caption>
          {{
            t('faturamento.automatico.porOrigem')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.origem') }}</th>
            <th scope="col">{{ t('faturamento.quantidade') }}</th>
            <th scope="col">{{ t('faturamento.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in p.data.value.porOrigem" :key="o.veio">
            <td>{{ o.rotulo }}</td>
            <td>{{ o.itens }}</td>
            <td>{{ reais(o.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <h2>
        {{ t('faturamento.automatico.fila') }}
        <span class="secundario"
          >· {{ t('faturamento.automatico.pendentes', { n: p.data.value.pendentesDecisao }) }}</span
        >
      </h2>
      <p>{{ t('faturamento.automatico.filaTexto') }}</p>
      <table class="tabela" data-testid="aut-fila">
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.automatico.registro') }}</th>
            <th scope="col">{{ t('faturamento.data') }}</th>
            <th scope="col">{{ t('faturamento.contaRotulo') }}</th>
            <th scope="col">{{ t('faturamento.paciente') }}</th>
            <th scope="col">{{ t('faturamento.automatico.decisao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="p.data.value.tardios.length === 0">
            <td colspan="5">{{ t('faturamento.nenhum') }}</td>
          </tr>
          <tr v-for="x in p.data.value.tardios" :key="x.registro" :data-testid="`aut-tardio-${x.registro}`">
            <td>{{ x.registro }}</td>
            <td>{{ data(x.data) }}</td>
            <td>
              <RouterLink v-if="x.conta" :to="`/faturamento/contas/${x.conta}`">{{ x.conta }}</RouterLink> ·
              {{ x.contaSituacao }}
            </td>
            <td>{{ x.paciente }}</td>
            <td>
              <span v-if="x.decisao" :data-testid="`aut-decisao-${x.registro}`"
                >{{ t(`faturamento.automatico.${x.decisao}`) }} · {{ x.decididoPor }}</span
              >
              <form v-else-if="pode('decidirTardio')" class="filtros" @submit.prevent="decidir(x.registro)">
                <SanteSelecao
                  :model-value="decisao[x.registro] ?? 'complementar'"
                  @update:model-value="(v) => (decisao[x.registro] = String(v))"
                  :rotulo="t('faturamento.automatico.decisao')"
                  ocultar-rotulo
                  :opcoes="opcoesDecisao"
                  :data-testid="`aut-d-${x.registro}`"
                />
                <label :for="`aut-m-${x.registro}`" class="sr-only">{{ t('faturamento.motivo') }}</label>
                <input
                  :id="`aut-m-${x.registro}`"
                  v-model="motivo[x.registro]"
                  :placeholder="t('faturamento.motivo')"
                  maxlength="250"
                  :data-testid="`aut-m-${x.registro}`"
                />
                <button type="submit" :data-testid="`aut-decidir-${x.registro}`">
                  {{ t('faturamento.automatico.decidir') }}
                </button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
