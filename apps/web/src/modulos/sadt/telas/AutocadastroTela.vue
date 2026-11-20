<script setup lang="ts">
// Aprovação do autocadastro de médico solicitante (ficha do M26, seção 7): `/sadt/solicitantes/autocadastro`. Os
// pedidos de acesso feitos no portal (e os pedidos anteriores, só nome, conselho, UF e número); aprovar liga o pedido ao
// médico do cadastro de solicitantes (o conselho validado); sem cadastro, cadastrar o médico primeiro; recusar pede o
// motivo. Senha, e-mail, telefone e documento do médico nunca aparecem aqui.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { cadastrarSolicitante, decidirAutocadastro, listarAutocadastros, novaChave } from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import { quando, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { gravacao, pode } = usarSadt();
const lista = useQuery({ queryKey: ['sadt', 'autocadastros'], queryFn: () => listarAutocadastros() });
const motivoPortal = computed(() =>
  gravacao.data.value && !gravacao.data.value.portal.ligada ? gravacao.data.value.portal.motivo : null,
);
const podeDecidir = computed(() => pode('portal', 'decidirAutocadastro'));
const escolhido = ref<Record<number, string>>({});
const motivo = ref<Record<number, string>>({});
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function decidir(id: number, decisao: 'aprovar' | 'recusar'): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await decidirAutocadastro(
      id,
      decisao === 'aprovar'
        ? { decisao, solicitante: Number(escolhido.value[id]) }
        : { decisao, motivo: motivo.value[id] ?? '' },
      novaChave('decidir'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'autocadastros'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function cadastrar(a: { id: number; nome: string; uf: string; numero: string }): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await cadastrarSolicitante(
      { nome: a.nome, conselho: 1, uf: a.uf, numero: Number(a.numero) },
      novaChave('solicitante'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'autocadastros'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="auto-titulo" data-testid="tela-sadt-autocadastro">
    <h1 id="auto-titulo">{{ t('sadt.autocadastro.titulo') }}</h1>
    <p>{{ t('sadt.autocadastro.texto') }}</p>
    <AvisoSadt :motivo="motivoPortal" />
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="lista.data.value.length === 0">{{ t('sadt.nenhum') }}</p>
    <div
      v-for="a in lista.data.value ?? []"
      :key="`${a.origem}-${a.id}`"
      class="painel"
      :data-testid="`autocadastro-${a.numero}`"
    >
      <h2>{{ a.nome }}</h2>
      <p>
        {{ a.conselho }} {{ a.numero }}/{{ a.uf }} · {{ t(`sadt.autocadastro.origem.${a.origem}`) }} ·
        <span :data-testid="`autocadastro-situacao-${a.numero}`">{{
          t(`sadt.autocadastro.situacoes.${a.situacao}`)
        }}</span>
        <template v-if="a.pedidoEm"> · {{ quando(a.pedidoEm) }}</template>
      </p>
      <div v-if="podeDecidir && a.origem === 'novo' && a.situacao === 'pendente'" class="filtros">
        <SanteSelecao
          v-if="a.candidatos.length"
          :model-value="escolhido[a.id] ?? ''"
          @update:model-value="(v: string) => (escolhido[a.id] = v)"
          :rotulo="t('sadt.autocadastro.candidatos')"
          :opcoes="[
            { valor: '', rotulo: t('sadt.escolha') },
            ...a.candidatos.map((c) => ({ valor: String(c.id), rotulo: c.nome })),
          ]"
          :data-testid="`autocadastro-candidato-${a.numero}`"
        />
        <SanteBotao
          v-if="a.candidatos.length"
          :rotulo="t('sadt.autocadastro.aprovar')"
          :desabilitado="ocupado || !escolhido[a.id]"
          :data-testid="`autocadastro-aprovar-${a.numero}`"
          @acionar="decidir(a.id, 'aprovar')"
        />
        <SanteBotao
          v-else
          variante="secundario"
          :rotulo="t('sadt.autocadastro.cadastrar')"
          :desabilitado="ocupado"
          :data-testid="`autocadastro-cadastrar-${a.numero}`"
          @acionar="cadastrar(a)"
        />
        <span class="campo">
          <label :for="`auto-motivo-${a.id}`">{{ t('sadt.motivo') }}</label>
          <input :id="`auto-motivo-${a.id}`" v-model="motivo[a.id]" />
        </span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.autocadastro.recusar')"
          :desabilitado="ocupado || (motivo[a.id] ?? '').trim().length < 5"
          @acionar="decidir(a.id, 'recusar')"
        />
      </div>
    </div>
    <p v-if="mensagem" role="status" data-testid="autocadastro-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
