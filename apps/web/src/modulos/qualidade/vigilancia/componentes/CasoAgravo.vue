<script setup lang="ts">
// Um caso de agravo (M48, etapa 4; regra 8): o paciente, o agravo, a origem, o prazo e, conforme a situação, a
// notificação entregue ou o descarte. Do caso aberto: "Registrar a notificação" (autoridade, canal, número quando o
// canal dá, quem recebeu no telefone e no e-mail) e "Descartar o caso" (motivo e justificativa), sempre com a versão
// lida; a ficha para impressão abre em tela própria.
import {
  AUTORIDADES_SANITARIAS,
  CANAIS_NOTIFICACAO_AGRAVO,
  MOTIVOS_DESCARTE_AGRAVO,
  rotuloAutoridadeSanitaria,
  rotuloCanalNotificacaoAgravo,
  rotuloMotivoDescarteAgravo,
  rotuloOrigemCasoAgravo,
  rotuloPeriodicidadeAgravo,
  rotuloSituacaoCasoAgravo,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { descartarCaso, lerCaso, notificarCaso, novaChaveAgravo } from '../api-agravo.js';
import {
  acoesDoCaso,
  camposDoCanal,
  idadeEm,
  montarDescarte,
  montarNotificacaoAgravo,
} from '../regras-agravo.js';
import ErroAgravo from './ErroAgravo.vue';
import ErrosDoFormulario from './ErrosDoFormulario.vue';
import PrazoAgravo from './PrazoAgravo.vue';

const props = defineProps<{ id: number; podeNotificar: boolean; agora: string }>();
const emit = defineEmits<{ fechar: []; gravado: [mensagem: string] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const caso = useQuery({
  queryKey: computed(() => ['agravos', 'caso', props.id]),
  queryFn: () => lerCaso(props.id),
});
const acoes = computed(() =>
  caso.data.value
    ? acoesDoCaso(caso.data.value.situacao, props.podeNotificar)
    : { notificar: false, descartar: false },
);
const idade = computed(() =>
  caso.data.value ? idadeEm(caso.data.value.paciente.nascimento, caso.data.value.gatilhoEm) : null,
);

const modo = ref<'nenhum' | 'notificar' | 'descartar'>('nenhum');
const erro = ref<unknown>(null);
const erros = ref<Record<string, string>>({});
const gravando = ref(false);

// ── Notificar ──
const opAutoridade = [
  { valor: '', rotulo: t('agravos.notificar.escolha') },
  ...AUTORIDADES_SANITARIAS.map((a) => ({ valor: a.codigo as string, rotulo: a.rotulo })),
];
const opCanal = [
  { valor: '', rotulo: t('agravos.notificar.escolha') },
  ...CANAIS_NOTIFICACAO_AGRAVO.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo })),
];
const nf = reactive({
  autoridade: 'SMS',
  canal: 'fichaImpressa',
  numero: '',
  data: null as string | null,
  hora: null as string | null,
  recebidoPor: '',
  observacao: '',
});
const campos = computed(() => camposDoCanal(nf.canal));
let chaveNotificar = novaChaveAgravo('notificar');
function abrirNotificar(): void {
  Object.assign(nf, {
    autoridade: 'SMS',
    canal: 'fichaImpressa',
    numero: '',
    data: props.agora.slice(0, 10),
    hora: props.agora.slice(11, 16),
    recebidoPor: '',
    observacao: '',
  });
  erros.value = {};
  erro.value = null;
  modo.value = 'notificar';
}
async function notificar(): Promise<void> {
  const c = caso.data.value;
  if (!c) return;
  erro.value = null;
  const m = montarNotificacaoAgravo(nf, c.versao);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    const r = await notificarCaso(c.id, m.entrada, chaveNotificar);
    chaveNotificar = novaChaveAgravo('notificar');
    modo.value = 'nenhum';
    await cliente.invalidateQueries({ queryKey: ['agravos'] });
    emit('gravado', r.comAtraso ? t('agravos.caso.notificadoComAtraso') : t('agravos.caso.notificado'));
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

// ── Descartar ──
const opMotivo = [
  { valor: '', rotulo: t('agravos.descartar.escolha') },
  ...MOTIVOS_DESCARTE_AGRAVO.map((m) => ({ valor: m.codigo as string, rotulo: m.rotulo })),
];
const ds = reactive({ motivo: '', justificativa: '' });
let chaveDescartar = novaChaveAgravo('descartar');
function abrirDescartar(): void {
  Object.assign(ds, { motivo: '', justificativa: '' });
  erros.value = {};
  erro.value = null;
  modo.value = 'descartar';
}
async function descartar(): Promise<void> {
  const c = caso.data.value;
  if (!c) return;
  erro.value = null;
  const m = montarDescarte(ds, c.versao);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    await descartarCaso(c.id, m.entrada, chaveDescartar);
    chaveDescartar = novaChaveAgravo('descartar');
    modo.value = 'nenhum';
    await cliente.invalidateQueries({ queryKey: ['agravos'] });
    emit('gravado', t('agravos.caso.descartado'));
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="agravo-caso-titulo" data-testid="caso-agravo">
    <ErroAgravo v-if="caso.isError.value" :erro="caso.error.value" />
    <p v-else-if="!caso.data.value" role="status">{{ t('agravos.carregando') }}</p>
    <template v-else>
      <h2 id="agravo-caso-titulo">
        {{
          t('agravos.caso.titulo', {
            id: caso.data.value.id,
            cid: caso.data.value.cid,
            nome: caso.data.value.nomeCid,
          })
        }}
      </h2>
      <dl class="dados-agravo">
        <dt>{{ t('agravos.caso.paciente') }}</dt>
        <dd data-testid="caso-paciente">
          {{ caso.data.value.paciente.nome }}
          <span class="secundario">
            {{
              caso.data.value.paciente.prontuario !== null
                ? t('agravos.prontuario', { n: caso.data.value.paciente.prontuario })
                : t('agravos.semProntuario')
            }}
            <template v-if="idade !== null"> · {{ t('agravos.caso.idade', { anos: idade }) }}</template>
          </span>
        </dd>
        <dt>{{ t('agravos.casos.colSituacao') }}</dt>
        <dd data-testid="caso-situacao">{{ rotuloSituacaoCasoAgravo(caso.data.value.situacao) }}</dd>
        <dt>{{ t('agravos.caso.periodicidade') }}</dt>
        <dd>{{ rotuloPeriodicidadeAgravo(caso.data.value.periodicidade) }}</dd>
        <dt>{{ t('agravos.caso.origem') }}</dt>
        <dd>
          {{ rotuloOrigemCasoAgravo(caso.data.value.origem) }}
          <span v-if="caso.data.value.atendimento !== null" class="secundario">
            · {{ t('agravos.caso.atendimento', { n: caso.data.value.atendimento }) }}
          </span>
        </dd>
        <dt>{{ t('agravos.caso.gatilhoEm') }}</dt>
        <dd>{{ dataHora(caso.data.value.gatilhoEm) }}</dd>
        <dt>{{ t('agravos.caso.prazoEm') }}</dt>
        <dd data-testid="caso-prazo">
          {{ dataHora(caso.data.value.prazoEm) }}
          <PrazoAgravo
            :estado="caso.data.value.estadoPrazo"
            :prazo-em="caso.data.value.prazoEm"
            :horas="caso.data.value.horasRestantes"
          />
        </dd>
        <template v-if="caso.data.value.observacao">
          <dt>{{ t('agravos.observacao') }}</dt>
          <dd>{{ caso.data.value.observacao }}</dd>
        </template>
        <template v-if="caso.data.value.situacao === 'notificado'">
          <dt>{{ t('agravos.caso.notificacao') }}</dt>
          <dd data-testid="caso-notificacao">
            {{ dataHora(caso.data.value.notificadoEm) }} ·
            {{ caso.data.value.autoridade ? rotuloAutoridadeSanitaria(caso.data.value.autoridade) : '' }} ·
            {{ caso.data.value.canal ? rotuloCanalNotificacaoAgravo(caso.data.value.canal) : '' }}
            <span v-if="caso.data.value.numero">
              · {{ t('agravos.caso.numero', { numero: caso.data.value.numero }) }}</span
            >
            <span v-if="caso.data.value.recebidoPor">
              · {{ t('agravos.caso.recebidoPor', { quem: caso.data.value.recebidoPor }) }}</span
            >
          </dd>
        </template>
        <template v-if="caso.data.value.situacao === 'descartado'">
          <dt>{{ t('agravos.caso.descarte') }}</dt>
          <dd data-testid="caso-descarte">
            {{
              caso.data.value.motivoDescarte
                ? rotuloMotivoDescarteAgravo(caso.data.value.motivoDescarte)
                : ''
            }}:
            {{ caso.data.value.justificativaDescarte }}
          </dd>
        </template>
      </dl>
      <p class="secundario">
        {{
          t('agravos.caso.abertoPor', {
            quem: caso.data.value.abertoPor,
            quando: dataHora(caso.data.value.abertoEm),
          })
        }}
        <template v-if="caso.data.value.encerradoPor && caso.data.value.encerradoEm">
          ·
          {{
            t('agravos.caso.encerradoPor', {
              quem: caso.data.value.encerradoPor,
              quando: dataHora(caso.data.value.encerradoEm),
            })
          }}
        </template>
      </p>

      <div class="linha-ccih">
        <RouterLink
          :to="`/qualidade/vigilancia/agravos/casos/${caso.data.value.id}/ficha`"
          data-testid="caso-ficha"
          >{{ t('agravos.caso.ficha') }}</RouterLink
        >
        <SanteBotao
          v-if="acoes.notificar && modo !== 'notificar'"
          :rotulo="t('agravos.caso.notificar')"
          variante="primario"
          data-testid="caso-notificar"
          @acionar="abrirNotificar"
        />
        <SanteBotao
          v-if="acoes.descartar && modo !== 'descartar'"
          :rotulo="t('agravos.caso.descartar')"
          variante="secundario"
          data-testid="caso-descartar"
          @acionar="abrirDescartar"
        />
        <SanteBotao
          :rotulo="t('agravos.fechar')"
          variante="texto"
          data-testid="caso-fechar"
          @acionar="emit('fechar')"
        />
      </div>

      <ErroAgravo v-if="erro" :erro="erro" />

      <form
        v-if="modo === 'notificar'"
        class="painel-ccih"
        data-testid="form-notificar"
        @submit.prevent="notificar"
      >
        <h3>{{ t('agravos.notificar.titulo') }}</h3>
        <p class="secundario">{{ t('agravos.notificar.explicacao') }}</p>
        <div class="linha-ccih">
          <SanteSelecao
            v-model="nf.autoridade"
            :rotulo="t('agravos.notificar.autoridade')"
            :opcoes="opAutoridade"
            obrigatorio
            data-testid="notificar-autoridade"
          />
          <SanteSelecao
            v-model="nf.canal"
            :rotulo="t('agravos.notificar.canal')"
            :opcoes="opCanal"
            obrigatorio
            data-testid="notificar-canal"
          />
        </div>
        <div class="linha-ccih">
          <SanteData
            v-model="nf.data"
            :rotulo="t('agravos.notificar.quando')"
            editavel
            data-testid="notificar-data"
          />
          <SanteHora
            v-model="nf.hora"
            :rotulo="t('agravos.notificar.horaQuando')"
            editavel
            data-testid="notificar-hora"
          />
          <SanteCampoTexto
            v-if="campos.numero"
            v-model="nf.numero"
            :rotulo="t('agravos.notificar.numero')"
            :max-bytes="12"
            obrigatorio
            data-testid="notificar-numero"
          />
          <SanteCampoTexto
            v-if="campos.recebidoPor"
            v-model="nf.recebidoPor"
            :rotulo="t('agravos.notificar.recebidoPor')"
            :max-bytes="80"
            obrigatorio
            data-testid="notificar-recebido"
          />
        </div>
        <SanteCampoTexto
          v-model="nf.observacao"
          :rotulo="t('agravos.observacao')"
          :max-bytes="500"
          multilinha
          data-testid="notificar-observacao"
        />
        <ErrosDoFormulario :erros="erros" />
        <div class="linha-ccih">
          <SanteBotao
            tipo="submit"
            :rotulo="t('agravos.gravar')"
            :desabilitado="gravando"
            data-testid="notificar-gravar"
          />
          <SanteBotao :rotulo="t('agravos.cancelar')" variante="texto" @acionar="modo = 'nenhum'" />
        </div>
      </form>

      <form
        v-if="modo === 'descartar'"
        class="painel-ccih"
        data-testid="form-descartar"
        @submit.prevent="descartar"
      >
        <h3>{{ t('agravos.descartar.titulo') }}</h3>
        <p class="secundario">{{ t('agravos.descartar.explicacao') }}</p>
        <SanteSelecao
          v-model="ds.motivo"
          :rotulo="t('agravos.descartar.motivo')"
          :opcoes="opMotivo"
          obrigatorio
          data-testid="descartar-motivo"
        />
        <SanteCampoTexto
          v-model="ds.justificativa"
          :rotulo="t('agravos.descartar.justificativa')"
          :max-bytes="500"
          multilinha
          obrigatorio
          data-testid="descartar-justificativa"
        />
        <ErrosDoFormulario :erros="erros" />
        <div class="linha-ccih">
          <SanteBotao
            tipo="submit"
            :rotulo="t('agravos.gravar')"
            variante="primario"
            :desabilitado="gravando"
            data-testid="descartar-gravar"
          />
          <SanteBotao :rotulo="t('agravos.cancelar')" variante="texto" @acionar="modo = 'nenhum'" />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.dados-agravo {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1, 0.25rem) var(--sgh-espaco-3);
  margin: 0;
}
.dados-agravo dt {
  font-weight: 600;
}
.dados-agravo dd {
  margin: 0;
}
</style>
