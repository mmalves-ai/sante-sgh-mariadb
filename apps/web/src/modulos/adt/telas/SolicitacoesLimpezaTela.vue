<script setup lang="ts">
// Solicitações de limpeza (ficha do M21, seção 7): `/higienizacao/solicitacoes`. A limpeza da alta nasce sozinha; aqui
// se pede a manual (enfermagem) ou pelo QR code do leito (`?leito=bloco|acom|leito&origem=qrcode`, a etiqueta do leito
// abre esta tela já com o leito). O leito com limpeza em aberto não recebe outra.
import { leitoDaChaveTexto, PRECAUCOES } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { lerMapa, novaChave, solicitarLimpeza } from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { leitoTexto } from '../regras-tela.js';
import { usarAdt } from '../usar-adt.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { apoio, pode, motivoDe } = usarAdt('higienizacao');
const podeSolicitar = pode('hotelaria.solicitarLimpeza');
const aviso = motivoDe('hotelaria.solicitarLimpeza');
const mapa = useQuery({ queryKey: ['adt', 'mapa'], queryFn: () => lerMapa() });
const q = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');
const leito = ref(q('leito'));
const origem = ref(q('origem') === 'qrcode' ? 'qrcode' : 'manual');
const tipo = ref('');
const precaucao = ref('');
const observacao = ref('');
const opcoes = computed(() => ({
  leitos: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(mapa.data.value?.leitos ?? [])
      .filter((l) => l.situacao !== 'inativo' && !l.limpeza)
      .map((l) => ({ valor: l.chave, rotulo: leitoTexto(l.leito) })),
  ],
  tipos: [
    { valor: '', rotulo: t('adt.escolha') },
    ...(apoio.data.value?.tiposLimpeza ?? []).map((x) => ({ valor: String(x.codigo), rotulo: x.nome })),
  ],
  origens: ['manual', 'qrcode'].map((o) => ({ valor: o, rotulo: t(`adt.hig.origem.${o}`) })),
  precaucoes: [
    { valor: '', rotulo: t('adt.escolha') },
    ...PRECAUCOES.map((p) => ({ valor: p.codigo as string, rotulo: p.rotulo })),
  ],
}));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  const l = leitoDaChaveTexto(leito.value);
  if (!l) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await solicitarLimpeza(
      {
        leito: l,
        tipoLimpeza: Number(tipo.value),
        origem: origem.value,
        ...(precaucao.value ? { precaucao: precaucao.value } : {}),
        ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
      },
      novaChave('solicitar-limpeza'),
    );
    mensagem.value = r.mensagem;
    leito.value = '';
    await cliente.invalidateQueries({ queryKey: ['adt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sol-titulo" data-testid="tela-solicitacoes-limpeza">
    <h1 id="sol-titulo">{{ t('adt.hig.solicitacoes') }}</h1>
    <p>{{ t('adt.hig.solicitacoesTexto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <div class="filtros">
      <SanteSelecao
        v-model="leito"
        :rotulo="t('adt.leito')"
        :opcoes="opcoes.leitos"
        data-testid="sol-leito"
      />
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('adt.hig.tipo')"
        :opcoes="opcoes.tipos"
        data-testid="sol-tipo"
      />
      <SanteSelecao v-model="origem" :rotulo="t('adt.hig.origemRotulo')" :opcoes="opcoes.origens" />
      <SanteSelecao v-model="precaucao" :rotulo="t('adt.hig.precaucao')" :opcoes="opcoes.precaucoes" />
    </div>
    <SanteCampoTexto v-model="observacao" :rotulo="t('adt.observacao')" :max-bytes="200" />
    <SanteBotao
      :rotulo="t('adt.hig.pedir')"
      :desabilitado="!podeSolicitar || !leito || !tipo || ocupado"
      data-testid="sol-gravar"
      @acionar="gravar"
    />
    <p v-if="mensagem" role="status" data-testid="sol-feita">{{ mensagem }}</p>
    <ErroAdt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
