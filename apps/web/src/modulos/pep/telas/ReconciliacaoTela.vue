<script setup lang="ts">
// Reconciliação medicamentosa (M24; ficha, seção 7; 03-PEP L104): parte da lista de uso contínuo do paciente. Na
// admissão, na transferência e na alta cada medicamento ativo da lista é decidido uma vez (manter, suspender,
// substituir, ajustar); conduta diferente de manter pede justificativa, conferida na hora pela mesma regra do
// domínio que o servidor aplica (validarReconciliacaoDaLista). O lote grava ligado a cada medicamento da lista e a
// lista se atualiza (suspenso com autor e justificativa). Medicamento fora da lista: incluir na lista (tela de uso
// contínuo) ou registrar avulso no formulário de baixo.
import { CONDUTAS_RECONCILIACAO, MOMENTOS_RECONCILIACAO, type ReconciliacaoLida } from '@sgh/contratos';
import { validarReconciliacaoDaLista, type CondutaReconciliacaoLista } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { gravarUsoContinuo, lerFarmacovigilancia, type UsoContinuoTela } from '../api-farmacovigilancia.js';
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
const momento = ref<ReconciliacaoLida['momento']>('admissao');
const opcoesMomento = computed(() =>
  MOMENTOS_RECONCILIACAO.map((m) => ({ valor: m, rotulo: t(`pep.presc.reconciliacao.momentos.${m}`) })),
);

// A reconciliação pela lista de uso contínuo: uma decisão por medicamento ativo.
const chaveLista = computed(() => ['pep', 'farmacovigilancia', id.value]);
const lista = useQuery({ queryKey: chaveLista, queryFn: () => lerFarmacovigilancia(id.value), staleTime: 0 });
const ativos = computed<UsoContinuoTela[]>(() =>
  (lista.data.value?.usoContinuo ?? []).filter((u) => !u.suspenso),
);
type Decisao = { conduta: CondutaReconciliacaoLista; justificativa: string };
const decisoes = reactive<Record<number, Decisao>>({});
watch(
  ativos,
  (xs) => {
    for (const u of xs) decisoes[u.id] ??= { conduta: 'manter', justificativa: '' };
  },
  { immediate: true },
);
const decisaoDe = (u: UsoContinuoTela): Decisao =>
  (decisoes[u.id] ??= { conduta: 'manter', justificativa: '' });
const faltaJustificativa = (u: UsoContinuoTela): boolean => {
  const d = decisaoDe(u);
  return d.conduta !== 'manter' && d.justificativa.trim().length < 5;
};
const decisoesEnvio = computed(() =>
  ativos.value.map((u) => {
    const d = decisaoDe(u);
    return {
      usoContinuo: u.id,
      conduta: d.conduta,
      justificativa: d.conduta === 'manter' ? null : d.justificativa.trim() || null,
    };
  }),
);
const falhasLista = computed(() =>
  validarReconciliacaoDaLista(
    ativos.value.map((u) => u.id),
    decisoesEnvio.value,
  ),
);
const podeLista = computed(() => pode('pep.reconciliacao.registrar'));
const erroLista = ref<unknown>(null);
const okLista = ref('');
const enviandoLista = ref(false);
async function reconciliarLista(): Promise<void> {
  okLista.value = '';
  if (falhasLista.value.length > 0 || !atendimento.value || ativos.value.length === 0) return;
  erroLista.value = null;
  enviandoLista.value = true;
  try {
    await gravarUsoContinuo({
      acao: 'reconciliar',
      paciente: id.value,
      atendimento: Number(atendimento.value),
      momento: momento.value,
      decisoes: decisoesEnvio.value,
    });
    okLista.value = t('pep.presc.reconciliacao.lista.registrada', { n: decisoesEnvio.value.length });
    for (const k of Object.keys(decisoes)) delete decisoes[Number(k)];
    await Promise.all([
      cliente.invalidateQueries({ queryKey: chaveLista.value }),
      cliente.invalidateQueries({ queryKey: chaveQ.value }),
    ]);
  } catch (e) {
    erroLista.value = e;
  } finally {
    enviandoLista.value = false;
  }
}
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
          :opcoes="opcoesMomento"
          data-testid="recon-momento"
        />
      </div>
      <section class="bloco" aria-labelledby="recon-lista-titulo" data-testid="recon-lista">
        <h2 id="recon-lista-titulo">{{ t('pep.presc.reconciliacao.lista.titulo') }}</h2>
        <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
        <template v-else-if="ativos.length === 0">
          <p role="status" data-testid="recon-lista-vazia">{{ t('pep.presc.reconciliacao.lista.vazia') }}</p>
        </template>
        <form v-else class="bloco" data-testid="form-recon-lista" @submit.prevent="reconciliarLista">
          <p>{{ t('pep.presc.reconciliacao.lista.texto', { n: ativos.length }) }}</p>
          <fieldset v-for="u in ativos" :key="u.id" class="linha" :data-testid="`recon-uso-${u.id}`">
            <legend>{{ u.medicamento }}</legend>
            <p class="detalhe">
              <span v-if="u.posologia">{{ u.posologia }} · </span>{{ t('pep.presc.reconciliacao.fonte') }}:
              {{ t(`pep.farmaco.fontes.${u.fonte}`) }}
            </p>
            <SanteSelecao
              v-model="decisaoDe(u).conduta"
              :rotulo="t('pep.presc.reconciliacao.conduta')"
              :opcoes="
                CONDUTAS_RECONCILIACAO.map((x) => ({
                  valor: x,
                  rotulo: t(`pep.presc.reconciliacao.condutas.${x}`),
                }))
              "
              :data-testid="`recon-uso-conduta-${u.id}`"
            />
            <div v-if="decisaoDe(u).conduta !== 'manter'" class="campo">
              <label :for="`recon-uso-just-${u.id}`">{{ t('pep.presc.reconciliacao.justificativa') }}</label>
              <input
                :id="`recon-uso-just-${u.id}`"
                v-model="decisaoDe(u).justificativa"
                maxlength="250"
                :aria-invalid="faltaJustificativa(u)"
                :aria-describedby="faltaJustificativa(u) ? `recon-uso-just-msg-${u.id}` : undefined"
                :data-testid="`recon-uso-justificativa-${u.id}`"
              />
              <small v-if="faltaJustificativa(u)" :id="`recon-uso-just-msg-${u.id}`" class="falta">
                {{ t('pep.presc.reconciliacao.lista.justificativaFalta') }}
              </small>
            </div>
          </fieldset>
          <div class="barra">
            <SanteBotao
              :rotulo="t('pep.presc.reconciliacao.lista.registrar', { n: ativos.length })"
              tipo="submit"
              :desabilitado="!online || !podeLista || !atendimento || enviandoLista || falhasLista.length > 0"
              data-testid="recon-lista-registrar"
            />
          </div>
          <SanteAlerta
            v-if="okLista"
            variante="info"
            :texto="okLista"
            anunciar
            data-testid="recon-lista-ok"
          />
        </form>
        <MensagemErro v-if="erroLista" :erro="erroLista" />
        <p>
          <RouterLink :to="`/pep/paciente/${id}/farmacovigilancia`" data-testid="recon-lista-editar">
            {{ t('pep.presc.reconciliacao.lista.editar') }}
          </RouterLink>
        </p>
      </section>
      <h2>{{ t('pep.presc.reconciliacao.avulsa') }}</h2>
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
.detalhe {
  margin: 0;
  flex-basis: 100%;
}
.falta {
  color: var(--sgh-alerta);
}
.registro h3 {
  font-size: var(--sgh-fonte-base);
  margin: 0;
}
h2 {
  margin: 0;
}
</style>
