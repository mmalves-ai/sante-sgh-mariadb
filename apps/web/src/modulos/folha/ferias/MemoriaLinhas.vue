<script setup lang="ts">
// A memória de um recibo (férias ou parcela do 13º de um colaborador; M53.4): as linhas por tipo (proventos, descontos,
// bases e informativos) com a rubrica, a quantidade, o valor e a conta, e a prova do líquido com as parcelas impressas.
import { type LinhaCalculoFolha, TIPOS_LINHA_FOLHA } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { quantidadeDaLinha, reais, somaDoTipo } from '../calculo/comum-calculo.js';

const props = defineProps<{ linhas: readonly LinhaCalculoFolha[]; prefixo: string }>();
const { t } = useI18n();
const grupos = computed(() =>
  TIPOS_LINHA_FOLHA.map((tipo) => ({ tipo, itens: props.linhas.filter((l) => l.tipo === tipo) })).filter(
    (g) => g.itens.length > 0,
  ),
);
const proventos = computed(() => somaDoTipo(props.linhas, 'provento'));
const descontos = computed(() => somaDoTipo(props.linhas, 'desconto'));
const papel = (p: string) => t(`folha.calculo.papeis.${p}`);
</script>

<template>
  <div
    class="rolagem"
    tabindex="0"
    role="region"
    :aria-label="t('folha.calculo.memoria.titulo')"
    :data-testid="`${prefixo}-memoria`"
  >
    <section v-for="g in grupos" :key="g.tipo" :aria-label="t(`folha.calculo.memoria.tipos.${g.tipo}`)">
      <h4>{{ t(`folha.calculo.memoria.tipos.${g.tipo}`) }}</h4>
      <table class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('folha.calculo.memoria.papel') }}</th>
            <th scope="col">{{ t('folha.calculo.memoria.rubrica') }}</th>
            <th scope="col">{{ t('folha.calculo.memoria.quantidade') }}</th>
            <th scope="col">{{ t('folha.calculo.memoria.valor') }}</th>
            <th scope="col">{{ t('folha.calculo.memoria.conta') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in g.itens" :key="l.papel" :data-testid="`${prefixo}-linha-${l.papel}`">
            <th scope="row">{{ papel(l.papel) }}</th>
            <td>{{ l.codigoRubrica ?? '' }}</td>
            <td>{{ quantidadeDaLinha(l) }}</td>
            <td>{{ reais(l.valor) }}</td>
            <td class="secundario">{{ l.memoria }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <p :data-testid="`${prefixo}-prova`">
      {{ t('folha.calculo.memoria.liquido') }}:
      {{
        t('folha.calculo.prova.conta', {
          proventos: reais(proventos),
          descontos: reais(descontos),
          liquido: reais(proventos - descontos),
        })
      }}
    </p>
  </div>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
