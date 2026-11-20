<script setup lang="ts">
// W0-08, parte 8 (mercado M2): a queixa técnica aberta a partir da OS do equipamento, na vigilância de produto da
// qualidade (RDC 67/2009: quem identifica o desvio notifica a gerência de risco). Uma por OS; o fabricante, o modelo e a
// série vão do cadastro do equipamento. A tela confere pelo mesmo esquema do servidor.
import { CONDUTAS_PRODUTO, esquemaQueixaDaOs, type CondutaProduto } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { abrirQueixaDaOs } from '../api-manutencao.js';
import { problemasDe } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{ os: number; ligada: boolean }>();
const emit = defineEmits<{ aberta: [string]; cancelar: [] }>();
const { t } = useI18n();

type Tipo = 'queixaTecnica' | 'eventoAdverso' | 'alertaSanitario';
const TIPOS: Tipo[] = ['queixaTecnica', 'eventoAdverso', 'alertaSanitario'];
const tipo = ref<Tipo>('queixaTecnica');
const descricao = ref('');
const conduta = ref<CondutaProduto>('nenhuma');
const opcoesTipo = computed(() =>
  TIPOS.map((x) => ({ valor: x, rotulo: t(`manutencao.os.queixa.tipos.${x}`) })),
);
const opcoesConduta = CONDUTAS_PRODUTO.map((c) => ({ valor: c.codigo, rotulo: c.rotulo }));

const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const gravando = ref(false);
async function enviar() {
  erro.value = null;
  const b = { tipo: tipo.value, descricao: descricao.value.trim(), conduta: conduta.value };
  problemas.value = problemasDe(esquemaQueixaDaOs, { ...b, os: props.os });
  if (listaProblemas.value.length > 0) return;
  gravando.value = true;
  try {
    const r = await abrirQueixaDaOs(props.os, b);
    emit('aberta', r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="bloco" data-testid="os-form-queixa" @submit.prevent="enviar">
    <h3>{{ t('manutencao.os.queixa.titulo') }}</h3>
    <p class="secundario">{{ t('manutencao.os.queixa.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('manutencao.os.queixa.tipo')"
        :opcoes="opcoesTipo"
        data-testid="os-queixa-tipo"
      />
      <SanteSelecao
        v-model="conduta"
        :rotulo="t('manutencao.os.queixa.conduta')"
        :opcoes="opcoesConduta"
        data-testid="os-queixa-conduta"
      />
    </div>
    <SanteCampoTexto
      v-model="descricao"
      multilinha
      obrigatorio
      :rotulo="t('manutencao.os.queixa.descricao')"
      :max-bytes="4000"
      data-testid="os-queixa-descricao"
    />
    <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="os-queixa-problemas">
      <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
    </ul>
    <ErroManutencao v-if="erro" :erro="erro" grupo="alerta" />
    <div class="acoes">
      <SanteBotao
        tipo="submit"
        :rotulo="t('manutencao.os.queixa.gravar')"
        :desabilitado="gravando || !ligada"
        data-testid="os-queixa-gravar"
      />
      <SanteBotao
        variante="texto"
        :rotulo="t('manutencao.cancelar')"
        data-testid="os-queixa-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>

<style scoped src="./estilo-manutencao.css"></style>
