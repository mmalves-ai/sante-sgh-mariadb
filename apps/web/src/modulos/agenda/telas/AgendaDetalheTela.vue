<script setup lang="ts">
// Agenda (ficha do M17, seção 7): duração, situação e teleatendimento (agenda.alterarAgenda, com os valores lidos
// para o controle de colisão), convênios aceitos (agenda.definirCobertura: "sem restrição" explícito; remover o
// último pede confirmação; remover o PARTICULAR avisa; a lista dos marcados futuros com o convênio, mascarada),
// especialidades (agenda.definirEspecialidade) e a revisão da ligação com o profissional, a especialidade, o local e
// a unidade (SGH_AGE_AGENDA_LIGACAO: a unidade vale para o escopo de quem tem unidade restrita).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MarcadosComConvenio } from '@sgh/contratos';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import {
  alterarAgenda,
  codigoDaRecusa,
  definirConvenio,
  definirEspecialidade,
  lerAgenda,
  lerMarcadosComConvenio,
  novaChave,
  revisarLigacao,
} from '../api-agenda.js';
import AgendaEstruturadaPainel from '../componentes/AgendaEstruturadaPainel.vue';
import AvisoGravacao from '../componentes/AvisoGravacao.vue';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const agendaId = computed(() => Number(props.id));
const { opcoes, pode, motivoGravacao } = usarAgenda();
const detalhe = useQuery({
  queryKey: computed(() => ['agenda', 'agenda', agendaId.value]),
  queryFn: () => lerAgenda(agendaId.value),
});
const d = computed(() => detalhe.data.value);
const duracao = ref('15');
const tele = ref(false);
watch(
  d,
  (v) => {
    if (!v) return;
    duracao.value = String(v.versao.duracaoMinutos || 15);
    tele.value = v.versao.teleatendimento;
  },
  { immediate: true },
);
const podeAlterar = pode('agenda.alterarAgenda');
// ADR 0009: nomes dos convênios para as regras estruturadas e o particular da agenda (dono da regra de preço).
const nomesConvenio = computed<Record<number, string>>(() =>
  Object.fromEntries((opcoes.data.value?.convenios ?? []).map((c) => [c.codigo, c.nome])),
);
const particularDaAgenda = computed(() => d.value?.convenios.find((c) => c.particular)?.codigo ?? null);
const podeCobertura = pode('agenda.definirCobertura');
const podeEspecialidade = pode('agenda.definirEspecialidade');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['agenda'] });
}
async function rodar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    await recarregar();
    return true;
  } catch (e) {
    erro.value = e;
    if (codigoDaRecusa(e) === 'situacao-mudou') await recarregar();
    return false;
  }
}
function gravarDados(): Promise<boolean> {
  const v = d.value;
  if (!v) return Promise.resolve(false);
  const valores: { duracaoMinutos?: number; teleatendimento?: boolean } = {};
  const novaDuracao = Number(duracao.value);
  if (novaDuracao !== v.versao.duracaoMinutos) valores.duracaoMinutos = novaDuracao;
  if (tele.value !== v.versao.teleatendimento) valores.teleatendimento = tele.value;
  return rodar(() => alterarAgenda(v.agenda.id, { lidos: v.versao, valores }, novaChave('alterar')));
}
function trocarSituacao(): Promise<boolean> {
  const v = d.value;
  if (!v) return Promise.resolve(false);
  return rodar(() =>
    alterarAgenda(
      v.agenda.id,
      { lidos: v.versao, valores: { ativa: !v.agenda.ativa } },
      novaChave('situacao'),
    ),
  );
}

const novoConvenio = ref('');
const conveniosFora = computed(() => {
  const ja = new Set((d.value?.convenios ?? []).map((c) => c.codigo));
  return [
    { valor: '', rotulo: t('agenda.escolha') },
    ...(opcoes.data.value?.convenios ?? [])
      .filter((c) => c.ativo && !ja.has(c.codigo))
      .map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  ];
});
async function incluirConvenio(): Promise<void> {
  if (!novoConvenio.value) return;
  const ok = await rodar(() =>
    definirConvenio(
      agendaId.value,
      { convenio: Number(novoConvenio.value), acao: 'incluir' },
      novaChave('conv'),
    ),
  );
  if (ok) novoConvenio.value = '';
}
/** Texto da confirmação de remover: o último (passa a aceitar todos), o PARTICULAR ou com marcados futuros. */
function perguntaRemover(c: { codigo: number; nome: string; particular: boolean; marcadosFuturos: number }) {
  if ((d.value?.convenios.length ?? 0) === 1) return t('agenda.agendas.removerUltimo');
  if (c.particular) return t('agenda.agendas.removerParticular');
  if (c.marcadosFuturos > 0)
    return t('agenda.agendas.removerComMarcados', { nome: c.nome, n: c.marcadosFuturos });
  return t('agenda.agendas.removerPergunta', { nome: c.nome });
}
const podeVerMarcados = computed(() => podePermissao('agenda.marcacao.ler'));
const marcados = ref<MarcadosComConvenio | null>(null);
const marcadosDe = ref('');
async function verMarcados(codigo: number, nome: string): Promise<void> {
  erro.value = null;
  try {
    marcados.value = await lerMarcadosComConvenio(agendaId.value, codigo);
    marcadosDe.value = nome;
  } catch (e) {
    erro.value = e;
  }
}
function removerConvenio(codigo: number): Promise<boolean> {
  const ultimo = (d.value?.convenios.length ?? 0) === 1;
  return rodar(() =>
    definirConvenio(
      agendaId.value,
      { convenio: codigo, acao: 'remover', confirmarAceitarTodos: ultimo },
      novaChave('conv'),
    ),
  );
}

// ── Ligação revisada ──
const podeLigacao = pode('agenda.alterarAgenda');
const lProfissional = ref('');
const lEspecialidade = ref('');
const lLocal = ref('');
const lUnidade = ref('');
watch(
  d,
  (v) => {
    if (!v) return;
    const l = v.agenda.ligacao;
    lProfissional.value = l.profissional ? String(l.profissional.id) : '';
    lEspecialidade.value = l.especialidade ? String(l.especialidade.codigo) : '';
    lLocal.value = l.local ? String(l.local.codigo) : '';
    lUnidade.value = l.unidade ? String(l.unidade.codigo) : '';
  },
  { immediate: true },
);
const nenhum = computed(() => ({ valor: '', rotulo: t('agenda.agendas.nenhum') }));
const opcoesProfissional = computed(() => [
  nenhum.value,
  ...(d.value?.profissionais ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome })),
]);
const opcoesEspecialidade = computed(() => [
  nenhum.value,
  ...(opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
]);
const opcoesLocal = computed(() => [
  nenhum.value,
  ...(opcoes.data.value?.locais ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
]);
const opcoesUnidade = computed(() => [
  nenhum.value,
  ...(opcoes.data.value?.unidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
]);
const numOuNulo = (v: string) => (v ? Number(v) : null);
function gravarLigacao(): Promise<boolean> {
  return rodar(() =>
    revisarLigacao(
      agendaId.value,
      {
        profissional: numOuNulo(lProfissional.value),
        especialidade: numOuNulo(lEspecialidade.value),
        local: numOuNulo(lLocal.value),
        unidade: numOuNulo(lUnidade.value),
      },
      novaChave('ligacao'),
    ),
  );
}

const novaEspecialidade = ref('');
const especialidadesFora = computed(() => {
  const ja = new Set((d.value?.especialidades ?? []).map((e) => e.codigo));
  return [
    { valor: '', rotulo: t('agenda.escolha') },
    ...(opcoes.data.value?.especialidades ?? [])
      .filter((e) => !ja.has(e.codigo))
      .map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
  ];
});
async function incluirEspecialidade(): Promise<void> {
  if (!novaEspecialidade.value) return;
  const ok = await rodar(() =>
    definirEspecialidade(
      agendaId.value,
      { especialidade: Number(novaEspecialidade.value), acao: 'incluir' },
      novaChave('esp'),
    ),
  );
  if (ok) novaEspecialidade.value = '';
}
function removerEspecialidade(codigo: number): Promise<boolean> {
  return rodar(() =>
    definirEspecialidade(agendaId.value, { especialidade: codigo, acao: 'remover' }, novaChave('esp')),
  );
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="agenda-titulo" data-testid="tela-agenda">
    <RouterLink to="/agenda/consultas/agendas">{{ t('agenda.voltar') }}</RouterLink>
    <ErroAgenda v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!d" role="status">{{ t('agenda.carregando') }}</p>
    <template v-else>
      <h1 id="agenda-titulo">{{ t('agenda.agendas.detalhe', { nome: d.agenda.nome }) }}</h1>
      <AvisoGravacao :motivo="motivoGravacao" />
      <p class="secundario">
        {{ d.agenda.ativa ? t('agenda.agendas.ativa') : t('agenda.agendas.inativa') }} ·
        {{ t('agenda.agendas.colunas.duracao') }} {{ horaBr(d.agenda.duracao) }}
        <RouterLink :to="{ path: '/agenda/consultas/escalas', query: { agenda: d.agenda.id } }">
          · {{ t('agenda.agendas.escala') }}
        </RouterLink>
      </p>

      <section class="painel" aria-labelledby="agenda-dados">
        <h2 id="agenda-dados">{{ t('agenda.agendas.colunas.situacao') }}</h2>
        <form class="filtros" @submit.prevent="gravarDados">
          <div class="campo">
            <label for="agenda-duracao">{{ t('agenda.agendas.duracao') }}</label>
            <input
              id="agenda-duracao"
              v-model="duracao"
              type="number"
              min="5"
              max="480"
              step="5"
              :disabled="!podeAlterar"
            />
          </div>
          <label
            ><input v-model="tele" type="checkbox" :disabled="!podeAlterar" />
            {{ t('agenda.agendas.tele') }}</label
          >
          <SanteBotao v-if="podeAlterar" tipo="submit" :rotulo="t('agenda.agendas.alterar')" />
          <SanteBotao
            v-if="podeAlterar && d.agenda.ativa"
            key="inativar"
            variante="destrutivo"
            :rotulo="t('agenda.agendas.inativar')"
            :confirmacao="t('agenda.agendas.inativarPergunta', { nome: d.agenda.nome })"
            @acionar="trocarSituacao"
          />
          <SanteBotao
            v-else-if="podeAlterar"
            key="reativar"
            variante="secundario"
            :rotulo="t('agenda.agendas.reativar')"
            @acionar="trocarSituacao"
          />
        </form>
      </section>

      <section class="painel" aria-labelledby="agenda-convenios">
        <h2 id="agenda-convenios">{{ t('agenda.agendas.convenios') }}</h2>
        <SanteAlerta v-if="d.aceitaTodos" variante="info" :texto="t('agenda.semRestricao')" />
        <table v-else class="tabela" data-testid="agenda-convenios">
          <caption class="sgh-visualmente-oculto">
            {{
              t('agenda.agendas.convenios')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('agenda.convenio') }}</th>
              <th scope="col">{{ t('agenda.agendas.colunas.situacao') }}</th>
              <th scope="col">{{ t('agenda.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in d.convenios" :key="c.codigo">
              <td>{{ c.nome }}</td>
              <td>
                {{ c.ativo ? t('agenda.agendas.ativa') : t('agenda.agendas.inativa') }}
                <span v-if="c.marcadosFuturos > 0" class="secundario">
                  · {{ t('agenda.agendas.marcadosFuturos', { n: c.marcadosFuturos }) }}
                </span>
                <SanteBotao
                  v-if="c.marcadosFuturos > 0 && podeVerMarcados"
                  variante="texto"
                  :rotulo="t('agenda.agendas.verMarcados', { nome: c.nome })"
                  @acionar="verMarcados(c.codigo, c.nome)"
                />
              </td>
              <td>
                <SanteBotao
                  v-if="podeCobertura"
                  variante="destrutivo"
                  :rotulo="t('agenda.agendas.remover', { nome: c.nome })"
                  :confirmacao="perguntaRemover(c)"
                  @acionar="removerConvenio(c.codigo)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <section v-if="marcados" aria-labelledby="agenda-marcados" data-testid="agenda-marcados">
          <h3 id="agenda-marcados">{{ t('agenda.agendas.marcadosCom', { nome: marcadosDe }) }}</h3>
          <p v-if="marcados.itens.length === 0">{{ t('agenda.agendas.semMarcados') }}</p>
          <ul v-else>
            <li v-for="m in marcados.itens" :key="m.id">
              <RouterLink :to="`/agenda/consultas/marcacoes/${m.id}`">
                {{ dataBr(m.data) }} {{ horaBr(m.hora) }} · {{ m.paciente }}
              </RouterLink>
            </li>
          </ul>
          <p v-if="marcados.truncado" class="secundario">{{ t('agenda.truncado') }}</p>
        </section>
        <form v-if="podeCobertura" class="filtros" @submit.prevent="incluirConvenio">
          <SanteSelecao
            v-model="novoConvenio"
            :rotulo="t('agenda.agendas.incluirConvenio')"
            :opcoes="conveniosFora"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('agenda.agendas.incluirConvenio')"
            :desabilitado="!novoConvenio"
          />
        </form>
      </section>

      <section class="painel" aria-labelledby="agenda-especialidades">
        <h2 id="agenda-especialidades">{{ t('agenda.agendas.especialidades') }}</h2>
        <ul>
          <li v-for="e in d.especialidades" :key="e.codigo" class="acoes">
            {{ e.nome }}
            <SanteBotao
              v-if="podeEspecialidade"
              variante="destrutivo"
              :rotulo="t('agenda.agendas.remover', { nome: e.nome })"
              :confirmacao="t('agenda.agendas.removerPergunta', { nome: e.nome })"
              @acionar="removerEspecialidade(e.codigo)"
            />
          </li>
        </ul>
        <form v-if="podeEspecialidade" class="filtros" @submit.prevent="incluirEspecialidade">
          <SanteSelecao
            v-model="novaEspecialidade"
            :rotulo="t('agenda.agendas.incluirEspecialidade')"
            :opcoes="especialidadesFora"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('agenda.agendas.incluirEspecialidade')"
            :desabilitado="!novaEspecialidade"
          />
        </form>
      </section>

      <section class="painel" aria-labelledby="agenda-ligacao">
        <h2 id="agenda-ligacao">{{ t('agenda.agendas.ligacao') }}</h2>
        <p v-if="d.agenda.ligacao.situacao === 'sem-ligacao'">{{ t('agenda.agendas.semLigacao') }}</p>
        <template v-else>
          <p>
            {{ t('agenda.agendas.profissional') }}: {{ d.agenda.ligacao.profissional?.nome ?? '—' }} ·
            {{ t('agenda.agendas.especialidade') }}: {{ d.agenda.ligacao.especialidade?.nome ?? '—' }}
          </p>
          <p>
            {{ t('agenda.local') }}: {{ d.agenda.ligacao.local?.nome ?? '—' }} · {{ t('agenda.unidade') }}:
            {{ d.agenda.ligacao.unidade?.nome ?? '—' }}
          </p>
          <p class="secundario">
            {{
              d.agenda.ligacao.situacao === 'revisada'
                ? t('agenda.agendas.ligacaoRevisada')
                : t('agenda.agendas.ligacaoProposta')
            }}
          </p>
        </template>
        <form v-if="podeLigacao" class="filtros" data-testid="form-ligacao" @submit.prevent="gravarLigacao">
          <p class="secundario">{{ t('agenda.agendas.ligacaoTexto') }}</p>
          <SanteSelecao
            v-model="lProfissional"
            :rotulo="t('agenda.agendas.profissional')"
            :opcoes="opcoesProfissional"
          />
          <SanteSelecao
            v-model="lEspecialidade"
            :rotulo="t('agenda.agendas.especialidade')"
            :opcoes="opcoesEspecialidade"
          />
          <SanteSelecao v-model="lLocal" :rotulo="t('agenda.local')" :opcoes="opcoesLocal" />
          <SanteSelecao v-model="lUnidade" :rotulo="t('agenda.unidade')" :opcoes="opcoesUnidade" />
          <SanteBotao
            tipo="submit"
            :rotulo="
              d.agenda.ligacao.situacao === 'revisada'
                ? t('agenda.agendas.revisarLigacao')
                : t('agenda.agendas.confirmarLigacao')
            "
            data-testid="botao-ligacao"
          />
        </form>
      </section>

      <AgendaEstruturadaPainel
        :agenda-id="d.agenda.id"
        :nomes-convenio="nomesConvenio"
        :particular-id="particularDaAgenda"
        :pode-editar="podeAlterar"
      />
    </template>
    <p v-if="mensagem" role="status" data-testid="agenda-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
