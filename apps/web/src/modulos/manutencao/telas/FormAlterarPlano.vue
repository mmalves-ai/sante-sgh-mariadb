<script setup lang="ts">
// W0-08: alterar o plano de manutenção pela versão lida (periodicidade, data base, antecedência, procedimento e quem
// executa), sempre com o motivo. O plano equivale a uma regra: a alteração gera versão, a anterior fica guardada e
// visível aqui, e as execuções já registradas não mudam. Versão velha: o servidor recusa (409) e a tela pede para abrir
// de novo. O equipamento e a atividade não se alteram. A tela confere pelo mesmo esquema do servidor.
import { esquemaAlterarPlano, type ApoioManutencao, type PlanoDetalhe } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { alterarPlano, lerPlano } from '../api-manutencao.js';
import {
  corpoDoPlano,
  dataBr,
  OPCOES,
  problemasDe,
  ROTULOS,
  type RascunhoPlano,
} from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{
  plano: number;
  apoio: ApoioManutencao;
  opcoesCobertura: readonly { valor: number | null; rotulo: string }[];
}>();
const emit = defineEmits<{ alterado: [string]; cancelar: [] }>();
const { t } = useI18n();

const consulta = useQuery({
  queryKey: computed(() => ['manutencao', 'plano', props.plano]),
  queryFn: () => lerPlano(props.plano),
});
const atual = computed<PlanoDetalhe | null>(() => consulta.data.value ?? null);

const r = ref<RascunhoPlano | null>(null);
const motivo = ref('');
watch(
  atual,
  (p) => {
    if (!p || r.value) return;
    r.value = {
      atividade: p.atividade,
      quantidade: String(p.periodicidade.quantidade),
      unidade: p.periodicidade.unidade,
      dataBase: p.dataBase,
      antecedencia: p.antecedenciaDias === null ? '' : String(p.antecedenciaDias),
      procedimento: p.procedimento ?? '',
      executor: p.executor,
      cobertura: p.cobertura,
    };
  },
  { immediate: true },
);

const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const gravando = ref(false);
async function enviar() {
  const p = atual.value;
  if (!p || !r.value) return;
  erro.value = null;
  const c = corpoDoPlano(r.value, p.equipamento);
  const corpo = {
    versao: p.versao,
    periodicidade: c.periodicidade,
    dataBase: c.dataBase,
    antecedenciaDias: c.antecedenciaDias,
    procedimento: c.procedimento,
    executor: c.executor,
    cobertura: c.cobertura,
    motivo: motivo.value.trim(),
  };
  problemas.value = problemasDe(esquemaAlterarPlano, { ...corpo, plano: p.id });
  if (Object.keys(problemas.value).length > 0) return;
  gravando.value = true;
  try {
    const x = await alterarPlano(p.id, corpo);
    emit('alterado', x.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="bloco" data-testid="plano-alterar">
    <ErroManutencao v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!atual || !r" role="status">{{ t('manutencao.carregando') }}</p>
    <template v-else>
      <h4>{{ t('manutencao.plano.alteracao.titulo', { atividade: ROTULOS.atividade[atual.atividade] }) }}</h4>
      <p v-if="atual.modelo" class="secundario" data-testid="plano-alterar-modelo">
        {{
          t('manutencao.plano.modelo.selo', {
            nome: t(`manutencao.plano.modelo.nomes.${atual.modelo.codigo}`),
            versao: atual.modelo.versao,
          })
        }}
      </p>
      <SanteAlerta variante="info" :texto="t('manutencao.plano.alteracao.ajuda')" />
      <form data-testid="plano-form-alterar" @submit.prevent="enviar">
        <div class="campos">
          <SanteCampoTexto
            v-model="r.quantidade"
            :rotulo="t('manutencao.plano.campos.periodicidade')"
            :max-bytes="3"
            data-testid="plano-alterar-quantidade"
          />
          <SanteSelecao
            v-model="r.unidade"
            :rotulo="t('manutencao.plano.campos.unidade')"
            :opcoes="OPCOES.unidadePeriodo"
            data-testid="plano-alterar-unidade"
          />
          <SanteData
            v-model="r.dataBase"
            editavel
            :rotulo="t('manutencao.plano.campos.dataBase')"
            data-testid="plano-alterar-data-base"
          />
          <SanteCampoTexto
            v-model="r.antecedencia"
            :rotulo="t('manutencao.plano.campos.antecedencia')"
            :max-bytes="3"
            data-testid="plano-alterar-antecedencia"
          />
          <SanteSelecao
            v-model="r.executor"
            :rotulo="t('manutencao.plano.campos.executor')"
            :opcoes="OPCOES.executor"
            data-testid="plano-alterar-executor"
          />
          <SanteSelecao
            v-if="r.executor === 'contrato'"
            v-model="r.cobertura"
            :rotulo="t('manutencao.plano.campos.cobertura')"
            :opcoes="opcoesCobertura"
            busca
            data-testid="plano-alterar-cobertura"
          />
        </div>
        <SanteCampoTexto
          v-model="r.procedimento"
          multilinha
          :rotulo="t('manutencao.plano.campos.procedimento')"
          :max-bytes="2000"
          data-testid="plano-alterar-procedimento"
        />
        <SanteCampoTexto
          v-model="motivo"
          multilinha
          obrigatorio
          :rotulo="t('manutencao.motivo')"
          :max-bytes="400"
          data-testid="plano-alterar-motivo"
        />
        <ul
          v-if="listaProblemas.length > 0"
          class="vencido"
          role="alert"
          data-testid="plano-alterar-problemas"
        >
          <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
        </ul>
        <ErroManutencao v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('manutencao.plano.alteracao.gravar')"
            :desabilitado="gravando || !apoio.gravacao.ligada"
            data-testid="plano-alterar-gravar"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('manutencao.cancelar')"
            data-testid="plano-alterar-cancelar"
            @acionar="emit('cancelar')"
          />
        </div>
      </form>
      <h5>{{ t('manutencao.plano.alteracao.versoes') }}</h5>
      <p v-if="atual.versoes.length === 0">{{ t('manutencao.plano.alteracao.nenhumaVersao') }}</p>
      <ul v-else class="historico" data-testid="plano-versoes">
        <li v-for="v in atual.versoes" :key="v.versao" :data-testid="`plano-versao-${v.versao}`">
          {{ t('manutencao.plano.alteracao.versao', { versao: v.versao }) }}: {{ v.periodicidade.quantidade }}
          {{ v.periodicidade.unidade }} - {{ t('manutencao.plano.campos.dataBase') }}
          {{ dataBr(v.dataBase) }} -
          {{ ROTULOS.executor[v.executor] }}
          <template v-if="v.procedimento"> - {{ v.procedimento }}</template>
          ({{ t('manutencao.plano.alteracao.motivoDe') }}: {{ v.motivo }} - {{ v.por }}, {{ dataBr(v.em) }})
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
