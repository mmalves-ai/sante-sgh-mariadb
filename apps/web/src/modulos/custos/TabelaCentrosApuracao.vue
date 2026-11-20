<script setup lang="ts">
// Custo por centro da apuração (M54, etapa 5): a classe e o termo filtram; cada linha traz o custo direto, os rateios
// recebidos, o repassado, o custo final, a produção e o custo unitário; "Ver as parcelas" abre o direto por grupo (com as
// despesas gerais), os rateios recebidos pelo nome de quem repartiu, o repasse pelo critério e a receita do centro.
import type { LinhaApuracaoCentro } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type FiltroClasseApuracao,
  filtrarLinhas,
  quantidadeCent,
  reais,
  rotuloEstatistica,
  somaEmReais,
  textoProducao,
  textoRecebidos,
} from './comum-apuracao.js';

const props = defineProps<{ linhas: readonly LinhaApuracaoCentro[] }>();
const { t } = useI18n();

const classe = ref<FiltroClasseApuracao>('todas');
const termo = ref('');
const opcoesClasse = computed(() => [
  { valor: 'todas' as FiltroClasseApuracao, rotulo: t('custos.apuracao.centros.todas') },
  ...(['produtivo', 'auxiliar', 'administrativo'] as const).map((c) => ({
    valor: c as FiltroClasseApuracao,
    rotulo: t(`custos.apuracao.classes.${c}`),
  })),
]);
const visiveis = computed(() => filtrarLinhas(props.linhas, classe.value, termo.value));
const nomes = computed(() => new Map(props.linhas.map((l) => [l.centro, `${l.codigo} ${l.nome}`])));
const nomeDe = (c: number) => nomes.value.get(c) ?? String(c);
const aberta = ref<number | null>(null);
const alternar = (c: number) => (aberta.value = aberta.value === c ? null : c);
const parcelasDireto = (l: LinhaApuracaoCentro) =>
  somaEmReais([l.direto.pessoal, l.direto.materiais, l.direto.despesas, l.despesasGerais]);
</script>

<template>
  <section class="bloco" :aria-label="t('custos.apuracao.centros.titulo')" data-testid="apuracao-centros">
    <h2>{{ t('custos.apuracao.centros.titulo') }}</h2>
    <div class="campos">
      <SanteSelecao
        v-model="classe"
        :rotulo="t('custos.apuracao.centros.filtroClasse')"
        :opcoes="opcoesClasse"
        data-testid="apuracao-filtro-classe"
      />
      <label class="campo-numero">
        <span>{{ t('custos.apuracao.centros.filtroTermo') }}</span>
        <input v-model="termo" type="search" maxlength="60" data-testid="apuracao-filtro-termo" />
      </label>
    </div>
    <p class="secundario" role="status" data-testid="apuracao-contagem">
      {{ t('custos.apuracao.centros.contagem', { n: visiveis.length, total: linhas.length }) }}
    </p>
    <p v-if="visiveis.length === 0">{{ t('custos.apuracao.centros.nenhum') }}</p>
    <div v-else class="rolagem">
      <table class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('custos.apuracao.centros.colunas.codigo') }}</th>
            <th scope="col">{{ t('custos.apuracao.centros.colunas.nome') }}</th>
            <th scope="col">{{ t('custos.apuracao.centros.colunas.classe') }}</th>
            <th scope="col" class="numero">{{ t('custos.apuracao.centros.colunas.direto') }}</th>
            <th scope="col" class="numero">{{ t('custos.apuracao.centros.colunas.recebido') }}</th>
            <th scope="col" class="numero">{{ t('custos.apuracao.centros.colunas.repassado') }}</th>
            <th scope="col" class="numero">{{ t('custos.apuracao.centros.colunas.final') }}</th>
            <th scope="col" class="numero">{{ t('custos.apuracao.centros.colunas.producao') }}</th>
            <th scope="col" class="numero">{{ t('custos.apuracao.centros.colunas.unitario') }}</th>
            <th scope="col">{{ t('custos.apuracao.centros.colunas.detalhe') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="l in visiveis" :key="l.centro">
            <tr :data-testid="`apuracao-centro-${l.codigo}`">
              <td>{{ l.codigo }}</td>
              <td>{{ l.nome }}</td>
              <td>{{ t(`custos.apuracao.classes.${l.classe}`) }}</td>
              <td class="numero">{{ reais(l.diretoTotal) }}</td>
              <td class="numero">{{ reais(l.recebidoTotal) }}</td>
              <td class="numero">{{ reais(l.repassado) }}</td>
              <td class="numero">{{ reais(l.custoFinal) }}</td>
              <td class="numero">{{ textoProducao(l.producao) ?? '—' }}</td>
              <td class="numero">{{ l.custoUnitario === null ? '—' : reais(l.custoUnitario) }}</td>
              <td>
                <SanteBotao
                  :rotulo="
                    aberta === l.centro
                      ? t('custos.apuracao.centros.fechar')
                      : t('custos.apuracao.centros.ver')
                  "
                  variante="texto"
                  :aria-expanded="aberta === l.centro"
                  :data-testid="`apuracao-ver-${l.codigo}`"
                  @acionar="alternar(l.centro)"
                />
              </td>
            </tr>
            <tr v-if="aberta === l.centro" :data-testid="`apuracao-parcelas-${l.codigo}`">
              <td colspan="10">
                <p>{{ t('custos.apuracao.centros.parcelasDireto', { conta: parcelasDireto(l) }) }}</p>
                <template v-if="l.recebidos.length">
                  <p>{{ t('custos.apuracao.centros.parcelasRecebidos') }}</p>
                  <ul>
                    <li v-for="r in textoRecebidos(l, nomeDe).itens" :key="r.de">
                      {{ r.de }}: {{ r.valor }}
                    </li>
                  </ul>
                </template>
                <p v-else>{{ t('custos.apuracao.centros.semRecebidos') }}</p>
                <p v-if="l.repassado">
                  {{
                    t('custos.apuracao.centros.repassou', {
                      valor: reais(l.repassado),
                      criterio: rotuloEstatistica(l.criterio),
                      base: l.baseCriterioCent === null ? '—' : quantidadeCent(l.baseCriterioCent),
                    })
                  }}
                </p>
                <p v-if="l.naoRateado">
                  {{ t('custos.apuracao.centros.naoRateado', { valor: reais(l.naoRateado) }) }}
                </p>
                <p>{{ t('custos.apuracao.centros.receita', { valor: reais(l.receita) }) }}</p>
                <p v-if="!l.producao">{{ t('custos.apuracao.centros.semProducao') }}</p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped src="./estilo-custos.css"></style>
