<script setup lang="ts">
// Abrir a avaliação em rascunho (W0-06, parte 5d-2): o ciclo aberto, o colaborador (busca pelo nome ou pela matrícula,
// só os ativos), o marco de 45 ou 90 dias no ciclo de experiência e o login do avaliador (vazio: quem abre). As
// competências vêm do cargo do colaborador; o servidor recusa o colaborador sem cargo, o cargo sem competência ativa e a
// avaliação já em vigor no ciclo, e a recusa aparece aqui. Do alerta de experiência, colaborador e marco já vêm.
import type { CicloAvaliacaoResposta, ColaboradorResumo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerColaboradores } from '../api-pessoas.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { abrirAvaliacao } from './api-avaliacao.js';
import { marcosDoCiclo } from './avaliacao-comum.js';

const props = defineProps<{
  ciclos: readonly CicloAvaliacaoResposta[];
  /** O ciclo já escolhido (a ficha do ciclo); sem ele, a escolha entre os abertos. */
  ciclo?: number | null;
  /** O colaborador já escolhido (o alerta de experiência). */
  colaborador?: { vinculo: number; nome: string } | null;
  marco?: 45 | 90 | null;
}>();
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ aberta: [r: unknown] }>();
const { t } = useI18n();

const abertos = computed(() =>
  props.ciclos.filter((c) => c.situacao === 'aberto' && (props.marco == null || c.tipo === 'experiencia')),
);
const cicloId = ref<number | null>(null);
const escolhido = ref<{ vinculo: number; nome: string } | null>(null);
const marcoEscolhido = ref<string>('');
const avaliador = ref('');
const termo = ref('');
const achados = ref<readonly ColaboradorResumo[] | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
watch(
  visivel,
  (v) => {
    if (!v) return;
    cicloId.value = props.ciclo ?? (abertos.value.length === 1 ? abertos.value[0]!.id : null);
    escolhido.value = props.colaborador ?? null;
    marcoEscolhido.value = props.marco ? String(props.marco) : '';
    avaliador.value = '';
    termo.value = '';
    achados.value = null;
    erro.value = null;
  },
  { immediate: true },
);
const c = computed(() => props.ciclos.find((x) => x.id === cicloId.value) ?? null);
const marcos = computed(() => (c.value ? marcosDoCiclo(c.value.tipo) : []));
const opcoesCiclo = computed(() => [
  { valor: null, rotulo: t('pessoas.avaliacao.abrirAval.escolhaCiclo') },
  ...abertos.value.map((x) => ({
    valor: x.id,
    rotulo: `${x.nome} · ${t(`pessoas.avaliacao.ciclos.tipos.${x.tipo}`)}`,
  })),
]);
const opcoesMarco = computed(() => [
  { valor: '', rotulo: t('pessoas.avaliacao.abrirAval.escolhaMarco') },
  ...marcos.value.map((m) => ({ valor: String(m), rotulo: t('pessoas.avaliacao.ficha.marcoTexto', { m }) })),
]);
const pronto = computed(
  () =>
    c.value !== null &&
    escolhido.value !== null &&
    (marcos.value.length === 0 || marcoEscolhido.value !== ''),
);

async function buscar(): Promise<void> {
  erro.value = null;
  if (termo.value.trim().length < 2) return;
  try {
    achados.value = (
      await lerColaboradores({ termo: termo.value.trim(), estado: 'ativo', limite: 20 })
    ).itens;
  } catch (x) {
    erro.value = x;
  }
}
function escolher(x: ColaboradorResumo): void {
  escolhido.value = { vinculo: x.vinculo, nome: x.nome };
  achados.value = null;
}
async function abrir(): Promise<void> {
  if (!pronto.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await abrirAvaliacao({
      ciclo: c.value!.id,
      vinculo: escolhido.value!.vinculo,
      marco: marcos.value.length === 0 ? null : (Number(marcoEscolhido.value) as 45 | 90),
      avaliador: avaliador.value.trim() === '' ? null : avaliador.value.trim(),
    });
    visivel.value = false;
    emit('aberta', r);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('pessoas.avaliacao.abrirAval.titulo')" largura="40rem">
    <div class="bloco" data-testid="dialogo-abrir-avaliacao">
      <p>{{ t('pessoas.avaliacao.abrirAval.texto') }}</p>
      <SanteAlerta
        v-if="abertos.length === 0"
        :texto="t('pessoas.avaliacao.abrirAval.semCiclo')"
        variante="aviso"
        data-testid="abrir-sem-ciclo"
      />
      <SanteSelecao
        v-if="!ciclo"
        v-model="cicloId"
        :rotulo="t('pessoas.avaliacao.ficha.ciclo')"
        :opcoes="opcoesCiclo"
        obrigatorio
        data-testid="abrir-ciclo"
      />
      <p v-else-if="c">
        <strong>{{ t('pessoas.avaliacao.ficha.ciclo') }}:</strong> {{ c.nome }}
      </p>
      <template v-if="escolhido">
        <p data-testid="abrir-colaborador">
          <strong>{{ t('pessoas.avaliacao.ciclos.colaborador') }}:</strong> {{ escolhido.nome }}
        </p>
        <div v-if="!colaborador" class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.avaliacao.abrirAval.trocar')"
            variante="texto"
            data-testid="abrir-trocar-colaborador"
            @acionar="escolhido = null"
          />
        </div>
      </template>
      <template v-else>
        <form class="campos" @submit.prevent="buscar">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('pessoas.avaliacao.abrirAval.buscar')"
            :max-bytes="70"
            data-testid="abrir-termo"
          />
          <SanteBotao
            :rotulo="t('pessoas.avaliacao.abrirAval.buscarBotao')"
            tipo="submit"
            variante="secundario"
            data-testid="abrir-buscar"
          />
        </form>
        <ul v-if="achados" class="lista" data-testid="abrir-achados">
          <li v-if="achados.length === 0">{{ t('pessoas.avaliacao.abrirAval.nenhum') }}</li>
          <li v-for="x in achados" :key="x.vinculo">
            <SanteBotao
              :rotulo="x.matricula ? `${x.nome} · ${x.matricula}` : x.nome"
              variante="texto"
              :data-testid="`abrir-escolher-${x.vinculo}`"
              @acionar="escolher(x)"
            />
            <span class="secundario">{{ x.cargo }}</span>
          </li>
        </ul>
      </template>
      <SanteSelecao
        v-if="marcos.length > 0"
        v-model="marcoEscolhido"
        :rotulo="t('pessoas.avaliacao.abrirAval.marco')"
        :opcoes="opcoesMarco"
        :desabilitado="!!marco"
        obrigatorio
        data-testid="abrir-marco"
      />
      <SanteCampoTexto
        v-model="avaliador"
        :rotulo="t('pessoas.avaliacao.abrirAval.avaliador')"
        :max-bytes="31"
        data-testid="abrir-avaliador"
      />
      <ErroPessoas v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('pessoas.avaliacao.abrirAval.confirmar')"
          :desabilitado="ocupado || !pronto"
          data-testid="abrir-avaliacao-confirmar"
          @acionar="abrir"
        />
        <SanteBotao :rotulo="t('pessoas.avaliacao.fechar')" variante="texto" @acionar="visivel = false" />
      </div>
    </div>
  </SanteDialogo>
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
