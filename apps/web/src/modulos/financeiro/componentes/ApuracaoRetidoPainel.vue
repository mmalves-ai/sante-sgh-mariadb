<script setup lang="ts">
// F7, 07-FIN linha 110: a apuração do retido pelo hospital na competência. Cada recolhimento gerado no painel das
// retenções aparece aqui com a guia, o título e as parcelas por código de receita (a soma impressa ao lado do total);
// o DARF abre na própria tela com os campos 01 a 10 do modelo oficial, pronto para imprimir e conferir; o batimento
// mostra o retido da competência contra os eventos vigentes da EFD-Reinf, grupo a grupo, com a diferença. A DCTFWeb
// não é transmitida daqui: a Receita a monta pela Reinf e ela é confirmada no e-CAC.
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { type DarfGuia, lerApuracoesRetido, lerBatimentoReinf, lerDarf } from '../api-contabil-fiscal.js';

const props = defineProps<{ competencia: string }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Apuração do retido e DARF',
      texto:
        'O retido recolhido na competência, por código de receita da Receita Federal. A DCTFWeb é montada pela Receita a partir da EFD-Reinf e confirmada no e-CAC; aqui ficam o DARF para conferência e o batimento.',
      nada: 'Nenhum recolhimento gerado nesta competência.',
      tributo: 'Tributo',
      receita: 'Código de receita',
      parcelas: 'Parcelas por código',
      total: 'Total apurado',
      vencimento: 'Vencimento',
      guia: 'Guia',
      titulo_pagar: 'Título',
      darf: 'Ver DARF',
      imprimir: 'Imprimir DARF',
      fechar: 'Fechar',
      darfTitulo: 'DARF da guia {numero}',
      darfAviso: 'Documento para conferência; a guia com código de barras sai do Sicalc ou do e-CAC.',
      soma: 'soma {valor}',
      batimento: 'Batimento com a EFD-Reinf',
      grupo: 'Grupo da Reinf',
      apurado: 'Retido apurado',
      reinf: 'Informado na Reinf',
      diferenca: 'Diferença',
      confere: 'Confere',
      naoConfere: 'Não confere',
      eventos: '{n} evento(s) vigente(s) da Reinf na competência.',
      fora: 'Fora da Reinf: {lista}.',
      grupos: { irrf: 'Imposto de renda (IRRF)', csrf: 'PIS, COFINS e CSLL', inss: 'INSS' },
    },
  },
});
const valida = computed(() => /^\d{4}-\d{2}$/.test(props.competencia));
const apuracoes = useQuery({
  queryKey: computed(() => ['financeiro', 'retido-aberto', 'apuracoes', props.competencia]),
  queryFn: () => lerApuracoesRetido(props.competencia),
  enabled: valida,
});
const batimento = useQuery({
  queryKey: computed(() => ['financeiro', 'retido-aberto', 'batimento-reinf', props.competencia]),
  queryFn: () => lerBatimentoReinf(props.competencia),
  enabled: valida,
});
const darf = ref<DarfGuia | null>(null);
const erroDarf = ref<unknown>(null);
async function abrirDarf(guia: number) {
  erroDarf.value = null;
  try {
    darf.value = await lerDarf(guia);
  } catch (e) {
    darf.value = null;
    erroDarf.value = e;
  }
}
const imprimir = () => window.print();
const reais = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
</script>

<template>
  <section aria-labelledby="ar-titulo" data-testid="ar-painel">
    <h2 id="ar-titulo">{{ t('titulo') }} {{ competencia }}</h2>
    <p class="secundario">{{ t('texto') }}</p>
    <ErroFaturamento v-if="apuracoes.error.value" :erro="apuracoes.error.value" />
    <p v-else-if="!apuracoes.data.value?.length" data-testid="ar-nada">{{ t('nada') }}</p>
    <table v-else class="tabela" data-testid="ar-apuracoes">
      <thead>
        <tr>
          <th scope="col">{{ t('tributo') }}</th>
          <th scope="col">{{ t('receita') }}</th>
          <th scope="col">{{ t('parcelas') }}</th>
          <th scope="col">{{ t('total') }}</th>
          <th scope="col">{{ t('vencimento') }}</th>
          <th scope="col">{{ t('guia') }}</th>
          <th scope="col">{{ t('titulo_pagar') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('darf') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in apuracoes.data.value" :key="a.id" :data-testid="`ar-apuracao-${a.id}`">
          <th scope="row">{{ a.sigla }}</th>
          <td>{{ a.codigoReceita ?? '' }}</td>
          <td>
            <span v-for="p in a.parcelas" :key="p.codigoReceita" class="campo">
              {{ p.codigoReceita }}: {{ reais(p.valor) }} ({{ p.retencoes }})
            </span>
            <small class="secundario">{{ t('soma', { valor: reais(a.somaParcelas) }) }}</small>
          </td>
          <td>{{ reais(a.total) }}</td>
          <td>{{ a.vencimento ?? '' }}</td>
          <td>{{ a.guiaNumero ?? '' }}</td>
          <td>{{ a.titulo ?? '' }}</td>
          <td>
            <button v-if="a.guia" type="button" :data-testid="`ar-darf-${a.id}`" @click="abrirDarf(a.guia)">
              {{ t('darf') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <ErroFaturamento v-if="erroDarf" :erro="erroDarf" />
    <section v-if="darf" class="formulario" aria-labelledby="ar-darf-titulo" data-testid="ar-darf">
      <h3 id="ar-darf-titulo">{{ t('darfTitulo', { numero: darf.numero }) }}</h3>
      <p class="secundario">{{ t('darfAviso') }}</p>
      <table class="tabela" data-testid="ar-darf-campos">
        <tbody>
          <tr v-for="c in darf.campos" :key="c.numero" :data-testid="`ar-darf-${c.numero}`">
            <th scope="row">{{ c.numero }} {{ c.rotulo }}</th>
            <td>{{ c.valor }}</td>
          </tr>
        </tbody>
      </table>
      <button type="button" data-testid="ar-imprimir" @click="imprimir">{{ t('imprimir') }}</button>
      <button type="button" data-testid="ar-fechar" @click="darf = null">{{ t('fechar') }}</button>
    </section>
    <h3>{{ t('batimento') }}</h3>
    <ErroFaturamento v-if="batimento.error.value" :erro="batimento.error.value" />
    <template v-else-if="batimento.data.value">
      <p class="secundario" data-testid="ar-eventos">
        {{ t('eventos', { n: batimento.data.value.eventosReinf }) }}
      </p>
      <table v-if="batimento.data.value.linhas.length" class="tabela" data-testid="ar-batimento">
        <thead>
          <tr>
            <th scope="col">{{ t('grupo') }}</th>
            <th scope="col">{{ t('apurado') }}</th>
            <th scope="col">{{ t('reinf') }}</th>
            <th scope="col">{{ t('diferenca') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('confere') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in batimento.data.value.linhas"
            :key="l.grupo"
            :data-testid="`ar-batimento-${l.grupo}`"
          >
            <th scope="row">{{ t(`grupos.${l.grupo}`) }}</th>
            <td>{{ reais(l.apurado) }}</td>
            <td>{{ reais(l.reinf) }}</td>
            <td>{{ reais(l.diferenca) }}</td>
            <td>{{ l.confere ? t('confere') : t('naoConfere') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="batimento.data.value.foraDaReinf.length" class="secundario">
        {{ t('fora', { lista: batimento.data.value.foraDaReinf.join(', ') }) }}
      </p>
    </template>
  </section>
</template>
