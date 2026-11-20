<script setup lang="ts">
// A manifestação recebida pela ouvidoria: canal, tipo, identificada (o paciente pela busca do cadastro ou o nome e o
// contato de quem se manifestou) ou anônima (nada que identifique), a área, o relato e quando chegou. A resposta da
// pesquisa de satisfação do portal vem com o canal e o vínculo fixos (o servidor lê o paciente da conta do portal).
import { CANAIS_MANIFESTACAO, TIPOS_MANIFESTACAO } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarPacientes } from '../../../cadastro/api-cadastro.js';
import { novaChaveGestao, type PesquisaTela, registrarManifestacao } from '../api-gestao.js';
import { montarManifestacao } from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{
  agora: string;
  pesquisa?: PesquisaTela | null;
  /** W0-04 (M4): o canal da Hal-AI só aparece com o parâmetro ligado. */
  canalHalai?: boolean;
}>();
const emit = defineEmits<{ gravado: [r: { id: number; protocolo: string }]; cancelar: [] }>();
const { t } = useI18n();
const daPesquisa = computed(() => props.pesquisa ?? null);

const f = reactive({
  canal: daPesquisa.value ? 'pesquisa' : '',
  tipo: daPesquisa.value ? (daPesquisa.value.nota <= 6 ? 'reclamacao' : 'sugestao') : '',
  identificada: true,
  manifestante: '',
  contato: '',
  area: '',
  relato: daPesquisa.value?.comentario ?? '',
  data: props.agora.slice(0, 10) as string | null,
  hora: props.agora.slice(11, 16) as string | null,
});
const opCanal = [
  { valor: '', rotulo: '' },
  ...CANAIS_MANIFESTACAO.filter(
    (c) => (daPesquisa.value || c.codigo !== 'pesquisa') && (props.canalHalai || c.codigo !== 'halai'),
  ).map((c) => ({
    valor: c.codigo as string,
    rotulo: c.rotulo,
  })),
];
const opTipo = [
  { valor: '', rotulo: '' },
  ...TIPOS_MANIFESTACAO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];

const termo = ref('');
const pedido = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'ouvidoria-paciente', pedido.value]),
  queryFn: () => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2 && f.identificada && !daPesquisa.value),
});
const paciente = ref<{ id: number; nome: string } | null>(null);

const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('manifestacao');
async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarManifestacao({
    ...f,
    paciente: paciente.value?.id ?? null,
    pesquisa: daPesquisa.value?.id ?? null,
  });
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    const r = await registrarManifestacao(m.entrada, chave);
    chave = novaChaveGestao('manifestacao');
    emit('gravado', r);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="manifestacao-nova-titulo" data-testid="form-manifestacao">
    <h2 id="manifestacao-nova-titulo">
      {{ daPesquisa ? t('gestaoQualidade.ouvidoria.form.daPesquisa') : t('gestaoQualidade.ouvidoria.nova') }}
    </h2>
    <div class="linha-ccih">
      <SanteSelecao
        v-model="f.canal"
        :rotulo="t('gestaoQualidade.ouvidoria.form.canal')"
        :opcoes="opCanal"
        :desabilitado="!!daPesquisa"
        obrigatorio
        data-testid="man-canal"
      />
      <SanteSelecao
        v-model="f.tipo"
        :rotulo="t('gestaoQualidade.ouvidoria.tipo')"
        :opcoes="opTipo"
        obrigatorio
        data-testid="man-tipo"
      />
      <SanteCampoTexto
        v-model="f.area"
        :rotulo="t('gestaoQualidade.area')"
        :max-bytes="80"
        obrigatorio
        data-testid="man-area"
      />
    </div>
    <template v-if="!daPesquisa">
      <label class="marcar-gestao"
        ><input v-model="f.identificada" type="checkbox" data-testid="man-identificada" />
        {{ t('gestaoQualidade.ouvidoria.form.identificada') }}</label
      >
      <p v-if="!f.identificada" class="secundario" data-testid="man-anonima">
        {{ t('gestaoQualidade.ouvidoria.form.anonimaExplicacao') }}
      </p>
      <template v-else>
        <form v-if="!paciente" class="linha-ccih" role="search" @submit.prevent="pedido = termo.trim()">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('gestaoQualidade.ouvidoria.form.buscarPaciente')"
            :max-bytes="60"
            data-testid="man-termo"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('gestaoQualidade.ouvidoria.form.buscar')"
            data-testid="man-buscar"
          />
        </form>
        <ErroGestao v-if="!paciente && pacientes.isError.value" :erro="pacientes.error.value" />
        <template v-if="!paciente && pacientes.data.value">
          <p v-if="!pacientes.data.value.itens.length" role="status">
            {{ t('gestaoQualidade.ouvidoria.form.nenhumPaciente') }}
          </p>
          <ul v-else class="lista-ccih" data-testid="man-pacientes">
            <li v-for="p in pacientes.data.value.itens" :key="p.id">
              <SanteBotao
                variante="texto"
                :rotulo="t('gestaoQualidade.ouvidoria.form.escolher', { nome: p.nomeSocial ?? p.nome })"
                :data-testid="`man-paciente-${p.id}`"
                @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome }"
              />
            </li>
          </ul>
        </template>
        <div v-if="paciente" class="linha-ccih">
          <p data-testid="man-escolhido">
            {{ t('gestaoQualidade.ouvidoria.form.escolhido', { nome: paciente.nome }) }}
          </p>
          <SanteBotao
            :rotulo="t('gestaoQualidade.ouvidoria.form.trocar')"
            variante="texto"
            @acionar="paciente = null"
          />
        </div>
        <div class="linha-ccih">
          <SanteCampoTexto
            v-model="f.manifestante"
            :rotulo="t('gestaoQualidade.ouvidoria.form.manifestante')"
            :max-bytes="120"
            data-testid="man-manifestante"
          />
          <SanteCampoTexto
            v-model="f.contato"
            :rotulo="t('gestaoQualidade.ouvidoria.form.contato')"
            :max-bytes="120"
            data-testid="man-contato"
          />
        </div>
      </template>
    </template>
    <form class="painel-ccih" @submit.prevent="gravar">
      <SanteCampoTexto
        v-model="f.relato"
        :rotulo="t('gestaoQualidade.ouvidoria.form.relato')"
        :max-bytes="4000"
        multilinha
        obrigatorio
        data-testid="man-relato"
      />
      <div class="linha-ccih">
        <SanteData
          v-model="f.data"
          :rotulo="t('gestaoQualidade.ouvidoria.form.recebidaData')"
          editavel
          data-testid="man-data"
        />
        <SanteHora
          v-model="f.hora"
          :rotulo="t('gestaoQualidade.ouvidoria.form.recebidaHora')"
          editavel
          data-testid="man-hora"
        />
      </div>
      <ErrosFormulario :erros="erros" />
      <ErroGestao v-if="erro" :erro="erro" />
      <div class="linha-ccih">
        <SanteBotao
          tipo="submit"
          :rotulo="t('gestaoQualidade.gravar')"
          :desabilitado="gravando"
          data-testid="man-gravar"
        />
        <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="emit('cancelar')" />
      </div>
    </form>
  </section>
</template>
