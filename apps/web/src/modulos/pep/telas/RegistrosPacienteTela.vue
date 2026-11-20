<script setup lang="ts">
// Registros do paciente (M15; ficha, seção 7): lidos ao vivo do banco do estabelecimento, mais novos primeiro,
// 50 por página, com filtros por período, modelo, categoria profissional e profissional, as marcas legais
// (suspenso, correção, retroativo, supervisão, sem conteúdo) e a busca de palavra nos registros. A primeira
// abertura do paciente na sessão pede o motivo de acesso; toda leitura vai ao registro de acesso.
import { CATEGORIAS_PROFISSIONAL, type CategoriaProfissional } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarPalavra, listarRegistros } from '../api-pep.js';
import CabecalhoProntuario from '../componentes/CabecalhoProntuario.vue';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import MarcasRegistro from '../componentes/MarcasRegistro.vue';
import { dataHoraBr } from '../formato.js';
import { useMotivo } from '../motivo.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const roteador = useRouter();
const id = computed(() => Number(props.paciente));
const m = useMotivo(id);
watch(() => m.consulta.data.value, m.aoCarregar, { immediate: true });

const de = ref('');
const ate = ref('');
const modelo = ref('');
const categoria = ref<CategoriaProfissional | ''>('');
const profissional = ref('');
const pagina = ref(1);
const filtros = ref<Record<string, string | number>>({});

function aplicar(): void {
  pagina.value = 1;
  filtros.value = {
    ...(de.value ? { de: de.value } : {}),
    ...(ate.value ? { ate: ate.value } : {}),
    ...(modelo.value ? { modelo: Number(modelo.value) } : {}),
    ...(categoria.value ? { categoria: categoria.value } : {}),
    ...(profissional.value ? { profissional: Number(profissional.value) } : {}),
  };
}
function limpar(): void {
  de.value = '';
  ate.value = '';
  modelo.value = '';
  categoria.value = '';
  profissional.value = '';
  aplicar();
}

const lista = useQuery({
  queryKey: computed(() => ['pep', 'registros', id.value, filtros.value, pagina.value]),
  queryFn: () => listarRegistros(id.value, { ...filtros.value, pagina: pagina.value }),
  enabled: computed(() => m.pronto.value),
  staleTime: 0,
});
const l = computed(() => lista.data.value);

const opcoesModelo = computed(() => [
  { valor: '', rotulo: t('pep.filtros.todos') },
  ...(l.value?.modelos ?? []).map((x) => ({
    valor: String(x.id),
    rotulo: [x.codigo, x.nome].filter(Boolean).join(' · '),
  })),
]);
const opcoesCategoria = computed(() => [
  { valor: '' as const, rotulo: t('pep.filtros.todas') },
  ...CATEGORIAS_PROFISSIONAL.map((c) => ({ valor: c, rotulo: t(`pep.categorias.${c}`) })),
]);
const opcoesProfissional = computed(() => [
  { valor: '', rotulo: t('pep.filtros.todos') },
  ...(l.value?.profissionais ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
]);

const termo = ref('');
const pedidoPalavra = ref<string | null>(null);
const palavra = useQuery({
  queryKey: computed(() => [
    'pep',
    'palavra',
    id.value,
    pedidoPalavra.value,
    filtros.value['de'],
    filtros.value['ate'],
  ]),
  queryFn: () =>
    buscarPalavra(id.value, {
      termo: pedidoPalavra.value!,
      ...(typeof filtros.value['de'] === 'string' ? { de: filtros.value['de'] } : {}),
      ...(typeof filtros.value['ate'] === 'string' ? { ate: filtros.value['ate'] } : {}),
    }),
  enabled: computed(() => m.pronto.value && pedidoPalavra.value !== null),
  staleTime: 0,
});
function procurar(): void {
  const x = termo.value.trim();
  if (x.length >= 3) pedidoPalavra.value = x;
}

function cancelado(): void {
  if (!m.pronto.value) void roteador.push('/pep/prontuario');
}
</script>

<template>
  <section class="tela" aria-labelledby="pep-registros-titulo" data-testid="tela-registros-paciente">
    <h1 id="pep-registros-titulo">{{ t('pep.registros.titulo') }}</h1>
    <DialogoMotivo
      v-model:visivel="m.pedir.value"
      :paciente="id"
      :restricao-atendimento="m.restricao.value"
      @informado="m.informado"
      @cancelado="cancelado"
    />
    <MensagemErro v-if="m.consulta.isError.value" :erro="m.consulta.error.value" />
    <p v-else-if="!m.pronto.value" role="status">{{ t('pep.motivo.aguardando') }}</p>
    <MensagemErro v-else-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!l" role="status">{{ t('pep.carregando') }}</p>
    <template v-else>
      <CabecalhoProntuario :cabecalho="l.cabecalho" />
      <SanteAlerta
        v-if="l.excecoes.semConteudo > 0 || l.excecoes.dataImpossivel > 0"
        variante="aviso"
        :texto="
          t('pep.registros.excecoes', { sem: l.excecoes.semConteudo, datas: l.excecoes.dataImpossivel })
        "
        data-testid="aviso-excecoes"
      />
      <form class="barra" :aria-label="t('pep.filtros.titulo')" @submit.prevent="aplicar">
        <div class="campo">
          <label for="filtro-de">{{ t('pep.filtros.de') }}</label>
          <input id="filtro-de" v-model="de" type="date" data-testid="filtro-de" />
        </div>
        <div class="campo">
          <label for="filtro-ate">{{ t('pep.filtros.ate') }}</label>
          <input id="filtro-ate" v-model="ate" type="date" data-testid="filtro-ate" />
        </div>
        <SanteSelecao
          v-model="modelo"
          :rotulo="t('pep.filtros.modelo')"
          :opcoes="opcoesModelo"
          data-testid="filtro-modelo"
        />
        <SanteSelecao
          v-model="categoria"
          :rotulo="t('pep.filtros.categoria')"
          :opcoes="opcoesCategoria"
          data-testid="filtro-categoria"
        />
        <SanteSelecao
          v-model="profissional"
          :rotulo="t('pep.filtros.profissional')"
          :opcoes="opcoesProfissional"
          data-testid="filtro-profissional"
        />
        <SanteBotao :rotulo="t('pep.filtros.aplicar')" tipo="submit" data-testid="aplicar-filtros" />
        <SanteBotao :rotulo="t('pep.filtros.limpar')" variante="secundario" @acionar="limpar" />
      </form>
      <p v-if="l.itens.length === 0" role="status" data-testid="registros-vazio">
        {{ t('pep.registros.vazio') }}
      </p>
      <table v-else data-testid="lista-registros">
        <caption>
          {{
            t('pep.registros.legenda', { pagina: l.pagina })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pep.registros.data') }}</th>
            <th scope="col">{{ t('pep.registros.modelo') }}</th>
            <th scope="col">{{ t('pep.registros.profissional') }}</th>
            <th scope="col">{{ t('pep.registros.marcas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in l.itens"
            :key="r.id"
            :data-testid="`registro-${r.id}`"
            :class="{ suspenso: r.marcas.suspenso }"
          >
            <td>
              <RouterLink
                :to="`/pep/prontuario/${id}/registro/${r.id}`"
                :aria-label="
                  t('pep.registros.abrir', { data: dataHoraBr(r.dataHora) || t('pep.marcas.semData') })
                "
                >{{ dataHoraBr(r.dataHora) || t('pep.marcas.semData') }}</RouterLink
              >
            </td>
            <td>{{ [r.modelo.codigo, r.modelo.nome].filter(Boolean).join(' · ') }}</td>
            <td>
              {{ r.profissional.nome ?? '' }}
              <span class="categoria">{{ t(`pep.categorias.${r.profissional.categoria}`) }}</span>
            </td>
            <td><MarcasRegistro :marcas="r.marcas" :paciente="id" /></td>
          </tr>
        </tbody>
      </table>
      <nav class="paginas" :aria-label="t('pep.registros.paginacao')">
        <SanteBotao
          :rotulo="t('pep.registros.anterior')"
          variante="secundario"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t('pep.registros.pagina', { n: pagina }) }}</span>
        <SanteBotao
          :rotulo="t('pep.registros.proxima')"
          variante="secundario"
          :desabilitado="!l.haMais"
          data-testid="proxima-pagina"
          @acionar="pagina++"
        />
      </nav>

      <section class="palavra" aria-labelledby="pep-palavra-titulo">
        <h2 id="pep-palavra-titulo">{{ t('pep.palavra.titulo') }}</h2>
        <form class="barra" role="search" @submit.prevent="procurar">
          <div class="campo">
            <label for="termo-palavra">{{ t('pep.palavra.termo') }}</label>
            <input
              id="termo-palavra"
              v-model="termo"
              type="search"
              minlength="3"
              maxlength="60"
              data-testid="termo-palavra"
            />
          </div>
          <SanteBotao :rotulo="t('pep.palavra.buscar')" tipo="submit" data-testid="buscar-palavra" />
        </form>
        <MensagemErro v-if="palavra.isError.value" :erro="palavra.error.value" />
        <template v-else-if="palavra.data.value">
          <SanteAlerta
            v-if="palavra.data.value.truncado"
            variante="aviso"
            :texto="t('pep.palavra.truncado')"
          />
          <p role="status">
            {{
              t('pep.palavra.resumo', { n: palavra.data.value.itens.length, lidos: palavra.data.value.lidos })
            }}
          </p>
          <ul data-testid="resultado-palavra">
            <li v-for="x in palavra.data.value.itens" :key="x.registro">
              <RouterLink :to="`/pep/prontuario/${id}/registro/${x.registro}`">{{
                `${dataHoraBr(x.dataHora)} · ${x.modelo ?? ''}`
              }}</RouterLink>
              <span> ({{ t('pep.palavra.ocorrencias', { n: x.ocorrencias }) }}): {{ x.trecho }}</span>
            </li>
          </ul>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
tr.suspenso td:first-child a {
  text-decoration: line-through;
}
td a,
li a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
.categoria {
  display: block;
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
.paginas {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
.palavra {
  margin-top: var(--sgh-espaco-3);
}
</style>
