<script setup lang="ts">
// O formulário "Notificar incidente" (M48, etapa 1; ficha, seção 7; manual m17): o mesmo no diálogo global da casca e
// na tela /qualidade/notificar (celular). Com o paciente aberto na tela (contexto clínico), mostra o que a tela já
// mostrava e manda só o ID do atendimento; sem ele (ou com "sem paciente"), a unidade e o local. O aviso não punitivo
// fica no topo; "sem me identificar" some no acesso de suporte (D-COMO-48.1). Depois de enviar, o número e o código de
// acompanhamento aparecem uma vez. A proposta de classificação da OMS não aparece para quem notifica.
import {
  GRAUS_DANO,
  type GrauDano,
  type SugestaoNotificacao,
  type TipoIncidente,
  TIPOS_INCIDENTE,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteHora,
  SanteOpcoes,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { contextoClinico } from '../../../casca/notificar/contexto-clinico.js';
import {
  lerFormularioNotificacao,
  type NotificacaoEnviada,
  notificarIncidente,
  novaChaveQualidade,
} from '../api.js';
import { montarNotificacao } from '../regras-qualidade.js';
import { formularioDaSugestao } from '../regras-seguranca.js';
import ErroQualidade from './ErroQualidade.vue';
import SugestoesNotificacao from './SugestoesNotificacao.vue';

const props = defineProps<{ caminhoOrigem?: string }>();
const emit = defineEmits<{ enviada: [r: NotificacaoEnviada] }>();
const { t } = useI18n();
const rota = useRoute();
const formulario = useQuery({
  queryKey: ['qualidade', 'formulario'],
  queryFn: lerFormularioNotificacao,
  staleTime: 60_000,
});

const vazio = () => ({
  semPaciente: false,
  unidade: null as number | null,
  local: '',
  data: null as string | null,
  hora: null as string | null,
  tipo: '' as TipoIncidente | '',
  tipoOutro: '',
  chegouAoPaciente: '' as 'sim' | 'nao' | '',
  danoPercebido: '' as GrauDano | '',
  descricao: '',
  anonima: false,
});
const form = reactive(vazio());
// A data e a hora começam no relógio do estabelecimento (o notificador corrige se foi antes).
watch(
  () => formulario.data.value?.agora,
  (agora) => {
    if (agora && form.data === null && form.hora === null) {
      form.data = agora.slice(0, 10);
      form.hora = agora.slice(11, 16);
    }
  },
  { immediate: true },
);
// A sugestão escolhida (etapa 2, regra 4): preenche o formulário e vira o contexto (o atendimento do registro de origem,
// não o da tela); a origem vai em `origem.sugestao` e o servidor dá a sugestão por resolvida.
const cliente = useQueryClient();
const sugestao = ref<SugestaoNotificacao | null>(null);
const contexto = computed(() => {
  const s = sugestao.value;
  if (!s) return contextoClinico.value;
  return s.atendimento === null
    ? null
    : { atendimento: s.atendimento, rotulo: t('qualidade.sugestoes.atendimento', { n: s.atendimento }) };
});
function usarSugestao(s: SugestaoNotificacao): void {
  Object.assign(form, vazio(), formularioDaSugestao(s));
  if (!s.chegouAoPaciente) form.danoPercebido = '';
  sugestao.value = s;
}
function largarSugestao(): void {
  sugestao.value = null;
}
const comPaciente = computed(() => contexto.value !== null && !form.semPaciente);
const anonimaPermitida = computed(() => formulario.data.value?.anonimaPermitida ?? false);
watch(anonimaPermitida, (p) => {
  if (!p) form.anonima = false;
});

const opTipo = TIPOS_INCIDENTE.map((x) => ({ valor: x.codigo as TipoIncidente | '', rotulo: x.rotulo }));
const opUnidade = computed(() => [
  { valor: null as number | null, rotulo: t('qualidade.notificar.escolhaUnidade') },
  ...(formulario.data.value?.unidades ?? []).map((u) => ({
    valor: u.codigo as number | null,
    rotulo: u.nome,
  })),
]);
const opChegou = [
  { valor: 'sim' as const, rotulo: t('qualidade.notificar.sim') },
  { valor: 'nao' as const, rotulo: t('qualidade.notificar.nao') },
];
const opDano = GRAUS_DANO.map((g) => ({ valor: g.codigo as GrauDano | '', rotulo: g.rotulo }));

const falta = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviando = ref(false);
const enviada = ref<NotificacaoEnviada | null>(null);
// Uma chave por intenção: o reenvio do mesmo formulário (rede caiu) devolve o mesmo número e código.
let chave = novaChaveQualidade('notificar');
watch(form, () => {
  if (!enviando.value) chave = novaChaveQualidade('notificar');
});

async function enviar(): Promise<void> {
  falta.value = null;
  erro.value = null;
  const m = montarNotificacao(form, contexto.value, props.caminhoOrigem ?? rota.path, sugestao.value?.origem);
  if (!m.ok) {
    falta.value = m.mensagem;
    return;
  }
  enviando.value = true;
  try {
    const r = await notificarIncidente(m.entrada, chave);
    enviada.value = r;
    if (sugestao.value) void cliente.invalidateQueries({ queryKey: ['qualidade', 'sugestoes'] });
    sugestao.value = null;
    emit('enviada', r);
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}

function outra(): void {
  enviada.value = null;
  sugestao.value = null;
  Object.assign(form, vazio());
  const agora = formulario.data.value?.agora;
  if (agora) {
    form.data = agora.slice(0, 10);
    form.hora = agora.slice(11, 16);
  }
  chave = novaChaveQualidade('notificar');
}
</script>

<template>
  <div class="notificar" data-testid="formulario-notificacao">
    <ErroQualidade v-if="formulario.isError.value" :erro="formulario.error.value" />
    <p v-else-if="!formulario.data.value" role="status">{{ t('qualidade.carregando') }}</p>
    <SanteAlerta
      v-else-if="!formulario.data.value.ligada"
      variante="info"
      :texto="t('qualidade.desligado')"
      data-testid="notificar-desligado"
    />
    <div v-else-if="enviada" class="notificar__feito" data-testid="notificacao-enviada">
      <SanteAlerta
        variante="info"
        anunciar
        :texto="t('qualidade.notificar.enviada', { protocolo: enviada.protocolo })"
      />
      <p class="notificar__codigo">
        {{ t('qualidade.notificar.codigoRotulo') }}
        <strong data-testid="notificacao-codigo">{{ enviada.codigoAcompanhamento }}</strong>
      </p>
      <p>{{ t('qualidade.notificar.codigoAviso') }}</p>
      <p>
        <strong data-testid="notificacao-protocolo">{{ enviada.protocolo }}</strong>
      </p>
      <p>{{ t('qualidade.notificar.acompanhar') }}</p>
      <div class="notificar__acoes">
        <SanteBotao
          :rotulo="t('qualidade.notificar.novaNotificacao')"
          variante="secundario"
          data-testid="notificar-outra"
          @acionar="outra"
        />
        <RouterLink to="/qualidade/notificar?aba=acompanhar" data-testid="ir-acompanhar">{{
          t('qualidade.notificar.irAcompanhar')
        }}</RouterLink>
      </div>
    </div>
    <form v-else class="notificar__form" data-testid="form-notificacao" novalidate @submit.prevent="enviar">
      <p class="notificar__explicacao" data-testid="notificar-explicacao">
        {{ t('qualidade.notificar.explicacao') }}
      </p>
      <SugestoesNotificacao v-if="!sugestao" @usar="usarSugestao" />
      <div v-else class="notificar__paciente" data-testid="notificar-sugestao">
        <p>{{ t('qualidade.sugestoes.usando', { titulo: sugestao.titulo }) }}</p>
        <SanteBotao
          :rotulo="t('qualidade.sugestoes.largar')"
          variante="texto"
          data-testid="notificar-largar-sugestao"
          @acionar="largarSugestao"
        />
      </div>

      <div v-if="contexto" class="notificar__paciente" data-testid="notificar-paciente">
        <p v-if="!form.semPaciente">
          {{ t('qualidade.notificar.pacienteDaTela', { rotulo: contexto.rotulo }) }}
        </p>
        <label
          ><input v-model="form.semPaciente" type="checkbox" data-testid="notificar-sem-paciente" />
          {{ t('qualidade.notificar.semPaciente') }}</label
        >
      </div>
      <p v-else class="notificar__nota">{{ t('qualidade.notificar.semContexto') }}</p>

      <template v-if="!comPaciente">
        <SanteSelecao
          v-model="form.unidade"
          :rotulo="t('qualidade.notificar.unidade')"
          :opcoes="opUnidade"
          obrigatorio
          data-testid="notificar-unidade"
        />
      </template>
      <SanteCampoTexto
        v-model="form.local"
        :rotulo="t('qualidade.notificar.local')"
        :max-bytes="80"
        data-testid="notificar-local"
      />
      <div class="notificar__linha">
        <SanteData v-model="form.data" :rotulo="t('qualidade.notificar.data')" editavel />
        <SanteHora v-model="form.hora" :rotulo="t('qualidade.notificar.hora')" editavel />
      </div>
      <SanteSelecao
        v-model="form.tipo"
        :rotulo="t('qualidade.notificar.tipo')"
        :opcoes="[{ valor: '', rotulo: t('qualidade.notificar.escolhaTipo') }, ...opTipo]"
        busca
        obrigatorio
        data-testid="notificar-tipo"
      />
      <SanteCampoTexto
        v-if="form.tipo === 'outro'"
        v-model="form.tipoOutro"
        :rotulo="t('qualidade.notificar.tipoOutro')"
        :max-bytes="60"
        obrigatorio
        data-testid="notificar-tipo-outro"
      />
      <SanteOpcoes
        v-model="form.chegouAoPaciente"
        :legenda="t('qualidade.notificar.chegouAoPaciente')"
        :opcoes="opChegou"
        nome="notificar-chegou"
        data-testid="notificar-chegou"
      />
      <template v-if="form.chegouAoPaciente === 'sim'">
        <SanteOpcoes
          v-model="form.danoPercebido"
          :legenda="t('qualidade.notificar.danoPercebido')"
          :opcoes="opDano"
          nome="notificar-dano"
          data-testid="notificar-dano"
        />
        <p class="notificar__nota">{{ t('qualidade.notificar.danoRevisado') }}</p>
      </template>
      <SanteCampoTexto
        v-model="form.descricao"
        :rotulo="t('qualidade.notificar.descricao')"
        :max-bytes="4000"
        multilinha
        obrigatorio
        data-testid="notificar-descricao"
      />
      <p class="notificar__nota">{{ t('qualidade.notificar.descricaoAjuda') }}</p>
      <label v-if="anonimaPermitida"
        ><input v-model="form.anonima" type="checkbox" data-testid="notificar-anonima" />
        {{ t('qualidade.notificar.anonima') }}</label
      >
      <p v-else class="notificar__nota" data-testid="notificar-anonima-suporte">
        {{ t('qualidade.notificar.anonimaNoSuporte') }}
      </p>
      <SanteAlerta
        v-if="form.anonima && sugestao"
        variante="aviso"
        :texto="t('qualidade.sugestoes.anonimaAviso')"
        data-testid="notificar-anonima-sugestao"
      />
      <SanteAlerta v-if="falta" variante="aviso" :texto="falta" anunciar data-testid="notificar-falta" />
      <ErroQualidade v-if="erro" :erro="erro" />
      <SanteBotao
        :rotulo="t('qualidade.notificar.enviar')"
        variante="primario"
        tipo="submit"
        :desabilitado="enviando"
        data-testid="notificar-enviar"
      />
    </form>
  </div>
</template>

<style scoped>
.notificar,
.notificar__form,
.notificar__feito {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.notificar__linha,
.notificar__acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-end;
}
.notificar__explicacao {
  margin: 0;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  border-inline-start: 4px solid var(--sgh-borda);
}
.notificar__nota {
  margin: 0;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.notificar__codigo strong {
  font-family: var(--sgh-fonte-codigo);
  font-size: 1.25rem;
  letter-spacing: 0.1em;
}
.notificar__paciente {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
</style>
