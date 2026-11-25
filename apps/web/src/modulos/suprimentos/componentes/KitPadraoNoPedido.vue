<script setup lang="ts">
// O kit padrão no pedido de material (F3.6, 05-SUP linha 13): quem pede acha a cirurgia ou o procedimento pelo código
// ou pelo nome, vê o kit padrão dele com a composição e soma tudo ao pedido de uma vez (quantidade do kit × número de
// kits), em vez de buscar item por item. O número de kits é conferido enquanto se digita, pela mesma regra que monta
// as linhas (`somarKitAoPedido`).
import { type KitPadraoSugerido, MAXIMO_KITS_NO_PEDIDO, somarKitAoPedido } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { sugerirKitsPadrao } from '../api-kit-padrao.js';
import { numero, qtd } from '../usar-suprimentos.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const emit = defineEmits<{ somar: [kit: KitPadraoSugerido, kits: number] }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Kit padrão da cirurgia ou do procedimento',
      termo: 'Cirurgia ou procedimento (código ou nome)',
      buscar: 'Buscar kit',
      nenhum: 'Nenhum kit padrão para esta busca.',
      kit: 'Kit {codigo} · {nome}',
      kits: 'Número de kits',
      somar: 'Somar ao pedido',
      invalido: 'Informe um número inteiro de kits, de 1 a {max}.',
      somado: 'Kit {codigo} somado ao pedido ({kits} × a composição).',
    },
  },
});

const termo = ref('');
const sugeridos = ref<KitPadraoSugerido[] | null>(null);
const kits = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const chave = (s: KitPadraoSugerido) => s.procedimentoCodigo;

async function buscar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await sugerirKitsPadrao(termo.value);
    kits.value = Object.fromEntries(r.map((s) => [chave(s), String(s.quantidadeKits)]));
    sugeridos.value = r;
  } catch (x) {
    erro.value = x;
  }
}
const quantos = (s: KitPadraoSugerido) => numero(kits.value[chave(s)] ?? '');
const valido = (s: KitPadraoSugerido) => somarKitAoPedido([], s, quantos(s)) !== null;
function somar(s: KitPadraoSugerido): void {
  if (!valido(s)) return;
  emit('somar', s, quantos(s));
  mensagem.value = t('somado', { codigo: s.codigo, kits: quantos(s) });
}
</script>

<template>
  <fieldset class="painel" data-testid="kit-pedido">
    <legend>{{ t('titulo') }}</legend>
    <div class="filtros">
      <span class="campo">
        <label for="kit-pedido-termo">{{ t('termo') }}</label>
        <input
          id="kit-pedido-termo"
          v-model="termo"
          maxlength="100"
          data-testid="kit-pedido-termo"
          @keydown.enter.prevent="buscar"
        />
      </span>
      <SanteBotao
        variante="secundario"
        :rotulo="t('buscar')"
        :desabilitado="termo.trim().length < 2"
        data-testid="kit-pedido-buscar"
        @acionar="buscar"
      />
    </div>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="sugeridos && sugeridos.length === 0" role="status" data-testid="kit-pedido-nenhum">
      {{ t('nenhum') }}
    </p>
    <ul v-if="sugeridos && sugeridos.length > 0">
      <li v-for="s in sugeridos" :key="chave(s)" :data-testid="`kit-pedido-${chave(s)}`">
        <p>
          <strong>{{ s.procedimentoCodigo }} · {{ s.procedimentoNome }}</strong> —
          {{ t('kit', { codigo: s.codigo, nome: s.nome }) }}
        </p>
        <p class="secundario">
          {{ s.itens.map((i) => `${qtd(i.quantidade)} ${i.unidade} · ${i.nome}`).join('; ') }}
        </p>
        <div class="filtros">
          <span class="campo">
            <label :for="`kit-pedido-kits-${chave(s)}`">{{ t('kits') }}</label>
            <input
              :id="`kit-pedido-kits-${chave(s)}`"
              v-model="kits[chave(s)]"
              inputmode="numeric"
              :aria-invalid="!valido(s)"
              :aria-describedby="valido(s) ? undefined : `kit-pedido-recusa-${chave(s)}`"
              :data-testid="`kit-pedido-kits-${chave(s)}`"
            />
          </span>
          <SanteBotao
            :rotulo="t('somar')"
            :desabilitado="!valido(s)"
            :data-testid="`kit-pedido-somar-${chave(s)}`"
            @acionar="somar(s)"
          />
        </div>
        <p
          v-if="!valido(s)"
          :id="`kit-pedido-recusa-${chave(s)}`"
          role="alert"
          :data-testid="`kit-pedido-recusa-${chave(s)}`"
        >
          {{ t('invalido', { max: MAXIMO_KITS_NO_PEDIDO }) }}
        </p>
      </li>
    </ul>
    <p v-if="mensagem" role="status" data-testid="kit-pedido-mensagem">{{ mensagem }}</p>
  </fieldset>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
