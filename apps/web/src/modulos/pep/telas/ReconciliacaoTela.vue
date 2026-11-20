<script setup lang="ts">
// Reconciliação medicamentosa (M24; ficha, seção 7): os medicamentos em uso antes da internação, a fonte da
// informação e a conduta de cada um na admissão e na alta (manter, suspender, substituir, ajustar). Suspender ou
// substituir pede justificativa. Registro só desta aplicação, com chave de liberação própria.
import { CONDUTAS_RECONCILIACAO, type ReconciliacaoLida } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  lerContexto,
  lerLiberacaoPrescricao,
  lerReconciliacoes,
  registrarReconciliacao,
} from '../api-prescricao.js';
import CabecalhoProntuario from '../componentes/CabecalhoProntuario.vue';
import { useConexao } from '../conexao.js';
import { dataHoraBr } from '../formato.js';

type Linha = ReconciliacaoLida['medicamentos'][number];
const FONTES = ['paciente', 'familiar', 'receita', 'prontuario', 'outro'] as const;

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const online = useConexao();
const id = computed(() => Number(props.paciente));
const contexto = useQuery({
  queryKey: computed(() => ['presc', 'contexto', id.value]),
  queryFn: () => lerContexto(id.value),
});
const liberacao = useQuery({ queryKey: ['presc', 'liberacao'], queryFn: () => lerLiberacaoPrescricao() });
const c = computed(() => contexto.data.value);
const atendimento = ref(typeof rota.query['atendimento'] === 'string' ? rota.query['atendimento'] : '');
watch(c, (x) => {
  if (x && !atendimento.value) atendimento.value = String(x.atendimentos[0]?.id ?? '');
});
const opcoes = computed(() =>
  (c.value?.atendimentos ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: t('pep.presc.paciente.atendimentoRotulo', {
      tipo: a.tipo,
      numero: a.numero ?? a.id,
      unidade: a.unidade ?? '',
    }),
  })),
);
const chaveQ = computed(() => ['presc', 'reconciliacao', id.value, atendimento.value]);
const lidas = useQuery({
  queryKey: chaveQ,
  queryFn: () => lerReconciliacoes(id.value, Number(atendimento.value)),
  enabled: computed(() => !!atendimento.value),
  staleTime: 0,
});
const momento = ref<'admissao' | 'alta'>('admissao');
const linhas = reactive<
  {
    descricao: string;
    dose: string;
    frequencia: string;
    fonte: Linha['fonte'];
    conduta: Linha['conduta'];
    justificativa: string;
  }[]
>([]);
function acrescentar(): void {
  linhas.push({
    descricao: '',
    dose: '',
    frequencia: '',
    fonte: 'paciente',
    conduta: 'manter',
    justificativa: '',
  });
}
acrescentar();
const erro = ref<unknown>(null);
const aviso = ref('');
const ok = ref('');
async function registrar(): Promise<void> {
  aviso.value = '';
  const validas = linhas.filter((l) => l.descricao.trim().length >= 2);
  const sem = validas.findIndex(
    (l) => (l.conduta === 'suspender' || l.conduta === 'substituir') && l.justificativa.trim().length < 5,
  );
  if (sem >= 0) {
    aviso.value = t('pep.presc.reconciliacao.justificativaFalta', { n: sem + 1 });
    return;
  }
  if (validas.length === 0) return;
  erro.value = null;
  try {
    await registrarReconciliacao(id.value, {
      atendimento: Number(atendimento.value),
      momento: momento.value,
      medicamentos: validas.map((l) => ({
        descricao: l.descricao.trim(),
        ...(l.dose.trim() ? { dose: l.dose.trim() } : {}),
        ...(l.frequencia.trim() ? { frequencia: l.frequencia.trim() } : {}),
        fonte: l.fonte,
        conduta: l.conduta,
        ...(l.justificativa.trim() ? { justificativa: l.justificativa.trim() } : {}),
      })),
    });
    ok.value = t('pep.presc.reconciliacao.registrada');
    linhas.splice(0, linhas.length);
    acrescentar();
    await cliente.invalidateQueries({ queryKey: chaveQ.value });
  } catch (e) {
    erro.value = e;
  }
}
const ligada = computed(() => liberacao.data.value?.reconciliacao.ligada ?? false);
</script>

<template>
  <section class="tela" aria-labelledby="recon-titulo" data-testid="tela-reconciliacao">
    <h1 id="recon-titulo">{{ t('pep.presc.reconciliacao.titulo') }}</h1>
    <p>
      <RouterLink :to="`/pep/paciente/${id}/prescricao`">{{ t('pep.presc.voltar') }}</RouterLink>
    </p>
    <p>{{ t('pep.presc.reconciliacao.texto') }}</p>
    <SanteAlerta v-if="!online" variante="alerta" :texto="t('pep.presc.semConexao')" anunciar />
    <SanteAlerta
      v-if="liberacao.data.value && !ligada"
      variante="aviso"
      :texto="liberacao.data.value.reconciliacao.motivo ?? t('pep.presc.desligada')"
    />
    <MensagemErro v-if="contexto.isError.value" :erro="contexto.error.value" />
    <p v-else-if="!c" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else>
      <CabecalhoProntuario :cabecalho="c.cabecalho" />
      <div class="barra">
        <SanteSelecao v-model="atendimento" :rotulo="t('pep.presc.paciente.atendimento')" :opcoes="opcoes" />
        <SanteSelecao
          v-model="momento"
          :rotulo="t('pep.presc.reconciliacao.momento')"
          :opcoes="
            (['admissao', 'alta'] as const).map((m) => ({
              valor: m,
              rotulo: t(`pep.presc.reconciliacao.momentos.${m}`),
            }))
          "
          data-testid="recon-momento"
        />
      </div>
      <form v-if="ligada" class="bloco" data-testid="form-reconciliacao" @submit.prevent="registrar">
        <fieldset v-for="(l, i) in linhas" :key="i" class="linha">
          <legend>{{ t('pep.presc.reconciliacao.medicamento') }} {{ i + 1 }}</legend>
          <div class="campo">
            <label :for="`recon-desc-${i}`">{{ t('pep.presc.reconciliacao.medicamento') }}</label>
            <input
              :id="`recon-desc-${i}`"
              v-model="l.descricao"
              maxlength="200"
              :data-testid="`recon-descricao-${i}`"
            />
          </div>
          <div class="campo">
            <label :for="`recon-dose-${i}`">{{ t('pep.presc.reconciliacao.dose') }}</label>
            <input :id="`recon-dose-${i}`" v-model="l.dose" maxlength="60" />
          </div>
          <div class="campo">
            <label :for="`recon-freq-${i}`">{{ t('pep.presc.reconciliacao.frequencia') }}</label>
            <input :id="`recon-freq-${i}`" v-model="l.frequencia" maxlength="60" />
          </div>
          <SanteSelecao
            v-model="l.fonte"
            :rotulo="t('pep.presc.reconciliacao.fonte')"
            :opcoes="FONTES.map((f) => ({ valor: f, rotulo: t(`pep.presc.reconciliacao.fontes.${f}`) }))"
          />
          <SanteSelecao
            v-model="l.conduta"
            :rotulo="t('pep.presc.reconciliacao.conduta')"
            :opcoes="
              CONDUTAS_RECONCILIACAO.map((x) => ({
                valor: x,
                rotulo: t(`pep.presc.reconciliacao.condutas.${x}`),
              }))
            "
            :data-testid="`recon-conduta-${i}`"
          />
          <div v-if="l.conduta === 'suspender' || l.conduta === 'substituir'" class="campo">
            <label :for="`recon-just-${i}`">{{ t('pep.presc.reconciliacao.justificativa') }}</label>
            <input
              :id="`recon-just-${i}`"
              v-model="l.justificativa"
              maxlength="255"
              :data-testid="`recon-justificativa-${i}`"
            />
          </div>
          <SanteBotao
            v-if="linhas.length > 1"
            :rotulo="t('pep.presc.reconciliacao.tirar', { n: i + 1 })"
            variante="texto"
            @acionar="linhas.splice(i, 1)"
          />
        </fieldset>
        <div class="barra">
          <SanteBotao
            :rotulo="t('pep.presc.reconciliacao.acrescentar')"
            variante="secundario"
            data-testid="recon-acrescentar"
            @acionar="acrescentar"
          />
          <SanteBotao
            :rotulo="t('pep.presc.reconciliacao.registrar')"
            tipo="submit"
            :desabilitado="!online"
            data-testid="recon-registrar"
          />
        </div>
        <SanteAlerta v-if="aviso" variante="aviso" :texto="aviso" data-testid="recon-aviso" />
        <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="recon-ok" />
      </form>
      <MensagemErro v-if="erro" :erro="erro" />
      <section class="bloco">
        <h2>{{ t('pep.presc.reconciliacao.anteriores') }}</h2>
        <p v-if="(lidas.data.value ?? []).length === 0" role="status">
          {{ t('pep.presc.reconciliacao.vazio') }}
        </p>
        <article
          v-for="r in lidas.data.value"
          :key="r.id"
          class="registro"
          :data-testid="`reconciliacao-${r.id}`"
        >
          <h3>
            {{
              t('pep.presc.reconciliacao.registradaEm', {
                momento: t(`pep.presc.reconciliacao.momentos.${r.momento}`),
                em: dataHoraBr(r.registradoEm),
                por: r.registradoPor,
              })
            }}
          </h3>
          <ul>
            <li v-for="(m, k) in r.medicamentos" :key="k">
              {{ m.descricao }}<span v-if="m.dose"> · {{ m.dose }}</span
              ><span v-if="m.frequencia"> · {{ m.frequencia }}</span> ·
              {{ t(`pep.presc.reconciliacao.condutas.${m.conduta}`) }}
              <span v-if="m.justificativa"> ({{ m.justificativa }})</span>
            </li>
          </ul>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.tela,
.bloco {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.barra,
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
fieldset {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
}
.registro h3 {
  font-size: var(--sgh-fonte-base);
  margin: 0;
}
h2 {
  margin: 0;
}
</style>
