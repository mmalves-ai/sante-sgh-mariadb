<script setup lang="ts">
// Escala de plantão (M52.2; item `Gestão de pessoas > Escala de plantão (médica e de enfermagem)`;
// `pessoas.escala.ler`): as escalas do estabelecimento por competência, unidade, tipo e situação, a entrada da grade do
// mês e a criação da escala do setor (`pessoas.escala.montar`) com a cobertura mínima por turno. O servidor confere
// tudo de novo; a escala é da competência atual em diante.
import {
  CODIGOS_ESTADO_ESCALA,
  CODIGOS_TIPO_ESCALA,
  ESTADOS_ESCALA,
  type EstadoEscala,
  TIPOS_ESCALA,
  type TipoEscala,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import { criarEscala, lerApoioEscala, lerEscalas } from '../api-escala.js';
import { inteiroDe, proximaCompetencia } from '../escala-comum.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';

const { t } = useI18n();
const router = useRouter();
const qc = useQueryClient();
const apoio = useQuery({ queryKey: ['pessoas', 'escala', 'apoio'], queryFn: lerApoioEscala });
const a = computed(() => apoio.data.value ?? null);

const competencia = ref('');
const unidade = ref<number | null>(null);
const tipo = ref<TipoEscala | null>(null);
const estado = ref<EstadoEscala | null>(null);
const filtro = ref<{
  competencia: string;
  unidade: number | null;
  tipo: TipoEscala | null;
  estado: EstadoEscala | null;
}>({
  competencia: '',
  unidade: null,
  tipo: null,
  estado: null,
});
const lista = useQuery({
  queryKey: computed(() => ['pessoas', 'escalas', filtro.value]),
  queryFn: () =>
    lerEscalas({
      ...(/^\d{4}-\d{2}$/.test(filtro.value.competencia) ? { competencia: filtro.value.competencia } : {}),
      ...(filtro.value.unidade !== null ? { unidade: filtro.value.unidade } : {}),
      ...(filtro.value.tipo ? { tipo: filtro.value.tipo } : {}),
      ...(filtro.value.estado ? { estado: filtro.value.estado } : {}),
    }),
});
function filtrar(): void {
  filtro.value = {
    competencia: competencia.value.trim(),
    unidade: unidade.value,
    tipo: tipo.value,
    estado: estado.value,
  };
}

const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('pessoas.escala.filtro.todas') },
  ...(a.value?.unidades ?? []).map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
]);
const opcoesTipo = computed(() => [
  { valor: null, rotulo: t('pessoas.escala.filtro.todas') },
  ...CODIGOS_TIPO_ESCALA.map((c) => ({ valor: c, rotulo: TIPOS_ESCALA[c] })),
]);
const opcoesEstado = computed(() => [
  { valor: null, rotulo: t('pessoas.escala.filtro.todas') },
  ...CODIGOS_ESTADO_ESCALA.map((c) => ({ valor: c, rotulo: ESTADOS_ESCALA[c] })),
]);
const unidadeNome = (codigo: number, nome: string | null) => nome ?? String(codigo);

// ── Nova escala ──
const nova = ref({
  unidade: null as number | null,
  setor: '',
  competencia: '',
  tipo: 'enfermagem' as TipoEscala,
  manha: '0',
  tarde: '0',
  noite: '0',
});
watch(
  a,
  (x) => {
    if (x && !nova.value.competencia) nova.value.competencia = proximaCompetencia(x.hoje);
  },
  { immediate: true },
);
const aviso = ref<string | null>(null);
const opcoesUnidadeNova = computed(() =>
  (a.value?.unidades ?? []).map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
);
const opcoesTipoNova = computed(() =>
  CODIGOS_TIPO_ESCALA.map((c) => ({ valor: c, rotulo: TIPOS_ESCALA[c] })),
);
const criacao = useMutation({
  mutationFn: () => {
    const n = nova.value;
    return criarEscala({
      unidade: n.unidade!,
      setor: n.setor.trim(),
      competencia: n.competencia.trim(),
      tipo: n.tipo,
      cobertura: {
        manha: inteiroDe(n.manha) ?? 0,
        tarde: inteiroDe(n.tarde) ?? 0,
        noite: inteiroDe(n.noite) ?? 0,
      },
    });
  },
  onSuccess: async (r) => {
    await qc.invalidateQueries({ queryKey: ['pessoas', 'escalas'] });
    await router.push(`/pessoas/escala/${r.id}`);
  },
});
function criar(): void {
  aviso.value = null;
  if (nova.value.unidade === null) {
    aviso.value = t('pessoas.escala.nova.unidadeObrigatoria');
    return;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(nova.value.competencia.trim())) {
    aviso.value = t('pessoas.escala.nova.competenciaInvalida');
    return;
  }
  criacao.mutate();
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-escala-titulo" data-testid="tela-escalas">
    <h1 id="pes-escala-titulo">{{ t('pessoas.escala.titulo') }}</h1>
    <p>{{ t('pessoas.escala.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? t('pessoas.escala.gravacaoDesligada')"
        variante="info"
        data-testid="escala-gravacao-desligada"
      />
      <SanteAlerta
        v-else-if="!a.acoes.montar && !a.acoes.publicar"
        :texto="t('pessoas.escala.soConsulta')"
        variante="info"
        data-testid="escala-so-consulta"
      />
      <p class="acoes">
        <RouterLink to="/pessoas/regimes" data-testid="abrir-regimes">{{
          t('pessoas.escala.regimes')
        }}</RouterLink>
        <RouterLink to="/pessoas/escala/trocas" data-testid="abrir-trocas">{{
          t('pessoas.trocas.titulo')
        }}</RouterLink>
        <RouterLink to="/pessoas/plantao-agora" data-testid="abrir-plantao-agora">{{
          t('pessoas.agora.titulo')
        }}</RouterLink>
        <RouterLink to="/pessoas/escala/realizado" data-testid="abrir-realizado">{{
          t('f6.realizado.titulo')
        }}</RouterLink>
      </p>
      <form class="campos" :aria-label="t('pessoas.buscar')" @submit.prevent="filtrar">
        <SanteCampoTexto
          v-model="competencia"
          :rotulo="t('pessoas.escala.filtro.competencia')"
          :max-bytes="7"
          data-testid="filtro-competencia"
        />
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('pessoas.escala.filtro.unidade')"
          :opcoes="opcoesUnidade"
          busca
          data-testid="filtro-unidade"
        />
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('pessoas.escala.filtro.tipo')"
          :opcoes="opcoesTipo"
          data-testid="filtro-tipo"
        />
        <SanteSelecao
          v-model="estado"
          :rotulo="t('pessoas.escala.filtro.estado')"
          :opcoes="opcoesEstado"
          data-testid="filtro-estado"
        />
        <SanteBotao
          :rotulo="t('pessoas.buscar')"
          tipo="submit"
          variante="secundario"
          data-testid="filtrar-escalas"
        />
      </form>
      <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('pessoas.carregando') }}</p>
      <p v-else-if="lista.data.value.itens.length === 0" data-testid="escalas-vazio">
        {{ t('pessoas.escala.vazio') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-escalas">
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.escala.colunas.competencia') }}</th>
            <th scope="col">{{ t('pessoas.escala.colunas.unidade') }}</th>
            <th scope="col">{{ t('pessoas.escala.colunas.setor') }}</th>
            <th scope="col">{{ t('pessoas.escala.colunas.tipo') }}</th>
            <th scope="col">{{ t('pessoas.escala.colunas.estado') }}</th>
            <th scope="col">{{ t('pessoas.escala.colunas.plantoes') }}</th>
            <th scope="col">{{ t('pessoas.escala.colunas.publicada') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in lista.data.value.itens" :key="e.id" :data-testid="`escala-${e.id}`">
            <th scope="row">
              <RouterLink :to="`/pessoas/escala/${e.id}`" :data-testid="`abrir-escala-${e.id}`">{{
                e.competencia
              }}</RouterLink>
            </th>
            <td>{{ unidadeNome(e.unidade, e.unidadeNome) }}</td>
            <td>{{ e.setor }}</td>
            <td>{{ TIPOS_ESCALA[e.tipo] }}</td>
            <td>{{ ESTADOS_ESCALA[e.estado] }}</td>
            <td>{{ e.plantoes }}</td>
            <td>{{ e.publicadaEm ? e.publicadaEm.replace('T', ' ') : '' }}</td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="a.acoes.montar"
        class="bloco"
        aria-labelledby="pes-escala-nova"
        data-testid="form-nova-escala"
        @submit.prevent="criar"
      >
        <h2 id="pes-escala-nova">{{ t('pessoas.escala.nova.titulo') }}</h2>
        <div class="campos">
          <SanteSelecao
            v-model="nova.unidade"
            :rotulo="t('pessoas.escala.nova.unidade')"
            :opcoes="opcoesUnidadeNova"
            obrigatorio
            busca
            data-testid="nova-unidade"
          />
          <SanteCampoTexto
            v-model="nova.setor"
            :rotulo="t('pessoas.escala.nova.setor')"
            :max-bytes="60"
            data-testid="nova-setor"
          />
          <SanteCampoTexto
            v-model="nova.competencia"
            :rotulo="t('pessoas.escala.nova.competencia')"
            :max-bytes="7"
            obrigatorio
            data-testid="nova-competencia"
          />
          <SanteSelecao
            v-model="nova.tipo"
            :rotulo="t('pessoas.escala.nova.tipo')"
            :opcoes="opcoesTipoNova"
            data-testid="nova-tipo"
          />
          <SanteCampoTexto
            v-model="nova.manha"
            :rotulo="t('pessoas.escala.nova.manha')"
            :max-bytes="2"
            data-testid="nova-manha"
          />
          <SanteCampoTexto
            v-model="nova.tarde"
            :rotulo="t('pessoas.escala.nova.tarde')"
            :max-bytes="2"
            data-testid="nova-tarde"
          />
          <SanteCampoTexto
            v-model="nova.noite"
            :rotulo="t('pessoas.escala.nova.noite')"
            :max-bytes="2"
            data-testid="nova-noite"
          />
        </div>
        <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
        <ErroPessoas v-if="criacao.isError.value" :erro="criacao.error.value" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.escala.nova.criar')"
            tipo="submit"
            :desabilitado="criacao.isPending.value"
            data-testid="criar-escala"
          />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
