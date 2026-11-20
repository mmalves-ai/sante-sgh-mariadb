<script setup lang="ts">
// Farmácia ambulatorial e SNGPC (ficha do M29, seção 7; regra 10; DP-47.5 (b)): `/farmacia/ambulatorial`. Construída e
// DESLIGADA: sem o CNAE de farmácia e o credenciamento no SNGPC registrados em Funcionalidades, a tela só mostra o
// motivo e nada é gravado. Ligada, a dispensação e a escrituração vão só a tabelas do novo (sem baixa no estoque).
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dispensarAmbulatorial, escriturarSngpc, lerAmbulatorial, novaChave } from '../api-farmacia.js';
import AvisoFarmacia from '../componentes/AvisoFarmacia.vue';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { horario, numero, qtd } from '../usar-farmacia.js';

const { t } = useI18n();
const a = useQuery({ queryKey: ['farmacia', 'ambulatorial'], queryFn: () => lerAmbulatorial() });
const f = ref({
  paciente: '',
  item: '',
  lote: '',
  validade: '',
  quantidade: '',
  receita: '',
  receitaData: '',
});
const periodo = ref({ inicio: '', fim: '' });
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function dispensarAmb(): Promise<void> {
  erro.value = null;
  try {
    const x = f.value;
    mensagem.value = (
      await dispensarAmbulatorial(
        {
          paciente: Number(x.paciente),
          item: Number(x.item),
          lote: x.lote,
          validade: x.validade,
          quantidade: numero(x.quantidade),
          ...(x.receita ? { receitaNumero: x.receita } : {}),
          ...(x.receitaData ? { receitaData: x.receitaData } : {}),
        },
        novaChave('ambulatorial'),
      )
    ).mensagem;
    await a.refetch();
  } catch (e) {
    erro.value = e;
  }
}
async function escriturar(): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (await escriturarSngpc(periodo.value, novaChave('sngpc'))).mensagem;
    await a.refetch();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="amb-titulo" data-testid="tela-farmacia-ambulatorial">
    <h1 id="amb-titulo">{{ t('farmacia.ambulatorial.titulo') }}</h1>
    <p>{{ t('farmacia.ambulatorial.texto') }}</p>
    <AvisoFarmacia :motivo="a.data.value && !a.data.value.ligada ? (a.data.value.motivo ?? '') : null" />
    <ErroFarmacia v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <template v-if="a.data.value?.ligada">
      <form class="filtros" @submit.prevent="dispensarAmb">
        <span class="campo"
          ><label for="amb-pac">{{ t('farmacia.paciente') }}</label
          ><input id="amb-pac" v-model="f.paciente" inputmode="numeric"
        /></span>
        <span class="campo"
          ><label for="amb-item">{{ t('farmacia.item') }}</label
          ><input id="amb-item" v-model="f.item" inputmode="numeric"
        /></span>
        <span class="campo"
          ><label for="amb-lote">{{ t('farmacia.lote') }}</label
          ><input id="amb-lote" v-model="f.lote"
        /></span>
        <span class="campo"
          ><label for="amb-val">{{ t('farmacia.validade') }}</label
          ><input id="amb-val" v-model="f.validade" type="date"
        /></span>
        <span class="campo"
          ><label for="amb-q">{{ t('farmacia.quantidade') }}</label
          ><input id="amb-q" v-model="f.quantidade" inputmode="decimal"
        /></span>
        <span class="campo"
          ><label for="amb-rec">{{ t('farmacia.ambulatorial.receita') }}</label
          ><input id="amb-rec" v-model="f.receita"
        /></span>
        <span class="campo"
          ><label for="amb-recd">{{ t('farmacia.ambulatorial.receitaData') }}</label
          ><input id="amb-recd" v-model="f.receitaData" type="date"
        /></span>
        <SanteBotao tipo="submit" :rotulo="t('farmacia.ambulatorial.dispensar')" />
      </form>
      <form class="filtros" @submit.prevent="escriturar">
        <span class="campo"
          ><label for="amb-ini">{{ t('farmacia.inicio') }}</label
          ><input id="amb-ini" v-model="periodo.inicio" type="date"
        /></span>
        <span class="campo"
          ><label for="amb-fim">{{ t('farmacia.fim') }}</label
          ><input id="amb-fim" v-model="periodo.fim" type="date"
        /></span>
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('farmacia.ambulatorial.escriturar')" />
      </form>
      <ul>
        <li v-for="d in a.data.value.dispensacoes" :key="d.id">
          {{ horario(d.em) }} · {{ d.item }} · {{ d.lote }} · {{ qtd(d.quantidade)
          }}<span v-if="d.escriturada"> · {{ t('farmacia.ambulatorial.escriturada') }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
