<script setup lang="ts">
// Aba "Afastamentos" (M53.1; D-AFAST-531; `pessoas.afastamento.registrar`): os afastamentos que tocam a competência (o
// lote enviado à folha os leva), o registro de um novo (colaborador pela busca da gestão de pessoas, motivo do domínio
// de afastamentos com busca, início e fim), informar o fim e cancelar com motivo (o cancelado fica, nunca é apagado).
import {
  type AfastamentoResposta,
  type ApoioFolhaInterface,
  type ColaboradorResumo,
  esquemaAlterarAfastamento,
  esquemaRegistrarAfastamento,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../pessoas/comum.js';
import { lerColaboradores } from '../../pessoas/api-pessoas.js';
import { alterarAfastamento, lerAfastamentos, registrarAfastamento } from '../api-folha.js';
import { rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from './ErroFolha.vue';

const props = defineProps<{ apoio: ApoioFolhaInterface; competencia: string | null }>();
const { t } = useI18n();
const cliente = useQueryClient();
// Filtro por colaborador (D-AFAST-FILTRO-531): pela mesma busca da gestão de pessoas; só para quem a tem.
const podeBuscarColaborador = computed(() => props.apoio.acoes.buscarColaborador);
const filtroTermo = ref('');
const filtroAchados = ref<readonly ColaboradorResumo[] | null>(null);
const filtro = ref<ColaboradorResumo | null>(null);
async function buscarFiltro(): Promise<void> {
  erro.value = null;
  if (filtroTermo.value.trim().length < 2) return;
  try {
    filtroAchados.value = (
      await lerColaboradores({ termo: filtroTermo.value.trim(), estado: 'todos', limite: 30 })
    ).itens;
  } catch (x) {
    erro.value = x;
  }
}
function filtrar(c: ColaboradorResumo | null): void {
  filtro.value = c;
  filtroAchados.value = null;
  if (!c) filtroTermo.value = '';
}
const lista = useQuery({
  queryKey: computed(() => ['folha', 'afastamentos', props.competencia, filtro.value?.vinculo ?? null]),
  queryFn: () => lerAfastamentos({ competencia: props.competencia, vinculo: filtro.value?.vinculo ?? null }),
  enabled: computed(() => props.competencia !== null),
});
const itens = computed(() => lista.data.value?.itens ?? null);
const pode = computed(() => props.apoio.acoes.afastamento);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

// ── Registrar ────────────────────────────────────────────────────────────────────────────────────────────────
const registrando = ref(false);
const termo = ref('');
const achados = ref<readonly ColaboradorResumo[] | null>(null);
const colaborador = ref<ColaboradorResumo | null>(null);
const motivo = ref<number | null>(null);
const inicio = ref<string | null>(null);
const fim = ref<string | null>(null);
const observacao = ref('');
const opcoesMotivo = computed(() =>
  props.apoio.motivosAfastamento.map((m) => ({ valor: m.codigo, rotulo: m.rotulo })),
);
function novo(): void {
  registrando.value = true;
  colaborador.value = null;
  achados.value = null;
  termo.value = '';
  motivo.value = null;
  inicio.value = null;
  fim.value = null;
  observacao.value = '';
  erro.value = null;
  aviso.value = null;
}
async function buscar(): Promise<void> {
  erro.value = null;
  if (termo.value.trim().length < 2) return;
  try {
    achados.value = (
      await lerColaboradores({ termo: termo.value.trim(), estado: 'todos', limite: 30 })
    ).itens;
  } catch (x) {
    erro.value = x;
  }
}
const entrada = computed(() =>
  esquemaRegistrarAfastamento.safeParse({
    vinculo: colaborador.value?.vinculo ?? 0,
    motivo: motivo.value ?? -1,
    inicio: inicio.value ?? '',
    fim: fim.value,
    observacao: observacao.value.trim() || null,
  }),
);
async function gravar(): Promise<void> {
  if (!entrada.value.success) return;
  erro.value = null;
  try {
    const r = await registrarAfastamento(entrada.value.data);
    registrando.value = false;
    aviso.value = r.mensagem || t('folha.afastamento.registrado');
    await cliente.invalidateQueries({ queryKey: ['folha', 'afastamentos'] });
  } catch (x) {
    erro.value = x;
  }
}

// ── Encerrar ou cancelar ────────────────────────────────────────────────────────────────────────────────────
const alvo = ref<AfastamentoResposta | null>(null);
const acao = ref<'encerrar' | 'cancelar'>('encerrar');
const dialogo = ref(false);
const fimAlvo = ref<string | null>(null);
const motivoCancelamento = ref('');
function abrir(a: AfastamentoResposta, x: 'encerrar' | 'cancelar'): void {
  alvo.value = a;
  acao.value = x;
  fimAlvo.value = null;
  motivoCancelamento.value = '';
  erro.value = null;
  aviso.value = null;
  dialogo.value = true;
}
const alteracao = computed(() =>
  esquemaAlterarAfastamento.safeParse({
    versao: alvo.value?.versao ?? 0,
    acao: acao.value,
    fim: acao.value === 'encerrar' ? fimAlvo.value : null,
    motivo: acao.value === 'cancelar' ? motivoCancelamento.value.trim() || null : null,
  }),
);
async function confirmar(): Promise<void> {
  if (!alvo.value || !alteracao.value.success) return;
  erro.value = null;
  try {
    const r = await alterarAfastamento(alvo.value.id, alteracao.value.data);
    dialogo.value = false;
    aviso.value = r.mensagem || t('folha.afastamento.registrado');
    await cliente.invalidateQueries({ queryKey: ['folha', 'afastamentos'] });
  } catch (x) {
    erro.value = x;
  }
}
const quemBase = (a: { vinculo: number; matricula: string | null }) =>
  a.matricula
    ? `${t('folha.matricula', { m: a.matricula })} · ${t('folha.vinculo', { v: a.vinculo })}`
    : t('folha.vinculo', { v: a.vinculo });
// Com o filtro, o nome do colaborador escolhido (já visto na busca) vai na linha; sem ele, matrícula e vínculo.
const quem = (a: { vinculo: number; matricula: string | null }) =>
  filtro.value && filtro.value.vinculo === a.vinculo ? `${filtro.value.nome} · ${quemBase(a)}` : quemBase(a);
</script>

<template>
  <section class="bloco" :aria-label="t('folha.afastamento.titulo')" data-testid="folha-afastamentos">
    <h2>
      {{ t('folha.afastamento.titulo') }}
      <span v-if="competencia" class="secundario">· {{ rotuloCompetencia(competencia) }}</span>
    </h2>
    <p class="secundario">{{ t('folha.afastamento.ajudaCompetencia') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="folha-afastamento-aviso" />
    <div v-if="podeBuscarColaborador" class="bloco" data-testid="folha-afastamento-filtro">
      <p v-if="filtro" class="campos" data-testid="folha-afastamento-filtrado">
        <span>{{ t('folha.afastamento.filtrado', { nome: filtro.nome }) }}</span>
        <SanteBotao
          :rotulo="t('folha.afastamento.todos')"
          variante="texto"
          data-testid="folha-afastamento-filtro-limpar"
          @acionar="filtrar(null)"
        />
      </p>
      <template v-else>
        <div class="campos">
          <SanteCampoTexto
            v-model="filtroTermo"
            :rotulo="t('folha.afastamento.filtrar')"
            :max-bytes="70"
            data-testid="folha-afastamento-filtro-termo"
          />
          <SanteBotao
            :rotulo="t('folha.afastamento.buscarBotao')"
            variante="secundario"
            data-testid="folha-afastamento-filtro-buscar"
            @acionar="buscarFiltro"
          />
        </div>
        <ul v-if="filtroAchados" class="lista" data-testid="folha-afastamento-filtro-achados">
          <li v-if="filtroAchados.length === 0">{{ t('folha.afastamento.nenhumColaborador') }}</li>
          <li v-for="c in filtroAchados" :key="c.vinculo">
            <SanteBotao
              :rotulo="`${c.nome} · ${quemBase(c)}`"
              variante="texto"
              :data-testid="`folha-afastamento-filtro-escolher-${c.vinculo}`"
              @acionar="filtrar(c)"
            />
            <span class="secundario">{{ c.cargo }}</span>
          </li>
        </ul>
      </template>
    </div>
    <ErroFolha v-if="erro && !dialogo" :erro="erro" />
    <ErroFolha v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!itens" role="status">{{ t('folha.carregando') }}</p>
    <p v-else-if="itens.length === 0">
      {{ filtro ? t('folha.afastamento.nenhumDoColaborador') : t('folha.afastamento.nenhum') }}
    </p>
    <table v-else class="tabela">
      <thead>
        <tr>
          <th scope="col">{{ t('folha.afastamento.colaborador') }}</th>
          <th scope="col">{{ t('folha.afastamento.motivo') }}</th>
          <th scope="col">{{ t('folha.afastamento.inicio') }}</th>
          <th scope="col">{{ t('folha.afastamento.fim') }}</th>
          <th scope="col">{{ t('folha.situacao') }}</th>
          <th scope="col">{{ t('folha.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in itens" :key="a.id" :data-testid="`folha-afastamento-${a.id}`">
          <th scope="row">{{ quem(a) }}</th>
          <td>
            {{ a.motivoRotulo }}
            <span v-if="a.observacao" class="secundario">{{ a.observacao }}</span>
          </td>
          <td>{{ dataBr(a.inicio) }}</td>
          <td>{{ a.fim ? dataBr(a.fim) : t('folha.afastamento.semFim') }}</td>
          <td>
            {{ t(`folha.afastamento.situacoes.${a.situacao}`) }}
            <span v-if="a.motivoCancelamento" class="secundario">{{ a.motivoCancelamento }}</span>
          </td>
          <td>
            <template v-if="pode && a.situacao === 'ativo'">
              <SanteBotao
                v-if="!a.fim"
                :rotulo="t('folha.afastamento.encerrar')"
                variante="texto"
                :data-testid="`folha-afastamento-encerrar-${a.id}`"
                @acionar="abrir(a, 'encerrar')"
              />
              <SanteBotao
                :rotulo="t('folha.afastamento.cancelar')"
                variante="texto"
                :data-testid="`folha-afastamento-cancelar-${a.id}`"
                @acionar="abrir(a, 'cancelar')"
              />
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="acoes">
      <SanteBotao
        v-if="pode && !registrando"
        :rotulo="t('folha.afastamento.registrar')"
        data-testid="folha-afastamento-novo"
        @acionar="novo"
      />
    </div>

    <form
      v-if="registrando"
      class="bloco"
      :aria-label="t('folha.afastamento.registrar')"
      data-testid="folha-afastamento-form"
      @submit.prevent="gravar"
    >
      <h3>{{ t('folha.afastamento.registrar') }}</h3>
      <div v-if="colaborador" class="campos">
        <p data-testid="folha-afastamento-colaborador">
          <strong>{{ colaborador.nome }}</strong>
          <span class="secundario"> · {{ quemBase(colaborador) }} · {{ colaborador.cargo }}</span>
        </p>
        <SanteBotao :rotulo="t('folha.afastamento.trocar')" variante="texto" @acionar="colaborador = null" />
      </div>
      <template v-else>
        <div class="campos">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('folha.afastamento.buscar')"
            :max-bytes="70"
            data-testid="folha-afastamento-termo"
          />
          <SanteBotao
            :rotulo="t('folha.afastamento.buscarBotao')"
            variante="secundario"
            data-testid="folha-afastamento-buscar"
            @acionar="buscar"
          />
        </div>
        <ul v-if="achados" class="lista" data-testid="folha-afastamento-achados">
          <li v-if="achados.length === 0">{{ t('folha.afastamento.nenhumColaborador') }}</li>
          <li v-for="c in achados" :key="c.vinculo">
            <SanteBotao
              :rotulo="`${c.nome} · ${quemBase(c)}`"
              variante="texto"
              :data-testid="`folha-afastamento-escolher-${c.vinculo}`"
              @acionar="colaborador = c"
            />
            <span class="secundario">{{ c.cargo }}</span>
          </li>
        </ul>
      </template>
      <div class="campos">
        <SanteSelecao
          v-model="motivo"
          :rotulo="t('folha.afastamento.motivo')"
          :opcoes="opcoesMotivo"
          busca
          data-testid="folha-afastamento-motivo"
        />
        <SanteData
          v-model="inicio"
          :rotulo="t('folha.afastamento.inicio')"
          editavel
          data-testid="folha-afastamento-inicio"
        />
        <SanteData
          v-model="fim"
          :rotulo="t('folha.afastamento.fim')"
          editavel
          data-testid="folha-afastamento-fim"
        />
      </div>
      <SanteCampoTexto
        v-model="observacao"
        :rotulo="t('folha.afastamento.observacao')"
        :max-bytes="400"
        data-testid="folha-afastamento-observacao"
      />
      <div class="acoes">
        <SanteBotao :rotulo="t('folha.cancelar')" variante="texto" @acionar="registrando = false" />
        <SanteBotao
          :rotulo="t('folha.gravar')"
          tipo="submit"
          :desabilitado="!entrada.success"
          data-testid="folha-afastamento-gravar"
        />
      </div>
    </form>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="acao === 'encerrar' ? t('folha.afastamento.encerrar') : t('folha.afastamento.cancelar')"
    >
      <p v-if="alvo">{{ quem(alvo) }} · {{ alvo.motivoRotulo }} · {{ dataBr(alvo.inicio) }}</p>
      <SanteData
        v-if="acao === 'encerrar'"
        v-model="fimAlvo"
        :rotulo="t('folha.afastamento.fim')"
        editavel
        data-testid="folha-afastamento-fim-alvo"
      />
      <SanteCampoTexto
        v-else
        v-model="motivoCancelamento"
        :rotulo="t('folha.afastamento.motivoCancelamento')"
        :max-bytes="400"
        data-testid="folha-afastamento-motivo-cancelamento"
      />
      <ErroFolha v-if="erro && dialogo" :erro="erro" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="dialogo = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="!alteracao.success"
          data-testid="folha-afastamento-confirmar"
          @acionar="confirmar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
.lista {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.25rem;
}
</style>
