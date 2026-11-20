<script setup lang="ts">
// Ficha anestésica (M46, etapa 1; ficha, seção 7; regra 3, Resolução CFM 2.174/2017; tela de tablet na sala). Sem
// agendamento, a escolha da cirurgia do dia; com ele: os tempos (marcar agora), os sinais a cada 5 minutos com o gráfico
// e as lacunas (a justificativa registrada), os lançamentos por parte (sinais, fármacos com dose e via, gases,
// fluidos e perdas que vão ao balanço hídrico uma vez só, eventos, modo respiratório, posição e equipe), o fim do gás e
// da infusão, a passagem entre anestesistas, a assinatura só pelo anestesista da cirurgia (com a senha; o botão fica
// desabilitado com a lista do que falta) e o adendo depois de assinada. Sem rede, os atos ficam no cofre cifrado do
// aparelho e vão na volta da rede com a mesma chave.
import {
  EVENTOS_FICHA,
  FLUIDOS_FICHA,
  GASES_FICHA,
  MARCOS_FICHA,
  PERDAS_FICHA,
  SINAIS_FICHA,
  SINAIS_FICHA_OBRIGATORIOS,
  TIPOS_GAS_FICHA,
  TIPOS_SINAL_FICHA,
  VIAS_FICHA,
  type MarcoFicha,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { semRede } from '../../enfermagem/api-enfermagem.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import type { DonoCofre } from '../../enfermagem/cofre-local.js';
import {
  buscarAnestesistas,
  buscarFarmacos,
  gravarAnestesia,
  lerFicha,
  novaChaveAnestesia,
} from '../api-anestesia.js';
import CabecalhoAnestesia from '../componentes/CabecalhoAnestesia.vue';
import ErroAnestesia from '../componentes/ErroAnestesia.vue';
import EscolhaCirurgia from '../componentes/EscolhaCirurgia.vue';
import GraficoSinais from '../componentes/GraficoSinais.vue';
import { enviarFilaFicha, guardarAtoFicha, lerFilaFicha } from '../fila-ficha.js';

const props = withDefaults(defineProps<{ agenda?: string }>(), { agenda: '' });
const { t } = useI18n();
const agenda = computed(() => Number(props.agenda) || null);
const { sessao } = usarSessao();
const dono = computed<DonoCofre | null>(() => {
  const x = sessao.value;
  return x && x.estabelecimentoAtivo
    ? { rede: x.rede ?? '', estabelecimento: x.estabelecimentoAtivo, login: x.usuario.login ?? x.usuario.id }
    : null;
});
const PRAZO_HORAS = 12;

const dados = useQuery({
  queryKey: computed(() => ['anestesia', 'ficha', agenda.value]),
  queryFn: () => lerFicha(agenda.value!),
  enabled: computed(() => !!agenda.value),
  refetchInterval: 30_000,
});
const tela = computed(() => dados.data.value);
const ficha = computed(() => tela.value?.ficha ?? null);
const pode = (op: string) => tela.value?.gravacao.operacoes[op]?.pode === true;
const assinada = computed(() => ficha.value?.situacao === 'assinada');

const agoraLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const hora = (x: string | null | undefined) => (x ? x.replace('T', ' ').slice(11, 16) : '—');

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const naFila = ref(0);

async function contarFila(): Promise<void> {
  naFila.value = dono.value ? (await lerFilaFicha(dono.value, PRAZO_HORAS)).length : 0;
}
onMounted(() => void contarFila());

/** Grava o ato; sem rede, guarda na fila do aparelho com a mesma chave. */
async function ato(url: string, corpo: Record<string, unknown>, rotulo: string): Promise<boolean> {
  if (!agenda.value) return false;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  const chave = novaChaveAnestesia('ficha');
  try {
    const r = await gravarAnestesia(url, corpo, chave);
    mensagem.value = r.mensagem;
    await dados.refetch();
    return true;
  } catch (x) {
    if (semRede(x) && dono.value) {
      await guardarAtoFicha(dono.value, { chave, agenda: agenda.value, url, corpo, rotulo }, PRAZO_HORAS);
      await contarFila();
      mensagem.value = t('anestesia.semRede');
      return true;
    }
    erro.value = x;
    return false;
  } finally {
    ocupado.value = false;
  }
}

async function enviarFila(): Promise<void> {
  if (!dono.value) return;
  const r = await enviarFilaFicha(
    dono.value,
    PRAZO_HORAS,
    (a) => gravarAnestesia(a.url, a.corpo, a.chave),
    semRede,
  );
  const recusado = r.resultados.find((x) => !x.ok);
  if (recusado && !recusado.ok) erro.value = recusado.erro;
  await contarFila();
  await dados.refetch();
}

// ── Tempos ─────────────────────────────────────────────────────────────────────────────────────────────────────
function marcar(marco: MarcoFicha): void {
  if (!agenda.value) return;
  void ato(
    `/${agenda.value}/ficha/marcos`,
    { agendamento: agenda.value, marco, momento: agoraLocal() },
    marco,
  );
}

// ── Sinais (o lote rápido dos obrigatórios) ────────────────────────────────────────────────────────────────────
const sinais = reactive(Object.fromEntries(TIPOS_SINAL_FICHA.map((s) => [s, ''])) as Record<string, string>);
const momentoSinais = ref(agoraLocal());
const sinaisProntos = computed(() => SINAIS_FICHA_OBRIGATORIOS.every((s) => sinais[s]?.trim()));
async function lancarSinais(): Promise<void> {
  if (!agenda.value) return;
  const lancamentos = TIPOS_SINAL_FICHA.filter((s) => sinais[s]?.trim()).map((tipo) => ({
    parte: 'sinal',
    momento: momentoSinais.value,
    tipo,
    valor: Number(sinais[tipo]!.replace(',', '.')),
  }));
  if (await ato(`/${agenda.value}/ficha/lancamentos`, { agendamento: agenda.value, lancamentos }, 'sinais')) {
    for (const s of TIPOS_SINAL_FICHA) sinais[s] = '';
    momentoSinais.value = agoraLocal();
  }
}

// ── Outros lançamentos ────────────────────────────────────────────────────────────────────────────────────────
const PARTES = [
  'medicamento',
  'gas',
  'fluido',
  'perda',
  'evento',
  'modoRespiratorio',
  'posicao',
  'equipe',
  'bi',
  'procedimento',
  'exame',
  'avulso',
] as const;
type Parte = (typeof PARTES)[number];
const opcoesParte = PARTES.map((p) => ({ valor: p as Parte, rotulo: t(`anestesia.ficha.partes.${p}`) }));
const novo = reactive({
  parte: 'medicamento' as Parte,
  momento: agoraLocal(),
  termoItem: '',
  item: null as number | null,
  dose: '',
  unidade: 'mg',
  via: 'ev',
  continua: false,
  gas: 'o2',
  valor: '',
  fluido: 'cristaloide',
  perda: 'sangramento',
  volume: '',
  evento: 'intubacao',
  descricao: '',
  modo: null as number | null,
  posicao: null as number | null,
  termoProf: '',
  profissional: null as number | null,
  funcao: null as number | null,
  texto: '',
  resultado: '',
});
const itens = ref<{ codigo: number; nome: string; unidade: string | null }[]>([]);
const profs = ref<{ id: number; cod: number; nome: string }[]>([]);
async function buscarItem(): Promise<void> {
  itens.value = novo.termoItem.trim().length >= 2 ? await buscarFarmacos(novo.termoItem.trim()) : [];
}
async function buscarProf(): Promise<void> {
  profs.value = novo.termoProf.trim().length >= 2 ? await buscarAnestesistas(novo.termoProf.trim()) : [];
}
const dom = computed(() => tela.value?.dominios);
const opcoes = computed(() => ({
  itens: [
    { valor: null, rotulo: '—' },
    ...itens.value.map((i) => ({ valor: i.codigo as number | null, rotulo: i.nome })),
  ],
  vias: VIAS_FICHA.map((v) => ({ valor: v.codigo as string, rotulo: v.rotulo })),
  gases: TIPOS_GAS_FICHA.map((g) => ({
    valor: g as string,
    rotulo: `${GASES_FICHA[g].rotulo} (${GASES_FICHA[g].unidade})`,
  })),
  fluidos: FLUIDOS_FICHA.map((f) => ({ valor: f.codigo as string, rotulo: f.rotulo })),
  perdas: PERDAS_FICHA.map((f) => ({ valor: f.codigo as string, rotulo: f.rotulo })),
  eventos: EVENTOS_FICHA.map((f) => ({ valor: f.codigo as string, rotulo: f.rotulo })),
  modos: [
    { valor: null, rotulo: '—' },
    ...(dom.value?.modosRespiratorios ?? [])
      .filter((x) => x.ativo)
      .map((x) => ({ valor: x.id as number | null, rotulo: x.rotulo })),
  ],
  posicoes: [
    { valor: null, rotulo: '—' },
    ...(dom.value?.posicoes ?? [])
      .filter((x) => x.ativo)
      .map((x) => ({ valor: x.id as number | null, rotulo: x.rotulo })),
  ],
  funcoes: [
    { valor: null, rotulo: '—' },
    ...(dom.value?.funcoesEquipe ?? [])
      .filter((x) => x.ativo)
      .map((x) => ({ valor: x.id as number | null, rotulo: x.rotulo })),
  ],
  profs: [
    { valor: null, rotulo: '—' },
    ...profs.value.map((p) => ({ valor: p.id as number | null, rotulo: p.nome })),
  ],
}));
const n = (v: string) => Number(v.replace(',', '.'));
const lancamentoNovo = computed((): Record<string, unknown> | null => {
  const base = { momento: novo.momento };
  const obs = novo.descricao.trim() || null;
  switch (novo.parte) {
    case 'medicamento':
      return novo.item && novo.dose && novo.unidade.trim()
        ? {
            ...base,
            parte: 'medicamento',
            item: novo.item,
            dose: n(novo.dose),
            unidade: novo.unidade.trim(),
            via: novo.via,
            continua: novo.continua,
            observacao: obs,
          }
        : null;
    case 'gas':
      return novo.valor ? { ...base, parte: 'gas', gas: novo.gas, valor: n(novo.valor) } : null;
    case 'fluido':
      return novo.volume
        ? { ...base, parte: 'fluido', fluido: novo.fluido, volumeMl: n(novo.volume), observacao: obs }
        : null;
    case 'perda':
      return novo.volume
        ? { ...base, parte: 'perda', perda: novo.perda, volumeMl: n(novo.volume), observacao: obs }
        : null;
    case 'evento':
      return novo.evento !== 'outro' || (obs ?? '').length >= 3
        ? { ...base, parte: 'evento', evento: novo.evento, descricao: obs }
        : null;
    case 'modoRespiratorio':
      return novo.modo ? { ...base, parte: 'modoRespiratorio', modo: novo.modo, observacao: obs } : null;
    case 'posicao':
      return novo.posicao ? { ...base, parte: 'posicao', posicao: novo.posicao, observacao: obs } : null;
    case 'equipe': {
      const p = profs.value.find((x) => x.id === novo.profissional);
      return p && novo.funcao
        ? { ...base, parte: 'equipe', profissional: { id: p.id, cod: p.cod }, funcao: novo.funcao }
        : null;
    }
    case 'bi':
      return novo.item && novo.valor && novo.unidade.trim()
        ? {
            ...base,
            parte: 'bi',
            item: novo.item,
            vazao: n(novo.valor),
            unidade: novo.unidade.trim(),
            observacao: obs,
          }
        : null;
    case 'procedimento':
      return novo.texto.trim().length >= 3
        ? { ...base, parte: 'procedimento', descricao: novo.texto.trim(), observacao: obs }
        : null;
    case 'exame':
      return novo.texto.trim().length >= 2
        ? { ...base, parte: 'exame', exame: novo.texto.trim(), resultado: novo.resultado.trim() || null }
        : null;
    case 'avulso':
      return novo.texto.trim().length >= 3
        ? {
            ...base,
            parte: 'avulso',
            descricao: novo.texto.trim(),
            quantidade: novo.valor ? n(novo.valor) : null,
          }
        : null;
  }
  return null;
});
async function lancarNovo(): Promise<void> {
  if (!agenda.value || !lancamentoNovo.value) return;
  if (
    await ato(
      `/${agenda.value}/ficha/lancamentos`,
      { agendamento: agenda.value, lancamentos: [lancamentoNovo.value] },
      novo.parte,
    )
  ) {
    novo.dose = '';
    novo.valor = '';
    novo.volume = '';
    novo.descricao = '';
    novo.momento = agoraLocal();
  }
}
function encerrar(id: number): void {
  if (!agenda.value) return;
  void ato(
    `/${agenda.value}/ficha/lancamentos/${id}/encerrar`,
    { agendamento: agenda.value, lancamento: id, fim: agoraLocal() },
    'fim',
  );
}

// ── Lacunas, passagem, assinatura e adendo ────────────────────────────────────────────────────────────────────
const motivoLacuna = reactive<Record<string, string>>({});
function justificar(inicio: string, fim: string): void {
  if (!agenda.value) return;
  void ato(
    `/${agenda.value}/ficha/lacunas`,
    { agendamento: agenda.value, inicio, fim, motivo: motivoLacuna[inicio] ?? '' },
    'lacuna',
  );
}
const passagem = reactive({ termo: '', para: null as number | null, resumo: '' });
const candidatos = ref<{ id: number; cod: number; nome: string }[]>([]);
async function buscarPara(): Promise<void> {
  candidatos.value = passagem.termo.trim().length >= 2 ? await buscarAnestesistas(passagem.termo.trim()) : [];
}
const opcoesPara = computed(() => [
  { valor: null, rotulo: '—' },
  ...candidatos.value.map((p) => ({ valor: p.id as number | null, rotulo: p.nome })),
]);
async function passar(): Promise<void> {
  const p = candidatos.value.find((x) => x.id === passagem.para);
  if (!agenda.value || !p) return;
  if (
    await ato(
      `/${agenda.value}/ficha/passagem`,
      {
        agendamento: agenda.value,
        momento: agoraLocal(),
        para: { id: p.id, cod: p.cod },
        resumo: passagem.resumo,
      },
      'passagem',
    )
  )
    passagem.resumo = '';
}
const senha = ref('');
async function assinar(): Promise<void> {
  if (!agenda.value || !ficha.value) return;
  const ok = await ato(
    `/${agenda.value}/ficha/assinatura`,
    { agendamento: agenda.value, versao: ficha.value.versao, senha: senha.value },
    'assinatura',
  );
  senha.value = '';
  if (ok) await dados.refetch();
}
const adendo = ref('');
async function incluirAdendo(): Promise<void> {
  if (!agenda.value) return;
  if (
    await ato(`/${agenda.value}/ficha/adendos`, { agendamento: agenda.value, texto: adendo.value }, 'adendo')
  )
    adendo.value = '';
}

const pontos = computed(() =>
  (ficha.value?.lancamentos ?? [])
    .filter((l) => l.parte === 'sinal' && l.valor !== null)
    .map((l) => ({ tipo: String(l.dados['tipo']), momento: l.momento, valor: l.valor! })),
);
const nome = (id: number | null) => (id === null ? '—' : (ficha.value?.nomes[String(id)] ?? String(id)));
</script>

<template>
  <section class="tela-anest" aria-labelledby="fa-titulo" data-testid="tela-ficha-anestesica">
    <h1 id="fa-titulo">{{ t('anestesia.ficha.titulo') }}</h1>
    <EscolhaCirurgia v-if="!agenda" destino="ficha" />
    <template v-else>
      <ErroAnestesia v-if="dados.isError.value" :erro="dados.error.value" />
      <p v-else-if="!tela" role="status">{{ t('anestesia.carregando') }}</p>
      <template v-else>
        <CabecalhoAnestesia :contexto="tela.contexto" :exames="false" />
        <SanteAlerta
          v-if="!tela.gravacao.ligada"
          variante="aviso"
          :texto="tela.gravacao.motivo ?? t('anestesia.emConstrucao')"
        />
        <p v-if="ficha" data-testid="fa-situacao" :data-situacao="ficha.situacao">
          <strong>{{ t(`anestesia.ficha.situacoes.${ficha.situacao}`) }}</strong>
          ·
          {{
            t('anestesia.ficha.totais', {
              ganhos: ficha.totais.ganhosMl,
              perdas: ficha.totais.perdasMl,
              hemo: ficha.totais.hemocomponentesMl,
            })
          }}
        </p>
        <p v-if="naFila > 0" class="faixa-rede" role="status" data-testid="fa-fila">
          {{ t('anestesia.ficha.naFila', { n: naFila }) }}
          <SanteBotao
            variante="texto"
            :rotulo="t('anestesia.ficha.enviarFila')"
            data-testid="fa-enviar-fila"
            @acionar="enviarFila"
          />
        </p>
        <p v-if="mensagem" role="status" data-testid="fa-mensagem">{{ mensagem }}</p>
        <ErroAnestesia v-if="erro" :erro="erro" />

        <section class="cartao" aria-labelledby="fa-marcos">
          <h2 id="fa-marcos">{{ t('anestesia.ficha.marcos') }}</h2>
          <ul class="marcos">
            <li v-for="m in MARCOS_FICHA" :key="m.codigo" :data-testid="`fa-marco-${m.codigo}`">
              <span>{{ m.rotulo }}</span>
              <strong v-if="ficha?.marcos[m.codigo]">{{ hora(ficha.marcos[m.codigo]) }}</strong>
              <SanteBotao
                v-else-if="pode('ficha') && !assinada"
                variante="secundario"
                :rotulo="t('anestesia.ficha.marcar')"
                :desabilitado="ocupado"
                :data-testid="`fa-marcar-${m.codigo}`"
                @acionar="marcar(m.codigo)"
              />
              <span v-else class="secundario">—</span>
            </li>
          </ul>
        </section>

        <GraficoSinais
          :inicio="ficha?.marcos.inicioAnestesia ?? null"
          :fim="ficha?.marcos.fimAnestesia ?? tela.agora"
          :pontos="pontos"
          :lacunas="ficha?.lacunas ?? []"
        />

        <form
          v-if="pode('ficha') && !assinada"
          class="cartao"
          data-testid="fa-sinais"
          @submit.prevent="lancarSinais"
        >
          <h2>{{ t('anestesia.ficha.sinais') }}</h2>
          <div class="barra">
            <span class="campo">
              <label for="fa-sinais-momento">{{ t('anestesia.horario') }}</label>
              <input id="fa-sinais-momento" v-model="momentoSinais" type="datetime-local" />
            </span>
            <span v-for="s in TIPOS_SINAL_FICHA" :key="s" class="campo">
              <label :for="`fa-sinal-${s}`"
                >{{ SINAIS_FICHA[s].rotulo }} ({{ SINAIS_FICHA[s].unidade }})</label
              >
              <input
                :id="`fa-sinal-${s}`"
                v-model="sinais[s]"
                inputmode="decimal"
                :data-testid="`fa-sinal-${s}`"
              />
            </span>
          </div>
          <SanteBotao
            tipo="submit"
            :rotulo="t('anestesia.ficha.lancarSinais')"
            :desabilitado="!sinaisProntos || ocupado"
            data-testid="fa-lancar-sinais"
          />
        </form>

        <form
          v-if="pode('ficha') && !assinada"
          class="cartao"
          data-testid="fa-novo"
          @submit.prevent="lancarNovo"
        >
          <h2>{{ t('anestesia.ficha.novoLancamento') }}</h2>
          <div class="barra">
            <SanteSelecao
              v-model="novo.parte"
              :rotulo="t('anestesia.ficha.parte')"
              :opcoes="opcoesParte"
              data-testid="fa-parte"
            />
            <span class="campo">
              <label for="fa-momento">{{ t('anestesia.horario') }}</label>
              <input id="fa-momento" v-model="novo.momento" type="datetime-local" data-testid="fa-momento" />
            </span>
          </div>
          <div v-if="novo.parte === 'medicamento' || novo.parte === 'bi'" class="barra">
            <span class="campo">
              <label for="fa-termo-item">{{ t('anestesia.ficha.buscarFarmaco') }}</label>
              <input
                id="fa-termo-item"
                v-model="novo.termoItem"
                data-testid="fa-termo-item"
                @keydown.enter.prevent="buscarItem"
              />
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('anestesia.ficha.buscar')"
              data-testid="fa-buscar-item"
              @acionar="buscarItem"
            />
            <SanteSelecao
              v-model="novo.item"
              :rotulo="t('anestesia.ficha.medicamentos')"
              :opcoes="opcoes.itens"
              :busca="true"
              data-testid="fa-item"
            />
            <span v-if="novo.parte === 'medicamento'" class="campo"
              ><label for="fa-dose">{{ t('anestesia.ficha.dose') }}</label
              ><input id="fa-dose" v-model="novo.dose" inputmode="decimal" data-testid="fa-dose"
            /></span>
            <span v-else class="campo"
              ><label for="fa-vazao">{{ t('anestesia.ficha.vazao') }}</label
              ><input id="fa-vazao" v-model="novo.valor" inputmode="decimal" data-testid="fa-vazao"
            /></span>
            <span class="campo"
              ><label for="fa-unidade">{{ t('anestesia.ficha.unidade') }}</label
              ><input id="fa-unidade" v-model="novo.unidade" maxlength="10"
            /></span>
            <template v-if="novo.parte === 'medicamento'">
              <SanteSelecao
                v-model="novo.via"
                :rotulo="t('anestesia.ficha.via')"
                :opcoes="opcoes.vias"
                data-testid="fa-via"
              />
              <label class="linha"
                ><input v-model="novo.continua" type="checkbox" /> {{ t('anestesia.ficha.continua') }}</label
              >
            </template>
          </div>
          <div v-else-if="novo.parte === 'gas'" class="barra">
            <SanteSelecao
              v-model="novo.gas"
              :rotulo="t('anestesia.ficha.gases')"
              :opcoes="opcoes.gases"
              data-testid="fa-gas"
            />
            <span class="campo"
              ><label for="fa-valor">{{ t('anestesia.ficha.valor') }}</label
              ><input id="fa-valor" v-model="novo.valor" inputmode="decimal" data-testid="fa-valor"
            /></span>
          </div>
          <div v-else-if="novo.parte === 'fluido' || novo.parte === 'perda'" class="barra">
            <SanteSelecao
              v-if="novo.parte === 'fluido'"
              v-model="novo.fluido"
              :rotulo="t('anestesia.ficha.fluidos')"
              :opcoes="opcoes.fluidos"
              data-testid="fa-fluido"
            />
            <SanteSelecao
              v-else
              v-model="novo.perda"
              :rotulo="t('anestesia.ficha.perdas')"
              :opcoes="opcoes.perdas"
              data-testid="fa-perda"
            />
            <span class="campo"
              ><label for="fa-volume">{{ t('anestesia.ficha.volume') }}</label
              ><input id="fa-volume" v-model="novo.volume" inputmode="decimal" data-testid="fa-volume"
            /></span>
            <p v-if="tela.contexto.atendimento === null" class="secundario">
              {{ t('anestesia.ficha.semBalanco') }}
            </p>
          </div>
          <div v-else-if="novo.parte === 'evento'" class="barra">
            <SanteSelecao
              v-model="novo.evento"
              :rotulo="t('anestesia.ficha.eventos')"
              :opcoes="opcoes.eventos"
              data-testid="fa-evento"
            />
          </div>
          <div v-else-if="novo.parte === 'modoRespiratorio'" class="barra">
            <SanteSelecao
              v-model="novo.modo"
              :rotulo="t('anestesia.ficha.modoRespiratorio')"
              :opcoes="opcoes.modos"
              data-testid="fa-modo"
            />
          </div>
          <div v-else-if="novo.parte === 'posicao'" class="barra">
            <SanteSelecao
              v-model="novo.posicao"
              :rotulo="t('anestesia.ficha.posicao')"
              :opcoes="opcoes.posicoes"
              data-testid="fa-posicao"
            />
          </div>
          <div v-else-if="novo.parte === 'equipe'" class="barra">
            <span class="campo">
              <label for="fa-termo-prof">{{ t('anestesia.ficha.buscarProfissional') }}</label>
              <input
                id="fa-termo-prof"
                v-model="novo.termoProf"
                data-testid="fa-termo-prof"
                @keydown.enter.prevent="buscarProf"
              />
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('anestesia.ficha.buscar')"
              data-testid="fa-buscar-prof"
              @acionar="buscarProf"
            />
            <SanteSelecao
              v-model="novo.profissional"
              :rotulo="t('anestesia.ficha.equipe')"
              :opcoes="opcoes.profs"
              :busca="true"
              data-testid="fa-prof"
            />
            <SanteSelecao
              v-model="novo.funcao"
              :rotulo="t('anestesia.ficha.funcao')"
              :opcoes="opcoes.funcoes"
              data-testid="fa-funcao"
            />
          </div>
          <div
            v-else-if="novo.parte === 'procedimento' || novo.parte === 'exame' || novo.parte === 'avulso'"
            class="barra"
          >
            <span class="campo">
              <label for="fa-texto">{{ t(`anestesia.ficha.textoDa.${novo.parte}`) }}</label>
              <input id="fa-texto" v-model="novo.texto" maxlength="120" data-testid="fa-texto" />
            </span>
            <span v-if="novo.parte === 'exame'" class="campo">
              <label for="fa-resultado">{{ t('anestesia.ficha.resultado') }}</label>
              <input id="fa-resultado" v-model="novo.resultado" maxlength="255" data-testid="fa-resultado" />
            </span>
            <span v-if="novo.parte === 'avulso'" class="campo">
              <label for="fa-quantidade">{{ t('anestesia.ficha.quantidade') }}</label>
              <input
                id="fa-quantidade"
                v-model="novo.valor"
                inputmode="decimal"
                data-testid="fa-quantidade"
              />
            </span>
          </div>
          <span
            v-if="
              novo.parte !== 'gas' &&
              novo.parte !== 'equipe' &&
              novo.parte !== 'exame' &&
              novo.parte !== 'avulso'
            "
            class="campo"
          >
            <label for="fa-obs">{{ t('anestesia.observacao') }}</label>
            <input id="fa-obs" v-model="novo.descricao" maxlength="255" data-testid="fa-obs" />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="t('anestesia.ficha.lancar')"
            :desabilitado="!lancamentoNovo || ocupado"
            data-testid="fa-lancar"
          />
        </form>

        <section v-if="ficha" aria-labelledby="fa-lista">
          <h2 id="fa-lista">{{ t('anestesia.ficha.lancamentos') }}</h2>
          <div class="rolagem">
            <table class="grade" data-testid="fa-lancamentos">
              <thead>
                <tr>
                  <th scope="col">{{ t('anestesia.ficha.inicio') }}</th>
                  <th scope="col">{{ t('anestesia.ficha.parte') }}</th>
                  <th scope="col">{{ t('anestesia.ficha.descricao') }}</th>
                  <th scope="col">{{ t('anestesia.ficha.valor') }}</th>
                  <th scope="col">{{ t('anestesia.ficha.fim') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="l in ficha.lancamentos.filter((x) => x.parte !== 'sinal')"
                  :key="l.id"
                  :data-testid="`fa-lanc-${l.parte}`"
                >
                  <td>{{ hora(l.momento) }}</td>
                  <td>{{ t(`anestesia.ficha.partes.${l.parte}`) }}</td>
                  <td>
                    {{ l.descricao }}
                    <span v-if="l.noBalanco === true" class="secundario">
                      · {{ t('anestesia.ficha.noBalanco') }}</span
                    >
                    <span v-else-if="l.noBalanco === false" class="secundario">
                      · {{ t('anestesia.ficha.foraBalanco') }}</span
                    >
                  </td>
                  <td>{{ l.valor ?? '' }} {{ l.unidade ?? '' }}</td>
                  <td>
                    {{ l.fim ? hora(l.fim) : '' }}
                    <SanteBotao
                      v-if="l.podeEncerrar && pode('ficha') && !assinada"
                      variante="texto"
                      :rotulo="t('anestesia.ficha.encerrar')"
                      :data-testid="`fa-encerrar-${l.id}`"
                      @acionar="encerrar(l.id)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section
          v-if="ficha && ficha.lacunas.length > 0"
          class="cartao"
          aria-labelledby="fa-lacunas"
          data-testid="fa-lacunas"
        >
          <h2 id="fa-lacunas">{{ t('anestesia.ficha.lacunas') }}</h2>
          <ul>
            <li v-for="l in ficha.lacunas" :key="l.inicio" :data-justificada="String(l.justificada)">
              {{ t('anestesia.ficha.intervalo', { de: hora(l.inicio), ate: hora(l.fim) }) }} ·
              {{ l.sinais.map((s) => s.toUpperCase()).join(', ') }}
              <strong v-if="l.justificada"> · {{ t('anestesia.ficha.lacunaJustificada') }}</strong>
              <span v-else-if="pode('ficha') && !assinada" class="barra">
                <span class="campo">
                  <label :for="`fa-motivo-${l.inicio}`">{{ t('anestesia.ficha.motivoLacuna') }}</label>
                  <input
                    :id="`fa-motivo-${l.inicio}`"
                    v-model="motivoLacuna[l.inicio]"
                    maxlength="255"
                    data-testid="fa-motivo-lacuna"
                  />
                </span>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('anestesia.ficha.justificarLacuna')"
                  :desabilitado="(motivoLacuna[l.inicio] ?? '').trim().length < 10"
                  data-testid="fa-justificar"
                  @acionar="justificar(l.inicio, l.fim)"
                />
              </span>
            </li>
          </ul>
        </section>

        <section v-if="ficha" class="cartao" aria-labelledby="fa-resp">
          <h2 id="fa-resp">{{ t('anestesia.ficha.responsaveis') }}</h2>
          <ul data-testid="fa-responsaveis">
            <li v-for="r in ficha.responsaveis" :key="`${r.anestesista}-${r.de}`">
              {{ nome(r.anestesista) }} ·
              {{ t('anestesia.ficha.intervalo', { de: hora(r.de), ate: r.ate ? hora(r.ate) : '' }) }}
            </li>
          </ul>
          <form
            v-if="pode('ficha') && !assinada"
            class="barra"
            data-testid="fa-passagem"
            @submit.prevent="passar"
          >
            <span class="campo">
              <label for="fa-termo-para">{{ t('anestesia.ficha.passarPara') }}</label>
              <input
                id="fa-termo-para"
                v-model="passagem.termo"
                data-testid="fa-termo-para"
                @keydown.enter.prevent="buscarPara"
              />
            </span>
            <SanteBotao variante="secundario" :rotulo="t('anestesia.ficha.buscar')" @acionar="buscarPara" />
            <SanteSelecao
              v-model="passagem.para"
              :rotulo="t('anestesia.ficha.passarPara')"
              :opcoes="opcoesPara"
              :busca="true"
              data-testid="fa-para"
            />
            <span class="campo">
              <label for="fa-resumo">{{ t('anestesia.ficha.resumoPassagem') }}</label>
              <input id="fa-resumo" v-model="passagem.resumo" maxlength="800" data-testid="fa-resumo" />
            </span>
            <SanteBotao
              tipo="submit"
              :rotulo="t('anestesia.ficha.passar')"
              :desabilitado="!passagem.para || passagem.resumo.trim().length < 10"
            />
          </form>
        </section>

        <section v-if="ficha" class="cartao" aria-labelledby="fa-assinatura" data-testid="fa-assinatura">
          <h2 id="fa-assinatura">{{ t('anestesia.ficha.assinar') }}</h2>
          <p v-if="assinada" class="secundario">{{ t('anestesia.prontuarioPendente') }}</p>
          <p v-if="assinada" data-testid="fa-assinada">
            {{
              t('anestesia.ficha.assinadaPor', {
                quem: nome(ficha.assinadaPor),
                quando: hora(ficha.assinadaEm),
              })
            }}
          </p>
          <template v-else>
            <template v-if="ficha.pendenciasAssinatura.length > 0">
              <p>{{ t('anestesia.ficha.pendenciasAssinatura') }}</p>
              <ul data-testid="fa-pendencias">
                <li v-for="p in ficha.pendenciasAssinatura" :key="p" class="alerta">
                  {{ t(`anestesia.recusas.${p}`) }}
                </li>
              </ul>
            </template>
            <form v-if="pode('assinar')" class="barra" @submit.prevent="assinar">
              <span class="campo">
                <label for="fa-senha">{{ t('anestesia.ficha.senha') }}</label>
                <input
                  id="fa-senha"
                  v-model="senha"
                  type="password"
                  autocomplete="current-password"
                  data-testid="fa-senha"
                />
              </span>
              <SanteBotao
                tipo="submit"
                :rotulo="t('anestesia.ficha.assinar')"
                :desabilitado="ficha.pendenciasAssinatura.length > 0 || !senha || ocupado"
                data-testid="fa-assinar"
              />
            </form>
          </template>
          <template v-if="assinada">
            <ul v-if="ficha.adendos.length > 0" data-testid="fa-adendos">
              <li v-for="a in ficha.adendos" :key="a.id">
                {{ hora(a.em) }} · {{ nome(a.profissional) }} · {{ a.texto }}
              </li>
            </ul>
            <form v-if="pode('assinar')" class="barra" @submit.prevent="incluirAdendo">
              <span class="campo">
                <label for="fa-adendo">{{ t('anestesia.ficha.textoAdendo') }}</label>
                <textarea id="fa-adendo" v-model="adendo" maxlength="2000" data-testid="fa-texto-adendo" />
              </span>
              <SanteBotao
                tipo="submit"
                :rotulo="t('anestesia.ficha.adendo')"
                :desabilitado="adendo.trim().length < 10"
                data-testid="fa-adendo"
              />
            </form>
          </template>
        </section>
      </template>
    </template>
  </section>
</template>

<style src="./estilo-anestesia.css"></style>
