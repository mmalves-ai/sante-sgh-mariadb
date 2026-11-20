<script setup lang="ts">
// O internado na vigilância da CCIH: dispositivos invasivos (registrar e retirar; a retirada acidental sugere notificar
// o incidente), IRAS da internação (registrar), precauções (definir e encerrar), antimicrobianos com a situação da
// liberação, culturas, cirurgias, a temperatura máxima das últimas 48 horas e os leitos da mesma acomodação.
import '../../componentes/estilo-qualidade.css';
import './estilo-ccih.css';
import {
  MOTIVOS_FIM_PRECAUCAO,
  MOTIVOS_RETIRADA_DISPOSITIVO,
  PRECAUCOES,
  rotuloDispositivoInvasivo,
  rotuloMotivoPrecaucao,
  rotuloSitioIras,
  rotuloSituacaoLiberacaoAntimicrobiano,
  type TipoDispositivoInvasivo,
  TIPOS_DISPOSITIVO_INVASIVO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  type DispositivoTela,
  encerrarPrecaucao,
  lerInternacaoCcih,
  novaChaveCcih,
  type PrecaucaoDefinida,
  type PrecaucaoTela,
  registrarDispositivo,
  retirarDispositivo,
} from '../api-ccih.js';
import { classeDaSituacao, instanteLocal } from '../regras-ccih.js';
import CorrecoesCcih from './CorrecoesCcih.vue';
import ErroCcih from './ErroCcih.vue';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import FormularioIras from './FormularioIras.vue';
import FormularioPrecaucao from './FormularioPrecaucao.vue';

const props = defineProps<{
  internacao: number;
  acoes: { registrar: boolean; iras: boolean; precaucao: boolean };
}>();
const emit = defineEmits<{ alterado: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const q = useQuery({
  queryKey: computed(() => ['ccih', 'internacao', props.internacao]),
  queryFn: () => lerInternacaoCcih(props.internacao),
});
const d = computed(() => q.data.value);
const aberta = computed(() => d.value?.internacao.aberta ?? false);
// W0-04: o cancelado fica visível como inativo (no histórico), fora dos ativos e dos dispositivos-dia.
const ativos = computed(() =>
  (d.value?.dispositivos ?? []).filter((x) => x.retiradoEm === null && !x.canceladoEm),
);
const historico = computed(() =>
  (d.value?.dispositivos ?? []).filter((x) => x.retiradoEm !== null || !!x.canceladoEm),
);
const correcoes = ref<InstanceType<typeof CorrecoesCcih> | null>(null);

const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
async function depois(texto: string): Promise<void> {
  aviso.value = texto;
  await cliente.invalidateQueries({ queryKey: ['ccih'] });
  emit('alterado');
}

// ── Dispositivo ──
const sigla = (tipo: string) => TIPOS_DISPOSITIVO_INVASIVO.find((x) => x.codigo === tipo)?.sigla ?? tipo;
const opTipo = [
  { valor: '' as TipoDispositivoInvasivo | '', rotulo: '' },
  ...TIPOS_DISPOSITIVO_INVASIVO.map((x) => ({
    valor: x.codigo as TipoDispositivoInvasivo | '',
    rotulo: x.rotulo,
  })),
];
const novo = reactive({
  aberto: false,
  tipo: '' as TipoDispositivoInvasivo | '',
  sitio: '',
  data: null as string | null,
  hora: null as string | null,
  observacao: '',
});
const chaveDisp = ref(novaChaveCcih('dispositivo'));
const faltaDisp = ref(false);
async function gravarDispositivo(): Promise<void> {
  erro.value = null;
  const em = instanteLocal(novo.data, novo.hora);
  faltaDisp.value = !novo.tipo || !em;
  if (!novo.tipo || !em) return;
  try {
    await registrarDispositivo(
      {
        internacao: props.internacao,
        tipo: novo.tipo,
        sitio: novo.sitio.trim() || null,
        inseridoEm: em,
        itemPrescricao: null,
        observacao: novo.observacao.trim() || null,
      },
      chaveDisp.value,
    );
    chaveDisp.value = novaChaveCcih('dispositivo');
    Object.assign(novo, { aberto: false, tipo: '', sitio: '', data: null, hora: null, observacao: '' });
    await depois(t('ccih.gravado'));
  } catch (e) {
    erro.value = e;
  }
}

const opRetirada = [
  { valor: '', rotulo: '' },
  ...MOTIVOS_RETIRADA_DISPOSITIVO.map((m) => ({ valor: m.codigo as string, rotulo: m.rotulo })),
];
const retirada = reactive({
  id: 0,
  data: null as string | null,
  hora: null as string | null,
  motivo: '',
  observacao: '',
});
const chaveRet = ref(novaChaveCcih('retirada'));
const sugerirNotificacao = ref(false);
function abrirRetirada(x: DispositivoTela): void {
  Object.assign(retirada, { id: x.id, data: null, hora: null, motivo: '', observacao: '' });
}
async function gravarRetirada(x: DispositivoTela): Promise<void> {
  erro.value = null;
  const em = instanteLocal(retirada.data, retirada.hora);
  if (!em || !retirada.motivo) {
    faltaDisp.value = true;
    return;
  }
  try {
    const r = await retirarDispositivo(
      x.id,
      {
        versao: x.versao,
        retiradoEm: em,
        motivo: retirada.motivo,
        observacao: retirada.observacao.trim() || null,
      },
      chaveRet.value,
    );
    chaveRet.value = novaChaveCcih('retirada');
    sugerirNotificacao.value = r.sugerirNotificacao;
    retirada.id = 0;
    await depois(t('ccih.gravado'));
  } catch (e) {
    erro.value = e;
  }
}

// ── IRAS e precaução ──
const formIras = ref(false);
const formPrecaucao = ref(false);
const ocupados = ref<string[]>([]);
async function irasGravada(): Promise<void> {
  formIras.value = false;
  await depois(t('ccih.iras.gravada'));
}
async function precaucaoGravada(r: PrecaucaoDefinida): Promise<void> {
  formPrecaucao.value = false;
  ocupados.value = r.vizinhosOcupados;
  await depois(t('ccih.precaucoes.definida'));
}
const rotuloTipo = (c: string) => PRECAUCOES.find((p) => p.codigo === c)?.rotulo ?? c;
const opFim = [
  { valor: '', rotulo: '' },
  ...MOTIVOS_FIM_PRECAUCAO.map((m) => ({ valor: m.codigo as string, rotulo: m.rotulo })),
];
const fim = reactive({ id: 0, motivo: '', observacao: '' });
const chaveFim = ref(novaChaveCcih('encerrar'));
function abrirFim(p: PrecaucaoTela): void {
  Object.assign(fim, { id: p.id, motivo: '', observacao: '' });
}
async function encerrar(p: PrecaucaoTela): Promise<void> {
  erro.value = null;
  if (!fim.motivo) return;
  try {
    await encerrarPrecaucao(
      p.id,
      { versao: p.versao, motivo: fim.motivo, observacao: fim.observacao.trim() || null },
      chaveFim.value,
    );
    chaveFim.value = novaChaveCcih('encerrar');
    fim.id = 0;
    await depois(t('ccih.precaucoes.encerrada'));
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="ficha-ccih-titulo" data-testid="ficha-internado">
    <h2 id="ficha-ccih-titulo">{{ t('ccih.ficha.titulo') }}</h2>
    <ErroCcih v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!d" role="status">{{ t('ccih.carregando') }}</p>
    <template v-else>
      <p>
        <strong>{{ d.internacao.nome }}</strong> ·
        {{ t('ccih.prontuario', { n: d.internacao.prontuario }) }} · {{ d.internacao.leito }} ·
        {{ t('ccih.vigilancia.entrada', { data: dataHora(d.internacao.entrada) }) }}
      </p>
      <p class="secundario" data-testid="ficha-temperatura">
        {{
          d.temperaturaMaxima48h === null
            ? t('ccih.ficha.semTemperatura')
            : t('ccih.ficha.temperatura', { t: d.temperaturaMaxima48h.toLocaleString('pt-BR') })
        }}
      </p>
      <SanteAlerta v-if="!aberta" variante="info" :texto="t('ccih.ficha.encerrada')" />
      <div v-if="aviso" role="status" data-testid="ficha-aviso">{{ aviso }}</div>
      <SanteAlerta
        v-if="sugerirNotificacao"
        variante="aviso"
        :texto="t('ccih.ficha.sugerirNotificacao')"
        data-testid="sugerir-notificacao"
      />
      <SanteAlerta
        v-if="ocupados.length"
        variante="alerta"
        :texto="t('ccih.precaucoes.vizinhosOcupados', { leitos: ocupados.join(', ') })"
        data-testid="vizinhos-ocupados"
      />
      <ErroCcih v-if="erro" :erro="erro" />

      <h3>{{ t('ccih.ficha.dispositivos') }}</h3>
      <p v-if="!d.dispositivos.length">{{ t('ccih.ficha.semDispositivos') }}</p>
      <ul v-else class="lista-ccih" data-testid="ficha-dispositivos">
        <li v-for="x in ativos" :key="x.id" :data-testid="`dispositivo-${x.id}`">
          <strong>{{ sigla(x.tipo) }}</strong> {{ rotuloDispositivoInvasivo(x.tipo) }}
          <span v-if="x.sitio">· {{ x.sitio }}</span> ·
          {{ t('ccih.ficha.inserido', { em: dataHora(x.inseridoEm) }) }} ·
          {{ t('ccih.ficha.emUso', { dias: x.dias }) }}
          <SanteBotao
            v-if="acoes.registrar && aberta && retirada.id !== x.id"
            :rotulo="t('ccih.ficha.retirar')"
            variante="texto"
            :data-testid="`retirar-${x.id}`"
            @acionar="abrirRetirada(x)"
          />
          <SanteBotao
            v-if="acoes.registrar"
            :rotulo="t('qualidade.correcao.corrigir')"
            variante="texto"
            :data-testid="`corrigir-dispositivo-${x.id}`"
            @acionar="correcoes?.corrigirDispositivo(x)"
          />
          <SanteBotao
            v-if="acoes.registrar"
            :rotulo="t('qualidade.correcao.cancelarRegistro')"
            variante="texto"
            :data-testid="`cancelar-dispositivo-${x.id}`"
            @acionar="correcoes?.cancelarDispositivo(x)"
          />
          <HistoricoVersoes registro="dispositivo" :id="x.id" />
          <div v-if="retirada.id === x.id" class="linha-ccih" :data-testid="`form-retirada-${x.id}`">
            <SanteData v-model="retirada.data" :rotulo="t('ccih.ficha.retiradoEm')" editavel />
            <SanteHora v-model="retirada.hora" :rotulo="t('ccih.ficha.horaRetirada')" editavel />
            <SanteSelecao
              v-model="retirada.motivo"
              :rotulo="t('ccih.ficha.motivoRetirada')"
              :opcoes="opRetirada"
              obrigatorio
              data-testid="retirada-motivo"
            />
            <SanteCampoTexto v-model="retirada.observacao" :rotulo="t('ccih.observacao')" :max-bytes="200" />
            <SanteBotao
              :rotulo="t('ccih.gravar')"
              variante="primario"
              data-testid="retirada-gravar"
              @acionar="gravarRetirada(x)"
            />
            <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="retirada.id = 0" />
          </div>
        </li>
        <li v-for="x in historico" :key="x.id" class="secundario" :data-testid="`dispositivo-${x.id}`">
          {{ sigla(x.tipo) }} · {{ t('ccih.ficha.inserido', { em: dataHora(x.inseridoEm) }) }}
          <template v-if="x.retiradoEm">
            ·
            {{
              t('ccih.ficha.retirado', {
                em: dataHora(x.retiradoEm),
                motivo: MOTIVOS_RETIRADA_DISPOSITIVO.find((m) => m.codigo === x.motivoRetirada)?.rotulo ?? '',
              })
            }}
          </template>
          <template v-if="x.canceladoEm">
            <span class="selo" :data-testid="`dispositivo-inativo-${x.id}`">{{
              t('qualidade.correcao.inativo')
            }}</span>
            {{
              t('qualidade.correcao.cancelada', {
                em: dataHora(x.canceladoEm),
                motivo: x.motivoCancelamento ?? '',
              })
            }}
          </template>
          <template v-else-if="acoes.registrar">
            <SanteBotao
              :rotulo="t('qualidade.correcao.corrigir')"
              variante="texto"
              :data-testid="`corrigir-dispositivo-${x.id}`"
              @acionar="correcoes?.corrigirDispositivo(x)"
            />
            <SanteBotao
              :rotulo="t('qualidade.correcao.cancelarRegistro')"
              variante="texto"
              :data-testid="`cancelar-dispositivo-${x.id}`"
              @acionar="correcoes?.cancelarDispositivo(x)"
            />
          </template>
          <HistoricoVersoes registro="dispositivo" :id="x.id" />
        </li>
      </ul>
      <template v-if="acoes.registrar && aberta">
        <SanteBotao
          v-if="!novo.aberto"
          :rotulo="t('ccih.ficha.novoDispositivo')"
          variante="secundario"
          data-testid="novo-dispositivo"
          @acionar="novo.aberto = true"
        />
        <div v-else class="linha-ccih" data-testid="form-dispositivo">
          <SanteSelecao
            v-model="novo.tipo"
            :rotulo="t('ccih.ficha.tipo')"
            :opcoes="opTipo"
            obrigatorio
            data-testid="dispositivo-tipo"
          />
          <SanteCampoTexto v-model="novo.sitio" :rotulo="t('ccih.ficha.sitio')" :max-bytes="40" />
          <SanteData
            v-model="novo.data"
            :rotulo="t('ccih.ficha.inseridoEm')"
            editavel
            data-testid="dispositivo-data"
          />
          <SanteHora
            v-model="novo.hora"
            :rotulo="t('ccih.ficha.horaInsercao')"
            editavel
            data-testid="dispositivo-hora"
          />
          <SanteCampoTexto v-model="novo.observacao" :rotulo="t('ccih.observacao')" :max-bytes="200" />
          <SanteBotao
            :rotulo="t('ccih.gravar')"
            variante="primario"
            data-testid="dispositivo-gravar"
            @acionar="gravarDispositivo"
          />
          <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="novo.aberto = false" />
        </div>
      </template>
      <p v-if="faltaDisp" role="alert">{{ t('ccih.campoObrigatorio') }}</p>

      <h3>{{ t('ccih.ficha.iras') }}</h3>
      <p v-if="!d.iras.length">{{ t('ccih.ficha.semIras') }}</p>
      <ul v-else class="lista-ccih" data-testid="ficha-iras">
        <li v-for="x in d.iras" :key="x.id" :data-testid="`ficha-iras-${x.id}`">
          {{ rotuloSitioIras(x.sitio as never) }} · {{ dataHora(x.dataInfeccao) }} ·
          {{ x.situacao === 'confirmada' ? t('ccih.iras.confirmada') : t('ccih.iras.descartada') }}
          <SanteBotao
            v-if="acoes.iras && x.situacao === 'confirmada'"
            :rotulo="t('qualidade.correcao.alterar')"
            variante="texto"
            :data-testid="`alterar-iras-${x.id}`"
            @acionar="correcoes?.alterarIras(x)"
          />
          <HistoricoVersoes registro="iras" :id="x.id" />
        </li>
      </ul>
      <template v-if="acoes.iras && aberta">
        <SanteBotao
          v-if="!formIras"
          :rotulo="t('ccih.ficha.registrarIras')"
          variante="secundario"
          data-testid="abrir-iras"
          @acionar="formIras = true"
        />
        <FormularioIras v-else :internacao="internacao" @gravado="irasGravada" @cancelar="formIras = false" />
      </template>

      <h3>{{ t('ccih.ficha.precaucoes') }}</h3>
      <p v-if="!d.precaucoes.some((p) => p.fimEm === null)">{{ t('ccih.ficha.semPrecaucoes') }}</p>
      <ul v-else class="lista-ccih" data-testid="ficha-precaucoes">
        <li v-for="p in d.precaucoes.filter((x) => x.fimEm === null)" :key="p.id">
          <strong>{{ rotuloTipo(p.tipo) }}</strong> ·
          {{ p.motivoOutro ?? rotuloMotivoPrecaucao(p.motivo as never) }}
          <span v-if="p.multirresistente" class="selo selo--grave">{{
            t('ccih.precaucoes.multirresistente')
          }}</span>
          · {{ t('ccih.desde', { data: dataHora(p.inicioEm) }) }}
          <SanteBotao
            v-if="acoes.precaucao && fim.id !== p.id"
            :rotulo="t('ccih.precaucoes.encerrar')"
            variante="texto"
            :data-testid="`encerrar-${p.id}`"
            @acionar="abrirFim(p)"
          />
          <SanteBotao
            v-if="acoes.precaucao"
            :rotulo="t('qualidade.correcao.alterar')"
            variante="texto"
            :data-testid="`alterar-precaucao-${p.id}`"
            @acionar="correcoes?.alterarPrecaucao(p)"
          />
          <HistoricoVersoes registro="precaucao" :id="p.id" />
          <div v-if="fim.id === p.id" class="linha-ccih">
            <SanteSelecao
              v-model="fim.motivo"
              :rotulo="t('ccih.precaucoes.motivoFim')"
              :opcoes="opFim"
              obrigatorio
            />
            <SanteCampoTexto v-model="fim.observacao" :rotulo="t('ccih.observacao')" :max-bytes="200" />
            <SanteBotao :rotulo="t('ccih.gravar')" variante="primario" @acionar="encerrar(p)" />
            <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="fim.id = 0" />
          </div>
        </li>
      </ul>
      <template v-if="acoes.precaucao && aberta">
        <SanteBotao
          v-if="!formPrecaucao"
          :rotulo="t('ccih.ficha.definirPrecaucao')"
          variante="secundario"
          data-testid="abrir-precaucao"
          @acionar="formPrecaucao = true"
        />
        <FormularioPrecaucao
          v-else
          :internacao="internacao"
          @gravado="precaucaoGravada"
          @cancelar="formPrecaucao = false"
        />
      </template>

      <h3>{{ t('ccih.ficha.antimicrobianos') }}</h3>
      <p v-if="!d.antimicrobianos.length">{{ t('ccih.ficha.semAntimicrobianos') }}</p>
      <ul v-else class="lista-ccih" data-testid="ficha-antimicrobianos">
        <li v-for="a in d.antimicrobianos" :key="a.itemPrescricao">
          {{ a.nome }}
          <template v-if="a.restrito">
            <span class="selo">{{ t('ccih.ficha.restrito') }}</span>
            <span :class="classeDaSituacao(a.situacao.situacao)">{{
              rotuloSituacaoLiberacaoAntimicrobiano(a.situacao.situacao)
            }}</span>
          </template>
          · {{ dataHora(a.inicioTratamento) }}
        </li>
      </ul>

      <h3>{{ t('ccih.ficha.culturas') }}</h3>
      <p v-if="!d.culturas.length">{{ t('ccih.ficha.semCulturas') }}</p>
      <ul v-else class="lista-ccih">
        <li v-for="c in d.culturas" :key="c.id">
          {{ c.exame }} · {{ dataHora(c.data) }} ·
          {{ c.liberado ? t('ccih.vigilancia.culturaLiberada') : t('ccih.vigilancia.culturaPendente') }}
        </li>
      </ul>

      <h3>{{ t('ccih.ficha.cirurgias') }}</h3>
      <p v-if="!d.cirurgias.length">{{ t('ccih.ficha.semCirurgias') }}</p>
      <ul v-else class="lista-ccih">
        <li v-for="c in d.cirurgias" :key="c.id">
          {{ t('ccih.ficha.cirurgia', { data: dataHora(c.data) }) }}
        </li>
      </ul>

      <template v-if="d.vizinhos.length">
        <h3>{{ t('ccih.ficha.vizinhos') }}</h3>
        <ul class="lista-ccih">
          <li v-for="v in d.vizinhos" :key="v.leito">
            {{ v.leito }} · {{ v.ocupado ? t('ccih.ficha.ocupado') : t('ccih.ficha.livre') }}
          </li>
        </ul>
      </template>
    </template>
    <CorrecoesCcih ref="correcoes" @alterado="depois" />
  </section>
</template>
