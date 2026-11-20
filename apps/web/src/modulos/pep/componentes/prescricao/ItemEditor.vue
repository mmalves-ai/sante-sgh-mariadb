<script setup lang="ts">
// Editor de um item da prescrição (M24; ficha, seção 7): o formulário do tipo de item da aba (medicamento com a
// busca do produto padronizado primeiro, solução com componentes e velocidade, dieta, cuidado, glicemia com escala,
// oxigênio e ventilação, hemoterapia). O item montado confere com o contrato antes de ir à lista; a categoria do
// prescritor esconde o que ela não prescreve (o servidor confere de novo). Regra 12: a dose por kg, por m² ou pelo
// clearance é calculada com o dado mais recente do paciente (o dado e a data aparecem e vão no item, `calculo`); na
// solução, a velocidade de infusão sai do volume e do tempo.
import {
  esquemaItemPrescricao,
  type CategoriaPrescritor,
  type GrupoItemPrescricao,
  type ItemBuscado,
  type ItemPrescricao,
  podePrescrever,
  type TipoItemPrescricao,
  TIPOS_ITEM_PRESCRICAO,
  GRUPO_DO_TIPO,
} from '@sgh/contratos';
import { calcularDose, type RegraDose, velocidadeInfusao } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarProdutos, type DadosClinicosTela, type DominiosPrescricao } from '../../api-prescricao.js';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{
  grupo: GrupoItemPrescricao;
  dominios: DominiosPrescricao;
  categoria: CategoriaPrescritor;
  /** Prefixo do identificador dos campos (dois editores na mesma tela). */
  prefixo?: string;
  /** Regra 12: o dado mais recente do paciente para o cálculo de dose (sem ele, só a dose fixa). */
  dados?: DadosClinicosTela | null;
  /** Só estes tipos (adendo e correção: os que a gravação cobre; POL-3). */
  tipos?: readonly TipoItemPrescricao[];
  /** Os tipos em que "se necessário" é oferecido (padrão: medicamento e cuidado). */
  seNecessarioEm?: readonly TipoItemPrescricao[];
}>();
const emit = defineEmits<{ incluir: [item: ItemPrescricao, nomes: Record<number, string>] }>();
const { t } = useI18n();
const px = computed(() => props.prefixo ?? 'item');

const tiposDoGrupo = computed(() =>
  TIPOS_ITEM_PRESCRICAO.filter(
    (x) =>
      GRUPO_DO_TIPO[x] === props.grupo &&
      podePrescrever(props.categoria, x) &&
      (!props.tipos || props.tipos.includes(x)),
  ),
);
const tipo = ref<TipoItemPrescricao | ''>('');
watch(
  tiposDoGrupo,
  (ts) => {
    if (!tipo.value || !ts.includes(tipo.value)) tipo.value = ts[0] ?? '';
  },
  { immediate: true },
);
const opcoesTipo = computed(() =>
  tiposDoGrupo.value.map((x) => ({ valor: x, rotulo: t(`pep.presc.tipos.${x}`) })),
);

const op = (k: string, filtro?: (g: string | null | undefined) => boolean) => [
  { valor: '', rotulo: t('pep.presc.item.escolha') },
  ...(props.dominios[k] ?? [])
    .filter((o) => !filtro || filtro(o.grupo))
    .map((o) => ({ valor: o.id, rotulo: o.nome })),
];
const opcoesFrequencia = computed(() => [
  { valor: '', rotulo: t('pep.presc.item.semFrequencia') },
  ...(props.dominios['frequencias'] ?? []).map((o) => ({ valor: o.id, rotulo: o.nome })),
]);

// ── Estado do formulário ────────────────────────────────────────────────────────────────────────────
const f = reactive({
  termo: '',
  produto: null as ItemBuscado | null,
  dose: '',
  unidade: '',
  via: '',
  frequencia: '',
  primeiroHorario: '',
  agora: false,
  naoAjustar: false,
  seNecessario: false,
  motivo: '',
  intervalo: '6',
  observacao: '',
  justificativaNp: '',
  cid: '',
  indicacao: '',
  sitio: '',
  tratamento: 'empirico' as 'empirico' | 'dirigido' | 'profilatico',
  cultura: false,
  dia: '1',
  componentes: [] as { produto: ItemBuscado; dose: string; unidade: string; principal: boolean }[],
  tipoInfusao: '',
  velocidade: '',
  unidadeInfusao: '',
  dieta: '',
  quantidade: '',
  viaDieta: '',
  procedimento: '',
  faixas: [] as {
    de: string;
    ate: string;
    produto: ItemBuscado | null;
    dose: string;
    unidade: string;
    via: string;
  }[],
  viaAerea: '',
  modo: '',
  fio2: '',
  peep: '',
  volume: '',
  fr: '',
  pInsp: '',
  pExp: '',
  hemo: '',
  indicacaoHemo: '',
  regraDose: 'fixa' as RegraDose,
  dosePorUnidade: '',
  volumeTotal: '',
  tempoMinutos: '',
});
const encontrados = ref<ItemBuscado[]>([]);
const buscando = ref(false);
const destinoBusca = ref<'produto' | 'componente' | number>('produto');
const faltando = ref<string[]>([]);

async function buscar(destino: 'produto' | 'componente' | number): Promise<void> {
  destinoBusca.value = destino;
  buscando.value = true;
  try {
    encontrados.value = await buscarProdutos(f.termo.trim());
  } finally {
    buscando.value = false;
  }
}
function escolher(p: ItemBuscado): void {
  const d = destinoBusca.value;
  if (d === 'produto') {
    f.produto = p;
    if (p.unidade && !f.unidade) f.unidade = p.unidade;
  } else if (d === 'componente') {
    f.componentes.push({
      produto: p,
      dose: '',
      unidade: p.unidade ?? '',
      principal: f.componentes.length === 0,
    });
  } else {
    const faixa = f.faixas[d];
    if (faixa) {
      faixa.produto = p;
      if (!faixa.unidade) faixa.unidade = p.unidade ?? '';
    }
  }
  encontrados.value = [];
  f.termo = '';
}
function acrescentarFaixa(): void {
  f.faixas.push({ de: '', ate: '', produto: null, dose: '', unidade: '', via: 'SC' });
}

const n = (x: string) => (x.trim() === '' ? undefined : Number(x.replace(',', '.')));
const id = (x: string) => (x === '' ? null : Number(x));
let seq = 0;
const chave = () => `${tipo.value}-${Date.now().toString(36)}-${(seq++).toString(36)}`.slice(0, 40);

// ── Regra 12: cálculo da dose e da velocidade ─────────────────────────────────────────────────────────
const opcoesRegraDose = computed(() =>
  (['fixa', 'por-kg', 'por-m2', 'por-clearance'] as const).map((x) => ({
    valor: x,
    rotulo: t(`pep.presc.item.regrasDose.${x}`),
  })),
);
/** O resultado do cálculo com o dado usado e a data (null na dose fixa). */
const calculoDose = computed(() => {
  if (f.regraDose === 'fixa') return null;
  const por = n(f.dosePorUnidade);
  if (por === undefined || !(por > 0)) return { dose: null, texto: null, falta: null };
  const d = props.dados ?? null;
  const r = calcularDose(f.regraDose, por, {
    pesoKg: d?.pesoKg ?? null,
    alturaCm: d?.alturaCm ?? null,
    idadeAnos: d?.idadeAnos ?? null,
    sexo: d?.sexo ?? null,
    creatinina: d?.creatinina ?? null,
  });
  if (r.dose === null) return { dose: null, texto: null, falta: r.falta };
  const data = f.regraDose === 'por-clearance' ? (d?.dataCreatinina ?? null) : (d?.dataPeso ?? null);
  const base = r.base?.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) ?? '';
  return {
    dose: r.dose,
    falta: null,
    data,
    texto: t(`pep.presc.item.calculoUsado.${f.regraDose}`, {
      dose: r.dose.toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
      base,
      data: dataHoraBr(data) || '—',
    }),
  };
});
watch(
  () => calculoDose.value?.dose ?? null,
  (dose) => {
    if (dose !== null) f.dose = String(dose).replace('.', ',');
  },
);
/** O `calculo` do item: a regra, a dose por unidade e os dados usados com a data. */
function calculoDoItem(): Record<string, unknown> {
  const c = calculoDose.value;
  const d = props.dados ?? null;
  if (f.regraDose === 'fixa' || !c || c.dose === null) return {};
  return {
    calculo: {
      regra: f.regraDose,
      dosePorUnidade: n(f.dosePorUnidade),
      ...(d?.pesoKg ? { peso: d.pesoKg } : {}),
      ...(d?.alturaCm && f.regraDose === 'por-m2' ? { altura: d.alturaCm } : {}),
      ...(d?.clearance && f.regraDose === 'por-clearance' ? { clearance: d.clearance } : {}),
      ...(c.data ? { dataDado: c.data.slice(0, 19) } : {}),
    },
  };
}
/** Velocidade de infusão (mL/h) do volume total e do tempo; null sem os dois. */
const velocidadeCalculada = computed(() => {
  const v = n(f.volumeTotal);
  const m = n(f.tempoMinutos);
  if (v === undefined || m === undefined || !(v > 0) || !(m > 0)) return null;
  return velocidadeInfusao(v, m);
});
watch(velocidadeCalculada, (v) => {
  if (v !== null) f.velocidade = String(v).replace('.', ',');
});

function montar(): unknown {
  const comum = {
    chave: chave(),
    ...(f.observacao.trim() ? { observacaoEnfermagem: f.observacao.trim() } : {}),
  };
  const sn =
    f.seNecessario && f.motivo
      ? { seNecessario: { motivos: [Number(f.motivo)], intervaloMinimoHoras: n(f.intervalo) ?? 6 } }
      : {};
  switch (tipo.value) {
    case 'medicamento':
      return {
        ...comum,
        detalhe: {
          tipo: 'medicamento',
          item: {
            produto: f.produto?.produto,
            ...(f.produto && !f.produto.padronizado
              ? { naoPadronizado: { justificativa: f.justificativaNp.trim(), cid: f.cid.trim() } }
              : {}),
          },
          dose: n(f.dose),
          unidade: f.unidade,
          via: f.via,
          frequencia: id(f.frequencia),
          iniciarAgora: f.agora,
          naoAjustar: f.naoAjustar,
          ...(f.primeiroHorario ? { primeiroHorario: f.primeiroHorario } : {}),
          ...sn,
        },
        ...calculoDoItem(),
        ...(f.produto?.antimicrobiano
          ? {
              antimicrobiano: {
                indicacao: f.indicacao.trim(),
                sitio: f.sitio.trim(),
                tipo: f.tratamento,
                culturaColhida: f.cultura,
                diaTratamento: Number(f.dia) || 1,
              },
            }
          : {}),
      };
    case 'solucao':
      return {
        ...comum,
        detalhe: {
          tipo: 'solucao',
          via: f.via || 'EV',
          frequencia: id(f.frequencia),
          ...(f.tipoInfusao ? { tipoInfusao: Number(f.tipoInfusao) } : {}),
          componentes: f.componentes.map((c) => ({
            produto: c.produto.produto,
            dose: n(c.dose),
            unidade: c.unidade,
            principal: c.principal,
          })),
          etapas: [{ etapa: 1, velocidade: n(f.velocidade), unidadeInfusao: id(f.unidadeInfusao) }],
          iniciarAgora: f.agora,
          naoAjustar: f.naoAjustar,
        },
      };
    case 'jejum':
    case 'dieta-livre':
      return { ...comum, detalhe: { tipo: tipo.value, dieta: id(f.dieta), frequencia: id(f.frequencia) } };
    case 'dieta-oral':
      return {
        ...comum,
        detalhe: {
          tipo: 'dieta-oral',
          dieta: id(f.dieta),
          frequencia: id(f.frequencia),
          quantidade: n(f.quantidade),
        },
      };
    case 'dieta-enteral':
      return {
        ...comum,
        detalhe: {
          tipo: 'dieta-enteral',
          dieta: id(f.dieta),
          frequencia: id(f.frequencia),
          viaDieta: id(f.viaDieta),
          quantidade: n(f.quantidade),
          unidade: f.unidade,
          tipoInfusao: id(f.tipoInfusao),
          ...(f.velocidade ? { velocidade: n(f.velocidade), unidadeInfusao: id(f.unidadeInfusao) } : {}),
        },
      };
    case 'procedimento':
      return {
        ...comum,
        detalhe: {
          tipo: 'procedimento',
          procedimento: id(f.procedimento),
          frequencia: id(f.frequencia),
          iniciarAgora: f.agora,
          naoAjustar: f.naoAjustar,
          ...(f.primeiroHorario ? { primeiroHorario: f.primeiroHorario } : {}),
          ...sn,
        },
      };
    case 'glicemia':
      return {
        ...comum,
        detalhe: {
          tipo: 'glicemia',
          procedimento: id(f.procedimento),
          frequencia: id(f.frequencia),
          faixas: f.faixas.map((x) => ({
            de: Number(x.de),
            ate: Number(x.ate),
            produto: x.produto?.produto,
            dose: n(x.dose),
            unidade: x.unidade,
            via: x.via,
          })),
        },
      };
    case 'vni':
    case 'vmi':
      return {
        ...comum,
        detalhe: {
          tipo: tipo.value,
          viaAerea: id(f.viaAerea),
          modo: id(f.modo),
          frequencia: id(f.frequencia),
          ...(f.fio2 ? { fio2: n(f.fio2) } : {}),
          ...(f.peep ? { peep: n(f.peep) } : {}),
          ...(f.volume ? { volumeCorrente: n(f.volume) } : {}),
          ...(f.fr ? { frequenciaRespiratoria: n(f.fr) } : {}),
          ...(f.pInsp ? { pressaoInspiratoria: n(f.pInsp) } : {}),
          ...(f.pExp ? { pressaoExpiratoria: n(f.pExp) } : {}),
        },
      };
    case 'hemoterapia': {
      const [ato, codigo] = f.hemo.split(':');
      return {
        ...comum,
        detalhe: {
          tipo: 'hemoterapia',
          hemocomponente: { ato: Number(ato), codigo: codigo ?? '' },
          dose: n(f.dose),
          unidade: f.unidade,
          frequencia: id(f.frequencia),
          indicacao: f.indicacaoHemo.trim(),
          iniciarAgora: f.agora,
        },
      };
    }
    default:
      return null;
  }
}

function incluir(): void {
  const r = esquemaItemPrescricao.safeParse(montar());
  if (!r.success) {
    faltando.value = [...new Set(r.error.issues.map((i) => String(i.path.at(-1) ?? '')))].filter(Boolean);
    return;
  }
  faltando.value = [];
  const nomes: Record<number, string> = {};
  for (const p of [f.produto, ...f.componentes.map((x) => x.produto), ...f.faixas.map((x) => x.produto)])
    if (p) nomes[p.produto] = p.nome;
  emit('incluir', r.data, nomes);
  f.produto = null;
  f.dose = '';
  f.observacao = '';
  f.componentes = [];
  f.faixas = [];
  f.seNecessario = false;
  f.agora = false;
  f.regraDose = 'fixa';
  f.dosePorUnidade = '';
  f.volumeTotal = '';
  f.tempoMinutos = '';
}

const ehDietaTipo = computed(() =>
  ['jejum', 'dieta-livre', 'dieta-oral', 'dieta-enteral'].includes(tipo.value),
);
const planoDaDieta: Record<string, string> = {
  jejum: '1',
  'dieta-livre': '2',
  'dieta-oral': '3',
  'dieta-enteral': '4',
};
const opcoesDieta = computed(() => op('dietas', (g) => !g || g === planoDaDieta[tipo.value]));
const opcoesModo = computed(() => op('modos', (g) => !g || g === (tipo.value === 'vmi' ? '12' : '11')));
</script>

<template>
  <form class="editor-item" :data-testid="`editor-${grupo}`" @submit.prevent="incluir">
    <p v-if="tiposDoGrupo.length === 0" role="status">{{ t('pep.presc.item.foraDaCategoria') }}</p>
    <template v-else>
      <SanteSelecao
        v-if="tiposDoGrupo.length > 1"
        v-model="tipo"
        :rotulo="t('pep.presc.editor.abas')"
        :opcoes="opcoesTipo"
        data-testid="tipo-item"
      />

      <!-- Produto: medicamento, componente da solução e produto da faixa da glicemia. -->
      <fieldset v-if="tipo === 'medicamento' || tipo === 'solucao' || tipo === 'glicemia'" class="busca">
        <legend>
          {{ tipo === 'solucao' ? t('pep.presc.item.componentes') : t('pep.presc.item.buscarProduto') }}
        </legend>
        <p v-if="tipo === 'medicamento' && f.produto" data-testid="produto-escolhido">
          {{ t('pep.presc.item.escolhido', { nome: f.produto.nome }) }}
          <span v-if="!f.produto.padronizado" class="marca">{{ t('pep.presc.item.naoPadronizado') }}</span>
          <span v-if="f.produto.altoAlerta" class="marca alerta">{{ t('pep.presc.item.altoAlerta') }}</span>
          <span v-if="f.produto.controlado" class="marca">{{ t('pep.presc.item.controlado') }}</span>
          <span v-if="f.produto.antimicrobiano" class="marca">{{ t('pep.presc.item.antimicrobiano') }}</span>
          <SanteBotao :rotulo="t('pep.presc.item.trocar')" variante="texto" @acionar="f.produto = null" />
        </p>
        <div v-else class="linha">
          <div class="campo">
            <label :for="`${px}-termo`">{{ t('pep.presc.item.buscarProduto') }}</label>
            <input
              :id="`${px}-termo`"
              v-model="f.termo"
              type="search"
              maxlength="60"
              autocomplete="off"
              data-testid="busca-produto"
              @keydown.enter.prevent="buscar(tipo === 'solucao' ? 'componente' : 'produto')"
            />
          </div>
          <SanteBotao
            :rotulo="t('pep.presc.item.buscar')"
            variante="secundario"
            data-testid="buscar-produto"
            @acionar="buscar(tipo === 'solucao' ? 'componente' : 'produto')"
          />
        </div>
        <ul
          v-if="encontrados.length"
          class="resultado"
          :aria-label="t('pep.presc.item.resultado')"
          data-testid="produtos-encontrados"
        >
          <li v-for="p in encontrados" :key="p.produto">
            <button type="button" class="link" :data-testid="`produto-${p.produto}`" @click="escolher(p)">
              {{ p.nome }}
            </button>
            <span v-if="!p.padronizado" class="marca">{{ t('pep.presc.item.naoPadronizado') }}</span>
            <span v-if="p.altoAlerta" class="marca alerta">{{ t('pep.presc.item.altoAlerta') }}</span>
            <span v-if="p.antimicrobiano" class="marca">{{ t('pep.presc.item.antimicrobiano') }}</span>
          </li>
        </ul>
        <p v-else-if="buscando" role="status">{{ t('pep.presc.carregando') }}</p>
      </fieldset>

      <!-- Medicamento -->
      <template v-if="tipo === 'medicamento'">
        <div class="linha" data-testid="calculo-dose">
          <SanteSelecao
            v-model="f.regraDose"
            :rotulo="t('pep.presc.item.regraDose')"
            :opcoes="opcoesRegraDose"
            data-testid="regra-dose"
          />
          <div v-if="f.regraDose !== 'fixa'" class="campo curto">
            <label :for="`${px}-dpu`">{{ t(`pep.presc.item.dosePorUnidade.${f.regraDose}`) }}</label>
            <input
              :id="`${px}-dpu`"
              v-model="f.dosePorUnidade"
              inputmode="decimal"
              data-testid="dose-por-unidade"
            />
          </div>
        </div>
        <p v-if="calculoDose?.texto" role="status" data-testid="dose-calculada">{{ calculoDose.texto }}</p>
        <SanteAlerta
          v-else-if="calculoDose?.falta"
          variante="aviso"
          :texto="t(`pep.presc.item.faltaDado.${calculoDose.falta}`)"
          data-testid="dose-sem-dado"
        />
        <div class="linha">
          <div class="campo curto">
            <label :for="`${px}-dose`">{{ t('pep.presc.item.dose') }}</label>
            <input :id="`${px}-dose`" v-model="f.dose" inputmode="decimal" data-testid="dose" />
          </div>
          <SanteSelecao
            v-model="f.unidade"
            :rotulo="t('pep.presc.item.unidade')"
            :opcoes="op('unidades')"
            data-testid="unidade"
          />
          <SanteSelecao
            v-model="f.via"
            :rotulo="t('pep.presc.item.via')"
            :opcoes="op('vias')"
            data-testid="via"
          />
          <SanteSelecao
            v-model="f.frequencia"
            :rotulo="t('pep.presc.item.frequencia')"
            :opcoes="opcoesFrequencia"
            data-testid="frequencia"
          />
          <div class="campo curto">
            <label :for="`${px}-primeiro`">{{ t('pep.presc.item.primeiroHorario') }}</label>
            <input :id="`${px}-primeiro`" v-model="f.primeiroHorario" type="time" />
          </div>
        </div>
        <fieldset v-if="f.produto && !f.produto.padronizado">
          <legend>{{ t('pep.presc.item.naoPadronizado') }}</legend>
          <div class="campo">
            <label :for="`${px}-jnp`">{{ t('pep.presc.item.justificativaNaoPadronizado') }}</label>
            <textarea :id="`${px}-jnp`" v-model="f.justificativaNp" maxlength="500" rows="2" />
          </div>
          <div class="campo curto">
            <label :for="`${px}-cid`">{{ t('pep.presc.item.cid') }}</label>
            <input :id="`${px}-cid`" v-model="f.cid" maxlength="10" />
          </div>
        </fieldset>
        <fieldset v-if="f.produto?.antimicrobiano" data-testid="ficha-antimicrobiano">
          <legend>{{ t('pep.presc.item.ficha') }}</legend>
          <div class="linha">
            <div class="campo">
              <label :for="`${px}-ind`">{{ t('pep.presc.item.indicacao') }}</label>
              <input :id="`${px}-ind`" v-model="f.indicacao" maxlength="500" data-testid="ficha-indicacao" />
            </div>
            <div class="campo">
              <label :for="`${px}-sitio`">{{ t('pep.presc.item.sitio') }}</label>
              <input :id="`${px}-sitio`" v-model="f.sitio" maxlength="100" data-testid="ficha-sitio" />
            </div>
            <SanteSelecao
              v-model="f.tratamento"
              :rotulo="t('pep.presc.item.tipoTratamento')"
              :opcoes="
                (['empirico', 'dirigido', 'profilatico'] as const).map((x) => ({
                  valor: x,
                  rotulo: t(`pep.presc.item.tiposTratamento.${x}`),
                }))
              "
            />
            <div class="campo curto">
              <label :for="`${px}-dia`">{{ t('pep.presc.item.dia') }}</label>
              <input :id="`${px}-dia`" v-model="f.dia" inputmode="numeric" />
            </div>
            <label class="marcar"
              ><input v-model="f.cultura" type="checkbox" /> {{ t('pep.presc.item.cultura') }}</label
            >
          </div>
        </fieldset>
      </template>

      <!-- Solução -->
      <template v-if="tipo === 'solucao'">
        <table v-if="f.componentes.length" class="grade">
          <caption>
            {{
              t('pep.presc.item.componentes')
            }}
          </caption>
          <tbody>
            <tr v-for="(c, i) in f.componentes" :key="i">
              <th scope="row">{{ c.produto.nome }}</th>
              <td>
                <label :for="`${px}-cd-${i}`" class="oculto">{{ t('pep.presc.item.dose') }}</label>
                <input
                  :id="`${px}-cd-${i}`"
                  v-model="c.dose"
                  inputmode="decimal"
                  :placeholder="t('pep.presc.item.dose')"
                />
              </td>
              <td>
                <label :for="`${px}-cu-${i}`" class="oculto">{{ t('pep.presc.item.unidade') }}</label>
                <input :id="`${px}-cu-${i}`" v-model="c.unidade" maxlength="10" />
              </td>
              <td>
                <label class="marcar"
                  ><input v-model="c.principal" type="checkbox" /> {{ t('pep.presc.item.principal') }}</label
                >
              </td>
            </tr>
          </tbody>
        </table>
        <div class="linha">
          <SanteSelecao v-model="f.via" :rotulo="t('pep.presc.item.via')" :opcoes="op('vias')" />
          <SanteSelecao
            v-model="f.frequencia"
            :rotulo="t('pep.presc.item.frequencia')"
            :opcoes="opcoesFrequencia"
          />
          <SanteSelecao
            v-model="f.tipoInfusao"
            :rotulo="t('pep.presc.item.tipoInfusao')"
            :opcoes="op('tiposInfusao')"
          />
          <div class="campo curto">
            <label :for="`${px}-vtot`">{{ t('pep.presc.item.volumeTotal') }}</label>
            <input
              :id="`${px}-vtot`"
              v-model="f.volumeTotal"
              inputmode="decimal"
              data-testid="volume-total"
            />
          </div>
          <div class="campo curto">
            <label :for="`${px}-tmin`">{{ t('pep.presc.item.tempoMinutos') }}</label>
            <input
              :id="`${px}-tmin`"
              v-model="f.tempoMinutos"
              inputmode="numeric"
              data-testid="tempo-minutos"
            />
          </div>
          <div class="campo curto">
            <label :for="`${px}-vel`">{{ t('pep.presc.item.velocidade') }}</label>
            <input :id="`${px}-vel`" v-model="f.velocidade" inputmode="decimal" data-testid="velocidade" />
          </div>
          <SanteSelecao
            v-model="f.unidadeInfusao"
            :rotulo="t('pep.presc.item.unidadeInfusao')"
            :opcoes="op('unidadesInfusao')"
          />
        </div>
        <p v-if="velocidadeCalculada !== null" role="status" data-testid="velocidade-calculada">
          {{
            t('pep.presc.item.velocidadeCalculada', { valor: String(velocidadeCalculada).replace('.', ',') })
          }}
        </p>
      </template>

      <!-- Dietas -->
      <div v-if="ehDietaTipo" class="linha">
        <SanteSelecao
          v-model="f.dieta"
          :rotulo="t('pep.presc.item.dieta')"
          :opcoes="opcoesDieta"
          data-testid="dieta"
        />
        <SanteSelecao
          v-model="f.frequencia"
          :rotulo="t('pep.presc.item.frequencia')"
          :opcoes="opcoesFrequencia"
        />
        <div v-if="tipo === 'dieta-oral' || tipo === 'dieta-enteral'" class="campo curto">
          <label :for="`${px}-qt`">{{ t('pep.presc.item.quantidade') }}</label>
          <input :id="`${px}-qt`" v-model="f.quantidade" inputmode="decimal" data-testid="quantidade" />
        </div>
        <template v-if="tipo === 'dieta-enteral'">
          <SanteSelecao
            v-model="f.viaDieta"
            :rotulo="t('pep.presc.item.viaDieta')"
            :opcoes="op('viasDieta')"
          />
          <SanteSelecao v-model="f.unidade" :rotulo="t('pep.presc.item.unidade')" :opcoes="op('unidades')" />
          <SanteSelecao
            v-model="f.tipoInfusao"
            :rotulo="t('pep.presc.item.tipoInfusao')"
            :opcoes="op('tiposInfusao')"
          />
          <div class="campo curto">
            <label :for="`${px}-veld`">{{ t('pep.presc.item.velocidade') }}</label>
            <input :id="`${px}-veld`" v-model="f.velocidade" inputmode="decimal" />
          </div>
          <SanteSelecao
            v-model="f.unidadeInfusao"
            :rotulo="t('pep.presc.item.unidadeInfusao')"
            :opcoes="op('unidadesInfusao')"
          />
        </template>
      </div>

      <!-- Cuidado e glicemia -->
      <template v-if="tipo === 'procedimento' || tipo === 'glicemia'">
        <div class="linha">
          <SanteSelecao
            v-model="f.procedimento"
            :rotulo="t('pep.presc.item.procedimento')"
            :opcoes="op('procedimentos')"
            data-testid="procedimento"
          />
          <SanteSelecao
            v-model="f.frequencia"
            :rotulo="t('pep.presc.item.frequencia')"
            :opcoes="opcoesFrequencia"
            data-testid="frequencia-cuidado"
          />
          <div v-if="tipo === 'procedimento'" class="campo curto">
            <label :for="`${px}-primeiro-c`">{{ t('pep.presc.item.primeiroHorario') }}</label>
            <input :id="`${px}-primeiro-c`" v-model="f.primeiroHorario" type="time" />
          </div>
        </div>
        <fieldset v-if="tipo === 'glicemia'">
          <legend>{{ t('pep.presc.item.faixas') }}</legend>
          <div v-for="(x, i) in f.faixas" :key="i" class="linha">
            <span class="faixa">{{ t('pep.presc.item.faixa', { n: i + 1 }) }}</span>
            <div class="campo curto">
              <label :for="`${px}-de-${i}`">{{ t('pep.presc.item.de') }}</label>
              <input :id="`${px}-de-${i}`" v-model="x.de" inputmode="numeric" />
            </div>
            <div class="campo curto">
              <label :for="`${px}-ate-${i}`">{{ t('pep.presc.item.ate') }}</label>
              <input :id="`${px}-ate-${i}`" v-model="x.ate" inputmode="numeric" />
            </div>
            <span v-if="x.produto">{{ x.produto.nome }}</span>
            <SanteBotao
              v-else
              :rotulo="t('pep.presc.item.buscar')"
              variante="secundario"
              @acionar="buscar(i)"
            />
            <div class="campo curto">
              <label :for="`${px}-fd-${i}`">{{ t('pep.presc.item.dose') }}</label>
              <input :id="`${px}-fd-${i}`" v-model="x.dose" inputmode="decimal" />
            </div>
          </div>
          <div v-if="f.faixas.length" class="campo">
            <label :for="`${px}-termo-f`">{{ t('pep.presc.item.buscarProduto') }}</label>
            <input :id="`${px}-termo-f`" v-model="f.termo" type="search" maxlength="60" />
          </div>
          <SanteBotao
            :rotulo="t('pep.presc.item.acrescentarFaixa')"
            variante="secundario"
            @acionar="acrescentarFaixa"
          />
        </fieldset>
      </template>

      <!-- Oxigênio e ventilação -->
      <div v-if="tipo === 'vni' || tipo === 'vmi'" class="linha">
        <SanteSelecao
          v-model="f.viaAerea"
          :rotulo="t('pep.presc.item.viaAerea')"
          :opcoes="op('viasAereas')"
        />
        <SanteSelecao v-model="f.modo" :rotulo="t('pep.presc.item.modo')" :opcoes="opcoesModo" />
        <SanteSelecao
          v-model="f.frequencia"
          :rotulo="t('pep.presc.item.frequencia')"
          :opcoes="opcoesFrequencia"
        />
        <div class="campo curto">
          <label :for="`${px}-fio2`">{{ t('pep.presc.item.fio2') }}</label>
          <input :id="`${px}-fio2`" v-model="f.fio2" inputmode="numeric" />
        </div>
        <template v-if="tipo === 'vmi'">
          <div class="campo curto">
            <label :for="`${px}-peep`">{{ t('pep.presc.item.peep') }}</label>
            <input :id="`${px}-peep`" v-model="f.peep" inputmode="numeric" />
          </div>
          <div class="campo curto">
            <label :for="`${px}-vol`">{{ t('pep.presc.item.volume') }}</label>
            <input :id="`${px}-vol`" v-model="f.volume" inputmode="numeric" />
          </div>
          <div class="campo curto">
            <label :for="`${px}-fr`">{{ t('pep.presc.item.fr') }}</label>
            <input :id="`${px}-fr`" v-model="f.fr" inputmode="numeric" />
          </div>
        </template>
        <template v-else>
          <div class="campo curto">
            <label :for="`${px}-pi`">{{ t('pep.presc.item.pressaoInsp') }}</label>
            <input :id="`${px}-pi`" v-model="f.pInsp" inputmode="numeric" />
          </div>
          <div class="campo curto">
            <label :for="`${px}-pe`">{{ t('pep.presc.item.pressaoExp') }}</label>
            <input :id="`${px}-pe`" v-model="f.pExp" inputmode="numeric" />
          </div>
        </template>
      </div>

      <!-- Hemoterapia -->
      <template v-if="tipo === 'hemoterapia'">
        <div class="linha">
          <SanteSelecao
            v-model="f.hemo"
            :rotulo="t('pep.presc.item.hemocomponente')"
            :opcoes="op('hemocomponentes')"
            data-testid="hemocomponente"
          />
          <div class="campo curto">
            <label :for="`${px}-hd`">{{ t('pep.presc.item.dose') }}</label>
            <input :id="`${px}-hd`" v-model="f.dose" inputmode="decimal" data-testid="dose-hemo" />
          </div>
          <SanteSelecao
            v-model="f.unidade"
            :rotulo="t('pep.presc.item.unidade')"
            :opcoes="op('unidades')"
            data-testid="unidade-hemo"
          />
          <SanteSelecao
            v-model="f.frequencia"
            :rotulo="t('pep.presc.item.frequencia')"
            :opcoes="opcoesFrequencia"
          />
        </div>
        <div class="campo">
          <label :for="`${px}-ih`">{{ t('pep.presc.item.indicacaoHemo') }}</label>
          <textarea
            :id="`${px}-ih`"
            v-model="f.indicacaoHemo"
            maxlength="2000"
            rows="2"
            data-testid="indicacao-hemo"
          />
        </div>
      </template>

      <!-- Comum -->
      <div class="linha">
        <label v-if="tipo !== 'jejum' && tipo !== 'dieta-livre'" class="marcar">
          <input v-model="f.agora" type="checkbox" /> {{ t('pep.presc.item.agora') }}
        </label>
        <label
          v-if="tipo && (seNecessarioEm ?? ['medicamento', 'procedimento']).includes(tipo)"
          class="marcar"
        >
          <input v-model="f.seNecessario" type="checkbox" data-testid="se-necessario" />
          {{ t('pep.presc.item.seNecessario') }}
        </label>
        <template v-if="f.seNecessario">
          <SanteSelecao v-model="f.motivo" :rotulo="t('pep.presc.item.motivo')" :opcoes="op('motivos')" />
          <div class="campo curto">
            <label :for="`${px}-int`">{{ t('pep.presc.item.intervalo') }}</label>
            <input :id="`${px}-int`" v-model="f.intervalo" inputmode="numeric" />
          </div>
        </template>
      </div>
      <div class="campo">
        <label :for="`${px}-obs`">{{ t('pep.presc.item.observacao') }}</label>
        <textarea :id="`${px}-obs`" v-model="f.observacao" maxlength="2000" rows="2" />
      </div>
      <SanteAlerta
        v-if="faltando.length"
        variante="aviso"
        :texto="t('pep.presc.item.incompleto', { campos: faltando.join(', ') })"
        data-testid="item-incompleto"
      />
      <SanteBotao :rotulo="t('pep.presc.item.incluir')" tipo="submit" data-testid="incluir-item" />
    </template>
  </form>
</template>

<style scoped>
.editor-item {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.campo.curto input {
  width: 8rem;
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
}
textarea {
  width: 100%;
  max-width: 48rem;
}
fieldset {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.resultado {
  list-style: none;
  padding: 0;
  margin: var(--sgh-espaco-1) 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.link {
  font: inherit;
  background: none;
  border: none;
  color: var(--sgh-link);
  text-decoration: underline;
  cursor: pointer;
  min-height: var(--sgh-alvo-minimo);
  padding: 0;
}
.marca {
  margin-left: var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
.marca.alerta {
  font-weight: 700;
}
.marcar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
.grade {
  border-collapse: collapse;
}
.grade th,
.grade td {
  padding: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  text-align: left;
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.faixa {
  font-weight: 600;
}
</style>
