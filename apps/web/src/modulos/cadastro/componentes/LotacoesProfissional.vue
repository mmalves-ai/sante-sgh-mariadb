<script setup lang="ts">
// Lotação do profissional por estabelecimento e unidade (F3.1, 02-CAD linha 18): ocupação (CBO), carga semanal por
// tipo com o total na hora, vínculo de trabalho do cadastro nacional e vigência. Encerrar grava o fim; nada se apaga.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { encerrarLotacao, incluirLotacao, lerLotacoes, lerOpcoesLigacoes } from '../api-ligacoes.js';

const props = defineProps<{ profissional: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const editar = computed(() => pode('cadastro.profissional.editar'));
const chaveQ = computed(() => ['cadastro', 'lotacoes', props.profissional]);
const consulta = useQuery({ queryKey: chaveQ, queryFn: () => lerLotacoes(props.profissional) });
const termo = ref('');
const opcoes = useQuery({
  queryKey: computed(() => ['cadastro', 'ligacoes-opcoes', termo.value]),
  queryFn: () => lerOpcoesLigacoes(termo.value.trim().length >= 3 ? termo.value : ''),
});
const novo = ref({
  estabelecimento: null as number | null,
  unidade: null as number | null,
  ocupacao: null as number | null,
  tipoVinculo: null as number | null,
  cargaAmbulatorial: 0,
  cargaHospitalar: 0,
  cargaOutros: 0,
  ocupacaoPadrao: false,
  atendeSus: false,
  geraRepasse: false,
  vigenciaInicio: new Date().toISOString().slice(0, 10),
  vigenciaFim: '',
});
const total = computed(
  () =>
    Number(novo.value.cargaAmbulatorial) +
    Number(novo.value.cargaHospitalar) +
    Number(novo.value.cargaOutros),
);
const unidades = computed(() =>
  (opcoes.data.value?.unidades ?? []).filter((u) => u.estabelecimento === novo.value.estabelecimento),
);
const erro = ref<unknown>(null);

async function fazer(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  try {
    await fn();
    await cliente.invalidateQueries({ queryKey: chaveQ.value });
  } catch (e) {
    erro.value = e;
  }
}
const incluir = () =>
  fazer(() =>
    incluirLotacao(props.profissional, { ...novo.value, vigenciaFim: novo.value.vigenciaFim || null }),
  );
</script>

<template>
  <section aria-labelledby="lotacoes-titulo" data-testid="lotacoes-profissional">
    <h3 id="lotacoes-titulo">{{ t('ligacoes.lotacao.titulo') }}</h3>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <MensagemErro v-if="erro" :erro="erro" data-testid="lotacao-erro" />
    <p v-if="consulta.data.value?.itens.length === 0">{{ t('ligacoes.comum.nenhum') }}</p>
    <ul v-else-if="consulta.data.value" data-testid="lista-lotacoes">
      <li v-for="l in consulta.data.value.itens" :key="l.id">
        {{
          t('ligacoes.lotacao.resumo', {
            est: l.estabelecimentoNome,
            un: l.unidadeNome ?? '—',
            cbo: `${l.ocupacaoCodigo} ${l.ocupacaoDescricao}`,
            h: l.cargaSemanal,
            ini: l.vigenciaInicio,
          })
        }}
        <span v-if="l.tipoVinculoDescricao">· {{ l.tipoVinculoDescricao }}</span>
        <span v-if="l.ocupacaoPadrao" class="pilula">{{ t('ligacoes.comum.principal') }}</span>
        <span class="pilula pilula--neutra">
          {{
            l.vigente
              ? t('ligacoes.comum.vigente')
              : `${t('ligacoes.comum.encerrada')} ${l.vigenciaFim ?? ''}`
          }}
        </span>
        <SanteBotao
          v-if="editar && l.vigenciaFim === null"
          :rotulo="t('ligacoes.comum.encerrar')"
          variante="secundario"
          @acionar="fazer(() => encerrarLotacao(profissional, l.id, l.versao, null))"
        />
      </li>
    </ul>
    <form v-if="editar" class="barra" data-testid="form-lotacao" @submit.prevent="incluir">
      <div class="campo">
        <label for="lot-est">{{ t('ligacoes.lotacao.estabelecimento') }}</label>
        <select id="lot-est" v-model="novo.estabelecimento" required>
          <option :value="null">{{ t('ligacoes.comum.escolha') }}</option>
          <option v-for="e in opcoes.data.value?.estabelecimentos ?? []" :key="e.id" :value="e.id">
            {{ e.nome }}
          </option>
        </select>
      </div>
      <div class="campo">
        <label for="lot-un">{{ t('ligacoes.lotacao.unidade') }}</label>
        <select id="lot-un" v-model="novo.unidade">
          <option :value="null">—</option>
          <option v-for="u in unidades" :key="u.id" :value="u.id">{{ u.nome }}</option>
        </select>
      </div>
      <div class="campo">
        <label for="lot-termo">{{ t('ligacoes.comum.buscar') }}</label>
        <input id="lot-termo" v-model="termo" maxlength="60" />
      </div>
      <div class="campo">
        <label for="lot-cbo">{{ t('ligacoes.lotacao.ocupacao') }}</label>
        <select id="lot-cbo" v-model="novo.ocupacao" required>
          <option :value="null">{{ t('ligacoes.comum.escolha') }}</option>
          <option v-for="o in opcoes.data.value?.ocupacoes ?? []" :key="o.id" :value="o.id">
            {{ o.codigo }} {{ o.descricao }}
          </option>
        </select>
      </div>
      <div class="campo">
        <label for="lot-vinc">{{ t('ligacoes.lotacao.vinculo') }}</label>
        <select id="lot-vinc" v-model="novo.tipoVinculo">
          <option :value="null">—</option>
          <option v-for="v in opcoes.data.value?.tiposVinculo ?? []" :key="v.id" :value="v.id">
            {{ v.codigo }} {{ v.descricao }}
          </option>
        </select>
      </div>
      <div class="campo">
        <label for="lot-amb">{{ t('ligacoes.lotacao.ambulatorial') }}</label>
        <input id="lot-amb" v-model.number="novo.cargaAmbulatorial" type="number" min="0" max="168" />
      </div>
      <div class="campo">
        <label for="lot-hosp">{{ t('ligacoes.lotacao.hospitalar') }}</label>
        <input id="lot-hosp" v-model.number="novo.cargaHospitalar" type="number" min="0" max="168" />
      </div>
      <div class="campo">
        <label for="lot-out">{{ t('ligacoes.lotacao.outros') }}</label>
        <input id="lot-out" v-model.number="novo.cargaOutros" type="number" min="0" max="168" />
      </div>
      <p :class="{ erro: total === 0 || total > 168 }" data-testid="lotacao-total" aria-live="polite">
        {{ t('ligacoes.lotacao.total', { n: total }) }}
      </p>
      <div class="campo">
        <label for="lot-ini">{{ t('ligacoes.comum.inicio') }}</label>
        <input id="lot-ini" v-model="novo.vigenciaInicio" type="date" required />
      </div>
      <div class="campo">
        <label for="lot-fim">{{ t('ligacoes.comum.fim') }}</label>
        <input id="lot-fim" v-model="novo.vigenciaFim" type="date" :min="novo.vigenciaInicio" />
      </div>
      <label
        ><input v-model="novo.ocupacaoPadrao" type="checkbox" /> {{ t('ligacoes.lotacao.padrao') }}</label
      >
      <label><input v-model="novo.atendeSus" type="checkbox" /> {{ t('ligacoes.lotacao.sus') }}</label>
      <label><input v-model="novo.geraRepasse" type="checkbox" /> {{ t('ligacoes.lotacao.repasse') }}</label>
      <SanteBotao
        :rotulo="t('ligacoes.lotacao.incluir')"
        tipo="submit"
        :desabilitado="!novo.estabelecimento || !novo.ocupacao || total === 0 || total > 168"
        data-testid="lotacao-incluir"
      />
    </form>
  </section>
</template>
