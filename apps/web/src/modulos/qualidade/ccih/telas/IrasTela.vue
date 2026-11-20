<script setup lang="ts">
// Qualidade e segurança › CCIH › Ficha de IRAS e denominadores automáticos (M48, etapa 3; ficha, seção 7; regra 5): o
// painel da competência por setor (pacientes-dia do censo, dispositivos-dia do registro de dispositivos, densidade por
// 1.000 dispositivos-dia e utilização, cada um com a conta impressa), o aviso de censo incompleto, as fichas da
// competência (descartar com justificativa) e "Registrar IRAS" para um internado.
import '../../componentes/estilo-qualidade.css';
import '../componentes/estilo-ccih.css';
import { rotuloCriterioIras, rotuloSitioIras, TIPOS_DISPOSITIVO_INVASIVO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';
import { dataHora } from '../../regras-qualidade.js';
import {
  descartarIras,
  type IrasTela,
  lerDenominadores,
  lerFormularioCcih,
  lerInternadosCcih,
  listarIras,
  novaChaveCcih,
  retirarDispositivo,
} from '../api-ccih.js';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import CompetenciasCcih from '../componentes/CompetenciasCcih.vue';
import ContaParcela from '../componentes/ContaParcela.vue';
import CorrecoesCcih from '../componentes/CorrecoesCcih.vue';
import ErroCcih from '../componentes/ErroCcih.vue';
import FormularioIras from '../componentes/FormularioIras.vue';
import NavCcih from '../componentes/NavCcih.vue';
import { competenciaDe, competenciasRecentes, rotuloCompetencia } from '../regras-ccih.js';

const { t } = useI18n();
const cliente = useQueryClient();
const formulario = useQuery({
  queryKey: ['ccih', 'formulario'],
  queryFn: lerFormularioCcih,
  staleTime: 60_000,
});
const podeRegistrar = computed(
  () => (formulario.data.value?.acoes.iras ?? false) && pode('qualidade.iras.registrar'),
);

const filtro = reactive({ competencia: '', setor: '' });
watch(
  formulario.data,
  (f) => {
    if (f && !filtro.competencia) filtro.competencia = competenciaDe(f.agora);
  },
  { immediate: true },
);
const competencia = computed(() => filtro.competencia);
const opCompetencia = computed(() =>
  formulario.data.value
    ? competenciasRecentes(formulario.data.value.agora).map((c) => ({
        valor: c,
        rotulo: rotuloCompetencia(c),
      }))
    : [],
);
const den = useQuery({
  queryKey: computed(() => ['ccih', 'denominadores', competencia.value, filtro.setor]),
  queryFn: () => lerDenominadores(competencia.value, filtro.setor || undefined),
  enabled: computed(() => !!competencia.value),
});
const fichas = useQuery({
  queryKey: computed(() => ['ccih', 'iras', competencia.value, filtro.setor]),
  queryFn: () => listarIras(competencia.value, filtro.setor || undefined),
  enabled: computed(() => !!competencia.value),
});
// Os dispositivos sem retirada de quem já recebeu alta (a contagem parou na alta; D-ALTA-DISP-48.3).
const podeRetirar = computed(
  () => (formulario.data.value?.acoes.registrar ?? false) && pode('qualidade.ccih.registrar'),
);
const rotuloTipoDispositivo = (c: string) =>
  TIPOS_DISPOSITIVO_INVASIVO.find((x) => x.codigo === c)?.rotulo ?? c;
const erroRetirada = ref<unknown>(null);
const chaveRetirada = ref(novaChaveCcih('retirar'));
async function retirarNaAlta(d: {
  id: number;
  versao: number;
  inseridoEm: string;
  alta: string;
}): Promise<void> {
  erroRetirada.value = null;
  const naAlta = `${d.alta}T00:00`;
  try {
    await retirarDispositivo(
      d.id,
      {
        versao: d.versao,
        retiradoEm: naAlta > d.inseridoEm.slice(0, 16) ? naAlta : d.inseridoEm.slice(0, 16),
        motivo: 'alta',
        observacao: null,
      },
      chaveRetirada.value,
    );
    chaveRetirada.value = novaChaveCcih('retirar');
    await cliente.invalidateQueries({ queryKey: ['ccih'] });
  } catch (e) {
    erroRetirada.value = e;
  }
}
const opSetor = computed(() => [
  { valor: '', rotulo: t('ccih.todos') },
  ...(den.data.value?.setores ?? []).map((s) => ({ valor: s.setor, rotulo: s.setor })),
]);
const linhas = computed(() => {
  const d = den.data.value;
  if (!d) return [];
  return filtro.setor || d.setores.length <= 1
    ? d.setores
    : [...d.setores, { ...d.todos, setor: t('ccih.iras.totalGeral') }];
});
const SITIOS = [
  { sitio: 'ipcs', dispositivo: 'cvc', sigla: 'CVC' },
  { sitio: 'pav', dispositivo: 'ventilacaoMecanica', sigla: 'VM' },
  { sitio: 'itu', dispositivo: 'sondaVesical', sigla: 'SVD' },
] as const;

// ── Registrar ──
const internados = useQuery({
  queryKey: ['ccih', 'internados'],
  queryFn: lerInternadosCcih,
  enabled: podeRegistrar,
});
const escolhido = ref<number | null>(null);
const registrando = ref(false);
const opInternados = computed(() => [
  { valor: null as number | null, rotulo: '' },
  ...(internados.data.value?.itens ?? []).map((i) => ({
    valor: i.internacao as number | null,
    rotulo: `${i.leito} · ${i.nome} (${i.prontuario})`,
  })),
]);
const aviso = ref<string | null>(null);
async function gravada(): Promise<void> {
  registrando.value = false;
  escolhido.value = null;
  aviso.value = t('ccih.iras.gravada');
  await cliente.invalidateQueries({ queryKey: ['ccih'] });
}

// ── W0-04: alterar a ficha (409 na competência fechada, com a oferta da reabertura) e as competências ──
const correcoes = ref<InstanceType<typeof CorrecoesCcih> | null>(null);
function alterado(texto: string): void {
  aviso.value = texto;
}

// ── Descartar ──
const descarte = reactive({ id: 0, justificativa: '' });
const erroDescarte = ref<unknown>(null);
const chaveDescarte = ref(novaChaveCcih('descartar'));
function abrirDescarte(x: IrasTela): void {
  Object.assign(descarte, { id: x.id, justificativa: '' });
}
async function descartar(x: IrasTela): Promise<void> {
  erroDescarte.value = null;
  try {
    await descartarIras(
      x.id,
      { versao: x.versao, justificativa: descarte.justificativa.trim() },
      chaveDescarte.value,
    );
    chaveDescarte.value = novaChaveCcih('descartar');
    descarte.id = 0;
    await cliente.invalidateQueries({ queryKey: ['ccih'] });
  } catch (e) {
    erroDescarte.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ccih-iras-titulo" data-testid="tela-ccih-iras">
    <h1 id="ccih-iras-titulo">{{ t('ccih.iras.titulo') }}</h1>
    <NavCcih />
    <p class="secundario">{{ t('ccih.iras.explicacao') }}</p>
    <SanteAlerta
      v-if="formulario.data.value && !formulario.data.value.ligada"
      variante="info"
      :texto="formulario.data.value.motivo ?? t('ccih.desligado')"
    />
    <form class="filtros" @submit.prevent>
      <SanteSelecao
        v-model="filtro.competencia"
        :rotulo="t('ccih.competencia')"
        :opcoes="opCompetencia"
        data-testid="filtro-competencia"
      />
      <SanteSelecao
        v-model="filtro.setor"
        :rotulo="t('ccih.setor')"
        :opcoes="opSetor"
        data-testid="filtro-setor"
      />
    </form>

    <section class="painel-ccih" aria-labelledby="ccih-den-titulo">
      <h2 id="ccih-den-titulo">{{ t('ccih.iras.denominadores') }}</h2>
      <ErroCcih v-if="den.isError.value" :erro="den.error.value" />
      <p v-else-if="!den.data.value" role="status">{{ t('ccih.carregando') }}</p>
      <template v-else>
        <SanteAlerta
          v-if="!den.data.value.censo.completo"
          variante="aviso"
          :texto="
            t('ccih.iras.censoIncompleto', {
              fechados: den.data.value.censo.diasFechados,
              terminados: den.data.value.censo.diasTerminados,
            })
          "
          data-testid="censo-incompleto"
        />
        <div v-if="den.data.value.semRetirada.length" data-testid="dispositivos-sem-retirada">
          <SanteAlerta
            variante="aviso"
            :texto="t('ccih.iras.semRetirada', { n: den.data.value.semRetirada.length })"
          />
          <ErroCcih v-if="erroRetirada" :erro="erroRetirada" />
          <ul>
            <li v-for="d in den.data.value.semRetirada" :key="d.id" :data-testid="`sem-retirada-${d.id}`">
              {{
                t('ccih.iras.semRetiradaItem', {
                  tipo: rotuloTipoDispositivo(d.tipo),
                  setor: d.setor,
                  internacao: d.internacao,
                  inserido: dataHora(d.inseridoEm),
                  alta: dataHora(d.alta),
                })
              }}
              <SanteBotao
                v-if="podeRetirar"
                :rotulo="t('ccih.iras.retirarNaAlta')"
                variante="texto"
                :data-testid="`retirar-na-alta-${d.id}`"
                @acionar="retirarNaAlta(d)"
              />
            </li>
          </ul>
        </div>
        <p v-if="!linhas.length">{{ t('ccih.nenhum') }}</p>
        <table v-else class="tabela" data-testid="tabela-denominadores">
          <caption>
            {{
              t('ccih.iras.legendaDenominadores', {
                competencia: rotuloCompetencia(den.data.value.competencia),
              })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ccih.iras.colSetor') }}</th>
              <th scope="col">{{ t('ccih.iras.colPacientesDia') }}</th>
              <th scope="col">{{ t('ccih.iras.colDispositivosDia') }}</th>
              <th scope="col">{{ t('ccih.iras.colIras') }}</th>
              <th scope="col">{{ t('ccih.iras.colDensidade') }}</th>
              <th scope="col">{{ t('ccih.iras.colUtilizacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in linhas" :key="l.setor" :data-testid="`den-${l.setor}`">
              <th scope="row">{{ l.setor }}</th>
              <td>{{ l.pacientesDia }}</td>
              <td>
                <div v-for="x in SITIOS" :key="x.dispositivo">
                  {{ x.sigla }}: {{ l.dispositivosDia[x.dispositivo] }}
                </div>
              </td>
              <td>
                <div v-for="x in SITIOS" :key="x.sitio">
                  {{ x.sitio.toUpperCase() }}: {{ l.iras[x.sitio] }}
                </div>
              </td>
              <td>
                <div v-for="x in SITIOS" :key="x.sitio">
                  {{ x.sitio.toUpperCase() }}: <ContaParcela :parcela="l.densidade[x.sitio]" />
                </div>
              </td>
              <td>
                <div v-for="x in SITIOS" :key="x.dispositivo">
                  {{ x.sigla }}: <ContaParcela :parcela="l.utilizacao[x.dispositivo]" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <section class="painel-ccih" aria-labelledby="ccih-fichas-titulo">
      <h2 id="ccih-fichas-titulo">{{ t('ccih.iras.fichas') }}</h2>
      <div v-if="aviso" role="status" data-testid="iras-aviso">{{ aviso }}</div>
      <template v-if="podeRegistrar">
        <div class="linha-ccih">
          <SanteSelecao
            v-model="escolhido"
            :rotulo="t('ccih.iras.escolherPaciente')"
            :opcoes="opInternados"
            busca
            data-testid="iras-paciente"
          />
          <SanteBotao
            :rotulo="t('ccih.iras.nova')"
            variante="secundario"
            :desabilitado="escolhido === null"
            data-testid="iras-nova"
            @acionar="registrando = true"
          />
        </div>
        <FormularioIras
          v-if="registrando && escolhido !== null"
          :internacao="escolhido"
          @gravado="gravada"
          @cancelar="registrando = false"
        />
      </template>
      <ErroCcih v-if="fichas.isError.value" :erro="fichas.error.value" />
      <p v-else-if="!fichas.data.value" role="status">{{ t('ccih.carregando') }}</p>
      <p v-else-if="!fichas.data.value.itens.length" data-testid="iras-nenhuma">
        {{ t('ccih.iras.nenhuma') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-iras">
        <caption>
          {{
            t('ccih.iras.legendaFichas', { competencia: rotuloCompetencia(fichas.data.value.competencia) })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('ccih.iras.colData') }}</th>
            <th scope="col">{{ t('ccih.iras.colSitio') }}</th>
            <th scope="col">{{ t('ccih.setor') }}</th>
            <th scope="col">{{ t('ccih.iras.colCriterios') }}</th>
            <th scope="col">{{ t('ccih.iras.colAssociada') }}</th>
            <th scope="col">{{ t('ccih.iras.colSituacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in fichas.data.value.itens" :key="x.id" :data-testid="`iras-${x.id}`">
            <td>{{ dataHora(x.dataInfeccao) }}</td>
            <td>
              {{ rotuloSitioIras(x.sitio as never) }}
              <div v-if="x.microrganismo" class="secundario">
                {{ x.microrganismo }}
                <span v-if="x.multirresistente" class="selo selo--grave">{{
                  t('ccih.iras.multirresistente')
                }}</span>
              </div>
            </td>
            <td>{{ x.setor }}</td>
            <td>
              <span v-for="c in x.criterios" :key="c" class="selo">{{ rotuloCriterioIras(c as never) }}</span>
            </td>
            <td>{{ x.dispositivo !== null ? t('ccih.iras.associada') : t('ccih.iras.naoAssociada') }}</td>
            <td>
              {{ x.situacao === 'confirmada' ? t('ccih.iras.confirmada') : t('ccih.iras.descartada') }}
              <div v-if="x.motivoDescarte" class="secundario">{{ x.motivoDescarte }}</div>
              <SanteBotao
                v-if="podeRegistrar && x.situacao === 'confirmada'"
                :rotulo="t('qualidade.correcao.alterar')"
                variante="texto"
                :data-testid="`alterar-iras-${x.id}`"
                @acionar="correcoes?.alterarIras(x)"
              />
              <HistoricoVersoes registro="iras" :id="x.id" />
              <template v-if="podeRegistrar && x.situacao === 'confirmada'">
                <SanteBotao
                  v-if="descarte.id !== x.id"
                  :rotulo="t('ccih.iras.descartar')"
                  variante="texto"
                  :data-testid="`descartar-${x.id}`"
                  @acionar="abrirDescarte(x)"
                />
                <div v-else class="linha-ccih">
                  <SanteCampoTexto
                    v-model="descarte.justificativa"
                    :rotulo="t('ccih.iras.justificativaDescarte')"
                    :max-bytes="500"
                    obrigatorio
                    data-testid="descarte-justificativa"
                  />
                  <SanteBotao
                    :rotulo="t('ccih.gravar')"
                    variante="destrutivo"
                    :confirmacao="t('ccih.iras.descartar')"
                    :desabilitado="descarte.justificativa.trim().length < 10"
                    data-testid="descarte-gravar"
                    @acionar="descartar(x)"
                  />
                  <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="descarte.id = 0" />
                </div>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <ErroCcih v-if="erroDescarte" :erro="erroDescarte" />
    </section>

    <CompetenciasCcih v-if="competencia" :competencia="competencia" @alterado="alterado" />
    <CorrecoesCcih ref="correcoes" @alterado="alterado" />
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
