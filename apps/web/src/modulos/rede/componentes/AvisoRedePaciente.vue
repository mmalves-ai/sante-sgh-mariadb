<script setup lang="ts">
// Aviso no cabeçalho do contexto do paciente (M57, etapa 2; ficha, seção 7: `Início > Contexto do paciente`): "este
// paciente tem atendimentos em outro estabelecimento da rede", com só as contagens e as datas mais recentes de cada
// estabelecimento ligado pelo MPI da Rede. Some quando o MPI está desligado, quando não há vínculo ou quando o outro
// estabelecimento não tem atendimento. "Abrir o registro" (acesso cruzado) só aparece com a regra de compartilhamento
// do prontuário (DP-42) ligada e a permissão; pede o motivo e a justificativa e mostra só a linha do tempo de lá.
import {
  MOTIVOS_ACESSO_PRONTUARIO,
  type MotivoAcessoProntuario,
  type AvisoRedePaciente,
  type ProntuarioRede,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { carimboBr, dataBr } from '../../cadastro/formato.js';
import { abrirProntuarioRede, lerAvisoRede } from '../api-rede.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const podeVer = computed(() => pode('rede.mpiAviso.ler'));

const consulta = useQuery({
  queryKey: computed(() => ['rede', 'aviso', props.paciente]),
  queryFn: () => lerAvisoRede(props.paciente),
  enabled: podeVer,
  retry: false,
});
const aviso = computed<AvisoRedePaciente | undefined>(() => consulta.data.value);
const visivel = computed(() => aviso.value?.situacao === 'com-atendimentos');

type Item = AvisoRedePaciente['estabelecimentos'][number];
function linha(e: Item): string {
  if (!e.disponivel) return t('rede.aviso.semResposta', { nome: e.estabelecimentoNome });
  return t('rede.aviso.linha', {
    nome: e.estabelecimentoNome,
    atendimentos: e.atendimentos,
    internacoes: e.internacoes,
    ultimoAtendimento: e.ultimoAtendimento
      ? t('rede.aviso.ultimoAtendimento', { data: dataBr(e.ultimoAtendimento) })
      : '',
    ultimaInternacao: e.ultimaInternacao
      ? t('rede.aviso.ultimaInternacao', { data: dataBr(e.ultimaInternacao) })
      : '',
  });
}

// ── Acesso cruzado (só com a regra da DP-42 ligada) ──────────────────────────────────────────────────
const abrindo = ref<Item | null>(null);
const motivo = ref<MotivoAcessoProntuario>('assistencia');
const justificativa = ref('');
const erro = ref<unknown>(null);
const registro = ref<ProntuarioRede | null>(null);
const opcoesMotivo = computed(() =>
  MOTIVOS_ACESSO_PRONTUARIO.map((m) => ({ valor: m, rotulo: t(`rede.aviso.motivos.${m}`) })),
);
const dialogoVisivel = computed({
  get: () => abrindo.value !== null,
  set: (v: boolean) => {
    if (!v) abrindo.value = null;
  },
});

function iniciar(e: Item): void {
  abrindo.value = e;
  motivo.value = 'assistencia';
  justificativa.value = '';
  erro.value = null;
  registro.value = null;
}

async function abrir(): Promise<void> {
  if (!abrindo.value) return;
  erro.value = null;
  try {
    registro.value = await abrirProntuarioRede(props.paciente, abrindo.value.estabelecimento, {
      motivo: motivo.value,
      justificativa: justificativa.value.trim(),
      pagina: 1,
    });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section
    v-if="visivel && aviso"
    class="aviso-rede"
    :aria-label="t('rede.aviso.regiao')"
    data-testid="aviso-rede-paciente"
  >
    <SanteAlerta :texto="t('rede.aviso.titulo')" variante="info" icone="info" />
    <ul>
      <li
        v-for="e in aviso.estabelecimentos"
        :key="`${e.estabelecimento}:${e.idRemoto}`"
        :data-testid="`aviso-rede-${e.estabelecimento}`"
      >
        <span>{{ linha(e) }}</span>
        <SanteBotao
          v-if="e.podeAbrir"
          variante="texto"
          :rotulo="t('rede.aviso.abrir', { nome: e.estabelecimentoNome })"
          :data-testid="`abrir-rede-${e.estabelecimento}`"
          @acionar="iniciar(e)"
        />
      </li>
    </ul>
    <p v-if="!aviso.acessoCruzado.pode" class="pequeno" data-testid="aviso-rede-so-aviso">
      {{ aviso.acessoCruzado.motivo ?? t('rede.aviso.soAviso') }}
    </p>

    <SanteDialogo
      v-model:visivel="dialogoVisivel"
      :titulo="t('rede.aviso.dialogo', { nome: abrindo?.estabelecimentoNome ?? '' })"
      largura="52rem"
    >
      <form v-if="!registro" class="form" data-testid="form-abrir-rede" @submit.prevent="abrir">
        <p>{{ t('rede.aviso.textoDialogo') }}</p>
        <SanteSelecao v-model="motivo" :rotulo="t('rede.aviso.motivo')" :opcoes="opcoesMotivo" />
        <label for="justificativa-rede-aviso">{{ t('rede.aviso.justificativa') }}</label>
        <textarea
          id="justificativa-rede-aviso"
          v-model="justificativa"
          rows="2"
          maxlength="200"
          required
          data-testid="justificativa-abrir-rede"
        />
        <MensagemErro v-if="erro" :erro="erro" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('rede.aviso.confirmar')"
          :desabilitado="justificativa.trim().length < 5"
          data-testid="botao-abrir-rede"
        />
      </form>
      <div v-else data-testid="registro-rede">
        <p>
          {{
            t('rede.aviso.prontuarioRemoto', {
              n: registro.prontuarioRemoto,
              nome: registro.estabelecimentoNome,
            })
          }}
        </p>
        <p v-if="registro.eventos.length === 0">
          {{ t('rede.aviso.vazio', { nome: registro.estabelecimentoNome }) }}
        </p>
        <ol v-else class="linha">
          <li v-for="ev in registro.eventos" :key="ev.chave">
            <strong>{{ carimboBr(ev.quando) }}</strong> · {{ ev.titulo }}
            <span v-if="ev.profissional"> · {{ ev.profissional }}</span>
            <span v-if="ev.sigilo"> ({{ t('rede.aviso.sigilo') }})</span>
            <span v-if="ev.suspenso"> ({{ t('rede.aviso.suspenso') }})</span>
            <p v-if="ev.detalhe" class="pequeno">{{ ev.detalhe }}</p>
          </li>
        </ol>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.aviso-rede {
  display: grid;
  gap: var(--sgh-espaco-1);
  margin: var(--sgh-espaco-1) 0;
}
ul,
ol {
  margin: 0;
  padding-left: var(--sgh-espaco-3);
}
li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.linha li {
  display: block;
}
.pequeno {
  margin: 0;
  font-size: var(--sgh-fonte-pequena);
}
.form {
  display: grid;
  gap: var(--sgh-espaco-1);
}
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
