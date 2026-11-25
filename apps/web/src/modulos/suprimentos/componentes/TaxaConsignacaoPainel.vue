<script setup lang="ts">
// Taxa de comercialização do consignado por faixa de valor (05-SUP linha 24), uma aba da tela dos consignados: a tabela
// vigente do fornecedor escolhido (ou a geral), o cálculo na hora de um valor com as parcelas impressas, a tabela nova
// com a validação na hora (cada faixa começa onde a anterior termina: só se digita o "até" e o percentual) e o
// histórico, que nunca some. O servidor confere tudo de novo na gravação.
import {
  calcularTaxaConsignacao,
  conferirTabelaTaxaConsignacao,
  type FaixaTaxaConsignacaoEntrada,
} from '@sgh/dominio-suprimentos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { gravarTabelaTaxaConsignacao, lerTabelasTaxaConsignacao } from '../api-taxa-consignacao.js';
import { novaChaveM464 } from '../api-consignado.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ fornecedor: number | null; podeRegistrar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({
  queryKey: computed(() => ['consignado-taxa', props.fornecedor]),
  queryFn: () => lerTabelasTaxaConsignacao(props.fornecedor),
});
const dados = computed(() => consulta.data.value ?? null);
const reais = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;

// ── Cálculo na hora ──
const valor = ref<number | null>(null);
const calculo = computed(() =>
  dados.value && valor.value !== null && valor.value >= 0
    ? calcularTaxaConsignacao(dados.value.vigentes, props.fornecedor, valor.value, dados.value.hoje)
    : null,
);

// ── Tabela nova ──
interface LinhaForm {
  ate: number | null;
  percentual: number | null;
  teto: number | null;
}
const form = reactive<{ inicio: string; linhas: LinhaForm[] }>({
  inicio: '',
  linhas: [{ ate: null, percentual: null, teto: null }],
});
watch(
  () => dados.value?.hoje,
  (h) => {
    if (h && !form.inicio) form.inicio = h;
  },
  { immediate: true },
);
/** O campo numérico vazio (o v-model.number devolve '') conta como nulo. */
const numero = (v: unknown): number | null => (v === '' || v === null || v === undefined ? null : Number(v));
const faixasDoForm = computed<FaixaTaxaConsignacaoEntrada[]>(() =>
  form.linhas.map((l, i) => ({
    valorInicial: i === 0 ? 0 : (numero(form.linhas[i - 1]!.ate) ?? 0),
    valorFinal: numero(l.ate),
    percentual: numero(l.percentual) ?? Number.NaN,
    teto: numero(l.teto),
  })),
);
const recusas = computed(() =>
  dados.value
    ? conferirTabelaTaxaConsignacao(
        { fornecedor: props.fornecedor, inicio: form.inicio, faixas: faixasDoForm.value },
        dados.value.hoje,
      )
    : [],
);
const mensagem = ref('');
const erro = ref<unknown>(null);
const enviando = ref(false);
let chave = novaChaveM464('taxa');

async function gravar(): Promise<void> {
  if (recusas.value.length) return;
  enviando.value = true;
  erro.value = null;
  mensagem.value = '';
  try {
    const r = await gravarTabelaTaxaConsignacao(
      { fornecedor: props.fornecedor, inicio: form.inicio, faixas: faixasDoForm.value },
      chave,
    );
    chave = novaChaveM464('taxa');
    mensagem.value = t('consignado.taxa.gravada', { n: r.ids.length });
    form.linhas = [{ ate: null, percentual: null, teto: null }];
    await cliente.invalidateQueries({ queryKey: ['consignado-taxa'] });
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="cartao" aria-labelledby="consig-taxa-titulo" data-testid="consig-taxa">
    <h2 id="consig-taxa-titulo">{{ t('consignado.abas.taxas') }}</h2>
    <ErroSuprimentos v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!dados" role="status">{{ t('consignado.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        :variante="dados.origem === 'sem-tabela' ? 'aviso' : 'info'"
        :texto="
          dados.origem === 'fornecedor'
            ? t('consignado.taxa.vigenteFornecedor')
            : dados.origem === 'geral'
              ? t('consignado.taxa.vigenteGeral')
              : t('consignado.taxa.semTabela')
        "
        data-testid="consig-taxa-origem"
      />
      <div v-if="dados.vigentes.length" class="rolagem">
        <table class="grade" data-testid="consig-taxa-vigente">
          <thead>
            <tr>
              <th scope="col">{{ t('consignado.taxa.colDe') }}</th>
              <th scope="col">{{ t('consignado.taxa.colAte') }}</th>
              <th scope="col">{{ t('consignado.taxa.colPercentual') }}</th>
              <th scope="col">{{ t('consignado.taxa.colTeto') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in dados.vigentes" :key="f.id">
              <td>{{ reais(f.valorInicial) }}</td>
              <td>{{ f.valorFinal === null ? t('consignado.taxa.semFim') : reais(f.valorFinal) }}</td>
              <td>{{ f.percentual }}</td>
              <td>{{ f.teto === null ? t('consignado.taxa.semTeto') : reais(f.teto) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>{{ t('consignado.taxa.simular') }}</h3>
      <span class="campo">
        <label for="consig-taxa-valor">{{ t('consignado.taxa.valor') }}</label>
        <input
          id="consig-taxa-valor"
          v-model.number="valor"
          type="number"
          min="0"
          step="0.01"
          data-testid="consig-taxa-valor"
        />
      </span>
      <p v-if="calculo" role="status" data-testid="consig-taxa-calculo">
        {{
          calculo.faixa
            ? t('consignado.taxa.calculo', {
                de: reais(calculo.faixa.valorInicial),
                ate:
                  calculo.faixa.valorFinal === null
                    ? t('consignado.taxa.semFim')
                    : reais(calculo.faixa.valorFinal),
                percentual: calculo.percentual,
                valor: reais(calculo.valor),
                bruta: reais(calculo.taxaBruta),
                teto: calculo.teto === null ? t('consignado.taxa.semTeto') : reais(calculo.teto),
                taxa: reais(calculo.taxa),
                total: reais(calculo.total),
              })
            : t('consignado.taxa.calculoSem', { total: reais(calculo.total) })
        }}
      </p>

      <h3>{{ t('consignado.taxa.nova') }}</h3>
      <p class="secundario">
        {{
          t('consignado.taxa.novaPara', {
            escopo:
              fornecedor === null ? t('consignado.taxa.escopoGeral') : t('consignado.taxa.escopoFornecedor'),
          })
        }}
      </p>
      <span class="campo">
        <label for="consig-taxa-inicio">{{ t('consignado.taxa.inicio') }}</label>
        <input
          id="consig-taxa-inicio"
          v-model="form.inicio"
          type="date"
          :min="dados.hoje"
          data-testid="consig-taxa-inicio"
        />
      </span>
      <div v-for="(l, i) in form.linhas" :key="i" class="barra" :data-testid="`consig-taxa-linha-${i}`">
        <span class="campo">
          <span>{{ t('consignado.taxa.colDe') }}</span>
          <strong>{{ reais(faixasDoForm[i]!.valorInicial) }}</strong>
        </span>
        <span class="campo">
          <label :for="`consig-taxa-ate-${i}`">{{ t('consignado.taxa.ate') }}</label>
          <input
            :id="`consig-taxa-ate-${i}`"
            v-model.number="l.ate"
            type="number"
            min="0"
            step="0.01"
            :data-testid="`consig-taxa-ate-${i}`"
          />
        </span>
        <span class="campo">
          <label :for="`consig-taxa-pct-${i}`">{{ t('consignado.taxa.colPercentual') }}</label>
          <input
            :id="`consig-taxa-pct-${i}`"
            v-model.number="l.percentual"
            type="number"
            min="0"
            max="1000"
            step="0.0001"
            :data-testid="`consig-taxa-pct-${i}`"
          />
        </span>
        <span class="campo">
          <label :for="`consig-taxa-teto-${i}`">{{ t('consignado.taxa.colTeto') }}</label>
          <input
            :id="`consig-taxa-teto-${i}`"
            v-model.number="l.teto"
            type="number"
            min="0.01"
            step="0.01"
            :data-testid="`consig-taxa-teto-${i}`"
          />
        </span>
        <SanteBotao
          v-if="form.linhas.length > 1"
          variante="secundario"
          :rotulo="t('consignado.taxa.remover', { n: i + 1 })"
          :data-testid="`consig-taxa-remover-${i}`"
          @acionar="form.linhas.splice(i, 1)"
        />
      </div>
      <SanteBotao
        variante="secundario"
        :rotulo="t('consignado.taxa.adicionar')"
        data-testid="consig-taxa-adicionar"
        @acionar="form.linhas.push({ ate: null, percentual: null, teto: null })"
      />
      <ul v-if="recusas.length" class="alerta" data-testid="consig-taxa-recusas">
        <li v-for="(r, i) in recusas" :key="i">{{ r.mensagem }}</li>
      </ul>
      <ErroSuprimentos v-if="erro" :erro="erro" />
      <p v-if="mensagem" role="status" data-testid="consig-taxa-mensagem">{{ mensagem }}</p>
      <SanteBotao
        :rotulo="t('consignado.taxa.gravar')"
        :desabilitado="enviando || !podeRegistrar || recusas.length > 0"
        data-testid="consig-taxa-gravar"
        @acionar="gravar"
      />

      <h3>{{ t('consignado.taxa.historico') }}</h3>
      <p v-if="dados.historico.length === 0">{{ t('consignado.taxa.historicoVazio') }}</p>
      <div v-else class="rolagem">
        <table class="grade" data-testid="consig-taxa-historico">
          <thead>
            <tr>
              <th scope="col">{{ t('consignado.taxa.colVigencia') }}</th>
              <th scope="col">{{ t('consignado.taxa.colDe') }}</th>
              <th scope="col">{{ t('consignado.taxa.colAte') }}</th>
              <th scope="col">{{ t('consignado.taxa.colPercentual') }}</th>
              <th scope="col">{{ t('consignado.taxa.colTeto') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in dados.historico" :key="f.id">
              <td>
                {{
                  t('consignado.taxa.vigencia', {
                    inicio: dia(f.inicio),
                    fim: f.fim ? dia(f.fim) : t('consignado.taxa.semFim'),
                  })
                }}
              </td>
              <td>{{ reais(f.valorInicial) }}</td>
              <td>{{ f.valorFinal === null ? t('consignado.taxa.semFim') : reais(f.valorFinal) }}</td>
              <td>{{ f.percentual }}</td>
              <td>{{ f.teto === null ? t('consignado.taxa.semTeto') : reais(f.teto) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
