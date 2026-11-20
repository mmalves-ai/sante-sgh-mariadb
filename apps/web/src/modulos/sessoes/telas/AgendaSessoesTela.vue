<script setup lang="ts">
// Agenda de sessões e recursos (ficha do M50, seção 7; regra 11): `/agenda/sessoes`. A grade das cadeiras e salas
// (linhas) pelos dias (colunas), com as sessões de cada uma; a série nova de um plano terapêutico (o paciente pela busca
// do cadastro, a cadeira ou sala, a complexidade e a duração do domínio, as datas e os conflitos antes de gravar); a
// sessão escolhida (realizada, falta, cancelamento, as restantes da série) e as sessões do paciente; e os cadastros das
// agendas, das cadeiras e das salas (CRUD genérico) embutidos. As ações aparecem só com a permissão e a funcionalidade
// liberada; o servidor confere de novo.
import {
  type AcaoSessao,
  type AgendarSessaoEntrada,
  type PreviaSerieSessoes,
  type ResultadoBuscaPaciente,
  type SessaoLida,
  TIPOS_PLANO_SESSAO,
  type TipoPlanoSessao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import ErroSessoes from '../componentes/ErroSessoes.vue';
import {
  agendarSerie,
  atualizarSessao,
  lerGradeSessoes,
  lerGravacaoSessoes,
  lerSessoesDoPaciente,
  novaChaveSessao,
  previaSerie,
} from '../api-sessoes.js';
import { combinaBusca, diasDaGrade, hora, quando, somarDias } from '../regras-sessoes.js';

const { t } = useI18n();
const gravacao = useQuery({
  queryKey: ['sessoes', 'gravacao'],
  queryFn: lerGravacaoSessoes,
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['agendar']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['agendar']?.motivo ?? null);

// ── Grade ──
const de = ref<string | null>(null);
const dias = ref(7);
const agenda = ref<number | null>(null);
const grade = useQuery({
  queryKey: computed(() => ['sessoes', 'grade', de.value, dias.value, agenda.value]),
  queryFn: () => lerGradeSessoes(de.value, dias.value, agenda.value),
});
watch(
  () => grade.data.value?.de,
  (d) => {
    if (d && !de.value) de.value = d;
  },
);
const busca = ref('');
const colunas = computed(() =>
  grade.data.value ? diasDaGrade(grade.data.value.de, grade.data.value.ate) : [],
);
const agendas = computed(() => {
  const m = new Map<number, string>();
  for (const r of grade.data.value?.recursos ?? []) m.set(r.agenda, r.nomeAgenda);
  return [
    { valor: null as number | null, rotulo: t('sessoes.todas') },
    ...[...m].map(([valor, rotulo]) => ({ valor: valor as number | null, rotulo })),
  ];
});
const nomeComplexidade = (c: number) =>
  grade.data.value?.complexidades.find((x) => x.codigo === c)?.nome ?? String(c);
const nomeDuracao = (c: number) => grade.data.value?.duracoes.find((x) => x.codigo === c)?.nome ?? String(c);
function sessoesNaCelula(recurso: number, dia: string): SessaoLida[] {
  return (grade.data.value?.sessoes ?? []).filter(
    (s) =>
      s.recurso === recurso &&
      s.inicio.startsWith(dia) &&
      combinaBusca(busca.value, [s.nome, s.prontuario, s.plano]),
  );
}
const mover = (n: number) => {
  if (de.value) de.value = somarDias(de.value, n);
};

// ── Mensagens ──
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function agir<T>(fn: () => Promise<T>): Promise<T | null> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    return await fn();
  } catch (x) {
    erro.value = x;
    return null;
  } finally {
    ocupado.value = false;
  }
}

// ── Nova série ──
const termo = ref('');
const pedido = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['sessoes', 'pacientes', pedido.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string } | null>(null);
const recurso = ref<number | null>(null);
const complexidade = ref<number | null>(null);
const duracao = ref<number | null>(null);
const minutos = ref(60);
const planoTipo = ref<TipoPlanoSessao>('quimioterapia');
const plano = ref('');
const inicio = ref<string | null>(null);
const horaInicio = ref('0800');
const quantas = ref(1);
const intervalo = ref(7);
const pular = ref(true);
const observacao = ref('');
const previa = ref<PreviaSerieSessoes | null>(null);
const opcoesRecurso = computed(() =>
  (grade.data.value?.recursos ?? [])
    .filter((r) => r.ativo)
    .map((r) => ({ valor: r.recurso as number | null, rotulo: `${r.identificacao} · ${r.nomeAgenda}` })),
);
const opcoesComplexidade = computed(() =>
  (grade.data.value?.complexidades ?? [])
    .filter((c) => c.codigo > 0)
    .map((c) => ({ valor: c.codigo as number | null, rotulo: c.nome })),
);
const opcoesDuracao = computed(() =>
  (grade.data.value?.duracoes ?? [])
    .filter((c) => c.codigo > 0)
    .map((c) => ({ valor: c.codigo as number | null, rotulo: c.nome })),
);
const opcoesPlano = computed(() =>
  TIPOS_PLANO_SESSAO.map((p) => ({ valor: p, rotulo: t(`sessoes.planos.${p}`) })),
);
watch(
  [paciente, recurso, complexidade, duracao, minutos, inicio, horaInicio, quantas, intervalo, pular],
  () => {
    previa.value = null;
  },
);
const entrada = computed((): AgendarSessaoEntrada | null =>
  paciente.value && recurso.value && complexidade.value && duracao.value && inicio.value && plano.value.trim()
    ? {
        paciente: paciente.value.id,
        recurso: recurso.value,
        complexidade: complexidade.value,
        duracao: duracao.value,
        duracaoMin: Number(minutos.value),
        planoTipo: planoTipo.value,
        plano: plano.value.trim(),
        inicio: inicio.value,
        hora: horaInicio.value,
        sessoes: Number(quantas.value),
        intervaloDias: Number(intervalo.value),
        pularFimDeSemana: pular.value,
        ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
      }
    : null,
);
async function verPrevia(): Promise<void> {
  const e = entrada.value;
  if (!e) return;
  previa.value = await agir(() => previaSerie(e, novaChaveSessao('previa')));
}
async function agendar(): Promise<void> {
  const e = entrada.value;
  if (!e) return;
  const r = await agir(() => agendarSerie(e, novaChaveSessao('agendar')));
  if (!r) return;
  mensagem.value = r.mensagem;
  previa.value = null;
  plano.value = '';
  await grade.refetch();
}

// ── Sessão escolhida ──
const escolhida = ref<SessaoLida | null>(null);
const motivo = ref('');
const doPaciente = useQuery({
  queryKey: computed(() => ['sessoes', 'paciente', escolhida.value?.paciente ?? 0]),
  queryFn: () => lerSessoesDoPaciente(escolhida.value!.paciente),
  enabled: computed(() => escolhida.value !== null),
});
async function registrar(acao: AcaoSessao): Promise<void> {
  const s = escolhida.value;
  if (!s) return;
  const r = await agir(() =>
    atualizarSessao(
      {
        sessao: s.id,
        acao,
        versao: s.versao,
        ...(motivo.value.trim() ? { motivo: motivo.value.trim() } : {}),
      },
      novaChaveSessao(acao),
    ),
  );
  if (r) {
    mensagem.value = r.mensagem;
    escolhida.value = null;
    motivo.value = '';
  }
  await grade.refetch();
}
const exigeMotivo = computed(() => motivo.value.trim().length < 3);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sessoes-titulo" data-testid="tela-agenda-sessoes">
    <h1 id="sessoes-titulo">{{ t('sessoes.titulo') }}</h1>
    <p>{{ t('sessoes.texto') }}</p>
    <div
      v-if="gravacao.data.value && !gravacao.data.value.ligada"
      class="aviso"
      data-testid="sessoes-em-consulta"
    >
      <SanteAlerta variante="aviso" :texto="t('sessoes.emConsulta')" />
      <p>{{ gravacao.data.value.motivo }}</p>
    </div>
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="sessoes-mensagem" />
    <ErroSessoes v-if="erro" :erro="erro" />

    <form class="filtros" data-testid="sessoes-filtros" @submit.prevent="grade.refetch()">
      <SanteData v-model="de" :rotulo="t('sessoes.de')" editavel data-testid="sessoes-de" />
      <div class="campo">
        <label for="sessoes-dias">{{ t('sessoes.dias') }}</label>
        <input
          id="sessoes-dias"
          v-model.number="dias"
          type="number"
          min="1"
          max="14"
          data-testid="sessoes-dias"
        />
      </div>
      <SanteSelecao
        v-model="agenda"
        :rotulo="t('sessoes.agenda')"
        :opcoes="agendas"
        data-testid="sessoes-agenda"
      />
      <SanteBotao variante="secundario" :rotulo="t('sessoes.anterior')" @acionar="mover(-7)" />
      <SanteBotao variante="secundario" :rotulo="t('sessoes.proxima')" @acionar="mover(7)" />
    </form>

    <ErroSessoes v-if="grade.isError.value" :erro="grade.error.value" />
    <p v-else-if="!grade.data.value" role="status">{{ t('sessoes.carregando') }}</p>
    <template v-else>
      <p v-if="grade.data.value.cortada" role="status">{{ t('sessoes.cortada') }}</p>
      <p v-if="grade.data.value.recursos.length === 0">{{ t('sessoes.semRecursos') }}</p>
      <template v-else>
        <SanteCampoTexto
          v-model="busca"
          :rotulo="t('sessoes.buscar')"
          :max-bytes="60"
          data-testid="sessoes-busca"
        />
        <div class="rolagem" tabindex="0" role="region" :aria-label="t('sessoes.legenda')">
          <table class="tabela grade-sessoes" data-testid="grade-sessoes">
            <caption>
              {{
                t('sessoes.legenda')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('sessoes.recurso') }}</th>
                <th v-for="c in colunas" :key="c.dia" scope="col">{{ c.rotulo }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in grade.data.value.recursos"
                :key="r.recurso"
                :data-testid="`recurso-${r.recurso}`"
              >
                <th scope="row">
                  <strong>{{ r.identificacao }}</strong>
                  <span v-if="!r.ativo" class="chip">{{ t('sessoes.inativo') }}</span>
                  <div class="secundario">{{ r.nomeAgenda }}</div>
                  <div class="secundario">
                    {{
                      r.faixa
                        ? t('sessoes.faixa', { de: r.faixa.de, ate: r.faixa.ate })
                        : t('sessoes.semFaixa')
                    }}
                  </div>
                  <div class="secundario">
                    {{
                      t('sessoes.aceita', {
                        complexidade: nomeComplexidade(r.complexidade),
                        duracao: nomeDuracao(r.duracao),
                      })
                    }}
                  </div>
                </th>
                <td v-for="c in colunas" :key="c.dia">
                  <ul class="lista-simples">
                    <li v-for="s in sessoesNaCelula(r.recurso, c.dia)" :key="s.id">
                      <button
                        type="button"
                        :class="['sessao', `sessao--${s.situacao}`]"
                        :aria-label="t('sessoes.acoes.escolher', { nome: s.nome, hora: hora(s.inicio) })"
                        :data-testid="`sessao-${s.id}`"
                        @click="escolhida = s"
                      >
                        <strong>{{
                          t('sessoes.intervalo', { de: hora(s.inicio), ate: hora(s.fim) })
                        }}</strong>
                        {{ s.nome }}
                        <span class="secundario">
                          · {{ t('sessoes.sessaoDe', { ordem: s.ordem, total: s.total }) }} ·
                          {{ t(`sessoes.situacoes.${s.situacao}`) }}</span
                        >
                      </button>
                    </li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <section
        v-if="escolhida"
        class="painel"
        aria-labelledby="sessoes-escolhida"
        data-testid="sessao-escolhida"
      >
        <h2 id="sessoes-escolhida">{{ t('sessoes.acoes.titulo') }}</h2>
        <p>
          <strong>{{ escolhida.nome }}</strong> ·
          {{ t('sessoes.intervalo', { de: quando(escolhida.inicio), ate: hora(escolhida.fim) }) }} ·
          {{ t(`sessoes.planos.${escolhida.planoTipo}`) }}: {{ escolhida.plano }} ·
          {{ t('sessoes.sessaoDe', { ordem: escolhida.ordem, total: escolhida.total }) }} ·
          {{ t(`sessoes.situacoes.${escolhida.situacao}`) }}
        </p>
        <p v-if="escolhida.motivo" class="secundario">{{ escolhida.motivo }}</p>
        <template v-if="pode && escolhida.situacao === 'agendada'">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('sessoes.acoes.motivo')"
            :max-bytes="200"
            data-testid="sessao-motivo"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('sessoes.acoes.realizar')"
              :desabilitado="ocupado"
              data-testid="sessao-realizar"
              @acionar="registrar('realizar')"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('sessoes.acoes.falta')"
              :desabilitado="ocupado || exigeMotivo"
              data-testid="sessao-falta"
              @acionar="registrar('falta')"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('sessoes.acoes.cancelar')"
              :desabilitado="ocupado || exigeMotivo"
              data-testid="sessao-cancelar"
              @acionar="registrar('cancelar')"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('sessoes.acoes.restantes')"
              :desabilitado="ocupado || exigeMotivo"
              data-testid="sessao-restantes"
              @acionar="registrar('cancelar-restantes')"
            />
          </div>
        </template>
        <h3>{{ t('sessoes.acoes.doPaciente') }}</h3>
        <ul v-if="doPaciente.data.value" class="lista-simples" data-testid="sessoes-do-paciente">
          <li v-for="s in doPaciente.data.value.sessoes" :key="s.id">
            {{ quando(s.inicio) }} · {{ t(`sessoes.situacoes.${s.situacao}`) }} ·
            {{ t('sessoes.sessaoDe', { ordem: s.ordem, total: s.total }) }}
          </li>
        </ul>
        <SanteBotao variante="texto" :rotulo="t('sessoes.acoes.fechar')" @acionar="escolhida = null" />
      </section>

      <section class="painel" aria-labelledby="sessoes-nova">
        <h2 id="sessoes-nova">{{ t('sessoes.nova.titulo') }}</h2>
        <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
        <template v-else>
          <form v-if="!paciente" class="filtros" role="search" @submit.prevent="pedido = termo.trim()">
            <div class="campo">
              <label for="sessoes-termo">{{ t('sessoes.nova.termo') }}</label>
              <input
                id="sessoes-termo"
                v-model="termo"
                type="search"
                autocomplete="off"
                data-testid="sessoes-termo"
              />
            </div>
            <SanteBotao tipo="submit" variante="secundario" :rotulo="t('sessoes.nova.buscarPaciente')" />
          </form>
          <ul v-if="pacientes.data.value && !paciente" class="lista-simples">
            <li v-for="p in pacientes.data.value.itens" :key="p.id">
              <SanteBotao
                variante="texto"
                :rotulo="t('sessoes.nova.escolher', { nome: p.nomeSocial ?? p.nome })"
                :data-testid="`sessoes-paciente-${p.id}`"
                @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome }"
              />
            </li>
          </ul>
          <form v-if="paciente" class="formulario" data-testid="form-serie" @submit.prevent="agendar">
            <p>
              {{ t('sessoes.nova.escolhido', { nome: paciente.nome }) }}
              <SanteBotao variante="texto" :rotulo="t('sessoes.nova.trocar')" @acionar="paciente = null" />
            </p>
            <div class="grade">
              <SanteSelecao
                v-model="recurso"
                :rotulo="t('sessoes.nova.recurso')"
                :opcoes="opcoesRecurso"
                data-testid="serie-recurso"
              />
              <SanteSelecao
                v-model="complexidade"
                :rotulo="t('sessoes.nova.complexidade')"
                :opcoes="opcoesComplexidade"
                data-testid="serie-complexidade"
              />
              <SanteSelecao
                v-model="duracao"
                :rotulo="t('sessoes.nova.duracao')"
                :opcoes="opcoesDuracao"
                data-testid="serie-duracao"
              />
              <div class="campo">
                <label for="serie-minutos">{{ t('sessoes.nova.minutos') }}</label>
                <input
                  id="serie-minutos"
                  v-model.number="minutos"
                  type="number"
                  min="10"
                  max="720"
                  data-testid="serie-minutos"
                />
              </div>
              <SanteSelecao
                v-model="planoTipo"
                :rotulo="t('sessoes.nova.planoTipo')"
                :opcoes="opcoesPlano"
                data-testid="serie-plano-tipo"
              />
              <SanteData
                v-model="inicio"
                :rotulo="t('sessoes.nova.inicio')"
                editavel
                data-testid="serie-inicio"
              />
              <SanteCampoTexto
                v-model="horaInicio"
                :rotulo="t('sessoes.nova.hora')"
                :max-bytes="4"
                data-testid="serie-hora"
              />
              <div class="campo">
                <label for="serie-quantas">{{ t('sessoes.nova.sessoes') }}</label>
                <input
                  id="serie-quantas"
                  v-model.number="quantas"
                  type="number"
                  min="1"
                  max="60"
                  data-testid="serie-quantas"
                />
              </div>
              <div class="campo">
                <label for="serie-intervalo">{{ t('sessoes.nova.intervalo') }}</label>
                <input
                  id="serie-intervalo"
                  v-model.number="intervalo"
                  type="number"
                  min="1"
                  max="60"
                  data-testid="serie-intervalo"
                />
              </div>
            </div>
            <label class="opcao">
              <input v-model="pular" type="checkbox" data-testid="serie-pular" />
              {{ t('sessoes.nova.pular') }}
            </label>
            <SanteCampoTexto
              v-model="plano"
              :rotulo="t('sessoes.nova.plano')"
              :max-bytes="200"
              obrigatorio
              data-testid="serie-plano"
            />
            <SanteCampoTexto v-model="observacao" :rotulo="t('sessoes.nova.observacao')" :max-bytes="200" />
            <div class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('sessoes.nova.previa')"
                :desabilitado="ocupado || !entrada"
                data-testid="serie-previa"
                @acionar="verPrevia"
              />
              <SanteBotao
                tipo="submit"
                :rotulo="t('sessoes.nova.agendar')"
                :desabilitado="ocupado || !entrada || !previa?.ok"
                data-testid="serie-agendar"
              />
            </div>
            <section v-if="previa" aria-labelledby="serie-previa-titulo" data-testid="serie-previa-resultado">
              <h3 id="serie-previa-titulo">{{ t('sessoes.nova.previaTitulo') }}</h3>
              <ErroSessoes
                v-if="previa.recusa"
                :erro="{ codigo: previa.recusa.codigo, motivo: previa.recusa.motivo }"
              />
              <p v-else role="status">
                {{ previa.ok ? t('sessoes.nova.previaOk') : t('sessoes.nova.previaConflito') }}
              </p>
              <ol class="lista-simples">
                <li v-for="d in previa.datas" :key="d.ordem" :data-testid="`previa-${d.ordem}`">
                  {{ t('sessoes.intervalo', { de: quando(d.inicio), ate: hora(d.fim) }) }} ·
                  <strong v-if="d.conflito">{{
                    d.conflito === 'recurso'
                      ? t('sessoes.nova.conflitoRecurso')
                      : t('sessoes.nova.conflitoPaciente')
                  }}</strong>
                  <span v-else>{{ t('sessoes.nova.semConflito') }}</span>
                </li>
              </ol>
            </section>
          </form>
        </template>
      </section>
    </template>

    <details class="painel" data-testid="sessoes-cadastros">
      <summary>{{ t('sessoes.cadastros') }}</summary>
      <p class="secundario">{{ t('sessoes.cadastrosTexto') }}</p>
      <DominiosIndiceTela subitem="sessoesCadastros" embutido />
    </details>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.rolagem {
  overflow-x: auto;
}
.grade-sessoes td,
.grade-sessoes th {
  vertical-align: top;
  min-width: 9rem;
}
.sessao {
  display: block;
  width: 100%;
  text-align: start;
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-1);
  margin-block-end: var(--sgh-espaco-1);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sessao--cancelada,
.sessao--falta {
  text-decoration: line-through;
  opacity: 0.75;
}
.sessao--realizada {
  border-style: dashed;
}
.formulario {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.lista-simples {
  margin: 0;
  padding-inline-start: 0;
  list-style: none;
}
.chip {
  display: inline-block;
  margin-inline-start: var(--sgh-espaco-1);
  padding: 0 var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 999px;
  font-size: var(--sgh-fonte-pequena);
}
.aviso p {
  margin: 0;
}
</style>
