<script setup lang="ts">
// W0-07 (mercado M4): o desfecho da OS da manutenção num leito (parâmetro adt.osBloqueiaLeito). Na abertura, a
// proposta do bloqueio por manutenção com o botão que confirma (o bloqueio leva "OS <número>", a ligação com a OS);
// no encerramento, o bloqueio encerrado e a higienização solicitada, ou o aviso do que ficou para a tela do leito.
import type { OsNoLeito } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { abrirEstadoLeito, novaChave } from '../api-adt.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroAdt from './ErroAdt.vue';

const props = defineProps<{ leito: OsNoLeito | null | undefined }>();
const { t } = useI18n();
const ocupado = ref(false);
const feito = ref(false);
const erro = ref<unknown>(null);
const rotulo = (l: OsNoLeito) => `${l.leito.bloco} / ${l.leito.acomodacao} / ${l.leito.leito}`;
/** O servidor só propõe a quem pode bloquear; a tela confere de novo (o POST /leitos/estados recusaria com 403). */
const podeBloquear = (): boolean => pode('leitos.bloqueio.criar');
const textoAviso = (l: OsNoLeito): string =>
  l.aviso ? t(`crudNir.osLeito.avisos.${l.aviso}`, { leito: rotulo(l), observacao: l.observacao }) : '';

async function bloquear(): Promise<void> {
  const l = props.leito;
  if (!l) return;
  erro.value = null;
  ocupado.value = true;
  try {
    await abrirEstadoLeito(
      { leito: l.leito, estado: 'bloqueio', motivo: 'manutencao', observacao: l.observacao },
      novaChave('estado-bloqueio-os'),
    );
    feito.value = true;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <div v-if="leito" class="os-leito" data-testid="os-leito">
    <template v-if="leito.bloqueioEncerrado">
      <p role="status" data-testid="os-leito-encerrado">
        {{ t('crudNir.osLeito.encerrado', { leito: rotulo(leito) }) }}
        <template v-if="leito.higienizacao">
          {{ t('crudNir.osLeito.higienizacao', { numero: leito.higienizacao }) }}
        </template>
      </p>
    </template>
    <template v-else-if="leito.propostaBloqueio && !feito && podeBloquear()">
      <SanteAlerta
        variante="aviso"
        :texto="t('crudNir.osLeito.proposta', { leito: rotulo(leito) })"
        data-testid="os-leito-proposta"
      />
      <SanteBotao
        :rotulo="t('crudNir.osLeito.bloquear')"
        variante="primario"
        :desabilitado="ocupado"
        data-testid="os-leito-bloquear"
        @acionar="bloquear"
      />
    </template>
    <p v-else-if="feito" role="status" data-testid="os-leito-bloqueado">
      {{ t('crudNir.osLeito.bloqueado', { leito: rotulo(leito) }) }}
    </p>
    <SanteAlerta
      v-if="leito.aviso"
      variante="aviso"
      :texto="textoAviso(leito)"
      data-testid="os-leito-aviso"
    />
    <ErroAdt v-if="erro" :erro="erro" />
  </div>
</template>

<style scoped>
.os-leito {
  display: grid;
  gap: var(--sante-espaco-2, 0.5rem);
  justify-items: start;
}
</style>
