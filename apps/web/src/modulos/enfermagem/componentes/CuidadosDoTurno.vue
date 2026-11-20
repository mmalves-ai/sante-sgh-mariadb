<script setup lang="ts">
// A prescrição de enfermagem na linha do tempo do turno (M45, etapa 4; ficha, seção 7: "Prescrição de enfermagem na
// linha do tempo", evolução da tela do M25): os cuidados prescritos pelo enfermeiro, aprazados pela grade da unidade,
// com a situação de cada horário e a checagem feito/não feito (o motivo do não feito é obrigatório) e o estorno
// justificado. O enfermeiro e o técnico checam; o servidor confere de novo.
import { SanteAlerta } from '@sgh/ui';
import type { HorarioCuidado } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { pode as podeSessao } from '../../../casca/sessao/pode.js';
import { novaChave, semRede } from '../api-enfermagem.js';
import { checarCuidado, estornarCuidado, lerCuidadosDoTurno } from '../api-sae.js';
import { enviarFilaCuidados, guardarCuidado, lerFilaCuidados } from '../fila-cuidados.js';
import { desvioDoRelogio, horaDoEstabelecimento } from '../usar-checagem.js';
import { usarEnfermagem } from '../usar-enfermagem.js';
import ErroEnfermagem from './ErroEnfermagem.vue';
import TabelaCuidados from './TabelaCuidados.vue';

const props = defineProps<{ unidade: string }>();
const { t } = useI18n();
const cuidados = useQuery({
  queryKey: computed(() => ['sae', 'turno', props.unidade]),
  queryFn: () => lerCuidadosDoTurno(props.unidade),
  enabled: computed(() => !!props.unidade),
});
const c = computed(() => cuidados.data.value);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const pode = (op: string) => c.value?.gravacao.operacoes[op]?.pode === true;
const ESTADOS = ['pendente', 'atrasada', 'feita', 'naoFeita'] as const;
const verReceita = podeSessao('enfermagem.prescricaoMedicamento.ler');
const verVacinas = podeSessao('enfermagem.vacina.ler');
// Aberta pelo item do menu "Prescrição de enfermagem aprazada e checada" (?secao=cuidados): a seção vem para a vista.
const rota = useRoute();
const raiz = ref<HTMLElement | null>(null);
watch(
  () => !!c.value,
  async (pronto) => {
    if (!pronto || rota.query['secao'] !== 'cuidados') return;
    await nextTick();
    raiz.value?.scrollIntoView?.({ block: 'start' });
  },
  { immediate: true },
);

async function executar(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
    await cuidados.refetch();
  }
}
// Sem rede (regra 8 do M25): o ato fica no cofre cifrado do aparelho, com a hora real e a chave, e vai na volta da rede.
const PRAZO_HORAS = 12;
const { dono } = usarEnfermagem();
const naFila = ref(0);
const online = ref(globalThis.navigator?.onLine !== false);
async function contarFila(): Promise<void> {
  naFila.value = dono.value ? (await lerFilaCuidados(dono.value, PRAZO_HORAS)).length : 0;
}
async function enviarFila(): Promise<void> {
  if (!dono.value) return;
  const r = await enviarFilaCuidados(
    dono.value,
    PRAZO_HORAS,
    (a) =>
      checarCuidado(
        a.atendimento,
        a.atividade,
        { previsto: a.previsto, feita: a.feita, motivo: a.motivo, horaReal: a.horaReal, origemOffline: true },
        undefined,
        a.chave,
      ),
    semRede,
  );
  naFila.value = r.resto.length;
  const recusado = r.resultados.find((x) => !x.ok);
  if (recusado && !recusado.ok) erro.value = recusado.erro;
  if (r.resultados.some((x) => x.ok))
    mensagem.value = t('enfermagem.cuidados.sincronizados', { n: r.resultados.filter((x) => x.ok).length });
  await cuidados.refetch();
}
const aoOnline = () => {
  online.value = true;
  void enviarFila();
};
const aoOffline = () => {
  online.value = false;
};
onMounted(() => {
  globalThis.addEventListener?.('online', aoOnline);
  globalThis.addEventListener?.('offline', aoOffline);
  void contarFila().then(() => (online.value && naFila.value > 0 ? enviarFila() : undefined));
});
onBeforeUnmount(() => {
  globalThis.removeEventListener?.('online', aoOnline);
  globalThis.removeEventListener?.('offline', aoOffline);
});
async function guardarSemRede(h: HorarioCuidado, feita: boolean, motivo: string | null): Promise<void> {
  if (!dono.value) return;
  const desvio = c.value ? desvioDoRelogio(c.value.agora) : 0;
  const fila = await guardarCuidado(
    dono.value,
    {
      chave: novaChave(`cuidado-${h.atividade}`),
      atendimento: h.atendimento,
      atividade: h.atividade,
      previsto: h.previsto,
      feita,
      motivo,
      horaReal: horaDoEstabelecimento(desvio),
      rotulo: h.descricao,
    },
    PRAZO_HORAS,
  );
  naFila.value = fila.length;
  mensagem.value = t('enfermagem.cuidados.guardado', { n: fila.length });
}
function checar(h: HorarioCuidado, feita: boolean, motivo: string | null): void {
  if (!online.value) {
    void guardarSemRede(h, feita, motivo);
    return;
  }
  void (async () => {
    erro.value = null;
    mensagem.value = null;
    ocupado.value = true;
    try {
      mensagem.value = (
        await checarCuidado(h.atendimento, h.atividade, { previsto: h.previsto, feita, motivo })
      ).mensagem;
    } catch (x) {
      if (semRede(x)) {
        online.value = false;
        await guardarSemRede(h, feita, motivo);
      } else erro.value = x;
    } finally {
      ocupado.value = false;
      if (online.value) await cuidados.refetch();
    }
  })();
}
function estornar(checagem: number, motivo: string): void {
  const h = c.value?.horarios.find((x) => x.checagem?.id === checagem);
  if (h) void executar(() => estornarCuidado(h.atendimento, checagem, motivo));
}
</script>

<template>
  <section id="cuidados" ref="raiz" aria-labelledby="cuidados-titulo" data-testid="secao-cuidados">
    <h2 id="cuidados-titulo">{{ t('enfermagem.cuidados.titulo') }}</h2>
    <p>{{ t('enfermagem.cuidados.texto') }}</p>
    <p v-if="verReceita">
      <RouterLink to="/enfermagem/prescricao-medicamento" data-testid="cuidados-receita">{{
        t('enfermagem.cuidados.receita')
      }}</RouterLink>
    </p>
    <p v-if="verVacinas">
      <RouterLink to="/enfermagem/vacinas" data-testid="cuidados-vacinas">{{
        t('enfermagem.cuidados.vacinas')
      }}</RouterLink>
    </p>
    <ErroEnfermagem v-if="cuidados.isError.value" :erro="cuidados.error.value" />
    <p v-else-if="!c" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!c.gravacao.ligada"
        variante="aviso"
        :texto="t('enfermagem.sae.desligado', { motivo: c.gravacao.motivo ?? '' })"
      />
      <dl class="resumo" :aria-label="t('enfermagem.cuidados.resumo')" data-testid="cuidados-resumo">
        <div v-for="e in ESTADOS" :key="e">
          <dt>{{ t(`enfermagem.cuidados.estados.${e}`) }}</dt>
          <dd :data-testid="`cuidados-resumo-${e}`">{{ c.resumo[e] }}</dd>
        </div>
      </dl>
      <p v-if="c.cortada" role="note">{{ t('enfermagem.cuidados.cortada') }}</p>
      <p v-if="naFila > 0" role="status" data-testid="cuidados-fila">
        {{ t('enfermagem.cuidados.naFila', { n: naFila }) }}
      </p>
      <p v-if="mensagem" role="status" data-testid="cuidados-mensagem">{{ mensagem }}</p>
      <ErroEnfermagem v-if="erro" :erro="erro" />
      <p v-if="c.horarios.length === 0">{{ t('enfermagem.cuidados.vazio') }}</p>
      <TabelaCuidados
        v-else
        :horarios="c.horarios"
        :pode-checar="pode('checar')"
        :pode-estornar="pode('estornar')"
        :ocupado="ocupado"
        prefixo="turno"
        mostrar-paciente
        @checar="checar"
        @estornar="estornar"
      />
    </template>
  </section>
</template>
