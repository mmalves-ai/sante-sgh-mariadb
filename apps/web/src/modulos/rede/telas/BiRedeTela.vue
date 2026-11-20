<script setup lang="ts">
// BI consolidado da Rede (M57, etapa 3; ficha, seção 7) — `Relatórios e BI > BI consolidado da Rede`: os indicadores
// com a mesma ficha técnica em todos os estabelecimentos (o valor da Rede é Σ numeradores ÷ Σ denominadores, com a
// parte de cada estabelecimento e a conta à vista; regra 8), a série de cada um com a planilha, o painel operacional e
// o financeiro da Rede, quem entrou no consolidado e o modo do pseudônimo do data mart (regra 9). Só agregados: nenhum
// dado de paciente, e a diretoria da Rede não abre prontuário (regra 10).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { formatarMes, formatarValor } from '../../internacao/formato.js';
import { lerBiRede, lerPainelBiRede, type PeriodoBi } from '../api-bi-rede.js';
import EstabelecimentosBiRede from '../componentes/EstabelecimentosBiRede.vue';
import PainelBiRede from '../componentes/PainelBiRede.vue';
import SerieBiRede from '../componentes/SerieBiRede.vue';

const { t } = useI18n();
const vista = ref<'indicadores' | 'operacional' | 'financeiro'>('indicadores');
const de = ref('');
const ate = ref('');
const pedido = ref<PeriodoBi>({});
function aplicar(): void {
  pedido.value = { ...(de.value ? { de: de.value } : {}), ...(ate.value ? { ate: ate.value } : {}) };
}

const bi = useQuery({
  queryKey: computed(() => ['biRede', 'indicadores', pedido.value]),
  queryFn: () => lerBiRede(pedido.value),
  enabled: computed(() => vista.value === 'indicadores'),
});
const painel = useQuery({
  queryKey: computed(() => ['biRede', 'painel', vista.value, pedido.value]),
  queryFn: () => lerPainelBiRede(vista.value as 'operacional' | 'financeiro', pedido.value),
  enabled: computed(() => vista.value !== 'indicadores'),
});
const b = computed(() => bi.data.value);
const incluidos = computed(() => (b.value?.estabelecimentos ?? []).filter((e) => e.situacao === 'incluido'));
const aberto = ref<string | null>(null);
const parcela = (i: NonNullable<typeof b.value>['indicadores'][number], cod: string) =>
  i.ultimo?.parcelas.find((p) => p.estabelecimento === cod) ?? null;
const abas = ['indicadores', 'operacional', 'financeiro'] as const;
</script>

<template>
  <section class="tela" aria-labelledby="bi-rede-titulo" data-testid="tela-bi-rede">
    <h1 id="bi-rede-titulo">{{ t('biRede.titulo') }}</h1>
    <p>{{ t('biRede.subtitulo') }}</p>
    <nav class="abas" :aria-label="t('biRede.abas.rotulo')">
      <SanteBotao
        v-for="a in abas"
        :key="a"
        :rotulo="t(`biRede.abas.${a}`)"
        :variante="vista === a ? 'primario' : 'texto'"
        :aria-pressed="vista === a"
        :data-testid="`aba-bi-rede-${a}`"
        @acionar="vista = a"
      />
      <RouterLink to="/relatorios/bi/rede/servicos" data-testid="link-servicos-rede">{{
        t('biRede.abas.servicos')
      }}</RouterLink>
    </nav>
    <form class="linha" @submit.prevent="aplicar">
      <label for="bi-rede-de">{{ t('biRede.periodo.de') }}</label>
      <input id="bi-rede-de" v-model="de" type="month" min="2020-01" />
      <label for="bi-rede-ate">{{ t('biRede.periodo.ate') }}</label>
      <input id="bi-rede-ate" v-model="ate" type="month" min="2020-01" />
      <SanteBotao :rotulo="t('biRede.periodo.aplicar')" tipo="submit" data-testid="bi-rede-aplicar" />
    </form>

    <template v-if="vista === 'indicadores'">
      <MensagemErro v-if="bi.isError.value" :erro="bi.error.value" />
      <p v-else-if="!b">{{ t('biRede.carregando') }}</p>
      <template v-else>
        <p role="status" data-testid="bi-rede-periodo">
          {{ t('biRede.periodo.texto', { de: formatarMes(b.periodo.de), ate: formatarMes(b.periodo.ate) }) }}
        </p>
        <EstabelecimentosBiRede :estabelecimentos="b.estabelecimentos" />
        <p data-testid="bi-rede-pseudonimo">
          {{ t('biRede.pseudonimo.rotulo', { modo: t(`biRede.pseudonimo.modos.${b.pseudonimo}`) }) }}
        </p>
        <ul class="notas">
          <li v-for="n in b.notas" :key="n">{{ n }}</li>
        </ul>
        <table data-testid="bi-rede-tabela">
          <caption>
            {{
              t('biRede.indicadores.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('biRede.indicadores.indicador') }}</th>
              <th scope="col">{{ t('biRede.indicadores.rede') }}</th>
              <th v-for="e in incluidos" :key="e.codigo" scope="col">{{ e.nome }}</th>
              <th scope="col">{{ t('biRede.indicadores.conta') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i in b.indicadores"
              :key="i.ficha.codigo"
              :data-testid="`bi-rede-ind-${i.ficha.codigo}`"
            >
              <th scope="row">
                <SanteBotao
                  :rotulo="i.ficha.nome"
                  variante="texto"
                  :aria-label="t('biRede.indicadores.abrir', { nome: i.ficha.nome })"
                  :data-testid="`bi-rede-abrir-${i.ficha.codigo}`"
                  @acionar="aberto = i.ficha.codigo"
                />
              </th>
              <td>
                <template v-if="i.recusa">—</template>
                <template v-else>
                  {{ formatarValor(i.ultimo?.valor ?? null, i.ficha.unidade) }}
                  <span v-if="i.ultimo" class="secundario">({{ formatarMes(i.ultimo.periodo) }})</span>
                </template>
              </td>
              <td v-for="e in incluidos" :key="e.codigo">
                {{ parcela(i, e.codigo) ? formatarValor(parcela(i, e.codigo)!.valor, i.ficha.unidade) : '—' }}
              </td>
              <td class="conta">
                <span v-if="i.recusa" :data-testid="`bi-rede-recusa-${i.ficha.codigo}`">{{
                  t(`biRede.recusas.${i.recusa.motivo}`)
                }}</span>
                <span v-else>{{ i.ultimo?.conta ?? t('biRede.indicadores.semValor') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <SerieBiRede v-if="aberto" :codigo="aberto" :periodo="pedido" @fechar="aberto = null" />
      </template>
    </template>
    <template v-else>
      <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
      <p v-else-if="!painel.data.value">{{ t('biRede.carregando') }}</p>
      <template v-else>
        <p role="status">
          {{
            t('biRede.periodo.texto', {
              de: formatarMes(painel.data.value.periodo.de),
              ate: formatarMes(painel.data.value.periodo.ate),
            })
          }}
        </p>
        <EstabelecimentosBiRede :estabelecimentos="painel.data.value.estabelecimentos" />
        <SanteAlerta v-for="n in painel.data.value.notas" :key="n" :texto="n" variante="info" />
        <PainelBiRede :painel="painel.data.value" />
      </template>
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
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
caption {
  text-align: left;
  font-weight: 600;
}
.secundario {
  color: var(--sgh-texto-secundario);
}
.notas {
  font-size: var(--sgh-fonte-pequena);
}
.conta {
  font-variant-numeric: tabular-nums;
}
</style>
