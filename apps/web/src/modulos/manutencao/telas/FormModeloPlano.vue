<script setup lang="ts">
// W0-08, parte 10 (mercado M4: PMOC e infraestrutura crítica): instalar no equipamento um dos modelos prontos de plano
// (PMOC do ar condicionado, limpeza do reservatório de água, teste do grupo gerador, inspeção da central de gases). O
// modelo vira um plano comum, com a atividade, a periodicidade e o roteiro da norma; depois se altera pela versão lida e
// as execuções registradas são imutáveis. O mesmo modelo ativo duas vezes no mesmo equipamento recusa (`modelo-instalado`).
import {
  esquemaInstalarModeloPlano,
  type ApoioManutencao,
  type CodigoModeloPlano,
  type ResultadoManutencao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { instalarModeloPlano, lerModelosPlano } from '../api-manutencao.js';
import { OPCOES, problemasDe } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{
  equipamento: number;
  apoio: ApoioManutencao;
  opcoesCobertura: readonly { valor: number | null; rotulo: string }[];
}>();
const emit = defineEmits<{ instalado: [ResultadoManutencao]; cancelar: [] }>();
const { t } = useI18n();

const modelos = useQuery({ queryKey: ['manutencao', 'plano', 'modelos'], queryFn: lerModelosPlano });
const nomeDe = (c: CodigoModeloPlano) => t(`manutencao.plano.modelo.nomes.${c}`);
const opcoes = computed(() =>
  (modelos.data.value ?? []).map((m) => ({ valor: m.codigo, rotulo: nomeDe(m.codigo) })),
);

const rascunho = ref<{
  modelo: CodigoModeloPlano | null;
  dataBase: string;
  executor: 'interno' | 'contrato';
  cobertura: number | null;
}>({ modelo: null, dataBase: props.apoio.hoje, executor: 'interno', cobertura: null });
const escolhido = computed(() => modelos.data.value?.find((m) => m.codigo === rascunho.value.modelo) ?? null);

const problemas = ref<Record<string, string>>({});
const lista = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const gravando = ref(false);

async function instalar() {
  const r = rascunho.value;
  const corpo = {
    equipamento: props.equipamento,
    modelo: r.modelo,
    dataBase: r.dataBase,
    executor: r.executor,
    cobertura: r.executor === 'contrato' ? r.cobertura : null,
  };
  problemas.value = problemasDe(esquemaInstalarModeloPlano, corpo);
  if (Object.keys(problemas.value).length > 0) return;
  erro.value = null;
  gravando.value = true;
  try {
    emit('instalado', await instalarModeloPlano(corpo));
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="bloco" data-testid="modelo-plano-form" @submit.prevent="instalar">
    <h4>{{ t('manutencao.plano.modelo.titulo') }}</h4>
    <p class="secundario">{{ t('manutencao.plano.modelo.ajuda') }}</p>
    <ErroManutencao v-if="modelos.isError.value" :erro="modelos.error.value" />
    <div class="campos">
      <SanteSelecao
        v-model="rascunho.modelo"
        :rotulo="t('manutencao.plano.modelo.campo')"
        :opcoes="opcoes"
        obrigatorio
        data-testid="modelo-plano-escolha"
      />
      <SanteData
        v-model="rascunho.dataBase"
        editavel
        :rotulo="t('manutencao.plano.campos.dataBase')"
        data-testid="modelo-plano-data-base"
      />
      <SanteSelecao
        v-model="rascunho.executor"
        :rotulo="t('manutencao.plano.campos.executor')"
        :opcoes="OPCOES.executor"
        data-testid="modelo-plano-executor"
      />
      <SanteSelecao
        v-if="rascunho.executor === 'contrato'"
        v-model="rascunho.cobertura"
        :rotulo="t('manutencao.plano.campos.cobertura')"
        :opcoes="opcoesCobertura"
        busca
        data-testid="modelo-plano-cobertura"
      />
    </div>
    <div v-if="escolhido" class="secundario" data-testid="modelo-plano-resumo">
      <p>
        {{ t('manutencao.plano.modelo.norma', { norma: escolhido.norma }) }} ·
        {{
          t('manutencao.plano.modelo.periodicidade', {
            quantidade: escolhido.periodicidade.quantidade,
            unidade: escolhido.periodicidade.unidade,
          })
        }}
      </p>
      <pre class="roteiro">{{ escolhido.procedimento }}</pre>
    </div>
    <ul v-if="lista.length > 0" class="vencido" role="alert" data-testid="modelo-plano-problemas">
      <li v-for="x in lista" :key="x">{{ x }}</li>
    </ul>
    <ErroManutencao v-if="erro" :erro="erro" grupo="pmoc" />
    <SanteAlerta v-if="!apoio.gravacao.ligada" variante="info" :texto="apoio.gravacao.motivo ?? ''" />
    <div class="acoes">
      <SanteBotao
        tipo="submit"
        :rotulo="t('manutencao.plano.modelo.instalar')"
        :desabilitado="gravando || !apoio.gravacao.ligada"
        data-testid="modelo-plano-instalar"
      />
      <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>

<style scoped src="./estilo-manutencao.css"></style>
<style scoped>
.roteiro {
  white-space: pre-wrap;
  font-family: inherit;
  margin: 0;
}
</style>
