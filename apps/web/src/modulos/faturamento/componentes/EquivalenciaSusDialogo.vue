<script setup lang="ts">
// Registrar (ou trocar) a equivalência SIGTAP de um procedimento do hospital para a CIHA (M51, etapa 1; regra 3): o
// procedimento sem equivalente vai para a crítica; aqui o faturista escolhe, pela busca no servidor, o procedimento do
// hospital (o código numa tabela de convênio: o mesmo código em outra tabela é outro procedimento) e o procedimento
// SIGTAP, vendo os nomes antes de gravar. Já existindo equivalência, a troca leva a versão lida (nunca sobrescreve a
// escolha de outra pessoa em silêncio). O servidor confere os dois e grava só no Sante (a tabela de preços não muda).
import type { EquivalenciaSusLida, ProcedimentoHospitalSus, SigtapAchado } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from './ErroFaturamento.vue';
import {
  buscarProcedimentosHospitalSus,
  buscarSigtapSus,
  lerEquivalenciasSus,
  registrarEquivalenciaSus,
} from '../api-sus.js';

const props = defineProps<{
  /** O procedimento do hospital (ID unificado) já conhecido: da crítica ou da linha da lista. */
  procedimento: number | null;
  /** A competência que diz a vigência SIGTAP (null: a busca não marca vigência). */
  competencia?: string | null;
}>();
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ registrada: [mudou: boolean] }>();
const { t } = useI18n();

const termoProc = ref('');
const achadosProc = ref<ProcedimentoHospitalSus[]>([]);
const procedimentoId = ref<number | null>(null);
const termoSigtap = ref('');
const achadosSigtap = ref<SigtapAchado[]>([]);
const sigtapCodigo = ref<string | null>(null);
const atual = ref<EquivalenciaSusLida | null>(null);
const avisoBusca = ref('');
const erro = ref<unknown>(null);
const gravando = ref(false);

const rotuloProc = (p: ProcedimentoHospitalSus) => `${p.codigo} ${p.nome}${p.tabela ? ` (${p.tabela})` : ''}`;
const opcoesProc = computed(() => [
  { valor: null, rotulo: t('faturamentoSus.equivalencias.escolha') },
  ...achadosProc.value.map((p) => ({ valor: p.id, rotulo: rotuloProc(p) })),
]);
const opcoesSigtap = computed(() => [
  { valor: null, rotulo: t('faturamentoSus.equivalencias.escolha') },
  ...achadosSigtap.value.map((p) => ({
    valor: p.codigo,
    rotulo: `${p.codigo} ${p.nome}${p.vigente ? '' : ` ${t('faturamentoSus.equivalencias.foraDeVigencia')}`}`,
  })),
]);
const procEscolhido = computed(() => achadosProc.value.find((p) => p.id === procedimentoId.value) ?? null);
const sigtapEscolhido = computed(
  () => achadosSigtap.value.find((p) => p.codigo === sigtapCodigo.value) ?? null,
);
const podeGravar = computed(
  () => procedimentoId.value !== null && sigtapCodigo.value !== null && !gravando.value,
);

async function lerAtual(id: number | null): Promise<void> {
  atual.value = null;
  if (id === null) return;
  try {
    const r = await lerEquivalenciasSus({ procedimento: id, inativas: 'sim', pagina: 0, porPagina: 10 });
    atual.value = r.itens[0] ?? null;
  } catch (e) {
    erro.value = e;
  }
}

watch(visivel, async (v) => {
  if (!v) return;
  termoProc.value = '';
  termoSigtap.value = '';
  achadosProc.value = [];
  achadosSigtap.value = [];
  procedimentoId.value = null;
  sigtapCodigo.value = null;
  avisoBusca.value = '';
  erro.value = null;
  if (props.procedimento) {
    try {
      achadosProc.value = await buscarProcedimentosHospitalSus({ ids: [props.procedimento] });
      procedimentoId.value = achadosProc.value[0]?.id ?? null;
    } catch (e) {
      erro.value = e;
    }
  }
});
watch(procedimentoId, (id) => void lerAtual(id));

async function buscarProc(): Promise<void> {
  avisoBusca.value = '';
  if (termoProc.value.trim().length < 2) {
    avisoBusca.value = t('faturamentoSus.equivalencias.termoCurto');
    return;
  }
  try {
    achadosProc.value = await buscarProcedimentosHospitalSus({ termo: termoProc.value.trim() });
    procedimentoId.value = achadosProc.value.length === 1 ? achadosProc.value[0]!.id : null;
    if (achadosProc.value.length === 0) avisoBusca.value = t('faturamentoSus.equivalencias.nenhumAchado');
  } catch (e) {
    erro.value = e;
  }
}

async function buscarSigtap(): Promise<void> {
  avisoBusca.value = '';
  if (termoSigtap.value.trim().length < 2) {
    avisoBusca.value = t('faturamentoSus.equivalencias.termoCurto');
    return;
  }
  try {
    achadosSigtap.value = await buscarSigtapSus(termoSigtap.value.trim(), props.competencia ?? null);
    sigtapCodigo.value = achadosSigtap.value.length === 1 ? achadosSigtap.value[0]!.codigo : null;
    if (achadosSigtap.value.length === 0) avisoBusca.value = t('faturamentoSus.equivalencias.nenhumAchado');
  } catch (e) {
    erro.value = e;
  }
}

async function gravar(): Promise<void> {
  if (procedimentoId.value === null || sigtapCodigo.value === null) return;
  erro.value = null;
  gravando.value = true;
  try {
    const r = await registrarEquivalenciaSus({
      procedimento: procedimentoId.value,
      sigtap: sigtapCodigo.value,
      ...(atual.value ? { versao: atual.value.versao } : {}),
    });
    visivel.value = false;
    emit('registrada', r.mudou);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('faturamentoSus.equivalencias.titulo')">
    <form class="form" data-testid="form-equivalencia-sus" @submit.prevent="gravar">
      <p>{{ t('faturamentoSus.equivalencias.explicacao') }}</p>
      <fieldset class="grupo">
        <legend>{{ t('faturamentoSus.equivalencias.procedimento') }}</legend>
        <div class="linha">
          <SanteCampoTexto
            v-model="termoProc"
            :rotulo="t('faturamentoSus.equivalencias.buscarProcedimento')"
            :max-bytes="60"
            data-testid="equivalencia-busca-procedimento"
          />
          <SanteBotao
            :rotulo="t('faturamentoSus.equivalencias.buscar')"
            variante="secundario"
            data-testid="botao-buscar-procedimento"
            @acionar="buscarProc"
          />
        </div>
        <SanteSelecao
          v-model="procedimentoId"
          :rotulo="t('faturamentoSus.equivalencias.procedimento')"
          :opcoes="opcoesProc"
          obrigatorio
          data-testid="equivalencia-procedimento"
        />
        <p v-if="procEscolhido" class="pequeno" data-testid="equivalencia-procedimento-nome">
          {{ rotuloProc(procEscolhido) }}
        </p>
        <p v-if="atual && atual.ativa" class="pequeno" data-testid="equivalencia-atual">
          {{
            t('faturamentoSus.equivalencias.atual', { codigo: atual.sigtap, nome: atual.sigtapNome ?? '' })
          }}
        </p>
        <p v-else-if="atual" class="pequeno" data-testid="equivalencia-atual">
          {{
            t('faturamentoSus.equivalencias.desativadaAtual', {
              codigo: atual.sigtap,
              nome: atual.sigtapNome ?? '',
            })
          }}
        </p>
      </fieldset>
      <fieldset class="grupo">
        <legend>{{ t('faturamentoSus.equivalencias.sigtap') }}</legend>
        <div class="linha">
          <SanteCampoTexto
            v-model="termoSigtap"
            :rotulo="t('faturamentoSus.equivalencias.buscarSigtap')"
            :max-bytes="60"
            data-testid="equivalencia-busca-sigtap"
          />
          <SanteBotao
            :rotulo="t('faturamentoSus.equivalencias.buscar')"
            variante="secundario"
            data-testid="botao-buscar-sigtap"
            @acionar="buscarSigtap"
          />
        </div>
        <SanteSelecao
          v-model="sigtapCodigo"
          :rotulo="t('faturamentoSus.equivalencias.sigtap')"
          :opcoes="opcoesSigtap"
          obrigatorio
          data-testid="equivalencia-sigtap"
        />
        <p v-if="sigtapEscolhido" class="pequeno" data-testid="equivalencia-sigtap-nome">
          {{ sigtapEscolhido.codigo }} {{ sigtapEscolhido.nome }}
        </p>
        <p class="pequeno">{{ t('faturamentoSus.equivalencias.sigtapAjuda') }}</p>
      </fieldset>
      <p v-if="avisoBusca" class="pequeno" role="status">{{ avisoBusca }}</p>
      <ErroFaturamento v-if="erro" :erro="erro" />
      <div class="linha">
        <SanteBotao
          :rotulo="t('faturamentoSus.equivalencias.registrar')"
          tipo="submit"
          :desabilitado="!podeGravar"
          data-testid="botao-gravar-equivalencia"
        />
        <SanteBotao
          :rotulo="t('faturamentoSus.criticas.cancelar')"
          variante="texto"
          @acionar="visivel = false"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.grupo {
  display: grid;
  gap: var(--sgh-espaco-2);
  border: 0;
  padding: 0;
  margin: 0;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
}
.pequeno {
  font-size: var(--sgh-fonte-pequena);
  margin: 0;
}
</style>
