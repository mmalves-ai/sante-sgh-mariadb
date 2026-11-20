<script setup lang="ts">
// Regras de faturabilidade (ficha do M30, seção 7): `/faturamento/regras-faturabilidade`. Cada regra é um dado (convênio,
// o que exige, os grupos de item, a vigência); a falta vira aviso na conta e, marcada, pendência que impede o fechamento
// aqui. Criar, editar (a regra carregada no formulário pelo id) e desativar ou reativar; tudo vai à trilha.
import type { RegraLida } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { editarRegra, lerRegras, novaChave } from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { data, usarFaturamento } from '../usar-faturamento.js';

const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivoFuncionalidade, apoio } = usarFaturamento();
const q = useQuery({ queryKey: ['faturamento', 'regras'], queryFn: () => lerRegras() });
const EXIGE = ['senha', 'carteira-valida', 'guia', 'cid', 'autorizacao'] as const;
const GRUPOS = ['diarias-taxas', 'honorarios', 'sadt', 'matmed'] as const;
const vazia = () => ({
  id: null as number | null,
  convenio: '0',
  nome: '',
  exige: 'senha' as string,
  grupos: [] as string[],
  bloqueia: false,
  inicio: '',
  fim: '',
});
const nova = ref(vazia());
const opcoesExige = computed(() =>
  EXIGE.map((x) => ({ valor: x as string, rotulo: t(`faturamento.regras.exigencias.${x}`) })),
);
const opcoesConvenio = computed(() => [
  { valor: '0', rotulo: t('faturamento.regras.convenioTodos') },
  ...(apoio.data.value?.convenios ?? []).map((c) => ({
    valor: String(c.codigo),
    rotulo: `${c.codigo} — ${c.nome}`,
  })),
]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
function editar(r: RegraLida) {
  nova.value = {
    id: r.id,
    convenio: String(r.convenio),
    nome: r.nome,
    exige: r.exige,
    grupos: [...r.seletor.grupos],
    bloqueia: r.bloqueiaFechamento,
    inicio: r.inicio.slice(0, 10),
    fim: r.fim ? r.fim.slice(0, 10) : '',
  };
}
async function enviar(regra: Record<string, unknown>, id: number | null, ativa: boolean) {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await editarRegra({ id, regra, ativa }, novaChave('regra'))).mensagem;
    await qc.invalidateQueries({ queryKey: ['faturamento', 'regras'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}
async function gravar() {
  const ok = await enviar(
    {
      convenio: Number(nova.value.convenio),
      nome: nova.value.nome,
      exige: nova.value.exige,
      seletor: { grupos: nova.value.grupos },
      bloqueiaFechamento: nova.value.bloqueia,
      inicio: nova.value.inicio || apoio.data.value?.hoje,
      fim: nova.value.fim || null,
    },
    nova.value.id,
    true,
  );
  if (ok) nova.value = vazia();
}
/** Desativar (ou reativar) reenvia a regra como está, com a situação trocada. */
function alternar(r: RegraLida) {
  return enviar(
    {
      convenio: r.convenio,
      nome: r.nome,
      exige: r.exige,
      seletor: {
        grupos: r.seletor.grupos,
        ...(r.seletor.codigos.length ? { codigos: r.seletor.codigos } : {}),
      },
      bloqueiaFechamento: r.bloqueiaFechamento,
      inicio: r.inicio.slice(0, 10),
      fim: r.fim ? r.fim.slice(0, 10) : null,
    },
    r.id,
    !r.ativa,
  );
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="reg-titulo" data-testid="tela-faturamento-regras">
    <h1 id="reg-titulo">{{ t('faturamento.regras.titulo') }}</h1>
    <p>{{ t('faturamento.regras.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('regras')" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="reg-mensagem" />
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <table v-else class="tabela" data-testid="reg-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('faturamento.convenio') }}</th>
          <th scope="col">{{ t('faturamento.nome') }}</th>
          <th scope="col">{{ t('faturamento.regras.exige') }}</th>
          <th scope="col">{{ t('faturamento.grupo') }}</th>
          <th scope="col">{{ t('faturamento.regras.vigencia') }}</th>
          <th scope="col">{{ t('faturamento.regras.bloqueia') }}</th>
          <th scope="col">{{ t('faturamento.regras.ativa') }}</th>
          <th v-if="pode('editarRegra')" scope="col">{{ t('faturamento.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="q.data.value.length === 0">
          <td colspan="8">{{ t('faturamento.nenhum') }}</td>
        </tr>
        <tr v-for="r in q.data.value" :key="r.id">
          <td>{{ r.convenio || t('faturamento.todos') }}</td>
          <td>{{ r.nome }}</td>
          <td>{{ t(`faturamento.regras.exigencias.${r.exige}`) }}</td>
          <td>
            {{
              r.seletor.grupos.map((g) => t(`faturamento.gruposNome.${g}`)).join(', ') ||
              t('faturamento.todos')
            }}
          </td>
          <td>{{ t('faturamento.periodo', { de: data(r.inicio), ate: data(r.fim) }) }}</td>
          <td>{{ r.bloqueiaFechamento ? t('faturamento.sim') : t('faturamento.nao') }}</td>
          <td :data-testid="`reg-ativa-${r.id}`">
            {{ r.ativa ? t('faturamento.sim') : t('faturamento.nao') }}
          </td>
          <td v-if="pode('editarRegra')" class="acoes">
            <button type="button" :data-testid="`reg-editar-${r.id}`" @click="editar(r)">
              {{ t('faturamento.editar') }}
            </button>
            <button type="button" :data-testid="`reg-alternar-${r.id}`" @click="alternar(r)">
              {{ r.ativa ? t('faturamento.desativar') : t('faturamento.reativar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <form v-if="pode('editarRegra')" class="filtros" @submit.prevent="gravar">
      <span class="campo">
        <SanteSelecao
          v-model="nova.convenio"
          :rotulo="t('faturamento.convenio')"
          :opcoes="opcoesConvenio"
          data-testid="reg-conv"
        />
      </span>
      <span class="campo"
        ><label for="reg-nome">{{ t('faturamento.nome') }}</label
        ><input id="reg-nome" v-model="nova.nome" maxlength="80" data-testid="reg-nome"
      /></span>
      <span class="campo">
        <SanteSelecao
          v-model="nova.exige"
          :rotulo="t('faturamento.regras.exige')"
          :opcoes="opcoesExige"
          data-testid="reg-exige"
        />
      </span>
      <fieldset>
        <legend>{{ t('faturamento.regras.gruposAlvo') }}</legend>
        <label v-for="g in GRUPOS" :key="g"
          ><input v-model="nova.grupos" type="checkbox" :value="g" />
          {{ t(`faturamento.gruposNome.${g}`) }}</label
        >
      </fieldset>
      <label
        ><input v-model="nova.bloqueia" type="checkbox" data-testid="reg-bloqueia" />
        {{ t('faturamento.regras.bloqueia') }}</label
      >
      <span class="campo"
        ><label for="reg-ini">{{ t('faturamento.pacotes.inicio') }}</label
        ><input id="reg-ini" v-model="nova.inicio" type="date"
      /></span>
      <span class="campo"
        ><label for="reg-fim">{{ t('faturamento.pacotes.fim') }}</label
        ><input id="reg-fim" v-model="nova.fim" type="date"
      /></span>
      <button type="submit" data-testid="reg-gravar">
        {{ nova.id ? t('faturamento.regras.salvar', { id: nova.id }) : t('faturamento.regras.nova') }}
      </button>
      <button v-if="nova.id" type="button" data-testid="reg-cancelar" @click="nova = vazia()">
        {{ t('faturamento.cancelar') }}
      </button>
    </form>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>

<style scoped>
/* Alvos de toque de pelo menos 24 px e afastados (WCAG 2.5.8): as ações da linha e do item. */
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.acoes button {
  min-height: 2rem;
  min-width: 2rem;
  padding: 0 0.75rem;
}
</style>
