<script setup lang="ts">
// Prazos de envio (ficha do M31, seção 7, painel): `/faturamento/prazos`. Por operadora, a janela de entrega do
// calendário do convênio (aberta, com os dias até fechar, ou a próxima, com os dias até abrir; a restritiva avisa que a
// fonte pagadora não recebe fora dela), o pagamento previsto, os lotes sem protocolo e os parados (sem protocolo há
// mais dias que o parâmetro) e o prazo de recurso (sem prazo cadastrado, o alerta: DP-33.9).
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerPrazos } from '../api-tiss.js';
import { data } from '../usar-tiss.js';

const { t } = useI18n();
const mes = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
const p = useQuery({ queryKey: ['tiss', 'prazos'], queryFn: () => lerPrazos() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pz-titulo" data-testid="tela-tiss-prazos">
    <h1 id="pz-titulo">{{ t('tiss.prazos.titulo') }}</h1>
    <p>{{ t('tiss.prazos.texto') }}</p>
    <p>
      <RouterLink to="/faturamento/lotes">{{ t('tiss.voltarLotes') }}</RouterLink>
    </p>
    <ErroFaturamento v-if="p.error.value" :erro="p.error.value" />
    <p v-else-if="!p.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <p v-else-if="p.data.value.length === 0">{{ t('tiss.nenhum') }}</p>
    <table v-else class="tabela" data-testid="pz-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('tiss.convenio') }}</th>
          <th scope="col">{{ t('tiss.prazos.janela') }}</th>
          <th scope="col">{{ t('tiss.prazos.pagamento') }}</th>
          <th scope="col">{{ t('tiss.prazos.semProtocolo') }}</th>
          <th scope="col">{{ t('tiss.prazos.parados') }}</th>
          <th scope="col">{{ t('tiss.prazos.maisAntigo') }}</th>
          <th scope="col">{{ t('tiss.prazos.prazoRecurso') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in p.data.value" :key="x.convenio" :data-testid="`pz-${x.convenio}`">
          <td>{{ x.convenioNome }}</td>
          <td :data-testid="`pz-janela-${x.convenio}`">
            <template v-if="x.entrega">
              {{
                t('tiss.prazos.janelaDe', {
                  inicio: data(x.entrega.inicio),
                  fim: data(x.entrega.fim),
                  competencia: mes(x.entrega.competencia),
                })
              }}
              <br />
              <strong :class="{ alerta: x.entrega.situacao === 'aberta' && x.entrega.dias <= 2 }">{{
                x.entrega.situacao === 'aberta'
                  ? t('tiss.prazos.janelaAberta', { n: x.entrega.dias })
                  : t('tiss.prazos.janelaFutura', { n: x.entrega.dias })
              }}</strong>
              <template v-if="x.entrega.restritivo">
                <br />
                <span data-testid="pz-restritivo">{{ t('tiss.prazos.restritivo') }}</span>
              </template>
            </template>
            <template v-else>{{ t('tiss.prazos.semCalendario') }}</template>
          </td>
          <td>{{ data(x.entrega?.pagamentoPrevisto ?? null) }}</td>
          <td>{{ x.lotesSemProtocolo }}</td>
          <td :class="{ alerta: x.lotesParados > 0 }">{{ x.lotesParados }}</td>
          <td>{{ data(x.maisAntigoSemProtocolo) }}</td>
          <td>
            {{
              x.prazoRecursoDias === null
                ? t('tiss.prazoNaoCadastrado')
                : t('tiss.prazos.dias', { n: x.prazoRecursoDias })
            }}
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
