<script setup lang="ts">
// Abrir e acompanhar as ordens de serviço (M55, etapa 1; item `Hotelaria e apoio > Manutenção predial e engenharia
// clínica`; `manutencao.os.abrir`, todo perfil de pessoa): as abas "Abertas por mim", "Do meu setor" e "Todas" (esta
// para quem atende ou encerra), os filtros (setor e equipamento com busca, situação, prioridade e tipo), a lista com os
// dois prazos, paginada pela chave ("Mostrar mais"), a abertura em janela e o detalhe com as ações. O QR da etiqueta
// abre esta tela com `?abrir=<código>` pela câmera do celular (D-QR-55): a janela de abertura já vem com o equipamento.
// `?os=<id>` abre o detalhe. Com a chave desligada, a consulta segue e as gravações ficam desabilitadas, com o motivo.
import {
  SITUACOES_OS_ABERTAS,
  type EquipamentoPeloCodigo,
  type NaturezaOs,
  type OsResumo,
  type PrioridadeOs,
  type ResultadoManutencao,
  type SituacaoOs,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  buscarEquipamentos,
  lerApoioManutencao,
  lerEquipamentoPeloCodigo,
  listarOs,
} from '../api-manutencao.js';
import {
  abaInicial,
  abasDaPessoa,
  comTodos,
  instanteBr,
  OPCOES,
  ROTULOS,
  textoDoPrazo,
  type AbaOs,
} from '../comum-manutencao.js';
import OsNoLeitoAviso from '../../adt/componentes/OsNoLeitoAviso.vue';
import DetalheOs from './DetalheOs.vue';
import ErroManutencao from './ErroManutencao.vue';
import FormAbrirOs from './FormAbrirOs.vue';

const { t } = useI18n();
const rota = useRoute();

const apoio = useQuery({ queryKey: ['manutencao', 'apoio'], queryFn: lerApoioManutencao });
const a = computed(() => apoio.data.value ?? null);
const abas = computed(() => (a.value ? abasDaPessoa(a.value) : []));
const aba = ref<AbaOs>('minhas');
watch(a, (x, antes) => {
  if (x && !antes) aba.value = abaInicial(x);
});

// ── Filtros e lista paginada pela chave ─────────────────────────────────────────────────────────────────────────────
const ABERTAS = 'abertas';
const filtro = ref<{
  centroCusto: number | null;
  equipamento: number | null;
  situacao: SituacaoOs | typeof ABERTAS | null;
  prioridade: PrioridadeOs | null;
  natureza: NaturezaOs | null;
}>({ centroCusto: null, equipamento: null, situacao: ABERTAS, prioridade: null, natureza: null });
const paginas = ref<(number | null)[]>([null]);
watch([filtro, aba], () => (paginas.value = [null]), { deep: true });

const meusSetores = computed(() => a.value?.meusSetores ?? []);
watch(aba, (x) => {
  const f = filtro.value;
  if (x === 'doSetor' && (f.centroCusto === null || !meusSetores.value.includes(f.centroCusto)))
    f.centroCusto = meusSetores.value[0] ?? null;
});
const pedidoBase = computed(() => {
  const f = filtro.value;
  const situacoes: SituacaoOs[] =
    f.situacao === ABERTAS ? [...SITUACOES_OS_ABERTAS, 'concluida'] : f.situacao ? [f.situacao] : [];
  const centro =
    aba.value === 'doSetor'
      ? f.centroCusto !== null && meusSetores.value.includes(f.centroCusto)
        ? f.centroCusto
        : (meusSetores.value[0] ?? null)
      : f.centroCusto;
  return {
    centroCusto: centro,
    equipamento: f.equipamento,
    situacoes,
    natureza: f.natureza,
    prioridade: f.prioridade,
    minhas: aba.value === 'minhas',
  };
});
const lista = useQuery({
  queryKey: computed(() => ['manutencao', 'os', 'lista', pedidoBase.value, paginas.value]),
  queryFn: async () => {
    const r = await Promise.all(paginas.value.map((antesDe) => listarOs({ ...pedidoBase.value, antesDe })));
    return { itens: r.flatMap((p) => p.itens) as OsResumo[], proxima: r[r.length - 1]?.proxima ?? null };
  },
  enabled: computed(() => !!a.value),
});
const l = computed(() => lista.data.value ?? null);

const opcoesSetor = computed(() => {
  const todos = (a.value?.setores ?? []).map((s) => ({ valor: s.codigo, rotulo: `${s.nome} (${s.codigo})` }));
  const so = aba.value === 'doSetor' ? todos.filter((s) => meusSetores.value.includes(s.valor)) : todos;
  return aba.value === 'doSetor' ? so : comTodos(t('manutencao.todos'), so);
});
// O combo do equipamento busca no servidor (o termo vai na consulta, como na abertura): a primeira página traz só os
// mais recentes, e o equipamento já escolhido fica na lista mesmo quando a nova busca não o traz.
const termoEquipamento = ref('');
const equipamentoBuscado = ref('');
const equipamentosFiltro = useQuery({
  queryKey: computed(() => ['manutencao', 'equipamentos', 'busca', equipamentoBuscado.value]),
  queryFn: () => buscarEquipamentos(equipamentoBuscado.value, null),
  enabled: computed(() => !!a.value),
});
const equipamentoEscolhido = ref<{ valor: number; rotulo: string } | null>(null);
const opcoesEquipamento = computed(() => {
  const lista = (equipamentosFiltro.data.value ?? []).map((e) => ({
    valor: e.id,
    rotulo: `${e.codigo} - ${e.nome}`,
  }));
  const x = equipamentoEscolhido.value;
  if (x && x.valor === filtro.value.equipamento && !lista.some((o) => o.valor === x.valor)) lista.unshift(x);
  return comTodos(t('manutencao.todos'), lista);
});
watch(
  () => filtro.value.equipamento,
  (id) => {
    const o = opcoesEquipamento.value.find((x) => x.valor === id && id !== null);
    equipamentoEscolhido.value = o && o.valor !== null ? { valor: o.valor, rotulo: o.rotulo } : null;
  },
);
const opcoesSituacao = computed(() => [
  { valor: ABERTAS as SituacaoOs | typeof ABERTAS | null, rotulo: t('manutencao.os.situacaoAbertas') },
  { valor: null, rotulo: t('manutencao.todos') },
  ...OPCOES.situacaoOs,
]);
const opcoesPrioridade = computed(() => comTodos(t('manutencao.todos'), OPCOES.prioridade));
const opcoesNatureza = computed(() => comTodos(t('manutencao.todos'), OPCOES.natureza));
const prazo = (o: OsResumo, etapa: 'atendimento' | 'solucao') => {
  const x = textoDoPrazo(o[etapa]);
  return t(x.chave, { tempo: x.tempo });
};

// ── Abrir (pelo botão, pelo código digitado ou pelo QR) e detalhe ───────────────────────────────────────────────────
const janela = ref(false);
const equipamentoDoQr = ref<EquipamentoPeloCodigo | null>(null);
const codigo = ref('');
const erroCodigo = ref<unknown>(null);
const resultado = ref<ResultadoManutencao | null>(null);
const aberta = ref<number | null>(null);

async function abrirPeloCodigo(c: string) {
  erroCodigo.value = null;
  const x = c.trim();
  if (!x) return;
  try {
    equipamentoDoQr.value = await lerEquipamentoPeloCodigo(x);
    janela.value = true;
    codigo.value = '';
  } catch (e) {
    erroCodigo.value = e;
  }
}
function novaOs() {
  equipamentoDoQr.value = null;
  janela.value = true;
}
function aoAbrir(r: ResultadoManutencao) {
  janela.value = false;
  resultado.value = r;
  aberta.value = r.id;
  paginas.value = [null];
  void lista.refetch();
}
const qrDaRota = rota?.query?.['abrir'];
if (typeof qrDaRota === 'string' && qrDaRota) void abrirPeloCodigo(qrDaRota);
const osDaRota = Number(rota?.query?.['os']);
if (Number.isInteger(osDaRota) && osDaRota > 0) aberta.value = osDaRota;
</script>

<template>
  <section class="tela-manutencao" aria-labelledby="os-titulo" data-testid="tela-manutencao-os">
    <h1 id="os-titulo">{{ t('manutencao.os.titulo') }}</h1>
    <p class="secundario">{{ t('manutencao.os.subtitulo') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('manutencao.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        variante="info"
        :texto="t('manutencao.desligado')"
        data-testid="manutencao-desligado"
      />

      <div class="acoes">
        <SanteBotao
          :rotulo="t('manutencao.os.nova')"
          :desabilitado="!a.gravacao.ligada"
          data-testid="os-nova"
          @acionar="novaOs"
        />
      </div>
      <form class="campos" data-testid="os-codigo" @submit.prevent="abrirPeloCodigo(codigo)">
        <SanteCampoTexto
          v-model="codigo"
          :rotulo="t('manutencao.os.campos.codigo')"
          :max-bytes="30"
          data-testid="os-codigo-campo"
        />
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('manutencao.os.abrirEquipamento')"
          data-testid="os-codigo-abrir"
        />
      </form>
      <p class="secundario">{{ t('manutencao.os.lerQrAjuda') }}</p>
      <SanteAlerta
        v-if="erroCodigo"
        variante="aviso"
        :texto="t('manutencao.os.qrNaoAchado')"
        data-testid="os-codigo-nao-achado"
      />

      <div v-if="resultado" class="bloco" role="status" data-testid="os-criada">
        <p>{{ t('manutencao.os.criada', { numero: resultado.numero ?? resultado.id }) }}</p>
        <SanteAlerta
          v-if="resultado.alerta"
          variante="alerta"
          :texto="t('manutencao.os.avisos.criticoParado')"
          data-testid="os-criada-alerta"
        />
        <p v-if="resultado.alerta">{{ t('manutencao.os.avisados', { n: resultado.alerta.avisados }) }}</p>
        <SanteAlerta
          v-if="(resultado.possiveisDuplicadas ?? []).length > 0"
          variante="aviso"
          :texto="t('manutencao.os.avisos.duplicada')"
          data-testid="os-criada-duplicada"
        />
        <OsNoLeitoAviso :leito="resultado.leito" />
      </div>

      <DetalheOs v-if="aberta !== null" :id="aberta" :key="aberta" :apoio="a" @fechar="aberta = null" />

      <div class="acoes" role="tablist" :aria-label="t('manutencao.abasRotulo')">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`manutencao.os.${x}`)"
          :data-testid="`os-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <div class="campos" data-testid="os-filtros">
        <SanteSelecao
          v-model="filtro.centroCusto"
          :rotulo="t('manutencao.os.filtro.setor')"
          :opcoes="opcoesSetor"
          busca
          data-testid="os-filtro-setor"
        />
        <SanteCampoTexto
          v-model="termoEquipamento"
          :rotulo="t('manutencao.os.filtro.buscarEquipamento')"
          :max-bytes="80"
          data-testid="os-filtro-termo-equipamento"
          @keydown.enter.prevent="equipamentoBuscado = termoEquipamento.trim()"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('manutencao.buscar')"
          data-testid="os-filtro-buscar-equipamento"
          @acionar="equipamentoBuscado = termoEquipamento.trim()"
        />
        <SanteSelecao
          v-model="filtro.equipamento"
          :rotulo="t('manutencao.os.filtro.equipamento')"
          :opcoes="opcoesEquipamento"
          busca
          data-testid="os-filtro-equipamento"
        />
        <SanteSelecao
          v-model="filtro.situacao"
          :rotulo="t('manutencao.os.filtro.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="os-filtro-situacao"
        />
        <SanteSelecao
          v-model="filtro.prioridade"
          :rotulo="t('manutencao.os.filtro.prioridade')"
          :opcoes="opcoesPrioridade"
          data-testid="os-filtro-prioridade"
        />
        <SanteSelecao
          v-model="filtro.natureza"
          :rotulo="t('manutencao.os.filtro.natureza')"
          :opcoes="opcoesNatureza"
          data-testid="os-filtro-natureza"
        />
      </div>

      <ErroManutencao v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!l" role="status">{{ t('manutencao.carregando') }}</p>
      <p v-else-if="l.itens.length === 0" data-testid="os-vazio">{{ t('manutencao.nenhum') }}</p>
      <template v-else>
        <div class="rolagem">
          <table class="tabela" data-testid="tabela-os">
            <thead>
              <tr>
                <th scope="col">{{ t('manutencao.os.colunas.numero') }}</th>
                <th scope="col">{{ t('manutencao.os.colunas.abertaEm') }}</th>
                <th scope="col">{{ t('manutencao.os.colunas.equipamento') }}</th>
                <th scope="col">{{ t('manutencao.os.colunas.setor') }}</th>
                <th scope="col">{{ t('manutencao.os.colunas.prioridade') }}</th>
                <th scope="col">{{ t('manutencao.os.colunas.situacao') }}</th>
                <th scope="col">{{ t('manutencao.os.colunas.atendimento') }}</th>
                <th scope="col">{{ t('manutencao.os.colunas.solucao') }}</th>
                <th scope="col">{{ t('manutencao.os.colunas.tecnico') }}</th>
                <th scope="col">{{ t('manutencao.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in l.itens" :key="o.id" :data-testid="`os-${o.id}`">
                <td>{{ o.numero }}</td>
                <td>{{ instanteBr(o.abertaEm) }}</td>
                <td>
                  {{ o.equipamento ? `${o.equipamento.codigo} - ${o.equipamento.nome}` : o.local }}
                  <strong v-if="o.parado && o.critico" class="vencido">
                    ({{ t('manutencao.equipamentos.campos.parado') }})
                  </strong>
                </td>
                <td>{{ o.setor.nome }}</td>
                <td>{{ ROTULOS.prioridade[o.prioridade] }}</td>
                <td>{{ ROTULOS.situacaoOs[o.situacao] }}</td>
                <td :class="{ vencido: o.atendimento.situacao === 'vencido' }">
                  {{ prazo(o, 'atendimento') }}
                </td>
                <td :class="{ vencido: o.solucao.situacao === 'vencido' }">{{ prazo(o, 'solucao') }}</td>
                <td>{{ o.tecnico ?? '' }}</td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('manutencao.abrir')"
                    :data-testid="`os-abrir-${o.id}`"
                    @acionar="aberta = o.id"
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
          data-testid="os-mais"
          @acionar="paginas = [...paginas, l.proxima]"
        />
      </template>

      <SanteDialogo v-model:visivel="janela" :titulo="t('manutencao.os.nova')" largura="44rem">
        <FormAbrirOs
          v-if="janela"
          :key="equipamentoDoQr?.id ?? 0"
          :apoio="a"
          :equipamento="equipamentoDoQr"
          @aberta="aoAbrir"
          @cancelar="janela = false"
        />
      </SanteDialogo>
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
