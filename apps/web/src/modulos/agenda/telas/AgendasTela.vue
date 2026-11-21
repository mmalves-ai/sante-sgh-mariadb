<script setup lang="ts">
// Agendas de consulta (ficha do M17, seção 7): `/agenda/consultas/agendas`. Lista com filtro por nome, situação e
// especialidade; inclusão de agenda nova (agenda.incluirAgenda). O detalhe (cobertura, especialidades, ligação,
// duração e situação) abre na tela da agenda.
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { incluirAgenda, listarAgendas, novaChave } from '../api-agenda.js';
import AvisoGravacao from '../componentes/AvisoGravacao.vue';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';

const { t } = useI18n();
const podeIndicadores = computed(() => podePermissao('agenda.indicador.ler'));
const roteador = useRouter();
const cliente = useQueryClient();
const { opcoes, pode, motivoGravacao } = usarAgenda();
const termo = ref('');
const situacao = ref<'todas' | 'ativas' | 'inativas' | 'vigentes'>('ativas');
const especialidade = ref('');
const filtro = ref({ termo: '', situacao: 'ativas', especialidade: '' });
const lista = useQuery({
  queryKey: computed(() => ['agenda', 'agendas', filtro.value]),
  queryFn: () =>
    listarAgendas({
      termo: filtro.value.termo,
      situacao: filtro.value.situacao === 'todas' ? '' : filtro.value.situacao,
      especialidade: filtro.value.especialidade ? Number(filtro.value.especialidade) : null,
    }),
});
const situacoes = computed(() =>
  (['todas', 'ativas', 'inativas', 'vigentes'] as const).map((v) => ({
    valor: v,
    rotulo: t(`agenda.agendas.situacoes.${v}`),
  })),
);
const especialidades = computed(() => [
  { valor: '', rotulo: t('agenda.escolha') },
  ...(opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
]);
function filtrar(): void {
  filtro.value = { termo: termo.value.trim(), situacao: situacao.value, especialidade: especialidade.value };
}

const podeIncluir = pode('agenda.incluirAgenda');
const abrindo = ref(false);
const nome = ref('');
const duracao = ref('15');
const tele = ref(false);
const chave = ref(novaChave('incluir'));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function incluir(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await incluirAgenda(
      { nome: nome.value, duracaoMinutos: Number(duracao.value), teleatendimento: tele.value },
      chave.value,
    );
    mensagem.value = t('agenda.agendas.incluida');
    chave.value = novaChave('incluir');
    await cliente.invalidateQueries({ queryKey: ['agenda', 'agendas'] });
    const id = Number(r.resultado['agenda']);
    if (id) await roteador.push(`/agenda/consultas/agendas/${id}`);
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="agendas-titulo" data-testid="tela-agendas">
    <h1 id="agendas-titulo">{{ t('agenda.agendas.titulo') }}</h1>
    <p>{{ t('agenda.agendas.texto') }}</p>
    <p v-if="podeIndicadores">
      <RouterLink to="/agenda/consultas/indicadores">{{ t('agenda.linkIndicadores') }}</RouterLink>
    </p>
    <AvisoGravacao :motivo="motivoGravacao" />

    <form class="filtros" role="search" @submit.prevent="filtrar">
      <div class="campo">
        <label for="agendas-termo">{{ t('agenda.agendas.termo') }}</label>
        <input
          id="agendas-termo"
          v-model="termo"
          type="search"
          autocomplete="off"
          data-testid="agendas-termo"
        />
      </div>
      <SanteSelecao v-model="situacao" :rotulo="t('agenda.agendas.situacao')" :opcoes="situacoes" />
      <SanteSelecao
        v-model="especialidade"
        :rotulo="t('agenda.marcar.especialidade')"
        :opcoes="especialidades"
      />
      <SanteBotao tipo="submit" :rotulo="t('agenda.agendas.buscar')" />
    </form>

    <ErroAgenda v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('agenda.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('agenda.nenhuma') }}</p>
    <table v-else class="tabela" data-testid="tabela-agendas">
      <caption>
        {{
          t('agenda.agendas.titulo')
        }}
        ({{
          lista.data.value.total
        }})
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('agenda.agendas.colunas.nome') }}</th>
          <th scope="col">{{ t('agenda.agendas.colunas.profissional') }}</th>
          <th scope="col">{{ t('agenda.agendas.colunas.duracao') }}</th>
          <th scope="col">{{ t('agenda.agendas.colunas.situacao') }}</th>
          <th scope="col">{{ t('agenda.agendas.colunas.grade') }}</th>
          <th scope="col">{{ t('agenda.agendas.colunas.convenios') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in lista.data.value.itens" :key="a.id" :data-testid="`agenda-${a.id}`">
          <td>
            <RouterLink
              :to="`/agenda/consultas/agendas/${a.id}`"
              :aria-label="t('agenda.agendas.abrir', { nome: a.nome })"
            >
              {{ a.nome }}
            </RouterLink>
          </td>
          <td>{{ a.ligacao.profissional?.nome ?? a.profissional ?? '' }}</td>
          <td>{{ horaBr(a.duracao) }}</td>
          <td>{{ a.ativa ? t('agenda.agendas.ativa') : t('agenda.agendas.inativa') }}</td>
          <td>{{ dataBr(a.gradeFim) }}</td>
          <td>{{ a.convenios === 0 ? t('agenda.agendas.todos') : a.convenios }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="podeIncluir" class="painel" aria-labelledby="agendas-nova">
      <h2 id="agendas-nova">{{ t('agenda.agendas.nova') }}</h2>
      <SanteBotao
        v-if="!abrindo"
        variante="secundario"
        :rotulo="t('agenda.agendas.nova')"
        @acionar="abrindo = true"
      />
      <form v-else class="filtros" @submit.prevent="incluir">
        <SanteCampoTexto v-model="nome" :rotulo="t('agenda.agendas.nome')" :max-bytes="40" obrigatorio />
        <div class="campo">
          <label for="agendas-duracao">{{ t('agenda.agendas.duracao') }}</label>
          <input id="agendas-duracao" v-model="duracao" type="number" min="5" max="480" step="5" required />
        </div>
        <label><input v-model="tele" type="checkbox" /> {{ t('agenda.agendas.tele') }}</label>
        <SanteBotao tipo="submit" :rotulo="t('agenda.salvar')" />
      </form>
    </section>
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <ErroAgenda v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
