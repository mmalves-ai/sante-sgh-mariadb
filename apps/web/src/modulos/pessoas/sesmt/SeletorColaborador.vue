<script setup lang="ts">
// Escolha do colaborador nas telas do SESMT (M52.5): busca pelo nome ou pela matrícula sob a permissão de leitura da
// tela (sem CPF); o escolhido aparece com cargo, lotação e admissão, e pode ser trocado.
import type { ColaboradorSesmt } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import { buscarColaboradoresSesmt, type TelaSesmt } from './api-sesmt.js';

const props = defineProps<{ tela: TelaSesmt }>();
const escolhido = defineModel<ColaboradorSesmt | null>({ required: true });
const { t } = useI18n();
const termo = ref('');
const achados = ref<readonly ColaboradorSesmt[] | null>(null);
const erro = ref<unknown>(null);

async function buscar(): Promise<void> {
  erro.value = null;
  if (termo.value.trim().length < 2) return;
  try {
    achados.value = (await buscarColaboradoresSesmt(props.tela, termo.value.trim())).itens;
  } catch (x) {
    erro.value = x;
  }
}
function escolher(c: ColaboradorSesmt): void {
  escolhido.value = c;
  achados.value = null;
}
const lotacao = (c: ColaboradorSesmt) => [c.unidadeNome, c.setor].filter(Boolean).join(' · ');
</script>

<template>
  <section class="bloco" :aria-label="t('sesmt.colaborador.titulo')" data-testid="seletor-colaborador">
    <template v-if="escolhido">
      <h2>{{ escolhido.nome }}</h2>
      <dl class="dados">
        <dt>{{ t('sesmt.colaborador.cargo') }}</dt>
        <dd>{{ [escolhido.cargo, escolhido.funcao].filter(Boolean).join(' · ') }}</dd>
        <dt>{{ t('sesmt.colaborador.lotacao') }}</dt>
        <dd>{{ lotacao(escolhido) }}</dd>
        <dt>{{ t('sesmt.colaborador.admissao') }}</dt>
        <dd>
          {{ dataBr(escolhido.admissao) }}
          <span v-if="escolhido.desligamento" class="secundario">
            {{ t('sesmt.colaborador.desligado', { d: dataBr(escolhido.desligamento) }) }}
          </span>
        </dd>
      </dl>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('sesmt.colaborador.trocar')"
          variante="texto"
          data-testid="trocar-colaborador"
          @acionar="escolhido = null"
        />
      </div>
    </template>
    <form v-else class="campos" @submit.prevent="buscar">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="t('sesmt.colaborador.buscar')"
        :max-bytes="70"
        data-testid="buscar-colaborador-termo"
      />
      <SanteBotao
        :rotulo="t('sesmt.buscar')"
        tipo="submit"
        variante="secundario"
        data-testid="buscar-colaborador"
      />
    </form>
    <ErroPessoas v-if="erro" :erro="erro" />
    <ul v-if="!escolhido && achados" class="lista" data-testid="colaboradores-achados">
      <li v-if="achados.length === 0">{{ t('sesmt.colaborador.nenhum') }}</li>
      <li v-for="c in achados" :key="c.vinculo">
        <SanteBotao
          :rotulo="`${c.nome}${c.matricula ? ' · ' + t('sesmt.colaborador.matricula', { m: c.matricula }) : ''}`"
          variante="texto"
          :data-testid="`escolher-colaborador-${c.vinculo}`"
          @acionar="escolher(c)"
        />
        <span class="secundario">{{ c.cargo }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.lista {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.25rem;
}
</style>
