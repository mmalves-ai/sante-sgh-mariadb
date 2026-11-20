<script setup lang="ts">
// Agendas oferecidas no portal do paciente (M50, etapa 2; ficha, seção 7: `/agenda/online`, `agenda.online.configurar`;
// `agenda.configurarAgendaOnline`). A lista das agendas de consulta e de exame com a situação no portal; ao configurar:
// oferecer ou retirar, os convênios e os serviços (vazio = os da própria agenda), a antecedência, o horizonte, o prazo
// do cancelamento pelo paciente, o pré-check-in e o valor do particular cobrado no portal. A disponibilidade fica só no
// novo (a agenda não muda); com a funcionalidade desligada no estabelecimento, nada aparece para o paciente.
// A lista (centenas de agendas) tem busca pelo procedimento ou pelo profissional; os convênios e os serviços da agenda
// só são lidos ao abrir a agenda, numa seleção múltipla com busca (ADR 0027).
import type { ConfigAgendaOnlineDetalhe, ConfigAgendaOnlineItem } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteMarcadores, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import {
  configAgendaOnline,
  detalheConfigAgendaOnline,
  gravarConfigAgendaOnline,
} from '../api-portal-agenda.js';

const { t } = useI18n();
const versao = ref(0);
const lista = useQuery({
  queryKey: computed(() => ['agenda-online', versao.value]),
  queryFn: () => configAgendaOnline(),
});
const filtroTipo = ref<'todas' | 'consulta' | 'exame'>('todas');
const opcoesTipo = computed(() =>
  (['todas', 'consulta', 'exame'] as const).map((v) => ({
    valor: v,
    rotulo: v === 'todas' ? t('portal.interno.vinculos.todas') : t(`portal.agendar.tipos.${v}`),
  })),
);
const busca = ref('');
const semAcento = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
/** Todas as palavras da busca no procedimento, no profissional ou no nome da agenda (sem acento, sem caixa). */
const casa = (i: ConfigAgendaOnlineItem) => {
  const palavras = semAcento(busca.value).split(/\s+/).filter(Boolean);
  const alvo = semAcento(`${i.procedimento} ${i.profissional ?? ''} ${i.nomeAgenda}`);
  return palavras.every((p) => alvo.includes(p));
};
const itens = computed(() =>
  (lista.data.value?.itens ?? []).filter(
    (x) => (filtroTipo.value === 'todas' || x.tipo === filtroTipo.value) && casa(x),
  ),
);
const aberto = ref<ConfigAgendaOnlineDetalhe | null>(null);
const form = ref({
  ativa: true,
  convenios: [] as number[],
  servicos: [] as number[],
  antecedenciaHoras: '24',
  horizonteDias: '30',
  cancelaAteHoras: '24',
  precheckin: true,
  teleconsulta: false,
  valor: '',
});
const opcoesConvenio = computed(() =>
  (aberto.value?.conveniosDaAgenda ?? []).map((c) => ({ valor: c.codigo, rotulo: c.nome })),
);
const opcoesServico = computed(() =>
  (aberto.value?.servicosDaAgenda ?? []).map((c) => ({ valor: c.codigo, rotulo: c.nome })),
);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);

function preencher(d: ConfigAgendaOnlineDetalhe): void {
  aberto.value = d;
  const c = d.config;
  form.value = {
    ativa: c ? c.ativa : true,
    convenios: c ? [...c.convenios] : [],
    servicos: c ? [...c.servicos] : [],
    antecedenciaHoras: String(c?.antecedenciaHoras ?? 24),
    horizonteDias: String(c?.horizonteDias ?? 30),
    cancelaAteHoras: String(c?.cancelaAteHoras ?? 24),
    precheckin: c?.precheckin ?? true,
    teleconsulta: c?.teleconsulta ?? false,
    valor: c?.valorParticular !== null && c?.valorParticular !== undefined ? String(c.valorParticular) : '',
  };
}

async function abrir(i: ConfigAgendaOnlineItem): Promise<void> {
  erro.value = null;
  feito.value = null;
  try {
    preencher(await detalheConfigAgendaOnline(i.tipo, i.agenda));
  } catch (x) {
    erro.value = x;
  }
}
/** Número inteiro digitado (o servidor confere os limites e devolve a recusa traduzida). */
const inteiro = (v: string) => (/^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

async function gravar(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    const valor = form.value.valor.trim() ? Number(form.value.valor.replace(',', '.')) : null;
    const r = await gravarConfigAgendaOnline({
      tipo: aberto.value.tipo,
      agenda: aberto.value.agenda,
      ativa: form.value.ativa,
      convenios: form.value.convenios,
      servicos: form.value.servicos,
      antecedenciaHoras: inteiro(form.value.antecedenciaHoras),
      horizonteDias: inteiro(form.value.horizonteDias),
      cancelaAteHoras: inteiro(form.value.cancelaAteHoras),
      precheckin: form.value.precheckin,
      teleconsulta: aberto.value.tipo === 'consulta' && form.value.teleconsulta,
      valorParticular: valor,
      versao: aberto.value.config?.versao ?? null,
    });
    feito.value = t('portal.interno.online.gravado');
    const atual = r.itens.find((x) => x.tipo === aberto.value?.tipo && x.agenda === aberto.value?.agenda);
    if (atual && aberto.value) aberto.value = { ...aberto.value, config: atual.config };
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}
const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quando = (s: string | null) =>
  s ? `${s.slice(0, 10).split('-').reverse().join('/')} ${s.slice(11, 16)}` : '';
</script>

<template>
  <section class="tela" aria-labelledby="online-titulo" data-testid="tela-agenda-online">
    <h1 id="online-titulo">{{ t('portal.interno.online.titulo') }}</h1>
    <p>{{ t('portal.interno.online.ajuda') }}</p>
    <RouterLink to="/recepcao/pre-checkin">{{ t('portal.interno.online.precheckinLink') }}</RouterLink>
    <ErroPortal v-if="lista.isError.value" :erro="lista.error.value" />
    <template v-else-if="lista.data.value">
      <SanteAlerta
        v-if="!lista.data.value.portalLigado"
        :texto="t('portal.interno.online.desligado')"
        variante="aviso"
      />
      <div class="conf-busca">
        <SanteCampoTexto
          v-model="busca"
          :rotulo="t('portal.interno.online.buscar')"
          :max-bytes="60"
          data-testid="online-busca"
        />
        <SanteSelecao
          v-model="filtroTipo"
          :rotulo="t('portal.interno.online.tipo')"
          :opcoes="opcoesTipo"
          data-testid="online-filtro"
        />
      </div>
      <p role="status">{{ t('portal.interno.online.contagem', { n: itens.length }, itens.length) }}</p>
      <table class="conf-tabela" data-testid="online-lista">
        <caption>
          {{
            t('portal.interno.online.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('portal.interno.online.agenda') }}</th>
            <th scope="col">{{ t('portal.interno.online.tipo') }}</th>
            <th scope="col">{{ t('portal.interno.online.situacao') }}</th>
            <th scope="col">{{ t('portal.interno.vinculos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itens" :key="`${i.tipo}-${i.agenda}`">
            <td>
              {{ i.procedimento }}<span v-if="i.profissional"> · {{ i.profissional }}</span>
              <span v-if="!i.agendaAtiva"> · {{ t('portal.interno.online.inativa') }}</span>
            </td>
            <td>{{ t(`portal.agendar.tipos.${i.tipo}`) }}</td>
            <td>
              {{
                i.config
                  ? i.config.ativa
                    ? t('portal.interno.online.sim')
                    : t('portal.interno.online.nao')
                  : t('portal.interno.online.naoConfigurada')
              }}
              <span v-if="i.config?.valorParticular"> · {{ dinheiro(i.config.valorParticular) }}</span>
            </td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('portal.interno.online.configurar')"
                :data-testid="`online-abrir-${i.tipo}-${i.agenda}`"
                @acionar="abrir(i)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <p v-else role="status">{{ t('portal.carregando') }}</p>
    <SanteAlerta v-if="feito" :texto="feito" variante="info" anunciar data-testid="online-feito" />
    <ErroPortal v-if="erro" :erro="erro" />
    <section v-if="aberto" class="conf-detalhe" aria-labelledby="online-detalhe" data-testid="online-detalhe">
      <h2 id="online-detalhe">
        {{ aberto.procedimento }}<span v-if="aberto.profissional"> · {{ aberto.profissional }}</span>
      </h2>
      <p v-if="aberto.config">
        {{
          t('portal.interno.online.alterado', {
            quem: aberto.config.alteradoPor,
            quando: quando(aberto.config.alteradoEm),
          })
        }}
      </p>
      <!-- W0-10: o botão "Gravar" (tipo submit) já grava pelo @acionar; o submit do form só se previne (antes gravava
           duas vezes e a segunda voltava "alterado por outra pessoa", achado pelo E2E da remarcação do exame). -->
      <form class="form" @submit.prevent>
        <label
          ><input v-model="form.ativa" type="checkbox" data-testid="online-ativa" />
          {{ t('portal.interno.online.ativa') }}</label
        >
        <SanteMarcadores
          v-model="form.convenios"
          :legenda="t('portal.interno.online.convenios')"
          :opcoes="opcoesConvenio"
          data-testid="online-convenios"
        />
        <SanteMarcadores
          v-model="form.servicos"
          :legenda="t('portal.interno.online.servicos')"
          :opcoes="opcoesServico"
          data-testid="online-servicos"
        />
        <SanteCampoTexto
          id="online-antecedencia"
          v-model="form.antecedenciaHoras"
          :rotulo="t('portal.interno.online.antecedencia')"
          :max-bytes="3"
        />
        <SanteCampoTexto
          id="online-horizonte"
          v-model="form.horizonteDias"
          :rotulo="t('portal.interno.online.horizonte')"
          :max-bytes="3"
        />
        <SanteCampoTexto
          id="online-cancela"
          v-model="form.cancelaAteHoras"
          :rotulo="t('portal.interno.online.cancelaAte')"
          :max-bytes="3"
        />
        <label
          ><input v-model="form.precheckin" type="checkbox" data-testid="online-precheckin" />
          {{ t('portal.interno.online.precheckin') }}</label
        >
        <label v-if="aberto.tipo === 'consulta'"
          ><input v-model="form.teleconsulta" type="checkbox" data-testid="online-teleconsulta" />
          {{ t('portal.interno.online.teleconsulta') }}</label
        >
        <SanteCampoTexto
          id="online-valor"
          v-model="form.valor"
          :rotulo="t('portal.interno.online.valor')"
          :max-bytes="9"
          data-testid="online-valor"
        />
        <SanteBotao
          v-if="lista.data.value?.podeConfigurar"
          tipo="submit"
          :rotulo="t('portal.interno.online.gravar')"
          data-testid="online-gravar"
          @acionar="gravar"
        />
      </form>
    </section>
  </section>
</template>

<style scoped>
.conf-tabela {
  border-collapse: collapse;
  width: 100%;
}
.conf-tabela th,
.conf-tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.conf-detalhe,
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-3);
}
.conf-busca {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
}
</style>
