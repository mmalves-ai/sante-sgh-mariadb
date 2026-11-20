<script setup lang="ts">
// Oftalmologia (ficha do M45, seção 7; DP-32): `/pep/especialidades/oftalmologia/:reg`. Os exames oftalmológicos da
// internação (acuidade sem e com correção, pressão intraocular, gonioscopia, exames complementares, a classificação da
// visão e os alertas) e o registro novo pelo médico, com a acuidade, a graduação e os exames só do cadastro. A
// classificação e os alertas são do servidor.
import { LADOS_EXAME, type LadoExame, METODOS_PIO, type MetodoPio, OLHOS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  lerCadastrosOftalmologia,
  lerGravacaoEspecialidade,
  lerOftalmologia,
  novaChaveEspecialidade,
  registrarExameOftalmologico,
} from '../api-especialidades.js';
import AvisoEspecialidade from '../componentes/AvisoEspecialidade.vue';
import CabecalhoInternacao from '../componentes/CabecalhoInternacao.vue';
import ErroEspecialidade from '../componentes/ErroEspecialidade.vue';
import { instanteCurto, numero } from '../regras-especialidades.js';

const { t } = useI18n();
const rota = useRoute();
const reg = computed(() => Number(rota.params['reg']));
const gravacao = useQuery({
  queryKey: ['especialidades', 'oftalmologia', 'gravacao'],
  queryFn: () => lerGravacaoEspecialidade('oftalmologia'),
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['registrar']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['registrar']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const cadastros = useQuery({
  queryKey: ['especialidades', 'oftalmologia', 'cadastros'],
  queryFn: lerCadastrosOftalmologia,
});
const dados = useQuery({
  queryKey: computed(() => ['especialidades', 'oftalmologia', reg.value]),
  queryFn: () => lerOftalmologia(reg.value),
});

const acuidades = computed(() => [
  { valor: null, rotulo: t('especialidades.oftalmologia.naoMedida') },
  ...(cadastros.data.value?.acuidades ?? []).map((a) => ({ valor: a.codigo, rotulo: a.nome })),
]);
const graduacoes = computed(() => [
  { valor: null, rotulo: t('especialidades.oftalmologia.naoMedida') },
  ...(cadastros.data.value?.graduacoes ?? []).map((g) => ({
    valor: g.codigo,
    rotulo: `${g.sigla}: ${g.nome}`,
  })),
]);
const exames = computed(() =>
  (cadastros.data.value?.exames ?? []).map((e) => ({ valor: e.codigo, rotulo: e.nome })),
);
const metodos = computed(() => [
  { valor: null, rotulo: t('especialidades.oftalmologia.semPio') },
  ...METODOS_PIO.map((m) => ({ valor: m.codigo, rotulo: m.rotulo })),
]);
const lados = computed(() =>
  LADOS_EXAME.map((l) => ({ valor: l, rotulo: t(`especialidades.oftalmologia.lados.${l}`) })),
);

interface Olho {
  acuidadeSemCorrecao: number | null;
  acuidadeComCorrecao: number | null;
  pio: number | null;
  gonioscopia: number | null;
}
const novoOlho = (): Olho => ({
  acuidadeSemCorrecao: null,
  acuidadeComCorrecao: null,
  pio: null,
  gonioscopia: null,
});
const od = reactive<Olho>(novoOlho());
const oe = reactive<Olho>(novoOlho());
const olhos = [
  { chave: 'od' as const, valor: od },
  { chave: 'oe' as const, valor: oe },
];
const metodoPio = ref<MetodoPio | null>(null);
const itens = ref<{ exame: number | null; lado: LadoExame; resultado: string }[]>([]);
const conduta = ref('');
const pioTexto = reactive<Record<'od' | 'oe', string>>({ od: '', oe: '' });

function adicionarExame(): void {
  itens.value.push({ exame: null, lado: 'ao', resultado: '' });
}
function removerExame(i: number): void {
  itens.value.splice(i, 1);
}
const pioNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const alertas = ref<string[]>([]);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarExameOftalmologico(
      {
        internacao: reg.value,
        od: { ...od, pio: pioNum(pioTexto.od) },
        oe: { ...oe, pio: pioNum(pioTexto.oe) },
        metodoPio: metodoPio.value,
        exames: itens.value.filter((x) => x.exame !== null),
        ...(conduta.value.trim() ? { conduta: conduta.value.trim() } : {}),
      },
      novaChaveEspecialidade('oftalmo'),
    );
    mensagem.value = r.mensagem;
    alertas.value = r.alertas;
    Object.assign(od, novoOlho());
    Object.assign(oe, novoOlho());
    pioTexto.od = '';
    pioTexto.oe = '';
    itens.value = [];
    conduta.value = '';
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="esp-titulo" data-testid="tela-oftalmologia">
    <ErroEspecialidade v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('especialidades.carregando') }}</p>
    <template v-else>
      <CabecalhoInternacao
        :internacao="dados.data.value.internacao"
        :titulo="t('especialidades.oftalmologia.titulo')"
      />
      <p class="acoes">
        <RouterLink to="/pep/especialidades/oftalmologia">{{ t('especialidades.voltar') }}</RouterLink>
        <RouterLink to="/consultas/item/pep.especialidades.oftalmologia-exames-e-acuidade">{{
          t('especialidades.oftalmologia.cadastros')
        }}</RouterLink>
      </p>
      <AvisoEspecialidade :motivo="aviso" />
      <SanteAlerta
        v-if="mensagem"
        variante="info"
        :texto="mensagem"
        anunciar
        data-testid="oftalmo-mensagem"
      />
      <ul v-if="alertas.length" class="alertas" data-testid="oftalmo-alertas">
        <li v-for="a in alertas" :key="a">{{ a }}</li>
      </ul>
      <section class="painel" aria-labelledby="oftalmo-exames">
        <h2 id="oftalmo-exames">{{ t('especialidades.oftalmologia.exames') }}</h2>
        <p v-if="dados.data.value.exames.length === 0">{{ t('especialidades.oftalmologia.semExames') }}</p>
        <article
          v-for="x in dados.data.value.exames"
          :key="x.id"
          class="registro"
          :data-testid="`oftalmo-exame-${x.id}`"
        >
          <p>
            <strong>{{ t(`especialidades.oftalmologia.classificacoes.${x.classificacao}`) }}</strong>
            · {{ x.por }} · {{ instanteCurto(x.em) }}
          </p>
          <table class="tabela">
            <caption>
              {{
                t('especialidades.oftalmologia.olhos')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('especialidades.oftalmologia.olho') }}</th>
                <th scope="col">{{ t('especialidades.oftalmologia.acuidadeSc') }}</th>
                <th scope="col">{{ t('especialidades.oftalmologia.acuidadeCc') }}</th>
                <th scope="col">{{ t('especialidades.oftalmologia.pio') }}</th>
                <th scope="col">{{ t('especialidades.oftalmologia.gonioscopia') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in OLHOS" :key="k">
                <th scope="row">{{ t(`especialidades.oftalmologia.lados.${k}`) }}</th>
                <td>{{ x[k].acuidadeSemCorrecao ?? '-' }}</td>
                <td>{{ x[k].acuidadeComCorrecao ?? '-' }}</td>
                <td>{{ x[k].pio === null ? '-' : `${numero(x[k].pio)} mmHg` }}</td>
                <td>{{ x[k].gonioscopia ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
          <ul v-if="x.exames.length" class="lista-simples">
            <li v-for="(i, n) in x.exames" :key="n">
              {{ i.exame }} ({{ t(`especialidades.oftalmologia.lados.${i.lado}`) }}): {{ i.resultado }}
            </li>
          </ul>
          <p v-for="a in x.alertas" :key="a" class="alerta-texto">{{ a }}</p>
          <p v-if="x.conduta">{{ t('especialidades.conduta') }}: {{ x.conduta }}</p>
        </article>
      </section>
      <section class="painel" aria-labelledby="oftalmo-novo">
        <h2 id="oftalmo-novo">{{ t('especialidades.oftalmologia.novo') }}</h2>
        <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
        <form v-else class="formulario" data-testid="form-oftalmo" @submit.prevent="gravar">
          <fieldset v-for="o in olhos" :key="o.chave" class="grade">
            <legend>{{ t(`especialidades.oftalmologia.lados.${o.chave}`) }}</legend>
            <SanteSelecao
              v-model="o.valor.acuidadeSemCorrecao"
              :rotulo="t('especialidades.oftalmologia.acuidadeScDe', { olho: o.chave.toUpperCase() })"
              :opcoes="acuidades"
            />
            <SanteSelecao
              v-model="o.valor.acuidadeComCorrecao"
              :rotulo="t('especialidades.oftalmologia.acuidadeCcDe', { olho: o.chave.toUpperCase() })"
              :opcoes="acuidades"
            />
            <div class="campo">
              <label :for="`pio-${o.chave}`">{{
                t('especialidades.oftalmologia.pioDe', { olho: o.chave.toUpperCase() })
              }}</label>
              <input
                :id="`pio-${o.chave}`"
                v-model="pioTexto[o.chave]"
                type="text"
                inputmode="decimal"
                maxlength="5"
              />
            </div>
            <SanteSelecao
              v-model="o.valor.gonioscopia"
              :rotulo="t('especialidades.oftalmologia.gonioscopiaDe', { olho: o.chave.toUpperCase() })"
              :opcoes="graduacoes"
            />
          </fieldset>
          <SanteSelecao
            v-model="metodoPio"
            :rotulo="t('especialidades.oftalmologia.metodo')"
            :opcoes="metodos"
          />
          <fieldset class="itens">
            <legend>{{ t('especialidades.oftalmologia.complementares') }}</legend>
            <div v-for="(x, i) in itens" :key="i" class="grade">
              <SanteSelecao
                v-model="x.exame"
                :rotulo="t('especialidades.oftalmologia.exame', { n: i + 1 })"
                :opcoes="exames"
                busca
              />
              <SanteSelecao
                v-model="x.lado"
                :rotulo="t('especialidades.oftalmologia.lado', { n: i + 1 })"
                :opcoes="lados"
              />
              <SanteCampoTexto
                v-model="x.resultado"
                :rotulo="t('especialidades.oftalmologia.resultado', { n: i + 1 })"
                :max-bytes="500"
              />
              <SanteBotao variante="texto" :rotulo="t('especialidades.remover')" @click="removerExame(i)" />
            </div>
            <SanteBotao
              variante="secundario"
              :rotulo="t('especialidades.oftalmologia.adicionar')"
              data-testid="oftalmo-adicionar"
              @click="adicionarExame"
            />
          </fieldset>
          <SanteCampoTexto
            v-model="conduta"
            :rotulo="t('especialidades.condutaOpcional')"
            :max-bytes="1000"
            multilinha
          />
          <ErroEspecialidade v-if="erro" :erro="erro" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('especialidades.gravar')"
            :desabilitado="ocupado"
            data-testid="oftalmo-gravar"
          />
        </form>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-especialidades.css"></style>
