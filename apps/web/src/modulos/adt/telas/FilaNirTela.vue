<script setup lang="ts">
// Solicitação de leito e fila priorizada do NIR (ficha do M44, seção 7, etapa 2): `/internacao/nir/fila`
// (`?atendimento=` do PA e `?agendamento=` da cirurgia pré-preenchem o pedido, também quando a URL muda com a tela aberta,
// como no "Pedir leito" das cirurgias). O médico pede o leito com o perfil (o
// paciente sai do atendimento, da internação ou da cirurgia; na eletiva, da busca); o NIR opera a fila: os cartões na
// ordem da prioridade e do prazo, os conflitos de reserva (o outro sistema ocupou o leito reservado aqui) e as
// cirurgias dos próximos dias que pedem terapia intensiva. O canal de eventos avisa cada mudança e a fila relê; sem o
// canal, a cada 15 s; o prazo depende do relógio, então no máximo 30 s.
import {
  CODIGOS_ORIGEM_NIR,
  CODIGOS_PRECAUCAO,
  CODIGOS_PRIORIDADE_NIR,
  type OrigemSolicitacaoNir,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import { usarAvisosAtendimento } from '../../atendimento/vigia.js';
import {
  CANAL_NIR,
  lerFilaNir,
  lerGravacaoNir,
  lerOrigensNir,
  novaChaveNir,
  solicitarLeito,
} from '../api-nir.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import CartaoSolicitacaoNir from '../componentes/CartaoSolicitacaoNir.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { horaCurta } from '../regras-nir.js';
// M52.3: o atalho para quem está de plantão agora (médicos, enfermagem e sobreaviso).
import LinkPlantaoAgora from '../../pessoas/componentes/LinkPlantaoAgora.vue';

const { t } = useI18n();
const rota = useRoute();
const q = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');
const gravacao = useQuery({ queryKey: ['nir', 'gravacao'], queryFn: lerGravacaoNir, staleTime: 30_000 });
const pode = (acao: string) => gravacao.data.value?.operacoes[acao]?.pode ?? false;
const aviso = computed(() => {
  const g = gravacao.data.value;
  return g && !g.ligada ? g.motivo : null;
});
const avisos = usarAvisosAtendimento(CANAL_NIR, () => void fila.refetch());
const fila = useQuery({
  queryKey: ['nir', 'fila'],
  queryFn: lerFilaNir,
  refetchInterval: computed(() => Math.min(avisos.intervalo(), 30_000)),
});
const podeSolicitar = computed(() => pode('solicitar'));
// As origens trazem também os nomes dos tipos de acomodação: o NIR as lê quando algum pedido restringe o tipo.
const origens = useQuery({
  queryKey: ['nir', 'origens'],
  queryFn: lerOrigensNir,
  enabled: computed(
    () =>
      podeSolicitar.value ||
      (fila.data.value?.itens.some((i) => i.perfil.tiposAcomodacao.length > 0) ?? false),
  ),
});
const nomesTipos = computed(
  () => new Map((origens.data.value?.tiposAcomodacao ?? []).map((x) => [x.codigo, x.nome] as const)),
);

// ── Pedir leito (médico) ──
const origem = ref<OrigemSolicitacaoNir>(
  q('agendamento') ? 'cirurgia' : q('internacao') ? 'internado' : 'pa',
);
const atendimento = ref(q('atendimento'));
const internacao = ref(q('internacao'));
const agendamento = ref(q('agendamento'));
// A mesma rota com outra query reaproveita a tela: o pedido é preenchido de novo e o formulário vem à vista.
watch(
  () => [rota.query['atendimento'], rota.query['internacao'], rota.query['agendamento']],
  async () => {
    if (!q('atendimento') && !q('internacao') && !q('agendamento')) return;
    origem.value = q('agendamento') ? 'cirurgia' : q('internacao') ? 'internado' : 'pa';
    atendimento.value = q('atendimento');
    internacao.value = q('internacao');
    agendamento.value = q('agendamento');
    await nextTick();
    document.getElementById('nir-pedir')?.scrollIntoView({ block: 'start' });
  },
);
const termo = ref('');
const pedido = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['nir', 'pacientes', pedido.value]),
  queryFn: () => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref('');
const prioridade = ref<string>('urgente');
const intensiva = ref<'sim' | 'nao'>('nao');
const precaucao = ref<string>('');
/** Os tipos de acomodação aceitos (vazio: qualquer tipo); escolhidos um a um na seleção com busca. */
const tipos = ref<number[]>([]);
const tipoNovo = ref<string>('');
watch(tipoNovo, (v) => {
  if (v && !tipos.value.includes(Number(v)) && tipos.value.length < 20)
    tipos.value = [...tipos.value, Number(v)];
  if (v) tipoNovo.value = '';
});
const tirarTipo = (k: number) => (tipos.value = tipos.value.filter((x) => x !== k));
const clinica = ref<string>('M');
const justificativa = ref('');
const opcoes = computed(() => ({
  origens: CODIGOS_ORIGEM_NIR.map((o) => ({ valor: o, rotulo: t(`nir.origens.${o}`) })),
  pa: [
    { valor: '', rotulo: t('nir.escolha') },
    ...(origens.data.value?.pa ?? []).map((a) => ({
      valor: String(a.atendimento),
      rotulo: `${a.nome} · ${a.senha ?? a.atendimento} · ${horaCurta(a.chegada)}`,
    })),
  ],
  internados: [
    { valor: '', rotulo: t('nir.escolha') },
    ...(origens.data.value?.internados ?? []).map((i) => ({
      valor: String(i.internacao),
      rotulo: `${i.nome} · ${i.leito}`,
    })),
  ],
  cirurgias: [
    { valor: '', rotulo: t('nir.escolha') },
    ...(origens.data.value?.cirurgias ?? [])
      .filter((c) => c.paciente !== null)
      .map((c) => ({ valor: String(c.agendamento), rotulo: `${c.nome} · ${horaCurta(c.dataHora)}` })),
  ],
  pacientes: [
    { valor: '', rotulo: t('nir.escolha') },
    ...(pacientes.data.value?.itens ?? []).map((p) => ({
      valor: String(p.id),
      rotulo: `${p.nomeSocial ?? p.nome} · ${p.prontuario}`,
    })),
  ],
  prioridades: CODIGOS_PRIORIDADE_NIR.map((p) => ({ valor: p, rotulo: t(`nir.prioridades.${p}`) })),
  intensiva: [
    { valor: 'nao' as const, rotulo: t('nir.solicitar.nao') },
    { valor: 'sim' as const, rotulo: t('nir.solicitar.sim') },
  ],
  precaucoes: [
    { valor: '', rotulo: t('nir.precaucoes.nenhuma') },
    ...CODIGOS_PRECAUCAO.map((p) => ({ valor: p, rotulo: t(`nir.precaucoes.${p}`) })),
  ],
  clinicas: ['M', 'C', 'N'].map((c) => ({ valor: c, rotulo: t(`nir.clinicas.${c}`) })),
  tipos: [
    { valor: '', rotulo: t('nir.solicitar.tipoEscolha') },
    ...(origens.data.value?.tiposAcomodacao ?? [])
      .filter((x) => !tipos.value.includes(x.codigo))
      .map((x) => ({ valor: String(x.codigo), rotulo: x.nome })),
  ],
}));
const pacienteDaCirurgia = computed(
  () =>
    origens.data.value?.cirurgias.find((c) => String(c.agendamento) === agendamento.value)?.paciente ?? null,
);
const pronto = computed(() => {
  if (justificativa.value.trim().length < 10) return false;
  if (origem.value === 'pa') return /^\d+$/.test(atendimento.value);
  if (origem.value === 'internado') return /^\d+$/.test(internacao.value);
  if (origem.value === 'cirurgia') return pacienteDaCirurgia.value !== null;
  return /^\d+$/.test(paciente.value);
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function pedir(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await solicitarLeito(
      {
        origem: origem.value,
        prioridade: prioridade.value,
        perfil: {
          intensiva: intensiva.value === 'sim',
          precaucao: precaucao.value || null,
          tiposAcomodacao: [...tipos.value],
        },
        clinica: clinica.value,
        justificativa: justificativa.value.trim(),
        ...(origem.value === 'pa' ? { atendimento: Number(atendimento.value) } : {}),
        ...(origem.value === 'internado' ? { internacao: Number(internacao.value) } : {}),
        ...(origem.value === 'cirurgia'
          ? { cirurgia: Number(agendamento.value), paciente: pacienteDaCirurgia.value }
          : {}),
        ...(origem.value === 'eletiva' || origem.value === 'externa'
          ? { paciente: Number(paciente.value) }
          : {}),
      },
      novaChaveNir('solicitar'),
    );
    mensagem.value = t('nir.solicitar.enviado');
    justificativa.value = '';
    tipos.value = [];
    await fila.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const nAbertas = computed(() => fila.data.value?.itens.length ?? 0);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nir-fila-titulo" data-testid="tela-fila-nir">
    <h1 id="nir-fila-titulo">{{ t('nir.fila.titulo') }}</h1>
    <LinkPlantaoAgora />
    <p>{{ t('nir.fila.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/internacao/nir/reservas">{{ t('nir.atalhos.reservas') }}</RouterLink>
      <RouterLink to="/internacao/nir/altas-previstas">{{ t('nir.atalhos.altas') }}</RouterLink>
      <RouterLink to="/internacao/nir/permanencia">{{ t('nir.atalhos.permanencia') }}</RouterLink>
      <RouterLink to="/internacao/nir/situacoes" data-testid="link-situacoes">{{
        t('nir.atalhos.situacoes')
      }}</RouterLink>
      <RouterLink to="/leitos/mapa">{{ t('nir.atalhos.mapa') }}</RouterLink>
    </p>
    <AvisoAdt :motivo="aviso" />
    <section v-if="podeSolicitar" class="painel" aria-labelledby="nir-pedir" data-testid="nir-pedir">
      <h2 id="nir-pedir">{{ t('nir.solicitar.titulo') }}</h2>
      <p class="secundario">{{ t('nir.solicitar.texto') }}</p>
      <div class="filtros">
        <SanteSelecao
          v-model="origem"
          :rotulo="t('nir.solicitar.origem')"
          :opcoes="opcoes.origens"
          data-testid="nir-origem"
        />
        <SanteSelecao
          v-if="origem === 'pa'"
          v-model="atendimento"
          :rotulo="t('nir.solicitar.atendimento')"
          :opcoes="opcoes.pa"
          data-testid="nir-atendimento"
        />
        <SanteSelecao
          v-if="origem === 'internado'"
          v-model="internacao"
          :rotulo="t('nir.solicitar.internacao')"
          :opcoes="opcoes.internados"
          data-testid="nir-internacao"
        />
        <SanteSelecao
          v-if="origem === 'cirurgia'"
          v-model="agendamento"
          :rotulo="t('nir.solicitar.cirurgia')"
          :opcoes="opcoes.cirurgias"
          data-testid="nir-cirurgia"
        />
        <template v-if="origem === 'eletiva' || origem === 'externa'">
          <form class="filtros" role="search" @submit.prevent="pedido = termo.trim()">
            <SanteCampoTexto
              v-model="termo"
              :rotulo="t('nir.solicitar.buscarPaciente')"
              :max-bytes="70"
              data-testid="nir-termo"
            />
            <SanteBotao
              tipo="submit"
              variante="secundario"
              :rotulo="t('nir.solicitar.buscar')"
              data-testid="nir-buscar"
            />
          </form>
          <SanteSelecao
            v-model="paciente"
            :rotulo="t('nir.solicitar.paciente')"
            :opcoes="opcoes.pacientes"
            data-testid="nir-paciente"
          />
        </template>
        <SanteSelecao
          v-model="prioridade"
          :rotulo="t('nir.solicitar.prioridade')"
          :opcoes="opcoes.prioridades"
          data-testid="nir-prioridade"
        />
        <SanteOpcoes v-model="intensiva" :legenda="t('nir.solicitar.intensiva')" :opcoes="opcoes.intensiva" />
        <SanteSelecao
          v-model="precaucao"
          :rotulo="t('nir.solicitar.precaucao')"
          :opcoes="opcoes.precaucoes"
          data-testid="nir-precaucao"
        />
        <SanteSelecao
          v-model="tipoNovo"
          :rotulo="t('nir.solicitar.tipo')"
          :opcoes="opcoes.tipos"
          busca
          data-testid="nir-tipo"
        />
        <SanteSelecao
          v-model="clinica"
          :rotulo="t('nir.solicitar.clinica')"
          :opcoes="opcoes.clinicas"
          data-testid="nir-clinica"
        />
      </div>
      <div
        v-if="tipos.length > 0"
        class="acoes"
        role="group"
        :aria-label="t('nir.solicitar.tiposEscolhidos')"
      >
        <SanteBotao
          v-for="k in tipos"
          :key="k"
          variante="secundario"
          :rotulo="t('nir.solicitar.tipoRemover', { nome: nomesTipos.get(k) ?? String(k) })"
          :data-testid="`nir-tipo-escolhido-${k}`"
          @acionar="tirarTipo(k)"
        />
      </div>
      <SanteCampoTexto
        v-model="justificativa"
        :rotulo="t('nir.solicitar.justificativa')"
        :max-bytes="500"
        multilinha
        id="nir-justificativa"
      />
      <SanteBotao
        :rotulo="t('nir.solicitar.enviar')"
        :desabilitado="!pronto || ocupado"
        data-testid="nir-pedir-enviar"
        @acionar="pedir"
      />
      <p v-if="mensagem" role="status" data-testid="nir-pedido-enviado">{{ mensagem }}</p>
      <ErroAdt v-if="erro" :erro="erro" />
    </section>
    <ErroAdt v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('nir.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-for="c in fila.data.value.conflitos"
        :key="`conf-${c.reserva}`"
        variante="alerta"
        anunciar
        :data-testid="`conflito-reserva-${c.reserva}`"
        :texto="
          t('nir.fila.conflitoItem', {
            leito: c.chave.replaceAll('|', ' · '),
            solicitacao: c.solicitacao,
            internacao: c.internacao,
            em: horaCurta(c.em),
          })
        "
      />
      <h2>
        {{ t('nir.fila.resumo', { n: nAbertas, estourados: fila.data.value.estourados }) }}
      </h2>
      <p v-if="nAbertas === 0">{{ t('nir.fila.vazia') }}</p>
      <ul v-else class="lista-cartoes" data-testid="fila-nir">
        <CartaoSolicitacaoNir
          v-for="s in fila.data.value.itens"
          :key="s.id"
          :solicitacao="s"
          :pode="pode"
          :nomes-tipos="nomesTipos"
          @mudou="fila.refetch()"
        />
      </ul>
      <section v-if="fila.data.value.cirurgiasUti.length > 0" class="painel" aria-labelledby="nir-cirurgias">
        <h2 id="nir-cirurgias">{{ t('nir.fila.cirurgias') }}</h2>
        <ul class="lista-simples">
          <li v-for="c in fila.data.value.cirurgiasUti" :key="c.agendamento">
            {{ t('nir.fila.cirurgiaItem', { nome: c.nome, quando: horaCurta(c.dataHora), sala: c.sala }) }}
            <span v-if="c.comSolicitacao" class="secundario"> · {{ t('nir.fila.jaPedida') }}</span>
            <RouterLink
              v-else-if="podeSolicitar && c.paciente !== null"
              :to="`/internacao/nir/fila?agendamento=${c.agendamento}`"
              >{{ t('nir.fila.pedirLeito') }}</RouterLink
            >
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.lista-cartoes {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
</style>
