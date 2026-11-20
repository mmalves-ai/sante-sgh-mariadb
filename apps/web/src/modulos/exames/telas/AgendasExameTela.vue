<script setup lang="ts">
// Cadastro de agendas de exames (ficha do M18, seção 7): `/agenda/exames/agendas`. Lista por nome, situação e
// categoria; na agenda escolhida, os convênios aceitos (agenda.definirCoberturaExame: retirar o último pede a
// confirmação de que a agenda passa a aceitar todos) e os exames que a agenda faz, com o convênio que cobre cada um
// (cobertura do novo), a escala e as gerações. Incluir e alterar a agenda é pelo cadastro de domínios.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { dataBr } from '../../agenda/formato.js';
import {
  codigoDaRecusa,
  definirConvenioExame,
  definirExameCoberto,
  lerAgendaExame,
  listarAgendasExame,
  novaChave,
} from '../api-exames.js';
import AvisoExame from '../componentes/AvisoExame.vue';
import ErroExame from '../componentes/ErroExame.vue';
import { usarExames } from '../usar-exames.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { opcoes, pode, motivoGravacao, convenios } = usarExames();
const termo = ref('');
const situacao = ref('ativas');
const categoria = ref('');
const filtro = ref({ termo: '', situacao: 'ativas', categoria: '' });
const lista = useQuery({
  queryKey: computed(() => ['exames', 'agendas', filtro.value]),
  queryFn: () =>
    listarAgendasExame({
      termo: filtro.value.termo || undefined,
      situacao: filtro.value.situacao || undefined,
      categoria: filtro.value.categoria ? Number(filtro.value.categoria) : null,
    }),
});
const situacoes = computed(() => [
  { valor: 'ativas', rotulo: t('exames.agendas.ativas') },
  { valor: 'inativas', rotulo: t('exames.agendas.inativas') },
  { valor: '', rotulo: t('exames.agendas.todasSituacoes') },
]);
const categorias = computed(() => [
  { valor: '', rotulo: t('exames.todasCategorias') },
  ...(opcoes.data.value?.categorias ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.rotulo })),
]);
function filtrar(): void {
  filtro.value = { termo: termo.value.trim(), situacao: situacao.value, categoria: categoria.value };
}

const escolhida = ref<number | null>(
  typeof rota.query['agenda'] === 'string' ? Number(rota.query['agenda']) : null,
);
const detalhe = useQuery({
  queryKey: computed(() => ['exames', 'agenda', escolhida.value ?? 0]),
  queryFn: () => lerAgendaExame(escolhida.value ?? 0),
  enabled: computed(() => escolhida.value !== null),
});

// ── Convênios aceitos ──
const podeConvenio = pode('agenda.definirCoberturaExame');
const podeExame = pode('coberturaExame');
const novoConvenio = ref('');
const confirmarTodos = ref(false);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function convenio(acao: 'incluir' | 'remover', codigo: number, aceitarTodos = false): Promise<void> {
  if (escolhida.value === null) return;
  erro.value = null;
  mensagem.value = null;
  confirmarTodos.value = false;
  ocupado.value = true;
  try {
    const r = await definirConvenioExame(
      escolhida.value,
      { convenio: codigo, acao, confirmarAceitarTodos: aceitarTodos },
      novaChave('convenio'),
    );
    mensagem.value = r.mensagem;
    novoConvenio.value = '';
    await cliente.invalidateQueries({ queryKey: ['exames'] });
  } catch (e) {
    erro.value = e;
    if (codigoDaRecusa(e) === 'ultima-linha') ultimoConvenio.value = codigo;
  } finally {
    ocupado.value = false;
  }
}
const ultimoConvenio = ref<number | null>(null);
async function confirmarUltimo(): Promise<void> {
  const c = ultimoConvenio.value;
  if (c === null) return;
  await convenio('remover', c, true);
  ultimoConvenio.value = null;
}

// ── Exames que a agenda faz ──
const novoExame = ref('');
const conveniosDoExame = ref('');
const examesDaCategoria = computed(() => {
  const cat = detalhe.data.value?.agenda.categoria.codigo;
  return (opcoes.data.value?.exames ?? [])
    .filter((e) => cat === undefined || e.categoria === cat || cat === 42)
    .map((e) => ({ valor: String(e.id), rotulo: e.nome }));
});
const escolhasExame = computed(() => [
  { valor: '', rotulo: t('exames.escolha') },
  ...examesDaCategoria.value,
]);
const escolhasConvenioExame = computed(() => [
  { valor: '', rotulo: t('exames.agendas.qualquerConvenio') },
  ...convenios.value,
]);
async function exame(acao: 'incluir' | 'remover', id: number, conv: number | null): Promise<void> {
  if (escolhida.value === null) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await definirExameCoberto(
      escolhida.value,
      { exame: id, convenio: conv, acao },
      novaChave('exame'),
    );
    mensagem.value = r.mensagem;
    novoExame.value = '';
    conveniosDoExame.value = '';
    await cliente.invalidateQueries({ queryKey: ['exames'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const escolhasNovoConvenio = computed(() => [{ valor: '', rotulo: t('exames.escolha') }, ...convenios.value]);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="agendas-exame-titulo" data-testid="tela-agendas-exame">
    <h1 id="agendas-exame-titulo">{{ t('exames.agendas.titulo') }}</h1>
    <p>{{ t('exames.agendas.texto') }}</p>
    <AvisoExame :motivo="motivoGravacao" />
    <p class="acoes">
      <RouterLink to="/cadastros/dominios/agenda/agendaExame">{{ t('exames.agendas.cadastro') }}</RouterLink>
      <RouterLink to="/agenda/exames/escalas">{{ t('exames.escalas.titulo') }}</RouterLink>
      <RouterLink to="/agenda/exames/gerar">{{ t('exames.gerar.titulo') }}</RouterLink>
    </p>
    <form class="filtros" role="search" @submit.prevent="filtrar">
      <div class="campo">
        <label for="agendas-exame-termo">{{ t('exames.agendas.termo') }}</label>
        <input id="agendas-exame-termo" v-model="termo" type="search" autocomplete="off" />
      </div>
      <SanteSelecao v-model="situacao" :rotulo="t('exames.agendas.situacao')" :opcoes="situacoes" />
      <SanteSelecao v-model="categoria" :rotulo="t('exames.categoria')" :opcoes="categorias" />
      <SanteBotao tipo="submit" :rotulo="t('exames.filtrar')" />
    </form>
    <ErroExame v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('exames.carregando') }}</p>
    <table v-else-if="lista.data.value.itens.length" class="tabela" data-testid="tabela-agendas-exame">
      <caption>
        {{
          t('exames.agendas.legenda', { n: lista.data.value.total })
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('exames.agenda') }}</th>
          <th scope="col">{{ t('exames.categoria') }}</th>
          <th scope="col">{{ t('exames.tipo') }}</th>
          <th scope="col">{{ t('exames.agendas.duracao') }}</th>
          <th scope="col">{{ t('exames.agendas.grade') }}</th>
          <th scope="col">{{ t('exames.agendas.convenios') }}</th>
          <th scope="col">{{ t('exames.agendas.exames') }}</th>
          <th scope="col">{{ t('exames.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in lista.data.value.itens" :key="a.id">
          <td>
            {{ a.nome }}<span v-if="!a.ativa" class="secundario"> · {{ t('exames.agendas.inativa') }}</span>
          </td>
          <td>{{ a.categoria.rotulo }}</td>
          <td>{{ a.exameRotulo }}</td>
          <td>{{ a.duracao }}</td>
          <td>{{ a.gradeInicio ? `${dataBr(a.gradeInicio)} a ${dataBr(a.gradeFim)}` : '—' }}</td>
          <td>{{ a.convenios === 0 ? t('exames.agendas.todos') : a.convenios }}</td>
          <td>{{ a.exames === 0 ? t('exames.agendas.naoInformado') : a.exames }}</td>
          <td>
            <SanteBotao
              variante="texto"
              :rotulo="t('exames.agendas.abrir', { agenda: a.nome })"
              :data-testid="`agenda-exame-${a.id}`"
              @acionar="escolhida = a.id"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('exames.nenhuma') }}</p>

    <section
      v-if="detalhe.data.value"
      class="painel"
      aria-labelledby="agenda-exame-detalhe"
      data-testid="detalhe-agenda-exame"
    >
      <h2 id="agenda-exame-detalhe">{{ detalhe.data.value.agenda.nome }}</h2>
      <p class="secundario">
        {{ detalhe.data.value.agenda.categoria.rotulo }} · {{ detalhe.data.value.agenda.exameRotulo }} ·
        {{ t('exames.agendas.duracaoDe', { d: detalhe.data.value.agenda.duracao }) }}
      </p>

      <h3>{{ t('exames.agendas.convenios') }}</h3>
      <p v-if="detalhe.data.value.convenios.length === 0">{{ t('exames.agendas.aceitaTodos') }}</p>
      <ul v-else>
        <li v-for="c in detalhe.data.value.convenios" :key="c.codigo" class="acoes">
          {{ c.nome }}
          <SanteBotao
            v-if="podeConvenio"
            variante="texto"
            :rotulo="t('exames.agendas.retirarConvenio', { convenio: c.nome })"
            :desabilitado="ocupado"
            @acionar="convenio('remover', c.codigo)"
          />
        </li>
      </ul>
      <div v-if="ultimoConvenio !== null" class="acoes" role="alert">
        <SanteAlerta variante="aviso" :texto="t('exames.agendas.ultimoConvenio')" />
        <SanteBotao
          variante="destrutivo"
          :rotulo="t('exames.agendas.confirmarTodos')"
          :confirmacao="t('exames.agendas.confirmarTodosPergunta')"
          @acionar="confirmarUltimo"
        />
      </div>
      <form
        v-if="podeConvenio"
        class="filtros"
        @submit.prevent="novoConvenio && convenio('incluir', Number(novoConvenio))"
      >
        <SanteSelecao
          v-model="novoConvenio"
          :rotulo="t('exames.agendas.incluirConvenio')"
          :opcoes="escolhasNovoConvenio"
        />
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('exames.incluir')"
          :desabilitado="!novoConvenio || ocupado"
        />
      </form>

      <h3>{{ t('exames.agendas.exames') }}</h3>
      <p class="secundario">{{ t('exames.agendas.examesTexto') }}</p>
      <p v-if="detalhe.data.value.cobertura.length === 0">{{ t('exames.agendas.semCobertura') }}</p>
      <table v-else class="tabela" data-testid="tabela-cobertura-exame">
        <thead>
          <tr>
            <th scope="col">{{ t('exames.exame') }}</th>
            <th scope="col">{{ t('exames.convenio') }}</th>
            <th scope="col">{{ t('exames.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in detalhe.data.value.cobertura" :key="c.id">
            <td>{{ c.exameNome }}</td>
            <td>{{ c.convenioNome ?? t('exames.agendas.qualquerConvenio') }}</td>
            <td>
              <SanteBotao
                v-if="podeExame"
                variante="texto"
                :rotulo="t('exames.agendas.retirarExame', { exame: c.exameNome })"
                :desabilitado="ocupado"
                @acionar="exame('remover', c.exame, c.convenio)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <form
        v-if="podeExame"
        class="filtros"
        @submit.prevent="
          novoExame && exame('incluir', Number(novoExame), conveniosDoExame ? Number(conveniosDoExame) : null)
        "
      >
        <SanteSelecao
          v-model="novoExame"
          :rotulo="t('exames.agendas.incluirExame')"
          :opcoes="escolhasExame"
        />
        <SanteSelecao
          v-model="conveniosDoExame"
          :rotulo="t('exames.agendas.convenioDoExame')"
          :opcoes="escolhasConvenioExame"
        />
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('exames.incluir')"
          :desabilitado="!novoExame || ocupado"
        />
      </form>

      <h3>{{ t('exames.escalas.titulo') }}</h3>
      <ul v-if="detalhe.data.value.escala.length">
        <li v-for="l in detalhe.data.value.escala" :key="`${l.semana}-${l.inicio}`">
          {{
            t('exames.escalas.linha', {
              dia: l.dia,
              de: l.inicio,
              ate: l.fim,
              duracao: l.duracao,
              exame: l.exame,
            })
          }}
        </li>
      </ul>
      <p v-else>{{ t('exames.escalas.vazia') }}</p>
      <p class="acoes">
        <RouterLink :to="`/agenda/exames/gerar?agenda=${detalhe.data.value.agenda.id}`">{{
          t('exames.gerar.titulo')
        }}</RouterLink>
        <RouterLink :to="`/agenda/exames/marcar?agenda=${detalhe.data.value.agenda.id}`">{{
          t('exames.marcar.titulo')
        }}</RouterLink>
      </p>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <ErroExame v-if="erro && ultimoConvenio === null" :erro="erro" />
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
