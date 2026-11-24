<script setup lang="ts">
// Lista de espera e remarcação em lote (ficha do M17, seção 7): `/agenda/espera`. Fila por agenda ou especialidade
// na ordem de prioridade e antiguidade (só do novo); oferta da vaga e marcação a partir da fila
// (agenda.agendarConsulta). A remarcação em lote leva as marcações de um dia da agenda para as vagas de outro dia,
// uma transação por consulta, e lista as recusadas.
import type { ResultadoBuscaPaciente, ResultadoLote } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import {
  buscarVagas,
  encerrarEspera,
  incluirEspera,
  lerPainelDia,
  listarEspera,
  marcarEspera,
  novaChave,
  ofertarEspera,
  remarcarLote,
} from '../api-agenda.js';
import AvisoGravacao from '../componentes/AvisoGravacao.vue';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr, horaDoContrato } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { opcoes, opcoesAgenda, pode, motivoGravacao, gravacao } = usarAgenda();
const { permissoes } = usarSessao();
const podeEditar = computed(
  () => (gravacao.data.value?.ligada ?? false) && permissoes.value.has('agenda.espera.editar'),
);
const podeMarcar = pode('agenda.agendarConsulta');
const podeRemarcar = pode('agenda.remarcarConsulta');
const lista = useQuery({ queryKey: ['agenda', 'espera'], queryFn: () => listarEspera() });
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const comVazio = (l: { valor: string; rotulo: string }[]) => [
  { valor: '', rotulo: t('agenda.escolha') },
  ...l,
];
const agendas = computed(() => comVazio(opcoesAgenda.value));
const especialidades = computed(() =>
  comVazio(
    (opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
  ),
);
const convenios = computed(() =>
  comVazio(
    (opcoes.data.value?.convenios ?? [])
      .filter((c) => c.ativo)
      .map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  ),
);
const canais = computed(() =>
  (opcoes.data.value?.canais ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
);
// 02-AGE 48: urgência clínica (critério próprio) e o grupo de prioridade legal da senha e da marcação.
const urgencias = computed(() =>
  (['normal', 'urgente'] as const).map((v) => ({
    valor: v,
    rotulo: t(`agenda.espera.prioridades.${v}`),
  })),
);
const gruposLegais = computed(() => [
  { valor: '', rotulo: t('agenda.espera.prioridadeLegalAuto') },
  ...(opcoes.data.value?.gruposPrioridadeLegal ?? []).map((g) => ({
    valor: String(g.codigo),
    rotulo: g.nome,
  })),
]);

async function rodar(fn: () => Promise<{ mensagem: string }>, texto?: string): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await fn();
    mensagem.value = texto ?? r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

// ── Incluir ──
const termo = ref('');
const pedido = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['agenda', 'espera-pac', pedido.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string } | null>(null);
const iAgenda = ref('');
const iEspecialidade = ref('');
const iPrioridade = ref<'normal' | 'urgente'>('normal');
const iGrupoLegal = ref('');
async function incluir(): Promise<void> {
  if (!paciente.value) return;
  const ok = await rodar(
    () =>
      incluirEspera(
        {
          paciente: paciente.value?.id,
          agenda: iAgenda.value ? Number(iAgenda.value) : null,
          especialidade: iEspecialidade.value ? Number(iEspecialidade.value) : null,
          prioridade: iPrioridade.value,
          prioridadeLegal: iGrupoLegal.value ? Number(iGrupoLegal.value) : null,
        },
        novaChave('espera'),
      ),
    t('agenda.espera.incluido'),
  );
  if (ok) {
    paciente.value = null;
    iGrupoLegal.value = '';
  }
}

// ── Ofertar e marcar ──
const alvo = ref<number | null>(null);
const oAgenda = ref('');
const oData = ref('');
const oHora = ref('');
const oConvenio = ref('');
const oCanal = ref('telefone');
const ofertar = (id: number) =>
  rodar(() =>
    ofertarEspera(
      id,
      { agenda: Number(oAgenda.value), data: oData.value, hora: horaDoContrato(oHora.value) ?? oHora.value },
      novaChave('ofertar'),
    ),
  );
const marcar = (id: number) =>
  rodar(() =>
    marcarEspera(
      id,
      {
        agenda: Number(oAgenda.value),
        data: oData.value,
        hora: horaDoContrato(oHora.value) ?? oHora.value,
        convenio: Number(oConvenio.value),
        canal: oCanal.value,
      },
      novaChave('marcar-espera'),
    ),
  );
function abrir(
  id: number,
  oferta: { agenda: number; data: string; hora: string } | null,
  agenda: number | null,
): void {
  alvo.value = alvo.value === id ? null : id;
  oAgenda.value = String(oferta?.agenda ?? agenda ?? '');
  oData.value = oferta?.data ?? '';
  oHora.value = oferta ? horaBr(oferta.hora) : '';
}

// ── Remarcação em lote ──
// Vindo do bloqueio (agenda e dia de origem na rota): a remarcação em lote já começa preenchida.
const rota = useRoute();
const daRota = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');
const lAgenda = ref(daRota('agenda'));
const lOrigem = ref(daRota('origem'));
const lDestino = ref('');
const lCanal = ref('telefone');
const lModo = ref<'transferir' | 'liberar'>('liberar');
const resultadoLote = ref<ResultadoLote | null>(null);
const modos = computed(() =>
  (['transferir', 'liberar'] as const).map((v) => ({ valor: v, rotulo: t(`agenda.marcacao.modos.${v}`) })),
);
async function remarcarDia(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  resultadoLote.value = null;
  try {
    const ag = Number(lAgenda.value);
    const [dia, vagas] = await Promise.all([
      lerPainelDia(lOrigem.value, ag),
      buscarVagas({ agenda: ag, de: lDestino.value, ate: lDestino.value }),
    ]);
    const alvos = dia.marcacoes.filter((m) => m.acoes.remarcar);
    const livres = vagas.vagas.filter((v) => v.agenda === ag);
    if (livres.length < alvos.length) {
      mensagem.value = t('agenda.espera.semVagaDestino');
      return;
    }
    if (alvos.length === 0) {
      mensagem.value = t('agenda.nenhuma');
      return;
    }
    resultadoLote.value = await remarcarLote(
      {
        itens: alvos.map((m, i) => ({
          marcacao: m.id,
          destino: { agenda: ag, data: lDestino.value, hora: horaDoContrato(livres[i]?.hora) ?? '' },
        })),
        modo: lModo.value,
        canal: lCanal.value,
      },
      novaChave('lote'),
    );
    mensagem.value = t('agenda.espera.resultadoLote', resultadoLote.value);
    await cliente.invalidateQueries({ queryKey: ['agenda'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="espera-titulo" data-testid="tela-espera">
    <h1 id="espera-titulo">{{ t('agenda.espera.titulo') }}</h1>
    <p>{{ t('agenda.espera.texto') }}</p>
    <AvisoGravacao :motivo="motivoGravacao" />

    <section v-if="podeEditar" class="painel" aria-labelledby="espera-incluir">
      <h2 id="espera-incluir">{{ t('agenda.espera.incluir') }}</h2>
      <form class="filtros" role="search" @submit.prevent="pedido = termo.trim()">
        <div class="campo">
          <label for="espera-termo">{{ t('agenda.marcar.termoPaciente') }}</label>
          <input
            id="espera-termo"
            v-model="termo"
            type="search"
            autocomplete="off"
            data-testid="espera-termo"
          />
        </div>
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('agenda.marcar.buscarPaciente')" />
      </form>
      <ul v-if="pacientes.data.value && !paciente">
        <li v-for="p in pacientes.data.value.itens" :key="p.id">
          <SanteBotao
            variante="texto"
            :rotulo="t('agenda.marcar.escolherPaciente', { nome: p.nomeSocial ?? p.nome })"
            :data-testid="`espera-paciente-${p.id}`"
            @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome }"
          />
        </li>
      </ul>
      <form v-if="paciente" class="filtros" @submit.prevent="incluir">
        <p>{{ t('agenda.marcar.pacienteEscolhido', { nome: paciente.nome }) }}</p>
        <SanteSelecao v-model="iAgenda" :rotulo="t('agenda.agenda')" :opcoes="agendas" />
        <SanteSelecao
          v-model="iEspecialidade"
          :rotulo="t('agenda.marcar.especialidade')"
          :opcoes="especialidades"
        />
        <SanteSelecao
          v-model="iPrioridade"
          :rotulo="t('agenda.espera.urgencia')"
          :opcoes="urgencias"
          data-testid="espera-urgencia"
        />
        <SanteSelecao
          v-model="iGrupoLegal"
          :rotulo="t('agenda.espera.prioridadeLegal')"
          :opcoes="gruposLegais"
          data-testid="espera-prioridade-legal"
        />
        <p>{{ t('agenda.espera.prioridadeLegalTexto') }}</p>
        <SanteBotao tipo="submit" :rotulo="t('agenda.espera.incluir')" data-testid="botao-incluir-espera" />
      </form>
    </section>

    <ErroAgenda v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('agenda.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('agenda.nenhuma') }}</p>
    <table v-else class="tabela" data-testid="tabela-espera">
      <caption>
        {{
          t('agenda.espera.titulo')
        }}
        ({{
          lista.data.value.total
        }})
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('agenda.espera.posicao') }}</th>
          <th scope="col">{{ t('agenda.paciente') }}</th>
          <th scope="col">{{ t('agenda.agenda') }}</th>
          <th scope="col">{{ t('agenda.espera.prioridade') }}</th>
          <th scope="col">{{ t('agenda.espera.desde') }}</th>
          <th scope="col">{{ t('agenda.espera.situacao') }}</th>
          <th scope="col">{{ t('agenda.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="e in lista.data.value.itens" :key="e.id">
          <tr :data-testid="`espera-${e.id}`">
            <td>{{ e.posicao ?? '—' }}</td>
            <td>{{ e.paciente }}</td>
            <td>{{ e.nomeAgenda ?? e.especialidade?.nome ?? '—' }}</td>
            <td :data-testid="`espera-prioridade-${e.id}`">
              {{ t(`agenda.espera.prioridades.${e.prioridade}`) }}
              <template v-if="e.prioridadeLegal"> · {{ e.prioridadeLegal.descricao }}</template>
            </td>
            <td>{{ dataBr(e.desde) }}</td>
            <td>
              {{ t(`agenda.espera.situacoes.${e.situacao}`) }}
              <template v-if="e.oferta"> ({{ dataBr(e.oferta.data) }} {{ horaBr(e.oferta.hora) }})</template>
            </td>
            <td class="acoes">
              <SanteBotao
                v-if="podeEditar || podeMarcar"
                variante="secundario"
                :rotulo="t('agenda.espera.marcar')"
                :data-testid="`abrir-espera-${e.id}`"
                @acionar="abrir(e.id, e.oferta, e.agenda)"
              />
              <SanteBotao
                v-if="podeEditar && e.situacao === 'ofertado'"
                variante="texto"
                :rotulo="t('agenda.espera.devolver')"
                @acionar="
                  rodar(() => encerrarEspera(e.id, { situacao: 'aguardando' }, novaChave('devolver')))
                "
              />
              <SanteBotao
                v-if="podeEditar"
                variante="destrutivo"
                :rotulo="t('agenda.espera.retirar')"
                :confirmacao="t('agenda.espera.retirarPergunta', { paciente: e.paciente })"
                @acionar="rodar(() => encerrarEspera(e.id, { situacao: 'cancelado' }, novaChave('retirar')))"
              />
            </td>
          </tr>
          <tr v-if="alvo === e.id">
            <td colspan="7">
              <form class="filtros" @submit.prevent="marcar(e.id)">
                <SanteSelecao v-model="oAgenda" :rotulo="t('agenda.agenda')" :opcoes="agendas" />
                <div class="campo">
                  <label :for="`oferta-data-${e.id}`">{{ t('agenda.data') }}</label>
                  <input
                    :id="`oferta-data-${e.id}`"
                    v-model="oData"
                    type="date"
                    required
                    data-testid="espera-data"
                  />
                </div>
                <div class="campo">
                  <label :for="`oferta-hora-${e.id}`">{{ t('agenda.hora') }}</label>
                  <input
                    :id="`oferta-hora-${e.id}`"
                    v-model="oHora"
                    inputmode="numeric"
                    required
                    data-testid="espera-hora"
                  />
                </div>
                <SanteSelecao v-model="oConvenio" :rotulo="t('agenda.convenio')" :opcoes="convenios" />
                <SanteSelecao v-model="oCanal" :rotulo="t('agenda.canal')" :opcoes="canais" />
                <SanteBotao
                  v-if="podeEditar && e.situacao === 'aguardando'"
                  variante="secundario"
                  :rotulo="t('agenda.espera.ofertar')"
                  @acionar="ofertar(e.id)"
                />
                <SanteBotao
                  v-if="podeMarcar"
                  tipo="submit"
                  :rotulo="t('agenda.espera.marcar')"
                  :desabilitado="!oAgenda || !oData || !oHora || !oConvenio"
                  data-testid="botao-marcar-espera"
                />
              </form>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <section v-if="podeRemarcar" class="painel" aria-labelledby="espera-lote">
      <h2 id="espera-lote">{{ t('agenda.espera.lote') }}</h2>
      <p>{{ t('agenda.espera.loteTexto') }}</p>
      <form class="filtros" @submit.prevent="remarcarDia">
        <SanteSelecao v-model="lAgenda" :rotulo="t('agenda.agenda')" :opcoes="agendas" />
        <div class="campo">
          <label for="lote-origem">{{ t('agenda.espera.origem') }}</label>
          <input id="lote-origem" v-model="lOrigem" type="date" required />
        </div>
        <div class="campo">
          <label for="lote-destino">{{ t('agenda.espera.destinoData') }}</label>
          <input id="lote-destino" v-model="lDestino" type="date" required />
        </div>
        <SanteSelecao v-model="lModo" :rotulo="t('agenda.marcacao.modo')" :opcoes="modos" />
        <SanteSelecao v-model="lCanal" :rotulo="t('agenda.canal')" :opcoes="canais" />
        <SanteBotao tipo="submit" :rotulo="t('agenda.espera.lote')" :desabilitado="!lAgenda" />
      </form>
      <ul v-if="resultadoLote">
        <li v-for="i in resultadoLote.itens.filter((x) => !x.ok)" :key="i.marcacao">
          <RouterLink :to="`/agenda/consultas/marcacoes/${i.marcacao}`">#{{ i.marcacao }}</RouterLink> ·
          {{ i.mensagem }}
        </li>
      </ul>
      <SanteAlerta
        v-if="resultadoLote && resultadoLote.recusados > 0"
        variante="aviso"
        :texto="t('agenda.espera.resultadoLote', resultadoLote)"
      />
    </section>

    <p v-if="mensagem" role="status" data-testid="espera-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
