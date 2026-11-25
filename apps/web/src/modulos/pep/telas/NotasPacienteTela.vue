<script setup lang="ts">
// Notas e lembretes livres sobre o paciente (03-PEP L102), numa tela só por paciente: no topo os avisos em vigor
// (tipo marcado como alerta), a nota nova em uma linha de decisões (tipo, texto pronto opcional que preenche o texto,
// quem vê e validade com atalhos de 1, 7 e 30 dias) e a lista das notas que esta pessoa pode ver, das em vigor para
// as demais. Validação na hora: o botão só libera com tipo e texto, o contador mostra o que resta e a data passada é
// apontada antes de enviar. Nada é apagado: a nota cumprida é encerrada por quem a vê; o autor cancela com motivo ou
// muda a validade. A regra final (autor, visibilidade, validade) é do servidor; a recusa aparece como veio.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { gravarNotaPaciente, lerNotasPaciente, type NotaTela } from '../api-notas-paciente.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const chave = computed(() => ['pep', 'notas', id.value]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerNotasPaciente(id.value), staleTime: 0 });
const d = computed(() => dados.data.value);
const erro = ref<unknown>(null);
const ok = ref('');
const MAXIMO = 4000;
const DIA = 86_400_000;

const podeGravar = computed(() => pode('pep.evolucao.criar') && Boolean(d.value?.podeEscrever));
const SEM = 'sem';
const nova = reactive({ tipo: '', pronto: SEM, texto: '', visibilidade: 'equipe', validade: SEM, data: '' });
const opcoesTipo = computed(() =>
  (d.value?.tipos ?? []).map((x) => ({ valor: String(x.id), rotulo: x.descricao })),
);
const opcoesPronto = computed(() => [
  { valor: SEM, rotulo: t('pep.notas.semTextoPronto') },
  ...(d.value?.textosProntos ?? []).map((x) => ({ valor: String(x.id), rotulo: x.titulo })),
]);
const opcoesVisibilidade = computed(() =>
  (['equipe', 'autor', 'todos'] as const).map((v) => ({
    valor: v,
    rotulo: t(`pep.notas.visibilidades.${v}`),
  })),
);
const opcoesValidade = computed(() =>
  (['sem', 'd1', 'd7', 'd30', 'data'] as const).map((v) => ({
    valor: v,
    rotulo: t(`pep.notas.validades.${v}`),
  })),
);
// O texto pronto escolhido preenche o texto, que segue editável.
watch(
  () => nova.pronto,
  (p) => {
    const x = d.value?.textosProntos.find((y) => String(y.id) === p);
    if (x) nova.texto = x.texto.slice(0, MAXIMO);
  },
);
const restam = computed(() => MAXIMO - nova.texto.length);
const fimDoDia = (s: string) => new Date(`${s}T23:59:59`);
const validadeNova = computed<Date | null>(() => {
  const dias: Record<string, number> = { d1: 1, d7: 7, d30: 30 };
  if (nova.validade in dias) return new Date(Date.now() + dias[nova.validade]! * DIA);
  if (nova.validade === 'data' && nova.data) return fimDoDia(nova.data);
  return null;
});
const validadePassada = computed(
  () => validadeNova.value !== null && validadeNova.value.getTime() <= Date.now(),
);
const novaPronta = computed(
  () =>
    Boolean(nova.tipo) &&
    nova.texto.trim().length > 0 &&
    restam.value >= 0 &&
    !validadePassada.value &&
    !(nova.validade === 'data' && !nova.data),
);

const mostrarTodas = ref(false);
const EM_VIGOR = new Set(['ativa']);
const visiveis = computed(() =>
  (d.value?.notas ?? []).filter((n) => mostrarTodas.value || EM_VIGOR.has(n.situacao)),
);

async function gravar(corpo: Record<string, unknown>, depois?: () => void): Promise<void> {
  erro.value = null;
  ok.value = '';
  try {
    await gravarNotaPaciente(corpo);
    ok.value = t('pep.notas.gravada');
    depois?.();
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  }
}

const registrar = () =>
  gravar(
    {
      acao: 'registrar',
      paciente: id.value,
      tipo: Number(nova.tipo),
      ...(nova.pronto !== SEM ? { predefinida: Number(nova.pronto) } : {}),
      texto: nova.texto,
      visibilidade: nova.visibilidade,
      validaAte: validadeNova.value ? validadeNova.value.toISOString() : null,
    },
    () => Object.assign(nova, { pronto: SEM, texto: '', validade: SEM, data: '' }),
  );

/** Campos do passo, um por nota (motivo do cancelamento, data da nova validade). */
const passo = reactive<Record<number, { motivo: string; data: string }>>({});
const campos = (n: NotaTela) => (passo[n.id] ??= { motivo: '', data: '' });
const podeEncerrar = (n: NotaTela) =>
  podeGravar.value && (n.situacao === 'ativa' || n.situacao === 'vencida');
const podeAutor = (n: NotaTela) => podeGravar.value && n.doAutor && n.situacao !== 'cancelada';
const motivoOk = (n: NotaTela) => campos(n).motivo.trim().length >= 5;
const dataOk = (n: NotaTela) => !campos(n).data || fimDoDia(campos(n).data).getTime() > Date.now();
const encerrar = (n: NotaTela) => gravar({ acao: 'encerrar', nota: n.id, versao: n.versao });
const cancelar = (n: NotaTela) =>
  gravar({ acao: 'cancelar', nota: n.id, versao: n.versao, motivo: campos(n).motivo.trim() });
const prorrogar = (n: NotaTela) =>
  gravar({
    acao: 'prorrogar',
    nota: n.id,
    versao: n.versao,
    validaAte: campos(n).data ? fimDoDia(campos(n).data).toISOString() : null,
  });
</script>

<template>
  <section class="notas" data-testid="notas-tela">
    <h1>{{ t('pep.notas.titulo') }}</h1>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="notas-ok" />
    <p v-if="!d">{{ t('pep.carregando') }}</p>
    <template v-else>
      <div v-if="d.alertas.length" data-testid="notas-alertas">
        <h2>{{ t('pep.notas.alertas') }}</h2>
        <SanteAlerta
          v-for="a in d.alertas"
          :key="a.id"
          variante="aviso"
          :texto="`${a.tipo.descricao}: ${a.texto}`"
        />
      </div>

      <h2>{{ t('pep.notas.nova') }}</h2>
      <p v-if="pode('pep.evolucao.criar') && !d.podeEscrever">{{ t('pep.notas.semProfissional') }}</p>
      <p v-else-if="podeGravar && d.tipos.length === 0" data-testid="notas-sem-tipos">
        {{ t('pep.notas.semTipos') }}
      </p>
      <form v-else-if="podeGravar" class="notas__nova" data-testid="notas-nova" @submit.prevent="registrar">
        <SanteSelecao
          v-model="nova.tipo"
          :rotulo="t('pep.notas.tipo')"
          :opcoes="opcoesTipo"
          data-testid="notas-tipo"
        />
        <SanteSelecao
          v-if="d.textosProntos.length"
          v-model="nova.pronto"
          :rotulo="t('pep.notas.textoPronto')"
          :opcoes="opcoesPronto"
          data-testid="notas-pronto"
        />
        <label class="notas__texto">
          {{ t('pep.notas.texto') }}
          <textarea v-model="nova.texto" :maxlength="MAXIMO" rows="3" required data-testid="notas-texto" />
          <small :class="{ 'notas__restam--fim': restam < 100 }">{{
            t('pep.notas.restam', { n: restam })
          }}</small>
        </label>
        <SanteSelecao
          v-model="nova.visibilidade"
          :rotulo="t('pep.notas.visibilidade')"
          :opcoes="opcoesVisibilidade"
          data-testid="notas-visibilidade"
        />
        <SanteSelecao
          v-model="nova.validade"
          :rotulo="t('pep.notas.validade')"
          :opcoes="opcoesValidade"
          data-testid="notas-validade"
        />
        <label v-if="nova.validade === 'data'">
          {{ t('pep.notas.ate') }}
          <input v-model="nova.data" type="date" data-testid="notas-data" :aria-invalid="validadePassada" />
        </label>
        <SanteAlerta v-if="validadePassada" variante="alerta" :texto="t('pep.notas.validadePassada')" />
        <SanteBotao
          tipo="submit"
          :desabilitado="!novaPronta"
          data-testid="notas-registrar"
          :rotulo="t('pep.notas.registrar')"
        />
      </form>

      <label class="notas__filtro">
        <input v-model="mostrarTodas" type="checkbox" data-testid="notas-todas" />
        {{ t('pep.notas.mostrarTodas') }}
      </label>
      <p v-if="visiveis.length === 0">{{ t('pep.notas.nenhuma') }}</p>
      <article
        v-for="n in visiveis"
        :key="n.id"
        class="notas__item"
        :class="{ 'notas__item--fora': n.situacao !== 'ativa' }"
        :data-testid="`nota-${n.id}`"
      >
        <h3>
          {{ n.tipo.descricao }} ·
          <span :data-testid="`nota-situacao-${n.id}`">{{ t(`pep.notas.situacao.${n.situacao}`) }}</span>
        </h3>
        <p class="notas__corpo">{{ n.texto }}</p>
        <p class="notas__meta">
          {{ t('pep.notas.por', { autor: n.autor ?? '', quando: dataHoraBr(n.registradaEm) }) }}
          · {{ t(`pep.notas.visibilidades.${n.visibilidade}`) }}
          <span v-if="n.validaAte">
            · {{ t('pep.notas.validaAte', { quando: dataHoraBr(n.validaAte) }) }}</span
          >
        </p>
        <p v-if="n.motivoCancelamento">
          {{ t('pep.notas.motivoCancelada', { motivo: n.motivoCancelamento }) }}
        </p>
        <div v-if="podeEncerrar(n) || podeAutor(n)" class="notas__passo">
          <SanteBotao
            v-if="podeEncerrar(n)"
            variante="secundario"
            :data-testid="`nota-encerrar-${n.id}`"
            :rotulo="t('pep.notas.encerrar')"
            @acionar="encerrar(n)"
          />
          <template v-if="podeAutor(n) && n.situacao !== 'encerrada'">
            <label>
              {{ t('pep.notas.novaValidade') }}
              <input v-model="campos(n).data" type="date" :data-testid="`nota-data-${n.id}`" />
            </label>
            <SanteBotao
              variante="secundario"
              :desabilitado="!dataOk(n)"
              :data-testid="`nota-prorrogar-${n.id}`"
              :rotulo="t('pep.notas.prorrogar')"
              @acionar="prorrogar(n)"
            />
          </template>
          <template v-if="podeAutor(n)">
            <label>
              {{ t('pep.notas.motivo') }}
              <input
                v-model="campos(n).motivo"
                maxlength="500"
                :aria-invalid="campos(n).motivo.length > 0 && !motivoOk(n)"
                :data-testid="`nota-motivo-${n.id}`"
              />
            </label>
            <SanteBotao
              variante="secundario"
              :desabilitado="!motivoOk(n)"
              :data-testid="`nota-cancelar-${n.id}`"
              :rotulo="t('pep.notas.cancelar')"
              @acionar="cancelar(n)"
            />
          </template>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.notas__nova,
.notas__passo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.notas__texto {
  flex: 1 1 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.notas__restam--fim {
  font-weight: 600;
}
.notas__filtro {
  display: inline-flex;
  gap: var(--sgh-espaco-2);
  margin-block: var(--sgh-espaco-3);
}
.notas__item {
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-3);
}
.notas__item--fora {
  color: var(--sgh-texto-secundario);
}
.notas__corpo {
  white-space: pre-wrap;
}
.notas__meta {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
</style>
