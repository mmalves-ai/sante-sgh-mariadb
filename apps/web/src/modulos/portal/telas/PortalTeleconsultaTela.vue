<script setup lang="ts">
// Portal do paciente: a sala de espera virtual da teleconsulta (M50, etapa 4; ficha, seção 7, `/paciente/teleconsulta/:id`;
// regra 7, TELE-02). O paciente lê e aceita o termo vigente e informa de onde participa (estado, cidade e o tipo de
// lugar) antes de o médico iniciar; na espera, a tela relê a situação; quando o médico abre a sala, o paciente entra por
// aqui. Fora de produção, a sala é a do provedor simulado (nada sai do computador).
import {
  type LocalPaciente,
  TEXTO_TERMO_TELECONSULTA,
  TIPOS_LOCAL_PACIENTE,
  type TeleconsultaDoPortal,
  UFS,
  VERSAO_TERMO_TELECONSULTA,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import ErroPortal from '../componentes/ErroPortal.vue';
import PortalCasca from '../componentes/PortalCasca.vue';
import { entrarNaSala, entrarSalaEspera, teleconsultaDoPortal } from '../api-portal-teleconsulta.js';

const { t } = useI18n();
const rota = useRoute();
const id = computed(() => Number(rota.params['id'] ?? 0));
const pronto = ref(false);
const versao = ref(0);
const t1 = useQuery({
  queryKey: computed(() => ['portal-paciente', 'teleconsulta', id.value, versao.value]),
  queryFn: () => teleconsultaDoPortal(id.value),
  enabled: pronto,
  // Na espera, relê a cada 10 segundos (o médico abre a sala).
  refetchInterval: (q) => {
    const s = (q.state.data as TeleconsultaDoPortal | undefined)?.situacao;
    return s === 'aguardando' || s === 'agendada' || s === 'sala-aberta' ? 10_000 : false;
  },
  staleTime: 0,
});
const dados = computed(() => t1.data.value ?? null);

const aceito = ref(false);
const uf = ref<string>('');
const municipio = ref('');
const tipoLocal = ref<string>('residencia');
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const naSala = ref(false);
watch(dados, (d) => {
  if (!d?.local || uf.value) return;
  uf.value = d.local.uf;
  municipio.value = d.local.municipio;
  tipoLocal.value = d.local.tipo;
});
const opcoesUf = computed(() => [{ valor: '', rotulo: '—' }, ...UFS.map((u) => ({ valor: u, rotulo: u }))]);
const opcoesTipo = computed(() =>
  TIPOS_LOCAL_PACIENTE.map((x) => ({ valor: x, rotulo: t(`portal.teleconsulta.sala.tipos.${x}`) })),
);
const dia = (d: string) => d.split('-').reverse().join('/');
const hora = (h: string) => `${h.slice(0, 2)}:${h.slice(2, 4)}`;
const instante = (s: string) => `${dia(s.slice(0, 10))} ${s.slice(11, 16)}`;
const aberta = computed(
  () => dados.value?.situacao === 'sala-aberta' || dados.value?.situacao === 'em-andamento',
);
const podeAjustar = computed(
  () =>
    !!dados.value?.podeEntrar &&
    (dados.value.situacao === 'agendada' || dados.value.situacao === 'aguardando'),
);
const salaSimulada = computed(() => {
  const s = dados.value?.sala;
  if (!s || s.provedor !== 'simulado') return null;
  return s.endereco.split(':')[1] ?? '';
});

async function esperar(): Promise<void> {
  erro.value = null;
  aviso.value = null;
  if (!aceito.value) {
    aviso.value = t('portal.teleconsulta.sala.faltaTermo');
    return;
  }
  if (!uf.value || municipio.value.trim().length < 2) {
    aviso.value = t('portal.teleconsulta.sala.faltaLocal');
    return;
  }
  try {
    await entrarSalaEspera(id.value, {
      termo: VERSAO_TERMO_TELECONSULTA,
      aceito: true,
      local: { uf: uf.value, municipio: municipio.value, tipo: tipoLocal.value } as LocalPaciente,
    });
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}

async function entrar(): Promise<void> {
  erro.value = null;
  try {
    await entrarNaSala(id.value);
    naSala.value = true;
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <PortalCasca
    :titulo="t('portal.teleconsulta.sala.titulo')"
    @sessao="() => (pronto = true)"
    @trocou="() => versao++"
  >
    <ErroPortal v-if="t1.isError.value" :erro="t1.error.value" />
    <template v-else-if="dados">
      <section class="portal-painel" aria-labelledby="tele-quando" data-testid="pac-tele-sala">
        <h2 id="tele-quando">
          {{ t('portal.teleconsulta.quando', { dia: dia(dados.data), hora: hora(dados.hora) }) }} ·
          {{ dados.agenda }}
        </h2>
        <p data-testid="pac-tele-situacao">{{ t(`portal.teleconsulta.situacoes.${dados.situacao}`) }}</p>
        <ErroPortal v-if="erro" :erro="erro" />
        <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
        <SanteAlerta
          v-if="dados.situacao === 'encerrada'"
          :texto="t('portal.teleconsulta.sala.encerrada')"
          variante="info"
        />
        <SanteAlerta
          v-else-if="dados.situacao === 'cancelada'"
          :texto="t('portal.teleconsulta.sala.cancelada')"
          variante="info"
        />
        <SanteAlerta
          v-else-if="!dados.salaEspera.aberta && !aberta"
          :texto="
            dados.salaEspera.motivo ??
            t('portal.teleconsulta.sala.abreEm', { quando: instante(dados.salaEspera.abreEm) })
          "
          variante="info"
          data-testid="pac-tele-fechada"
        />
      </section>

      <section
        v-if="podeAjustar"
        class="portal-painel"
        aria-labelledby="tele-termo"
        data-testid="pac-tele-termo"
      >
        <h2 id="tele-termo">{{ t('portal.teleconsulta.sala.termo') }}</h2>
        <p v-for="(p, i) in TEXTO_TERMO_TELECONSULTA" :key="i">{{ p }}</p>
        <p v-if="dados.termo" data-testid="pac-tele-termo-aceito">
          {{ t('portal.teleconsulta.sala.aceitoEm', { quando: instante(dados.termo.aceitoEm) }) }}
        </p>
        <label class="pac-termo"
          ><input v-model="aceito" type="checkbox" data-testid="pac-tele-aceito" />
          {{ t('portal.teleconsulta.sala.aceito', { versao: VERSAO_TERMO_TELECONSULTA }) }}</label
        >
        <fieldset class="pac-local">
          <legend>{{ t('portal.teleconsulta.sala.local') }}</legend>
          <SanteSelecao
            v-model="uf"
            :rotulo="t('portal.teleconsulta.sala.uf')"
            :opcoes="opcoesUf"
            :busca="true"
            data-testid="pac-tele-uf"
          />
          <SanteCampoTexto
            id="pac-tele-municipio"
            v-model="municipio"
            :rotulo="t('portal.teleconsulta.sala.municipio')"
            :max-bytes="60"
            data-testid="pac-tele-municipio"
          />
          <SanteSelecao
            v-model="tipoLocal"
            :rotulo="t('portal.teleconsulta.sala.tipoLocal')"
            :opcoes="opcoesTipo"
            data-testid="pac-tele-tipo-local"
          />
        </fieldset>
        <SanteBotao
          :rotulo="
            dados.termo ? t('portal.teleconsulta.sala.atualizar') : t('portal.teleconsulta.sala.entrarEspera')
          "
          data-testid="pac-tele-esperar"
          @acionar="esperar"
        />
      </section>

      <section v-if="dados.situacao === 'aguardando'" class="portal-painel" data-testid="pac-tele-na-espera">
        <SanteAlerta :texto="t('portal.teleconsulta.sala.naEspera')" variante="info" anunciar />
      </section>

      <section
        v-if="aberta && dados.sala"
        class="portal-painel"
        aria-labelledby="tele-sala"
        data-testid="pac-tele-aberta"
      >
        <h2 id="tele-sala">{{ t('portal.teleconsulta.sala.salaAberta') }}</h2>
        <SanteBotao
          v-if="!naSala"
          :rotulo="t('portal.teleconsulta.sala.entrarSala')"
          data-testid="pac-tele-entrar"
          @acionar="entrar"
        />
        <p
          v-if="naSala && salaSimulada !== null"
          class="pac-simulada"
          role="status"
          data-testid="pac-tele-simulada"
        >
          {{ t('portal.teleconsulta.sala.simulada', { sala: salaSimulada }) }}
        </p>
      </section>
      <RouterLink :to="{ name: 'portal.teleconsultas' }">{{
        t('portal.teleconsulta.sala.voltar')
      }}</RouterLink>
    </template>
    <p v-else role="status">{{ t('portal.carregando') }}</p>
  </PortalCasca>
</template>

<style scoped>
.pac-local {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-end;
  border: 0;
  padding: 0;
}
.pac-simulada {
  padding: var(--sgh-espaco-3);
  border: 1px dashed var(--sgh-borda);
}
</style>
