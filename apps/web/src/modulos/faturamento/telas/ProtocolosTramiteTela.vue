<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Protocolo de documentos entre setores (F3.7, 06-FAT linha 22): `/faturamento/protocolos`.
// Escolhido o meu setor, a tela mostra o que sai e o que chega. O protocolo novo nasce já enviado (um clique), com os
// itens conferidos pela regra do domínio enquanto se preenche; quem recebe confere item a item (recebido ou recusado
// com motivo) e a situação do lote sai sozinha (recebido, em parte ou recusado).
import { type ItemProtocoloEntrada, TIPOS_ITEM_PROTOCOLO, validarProtocolo } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarProtocolo,
  conferirProtocolo,
  emitirProtocolo,
  enviarProtocolo,
  lerProtocolos,
  type Protocolos,
} from '../api-auditoria-tramite.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const { t } = useI18n();
const setor = ref<number | null>(null);
const qc = useQueryClient();
const q = useQuery({
  queryKey: ['faturamento', 'protocolos', setor],
  queryFn: () => lerProtocolos(setor.value),
});
const erro = ref<unknown>(null);
const aviso = ref('');
const chave = () => crypto.randomUUID();
async function rodar(fn: () => Promise<unknown>) {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    aviso.value = t('auditoriaTramite.feito');
    await qc.invalidateQueries({ queryKey: ['faturamento', 'protocolos'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}
const nomeSetor = (id: number) => q.data.value?.setores.find((s) => s.id === id)?.descricao ?? String(id);

// ── Novo protocolo ──
const novo = reactive({
  remetenteId: 0,
  destinatarioId: 0,
  prioridade: 'normal' as 'normal' | 'urgente',
  enviarJa: true,
  itens: [] as ItemProtocoloEntrada[],
});
const erros = computed(() =>
  validarProtocolo({ remetente: novo.remetenteId, destinatario: novo.destinatarioId, itens: novo.itens }),
);
async function emitir() {
  const ok = await rodar(() =>
    emitirProtocolo({ ...novo, remetenteId: novo.remetenteId || setor.value }, chave()),
  );
  if (ok) novo.itens = [];
}

// ── Conferência ──
type Protocolo = Protocolos['protocolos'][number];
const emConferencia = ref<Protocolo | null>(null);
const marcas = ref<Record<number, { recebido: boolean | null; motivo: string }>>({});
function conferir(p: Protocolo) {
  emConferencia.value = p;
  marcas.value = Object.fromEntries(
    p.itens.filter((i) => !i.recebido && !i.recusado).map((i) => [i.id, { recebido: true, motivo: '' }]),
  );
}
async function confirmar() {
  const p = emConferencia.value;
  if (!p) return;
  const itens = Object.entries(marcas.value)
    .filter(([, m]) => m.recebido !== null)
    .map(([id, m]) => ({
      itemId: Number(id),
      recebido: m.recebido!,
      motivoRecusa: m.recebido ? null : m.motivo,
    }));
  if (await rodar(() => conferirProtocolo(p.id, itens, chave()))) emConferencia.value = null;
}
const motivoCancelamento = ref('');
</script>

<template>
  <section class="tela" data-testid="protocolos-tramite">
    <h1>{{ t('auditoriaTramite.protocolo.titulo') }}</h1>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status">{{ aviso }}</p>
    <template v-if="q.data.value">
      <SanteSelecao
        v-model="setor"
        :rotulo="t('auditoriaTramite.protocolo.setor')"
        :opcoes="[
          { valor: null, rotulo: t('auditoriaTramite.protocolo.todos') },
          ...q.data.value.setores.map((s) => ({ valor: s.id, rotulo: s.descricao })),
        ]"
        data-testid="prot-setor"
      />

      <form class="filtros" data-testid="prot-form" @submit.prevent="emitir">
        <h2>{{ t('auditoriaTramite.protocolo.novo') }}</h2>
        <SanteSelecao
          v-model="novo.remetenteId"
          :rotulo="t('auditoriaTramite.protocolo.de')"
          :opcoes="[...q.data.value.setores.map((s) => ({ valor: s.id, rotulo: s.descricao }))]"
          data-testid="prot-de"
        />
        <SanteSelecao
          v-model="novo.destinatarioId"
          :rotulo="t('auditoriaTramite.protocolo.para')"
          :opcoes="[...q.data.value.setores.map((s) => ({ valor: s.id, rotulo: s.descricao }))]"
          data-testid="prot-para"
        />
        <SanteSelecao
          v-model="novo.prioridade"
          :rotulo="t('auditoriaTramite.protocolo.prioridade')"
          :opcoes="[
            { valor: 'normal' as const, rotulo: t('auditoriaTramite.protocolo.prioridades.normal') },
            { valor: 'urgente' as const, rotulo: t('auditoriaTramite.protocolo.prioridades.urgente') },
          ]"
        />
        <label
          ><input v-model="novo.enviarJa" type="checkbox" />
          {{ t('auditoriaTramite.protocolo.enviarJa') }}</label
        >
        <fieldset v-for="(i, k) in novo.itens" :key="k" :data-testid="`prot-item-${k}`">
          <SanteSelecao
            v-model="i.tipo"
            :rotulo="t('auditoriaTramite.protocolo.tipoItem')"
            ocultar-rotulo
            :opcoes="[
              ...TIPOS_ITEM_PROTOCOLO.map((x) => ({
                valor: x,
                rotulo: t(`auditoriaTramite.protocolo.tipos.${x}`),
              })),
            ]"
          />
          <input
            v-if="i.tipo !== 'documento'"
            v-model.number="(i as { alvoId: number | null }).alvoId"
            inputmode="numeric"
            :placeholder="t('auditoriaTramite.protocolo.alvo')"
          />
          <input
            v-else
            v-model="(i as { descricao: string | null }).descricao"
            maxlength="200"
            :placeholder="t('auditoriaTramite.protocolo.descricao')"
          />
          <span v-if="erros[`itens.${k}`]" role="alert">{{ erros[`itens.${k}`] }}</span>
          <button type="button" @click="novo.itens.splice(k, 1)">{{ '×' }}</button>
        </fieldset>
        <button
          type="button"
          data-testid="prot-incluir"
          @click="novo.itens.push({ tipo: 'conta', alvoId: null, descricao: null })"
        >
          {{ t('auditoriaTramite.protocolo.incluirItem') }}
        </button>
        <span v-if="erros['destinatarioId']" role="alert">{{ erros['destinatarioId'] }}</span>
        <button type="submit" :disabled="Object.keys(erros).length > 0" data-testid="prot-emitir">
          {{ t('auditoriaTramite.protocolo.emitir') }}
        </button>
      </form>

      <p v-if="!q.data.value.protocolos.length" class="secundario">
        {{ t('auditoriaTramite.protocolo.vazio') }}
      </p>
      <article v-for="p in q.data.value.protocolos" :key="p.id" :data-testid="`prot-${p.numero}`">
        <h3>
          {{ t('auditoriaTramite.protocolo.numero', { numero: p.numero }) }} {{ '·' }}
          {{ nomeSetor(p.deSetorId) }} {{ '→' }} {{ nomeSetor(p.paraSetorId) }} ·
          {{ t(`auditoriaTramite.protocolo.situacoes.${p.situacao}`) }}
          <span v-if="p.prioridade === 'urgente'"
            >· {{ t('auditoriaTramite.protocolo.prioridades.urgente') }}</span
          >
        </h3>
        <ul>
          <li v-for="i in p.itens" :key="i.id">
            {{ i.rotulo }}
            <span v-if="i.recebido">· {{ t('auditoriaTramite.protocolo.receber') }}</span>
            <span v-if="i.recusado"
              >· {{ t('auditoriaTramite.protocolo.recusar') }}: {{ i.motivoRecusa }}</span
            >
          </li>
        </ul>
        <button
          v-if="p.situacao === 'aberto'"
          type="button"
          @click="rodar(() => enviarProtocolo(p.id, chave()))"
        >
          {{ t('auditoriaTramite.protocolo.enviar') }}
        </button>
        <button
          v-if="p.situacao === 'enviado' || p.situacao === 'recebido_parcial'"
          type="button"
          :data-testid="`prot-conferir-${p.numero}`"
          @click="conferir(p)"
        >
          {{ t('auditoriaTramite.protocolo.conferir') }}
        </button>
        <form
          v-if="p.situacao === 'aberto'"
          @submit.prevent="rodar(() => cancelarProtocolo(p.id, motivoCancelamento, chave()))"
        >
          <input
            v-model="motivoCancelamento"
            minlength="3"
            required
            :placeholder="t('auditoriaTramite.protocolo.motivoCancelamento')"
          />
          <button type="submit">{{ t('auditoriaTramite.cancelar') }}</button>
        </form>

        <form
          v-if="emConferencia?.id === p.id"
          class="filtros"
          data-testid="prot-form-conferencia"
          @submit.prevent="confirmar"
        >
          <fieldset v-for="i in p.itens.filter((x) => marcas[x.id])" :key="i.id">
            <legend>{{ i.rotulo }}</legend>
            <label
              ><input v-model="marcas[i.id]!.recebido" type="radio" :value="true" />{{
                t('auditoriaTramite.protocolo.receber')
              }}</label
            >
            <label
              ><input v-model="marcas[i.id]!.recebido" type="radio" :value="false" />{{
                t('auditoriaTramite.protocolo.recusar')
              }}</label
            >
            <label><input v-model="marcas[i.id]!.recebido" type="radio" :value="null" />—</label>
            <input
              v-if="marcas[i.id]!.recebido === false"
              v-model="marcas[i.id]!.motivo"
              required
              maxlength="500"
              :placeholder="t('auditoriaTramite.protocolo.motivoRecusa')"
            />
          </fieldset>
          <button type="submit" data-testid="prot-confirmar">
            {{ t('auditoriaTramite.protocolo.confirmarConferencia') }}
          </button>
        </form>
      </article>
    </template>
  </section>
</template>
