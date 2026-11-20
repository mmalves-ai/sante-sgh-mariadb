<script setup lang="ts">
// Painel do plano de manutenção (M55, etapa 1; regra 2): os três números (vencidas, a vencer, em dia) e a lista
// ordenada pelo servidor (vencidas primeiro, depois a vencer), com os dias de atraso ou os que faltam. Abrir leva à
// ficha do equipamento, onde a execução é registrada. W0-08 (M4): o selo do modelo pronto e o relatório do PMOC.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerPainelPlano } from '../api-manutencao.js';
import { dataBr, ROTULOS } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';
import RelatorioPmoc from './RelatorioPmoc.vue';

const emit = defineEmits<{ abrir: [number] }>();
const { t } = useI18n();
const painel = useQuery({ queryKey: ['manutencao', 'plano', 'painel'], queryFn: lerPainelPlano });
const p = computed(() => painel.data.value ?? null);
</script>

<template>
  <section class="tela-manutencao" aria-labelledby="painel-plano-titulo" data-testid="painel-plano">
    <h2 id="painel-plano-titulo">{{ t('manutencao.plano.painel.titulo') }}</h2>
    <ErroManutencao v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!p" role="status">{{ t('manutencao.carregando') }}</p>
    <template v-else>
      <div class="numeros" data-testid="painel-plano-resumo">
        <div class="numero">
          <span>{{ t('manutencao.plano.painel.vencidas') }}</span>
          <strong class="vencido" data-testid="painel-vencidas">{{ p.resumo.vencida }}</strong>
        </div>
        <div class="numero">
          <span>{{ t('manutencao.plano.painel.aVencer') }}</span>
          <strong data-testid="painel-a-vencer">{{ p.resumo.aVencer }}</strong>
        </div>
        <div class="numero">
          <span>{{ t('manutencao.plano.painel.emDia') }}</span>
          <strong data-testid="painel-em-dia">{{ p.resumo.emDia }}</strong>
        </div>
      </div>
      <p v-if="p.itens.length === 0">{{ t('manutencao.nenhum') }}</p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="painel-plano-itens">
          <thead>
            <tr>
              <th scope="col">{{ t('manutencao.os.colunas.equipamento') }}</th>
              <th scope="col">{{ t('manutencao.equipamentos.campos.criticidade') }}</th>
              <th scope="col">{{ t('manutencao.plano.campos.atividade') }}</th>
              <th scope="col">{{ t('manutencao.plano.campos.ultima') }}</th>
              <th scope="col">{{ t('manutencao.plano.campos.proxima') }}</th>
              <th scope="col">{{ t('manutencao.equipamentos.campos.situacao') }}</th>
              <th scope="col">{{ t('manutencao.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in p.itens" :key="i.plano" :data-testid="`painel-item-${i.plano}`">
              <td>{{ i.equipamento.codigo }} - {{ i.equipamento.nome }}</td>
              <td>{{ ROTULOS.criticidade[i.criticidade] }}</td>
              <td>
                {{ ROTULOS.atividade[i.atividade] }}
                <span v-if="i.modelo" class="selo" :data-testid="`painel-modelo-${i.plano}`">{{
                  t('manutencao.plano.modelo.seloCurto', {
                    nome: t(`manutencao.plano.modelo.nomes.${i.modelo}`),
                  })
                }}</span>
              </td>
              <td>{{ dataBr(i.ultimaExecucao) }}</td>
              <td>{{ dataBr(i.proxima) }}</td>
              <td :class="{ vencido: i.situacao === 'vencida' }">
                {{ ROTULOS.situacaoPlano[i.situacao] }}:
                {{
                  i.diasParaVencer < 0
                    ? t('manutencao.plano.painel.diasAtraso', { dias: -i.diasParaVencer })
                    : t('manutencao.plano.painel.diasFaltam', { dias: i.diasParaVencer })
                }}
              </td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('manutencao.abrir')"
                  :data-testid="`painel-abrir-${i.plano}`"
                  @acionar="emit('abrir', i.equipamento.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <RelatorioPmoc :hoje="p.hoje" />
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
