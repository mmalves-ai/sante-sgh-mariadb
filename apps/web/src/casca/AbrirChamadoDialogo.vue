<script setup lang="ts">
// Diálogo "Abrir chamado" da casca (M37, ficha seção 7; regra 7; cap-14 §14.9.1): transversal, pelo menu do usuário,
// para todos (config.chamado.abrir). A primeira pergunta é em que sistema aconteceu; o registro já leva a tela, a
// versão e o horário (o identificador de trace vai pelo cabeçalho da requisição), sem copiar dado do paciente. O aviso
// fixo pede para não escrever nome, CPF nem dado clínico do paciente; o texto passa pelo validador CP1252.
import { AVISO_TEXTO_CHAMADO, SEVERIDADES_CHAMADO, SISTEMAS_CHAMADO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { VERSAO_WEB } from '../configuracao.js';
import { abrirChamado } from '../modulos/coexistencia/api.js';
import MensagemErro from './MensagemErro.vue';

const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const rota = useRoute();
const form = reactive({
  sistema: '' as '' | (typeof SISTEMAS_CHAMADO)[number],
  severidade: 'S3' as (typeof SEVERIDADES_CHAMADO)[number],
  descricao: '',
  dadoPessoal: false,
});
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const opSistema = SISTEMAS_CHAMADO.map((s) => ({ valor: s, rotulo: t(`casca.chamado.sistemas.${s}`) }));
const opSeveridade = SEVERIDADES_CHAMADO.map((s) => ({
  valor: s,
  rotulo: t(`casca.chamado.severidades.${s}`),
}));

async function enviar(): Promise<void> {
  erro.value = null;
  if (!form.sistema) {
    erro.value = new Error(t('casca.chamado.semSistema'));
    return;
  }
  try {
    const r = await abrirChamado({
      sistema: form.sistema,
      severidade: form.severidade,
      tela: rota.path.slice(0, 200),
      versao: VERSAO_WEB.identificacao.slice(0, 40),
      dadoPessoal: form.dadoPessoal,
      descricao: form.descricao,
    });
    feito.value = t('casca.chamado.aberto', { id: r.id, prazo: r.prazoResposta });
    form.descricao = '';
    form.sistema = '';
    form.dadoPessoal = false;
  } catch (e) {
    erro.value = e;
  }
}
function fechar(): void {
  feito.value = null;
  erro.value = null;
}
</script>

<template>
  <SanteDialogo
    v-model:visivel="visivel"
    :titulo="t('casca.chamado.titulo')"
    largura="36rem"
    @fechado="fechar"
  >
    <form class="chamado" data-testid="form-chamado" @submit.prevent="enviar">
      <SanteOpcoes
        v-model="form.sistema"
        :legenda="t('casca.chamado.ondeAconteceu')"
        :opcoes="opSistema"
        nome="chamado-sistema"
        data-testid="chamado-sistema"
      />
      <SanteSelecao
        id="chamado-severidade"
        v-model="form.severidade"
        :rotulo="t('casca.chamado.severidade')"
        :opcoes="opSeveridade"
        data-testid="chamado-severidade"
      />
      <SanteAlerta :texto="AVISO_TEXTO_CHAMADO" variante="aviso" data-testid="chamado-aviso" />
      <SanteCampoTexto
        v-model="form.descricao"
        :rotulo="t('casca.chamado.descricao')"
        :max-bytes="2000"
        multilinha
        obrigatorio
        data-testid="chamado-descricao"
      />
      <label
        ><input v-model="form.dadoPessoal" type="checkbox" data-testid="chamado-dado-pessoal" />
        {{ t('casca.chamado.dadoPessoal') }}</label
      >
      <p class="chamado__contexto">
        {{ t('casca.chamado.contexto', { tela: rota.path, versao: VERSAO_WEB.identificacao }) }}
      </p>
      <SanteAlerta v-if="feito" :texto="feito" variante="info" anunciar data-testid="chamado-aberto" />
      <MensagemErro v-if="erro" :erro="erro" />
      <SanteBotao
        :rotulo="t('casca.chamado.enviar')"
        variante="primario"
        tipo="submit"
        data-testid="chamado-enviar"
      />
    </form>
  </SanteDialogo>
</template>

<style scoped>
.chamado {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.chamado__contexto {
  color: var(--sgh-texto-suave);
  font-size: 0.875rem;
}
</style>
