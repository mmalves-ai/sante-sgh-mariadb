<script setup lang="ts">
// Qualidade e segurança › CCIH › Culturas positivas (F7, 09-AREA linha 68): a fila das culturas com crescimento agrupada
// por paciente, as pendentes primeiro. Cada cultura mostra os germes (multirresistente em destaque), o laudo retificado
// e as pendências que o servidor recalcula a cada leitura (ficha de IRAS a abrir, precaução a aplicar, laudo retificado
// depois da análise). A análise abre na própria linha: a conduta do cadastro já filtrada pela classificação, a precaução
// herdada da conduta e do germe multirresistente marcada sozinha, e o que falta aparece na hora (botão travado até
// estar completo). As recusas são as mesmas da API (@sgh/dominio-qualidade).
import '../../componentes/estilo-qualidade.css';
import '../componentes/estilo-ccih.css';
import {
  CLASSIFICACOES_CULTURA,
  type ClassificacaoCultura,
  MENSAGENS_ANALISE_CULTURA,
  MENSAGENS_PENDENCIA_CULTURA,
  type PendenciaAnaliseCultura,
} from '@sgh/dominio-qualidade';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';
import { dataHora } from '../../regras-qualidade.js';
import { codigoDaRecusa, novaChaveCcih } from '../api-ccih.js';
import {
  type CulturaDaFila,
  gravarAnalise,
  lerAnalisesDoPaciente,
  lerCondutas,
  lerCulturas,
} from '../api-culturas.js';
import ErroCcih from '../componentes/ErroCcih.vue';
import NavCcih from '../componentes/NavCcih.vue';
import CondutasCultura from '../componentes/CondutasCultura.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const podeAnalisar = pode('qualidade.iras.registrar');
const soPendentes = ref(true);
const verCondutas = ref(false);
const fila = useQuery({
  queryKey: ['ccih', 'culturas'],
  queryFn: () => lerCulturas(),
  refetchInterval: 120_000,
});
const condutas = useQuery({
  queryKey: ['ccih', 'culturas', 'condutas'],
  queryFn: lerCondutas,
  staleTime: 60_000,
});

const porPaciente = computed(() => {
  const m = new Map<number, { paciente: number; nome: string; culturas: CulturaDaFila[] }>();
  for (const c of fila.data.value ?? []) {
    if (soPendentes.value && !c.pendente) continue;
    const g = m.get(c.paciente) ?? { paciente: c.paciente, nome: c.nome, culturas: [] };
    g.culturas.push(c);
    m.set(c.paciente, g);
  }
  return [...m.values()];
});
const textoPendencia = (p: PendenciaAnaliseCultura) => MENSAGENS_PENDENCIA_CULTURA[p];

// ── Análise na linha ──
const f = reactive({
  cultura: 0,
  isolado: null as number | null,
  classificacao: '' as ClassificacaoCultura | '',
  conduta: null as number | null,
  descricao: '',
  precaucao: false,
  prescritor: false,
  ficha: '',
});
const chave = ref(novaChaveCcih('cultura'));
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const aberta = computed(() => (fila.data.value ?? []).find((c) => c.id === f.cultura) ?? null);
const germesAbertos = computed(() => (aberta.value?.germes ?? []).filter((g) => !g.analisado));
function abrir(c: CulturaDaFila): void {
  const livres = c.germes.filter((g) => !g.analisado);
  Object.assign(f, {
    cultura: c.id,
    isolado: livres.length === 1 ? livres[0]!.id : null,
    classificacao: '',
    conduta: null,
    descricao: '',
    precaucao: false,
    prescritor: false,
    ficha: '',
  });
  erro.value = null;
  aviso.value = null;
}
const opClassificacao = [
  { valor: '', rotulo: '' },
  ...CLASSIFICACOES_CULTURA.map((c) => ({
    valor: c as string,
    rotulo: t(`ccih.culturas.classificacoes.${c}`),
  })),
];
const opGermes = computed(() => [
  { valor: null as number | null, rotulo: '' },
  ...germesAbertos.value.map((g) => ({
    valor: g.id as number | null,
    rotulo: g.multirresistente
      ? `${g.microrganismo} (${t('ccih.culturas.multirresistente')})`
      : g.microrganismo,
  })),
]);
const condutasValidas = computed(() =>
  (condutas.data.value ?? []).filter(
    (c) => c.ativo && (c.classificacaoAplicavel === null || c.classificacaoAplicavel === f.classificacao),
  ),
);
const opCondutas = computed(() => [
  { valor: null as number | null, rotulo: t('ccih.culturas.condutaOutra') },
  ...condutasValidas.value.map((c) => ({ valor: c.id as number | null, rotulo: c.descricao })),
]);
const condutaEscolhida = computed(() => condutasValidas.value.find((c) => c.id === f.conduta) ?? null);
/** A conduta ou o germe multirresistente já indicam a precaução (a mesma regra do servidor). */
const precaucaoHerdada = computed(() => {
  const g = germesAbertos.value.find((x) => x.id === f.isolado);
  const mr = g
    ? g.multirresistente
    : germesAbertos.value.length === 0 && (aberta.value?.germes ?? []).some((x) => x.multirresistente);
  return (
    Boolean(condutaEscolhida.value?.indicaPrecaucao) ||
    (mr && (f.classificacao === 'infeccao' || f.classificacao === 'colonizacao'))
  );
});
const falta = computed(() => {
  const r: string[] = [];
  if (!f.classificacao) r.push(t('ccih.culturas.faltas.classificacao'));
  if (germesAbertos.value.length > 1 && f.isolado === null) r.push(t('ccih.culturas.faltas.germe'));
  if (f.conduta === null && !f.descricao.trim()) r.push(t('ccih.culturas.faltas.conduta'));
  if (condutaEscolhida.value?.exigeResposta && !f.prescritor) r.push(t('ccih.culturas.faltas.prescritor'));
  if (f.ficha.trim() && !/^\d+$/.test(f.ficha.trim())) r.push(t('ccih.culturas.faltas.ficha'));
  return r;
});
const recusaAnalise = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && c in MENSAGENS_ANALISE_CULTURA
    ? MENSAGENS_ANALISE_CULTURA[c as keyof typeof MENSAGENS_ANALISE_CULTURA]
    : null;
});
async function gravar(): Promise<void> {
  if (falta.value.length || !f.classificacao) return;
  erro.value = null;
  try {
    const r = await gravarAnalise(
      f.cultura,
      {
        classificacao: f.classificacao,
        isolado: f.isolado,
        conduta: f.conduta,
        condutaDescricao: f.conduta === null ? f.descricao.trim() : null,
        precaucaoIndicada: f.precaucao || precaucaoHerdada.value,
        prescritorOrientado: f.prescritor,
        casoInfeccao: f.classificacao === 'infeccao' && f.ficha.trim() ? Number(f.ficha.trim()) : null,
      },
      chave.value,
    );
    chave.value = novaChaveCcih('cultura');
    f.cultura = 0;
    aviso.value = r.pendencias.length
      ? t('ccih.culturas.gravadaComPendencias', { itens: r.pendencias.map(textoPendencia).join(' ') })
      : t('ccih.culturas.gravada');
    await cliente.invalidateQueries({ queryKey: ['ccih', 'culturas'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Visão do paciente ──
const pacienteVisto = ref<number | null>(null);
const analises = useQuery({
  queryKey: computed(() => ['ccih', 'culturas', 'analises', pacienteVisto.value]),
  queryFn: () => lerAnalisesDoPaciente(pacienteVisto.value!),
  enabled: computed(() => pacienteVisto.value !== null),
});
const exameDa = (cultura: number) =>
  (fila.data.value ?? []).find((c) => c.id === cultura)?.exame ?? `#${cultura}`;
const descricaoConduta = (a: { conduta: number | null; condutaDescricao: string | null }) =>
  a.conduta === null
    ? (a.condutaDescricao ?? '')
    : ((condutas.data.value ?? []).find((c) => c.id === a.conduta)?.descricao ?? `#${a.conduta}`);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ccih-cult-titulo" data-testid="tela-ccih-culturas">
    <h1 id="ccih-cult-titulo">{{ t('ccih.culturas.titulo') }}</h1>
    <NavCcih />
    <SanteBotao
      :rotulo="t('ccih.condutasCultura.abrir')"
      variante="texto"
      data-testid="culturas-condutas"
      @acionar="verCondutas = !verCondutas"
    />
    <CondutasCultura v-if="verCondutas" :condutas="condutas.data.value ?? []" />
    <p class="secundario">{{ t('ccih.culturas.explicacao') }}</p>
    <label class="linha-ccih"
      ><input v-model="soPendentes" type="checkbox" data-testid="culturas-so-pendentes" />{{
        t('ccih.culturas.soPendentes')
      }}</label
    >
    <div v-if="aviso" role="status" data-testid="cultura-aviso">{{ aviso }}</div>

    <ErroCcih v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('ccih.carregando') }}</p>
    <p v-else-if="!porPaciente.length" data-testid="culturas-nenhuma">{{ t('ccih.culturas.nenhuma') }}</p>
    <section
      v-for="g in porPaciente"
      :key="g.paciente"
      class="painel-ccih"
      :aria-label="t('ccih.culturas.paciente', { nome: g.nome })"
      :data-testid="`culturas-paciente-${g.paciente}`"
    >
      <div class="linha-ccih">
        <h2>{{ t('ccih.culturas.paciente', { nome: g.nome }) }}</h2>
        <SanteBotao
          :rotulo="t('ccih.culturas.verAnalises')"
          variante="texto"
          :data-testid="`culturas-ver-analises-${g.paciente}`"
          @acionar="pacienteVisto = g.paciente"
        />
      </div>
      <ul class="lista-ccih">
        <li v-for="c in g.culturas" :key="c.id" :data-testid="`cultura-${c.id}`">
          <strong>{{ c.exame }}</strong> · {{ c.material }} ·
          {{ t('ccih.culturas.resultado', { data: dataHora(c.resultadoEm) }) }}
          <span v-if="c.situacao === 'retificado'" class="selo selo--grave">{{
            t('ccih.culturas.retificado')
          }}</span>
          <div class="secundario">
            <span v-for="ge in c.germes" :key="ge.id" :data-testid="`cultura-germe-${ge.id}`">
              {{ ge.microrganismo }}
              <span v-if="ge.multirresistente" class="selo selo--grave">{{
                t('ccih.culturas.multirresistente')
              }}</span>
              <span v-if="ge.analisado">{{ t('ccih.culturas.analisado') }}</span>
            </span>
          </div>
          <div v-if="c.faltaAnalisar" class="selo" :data-testid="`cultura-falta-${c.id}`">
            {{ t('ccih.culturas.faltaAnalisar') }}
          </div>
          <div
            v-for="p in c.pendencias"
            :key="p"
            class="selo selo--grave"
            :data-testid="`cultura-pendencia-${c.id}-${p}`"
          >
            {{ textoPendencia(p) }}
          </div>
          <SanteBotao
            v-if="podeAnalisar && c.faltaAnalisar && f.cultura !== c.id"
            :rotulo="t('ccih.culturas.analisar')"
            variante="secundario"
            :data-testid="`cultura-analisar-${c.id}`"
            @acionar="abrir(c)"
          />
          <div v-if="f.cultura === c.id" class="painel-ccih" data-testid="form-analise">
            <div class="linha-ccih">
              <SanteSelecao
                v-if="germesAbertos.length > 1"
                v-model="f.isolado"
                :rotulo="t('ccih.culturas.germe')"
                :opcoes="opGermes"
                obrigatorio
                data-testid="analise-germe"
              />
              <SanteSelecao
                v-model="f.classificacao"
                :rotulo="t('ccih.culturas.classificacao')"
                :opcoes="opClassificacao"
                obrigatorio
                data-testid="analise-classificacao"
              />
              <SanteSelecao
                v-model="f.conduta"
                :rotulo="t('ccih.culturas.conduta')"
                :opcoes="opCondutas"
                data-testid="analise-conduta"
              />
            </div>
            <SanteCampoTexto
              v-if="f.conduta === null"
              v-model="f.descricao"
              :rotulo="t('ccih.culturas.condutaDescricao')"
              :max-bytes="1000"
              data-testid="analise-descricao"
            />
            <div class="linha-ccih">
              <label
                ><input
                  v-model="f.precaucao"
                  type="checkbox"
                  :disabled="precaucaoHerdada"
                  data-testid="analise-precaucao"
                />{{ t('ccih.culturas.precaucao') }}</label
              >
              <span v-if="precaucaoHerdada" class="secundario" data-testid="analise-precaucao-herdada">{{
                t('ccih.culturas.precaucaoHerdada')
              }}</span>
              <label
                ><input v-model="f.prescritor" type="checkbox" data-testid="analise-prescritor" />{{
                  t('ccih.culturas.prescritor')
                }}</label
              >
              <SanteCampoTexto
                v-if="f.classificacao === 'infeccao'"
                v-model="f.ficha"
                :rotulo="t('ccih.culturas.fichaIras')"
                :max-bytes="12"
                data-testid="analise-ficha"
              />
            </div>
            <p v-if="falta.length" class="secundario" data-testid="analise-falta">
              {{ t('ccih.culturas.falta', { itens: falta.join(', ') }) }}
            </p>
            <div v-if="recusaAnalise" role="alert" data-testid="recusa-analise">
              <SanteAlerta variante="alerta" :texto="recusaAnalise" />
            </div>
            <ErroCcih v-else-if="erro" :erro="erro" />
            <div class="linha-ccih">
              <SanteBotao
                :rotulo="t('ccih.gravar')"
                variante="primario"
                :desabilitado="falta.length > 0"
                data-testid="analise-gravar"
                @acionar="gravar"
              />
              <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="f.cultura = 0" />
            </div>
          </div>
        </li>
      </ul>
      <div v-if="pacienteVisto === g.paciente" data-testid="analises-paciente">
        <ErroCcih v-if="analises.isError.value" :erro="analises.error.value" />
        <p v-else-if="!analises.data.value" role="status">{{ t('ccih.carregando') }}</p>
        <table v-else class="tabela">
          <caption>
            {{
              t('ccih.culturas.analises')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ccih.culturas.colCultura') }}</th>
              <th scope="col">{{ t('ccih.culturas.colClassificacao') }}</th>
              <th scope="col">{{ t('ccih.culturas.colConduta') }}</th>
              <th scope="col">{{ t('ccih.culturas.colAnalista') }}</th>
              <th scope="col">{{ t('ccih.culturas.colPendencias') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in analises.data.value" :key="a.id" :data-testid="`analise-${a.id}`">
              <td>
                {{ exameDa(a.cultura) }}
                <span v-if="a.laudoRetificado" class="selo selo--grave">{{
                  t('ccih.culturas.retificado')
                }}</span>
              </td>
              <td>{{ t(`ccih.culturas.classificacoes.${a.classificacao}`) }}</td>
              <td>{{ descricaoConduta(a) }}</td>
              <td>{{ a.analista }} · {{ dataHora(a.analisadaEm) }}</td>
              <td>
                {{
                  a.pendencias.length
                    ? a.pendencias.map(textoPendencia).join(' ')
                    : t('ccih.culturas.semPendencia')
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
