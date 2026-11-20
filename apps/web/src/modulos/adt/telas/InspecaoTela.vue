<script setup lang="ts">
// Inspeção e liberação do leito (ficha do M21, seção 7): `/higienizacao/inspecao`, do supervisor da higienização ou da
// enfermagem. As limpezas concluídas com o checklist e a foto: aprovar (inspecionado) ou reprovar (volta para a
// execução) e liberar o leito, que volta a admitir no mapa. O leito em precaução exige a terminal com o protocolo da
// CCIH (o servidor confere na conclusão).
import { SanteBotao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import type { SolicitacaoLimpeza } from '@sgh/contratos';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerFoto, novaChave, registrarEtapa } from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import CartaoLimpeza from '../componentes/CartaoLimpeza.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { usarAdt } from '../usar-adt.js';
import { usarFilaHigienizacao } from '../usar-fila.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivoDe } = usarAdt('higienizacao');
const podeInspecionar = pode('inspecao');
const aviso = motivoDe('inspecao');
const { fila, agoraEstabelecimento } = usarFilaHigienizacao(ref(null));
const itens = computed(() =>
  (fila.data.value?.itens ?? []).filter((i) => i.etapa === 'concluido' || i.etapa === 'inspecionado'),
);
const imagens = ref<Record<number, string>>({});
async function verFoto(i: SolicitacaoLimpeza): Promise<void> {
  if (!i.foto) return;
  try {
    const f = await lerFoto(i.foto);
    const bin = atob(f.conteudo);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    imagens.value[i.solicitacao] = URL.createObjectURL(new Blob([bytes], { type: f.tipo }));
  } catch (x) {
    erro.value = x;
  }
}
onBeforeUnmount(() => Object.values(imagens.value).forEach((u) => URL.revokeObjectURL(u)));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function etapa(i: SolicitacaoLimpeza, e: string): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await registrarEtapa(i.solicitacao, { etapa: e }, novaChave(`inspecao-${e}`))).mensagem;
    await cliente.invalidateQueries({ queryKey: ['adt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="insp-titulo" data-testid="tela-inspecao">
    <h1 id="insp-titulo">{{ t('adt.hig.inspecao') }}</h1>
    <p>{{ t('adt.hig.inspecaoTexto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <p v-if="mensagem" role="status" data-testid="insp-mensagem">{{ mensagem }}</p>
    <ErroAdt v-if="erro" :erro="erro" />
    <ErroAdt v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <p v-if="itens.length === 0">{{ t('adt.hig.nenhumaInspecao') }}</p>
      <CartaoLimpeza
        v-for="i in itens"
        :key="i.solicitacao"
        :item="i"
        :agora="agoraEstabelecimento"
        historico
      >
        <p v-if="i.checklist.length" class="secundario">
          {{ t('adt.hig.checklist') }}: {{ i.checklist.map((c) => t(`adt.hig.itens.${c}`)).join(', ') }}
        </p>
        <SanteBotao
          v-if="i.foto && !imagens[i.solicitacao]"
          variante="texto"
          :rotulo="t('adt.hig.verFoto')"
          @acionar="verFoto(i)"
        />
        <img
          v-if="imagens[i.solicitacao]"
          :src="imagens[i.solicitacao]"
          :alt="t('adt.hig.foto')"
          class="foto"
        />
        <p class="acoes">
          <template v-if="i.etapa === 'concluido'">
            <SanteBotao
              :rotulo="t('adt.hig.acoesEtapa.inspecionado')"
              :desabilitado="!podeInspecionar || ocupado"
              :data-testid="`aprovar-${i.solicitacao}`"
              @acionar="etapa(i, 'inspecionado')"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('adt.hig.acoesEtapa.reprovado')"
              :desabilitado="!podeInspecionar || ocupado"
              @acionar="etapa(i, 'reprovado')"
            />
          </template>
          <SanteBotao
            v-else
            :rotulo="t('adt.hig.acoesEtapa.liberado')"
            :desabilitado="!podeInspecionar || ocupado"
            :data-testid="`liberar-${i.solicitacao}`"
            @acionar="etapa(i, 'liberado')"
          />
        </p>
      </CartaoLimpeza>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.foto {
  max-width: 100%;
  max-height: 16rem;
}
</style>
