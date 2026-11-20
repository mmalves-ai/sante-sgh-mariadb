<script setup lang="ts">
// Aba Tabelas legais (M53.2; regra 7: tabela legal com vigência, nunca constante no código): a vigência em vigor na
// competência com as faixas do IRRF (com a dedução por dependente, o desconto simplificado e a redução da lei de 2026),
// do INSS (com o teto), do salário-família, o salário mínimo e o contribuinte individual; a conferência das faixas; as
// vigências cadastradas; e os dias de afastamento a cargo da empresa, com a mesma vigência pela data de competência. Valores em centavos e alíquotas em centésimos de ponto, formatados aqui.
import type { ConferenciaTabelaLegal } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerTabelasLegais } from './api-rubricas.js';
import { dataBr, percentual, reais } from './comum-rubricas.js';

const props = defineProps<{ competencia: string }>();
const emit = defineEmits<{ abrirCadastro: [] }>();
const { t } = useI18n();
const consulta = useQuery({
  queryKey: computed(() => ['folha', 'tabelas-legais', props.competencia]),
  queryFn: () => lerTabelasLegais(props.competencia),
});
const dados = computed(() => consulta.data.value ?? null);
const v = computed(() => dados.value?.vigente ?? null);
const temReducao = computed(() => {
  const r = v.value?.irrf.reducao;
  return !!r && (r.isencaoAte > 0 || r.valor > 0 || r.reducaoAte > 0);
});
const ate = (x: number | null) => (x === null ? t('rubricasFolha.tabelas.semLimite') : reais(x));
const textoConferencia = (c: ConferenciaTabelaLegal) =>
  t(`rubricasFolha.conferenciaTabela.${c.codigo}`, {
    tabela: t(`rubricasFolha.tabelas.${c.tabela}`),
    faixa: c.faixa === null ? '' : ` (${t('rubricasFolha.tabelas.faixaN', { n: c.faixa + 1 })})`,
  });
</script>

<template>
  <section class="bloco" aria-labelledby="aba-tabelas-titulo" data-testid="aba-tabelas-legais">
    <h2 id="aba-tabelas-titulo">{{ t('rubricasFolha.abas.tabelas') }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!dados" role="status">{{ t('rubricasFolha.carregando') }}</p>
    <template v-else>
      <p class="secundario">{{ t('rubricasFolha.referencia', { data: dataBr(dados.dataReferencia) }) }}</p>
      <SanteAlerta
        v-if="!v"
        :texto="t('rubricasFolha.tabelas.semVigente')"
        variante="aviso"
        data-testid="tabelas-sem-vigente"
      />
      <template v-else>
        <p data-testid="tabelas-vigente">
          {{ t('rubricasFolha.tabelas.vigenteDesde', { data: dataBr(v.inicio) }) }}
        </p>
        <div data-testid="tabelas-conferencia">
          <p v-if="dados.conferencia.length === 0">{{ t('rubricasFolha.tabelas.semDivergencia') }}</p>
          <template v-else>
            <h3>{{ t('rubricasFolha.tabelas.divergencias', { n: dados.conferencia.length }) }}</h3>
            <ul>
              <li
                v-for="(c, i) in dados.conferencia"
                :key="`${c.codigo}-${c.tabela}-${i}`"
                data-testid="tabelas-divergencia"
              >
                {{ textoConferencia(c) }}
              </li>
            </ul>
          </template>
        </div>

        <h3>{{ t('rubricasFolha.tabelas.irrf') }}</h3>
        <table class="tabela" data-testid="tabela-irrf">
          <thead>
            <tr>
              <th scope="col">{{ t('rubricasFolha.tabelas.faixa') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.de') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.ate') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.aliquota') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.deducao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(f, i) in v.irrf.faixas" :key="i">
              <td>{{ i + 1 }}</td>
              <td>{{ reais(f.de) }}</td>
              <td>{{ ate(f.ate) }}</td>
              <td>{{ percentual(f.aliquota) }}</td>
              <td>{{ reais(f.deducao) }}</td>
            </tr>
          </tbody>
        </table>
        <dl class="dados">
          <dt>{{ t('rubricasFolha.tabelas.deducaoDependente') }}</dt>
          <dd>{{ reais(v.irrf.deducaoDependente) }}</dd>
          <dt>{{ t('rubricasFolha.tabelas.descontoSimplificado') }}</dt>
          <dd>{{ reais(v.irrf.descontoSimplificado) }}</dd>
          <dt>{{ t('rubricasFolha.tabelas.reducao') }}</dt>
          <dd v-if="!temReducao">{{ t('rubricasFolha.tabelas.semReducao') }}</dd>
          <dd v-else data-testid="tabelas-reducao">
            {{
              t('rubricasFolha.tabelas.reducaoTexto', {
                isencao: reais(v.irrf.reducao.isencaoAte),
                de: reais(v.irrf.reducao.reducaoDe),
                ate: reais(v.irrf.reducao.reducaoAte),
                valor: reais(v.irrf.reducao.valor),
                acima: reais(v.irrf.reducao.semReducaoAcimaDe),
              })
            }}
          </dd>
        </dl>

        <h3>{{ t('rubricasFolha.tabelas.inss') }}</h3>
        <table class="tabela" data-testid="tabela-inss">
          <thead>
            <tr>
              <th scope="col">{{ t('rubricasFolha.tabelas.faixa') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.de') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.ate') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.aliquota') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.deducao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(f, i) in v.inss.faixas" :key="i">
              <td>{{ i + 1 }}</td>
              <td>{{ reais(f.de) }}</td>
              <td>{{ ate(f.ate) }}</td>
              <td>{{ percentual(f.aliquota) }}</td>
              <td>{{ reais(f.deducao) }}</td>
            </tr>
          </tbody>
        </table>
        <dl class="dados">
          <dt>{{ t('rubricasFolha.tabelas.teto') }}</dt>
          <dd>{{ reais(v.inss.teto) }}</dd>
        </dl>

        <h3>{{ t('rubricasFolha.tabelas.salarioFamilia') }}</h3>
        <table class="tabela" data-testid="tabela-salario-familia">
          <thead>
            <tr>
              <th scope="col">{{ t('rubricasFolha.tabelas.de') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.ate') }}</th>
              <th scope="col">{{ t('rubricasFolha.tabelas.cota') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(f, i) in v.salarioFamilia" :key="i">
              <td>{{ reais(f.de) }}</td>
              <td>{{ reais(f.ate) }}</td>
              <td>{{ reais(f.cota) }}</td>
            </tr>
          </tbody>
        </table>

        <dl class="dados" data-testid="tabelas-gerais">
          <dt>{{ t('rubricasFolha.tabelas.salarioMinimo') }}</dt>
          <dd>{{ reais(v.salarioMinimo) }}</dd>
          <dt>{{ t('rubricasFolha.tabelas.contribuinteIndividual') }}</dt>
          <dd>
            {{ percentual(v.contribuinteIndividual.aliquota) }} · {{ t('rubricasFolha.tabelas.teto') }}
            {{ reais(v.contribuinteIndividual.teto) }}
          </dd>
        </dl>
      </template>
      <h3>{{ t('rubricasFolha.tabelas.afastamento') }}</h3>
      <div data-testid="tabelas-afastamento">
        <p v-if="dados.afastamento.vigente">
          {{
            t('rubricasFolha.tabelas.afastamentoVigente', {
              dias: dados.afastamento.vigente.dias,
              data: dataBr(dados.afastamento.vigente.inicio),
            })
          }}
        </p>
        <p v-else>{{ t('rubricasFolha.tabelas.afastamentoSemVigente') }}</p>
        <ul v-if="dados.afastamento.vigencias.length > 0">
          <li v-for="x in dados.afastamento.vigencias" :key="x.inicio">
            {{ t('rubricasFolha.tabelas.afastamentoItem', { dias: x.dias, data: dataBr(x.inicio) }) }}
          </li>
        </ul>
      </div>
      <h3>{{ t('rubricasFolha.tabelas.vigencias') }}</h3>
      <ul data-testid="tabelas-vigencias">
        <li v-for="x in dados.vigencias" :key="x">{{ dataBr(x) }}</li>
      </ul>
      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('rubricasFolha.tabelas.abrirCadastro')"
          data-testid="tabelas-abrir-cadastro"
          @acionar="emit('abrirCadastro')"
        />
      </div>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
h3 {
  font-size: 1rem;
  margin: 0;
}
</style>
