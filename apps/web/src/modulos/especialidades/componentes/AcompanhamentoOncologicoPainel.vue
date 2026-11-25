<script setup lang="ts">
// Acompanhamento do tumor e reações do tratamento oncológico (03-PEP linha 111), na mesma internação da ficha da
// oncologia. Visão por paciente: o acompanhamento de cada tumor com a linha do tempo (cada mudança é um evento, nada
// é apagado) e as reações (toxicidades com grau CTCAE) ligadas ao ciclo. As regras do domínio conferem na hora
// (recidiva pede data e tumor que voltou, grau 3 ou mais pede a conduta); a API confere de novo e grava.
import {
  CATEGORIAS_REACAO,
  CLASSIFICACOES_PACIENTE_ONCO,
  conferirAcompanhamentoOnco,
  conferirReacao,
  EVOLUCOES_REACAO,
  GRAU_REACAO_GRAVE,
  RESPOSTAS_TRATAMENTO,
  SITUACOES_TUMOR,
  type AcompanhamentoAtual,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AcompanhamentoLido,
  lerAcompanhamentoOncologico,
  registrarAcompanhamentoOnco,
  registrarReacaoOnco,
} from '../api-acompanhamento-oncologico.js';
import { novaChaveEspecialidade } from '../api-especialidades.js';
import { lerRegistroOncologico } from '../api-registro-oncologico.js';
import ErroEspecialidade from './ErroEspecialidade.vue';

const props = defineProps<{
  reg: number;
  pode: boolean;
  /** Os ciclos da ficha, para ligar a reação ao ciclo (o tratamento vem dele). */
  ciclos: readonly { id: number; rotulo: string }[];
}>();
const { t } = useI18n();
const k = (x: string) => t(`especialidades.acompOnco.${x}`);
const cliente = useQueryClient();
const chave = computed(() => ['especialidades', 'oncologia', 'acompanhamento', props.reg]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerAcompanhamentoOncologico(props.reg) });
const registro = useQuery({
  queryKey: computed(() => ['especialidades', 'oncologia', 'registro', props.reg]),
  queryFn: () => lerRegistroOncologico(props.reg),
});
const hoje = computed(() => registro.data.value?.hoje ?? new Date().toISOString().slice(0, 10));
const tumores = computed(() => registro.data.value?.tumores ?? []);
const rotuloTumor = (id: number | null) => {
  const x = tumores.value.find((y) => y.id === id);
  return x ? `${x.topografia} ${x.topografiaDescricao} · ${x.cid}` : k('semTumor');
};
const opcoes = (lista: readonly string[], grupo: string, vazio = false) => [
  ...(vazio ? [{ valor: '', rotulo: '—' }] : []),
  ...lista.map((x) => ({ valor: x, rotulo: t(`especialidades.acompOnco.${grupo}.${x}`) })),
];
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function gravar(f: () => Promise<{ mensagem: string }>, depois: () => void) {
  ocupado.value = true;
  erro.value = null;
  try {
    mensagem.value = (await f()).mensagem;
    depois();
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Acompanhamento (novo ou atualização do existente: a versão lida vai junto) ──
const editando = ref<number | 'novo' | null>(null);
const ac = reactive({
  tumor: '',
  classificacao: 'em_tratamento',
  situacaoTumor: '',
  resposta: '',
  primeiroTratamentoEm: '' as string | null,
  recidivaEm: '' as string | null,
  obitoEm: '' as string | null,
  observacao: '',
});
const atualDe = (a: AcompanhamentoLido): AcompanhamentoAtual => a as unknown as AcompanhamentoAtual;
const emEdicao = computed(() =>
  typeof editando.value === 'number'
    ? (dados.data.value?.acompanhamentos.find((x) => x.id === editando.value) ?? null)
    : null,
);
const tumoresLivres = computed(() =>
  tumores.value.filter((x) => !(dados.data.value?.acompanhamentos ?? []).some((a) => a.tumor === x.id)),
);
function abrirNovo() {
  Object.assign(ac, {
    tumor: tumoresLivres.value[0] ? String(tumoresLivres.value[0].id) : '',
    classificacao: 'em_tratamento',
    situacaoTumor: 'presente',
    resposta: '',
    primeiroTratamentoEm: null,
    recidivaEm: null,
    obitoEm: null,
    observacao: '',
  });
  editando.value = 'novo';
}
function abrirEdicao(a: AcompanhamentoLido) {
  Object.assign(ac, {
    tumor: a.tumor === null ? '' : String(a.tumor),
    classificacao: a.classificacao,
    situacaoTumor: a.situacaoTumor ?? '',
    resposta: a.resposta ?? '',
    primeiroTratamentoEm: a.primeiroTratamentoEm,
    recidivaEm: a.recidivaEm,
    obitoEm: a.obitoEm ? a.obitoEm.slice(0, 10) : null,
    observacao: '',
  });
  editando.value = a.id;
}
const entradaAc = computed(() => ({
  classificacao: ac.classificacao,
  situacaoTumor: ac.situacaoTumor || null,
  resposta: ac.resposta || null,
  primeiroTratamentoEm: ac.primeiroTratamentoEm || null,
  recidivaEm: ac.recidivaEm || null,
  obitoEm: ac.obitoEm || null,
}));
const errosAc = computed(() => {
  const d = tumores.value.find((x) => String(x.id) === ac.tumor)?.diagnosticadoEm ?? null;
  return conferirAcompanhamentoOnco(
    entradaAc.value,
    emEdicao.value ? atualDe(emEdicao.value) : null,
    hoje.value,
    d,
  ).map((e) => e.mensagem);
});
function gravarAcompanhamento() {
  const a = emEdicao.value;
  void gravar(
    () =>
      registrarAcompanhamentoOnco(
        props.reg,
        {
          ...entradaAc.value,
          acompanhamento: a?.id ?? null,
          versao: a?.versao ?? null,
          tumor: ac.tumor ? Number(ac.tumor) : null,
          observacao: ac.observacao.trim() || null,
        },
        novaChaveEspecialidade('acompanhamento-onco'),
      ),
    () => (editando.value = null),
  );
}

// ── Reação do tratamento ──
const reagindo = ref<number | null>(null);
const re = reactive({
  ciclo: '',
  categoria: 'hematologica',
  descricao: '',
  grau: '1',
  evolucao: 'nova',
  avaliadoEm: '' as string | null,
  conduta: '',
  efeito: '',
});
function abrirReacao(acompanhamento: number) {
  Object.assign(re, {
    ciclo: props.ciclos[0] ? String(props.ciclos[0].id) : '',
    categoria: 'hematologica',
    descricao: '',
    grau: '1',
    evolucao: 'nova',
    avaliadoEm: hoje.value,
    conduta: '',
    efeito: '',
  });
  reagindo.value = acompanhamento;
}
const entradaRe = computed(() => ({
  categoria: re.categoria,
  descricao: re.descricao,
  grau: Number(re.grau),
  evolucao: re.evolucao,
  avaliadoEm: re.avaliadoEm ?? '',
  conduta: re.conduta.trim() || null,
  doseAjustada: re.efeito === 'dose',
  tratamentoSuspenso: re.efeito === 'suspenso',
}));
const errosRe = computed(() =>
  re.descricao.trim() && re.avaliadoEm
    ? conferirReacao({ ...entradaRe.value, comTratamento: !!re.ciclo }, hoje.value).map((e) => e.mensagem)
    : [],
);
function gravarReacao(acompanhamento: number) {
  void gravar(
    () =>
      registrarReacaoOnco(
        props.reg,
        { ...entradaRe.value, acompanhamento, ciclo: re.ciclo ? Number(re.ciclo) : null, tratamento: null },
        novaChaveEspecialidade('reacao-onco'),
      ),
    () => (reagindo.value = null),
  );
}
const reacoesDe = (id: number) => (dados.data.value?.reacoes ?? []).filter((r) => r.acompanhamento === id);
const opcoesGrau = [1, 2, 3, 4, 5].map((g) => ({ valor: String(g), rotulo: String(g) }));
const opcoesCiclo = computed(() => [
  { valor: '', rotulo: k('semTratamento') },
  ...props.ciclos.map((c) => ({ valor: String(c.id), rotulo: c.rotulo })),
]);
const opcoesEfeito = computed(() => [
  { valor: '', rotulo: '—' },
  { valor: 'dose', rotulo: k('doseAjustada') },
  { valor: 'suspenso', rotulo: k('tratamentoSuspenso') },
]);
const opcoesTumor = computed(() => [
  { valor: '', rotulo: k('semTumor') },
  ...(editando.value === 'novo' ? tumoresLivres.value : tumores.value).map((x) => ({
    valor: String(x.id),
    rotulo: rotuloTumor(x.id),
  })),
]);
</script>

<template>
  <section class="acomp" data-testid="onco-acompanhamento">
    <SanteAlerta v-if="mensagem" variante="info" icone="check" :texto="mensagem" anunciar />
    <ErroEspecialidade v-if="erro" :erro="erro" />
    <header class="acoes">
      <h2>{{ k('acompanhamentos') }}</h2>
      <SanteBotao
        v-if="pode && editando === null"
        variante="secundario"
        :rotulo="k('abrir')"
        data-testid="onco-acomp-abrir"
        @click="abrirNovo"
      />
    </header>
    <p v-if="dados.data.value && dados.data.value.acompanhamentos.length === 0">{{ k('nenhum') }}</p>

    <form
      v-if="editando !== null"
      class="grade"
      data-testid="onco-acomp-form"
      @submit.prevent="gravarAcompanhamento"
    >
      <SanteSelecao
        v-model="ac.tumor"
        :rotulo="k('tumor')"
        :opcoes="opcoesTumor"
        :desabilitado="editando !== 'novo'"
        data-testid="onco-acomp-tumor"
      />
      <SanteSelecao
        v-model="ac.classificacao"
        :rotulo="k('classificacao')"
        :opcoes="opcoes(CLASSIFICACOES_PACIENTE_ONCO, 'classificacoes')"
        data-testid="onco-acomp-classificacao"
      />
      <SanteSelecao
        v-model="ac.situacaoTumor"
        :rotulo="k('situacaoTumor')"
        :opcoes="opcoes(SITUACOES_TUMOR, 'situacoes', true)"
        data-testid="onco-acomp-situacao"
      />
      <SanteSelecao
        v-model="ac.resposta"
        :rotulo="k('resposta')"
        :opcoes="opcoes(RESPOSTAS_TRATAMENTO, 'respostas', true)"
        data-testid="onco-acomp-resposta"
      />
      <SanteData
        v-model="ac.primeiroTratamentoEm"
        :rotulo="k('primeiroTratamentoEm')"
        :maximo="hoje"
        editavel
      />
      <SanteData
        v-if="ac.classificacao === 'recidiva' || ac.recidivaEm"
        v-model="ac.recidivaEm"
        :rotulo="k('recidivaEm')"
        :maximo="hoje"
        editavel
        data-testid="onco-acomp-recidiva"
      />
      <SanteData
        v-if="ac.classificacao === 'obito'"
        v-model="ac.obitoEm"
        :rotulo="k('obitoEm')"
        :maximo="hoje"
        editavel
        data-testid="onco-acomp-obito"
      />
      <SanteCampoTexto v-model="ac.observacao" :rotulo="k('observacao')" :max-bytes="2000" />
      <ul v-if="errosAc.length" class="erros" data-testid="onco-acomp-erros">
        <li v-for="e in errosAc" :key="e">{{ e }}</li>
      </ul>
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="k('gravar')"
          :desabilitado="ocupado || errosAc.length > 0"
          data-testid="onco-acomp-gravar"
        />
        <SanteBotao variante="texto" :rotulo="k('cancelar')" @click="editando = null" />
      </div>
    </form>

    <article
      v-for="a in dados.data.value?.acompanhamentos ?? []"
      :key="a.id"
      class="cartao"
      :data-testid="`onco-acomp-${a.id}`"
    >
      <header>
        <strong>{{ rotuloTumor(a.tumor) }}</strong>
        <span class="selo">{{ t(`especialidades.acompOnco.classificacoes.${a.classificacao}`) }}</span>
        <span v-if="a.situacaoTumor">
          · {{ t(`especialidades.acompOnco.situacoes.${a.situacaoTumor}`) }}</span
        >
        <span v-if="a.resposta"> · {{ t(`especialidades.acompOnco.respostas.${a.resposta}`) }}</span>
        <span v-if="a.recidivaEm"> · {{ k('recidivaEm') }} {{ a.recidivaEm }}</span>
      </header>
      <details>
        <summary>{{ k('linhaTempo') }} ({{ a.eventos.length }})</summary>
        <ol>
          <li v-for="(e, i) in a.eventos" :key="i">
            {{ e.ocorridoEm }} · {{ e.tipo ? t(`especialidades.acompOnco.eventos.${e.tipo}`) : e.operacao }}
            {{ e.observacao ? `· ${e.observacao}` : '' }}
          </li>
        </ol>
      </details>
      <p v-if="a.classificacao === 'obito'">{{ k('encerrado') }}</p>
      <div v-else-if="pode && editando === null" class="acoes">
        <SanteBotao
          variante="texto"
          :rotulo="k('atualizar')"
          :data-testid="`onco-acomp-atualizar-${a.id}`"
          @click="abrirEdicao(a)"
        />
        <SanteBotao
          variante="texto"
          :rotulo="k('novaReacao')"
          :data-testid="`onco-reacao-nova-${a.id}`"
          @click="abrirReacao(a.id)"
        />
      </div>

      <form
        v-if="reagindo === a.id"
        class="grade"
        data-testid="onco-reacao-form"
        @submit.prevent="gravarReacao(a.id)"
      >
        <h3>{{ k('novaReacao') }}</h3>
        <SanteSelecao
          v-model="re.ciclo"
          :rotulo="k('tratamento')"
          :opcoes="opcoesCiclo"
          data-testid="onco-reacao-ciclo"
        />
        <SanteSelecao
          v-model="re.categoria"
          :rotulo="k('categoria')"
          :opcoes="opcoes(CATEGORIAS_REACAO, 'categorias')"
          data-testid="onco-reacao-categoria"
        />
        <SanteCampoTexto
          v-model="re.descricao"
          :rotulo="k('descricao')"
          :max-bytes="500"
          data-testid="onco-reacao-descricao"
        />
        <SanteSelecao
          v-model="re.grau"
          :rotulo="k('grau')"
          :opcoes="opcoesGrau"
          data-testid="onco-reacao-grau"
        />
        <SanteSelecao
          v-model="re.evolucao"
          :rotulo="k('evolucao')"
          :opcoes="opcoes(EVOLUCOES_REACAO, 'evolucoes')"
          data-testid="onco-reacao-evolucao"
        />
        <SanteData v-model="re.avaliadoEm" :rotulo="k('avaliadoEm')" :maximo="hoje" editavel />
        <SanteSelecao v-model="re.efeito" :rotulo="k('conduta')" :opcoes="opcoesEfeito" />
        <SanteCampoTexto
          v-model="re.conduta"
          :rotulo="Number(re.grau) >= GRAU_REACAO_GRAVE ? `${k('conduta')} (${k('grave')})` : k('conduta')"
          :max-bytes="4000"
          data-testid="onco-reacao-conduta"
        />
        <ul v-if="errosRe.length" class="erros" data-testid="onco-reacao-erros">
          <li v-for="e in errosRe" :key="e">{{ e }}</li>
        </ul>
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="k('gravar')"
            :desabilitado="ocupado || !re.descricao.trim() || !re.avaliadoEm || errosRe.length > 0"
            data-testid="onco-reacao-gravar"
          />
          <SanteBotao variante="texto" :rotulo="k('cancelar')" @click="reagindo = null" />
        </div>
      </form>

      <h3>{{ k('reacoes') }}</h3>
      <p v-if="reacoesDe(a.id).length === 0">{{ k('nenhumaReacao') }}</p>
      <ul v-else>
        <li v-for="r in reacoesDe(a.id)" :key="r.id" :data-testid="`onco-reacao-${r.id}`">
          {{ r.avaliadoEm }} · {{ t(`especialidades.acompOnco.categorias.${r.categoria}`) }} ·
          {{ r.descricao }} · {{ k('grau') }} {{ r.grau }}
          <strong v-if="r.grau >= GRAU_REACAO_GRAVE">({{ k('grave') }})</strong> ·
          {{ t(`especialidades.acompOnco.evolucoes.${r.evolucao}`) }}
          <span v-if="r.doseAjustada"> · {{ k('doseAjustada') }}</span>
          <span v-if="r.tratamentoSuspenso"> · {{ k('tratamentoSuspenso') }}</span>
          <span v-if="r.conduta"> · {{ r.conduta }}</span>
        </li>
      </ul>
    </article>
  </section>
</template>

<style scoped>
.cartao {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
  margin-block: var(--sgh-espaco-3);
}
.selo {
  margin-inline-start: var(--sgh-espaco-2);
  font-weight: 600;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  margin-block: var(--sgh-espaco-3);
}
.grade h3,
.grade .acoes {
  grid-column: 1 / -1;
}
.erros {
  grid-column: 1 / -1;
  color: var(--sgh-alerta);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
</style>
