<script setup lang="ts">
// Meu holerite (M53.3, etapa F2; `pessoas.autoatendimento.ler`, só o próprio; leve para o celular): as linhas do próprio
// vínculo no cálculo em vigor da competência, em vencimentos, descontos e bases, com a conta do líquido impressa
// (vencimentos − descontos = líquido). Os encargos da empresa não aparecem. Desligada a folha, só a frase de onde
// consultar. O vínculo vem da rota (o "Meu espaço" passa o escolhido); o servidor recusa vínculo que não é do login.
import type { LinhaCalculoFolha } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import ErroPessoas from '../../pessoas/componentes/ErroPessoas.vue';
import { competenciasAte, instanteBr, rotuloCompetencia } from '../comum-folha.js';
import { lerMeuHolerite, urlMeuHoleritePdf } from './api-calculo.js';
import { quantidadeDaLinha, reais } from './comum-calculo.js';

const { t } = useI18n();
const rota = useRoute();
const vinculo = computed(() => {
  const v = Number(rota?.query?.vinculo);
  return Number.isInteger(v) && v > 0 ? v : null;
});
const competencia = ref<string | null>(null);
const holerite = useQuery({
  queryKey: computed(() => ['folha', 'meu-holerite', vinculo.value, competencia.value]),
  queryFn: () => lerMeuHolerite({ competencia: competencia.value, vinculo: vinculo.value }),
});
const h = computed(() => holerite.data.value ?? null);
watch(h, (x) => {
  if (x && competencia.value === null) competencia.value = x.competencia;
});
const opcoesCompetencia = computed(() =>
  h.value ? competenciasAte(h.value.hoje, 24).map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) })) : [],
);
const doTipo = (tipo: LinhaCalculoFolha['tipo']) => (h.value?.linhas ?? []).filter((l) => l.tipo === tipo);
const vencimentos = computed(() => doTipo('provento'));
const descontos = computed(() => doTipo('desconto'));
const bases = computed(() => [...doTipo('base'), ...doTipo('informativa')]);
const papel = (p: string) => t(`folha.calculo.papeis.${p}`);
const imprimir = () => window.print();
</script>

<template>
  <section class="tela-pessoas holerite" aria-labelledby="holerite-titulo" data-testid="tela-meu-holerite">
    <h1 id="holerite-titulo">{{ t('folha.calculo.holerite.titulo') }}</h1>
    <p class="nao-imprimir">
      <RouterLink to="/pessoas/meu">{{ t('folha.calculo.holerite.voltar') }}</RouterLink>
    </p>
    <ErroPessoas v-if="holerite.isError.value" :erro="holerite.error.value" />
    <p v-else-if="!h" role="status">{{ t('folha.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!h.disponivel"
        :texto="h.mensagem ?? ''"
        variante="info"
        data-testid="holerite-indisponivel"
      />
      <template v-else>
        <div class="campos nao-imprimir">
          <SanteSelecao
            v-model="competencia"
            :rotulo="t('folha.calculo.holerite.competencia')"
            :opcoes="opcoesCompetencia"
            busca
            data-testid="holerite-competencia"
          />
        </div>
        <p v-if="h.vinculo === null" data-testid="holerite-sem-vinculo">
          {{ t('folha.calculo.holerite.semVinculo') }}
        </p>
        <p v-else-if="!h.calculado" data-testid="holerite-nao-calculado">
          {{ t('folha.calculo.holerite.naoCalculado') }}
        </p>
        <template v-else>
          <p class="secundario" data-testid="holerite-cabecalho">
            {{ rotuloCompetencia(h.competencia) }}
            <template v-if="h.matricula"> · {{ t('folha.matricula', { m: h.matricula }) }}</template>
            <template v-if="h.calculadoEm">
              · {{ t('folha.calculo.holerite.calculadoEm', { em: instanteBr(h.calculadoEm) }) }}</template
            >
          </p>
          <table class="tabela" data-testid="holerite-linhas">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.calculo.memoria.rubrica') }}</th>
                <th scope="col">{{ t('folha.calculo.holerite.descricao') }}</th>
                <th scope="col">{{ t('folha.calculo.holerite.referencia') }}</th>
                <th scope="col">{{ t('folha.calculo.holerite.vencimentos') }}</th>
                <th scope="col">{{ t('folha.calculo.holerite.descontos') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in vencimentos" :key="l.papel" :data-testid="`holerite-linha-${l.papel}`">
                <td>{{ l.codigoRubrica ?? '' }}</td>
                <th scope="row">{{ papel(l.papel) }}</th>
                <td>{{ quantidadeDaLinha(l) }}</td>
                <td>{{ reais(l.valor) }}</td>
                <td></td>
              </tr>
              <tr v-for="l in descontos" :key="l.papel" :data-testid="`holerite-linha-${l.papel}`">
                <td>{{ l.codigoRubrica ?? '' }}</td>
                <th scope="row">{{ papel(l.papel) }}</th>
                <td>{{ quantidadeDaLinha(l) }}</td>
                <td></td>
                <td>{{ reais(l.valor) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colspan="3">
                  {{ t('folha.calculo.holerite.totalVencimentos') }} /
                  {{ t('folha.calculo.holerite.totalDescontos') }}
                </th>
                <td data-testid="holerite-total-vencimentos">{{ reais(h.proventos) }}</td>
                <td data-testid="holerite-total-descontos">{{ reais(h.descontos) }}</td>
              </tr>
            </tfoot>
          </table>
          <p class="liquido" data-testid="holerite-liquido">
            {{ t('folha.calculo.holerite.liquido') }}:
            <strong>{{ reais(h.liquido) }}</strong>
            <span class="secundario">
              ({{
                t('folha.calculo.holerite.conta', {
                  vencimentos: reais(h.proventos),
                  descontos: reais(h.descontos),
                  liquido: reais(h.liquido),
                })
              }})
            </span>
          </p>
          <table v-if="bases.length" class="tabela" data-testid="holerite-bases">
            <caption class="secundario">
              {{
                t('folha.calculo.holerite.bases')
              }}
            </caption>
            <tbody>
              <tr v-for="l in bases" :key="l.papel">
                <th scope="row">{{ papel(l.papel) }}</th>
                <td>{{ reais(l.valor) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="acoes nao-imprimir">
            <SanteBotao
              :rotulo="t('folha.calculo.holerite.imprimir')"
              variante="secundario"
              data-testid="holerite-imprimir"
              @acionar="imprimir"
            />
            <a
              :href="urlMeuHoleritePdf(h.competencia, h.vinculo)"
              target="_blank"
              rel="noopener"
              data-testid="holerite-pdf"
              >{{ t('folha.calculo.holerite.pdf') }}</a
            >
          </div>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
.holerite {
  max-width: 48rem;
}
.liquido {
  font-size: 1.125rem;
}
@media print {
  .nao-imprimir {
    display: none;
  }
}
</style>
