<script setup lang="ts">
// Pagamentos eletrônicos (ficha do M32, seção 7): `/financeiro/pagar/remessas`. A remessa dos títulos aprovados, no
// leiaute CNAB 240 ou pela API do banco; fora de produção vai ao simulador, que devolve o retorno. O arquivo fica
// guardado com a impressão digital (Object Lock); a credencial do banco nunca aparece.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import TabelaRegistros from '../componentes/TabelaRegistros.vue';
import { gerarRemessa, lerFilaAprovacao, listarRemessas, novaChave } from '../api-financeiro.js';
import { data, opcoesContas, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, gravacao, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const fila = useQuery({ queryKey: ['financeiro', 'aprovacao', 60], queryFn: () => lerFilaAprovacao(60) });
const aprovados = computed(() =>
  (fila.data.value ?? []).filter((x) => x.feitas >= x.exigidas && x.exigidas > 0),
);
const remessas = useQuery({ queryKey: ['financeiro', 'remessas'], queryFn: () => listarRemessas() });
const marcados = reactive(new Set<number>());
const form = reactive({ conta: '', leiaute: 'cnab240' as 'cnab240' | 'api' });
const contas = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.escolha')));
const leiautes = [
  { valor: 'cnab240', rotulo: 'CNAB 240' },
  { valor: 'api', rotulo: 'API' },
];
const colunas = [
  { chave: 'SEQUENCIAL', rotulo: 'financeiro.registros.sequencial' },
  { chave: 'ID_TBCTABAN', rotulo: 'financeiro.conta' },
  { chave: 'LEIAUTE', rotulo: 'financeiro.remessas.leiaute' },
  { chave: 'TITULOS', rotulo: 'financeiro.borderos.titulos' },
  { chave: 'VALOR_TOTAL', rotulo: 'financeiro.valor', formato: 'reais' as const },
  { chave: 'DESTINO', rotulo: 'financeiro.registros.destino' },
  { chave: 'SITUACAO', rotulo: 'financeiro.situacao' },
  { chave: 'OCORRENCIAS', rotulo: 'financeiro.registros.ocorrencias' },
  { chave: 'GERADO_EM', rotulo: 'financeiro.registros.geradoEm', formato: 'quando' as const },
];
function alternar(id: number) {
  if (marcados.has(id)) marcados.delete(id);
  else marcados.add(id);
}
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function gerar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await gerarRemessa(
      { conta: Number(form.conta), titulos: [...marcados], leiaute: form.leiaute },
      novaChave('remessa'),
    );
    mensagem.value = r.mensagem;
    marcados.clear();
    await qc.invalidateQueries({ queryKey: ['financeiro', 'remessas'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rm-titulo" data-testid="tela-fin-remessas">
    <h1 id="rm-titulo">{{ t('financeiro.remessas.titulo') }}</h1>
    <p>{{ t('financeiro.remessas.texto') }}</p>
    <p>
      <RouterLink to="/cadastros/dominios/grupo/financeiroRemessa" data-testid="remessas-cadastros">
        {{ t('financeiro.tabelasDoItem') }}
      </RouterLink>
    </p>
    <p>
      <RouterLink to="/financeiro/pagar/pagamento-eletronico" data-testid="remessas-pagamento-eletronico">
        {{ t('financeiro.pagamentoEletronico.atalho') }}
      </RouterLink>
    </p>
    <p
      v-if="gravacao.data.value?.destinoExterno === 'simulador'"
      class="secundario"
      data-testid="rm-simulador"
    >
      {{ t('financeiro.simulador') }}
    </p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('contasPagar')" />
    <table v-if="aprovados.length" class="tabela" data-testid="rm-aprovados">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.marcar') }}</th>
          <th scope="col">{{ t('financeiro.credor') }}</th>
          <th scope="col">{{ t('financeiro.documento') }}</th>
          <th scope="col">{{ t('financeiro.vencimento') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in aprovados" :key="x.id">
          <td>
            <input
              type="checkbox"
              :checked="marcados.has(x.id)"
              :aria-label="`${t('financeiro.marcar')} ${x.documento}/${x.parcela}`"
              :data-testid="`rm-marcar-${x.id}`"
              @change="alternar(x.id)"
            />
          </td>
          <td>{{ x.credor }} — {{ x.credorNome }}</td>
          <td>{{ x.documento }}/{{ x.parcela }}</td>
          <td>{{ data(x.vencimento) }}</td>
          <td>{{ reais(x.valor) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
    <form class="filtros" @submit.prevent="gerar">
      <span class="campo">
        <SanteSelecao
          v-model="form.conta"
          :rotulo="t('financeiro.conta')"
          :opcoes="contas"
          obrigatorio
          data-testid="rm-conta"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.leiaute"
          :rotulo="t('financeiro.remessas.leiaute')"
          :opcoes="leiautes"
          data-testid="rm-leiaute"
        />
      </span>
      <button
        type="submit"
        :disabled="gravando || marcados.size === 0 || !form.conta || !pode('gerarRemessa')"
        data-testid="rm-gerar"
      >
        {{ t('financeiro.remessas.gerar') }}
      </button>
    </form>
    <p v-if="!pode('gerarRemessa')" class="secundario">{{ motivo('gerarRemessa') }}</p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="rm-mensagem" />
    <h2>{{ t('financeiro.remessas.geradas') }}</h2>
    <ErroFaturamento v-if="remessas.error.value" :erro="remessas.error.value" />
    <TabelaRegistros v-else :registros="remessas.data.value ?? []" :colunas="colunas" testid="rm-lista" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
