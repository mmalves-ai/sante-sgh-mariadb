<script setup lang="ts">
// Modo plantão e passagem de turno (ficha do M25, seção 7 e regra 14): a nota SBAR de cada paciente da unidade e as
// pendências herdadas sugeridas (doses atrasadas e omitidas, cuidados não feitos, conflitos). Quem passa informa o
// login de quem recebe; a responsabilidade só passa com o aceite de quem recebe, na sessão dele.
import { PARTES_SBAR, PENDENCIAS_PLANTAO, type ParteSbar } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarPlantao,
  lerPlantao,
  novaChave,
  passarPlantao,
  responderPlantao,
} from '../api-enfermagem.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const { unidade, escolherUnidade, opcoesUnidade, gravacao, login } = usarEnfermagem();
const podePassar = computed(() => gravacao.data.value?.operacoes['passar']?.pode === true);
const podeAceitar = computed(() => gravacao.data.value?.operacoes['aceitar']?.pode === true);
const plantao = useQuery({
  queryKey: computed(() => ['enfermagem', 'plantao', unidade.value]),
  queryFn: () => lerPlantao(unidade.value),
  enabled: computed(() => !!unidade.value),
});
const PARTES = Object.keys(PARTES_SBAR) as ParteSbar[];
const notas = ref<Record<number, Record<ParteSbar, string>>>({});
watch(
  () => plantao.data.value?.sugestoes.pacientes,
  (ps) => {
    const n: Record<number, Record<ParteSbar, string>> = {};
    for (const p of ps ?? [])
      n[p.atendimento] = notas.value[p.atendimento] ?? {
        situacao: '',
        historia: '',
        avaliacao: '',
        recomendacao: '',
      };
    notas.value = n;
  },
  { immediate: true },
);
const recebedor = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function passar(): Promise<void> {
  const d = plantao.data.value;
  if (!d) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await passarPlantao(
      {
        unidade: d.unidade,
        turno: d.turno.nome,
        data: d.turno.inicio.slice(0, 10),
        recebedor: recebedor.value.trim(),
        notas: d.sugestoes.pacientes.map((p) => {
          const n = notas.value[p.atendimento]!;
          return {
            atendimento: p.atendimento,
            paciente: p.paciente,
            situacao: n.situacao.trim() || null,
            historia: n.historia.trim() || null,
            avaliacao: n.avaliacao.trim() || null,
            recomendacao: n.recomendacao.trim() || null,
            pendencias: p.pendencias.map((x) => ({
              tipo: x.tipo,
              descricao: x.descricao.slice(0, 200),
              horario: x.horario,
            })),
          };
        }),
      },
      novaChave('plantao'),
    );
    mensagem.value = r.mensagem;
    await plantao.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function responder(id: number, aceite: boolean): Promise<void> {
  erro.value = null;
  try {
    const r = await responderPlantao(id, aceite, null, novaChave(`aceite-${id}`));
    mensagem.value = r.mensagem;
    await plantao.refetch();
  } catch (x) {
    erro.value = x;
  }
}
const hora = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');
const minhaVez = (recebedorDa: string, situacao: string) =>
  situacao === 'aguardandoAceite' && recebedorDa.toUpperCase() === login.value.toUpperCase();
// W0-03: quem passou cancela, com o motivo, antes do aceite (o servidor devolve 409 depois do aceite).
const podeCancelar = (passadoPor: string, situacao: string) =>
  podePassar.value &&
  situacao === 'aguardandoAceite' &&
  passadoPor.toUpperCase() === login.value.toUpperCase();
const cancelando = ref<number | null>(null);
const dialogoCancelar = ref(false);
function abrirCancelar(id: number): void {
  cancelando.value = id;
  dialogoCancelar.value = true;
}
async function cancelar(d: DadosCorrecao): Promise<void> {
  const id = cancelando.value;
  if (id === null) return;
  const r = await cancelarPlantao(id, d.motivo, novaChave(`cancelar-plantao-${id}`));
  mensagem.value = r.mensagem;
  await plantao.refetch();
}
</script>

<template>
  <section class="tela-enf" aria-labelledby="pl-titulo" data-testid="tela-plantao">
    <h1 id="pl-titulo">{{ t('enfermagem.plantao.titulo') }}</h1>
    <p>{{ t('enfermagem.plantao.texto') }}</p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
    </div>
    <p v-if="mensagem" role="status" data-testid="pl-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <ErroEnfermagem v-if="plantao.isError.value" :erro="plantao.error.value" />
    <p v-else-if="!plantao.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else>
      <section aria-labelledby="pl-passagens">
        <h2 id="pl-passagens">{{ t('enfermagem.plantao.passagens') }}</h2>
        <p v-if="plantao.data.value.passagens.length === 0">{{ t('enfermagem.comum.nenhum') }}</p>
        <article
          v-for="p in plantao.data.value.passagens"
          :key="p.id"
          class="cartao"
          :data-testid="`passagem-${p.id}`"
          :data-situacao="p.situacao"
        >
          <p>
            <strong>{{ t(`enfermagem.plantao.situacoes.${p.situacao}`) }}</strong> ·
            {{
              t('enfermagem.plantao.passadoPor', {
                por: p.passadoPor,
                para: p.recebedor,
                quando: hora(p.passadoEm),
              })
            }}
          </p>
          <ul>
            <li v-for="n in p.notas" :key="n.atendimento">
              {{ n.pacienteNome ?? n.paciente }}:
              <span v-for="k in PARTES" :key="k"
                ><template v-if="n.partes[k]"> {{ PARTES_SBAR[k] }}: {{ n.partes[k] }}.</template></span
              >
              <span v-for="(x, i) in n.pendencias" :key="i" class="alerta">
                {{ PENDENCIAS_PLANTAO[x.tipo] }}: {{ x.descricao }}.</span
              >
            </li>
          </ul>
          <p v-if="p.cancelamento" class="secundario" :data-testid="`pl-cancelamento-${p.id}`">
            {{
              t('enfermagem.correcao.plantao.cancelada', {
                por: p.cancelamento.por,
                quando: hora(p.cancelamento.em),
                motivo: p.cancelamento.motivo,
              })
            }}
          </p>
          <p v-if="podeCancelar(p.passadoPor, p.situacao)" class="barra">
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.correcao.plantao.cancelar')"
              :data-testid="`pl-cancelar-${p.id}`"
              @acionar="abrirCancelar(p.id)"
            />
          </p>
          <p v-if="minhaVez(p.recebedor, p.situacao)" class="barra">
            <strong>{{ t('enfermagem.plantao.paraVoce') }}</strong>
            <SanteBotao
              :rotulo="t('enfermagem.plantao.aceitar')"
              :desabilitado="!podeAceitar"
              :data-testid="`pl-aceitar-${p.id}`"
              @acionar="responder(p.id, true)"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.plantao.recusar')"
              :desabilitado="!podeAceitar"
              @acionar="responder(p.id, false)"
            />
          </p>
        </article>
      </section>
      <form class="passar" data-testid="pl-form" @submit.prevent="passar">
        <h2>{{ t('enfermagem.plantao.passar') }}</h2>
        <article
          v-for="p in plantao.data.value.sugestoes.pacientes"
          :key="p.atendimento"
          class="cartao"
          :data-testid="`pl-paciente-${p.atendimento}`"
        >
          <h3>{{ p.leito ? t('enfermagem.comum.leito', { leito: p.leito }) : '' }} {{ p.nome }}</h3>
          <p v-if="p.pendencias.length === 0" class="secundario">
            {{ t('enfermagem.plantao.semPendencias') }}
          </p>
          <ul v-else :aria-label="t('enfermagem.plantao.pendencias')">
            <li v-for="(x, i) in p.pendencias" :key="i" class="alerta">
              {{ PENDENCIAS_PLANTAO[x.tipo] }}: {{ x.descricao }}
            </li>
          </ul>
          <div class="sbar">
            <span v-for="k in PARTES" :key="k" class="campo">
              <label :for="`sbar-${p.atendimento}-${k}`">{{ t(`enfermagem.partes.${k}`) }}</label>
              <textarea
                :id="`sbar-${p.atendimento}-${k}`"
                v-model="notas[p.atendimento]![k]"
                maxlength="1000"
                :data-testid="`sbar-${p.atendimento}-${k}`"
              ></textarea>
            </span>
          </div>
        </article>
        <span class="campo">
          <label for="pl-recebedor">{{ t('enfermagem.plantao.recebedor') }}</label>
          <input id="pl-recebedor" v-model="recebedor" autocomplete="off" data-testid="pl-recebedor" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('enfermagem.plantao.passar')"
          :desabilitado="
            !podePassar ||
            recebedor.trim().length < 2 ||
            plantao.data.value.sugestoes.pacientes.length === 0 ||
            ocupado
          "
          data-testid="pl-passar"
        />
      </form>
    </template>
    <DialogoCorrecao
      v-model:visivel="dialogoCancelar"
      :titulo="t('enfermagem.correcao.plantao.titulo')"
      :texto="t('enfermagem.correcao.plantao.texto')"
      :rotulo-confirmar="t('enfermagem.correcao.plantao.cancelar')"
      testid="pl-dialogo-cancelar"
      :executar="cancelar"
    />
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.passar {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.sbar {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2);
}
</style>
