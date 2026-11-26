<script setup lang="ts">
// Foto do paciente para a identificação positiva (F3.1, 02-CAD linha 5; fase 1: só a foto facial): a foto atual com a
// base legal e a guarda, a captura pela câmera ou por arquivo (reaproveita a captura da portaria), a revogação com
// motivo, a conferência da identidade na recepção (confirmada, não confere ou dispensada com motivo) e as últimas
// conferências. O servidor confere de novo o tipo, o tamanho e as regras.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import CapturaFoto from '../../portaria/componentes/CapturaFoto.vue';
import {
  CONTEXTOS_CONFERENCIA,
  captarFoto,
  conferirIdentidade,
  type IdentificacaoPaciente,
  lerIdentificacao,
  RESULTADOS_CONFERENCIA,
  revogarFoto,
  urlFotoIdentificacao,
} from '../api-foto-identificacao.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const visao = ref<IdentificacaoPaciente | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const foto = ref<{ tipo: 'image/jpeg'; base64: string } | null>(null);
const motivoRevogacao = ref('');
const conferencia = reactive({ resultado: 'confirmada', contexto: 'recepcao', motivo: '' });
const podeEditar = computed(() => pode('cadastro.paciente.editar'));
const paciente = computed(() => Number(props.id));
const opcoesResultado = computed(() =>
  RESULTADOS_CONFERENCIA.map((x) => ({ valor: x, rotulo: t(`fotoIdentificacao.resultados.${x}`) })),
);
const opcoesContexto = computed(() =>
  CONTEXTOS_CONFERENCIA.map((x) => ({ valor: x, rotulo: t(`fotoIdentificacao.contextos.${x}`) })),
);
const dispensa = computed(() => conferencia.resultado === 'dispensada');
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR');
const data = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

async function carregar(): Promise<void> {
  erro.value = null;
  try {
    visao.value = await lerIdentificacao(paciente.value);
  } catch (e) {
    erro.value = e;
  }
}
watch(() => props.id, carregar, { immediate: true });

async function acao(fn: () => Promise<void>, texto: string): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    await fn();
    aviso.value = texto;
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}

const gravarFoto = () =>
  acao(async () => {
    if (!foto.value) return;
    await captarFoto(paciente.value, foto.value.base64);
    foto.value = null;
  }, t('fotoIdentificacao.captura.gravada'));

const revogar = () =>
  acao(async () => {
    await revogarFoto(paciente.value, motivoRevogacao.value.trim());
    motivoRevogacao.value = '';
  }, t('fotoIdentificacao.revogar.revogada'));

const conferir = () =>
  acao(async () => {
    await conferirIdentidade(paciente.value, {
      resultado: conferencia.resultado,
      contexto: conferencia.contexto,
      motivoDispensa: dispensa.value ? conferencia.motivo.trim() : null,
    });
    conferencia.motivo = '';
  }, t('fotoIdentificacao.conferir.gravada'));
</script>

<template>
  <main class="tela" data-testid="tela-foto-identificacao">
    <header>
      <h1>{{ t('fotoIdentificacao.titulo') }}</h1>
      <RouterLink :to="`/cadastros/pacientes/${props.id}`">{{ t('fotoIdentificacao.voltar') }}</RouterLink>
    </header>
    <p class="secundario" data-testid="fi-base-legal">{{ t('fotoIdentificacao.baseLegal') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="fi-aviso">{{ aviso }}</p>

    <template v-if="visao">
      <section aria-labelledby="fi-atual">
        <h2 id="fi-atual">{{ t('fotoIdentificacao.fotoAtiva') }}</h2>
        <template v-if="visao.ativa">
          <img
            class="foto"
            :src="urlFotoIdentificacao(paciente, visao.ativa.id)"
            :alt="t('fotoIdentificacao.previa')"
            data-testid="fi-foto"
          />
          <p>
            {{
              t('fotoIdentificacao.capturadaEm', {
                data: dataHora(visao.ativa.capturadaEm),
                guarda: data(visao.ativa.guardaAte),
              })
            }}
          </p>
        </template>
        <p v-else data-testid="fi-sem-foto">{{ t('fotoIdentificacao.semFoto') }}</p>
      </section>

      <section v-if="podeEditar" aria-labelledby="fi-captura">
        <h2 id="fi-captura">{{ t('fotoIdentificacao.captura.titulo') }}</h2>
        <CapturaFoto
          v-model="foto"
          :titulo="t('fotoIdentificacao.captura.titulo')"
          :ajuda="t('fotoIdentificacao.captura.ajuda')"
          :previa="t('fotoIdentificacao.previa')"
        />
        <SanteBotao
          :rotulo="t('fotoIdentificacao.captura.gravar')"
          :desabilitado="!foto"
          data-testid="fi-gravar-foto"
          @acionar="gravarFoto"
        />
      </section>

      <form
        class="ficha"
        aria-labelledby="fi-conferir"
        data-testid="fi-form-conferir"
        @submit.prevent="conferir"
      >
        <h2 id="fi-conferir">{{ t('fotoIdentificacao.conferir.titulo') }}</h2>
        <p class="secundario">{{ t('fotoIdentificacao.conferir.ajuda') }}</p>
        <SanteSelecao
          v-model="conferencia.resultado"
          :rotulo="t('fotoIdentificacao.conferir.resultado')"
          :opcoes="opcoesResultado"
          data-testid="fi-resultado"
        />
        <SanteSelecao
          v-model="conferencia.contexto"
          :rotulo="t('fotoIdentificacao.conferir.contexto')"
          :opcoes="opcoesContexto"
          data-testid="fi-contexto"
        />
        <label v-if="dispensa"
          >{{ t('fotoIdentificacao.conferir.motivo') }}
          <textarea v-model="conferencia.motivo" maxlength="200" rows="2" data-testid="fi-motivo-dispensa" />
        </label>
        <button type="submit" data-testid="fi-registrar">{{ t('fotoIdentificacao.conferir.gravar') }}</button>
      </form>

      <form
        v-if="podeEditar && visao.ativa"
        class="ficha"
        aria-labelledby="fi-revogar"
        data-testid="fi-form-revogar"
        @submit.prevent="revogar"
      >
        <h2 id="fi-revogar">{{ t('fotoIdentificacao.revogar.titulo') }}</h2>
        <label
          >{{ t('fotoIdentificacao.revogar.motivo') }}
          <textarea v-model="motivoRevogacao" maxlength="200" rows="2" data-testid="fi-motivo-revogacao" />
        </label>
        <button type="submit" :disabled="motivoRevogacao.trim().length < 5" data-testid="fi-revogar">
          {{ t('fotoIdentificacao.revogar.confirmar') }}
        </button>
      </form>

      <section aria-labelledby="fi-conferencias">
        <h2 id="fi-conferencias">{{ t('fotoIdentificacao.conferencias') }}</h2>
        <p v-if="!visao.conferencias.length">{{ t('fotoIdentificacao.semConferencias') }}</p>
        <table v-else data-testid="fi-conferencias">
          <thead>
            <tr>
              <th scope="col">{{ t('fotoIdentificacao.colunas.quando') }}</th>
              <th scope="col">{{ t('fotoIdentificacao.colunas.onde') }}</th>
              <th scope="col">{{ t('fotoIdentificacao.colunas.resultado') }}</th>
              <th scope="col">{{ t('fotoIdentificacao.colunas.quem') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in visao.conferencias" :key="c.id">
              <td>{{ dataHora(c.ocorridaEm) }}</td>
              <td>{{ t(`fotoIdentificacao.contextos.${c.contexto}`) }}</td>
              <td>
                {{ t(`fotoIdentificacao.resultados.${c.resultado}`) }}
                <template v-if="c.motivoDispensa">({{ c.motivoDispensa }})</template>
              </td>
              <td>{{ c.usuario ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="visao.historico.length" aria-labelledby="fi-historico">
        <h2 id="fi-historico">{{ t('fotoIdentificacao.historico') }}</h2>
        <table data-testid="fi-historico">
          <thead>
            <tr>
              <th scope="col">{{ t('fotoIdentificacao.colunas.quando') }}</th>
              <th scope="col">{{ t('fotoIdentificacao.colunas.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in visao.historico" :key="h.id">
              <td>{{ dataHora(h.capturadaEm) }}</td>
              <td>{{ t(`fotoIdentificacao.situacoes.${h.situacao}`) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </main>
</template>

<style scoped>
.foto {
  max-width: 240px;
  border-radius: 4px;
}
.ficha {
  display: grid;
  gap: 0.5rem;
  max-width: 40rem;
}
</style>
