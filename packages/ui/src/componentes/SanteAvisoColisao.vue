<script setup lang="ts">
// Aviso de colisão (regra 9; cap-10 §10.5): a API respondeu Problem Details "conflito-de-versao" (a linha
// mudou no SPDATA ou no novo desde a leitura). Mostra o que mudou, mantém o digitado (a tela não é tocada)
// e oferece "rever e salvar de novo". Nunca sobrescreve em silêncio.
import { type Problema, tipoDoProblema } from '@sgh/contratos';
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import SanteIcone from '../icones/SanteIcone.vue';
import SanteBotao from './SanteBotao.vue';

const props = defineProps<{ problema: Problema }>();
const emit = defineEmits<{ rever: []; descartar: [] }>();
const { t } = useI18n();
if (tipoDoProblema(props.problema) !== 'conflito-de-versao') {
  throw new Error('SanteAvisoColisao só trata Problem Details do tipo conflito-de-versao');
}
const titulo = computed(() =>
  props.problema.alteradoPor === 'novo' ? t('ui.colisao.tituloNovo') : t('ui.colisao.titulo'),
);
const alteracoes = computed(() => props.problema.alteracoes ?? []);
// Id único: dois avisos na mesma tela não podem repetir o id do título.
const idTitulo = `sgh-colisao-titulo-${useId()}`;
</script>

<template>
  <section class="sgh-colisao" role="alert" :aria-labelledby="idTitulo" data-testid="aviso-colisao">
    <h2 :id="idTitulo" class="sgh-colisao__titulo">
      <SanteIcone nome="alerta" />
      <span>{{ titulo }}</span>
    </h2>
    <p>{{ t('ui.colisao.explicacao') }}</p>
    <table v-if="alteracoes.length > 0" class="sgh-colisao__tabela">
      <thead>
        <tr>
          <th scope="col">{{ t('ui.colisao.campo') }}</th>
          <th scope="col">{{ t('ui.colisao.lido') }}</th>
          <th scope="col">{{ t('ui.colisao.atual') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in alteracoes" :key="a.campo">
          <th scope="row">{{ a.rotulo }}</th>
          <td>{{ a.lido ?? t('ui.colisao.vazio') }}</td>
          <td class="sgh-colisao__atual">{{ a.atual ?? t('ui.colisao.vazio') }}</td>
        </tr>
      </tbody>
    </table>
    <div class="sgh-colisao__acoes">
      <SanteBotao :rotulo="t('ui.colisao.rever')" data-testid="rever" @acionar="emit('rever')" />
      <SanteBotao
        variante="destrutivo"
        :rotulo="t('ui.colisao.descartar')"
        :confirmacao="t('ui.colisao.confirmarDescarte')"
        data-testid="descartar"
        @acionar="emit('descartar')"
      />
    </div>
  </section>
</template>

<style scoped>
.sgh-colisao {
  border: 2px solid var(--sgh-aviso);
  background: var(--sgh-aviso-suave);
  color: var(--sgh-texto);
  padding: var(--sgh-espaco-3);
  border-radius: 6px;
}
.sgh-colisao__titulo {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
  margin: 0 0 var(--sgh-espaco-2);
  font-size: 1.1em;
  color: var(--sgh-texto);
}
.sgh-colisao__tabela {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
  background: var(--sgh-fundo-elevado);
}
.sgh-colisao__tabela th,
.sgh-colisao__tabela td {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  text-align: left;
}
.sgh-colisao__atual {
  font-weight: 700;
}
.sgh-colisao__acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
</style>
