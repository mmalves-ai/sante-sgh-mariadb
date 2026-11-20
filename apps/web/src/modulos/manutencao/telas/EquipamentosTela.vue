<script setup lang="ts">
// Equipamentos e preventiva (M55, etapa 1; `manutencao.equipamento.ler`): as abas Equipamentos (lista paginada pela
// chave com os filtros, a ficha e o cadastro), Painel do plano (vencidas, a vencer, em dia), Contratos de manutenção,
// Alertas e recall (W0-08, tecnovigilância) e Indicadores (com as contas impressas). `?equipamento=<id>` abre a ficha. Com a chave desligada, a consulta segue e
// as gravações ficam desabilitadas, com o motivo.
import type {
  CriticidadeEquipamento,
  EquipamentoResumo,
  ResultadoManutencao,
  SituacaoEquipamento,
  TipoEquipamento,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerApoioManutencao, listarEquipamentos } from '../api-manutencao.js';
import { comTodos, OPCOES, ROTULOS } from '../comum-manutencao.js';
import AbaAlertas from './AbaAlertas.vue';
import AbaContratos from './AbaContratos.vue';
import AbaIndicadores from './AbaIndicadores.vue';
import AbaPainelPlano from './AbaPainelPlano.vue';
import ErroManutencao from './ErroManutencao.vue';
import FichaEquipamento from './FichaEquipamento.vue';
import FormEquipamento from './FormEquipamento.vue';

type Aba = 'lista' | 'painel' | 'contratos' | 'alertas' | 'indicadores';
const ABAS: readonly Aba[] = ['lista', 'painel', 'contratos', 'alertas', 'indicadores'];
const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();

const apoio = useQuery({ queryKey: ['manutencao', 'apoio'], queryFn: lerApoioManutencao });
const a = computed(() => apoio.data.value ?? null);
const aba = ref<Aba>('lista');

const termo = ref('');
const filtro = ref<{
  termo: string | null;
  centroCusto: number | null;
  tipo: TipoEquipamento | null;
  criticidade: CriticidadeEquipamento | null;
  situacao: SituacaoEquipamento | null;
}>({ termo: null, centroCusto: null, tipo: null, criticidade: null, situacao: null });
const paginas = ref<(number | null)[]>([null]);
watch(filtro, () => (paginas.value = [null]), { deep: true });
const lista = useQuery({
  queryKey: computed(() => ['manutencao', 'equipamentos', 'lista', filtro.value, paginas.value]),
  queryFn: async () => {
    const r = await Promise.all(
      paginas.value.map((antesDe) => listarEquipamentos({ ...filtro.value, antesDe })),
    );
    return {
      itens: r.flatMap((p) => p.itens) as EquipamentoResumo[],
      proxima: r[r.length - 1]?.proxima ?? null,
    };
  },
  enabled: computed(() => !!a.value?.pode.ler),
});
const l = computed(() => lista.data.value ?? null);
const opcoesSetor = computed(() =>
  comTodos(
    t('manutencao.todos'),
    (a.value?.setores ?? []).map((s) => ({ valor: s.codigo, rotulo: `${s.nome} (${s.codigo})` })),
  ),
);
const opcoesTipo = computed(() => comTodos(t('manutencao.todos'), OPCOES.tipo));
const opcoesCriticidade = computed(() => comTodos(t('manutencao.todos'), OPCOES.criticidade));
const opcoesSituacao = computed(() => comTodos(t('manutencao.todos'), OPCOES.situacaoEquipamento));

const aberto = ref<number | null>(null);
const daRota = Number(rota?.query?.['equipamento']);
if (Number.isInteger(daRota) && daRota > 0) aberto.value = daRota;
function abrir(id: number) {
  aba.value = 'lista';
  aberto.value = id;
}
const cadastrando = ref(false);
async function cadastrado(r: ResultadoManutencao) {
  cadastrando.value = false;
  await cliente.invalidateQueries({ queryKey: ['manutencao', 'equipamentos'] });
  abrir(r.id);
}
</script>

<template>
  <section
    class="tela-manutencao"
    aria-labelledby="equipamentos-titulo"
    data-testid="tela-manutencao-equipamentos"
  >
    <h1 id="equipamentos-titulo">{{ t('manutencao.equipamentos.titulo') }}</h1>
    <p class="secundario">{{ t('manutencao.equipamentos.subtitulo') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('manutencao.carregando') }}</p>
    <SanteAlerta v-else-if="!a.pode.ler" variante="info" :texto="t('manutencao.semPermissaoEquipamentos')" />
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        variante="info"
        :texto="t('manutencao.desligado')"
        data-testid="manutencao-desligado"
      />
      <div class="acoes" role="tablist" :aria-label="t('manutencao.abasRotulo')">
        <SanteBotao
          v-for="x in ABAS"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`manutencao.equipamentos.abas.${x}`)"
          :data-testid="`equipamentos-aba-${x}`"
          @acionar="aba = x"
        />
      </div>

      <template v-if="aba === 'lista'">
        <FichaEquipamento
          v-if="aberto !== null"
          :id="aberto"
          :key="aberto"
          :apoio="a"
          @fechar="aberto = null"
        />
        <div class="acoes">
          <SanteBotao
            v-if="a.pode.editar"
            :rotulo="t('manutencao.equipamentos.novo')"
            :desabilitado="!a.gravacao.ligada"
            data-testid="equipamentos-novo"
            @acionar="cadastrando = true"
          />
        </div>
        <form
          class="campos"
          data-testid="equipamentos-filtros"
          @submit.prevent="filtro = { ...filtro, termo: termo.trim() || null }"
        >
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('manutencao.equipamentos.filtro.termo')"
            :max-bytes="80"
            data-testid="equipamentos-termo"
          />
          <SanteSelecao
            v-model="filtro.centroCusto"
            :rotulo="t('manutencao.equipamentos.filtro.setor')"
            :opcoes="opcoesSetor"
            busca
            data-testid="equipamentos-setor"
          />
          <SanteSelecao
            v-model="filtro.tipo"
            :rotulo="t('manutencao.equipamentos.filtro.tipo')"
            :opcoes="opcoesTipo"
            data-testid="equipamentos-tipo"
          />
          <SanteSelecao
            v-model="filtro.criticidade"
            :rotulo="t('manutencao.equipamentos.filtro.criticidade')"
            :opcoes="opcoesCriticidade"
            data-testid="equipamentos-criticidade"
          />
          <SanteSelecao
            v-model="filtro.situacao"
            :rotulo="t('manutencao.equipamentos.filtro.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="equipamentos-situacao"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('manutencao.buscar')"
            data-testid="equipamentos-buscar"
          />
        </form>
        <ErroManutencao v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!l" role="status">{{ t('manutencao.carregando') }}</p>
        <p v-else-if="l.itens.length === 0" data-testid="equipamentos-vazio">{{ t('manutencao.nenhum') }}</p>
        <template v-else>
          <div class="rolagem">
            <table class="tabela" data-testid="tabela-equipamentos">
              <thead>
                <tr>
                  <th scope="col">{{ t('manutencao.equipamentos.campos.codigo') }}</th>
                  <th scope="col">{{ t('manutencao.equipamentos.campos.nome') }}</th>
                  <th scope="col">{{ t('manutencao.equipamentos.campos.tipo') }}</th>
                  <th scope="col">{{ t('manutencao.equipamentos.campos.criticidade') }}</th>
                  <th scope="col">{{ t('manutencao.equipamentos.campos.setor') }}</th>
                  <th scope="col">{{ t('manutencao.equipamentos.campos.situacao') }}</th>
                  <th scope="col">{{ t('manutencao.equipamentos.campos.osAbertas') }}</th>
                  <th scope="col">{{ t('manutencao.equipamentos.campos.planosVencidos') }}</th>
                  <th scope="col">{{ t('manutencao.acoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in l.itens" :key="e.id" :data-testid="`equipamento-${e.id}`">
                  <td>{{ e.codigo }}</td>
                  <td>
                    {{ e.nome }}
                    <strong v-if="e.parado" class="vencido"
                      >({{ t('manutencao.equipamentos.campos.parado') }})</strong
                    >
                  </td>
                  <td>{{ ROTULOS.tipo[e.tipo] }}</td>
                  <td>{{ ROTULOS.criticidade[e.criticidade] }}</td>
                  <td>{{ e.setor?.nome ?? '' }}</td>
                  <td>{{ ROTULOS.situacaoEquipamento[e.situacao] }}</td>
                  <td>{{ e.osAbertas }}</td>
                  <td :class="{ vencido: e.planosVencidos > 0 }">{{ e.planosVencidos }}</td>
                  <td>
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('manutencao.abrir')"
                      :data-testid="`equipamento-abrir-${e.id}`"
                      @acionar="abrir(e.id)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <SanteBotao
            v-if="l.proxima !== null"
            variante="secundario"
            :rotulo="t('manutencao.maisItens')"
            data-testid="equipamentos-mais"
            @acionar="paginas = [...paginas, l.proxima]"
          />
        </template>
        <SanteDialogo
          v-model:visivel="cadastrando"
          :titulo="t('manutencao.equipamentos.novo')"
          largura="56rem"
        >
          <FormEquipamento
            v-if="cadastrando"
            :apoio="a"
            @gravado="cadastrado"
            @cancelar="cadastrando = false"
          />
        </SanteDialogo>
      </template>
      <AbaPainelPlano v-else-if="aba === 'painel'" @abrir="abrir" />
      <AbaContratos v-else-if="aba === 'contratos'" :apoio="a" />
      <AbaAlertas v-else-if="aba === 'alertas'" :apoio="a" />
      <AbaIndicadores v-else :apoio="a" />
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
