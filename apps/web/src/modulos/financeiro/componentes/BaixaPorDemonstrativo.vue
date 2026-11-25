<script setup lang="ts">
// Baixa dos títulos pelo demonstrativo de pagamento importado da operadora (F3.8, 07-FIN linha 76). Escolhido o
// demonstrativo, a prévia mostra o que cada título recebe e o que fica glosado; um botão baixa tudo de uma vez, com o
// recebido e a glosa por item da conta (em vez de item a item).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { baixarDemonstrativo, lerPreviaDaBaixa, listarDemonstrativosImportados } from '../api-acordos.js';
import { novaChave } from '../api-financeiro.js';
import { data, opcoesContas, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarFinanceiro();
const podeBaixar = computed(() => tem('financeiro.tituloReceber.baixar'));
const lista = useQuery({
  queryKey: ['financeiro', 'demonstrativos-importados'],
  queryFn: () => listarDemonstrativosImportados(),
  retry: false,
});
const escolhido = ref('');
const opcoes = computed(() => [
  { valor: '', rotulo: t('financeiro.escolha') },
  ...(lista.data.value ?? []).map((d) => ({
    valor: String(d.id),
    rotulo: `${d.convenio} — ${d.numero} (${data(d.emissao)}, ${reais(d.liberado)})${
      d.baixado ? ` · ${t('financeiro.acordos.baixa.jaBaixado')}` : ''
    }`,
  })),
]);
const previa = useQuery({
  queryKey: computed(() => ['financeiro', 'demonstrativos-importados', 'previa', Number(escolhido.value)]),
  queryFn: () => lerPreviaDaBaixa(Number(escolhido.value)),
  enabled: computed(() => !!escolhido.value),
});
const contas = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.escolha')));
const form = reactive({ conta: '', data: new Date().toISOString().slice(0, 10) });
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function baixar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await baixarDemonstrativo(
      Number(escolhido.value),
      { conta: Number(form.conta), dataRecebimento: form.data },
      novaChave('baixa-demonstrativo'),
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
  <section aria-labelledby="bxd-titulo" data-testid="fin-baixa-demonstrativo">
    <h2 id="bxd-titulo">{{ t('financeiro.acordos.baixa.titulo') }}</h2>
    <p class="secundario">{{ t('financeiro.acordos.baixa.texto') }}</p>
    <p v-if="lista.error.value" class="secundario" data-testid="bxd-indisponivel">
      {{ t('financeiro.acordos.baixa.indisponivel') }}
    </p>
    <p v-else-if="lista.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <p v-else-if="!lista.data.value?.length">{{ t('financeiro.acordos.baixa.nenhum') }}</p>
    <form v-else class="formulario" data-testid="bxd-formulario" @submit.prevent="baixar">
      <span class="campo">
        <SanteSelecao
          v-model="escolhido"
          :rotulo="t('financeiro.acordos.baixa.demonstrativo')"
          :opcoes="opcoes"
          data-testid="bxd-demonstrativo"
        />
      </span>
      <ErroFaturamento v-if="previa.error.value" :erro="previa.error.value" />
      <p v-else-if="escolhido && previa.isLoading.value">{{ t('financeiro.carregando') }}</p>
      <template v-else-if="escolhido && previa.data.value">
        <p v-if="previa.data.value.impedimento" role="alert" data-testid="bxd-impedimento">
          {{ previa.data.value.impedimento.mensagem }}
        </p>
        <template v-else-if="previa.data.value.plano">
          <table class="tabela" data-testid="bxd-previa">
            <thead>
              <tr>
                <th scope="col">{{ t('financeiro.acordos.baixa.numeroTitulo') }}</th>
                <th scope="col">{{ t('financeiro.acordos.baixa.saldo') }}</th>
                <th scope="col">{{ t('financeiro.acordos.baixa.recebido') }}</th>
                <th scope="col">{{ t('financeiro.acordos.baixa.glosa') }}</th>
                <th scope="col">{{ t('financeiro.acordos.baixa.saldoRestante') }}</th>
                <th scope="col">{{ t('financeiro.acordos.baixa.itens') }}</th>
                <th scope="col">{{ t('financeiro.acordos.baixa.quita') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in previa.data.value.plano.titulos" :key="x.titulo">
                <td>{{ x.numero }} ({{ x.documento }})</td>
                <td>{{ reais(x.saldo) }}</td>
                <td>{{ reais(x.recebido) }}</td>
                <td>{{ reais(x.glosa) }}</td>
                <td>{{ reais(x.saldoRestante) }}</td>
                <td>{{ x.itens }}</td>
                <td>
                  {{ x.quita ? t('financeiro.acordos.baixa.sim') : t('financeiro.acordos.baixa.nao') }}
                </td>
              </tr>
            </tbody>
          </table>
          <p data-testid="bxd-totais">
            {{
              t('financeiro.acordos.baixa.totais', {
                recebido: reais(previa.data.value.plano.totalRecebido),
                glosa: reais(previa.data.value.plano.totalGlosa),
              })
            }}
          </p>
          <p v-if="previa.data.value.plano.linhasSemTitulo" class="secundario" data-testid="bxd-sem-titulo">
            {{
              t('financeiro.acordos.baixa.semTitulo', {
                linhas: previa.data.value.plano.linhasSemTitulo,
                valor: reais(previa.data.value.plano.valorSemTitulo),
              })
            }}
          </p>
          <span class="campo">
            <SanteSelecao
              v-model="form.conta"
              :rotulo="t('financeiro.acordos.baixa.conta')"
              :opcoes="contas"
              data-testid="bxd-conta"
            />
          </span>
          <span class="campo">
            <label for="bxd-data">{{ t('financeiro.acordos.baixa.data') }}</label>
            <input id="bxd-data" v-model="form.data" type="date" required data-testid="bxd-data" />
          </span>
          <button type="submit" :disabled="gravando || !form.conta || !podeBaixar" data-testid="bxd-baixar">
            {{ t('financeiro.acordos.baixa.baixar') }}
          </button>
          <p v-if="!podeBaixar" class="secundario">{{ t('financeiro.acordos.baixa.semPermissao') }}</p>
        </template>
      </template>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="bxd-mensagem" />
  </section>
</template>
