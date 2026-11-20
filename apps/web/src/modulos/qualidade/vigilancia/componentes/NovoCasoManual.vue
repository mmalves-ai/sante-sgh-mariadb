<script setup lang="ts">
// O caso aberto pela vigilância sem sugestão da fila (busca ativa, comunicação de outro serviço, suspeita clínica): o
// paciente pela busca do cadastro, o agravo pela lista nacional do estabelecimento, a data e a hora da suspeita e a
// descrição dela (obrigatória).
import { rotuloPeriodicidadeAgravo } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarPacientes } from '../../../cadastro/api-cadastro.js';
import { abrirCaso, type CasoAberto, lerCids, novaChaveAgravo } from '../api-agravo.js';
import { montarCasoManual } from '../regras-agravo.js';
import ErroAgravo from './ErroAgravo.vue';
import ErrosDoFormulario from './ErrosDoFormulario.vue';

const props = defineProps<{ agora: string }>();
const emit = defineEmits<{ gravado: [r: CasoAberto]; cancelar: [] }>();
const { t } = useI18n();

const termo = ref('');
const pedido = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['agravos', 'manual-paciente', pedido.value]),
  queryFn: () => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string } | null>(null);

const buscaCid = ref('');
const cids = useQuery({
  queryKey: computed(() => ['agravos', 'cids', buscaCid.value.trim()]),
  queryFn: () => lerCids(buscaCid.value.trim()),
  staleTime: 300_000,
});
const opCids = computed(() => [
  { valor: '', rotulo: '' },
  ...(cids.data.value?.itens ?? []).map((c) => ({
    valor: c.cid,
    rotulo: `${c.cid} ${c.nome} (${rotuloPeriodicidadeAgravo(c.periodicidade)})`,
  })),
]);

const f = reactive({
  cid: '',
  data: props.agora.slice(0, 10) as string | null,
  hora: props.agora.slice(11, 16) as string | null,
  observacao: '',
});
const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveAgravo('manual');

async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarCasoManual({ ...f, paciente: paciente.value?.id ?? null });
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    const r = await abrirCaso(m.entrada, chave);
    chave = novaChaveAgravo('manual');
    emit('gravado', r);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="agravo-manual-titulo" data-testid="novo-caso-manual">
    <h2 id="agravo-manual-titulo">{{ t('agravos.manual.titulo') }}</h2>
    <p class="secundario">{{ t('agravos.manual.explicacao') }}</p>

    <form v-if="!paciente" class="linha-ccih" role="search" @submit.prevent="pedido = termo.trim()">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="t('agravos.manual.termo')"
        :max-bytes="60"
        data-testid="manual-termo"
      />
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('agravos.manual.buscar')"
        data-testid="manual-buscar"
      />
    </form>
    <ErroAgravo v-if="!paciente && pacientes.isError.value" :erro="pacientes.error.value" />
    <template v-if="!paciente && pacientes.data.value">
      <p v-if="!pacientes.data.value.itens.length" role="status">{{ t('agravos.manual.nenhum') }}</p>
      <ul v-else class="lista-ccih" data-testid="manual-pacientes">
        <li v-for="p in pacientes.data.value.itens" :key="p.id">
          <SanteBotao
            variante="texto"
            :rotulo="t('agravos.manual.escolher', { nome: p.nomeSocial ?? p.nome })"
            :data-testid="`manual-paciente-${p.id}`"
            @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome }"
          />
        </li>
      </ul>
    </template>
    <div v-if="paciente" class="linha-ccih">
      <p data-testid="manual-escolhido">{{ t('agravos.manual.escolhido', { nome: paciente.nome }) }}</p>
      <SanteBotao :rotulo="t('agravos.manual.trocar')" variante="texto" @acionar="paciente = null" />
    </div>

    <form v-if="paciente" class="painel-ccih" data-testid="form-manual" @submit.prevent="gravar">
      <div class="linha-ccih">
        <SanteCampoTexto
          v-model="buscaCid"
          :rotulo="t('agravos.manual.buscaCid')"
          :max-bytes="40"
          data-testid="manual-busca-cid"
        />
        <SanteSelecao
          v-model="f.cid"
          :rotulo="t('agravos.manual.cid')"
          :opcoes="opCids"
          busca
          obrigatorio
          data-testid="manual-cid"
        />
      </div>
      <div class="linha-ccih">
        <SanteData v-model="f.data" :rotulo="t('agravos.manual.quando')" editavel data-testid="manual-data" />
        <SanteHora
          v-model="f.hora"
          :rotulo="t('agravos.manual.horaQuando')"
          editavel
          data-testid="manual-hora"
        />
      </div>
      <SanteCampoTexto
        v-model="f.observacao"
        :rotulo="t('agravos.manual.suspeita')"
        :max-bytes="500"
        multilinha
        obrigatorio
        data-testid="manual-suspeita"
      />
      <ErrosDoFormulario :erros="erros" />
      <ErroAgravo v-if="erro" :erro="erro" />
      <div class="linha-ccih">
        <SanteBotao
          tipo="submit"
          :rotulo="t('agravos.gravar')"
          :desabilitado="gravando"
          data-testid="manual-gravar"
        />
        <SanteBotao :rotulo="t('agravos.cancelar')" variante="texto" @acionar="emit('cancelar')" />
      </div>
    </form>
    <SanteBotao v-else :rotulo="t('agravos.cancelar')" variante="texto" @acionar="emit('cancelar')" />
  </section>
</template>
