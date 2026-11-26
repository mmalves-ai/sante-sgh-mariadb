<script setup lang="ts">
// Preferências do faturista (C1-135, 06-FAT linha 38) — `Faturamento > Contas do paciente > Preferências do faturista`.
// Cada faturista escolhe a tela inicial, o tamanho das listas e se elas vêm agrupadas por paciente; a gravação é só da
// própria conta, com histórico (a vigência anterior fecha, nada é apagado). A regra do servidor roda na hora
// (conferirPreferenciasFaturista): o erro aparece ao lado do campo antes de gravar. Os parâmetros do estabelecimento
// (rotina diária, prazo do recurso de glosa, fechamento da competência) aparecem só para leitura.
import {
  conferirPreferenciasFaturista,
  definicaoParametroFaturamento,
  TELAS_INICIAIS_FATURISTA,
  type TelaInicialFaturista,
} from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { novaChave } from '../../exames/api-exames.js';
import { gravarPreferenciasFaturista, lerParametrosFaturamento } from '../api-parametros-faturamento.js';

const { t } = useI18n();
const P = 'parametrosFaturamento';
const K = 'faturamento.preferencia.';
const cliente = useQueryClient();
const tela = useQuery({ queryKey: ['faturamento', 'parametros'], queryFn: lerParametrosFaturamento });

const f = reactive({
  telaInicial: 'contas' as TelaInicialFaturista,
  // O campo numérico do Vue devolve número; a conferência é sobre o texto.
  itensPorPagina: '50' as string | number,
  agruparPorPaciente: false,
});
watch(
  () => tela.data.value?.preferencias,
  (p) => {
    if (!p) return;
    f.telaInicial = p.telaInicial;
    f.itensPorPagina = String(p.itensPorPagina);
    f.agruparPorPaciente = p.agruparPorPaciente;
  },
  { immediate: true },
);

const opTelas = computed(() =>
  TELAS_INICIAIS_FATURISTA.map((x) => ({ valor: x, rotulo: t(`${P}.telas.${x}`) })),
);
const limites = definicaoParametroFaturamento(`${K}itensPorPagina`);

/** Só o que mudou em relação ao gravado vai ao servidor. */
const pedido = computed<Record<string, string>>(() => {
  const g = tela.data.value?.preferencias;
  const p: Record<string, string> = {};
  if (!g || f.telaInicial !== g.telaInicial) p[`${K}telaInicial`] = f.telaInicial;
  if (!g || String(f.itensPorPagina).trim() !== String(g.itensPorPagina))
    p[`${K}itensPorPagina`] = String(f.itensPorPagina).trim();
  if (!g || f.agruparPorPaciente !== g.agruparPorPaciente)
    p[`${K}agruparPorPaciente`] = String(f.agruparPorPaciente);
  return p;
});
const semMudanca = computed(() => Object.keys(pedido.value).length === 0);
const erros = computed(() =>
  semMudanca.value
    ? {}
    : Object.fromEntries(conferirPreferenciasFaturista(pedido.value).map((e) => [e.campo, e.mensagem])),
);
const temErro = computed(() => Object.keys(erros.value).length > 0);

const gravado = ref(false);
let chave = novaChave('preferencias-faturista');
const gravar = useMutation({
  mutationFn: () => gravarPreferenciasFaturista(pedido.value, chave),
  onSuccess: async () => {
    gravado.value = true;
    chave = novaChave('preferencias-faturista');
    await cliente.invalidateQueries({ queryKey: ['faturamento', 'parametros'] });
  },
});
watch(pedido, () => {
  gravado.value = false;
});
</script>

<template>
  <section
    class="tela"
    aria-labelledby="preferencias-faturista-titulo"
    data-testid="tela-preferencias-faturista"
  >
    <h1 id="preferencias-faturista-titulo">{{ t(`${P}.titulo`) }}</h1>
    <p class="ajuda">{{ t(`${P}.explicacao`) }}</p>
    <MensagemErro v-if="tela.isError.value" :erro="tela.error.value" />

    <template v-else-if="tela.data.value">
      <h2>{{ t(`${P}.preferencias`) }}</h2>
      <form
        class="formulario"
        data-testid="preferencias-faturista-form"
        @submit.prevent="!temErro && !semMudanca && gravar.mutate()"
      >
        <SanteSelecao
          v-model="f.telaInicial"
          :rotulo="t(`${P}.telaInicial`)"
          :opcoes="opTelas"
          data-testid="preferencias-tela-inicial"
        />
        <label
          >{{ t(`${P}.itensPorPagina`, { min: limites?.minimo, max: limites?.maximo }) }}
          <input
            v-model="f.itensPorPagina"
            type="number"
            inputmode="numeric"
            :min="limites?.minimo"
            :max="limites?.maximo"
            :aria-invalid="erros[`${K}itensPorPagina`] ? 'true' : 'false'"
            data-testid="preferencias-itens-por-pagina"
          />
          <span v-if="erros[`${K}itensPorPagina`]" class="erro-campo" data-testid="preferencias-erro-itens">
            {{ erros[`${K}itensPorPagina`] }}
          </span>
        </label>
        <label class="marcador">
          <input v-model="f.agruparPorPaciente" type="checkbox" data-testid="preferencias-agrupar-paciente" />
          {{ t(`${P}.agruparPorPaciente`) }}
        </label>
        <button
          type="submit"
          :disabled="temErro || semMudanca || gravar.isPending.value"
          data-testid="preferencias-gravar"
        >
          {{ t(`${P}.gravar`) }}
        </button>
        <p v-if="gravado" class="ajuda" role="status" data-testid="preferencias-gravado">
          {{ t(`${P}.gravado`) }}
        </p>
        <p v-else-if="semMudanca" class="ajuda" data-testid="preferencias-sem-mudanca">
          {{ t(`${P}.semMudanca`) }}
        </p>
        <MensagemErro v-if="gravar.isError.value" :erro="gravar.error.value" />
      </form>

      <h2>{{ t(`${P}.vigentes`) }}</h2>
      <dl class="vigentes" data-testid="parametros-faturamento-vigentes">
        <dt>{{ t(`${P}.rotinaDiaria`) }}</dt>
        <dd data-testid="parametro-rotina-diaria">
          {{
            tela.data.value.parametros.rotinaDiaria
              ? t(`${P}.ligada`, { hora: tela.data.value.parametros.rotinaDiariaHora })
              : t(`${P}.desligada`)
          }}
        </dd>
        <dt>{{ t(`${P}.prazoRecurso`) }}</dt>
        <dd data-testid="parametro-prazo-recurso">
          {{ t(`${P}.dias`, { n: tela.data.value.parametros.prazoRecursoGlosaDias }) }}
        </dd>
        <dt>{{ t(`${P}.fechamento`) }}</dt>
        <dd data-testid="parametro-fechamento">
          {{ t(`${P}.diaLimite`, { n: tela.data.value.parametros.fechamentoDiaLimite }) }}
        </dd>
      </dl>
    </template>
  </section>
</template>

<style scoped>
.formulario {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.ajuda {
  flex-basis: 100%;
}
.erro-campo {
  display: block;
  color: var(--sgh-alerta-texto);
}
.vigentes {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
.vigentes dt {
  font-weight: 600;
}
</style>
