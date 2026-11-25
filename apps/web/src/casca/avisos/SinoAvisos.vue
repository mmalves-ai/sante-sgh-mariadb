<script setup lang="ts">
// Central de avisos na barra superior (ficha do M27, seção 7; regras 6 e 8; cap-03 §3.2; cap-09 §9.9): o sino com o
// número de avisos novos e de mensagens não lidas; a lista abre na barra (novos, lidos, resolvidos), cada aviso com o
// link da tela que o resolve, "marcar como lido" e "resolver". Higiene de alertas (regra 6): só o risco grave
// (alergia, dose acima do limite, paciente errado) interrompe, uma vez por sessão do navegador; o resto fica na central.
// Tempo real (regra 8): o canal de eventos só diz "mudou" (depois do COMMIT) e o sino relê o estado gravado; sem o
// canal, relê a cada 15 s — a reconexão nunca perde aviso. Sem a permissão ou com a funcionalidade desligada, some.
import type { Aviso } from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteIcone } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import {
  CANAL_AVISOS,
  codigoDaRecusa,
  donoDaSessao,
  lerAvisos,
  lerCaixa,
  marcarAviso,
  novaChave,
} from '../../modulos/inicio/api-inicio.js';
import { pode } from '../sessao/pode.js';
import { usarSessao } from '../sessao/sessao.js';
import AvisosClinicosSino from './AvisosClinicosSino.vue';
import { darCienciaAvisoClinico, lerAvisosClinicos } from './api-avisos-clinicos.js';
import { avisosQueInterrompem, ordenarCentral, seloDoSino } from './avisos.js';
import { usarCanalAvisos } from './canal.js';

const { t } = useI18n();
const cliente = useQueryClient();
const roteador = useRouter();
const { sessao } = usarSessao();
const dono = computed(() => donoDaSessao(sessao.value));
const podeLer = computed(() => pode('acesso.aviso.ler') && !!sessao.value);
const podeResolver = computed(() => pode('acesso.aviso.resolver'));
const podeMensagens = computed(() => pode('acesso.mensagem.ler'));
const canal = usarCanalAvisos(
  CANAL_AVISOS,
  () => podeLer.value,
  () => {
    void cliente.invalidateQueries({ queryKey: ['avisos'] });
    void cliente.invalidateQueries({ queryKey: ['mensagens', 'caixa'] });
    void cliente.invalidateQueries({ queryKey: ['avisos-clinicos'] });
  },
);
const central = useQuery({
  queryKey: computed(() => ['avisos', dono.value]),
  queryFn: () => lerAvisos(),
  enabled: podeLer,
  retry: 0,
  refetchInterval: computed(() => canal.intervalo()),
});
const caixa = useQuery({
  queryKey: computed(() => ['mensagens', 'caixa', dono.value]),
  queryFn: () => lerCaixa(),
  enabled: podeMensagens,
  retry: 0,
  refetchInterval: computed(() => canal.intervalo()),
});
// F3.5 (05-SADT linha 10): os avisos clínicos de quem os recebe (sem o banco do cliente, 503: a seção some).
const clinicos = useQuery({
  queryKey: computed(() => ['avisos-clinicos', dono.value]),
  queryFn: () => lerAvisosClinicos(),
  enabled: podeLer,
  retry: 0,
  refetchInterval: computed(() => canal.intervalo()),
});
const listaClinicos = computed(() => clinicos.data.value?.avisos ?? []);
const cienciaEm = ref<number | null>(null);
async function ciente(id: number): Promise<void> {
  erro.value = null;
  cienciaEm.value = id;
  try {
    await darCienciaAvisoClinico(id, novaChave('aviso-clinico-ciente'));
    await cliente.invalidateQueries({ queryKey: ['avisos-clinicos'] });
  } catch {
    erro.value = t('trabalho.avisos.falhou');
  } finally {
    cienciaEm.value = null;
  }
}
const desligada = computed(() => codigoDaRecusa(central.error.value) === 'recurso-desligado');
const visivel = computed(() => podeLer.value && !desligada.value);
const naoLidas = computed(() => caixa.data.value?.naoLidas ?? 0);
const selo = computed(
  () => seloDoSino(central.data.value, naoLidas.value) + (clinicos.data.value?.novos ?? 0),
);
const lista = computed(() => ordenarCentral(central.data.value?.avisos ?? []));
const aberto = ref(false);
const erro = ref<string | null>(null);

// Interrupção do risco grave: uma vez por sessão do navegador (sessionStorage, protegido; sem ele, uma vez nesta aba).
const CHAVE_MOSTRADOS = 'sgh.avisos.mostrados.v1';
function lerMostrados(): Set<number> {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(CHAVE_MOSTRADOS) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []);
  } catch {
    return new Set();
  }
}
const mostrados = ref<Set<number>>(lerMostrados());
function lembrar(id: number): void {
  mostrados.value = new Set([...mostrados.value, id]);
  try {
    window.sessionStorage.setItem(CHAVE_MOSTRADOS, JSON.stringify([...mostrados.value].slice(-200)));
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
}
const interrompe = computed<Aviso | null>(
  () => avisosQueInterrompem(central.data.value?.avisos ?? [], mostrados.value)[0] ?? null,
);

async function mudar(a: Aviso, estado: 'lido' | 'resolvido'): Promise<void> {
  erro.value = null;
  try {
    await marcarAviso(a.id, estado, novaChave(`aviso-${estado}`));
    await cliente.invalidateQueries({ queryKey: ['avisos'] });
  } catch {
    erro.value = t('trabalho.avisos.falhou');
  }
}
async function abrir(a: Aviso): Promise<void> {
  aberto.value = false;
  if (a.estado === 'novo' && podeResolver.value) await mudar(a, 'lido');
  if (a.link) await roteador.push(a.link);
}
async function entendi(a: Aviso, ver: boolean): Promise<void> {
  lembrar(a.id);
  if (ver) await abrir(a);
}
const quando = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
</script>

<template>
  <div v-if="visivel" class="sino">
    <button
      type="button"
      class="barra__botao"
      :aria-expanded="aberto"
      aria-controls="central-avisos"
      :aria-label="selo > 0 ? t('trabalho.avisos.sinoN', { n: selo }) : t('trabalho.avisos.sino')"
      data-testid="sino"
      @click="aberto = !aberto"
    >
      <SanteIcone nome="sino" />
      <span v-if="selo > 0" class="sino__selo" data-testid="sino-selo" aria-hidden="true">{{
        selo > 99 ? '99+' : selo
      }}</span>
    </button>
    <div
      v-show="aberto"
      id="central-avisos"
      class="sino__painel"
      role="region"
      :aria-label="t('trabalho.avisos.titulo')"
      data-testid="central-avisos"
      @keydown.esc="aberto = false"
    >
      <h2 class="sino__titulo">{{ t('trabalho.avisos.titulo') }}</h2>
      <p v-if="naoLidas > 0">
        <RouterLink to="/mensagens" data-testid="sino-mensagens" @click="aberto = false">{{
          t('trabalho.avisos.naoLidas', { n: naoLidas })
        }}</RouterLink>
      </p>
      <p v-if="erro" role="alert">{{ erro }}</p>
      <AvisosClinicosSino
        :avisos="listaClinicos"
        :pode-ciencia="podeResolver"
        :ocupado="cienciaEm"
        @ciente="ciente"
        @abrir="aberto = false"
      />
      <p v-if="lista.length === 0 && listaClinicos.length === 0" class="secundario">
        {{ t('trabalho.avisos.vazio') }}
      </p>
      <ul v-else class="sino__lista">
        <li
          v-for="a in lista"
          :key="a.id"
          :class="[`g-${a.gravidade}`, `e-${a.estado}`]"
          :data-testid="`aviso-${a.id}`"
        >
          <p class="sino__linha">
            <strong>{{ t(`trabalho.avisos.gravidades.${a.gravidade}`) }}</strong>
            <span class="secundario"
              >· {{ t(`trabalho.avisos.estados.${a.estado}`) }} · {{ quando(a.criadoEm) }}</span
            >
          </p>
          <p class="sino__texto">{{ a.titulo }}</p>
          <div class="sino__acoes">
            <SanteBotao
              v-if="a.link"
              variante="texto"
              :rotulo="t('trabalho.avisos.abrir')"
              :data-testid="`aviso-abrir-${a.id}`"
              @acionar="abrir(a)"
            />
            <SanteBotao
              v-if="podeResolver && a.estado === 'novo'"
              variante="texto"
              :rotulo="t('trabalho.avisos.marcarLido')"
              :data-testid="`aviso-lido-${a.id}`"
              @acionar="mudar(a, 'lido')"
            />
            <SanteBotao
              v-if="podeResolver && a.estado !== 'resolvido'"
              variante="texto"
              :rotulo="t('trabalho.avisos.resolver')"
              :data-testid="`aviso-resolver-${a.id}`"
              @acionar="mudar(a, 'resolvido')"
            />
          </div>
        </li>
      </ul>
    </div>
    <SanteDialogo
      :visivel="interrompe !== null"
      :titulo="t('trabalho.avisos.interrupcao')"
      data-testid="aviso-interrupcao"
      @update:visivel="(v: boolean) => !v && interrompe && lembrar(interrompe.id)"
    >
      <template v-if="interrompe">
        <p data-testid="aviso-interrupcao-texto">{{ interrompe.titulo }}</p>
        <div class="sino__acoes">
          <SanteBotao
            v-if="interrompe.link"
            :rotulo="t('trabalho.avisos.verAgora')"
            data-testid="aviso-ver-agora"
            @acionar="entendi(interrompe, true)"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('trabalho.avisos.entendi')"
            data-testid="aviso-entendi"
            @acionar="entendi(interrompe, false)"
          />
        </div>
      </template>
    </SanteDialogo>
  </div>
</template>

<style scoped>
.sino {
  position: relative;
}
.barra__botao {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
  min-width: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  background: transparent;
  color: inherit;
  border: 1px solid currentColor;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}
.barra__botao:focus-visible {
  outline: 2px solid var(--sgh-primaria-texto);
  outline-offset: 2px;
}
.sino__selo {
  min-width: 1.25rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 700;
  text-align: center;
}
.sino__painel {
  position: absolute;
  right: 0;
  top: calc(100% + var(--sgh-espaco-1));
  z-index: 30;
  width: min(26rem, 90vw);
  max-height: 70vh;
  overflow: auto;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 6px;
}
.sino__titulo {
  margin: 0 0 var(--sgh-espaco-2);
  font-size: 1rem;
}
.sino__painel a {
  color: var(--sgh-link, var(--sgh-primaria));
}
.sino__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.sino__lista li {
  border-left: 4px solid var(--sgh-borda);
  padding-left: var(--sgh-espaco-2);
}
.sino__lista li.g-grave {
  border-left-color: var(--sgh-borda-forte);
}
.sino__lista li.e-resolvido {
  opacity: 0.8;
}
.sino__linha,
.sino__texto {
  margin: 0;
}
.sino__acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.secundario {
  color: var(--sgh-texto-secundario);
}
</style>
