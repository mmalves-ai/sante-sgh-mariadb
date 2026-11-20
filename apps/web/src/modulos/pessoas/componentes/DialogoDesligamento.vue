<script setup lang="ts">
// Desligar colaborador (M52.1; regra 2; `pessoas.colaborador.desligar`, crítica): o aviso de que o acesso é bloqueado
// hoje e o usuário não é apagado, a data (não futura), o tipo de rescisão, o motivo e a senha de novo (SBIS-07). O
// resultado mostra o que aconteceu com o acesso em cada estabelecimento e as sessões encerradas.
import { esquemaDesligarColaborador, type OpcaoPessoas, type ResultadoDesligamento } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import { desligar } from '../api-pessoas.js';
import { semVinculo } from '../comum.js';
import ErroPessoas from './ErroPessoas.vue';

const props = defineProps<{ vinculo: number; hoje: string; tiposRescisao: readonly OpcaoPessoas[] }>();
const emit = defineEmits<{ desligado: [ResultadoDesligamento] }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();

const data = ref<string | null>(props.hoje);
const tipo = ref<number | null>(null);
const motivo = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
const resultado = ref<ResultadoDesligamento | null>(null);
const opcoes = computed(() => props.tiposRescisao.map((x) => ({ valor: x.codigo, rotulo: x.rotulo })));
const entrada = computed(() =>
  esquemaDesligarColaborador.safeParse({
    vinculo: props.vinculo,
    data: data.value ?? '',
    tipoRescisao: tipo.value ?? -1,
    motivo: motivo.value.trim(),
  }),
);
const dataFutura = computed(() => !!data.value && data.value > props.hoje);

async function confirmar(): Promise<void> {
  if (!entrada.value.success || dataFutura.value || !senha.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const resto = semVinculo(entrada.value.data);
    resultado.value = await desligar(props.vinculo, resto, senha.value);
    emit('desligado', resultado.value);
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}

function textoUsuario(u: ResultadoDesligamento['usuarios'][number]): string {
  const p = { login: u.login, hospital: u.hospital };
  return u.acao === 'bloqueado'
    ? t('pessoas.desligamento.usuarioBloqueado', p)
    : u.acao === 'jaBloqueado'
      ? t('pessoas.desligamento.usuarioJaBloqueado', p)
      : t('pessoas.desligamento.usuarioMantido', p);
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('pessoas.desligamento.titulo')" largura="40rem">
    <div v-if="resultado" class="bloco" data-testid="resultado-desligamento">
      <h2>{{ t('pessoas.desligamento.resultado') }}</h2>
      <SanteAlerta :texto="t('pessoas.desligamento.sucesso')" variante="info" anunciar />
      <ul>
        <li v-for="u in resultado.usuarios" :key="`${u.hospital}-${u.login}`" :data-acao="u.acao">
          {{ textoUsuario(u) }}
        </li>
      </ul>
      <p v-if="resultado.sessoesEncerradas > 0">
        {{ t('pessoas.desligamento.sessoes', { quantas: resultado.sessoesEncerradas }) }}
      </p>
      <SanteAlerta
        v-if="(resultado.sessoesPendentes ?? []).length > 0"
        :texto="t('pessoas.desligamento.sessoesPendentes', { logins: resultado.sessoesPendentes.join(', ') })"
        variante="aviso"
        anunciar
        data-testid="desligamento-sessoes-pendentes"
      />
      <SanteBotao
        :rotulo="t('pessoas.voltar')"
        variante="secundario"
        data-testid="fechar-desligamento"
        @acionar="visivel = false"
      />
    </div>
    <form v-else class="bloco" data-testid="form-desligamento" @submit.prevent="confirmar">
      <SanteAlerta :texto="t('pessoas.desligamento.aviso')" variante="aviso" />
      <SanteData
        v-model="data"
        :rotulo="t('pessoas.desligamento.data')"
        editavel
        data-testid="desligamento-data"
      />
      <SanteAlerta v-if="dataFutura" :texto="t('pessoas.desligamento.dataFutura')" variante="alerta" />
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('pessoas.desligamento.tipo')"
        :opcoes="opcoes"
        obrigatorio
        data-testid="desligamento-tipo"
      />
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="t('pessoas.motivo')"
        :max-bytes="400"
        multilinha
        obrigatorio
        data-testid="desligamento-motivo"
      />
      <p class="secundario">{{ t('pessoas.motivoAjuda') }}</p>
      <p>{{ t('pessoas.desligamento.reautenticar') }}</p>
      <SenhaConfirmacao v-model="senha" testid="desligamento-senha" />
      <ErroPessoas v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao :rotulo="t('pessoas.cancelar')" variante="texto" @acionar="visivel = false" />
        <SanteBotao
          :rotulo="t('pessoas.desligamento.confirmar')"
          variante="primario"
          tipo="submit"
          :desabilitado="ocupado || !entrada.success || dataFutura || !senha"
          data-testid="desligamento-confirmar"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped src="../estilo-pessoas.css"></style>
