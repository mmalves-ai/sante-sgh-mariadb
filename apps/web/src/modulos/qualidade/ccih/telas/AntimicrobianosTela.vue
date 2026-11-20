<script setup lang="ts">
// Qualidade e segurança › CCIH › Uso de antimicrobianos (M48, etapa 3; ficha, seção 7; regra 6): a fila de liberação
// dos restritos em uso (situação e prazo da política; decidir liberado, liberado com ajuste ou não liberado com a
// orientação; revisão do 3º e do 7º dia), o painel do consumo da competência em DDD e DOT por 1.000 pacientes-dia com
// as parcelas, e a política dos itens (restrito, ATC, DDD e gramas por unidade). O sistema nunca suspende sozinho.
import '../../componentes/estilo-qualidade.css';
import '../componentes/estilo-ccih.css';
import {
  CONDUTAS_REVISAO_ANTIMICROBIANO,
  DECISOES_ANTIMICROBIANO,
  MARCOS_REVISAO_ANTIMICROBIANO,
  rotuloSituacaoLiberacaoAntimicrobiano,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  configurarAntimicrobiano,
  type FilaAntimicrobianos,
  type ItemAntimicrobianoTela,
  lerConsumoAntimicrobianos,
  lerFilaAntimicrobianos,
  lerFormularioCcih,
  lerItensAntimicrobianos,
  liberarAntimicrobiano,
  novaChaveCcih,
  revisarAntimicrobiano,
} from '../api-ccih.js';
import ContaParcela from '../componentes/ContaParcela.vue';
import ErroCcih from '../componentes/ErroCcih.vue';
import NavCcih from '../componentes/NavCcih.vue';
import {
  classeDaSituacao,
  competenciaDe,
  competenciasRecentes,
  numeroDecimal,
  rotuloCompetencia,
} from '../regras-ccih.js';

type ItemFila = FilaAntimicrobianos['itens'][number];

const { t } = useI18n();
const cliente = useQueryClient();
const formulario = useQuery({
  queryKey: ['ccih', 'formulario'],
  queryFn: lerFormularioCcih,
  staleTime: 60_000,
});
const podeLiberar = computed(() => formulario.data.value?.acoes.liberar ?? false);
const secao = ref<'fila' | 'consumo' | 'politica'>('fila');
const opSecao = computed(() => [
  { valor: 'fila' as const, rotulo: t('ccih.antimicrobianos.fila') },
  { valor: 'consumo' as const, rotulo: t('ccih.antimicrobianos.consumo') },
  { valor: 'politica' as const, rotulo: t('ccih.antimicrobianos.politica') },
]);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

// ── Fila ──
const todos = ref(false);
const fila = useQuery({
  queryKey: computed(() => ['ccih', 'antimicrobianos', todos.value]),
  queryFn: () => lerFilaAntimicrobianos(todos.value),
  refetchInterval: 120_000,
  enabled: computed(() => secao.value === 'fila'),
});
const opDecisao = DECISOES_ANTIMICROBIANO.map((d) => ({ valor: d.codigo as string, rotulo: d.rotulo }));
const decisao = reactive({ item: 0, decisao: 'liberado', dias: '7', justificativa: '' });
const chaveDecisao = ref(novaChaveCcih('liberar'));
function abrirDecisao(x: ItemFila): void {
  Object.assign(decisao, { item: x.itemPrescricao, decisao: 'liberado', dias: '7', justificativa: '' });
  aviso.value = null;
}
async function decidir(): Promise<void> {
  erro.value = null;
  const nao = decisao.decisao === 'naoLiberado';
  const dias = Number.parseInt(decisao.dias, 10);
  try {
    const r = await liberarAntimicrobiano(
      {
        itemPrescricao: decisao.item,
        decisao: decisao.decisao as 'liberado' | 'liberadoComAjuste' | 'naoLiberado',
        diasAutorizados: nao ? null : Number.isFinite(dias) ? dias : null,
        justificativa: decisao.justificativa.trim() || null,
      },
      chaveDecisao.value,
    );
    chaveDecisao.value = novaChaveCcih('liberar');
    decisao.item = 0;
    aviso.value = r.noPrazo
      ? t('ccih.antimicrobianos.liberadoNoPrazo')
      : t('ccih.antimicrobianos.liberadoForaDoPrazo');
    await cliente.invalidateQueries({ queryKey: ['ccih'] });
  } catch (e) {
    erro.value = e;
  }
}
const opConduta = CONDUTAS_REVISAO_ANTIMICROBIANO.map((c) => ({
  valor: c.codigo as string,
  rotulo: c.rotulo,
}));
const revisao = reactive({ item: 0, conduta: 'manter', observacao: '' });
const chaveRevisao = ref(novaChaveCcih('revisar'));
const rotuloMarco = (m: string) => MARCOS_REVISAO_ANTIMICROBIANO.find((x) => x.codigo === m)?.rotulo ?? m;
function abrirRevisao(x: ItemFila): void {
  Object.assign(revisao, { item: x.itemPrescricao, conduta: 'manter', observacao: '' });
  aviso.value = null;
}
async function revisar(x: ItemFila): Promise<void> {
  if (!x.liberacao || !x.revisaoDevida) return;
  erro.value = null;
  try {
    await revisarAntimicrobiano(
      x.liberacao.id,
      {
        versao: x.liberacao.versao,
        marco: x.revisaoDevida.marco,
        conduta: revisao.conduta,
        observacao: revisao.observacao.trim() || null,
      },
      chaveRevisao.value,
    );
    chaveRevisao.value = novaChaveCcih('revisar');
    revisao.item = 0;
    aviso.value = t('ccih.gravado');
    await cliente.invalidateQueries({ queryKey: ['ccih'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Consumo ──
const competencia = ref('');
watch(
  formulario.data,
  (f) => {
    if (f && !competencia.value) competencia.value = competenciaDe(f.agora);
  },
  { immediate: true },
);
const opCompetencia = computed(() =>
  formulario.data.value
    ? competenciasRecentes(formulario.data.value.agora).map((c) => ({
        valor: c,
        rotulo: rotuloCompetencia(c),
      }))
    : [],
);
const consumo = useQuery({
  queryKey: computed(() => ['ccih', 'consumo', competencia.value]),
  queryFn: () => lerConsumoAntimicrobianos(competencia.value),
  enabled: computed(() => secao.value === 'consumo' && !!competencia.value),
});
const numeroBr = (v: number | null) =>
  v === null ? '-' : v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ── Política ──
const itens = useQuery({
  queryKey: ['ccih', 'itens'],
  queryFn: lerItensAntimicrobianos,
  enabled: computed(() => secao.value === 'politica'),
});
const busca = ref('');
const itensFiltrados = computed(() => {
  const b = busca.value.trim().toUpperCase();
  return (itens.data.value?.itens ?? []).filter((i) => !b || i.nome.toUpperCase().includes(b)).slice(0, 200);
});
const politica = reactive({ item: 0, restrito: false, atc: '', ddd: '', gramas: '' });
const chavePolitica = ref(novaChaveCcih('politica'));
const numeroInvalido = ref(false);
function abrirPolitica(i: ItemAntimicrobianoTela): void {
  const br = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
  Object.assign(politica, {
    item: i.item,
    restrito: i.restrito,
    atc: i.atc ?? '',
    ddd: br(i.dddGramas),
    gramas: br(i.gramasPorUnidade),
  });
  numeroInvalido.value = false;
  aviso.value = null;
}
async function gravarPolitica(): Promise<void> {
  erro.value = null;
  const ddd = numeroDecimal(politica.ddd);
  const gramas = numeroDecimal(politica.gramas);
  numeroInvalido.value = ddd === undefined || gramas === undefined;
  if (ddd === undefined || gramas === undefined) return;
  try {
    await configurarAntimicrobiano(
      {
        item: politica.item,
        restrito: politica.restrito,
        atc: politica.atc.trim().toUpperCase() || null,
        dddGramas: ddd,
        gramasPorUnidade: gramas,
      },
      chavePolitica.value,
    );
    chavePolitica.value = novaChaveCcih('politica');
    politica.item = 0;
    aviso.value = t('ccih.gravado');
    await cliente.invalidateQueries({ queryKey: ['ccih'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ccih-atm-titulo" data-testid="tela-ccih-antimicrobianos">
    <h1 id="ccih-atm-titulo">{{ t('ccih.antimicrobianos.titulo') }}</h1>
    <NavCcih />
    <p class="secundario">
      {{ t('ccih.antimicrobianos.explicacao', { horas: formulario.data.value?.prazoLiberacaoHoras ?? 48 }) }}
    </p>
    <SanteAlerta
      v-if="formulario.data.value && !formulario.data.value.ligada"
      variante="info"
      :texto="formulario.data.value.motivo ?? t('ccih.desligado')"
    />
    <SanteOpcoes
      v-model="secao"
      :legenda="t('ccih.antimicrobianos.abas')"
      :opcoes="opSecao"
      nome="secao-atm"
    />
    <div v-if="aviso" role="status" data-testid="atm-aviso">{{ aviso }}</div>
    <ErroCcih v-if="erro" :erro="erro" />

    <section v-if="secao === 'fila'" class="painel-ccih" data-testid="atm-fila">
      <label
        ><input v-model="todos" type="checkbox" data-testid="atm-todos" />
        {{ t('ccih.antimicrobianos.mostrarTodos') }}</label
      >
      <ErroCcih v-if="fila.isError.value" :erro="fila.error.value" />
      <p v-else-if="!fila.data.value" role="status">{{ t('ccih.carregando') }}</p>
      <p v-else-if="!fila.data.value.itens.length" data-testid="atm-nenhum">
        {{ t('ccih.antimicrobianos.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-atm">
        <caption>
          {{
            t('ccih.antimicrobianos.legendaFila')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('ccih.antimicrobianos.colPaciente') }}</th>
            <th scope="col">{{ t('ccih.antimicrobianos.colItem') }}</th>
            <th scope="col">{{ t('ccih.antimicrobianos.colPrescrito') }}</th>
            <th scope="col">{{ t('ccih.antimicrobianos.colSituacao') }}</th>
            <th scope="col">{{ t('ccih.antimicrobianos.colRevisao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in fila.data.value.itens"
            :key="x.itemPrescricao"
            :data-testid="`atm-${x.itemPrescricao}`"
          >
            <td>
              {{ x.paciente }}
              <div class="secundario">{{ x.leito }}</div>
            </td>
            <td>{{ x.nome }}</td>
            <td>{{ dataHora(x.prescritoEm) }}</td>
            <td>
              <template v-if="x.restrito">
                <span :class="classeDaSituacao(x.situacao.situacao)">{{
                  rotuloSituacaoLiberacaoAntimicrobiano(x.situacao.situacao)
                }}</span>
                <div v-if="!x.liberacao" class="secundario">
                  {{ t('ccih.antimicrobianos.prazo', { em: dataHora(x.situacao.venceEm) }) }}
                </div>
                <div v-else class="secundario">
                  {{ t('ccih.antimicrobianos.decididoPor', { em: dataHora(x.liberacao.decididoEm) }) }}
                </div>
              </template>
              <span v-else class="secundario">-</span>
              <SanteBotao
                v-if="podeLiberar && x.restrito && !x.liberacao && decisao.item !== x.itemPrescricao"
                :rotulo="t('ccih.antimicrobianos.decidir')"
                variante="secundario"
                :data-testid="`decidir-${x.itemPrescricao}`"
                @acionar="abrirDecisao(x)"
              />
              <div v-if="decisao.item === x.itemPrescricao" class="linha-ccih" data-testid="form-decisao">
                <SanteSelecao
                  v-model="decisao.decisao"
                  :rotulo="t('ccih.antimicrobianos.decisao')"
                  :opcoes="opDecisao"
                  data-testid="decisao"
                />
                <SanteCampoTexto
                  v-if="decisao.decisao !== 'naoLiberado'"
                  v-model="decisao.dias"
                  :rotulo="t('ccih.antimicrobianos.diasAutorizados')"
                  :max-bytes="2"
                  data-testid="decisao-dias"
                />
                <SanteCampoTexto
                  v-model="decisao.justificativa"
                  :rotulo="t('ccih.antimicrobianos.justificativa')"
                  :max-bytes="500"
                  :obrigatorio="decisao.decisao !== 'liberado'"
                  multilinha
                  data-testid="decisao-justificativa"
                />
                <SanteBotao
                  :rotulo="t('ccih.gravar')"
                  variante="primario"
                  data-testid="decisao-gravar"
                  @acionar="decidir"
                />
                <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="decisao.item = 0" />
              </div>
            </td>
            <td>
              <template v-if="x.revisaoDevida">
                {{
                  t('ccih.antimicrobianos.revisaoDevida', {
                    marco: rotuloMarco(x.revisaoDevida.marco),
                    em: dataHora(x.revisaoDevida.devidaEm),
                  })
                }}
                <span v-if="x.revisaoDevida.atrasada" class="selo selo--grave">{{
                  t('ccih.antimicrobianos.revisaoAtrasada')
                }}</span>
                <SanteBotao
                  v-if="podeLiberar && x.liberacao && revisao.item !== x.itemPrescricao"
                  :rotulo="t('ccih.antimicrobianos.revisar')"
                  variante="texto"
                  :data-testid="`revisar-${x.itemPrescricao}`"
                  @acionar="abrirRevisao(x)"
                />
                <div v-if="revisao.item === x.itemPrescricao" class="linha-ccih">
                  <SanteSelecao
                    v-model="revisao.conduta"
                    :rotulo="t('ccih.antimicrobianos.conduta')"
                    :opcoes="opConduta"
                    data-testid="revisao-conduta"
                  />
                  <SanteCampoTexto
                    v-model="revisao.observacao"
                    :rotulo="t('ccih.observacao')"
                    :max-bytes="200"
                  />
                  <SanteBotao
                    :rotulo="t('ccih.gravar')"
                    variante="primario"
                    data-testid="revisao-gravar"
                    @acionar="revisar(x)"
                  />
                  <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="revisao.item = 0" />
                </div>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="fila.data.value?.cortada" role="status">{{ t('ccih.cortada') }}</p>
    </section>

    <section v-else-if="secao === 'consumo'" class="painel-ccih" data-testid="atm-consumo">
      <SanteSelecao v-model="competencia" :rotulo="t('ccih.competencia')" :opcoes="opCompetencia" />
      <ErroCcih v-if="consumo.isError.value" :erro="consumo.error.value" />
      <p v-else-if="!consumo.data.value" role="status">{{ t('ccih.carregando') }}</p>
      <template v-else>
        <p>{{ t('ccih.antimicrobianos.pacientesDia', { n: consumo.data.value.pacientesDia }) }}</p>
        <div class="linha-ccih">
          <div>
            {{ t('ccih.antimicrobianos.ddd') }}:
            <ContaParcela :parcela="consumo.data.value.dddPorMilPacientesDia" data-testid="consumo-ddd" />
          </div>
          <div>
            {{ t('ccih.antimicrobianos.dot') }}:
            <ContaParcela :parcela="consumo.data.value.dotPorMilPacientesDia" data-testid="consumo-dot" />
          </div>
        </div>
        <table v-if="consumo.data.value.itens.length" class="tabela" data-testid="tabela-consumo">
          <caption>
            {{
              t('ccih.antimicrobianos.legendaConsumo', {
                competencia: rotuloCompetencia(consumo.data.value.competencia),
              })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ccih.antimicrobianos.colItem') }}</th>
              <th scope="col">{{ t('ccih.antimicrobianos.colAtc') }}</th>
              <th scope="col">{{ t('ccih.antimicrobianos.colUnidades') }}</th>
              <th scope="col">{{ t('ccih.antimicrobianos.colDdd') }}</th>
              <th scope="col">{{ t('ccih.antimicrobianos.colDot') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in consumo.data.value.itens" :key="i.item">
              <td>{{ i.nome }}</td>
              <td>{{ i.atc ?? '-' }}</td>
              <td>{{ numeroBr(i.unidadesDispensadas) }}</td>
              <td>{{ numeroBr(i.ddd) }}</td>
              <td>{{ i.diasTerapia }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="consumo.data.value.semDdd.length">
          <p>{{ t('ccih.antimicrobianos.semDdd') }}</p>
          <ul class="lista-ccih" data-testid="consumo-sem-ddd">
            <li v-for="i in consumo.data.value.semDdd" :key="i.item">
              {{ i.nome }} · {{ numeroBr(i.unidadesDispensadas) }}
            </li>
          </ul>
        </template>
        <p v-if="consumo.data.value.cortada" role="status">{{ t('ccih.cortada') }}</p>
      </template>
    </section>

    <section v-else class="painel-ccih" data-testid="atm-politica">
      <SanteCampoTexto v-model="busca" :rotulo="t('ccih.antimicrobianos.buscaItem')" :max-bytes="60" />
      <ErroCcih v-if="itens.isError.value" :erro="itens.error.value" />
      <p v-else-if="!itens.data.value" role="status">{{ t('ccih.carregando') }}</p>
      <table v-else class="tabela" data-testid="tabela-politica">
        <caption>
          {{
            t('ccih.antimicrobianos.legendaPolitica')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('ccih.antimicrobianos.colItem') }}</th>
            <th scope="col">{{ t('ccih.antimicrobianos.colRestrito') }}</th>
            <th scope="col">{{ t('ccih.antimicrobianos.colAtc') }}</th>
            <th scope="col">{{ t('ccih.antimicrobianos.colDddGramas') }}</th>
            <th scope="col">{{ t('ccih.antimicrobianos.colGramasUnidade') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itensFiltrados" :key="i.item" :data-testid="`politica-${i.item}`">
            <td>
              {{ i.nome }}
              <div v-if="!i.configurado" class="secundario">
                {{ t('ccih.antimicrobianos.naoConfigurado') }}
              </div>
              <SanteBotao
                v-if="podeLiberar && politica.item !== i.item"
                :rotulo="t('ccih.antimicrobianos.configurar')"
                variante="texto"
                :data-testid="`configurar-${i.item}`"
                @acionar="abrirPolitica(i)"
              />
              <div v-if="politica.item === i.item" class="linha-ccih" data-testid="form-politica">
                <label
                  ><input v-model="politica.restrito" type="checkbox" data-testid="politica-restrito" />
                  {{ t('ccih.antimicrobianos.restrito') }}</label
                >
                <SanteCampoTexto
                  v-model="politica.atc"
                  :rotulo="t('ccih.antimicrobianos.atc')"
                  :max-bytes="7"
                />
                <SanteCampoTexto
                  v-model="politica.ddd"
                  :rotulo="t('ccih.antimicrobianos.dddGramas')"
                  :max-bytes="8"
                  data-testid="politica-ddd"
                />
                <SanteCampoTexto
                  v-model="politica.gramas"
                  :rotulo="t('ccih.antimicrobianos.gramasPorUnidade')"
                  :max-bytes="8"
                  data-testid="politica-gramas"
                />
                <SanteBotao
                  :rotulo="t('ccih.gravar')"
                  variante="primario"
                  data-testid="politica-gravar"
                  @acionar="gravarPolitica"
                />
                <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="politica.item = 0" />
                <p v-if="numeroInvalido" role="alert">{{ t('ccih.antimicrobianos.numeroInvalido') }}</p>
              </div>
            </td>
            <td>{{ i.restrito ? t('ccih.sim') : t('ccih.nao') }}</td>
            <td>{{ i.atc ?? '-' }}</td>
            <td>{{ numeroBr(i.dddGramas) }}</td>
            <td>{{ numeroBr(i.gramasPorUnidade) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
