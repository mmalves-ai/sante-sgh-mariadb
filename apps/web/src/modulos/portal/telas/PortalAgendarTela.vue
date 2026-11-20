<script setup lang="ts">
// Portal do paciente: agendar (M50, etapa 2; ficha, seção 7 e regra 3). Os agendamentos do titular escolhido (com o
// pré-check-in, o pagamento e a pesquisa quando cabem), a marcação nas agendas liberadas no portal (tipo, especialidade
// ou exame, convênio e os horários livres) e o cancelamento e a remarcação até o prazo da agenda. Se o horário acabou
// de ser ocupado por outro canal, a tela mostra o próximo livre da mesma agenda para marcar com um toque.
import type {
  AgendamentoPortal,
  HorarioPortal,
  ModalidadeMarcacao,
  ResultadoAgendamentoPortal,
  SessaoContaPortal,
  TipoAgendaOnline,
} from '@sgh/contratos';
import { MOTIVOS_CANCELAMENTO_PORTAL } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ErroPortal from '../componentes/ErroPortal.vue';
import PortalCasca from '../componentes/PortalCasca.vue';
import {
  agendarPortal,
  cancelarPortal,
  horariosPortal,
  meusAgendamentos,
  opcoesAgendar,
  remarcarPortal,
} from '../api-portal-agenda.js';

const { t } = useI18n();
const roteador = useRouter();
const sessao = ref<SessaoContaPortal | null>(null);
const versao = ref(0);
const podeAgendar = computed(() => sessao.value?.ativo.escopos.includes('agendamentos') ?? false);
const lista = useQuery({
  queryKey: computed(() => [
    'portal-paciente',
    'agendamentos',
    versao.value,
    sessao.value?.ativo.vinculo ?? '',
  ]),
  queryFn: () => meusAgendamentos(),
  // O que muda em outra tela (o pagamento, a chegada, a conferência) aparece ao voltar: relê sempre ao montar.
  refetchOnMount: 'always',
  staleTime: 0,
  enabled: podeAgendar,
});

const tipo = ref<TipoAgendaOnline>('consulta');
// M50, etapa 4: a modalidade (presencial ou teleconsulta) nas agendas de consulta que oferecem a teleconsulta.
const modalidade = ref<ModalidadeMarcacao>('presencial');
const servico = ref<string>('');
const convenio = ref<string>('');
const opcoes = useQuery({
  queryKey: computed(() => [
    'portal-paciente',
    'agenda-opcoes',
    tipo.value,
    sessao.value?.ativo.vinculo ?? '',
  ]),
  queryFn: () => opcoesAgendar(tipo.value),
  enabled: podeAgendar,
});
watch(tipo, () => {
  servico.value = '';
  convenio.value = '';
  horarios.value = null;
  modalidade.value = 'presencial';
});
watch(modalidade, () => {
  horarios.value = null;
  escolhido.value = null;
});
const ofereceTeleconsulta = computed(
  () => tipo.value === 'consulta' && (opcoes.data.value?.agendas ?? []).some((a) => a.teleconsulta),
);
const opcoesModalidade = computed(() =>
  (['presencial', 'teleconsulta'] as const).map((v) => ({
    valor: v,
    rotulo: t(`portal.agendar.modalidades.${v}`),
  })),
);
const opcoesTipo = computed(() =>
  (['consulta', 'exame'] as const).map((v) => ({ valor: v, rotulo: t(`portal.agendar.tipos.${v}`) })),
);
const opcoesServico = computed(() => [
  { valor: '', rotulo: t('portal.agendar.qualquer') },
  ...(opcoes.data.value?.servicos ?? []).map((s) => ({ valor: String(s.codigo), rotulo: s.nome })),
]);
const opcoesConvenio = computed(() =>
  (opcoes.data.value?.convenios ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
);

const horarios = ref<{ itens: HorarioPortal[]; truncado: boolean } | null>(null);
const escolhido = ref<HorarioPortal | null>(null);
const remarcando = ref<AgendamentoPortal | null>(null);
const resultado = ref<ResultadoAgendamentoPortal | null>(null);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const motivo = ref<string>(MOTIVOS_CANCELAMENTO_PORTAL[0].codigo);
// W0-10: o motivo da remarcação (a mesma lista do cancelamento; o padrão é "vou marcar outra data").
const motivoRemarcar = ref<string>('PAC-OUTRA-DATA');
const opcoesMotivo = computed(() =>
  MOTIVOS_CANCELAMENTO_PORTAL.map((m) => ({
    valor: m.codigo,
    rotulo: t(`portal.agendar.motivos.${m.codigo}`),
  })),
);

const dia = (d: string) => d.split('-').reverse().join('/');
const hora = (h: string) => `${h.slice(0, 2)}:${h.slice(2, 4)}`;
const quando = (x: { data: string; hora: string }) => `${dia(x.data)} ${hora(x.hora)}`;
const porDia = computed(() => {
  const m = new Map<string, HorarioPortal[]>();
  for (const h of horarios.value?.itens ?? []) m.set(h.data, [...(m.get(h.data) ?? []), h]);
  return [...m.entries()];
});
const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function buscar(): Promise<void> {
  erro.value = null;
  resultado.value = null;
  escolhido.value = null;
  if (!convenio.value) {
    aviso.value = t('portal.agendar.escolhaConvenio');
    return;
  }
  aviso.value = null;
  try {
    horarios.value = await horariosPortal({
      tipo: tipo.value,
      convenio: Number(convenio.value),
      servico: servico.value ? Number(servico.value) : null,
      agenda: null,
      de: null,
      modalidade: tipo.value === 'consulta' ? modalidade.value : 'presencial',
    });
  } catch (x) {
    erro.value = x;
  }
}

async function marcar(h: HorarioPortal): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    const r = remarcando.value
      ? await remarcarPortal(
          remarcando.value,
          { agenda: h.agenda, data: h.data, hora: h.hora },
          motivoRemarcar.value,
        )
      : await agendarPortal({
          tipo: tipo.value,
          agenda: h.agenda,
          data: h.data,
          hora: h.hora,
          convenio: Number(convenio.value),
          servico: tipo.value === 'exame' && servico.value ? Number(servico.value) : null,
          modalidade: tipo.value === 'consulta' ? modalidade.value : 'presencial',
        });
    resultado.value = r;
    if (r.ok) {
      aviso.value = remarcando.value
        ? t('portal.agendar.remarcado', { quando: quando(h) })
        : modalidade.value === 'teleconsulta' && tipo.value === 'consulta'
          ? t('portal.agendar.marcadoTele', { quando: quando(h) })
          : t('portal.agendar.marcado', { quando: quando(h) });
      remarcando.value = null;
      horarios.value = null;
      escolhido.value = null;
      versao.value++;
    }
  } catch (x) {
    erro.value = x;
  }
}

async function cancelar(a: AgendamentoPortal): Promise<void> {
  erro.value = null;
  try {
    await cancelarPortal(a, motivo.value);
    aviso.value = t('portal.agendar.cancelado');
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}

function remarcar(a: AgendamentoPortal): void {
  remarcando.value = a;
  tipo.value = a.tipo;
  motivoRemarcar.value = 'PAC-OUTRA-DATA';
  aviso.value = t('portal.agendar.remarcarAjuda');
}

function trocou(s: SessaoContaPortal): void {
  sessao.value = s;
  horarios.value = null;
  resultado.value = null;
  versao.value++;
}
</script>

<template>
  <PortalCasca :titulo="t('portal.agendar.titulo')" @sessao="(s) => (sessao = s)" @trocou="trocou">
    <p v-if="!podeAgendar">{{ t('portal.recusas.sem-escopo') }}</p>
    <template v-else>
      <ErroPortal v-if="erro" :erro="erro" />
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="pac-agenda-aviso" />
      <section class="portal-painel" aria-labelledby="pac-meus" data-testid="pac-meus-agendamentos">
        <h2 id="pac-meus">{{ t('portal.agendar.meus') }}</h2>
        <ErroPortal v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="lista.data.value && lista.data.value.itens.length === 0">
          {{ t('portal.agendar.nenhumAgendamento') }}
        </p>
        <table v-else-if="lista.data.value" class="portal-tabela">
          <caption>
            {{
              t('portal.agendar.meus')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portal.agendar.colunas.quando') }}</th>
              <th scope="col">{{ t('portal.agendar.colunas.oQue') }}</th>
              <th scope="col">{{ t('portal.agendar.colunas.situacao') }}</th>
              <th scope="col">{{ t('portal.agendar.colunas.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in lista.data.value.itens"
              :key="`${a.tipo}-${a.id}`"
              :data-testid="`pac-ag-${a.tipo}-${a.id}`"
            >
              <td>{{ quando(a) }}</td>
              <td>
                {{ a.procedimento
                }}<span v-if="a.profissional" class="portal-secundario"> · {{ a.profissional }}</span>
                <span v-if="a.peloPortal" class="portal-secundario">
                  · {{ t('portal.agendar.peloPortal') }}</span
                >
                <span v-if="a.teleconsulta" class="portal-secundario" :data-testid="`pac-tele-${a.id}`">
                  · {{ t('portal.agendar.modalidades.teleconsulta') }}</span
                >
              </td>
              <td>
                {{ t(`portal.agendar.situacoes.${a.situacao}`) }}
                <span v-if="a.precheckin.situacao" class="portal-secundario">
                  ·
                  {{
                    t(`portal.agendar.precheckinSituacao.${a.precheckin.situacao}`, {
                      motivo: a.precheckin.motivoRecusa ?? '',
                    })
                  }}</span
                >
                <span v-if="a.pagamento.situacao === 'confirmado'" class="portal-secundario">
                  · {{ t('portal.agendar.pago') }}</span
                >
              </td>
              <td class="pac-acoes">
                <SanteBotao
                  v-if="
                    a.teleconsulta &&
                    ['agendada', 'aguardando', 'sala-aberta', 'em-andamento'].includes(
                      a.teleconsulta.situacao,
                    )
                  "
                  variante="texto"
                  :rotulo="t('portal.agendar.salaEspera')"
                  :data-testid="`pac-sala-${a.id}`"
                  @acionar="roteador.push({ name: 'portal.teleconsulta', params: { id: a.teleconsulta.id } })"
                />
                <SanteBotao
                  v-if="a.precheckin.pode"
                  variante="texto"
                  :rotulo="t('portal.agendar.precheckin')"
                  :data-testid="`pac-precheckin-${a.id}`"
                  @acionar="roteador.push({ name: 'portal.precheckin', params: { tipo: a.tipo, id: a.id } })"
                />
                <SanteBotao
                  v-if="
                    a.pagamento.valor !== null &&
                    a.pagamento.situacao !== 'confirmado' &&
                    a.situacao === 'marcado'
                  "
                  variante="texto"
                  :rotulo="t('portal.agendar.pagar', { valor: dinheiro(a.pagamento.valor) })"
                  :data-testid="`pac-pagar-${a.id}`"
                  @acionar="roteador.push({ name: 'portal.pagamentos' })"
                />
                <SanteBotao
                  v-if="a.pesquisa === 'pendente'"
                  variante="texto"
                  :rotulo="t('portal.agendar.responder')"
                  :data-testid="`pac-pesquisa-${a.id}`"
                  @acionar="roteador.push({ name: 'portal.pagamentos' })"
                />
                <SanteBotao
                  v-if="a.remarcar.pode"
                  variante="texto"
                  :rotulo="t('portal.agendar.remarcar')"
                  :data-testid="`pac-remarcar-${a.id}`"
                  @acionar="remarcar(a)"
                />
                <SanteBotao
                  v-if="a.cancelar.pode"
                  variante="texto"
                  :rotulo="t('portal.agendar.cancelar')"
                  :confirmacao="t('portal.agendar.cancelarConfirma')"
                  :data-testid="`pac-cancelar-${a.id}`"
                  @acionar="cancelar(a)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else role="status">{{ t('portal.carregando') }}</p>
        <SanteSelecao
          v-if="lista.data.value?.itens.some((a) => a.cancelar.pode)"
          v-model="motivo"
          :rotulo="t('portal.agendar.motivo')"
          :opcoes="opcoesMotivo"
          data-testid="pac-motivo-cancelar"
        />
      </section>

      <section class="portal-painel" aria-labelledby="pac-novo" data-testid="pac-nova-marcacao">
        <h2 id="pac-novo">{{ remarcando ? t('portal.agendar.remarcar') : t('portal.agendar.novo') }}</h2>
        <form class="pac-filtro" @submit.prevent="buscar">
          <SanteSelecao
            v-if="!remarcando"
            v-model="tipo"
            :rotulo="t('portal.agendar.tipo')"
            :opcoes="opcoesTipo"
            data-testid="pac-tipo"
          />
          <SanteSelecao
            v-if="ofereceTeleconsulta && !remarcando"
            v-model="modalidade"
            :rotulo="t('portal.agendar.modalidade')"
            :opcoes="opcoesModalidade"
            data-testid="pac-modalidade"
          />
          <SanteSelecao
            v-model="servico"
            :rotulo="t('portal.agendar.servico')"
            :opcoes="opcoesServico"
            :busca="true"
            data-testid="pac-servico"
          />
          <SanteSelecao
            v-model="convenio"
            :rotulo="t('portal.agendar.convenio')"
            :opcoes="opcoesConvenio"
            :busca="true"
            data-testid="pac-convenio"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('portal.agendar.buscar')"
            data-testid="pac-buscar"
            @acionar="buscar"
          />
        </form>
        <template v-if="horarios">
          <p v-if="horarios.itens.length === 0" data-testid="pac-sem-horarios">
            {{ t('portal.agendar.semHorarios') }}
          </p>
          <SanteAlerta v-if="horarios.truncado" :texto="t('portal.agendar.truncado')" variante="info" />
          <div v-for="[d, hs] in porDia" :key="d" class="pac-dia">
            <h3>{{ dia(d) }}</h3>
            <ul class="pac-horarios" :aria-label="dia(d)">
              <li v-for="h in hs" :key="`${h.agenda}-${h.hora}`">
                <SanteBotao
                  variante="secundario"
                  :rotulo="`${hora(h.hora)} · ${h.profissional ?? h.procedimento}`"
                  :data-testid="`pac-horario-${h.data}-${h.hora}`"
                  @acionar="escolhido = h"
                />
              </li>
            </ul>
          </div>
        </template>
        <div v-if="escolhido" class="portal-painel" data-testid="pac-confirmar-painel">
          <p>{{ escolhido.procedimento }} · {{ escolhido.profissional }}</p>
          <SanteSelecao
            v-if="remarcando"
            v-model="motivoRemarcar"
            :rotulo="t('portal.agendar.motivoRemarcar')"
            :opcoes="opcoesMotivo"
            data-testid="pac-motivo-remarcar"
          />
          <SanteBotao
            :rotulo="t('portal.agendar.confirmar', { quando: quando(escolhido) })"
            data-testid="pac-confirmar"
            @acionar="marcar(escolhido)"
          />
        </div>
        <div v-if="resultado && !resultado.ok" role="alert" data-testid="pac-colisao">
          <SanteAlerta :texto="t('portal.agendar.ocupado')" variante="aviso" />
          <SanteBotao
            v-if="resultado.proximo"
            :rotulo="t('portal.agendar.proximo', { quando: quando(resultado.proximo) })"
            data-testid="pac-proximo"
            @acionar="marcar(resultado.proximo)"
          />
          <p v-else>{{ t('portal.agendar.semProximo') }}</p>
        </div>
      </section>
    </template>
  </PortalCasca>
</template>

<style scoped>
.pac-filtro {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-end;
}
.pac-horarios {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
.pac-acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
</style>
