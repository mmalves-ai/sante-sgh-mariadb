<script setup lang="ts">
// Procedimentos permitidos (com vigência) e ocupações (CBO, uma principal) da especialidade (F3.1, 02-CAD linha 17).
// Tudo na mesma tela: busca por código ou nome, inclusão com a vigência e encerramento em um clique; a recusa da API
// (vigência cruzada ou invertida) aparece na hora, junto do campo.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  encerrarProcedimentoPermitido,
  gravarOcupacaoEspecialidade,
  incluirProcedimentoPermitido,
  lerLigacoesEspecialidade,
  lerOpcoesLigacoes,
  retirarOcupacaoEspecialidade,
} from '../api-ligacoes.js';

const props = defineProps<{ especialidade: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const editar = computed(() => pode('cadastro.especialidade.editar'));
const chaveQ = computed(() => ['cadastro', 'especialidade-ligacoes', props.especialidade]);
const consulta = useQuery({ queryKey: chaveQ, queryFn: () => lerLigacoesEspecialidade(props.especialidade) });
const r = computed(() => consulta.data.value);
const termo = ref('');
const opcoes = useQuery({
  queryKey: computed(() => ['cadastro', 'ligacoes-opcoes', termo.value]),
  queryFn: () => lerOpcoesLigacoes(termo.value),
  enabled: computed(() => termo.value.trim().length >= 3),
});
const proc = ref<number | null>(null);
const cbo = ref<number | null>(null);
const inicio = ref(new Date().toISOString().slice(0, 10));
const fimNovo = ref('');
const erro = ref<unknown>(null);

async function fazer(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  try {
    await fn();
    await cliente.invalidateQueries({ queryKey: chaveQ.value });
  } catch (e) {
    erro.value = e;
  }
}
const incluirProc = () =>
  fazer(() =>
    incluirProcedimentoPermitido(props.especialidade, {
      procedimento: proc.value,
      vigenciaInicio: inicio.value,
      vigenciaFim: fimNovo.value || null,
    }),
  );
</script>

<template>
  <section class="tela" aria-labelledby="lig-esp-titulo" data-testid="ligacoes-especialidade">
    <h2 id="lig-esp-titulo">{{ t('ligacoes.especialidade.titulo') }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <MensagemErro v-if="erro" :erro="erro" data-testid="ligacoes-erro" />
    <template v-if="r">
      <h3>{{ t('ligacoes.especialidade.procedimentos') }}</h3>
      <p v-if="r.procedimentos.length === 0">{{ t('ligacoes.comum.nenhum') }}</p>
      <table v-else data-testid="tabela-procedimentos-permitidos">
        <thead>
          <tr>
            <th scope="col">{{ t('ligacoes.especialidade.procedimento') }}</th>
            <th scope="col">{{ t('ligacoes.comum.inicio') }}</th>
            <th scope="col">{{ t('ligacoes.comum.fim') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in r.procedimentos" :key="p.id">
            <td>{{ p.codigo }} {{ p.descricao }}</td>
            <td>{{ p.vigenciaInicio }}</td>
            <td>{{ p.vigenciaFim ?? t('ligacoes.comum.vigente') }}</td>
            <td>
              <SanteBotao
                v-if="editar && p.vigenciaFim === null"
                :rotulo="t('ligacoes.comum.encerrar')"
                variante="secundario"
                @acionar="fazer(() => encerrarProcedimentoPermitido(especialidade, p.id, p.versao, null))"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <h3>{{ t('ligacoes.especialidade.ocupacoes') }}</h3>
      <p v-if="r.ocupacoes.length === 0">{{ t('ligacoes.comum.nenhum') }}</p>
      <ul v-else data-testid="lista-ocupacoes-especialidade">
        <li v-for="o in r.ocupacoes" :key="o.id">
          {{ o.codigo }} {{ o.descricao }}
          <span v-if="o.principal" class="pilula">{{ t('ligacoes.comum.principal') }}</span>
          <template v-if="editar">
            <SanteBotao
              v-if="!o.principal"
              :rotulo="t('ligacoes.comum.tornarPrincipal')"
              variante="secundario"
              @acionar="fazer(() => gravarOcupacaoEspecialidade(especialidade, o.ocupacao, true))"
            />
            <SanteBotao
              :rotulo="t('ligacoes.comum.retirar')"
              variante="secundario"
              @acionar="fazer(() => retirarOcupacaoEspecialidade(especialidade, o.id, o.versao))"
            />
          </template>
        </li>
      </ul>
      <form v-if="editar" class="barra" @submit.prevent>
        <div class="campo">
          <label for="lig-esp-termo">{{ t('ligacoes.comum.buscar') }}</label>
          <input id="lig-esp-termo" v-model="termo" maxlength="60" data-testid="lig-esp-termo" />
        </div>
        <SanteSelecao
          id="lig-esp-proc"
          v-model="proc"
          :rotulo="t('ligacoes.especialidade.procedimento')"
          :opcoes="[
            { valor: null, rotulo: t('ligacoes.comum.escolha') },
            ...(opcoes.data.value?.procedimentos ?? []).map((o) => ({
              valor: o.id,
              rotulo: `${o.codigo} ${o.descricao}`,
            })),
          ]"
          data-testid="lig-esp-proc"
        />
        <div class="campo">
          <label for="lig-esp-ini">{{ t('ligacoes.comum.inicio') }}</label>
          <input id="lig-esp-ini" v-model="inicio" type="date" />
        </div>
        <div class="campo">
          <label for="lig-esp-fim">{{ t('ligacoes.comum.fim') }}</label>
          <input id="lig-esp-fim" v-model="fimNovo" type="date" :min="inicio" />
        </div>
        <SanteBotao
          :rotulo="t('ligacoes.comum.gravar')"
          :desabilitado="proc === null || !inicio"
          data-testid="lig-esp-gravar-proc"
          @acionar="incluirProc"
        />
        <SanteSelecao
          id="lig-esp-cbo"
          v-model="cbo"
          :rotulo="t('ligacoes.especialidade.ocupacao')"
          :opcoes="[
            { valor: null, rotulo: t('ligacoes.comum.escolha') },
            ...(opcoes.data.value?.ocupacoes ?? []).map((o) => ({
              valor: o.id,
              rotulo: `${o.codigo} ${o.descricao}`,
            })),
          ]"
          data-testid="lig-esp-cbo"
        />
        <SanteBotao
          :rotulo="t('ligacoes.comum.gravar')"
          :desabilitado="cbo === null"
          data-testid="lig-esp-gravar-cbo"
          @acionar="fazer(() => gravarOcupacaoEspecialidade(especialidade, cbo!, false))"
        />
      </form>
    </template>
  </section>
</template>
