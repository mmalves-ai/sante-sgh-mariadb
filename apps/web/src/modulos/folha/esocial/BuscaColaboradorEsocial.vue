<script setup lang="ts">
// Escolha do colaborador nas abas do eSocial (M53.6): pela busca da gestão de pessoas (nome ou matrícula) para quem a tem
// (`pessoas.colaborador.ler`); para os demais, pelo número do vínculo. O modelo é o vínculo escolhido e o rótulo dele.
import type { ColaboradorResumo } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { lerColaboradores } from '../../pessoas/api-pessoas.js';
import ErroFolha from '../telas/ErroFolha.vue';
import type { ColaboradorEscolhido } from './comum-esocial.js';

const props = defineProps<{ prefixo: string }>();
const escolhido = defineModel<ColaboradorEscolhido | null>({ required: true });
const { t } = useI18n();
const { permissoes } = usarSessao();
const busca = computed(() => permissoes.value.has('pessoas.colaborador.ler'));
const termo = ref('');
const achados = ref<readonly ColaboradorResumo[] | null>(null);
const erro = ref<unknown>(null);
const rotuloDe = (c: ColaboradorResumo) =>
  [
    c.nome,
    c.matricula ? t('folha.esocial.matricula', { m: c.matricula }) : null,
    t('folha.esocial.vinculo', { v: c.vinculo }),
  ]
    .filter(Boolean)
    .join(' · ');
async function buscar(): Promise<void> {
  erro.value = null;
  if (termo.value.trim().length < 2) return;
  try {
    achados.value = (
      await lerColaboradores({ termo: termo.value.trim(), estado: 'todos', limite: 30 })
    ).itens;
  } catch (x) {
    erro.value = x;
  }
}
function escolher(c: ColaboradorResumo): void {
  escolhido.value = { vinculo: c.vinculo, rotulo: rotuloDe(c), tipo: c.tipo };
  achados.value = null;
}
const numero = ref('');
function usarNumero(): void {
  const v = Number(numero.value.trim());
  if (Number.isInteger(v) && v > 0)
    escolhido.value = { vinculo: v, rotulo: t('folha.esocial.vinculo', { v }), tipo: null };
}
</script>

<template>
  <div :data-testid="`${props.prefixo}-colaborador`">
    <div v-if="escolhido" class="campos">
      <p :data-testid="`${props.prefixo}-colaborador-escolhido`">
        <strong>{{ escolhido.rotulo }}</strong>
      </p>
      <SanteBotao
        :rotulo="t('folha.esocial.trabalhador.trocar')"
        variante="texto"
        :data-testid="`${props.prefixo}-colaborador-trocar`"
        @acionar="escolhido = null"
      />
    </div>
    <template v-else-if="busca">
      <ErroFolha v-if="erro" :erro="erro" />
      <div class="campos">
        <SanteCampoTexto
          v-model="termo"
          :rotulo="t('folha.esocial.trabalhador.buscar')"
          :max-bytes="70"
          :data-testid="`${props.prefixo}-colaborador-termo`"
        />
        <SanteBotao
          :rotulo="t('folha.esocial.trabalhador.buscarBotao')"
          variante="secundario"
          :data-testid="`${props.prefixo}-colaborador-buscar`"
          @acionar="buscar"
        />
      </div>
      <ul v-if="achados" class="lista" :data-testid="`${props.prefixo}-colaborador-achados`">
        <li v-if="achados.length === 0">{{ t('folha.esocial.trabalhador.nenhumColaborador') }}</li>
        <li v-for="c in achados" :key="c.vinculo">
          <SanteBotao
            :rotulo="rotuloDe(c)"
            variante="texto"
            :data-testid="`${props.prefixo}-colaborador-escolher-${c.vinculo}`"
            @acionar="escolher(c)"
          />
          <span class="secundario">{{ c.cargo }}</span>
        </li>
      </ul>
    </template>
    <div v-else class="campos">
      <SanteCampoTexto
        v-model="numero"
        :rotulo="t('folha.esocial.trabalhador.vinculoNumero')"
        :max-bytes="10"
        :data-testid="`${props.prefixo}-colaborador-numero`"
      />
      <SanteBotao
        :rotulo="t('folha.esocial.confirmar')"
        variante="secundario"
        :data-testid="`${props.prefixo}-colaborador-usar`"
        @acionar="usarNumero"
      />
    </div>
  </div>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
