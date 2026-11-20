<script setup lang="ts">
// Colaboradores e admissão (M52.1; item `Gestão de pessoas > Cadastro de colaboradores (admissão, dependentes)`;
// `pessoas.colaborador.ler`): a lista dos vínculos do estabelecimento por centro de custo, tipo e situação (keyset no
// servidor, 50 por página, sem CPF; o CPF digitado no termo vira o filtro exato), por unidade e setor, com o alerta do conselho por linha (regra 3), o painel dos alertas para o RH, a
// entrada da admissão e os domínios do RH do item embutidos (CRUD genérico).
import { CODIGOS_TIPO_VINCULO, SITUACOES_HABILITACAO, TIPOS_VINCULO, type TipoVinculo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { lerApoioPessoas, lerColaboradores } from '../api-pessoas.js';
import { dataBr } from '../comum.js';
import AlertasConselho from '../componentes/AlertasConselho.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';

const ITEM = 'gestao-de-pessoas.cadastro-de-colaboradores-admissao-dependentes';
const { t } = useI18n();
const router = useRouter();
const apoio = useQuery({ queryKey: ['pessoas', 'apoio'], queryFn: lerApoioPessoas });
const a = computed(() => apoio.data.value ?? null);

const termo = ref('');
const centroCusto = ref<number | null>(null);
const unidade = ref<number | null>(null);
const setor = ref('');
const tipo = ref<TipoVinculo | null>(null);
type Estado = 'ativo' | 'desligado' | 'todos';
const estado = ref<Estado>('ativo');
interface Filtro {
  termo: string;
  centroCusto: number | null;
  unidade: number | null;
  setor: string;
  tipo: TipoVinculo | null;
  estado: Estado;
}
const filtro = ref<Filtro>({
  termo: '',
  centroCusto: null,
  unidade: null,
  setor: '',
  tipo: null,
  estado: 'ativo',
});
const paginas = ref<number[]>([]);
const lista = useQuery({
  queryKey: computed(() => ['pessoas', 'colaboradores', filtro.value, paginas.value.at(-1) ?? null]),
  queryFn: () =>
    lerColaboradores({
      ...(filtro.value.termo ? { termo: filtro.value.termo } : {}),
      ...(filtro.value.centroCusto !== null ? { centroCusto: filtro.value.centroCusto } : {}),
      ...(filtro.value.unidade !== null ? { unidade: filtro.value.unidade } : {}),
      ...(filtro.value.setor ? { setor: filtro.value.setor } : {}),
      ...(filtro.value.tipo ? { tipo: filtro.value.tipo } : {}),
      estado: filtro.value.estado,
      limite: 50,
      ...(paginas.value.length ? { depois: paginas.value.at(-1)! } : {}),
    }),
});
function filtrar(): void {
  filtro.value = {
    termo: termo.value.trim(),
    centroCusto: centroCusto.value,
    unidade: unidade.value,
    setor: setor.value.trim(),
    tipo: tipo.value,
    estado: estado.value,
  };
  paginas.value = [];
}
const opcoesCentro = computed(() => [
  { valor: null, rotulo: t('pessoas.colaboradores.centroCustoTodos') },
  ...(a.value?.centrosCusto ?? []).map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
]);
const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('pessoas.colaboradores.unidadeTodas') },
  ...(a.value?.unidades ?? []).map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
]);
function lotacaoTexto(l: {
  centroCusto: number;
  centroCustoNome: string | null;
  unidadeNome: string | null;
  setor: string | null;
}): string {
  return [l.centroCustoNome ?? String(l.centroCusto), l.unidadeNome, l.setor].filter(Boolean).join(' · ');
}
const opcoesTipo = computed(() => [
  { valor: null, rotulo: t('pessoas.colaboradores.vinculoTipo') },
  ...CODIGOS_TIPO_VINCULO.map((c) => ({ valor: c, rotulo: TIPOS_VINCULO[c] })),
]);
const opcoesEstado = computed(() => [
  { valor: 'ativo' as Estado, rotulo: t('pessoas.colaboradores.filtro.ativos') },
  { valor: 'desligado' as Estado, rotulo: t('pessoas.colaboradores.filtro.desligados') },
  { valor: 'todos' as Estado, rotulo: t('pessoas.colaboradores.filtro.todos') },
]);
const varianteConselho = (s: string) => (s === 'vencida' ? 'alerta' : s === 'aVencer' ? 'aviso' : 'info');
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-colab-titulo" data-testid="tela-colaboradores">
    <h1 id="pes-colab-titulo">{{ t('pessoas.colaboradores.titulo') }}</h1>
    <p>{{ t('pessoas.colaboradores.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? t('pessoas.gravacaoDesligada')"
        variante="info"
        data-testid="pessoas-gravacao-desligada"
      />
      <SanteAlerta
        v-else-if="!a.acoes.admitir && !a.acoes.desligar"
        :texto="t('pessoas.colaboradores.soConsulta')"
        variante="info"
        data-testid="pessoas-so-consulta"
      />
      <div class="acoes">
        <SanteBotao
          v-if="a.acoes.admitir"
          :rotulo="t('pessoas.colaboradores.admitir')"
          data-testid="abrir-admissao"
          @acionar="router.push('/pessoas/colaboradores/admitir')"
        />
      </div>
      <form class="campos" :aria-label="t('pessoas.buscar')" @submit.prevent="filtrar">
        <SanteCampoTexto
          v-model="termo"
          :rotulo="t('pessoas.colaboradores.filtro.termo')"
          :max-bytes="70"
          data-testid="filtro-termo"
        />
        <SanteSelecao
          v-model="centroCusto"
          :rotulo="t('pessoas.colaboradores.filtro.centroCusto')"
          :opcoes="opcoesCentro"
          busca
          data-testid="filtro-centro-custo"
        />
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('pessoas.colaboradores.filtro.unidade')"
          :opcoes="opcoesUnidade"
          busca
          data-testid="filtro-unidade"
        />
        <SanteCampoTexto
          v-model="setor"
          :rotulo="t('pessoas.colaboradores.filtro.setor')"
          :max-bytes="60"
          data-testid="filtro-setor"
        />
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('pessoas.colaboradores.filtro.tipo')"
          :opcoes="opcoesTipo"
          data-testid="filtro-tipo"
        />
        <SanteSelecao
          v-model="estado"
          :rotulo="t('pessoas.colaboradores.filtro.estado')"
          :opcoes="opcoesEstado"
          data-testid="filtro-estado"
        />
        <SanteBotao :rotulo="t('pessoas.buscar')" tipo="submit" variante="secundario" data-testid="filtrar" />
      </form>
      <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('pessoas.carregando') }}</p>
      <p v-else-if="lista.data.value.itens.length === 0" data-testid="colaboradores-vazio">
        {{ t('pessoas.colaboradores.vazio') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-colaboradores">
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.colaboradores.colunas.nome') }}</th>
            <th scope="col">{{ t('pessoas.colaboradores.colunas.matricula') }}</th>
            <th scope="col">{{ t('pessoas.colaboradores.colunas.tipo') }}</th>
            <th scope="col">{{ t('pessoas.colaboradores.colunas.cargo') }}</th>
            <th scope="col">{{ t('pessoas.colaboradores.colunas.lotacao') }}</th>
            <th scope="col">{{ t('pessoas.colaboradores.colunas.admissao') }}</th>
            <th scope="col">{{ t('pessoas.colaboradores.colunas.desligamento') }}</th>
            <th scope="col">{{ t('pessoas.colaboradores.colunas.conselho') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in lista.data.value.itens" :key="c.vinculo" :data-testid="`colaborador-${c.vinculo}`">
            <th scope="row">
              <RouterLink
                :to="`/pessoas/colaboradores/${c.vinculo}`"
                :data-testid="`abrir-colaborador-${c.vinculo}`"
                >{{ c.nome }}</RouterLink
              >
            </th>
            <td>{{ c.matricula ?? '' }}</td>
            <td>{{ TIPOS_VINCULO[c.tipo] }}</td>
            <td>{{ c.cargo }}</td>
            <td>{{ lotacaoTexto(c.lotacao) }}</td>
            <td>{{ dataBr(c.admissao) }}</td>
            <td>{{ dataBr(c.desligamento) }}</td>
            <td>
              <SanteAlerta
                v-if="c.conselho && c.conselho !== 'valida'"
                :texto="SITUACOES_HABILITACAO[c.conselho]"
                :variante="varianteConselho(c.conselho)"
              />
              <span v-else-if="c.conselho">{{ SITUACOES_HABILITACAO[c.conselho] }}</span>
              <span v-else class="secundario">{{ t('pessoas.colaboradores.semConselho') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="lista.data.value" class="acoes">
        <SanteBotao
          v-if="paginas.length"
          :rotulo="t('pessoas.colaboradores.paginaAnterior')"
          variante="texto"
          @acionar="paginas = paginas.slice(0, -1)"
        />
        <SanteBotao
          v-if="lista.data.value.depois !== null"
          :rotulo="t('pessoas.colaboradores.paginaSeguinte')"
          variante="texto"
          data-testid="pagina-seguinte"
          @acionar="paginas = [...paginas, lista.data.value!.depois!]"
        />
      </div>
      <AlertasConselho :janela-dias="a.janelaAlertaDias" />
    </template>

    <GrupoDominiosTela subitem="rhCadastroColaboradoresAdmissaoDependentes" embutida />
    <p>
      <RouterLink :to="`/consultas/item/${ITEM}`" data-testid="pessoas-outras-tabelas">{{
        t('pessoas.colaboradores.outrasTabelas')
      }}</RouterLink>
    </p>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
