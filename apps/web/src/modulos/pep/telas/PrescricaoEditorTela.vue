<script setup lang="ts">
// Editor da prescrição (M24; ficha, seção 7): itens por aba (medicamentos, soluções, dietas, cuidados e glicemia,
// oxigênio e ventilação, hemoterapia), aplicar protocolo, copiar ou renovar a anterior com confirmação item a item,
// verificar os alertas de apoio à decisão (com a justificativa de quem mantém o item) e os horários previstos pela
// regra da unidade, e assinar. Sem conexão, nada é gravado nem guardado no aparelho.
import {
  type AlertaPrescricao,
  type CategoriaPrescritor,
  GRUPOS_ITEM_PRESCRICAO,
  type GrupoItemPrescricao,
  type ItemPrescricao,
  type PrescricaoLida,
  type Verificacao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  itensDoProtocolo,
  lerContexto,
  lerDominiosPrescricao,
  lerFuturas,
  lerLiberacaoPrescricao,
  lerPrescricao,
  listarProtocolos,
  novaChave,
  prescrever,
  verificar,
} from '../api-prescricao.js';
import CabecalhoProntuario from '../componentes/CabecalhoProntuario.vue';
import ItemEditor from '../componentes/prescricao/ItemEditor.vue';
import PainelAlertas from '../componentes/prescricao/PainelAlertas.vue';
import AtalhosFavoritos from '../componentes/prescricao/AtalhosFavoritos.vue';
import { aplicacaoDoKit, type FavoritoPrescritor, listarKitsPadrao } from '../api-padroes-prescricao.js';
import { useConexao } from '../conexao.js';
import { agoraLocal, descreverItem } from '../descricao-item.js';
import { dataHoraBr } from '../formato.js';
import DadosClinicos from '../componentes/prescricao/DadosClinicos.vue';
import AvisoCoberturaPrescricao from '../../faturamento/componentes/AvisoCoberturaPrescricao.vue';
import type { ItemConferencia } from '../../faturamento/api-cobertura.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const online = useConexao();
const id = computed(() => Number(props.paciente));
const q = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');

const contexto = useQuery({
  queryKey: computed(() => ['presc', 'contexto', id.value]),
  queryFn: () => lerContexto(id.value),
});
const dominios = useQuery({
  queryKey: ['presc', 'dominios'],
  queryFn: () => lerDominiosPrescricao(),
  staleTime: 300_000,
});
const liberacao = useQuery({ queryKey: ['presc', 'liberacao'], queryFn: () => lerLiberacaoPrescricao() });
const c = computed(() => contexto.data.value);
const categoria = computed<CategoriaPrescritor>(
  () => (c.value?.prescritor?.categoria ?? 'outro') as CategoriaPrescritor,
);

const atendimento = ref(q('atendimento'));
watch(c, (x) => {
  if (x && !atendimento.value) atendimento.value = String(x.atendimentos.find((a) => a.periodos)?.id ?? '');
});
const at = computed(() => c.value?.atendimentos.find((a) => String(a.id) === atendimento.value) ?? null);
const opcoesAtendimento = computed(() =>
  (c.value?.atendimentos ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: t('pep.presc.paciente.atendimentoRotulo', {
      tipo: a.tipo,
      numero: a.numero ?? a.id,
      unidade: a.unidade ?? '',
    }),
  })),
);
const periodo = ref<'atual' | 'seguinte'>(q('periodo') === 'seguinte' ? 'seguinte' : 'atual');
watch(at, (a) => {
  if (a?.periodos && !q('periodo')) periodo.value = a.periodos.atual.ocupado ? 'seguinte' : 'atual';
});
const opcoesPeriodo = computed(() =>
  at.value?.periodos
    ? (['atual', 'seguinte'] as const).map((p) => ({
        valor: p,
        rotulo: `${t(p === 'atual' ? 'pep.presc.editor.periodoAtual' : 'pep.presc.editor.periodoSeguinte', {
          inicio: dataHoraBr(at.value!.periodos![p].inicio),
          fim: dataHoraBr(at.value!.periodos![p].fim),
        })} ${at.value!.periodos![p].ocupado ? t('pep.presc.paciente.ocupado') : ''}`.trim(),
      }))
    : [],
);
const prioridade = ref<'rotina' | 'urgente'>('rotina');
const observacaoGeral = ref('');
const justificativaRetroativo = ref('');

// ── Abas ──────────────────────────────────────────────────────────────────────────────────────────
const grupoInicial = (GRUPOS_ITEM_PRESCRICAO as readonly string[]).includes(q('grupo'))
  ? (q('grupo') as GrupoItemPrescricao)
  : 'medicamentos';
const aba = ref<GrupoItemPrescricao>(grupoInicial);

// ── Itens ─────────────────────────────────────────────────────────────────────────────────────────
const itens = ref<ItemPrescricao[]>([]);
// F7 (09-AREA linha 76): o aviso da cobertura da fonte pagadora vai por todo item que se cobra. O hemocomponente vai
// pelo código faturável; medicamento, componente de solução e insulina da escala, pelo item prescritível (o servidor
// resolve o item faturável dele ou do insumo ligado); procedimento e glicemia, pelo cuidado de enfermagem.
const itensCobertura = computed<ItemConferencia[]>(() => {
  const lista: ItemConferencia[] = [];
  const vistos = new Set<string>();
  const por = (chave: string, i: ItemConferencia) => {
    if (!vistos.has(chave)) {
      vistos.add(chave);
      lista.push(i);
    }
  };
  for (const { detalhe: d } of itens.value) {
    if (d.tipo === 'hemoterapia')
      por(`c${d.hemocomponente.codigo}`, { codigo: d.hemocomponente.codigo, quantidade: 1 });
    else if (d.tipo === 'medicamento')
      por(`p${d.item.produto}`, { itemPrescritivelId: d.item.produto, quantidade: 1 });
    else if (d.tipo === 'solucao')
      for (const c of d.componentes) por(`p${c.produto}`, { itemPrescritivelId: c.produto, quantidade: 1 });
    else if (d.tipo === 'procedimento' || d.tipo === 'glicemia') {
      por(`q${d.procedimento}`, { cuidadoId: d.procedimento, quantidade: 1 });
      if (d.tipo === 'glicemia')
        for (const f of d.faixas) por(`p${f.produto}`, { itemPrescritivelId: f.produto, quantidade: 1 });
    }
  }
  return lista;
});
const produtosVistos = reactive(new Map<number, string>());
const dominio = (lista: string, v: string | number | null | undefined) =>
  v === null || v === undefined
    ? null
    : (dominios.data.value?.[lista]?.find((o) => o.id === String(v))?.nome ?? null);
const nomes = { produtos: produtosVistos, dominio };
const rotulos = computed(() =>
  Object.fromEntries(itens.value.map((i) => [i.chave, descreverItem(i, nomes)])),
);

function incluir(i: ItemPrescricao, nome?: string): void {
  if (nome && i.detalhe.tipo === 'medicamento') produtosVistos.set(i.detalhe.item.produto, nome);
  itens.value = [...itens.value, i];
}
function tirar(chave: string): void {
  itens.value = itens.value.filter((i) => i.chave !== chave);
}
function aoIncluir(i: ItemPrescricao, vistos: Record<number, string>): void {
  for (const [k, v] of Object.entries(vistos)) produtosVistos.set(Number(k), v);
  incluir(i);
}

// ── Origem (copiar ou renovar) ────────────────────────────────────────────────────────────────────
const modo = computed<'copia' | 'renovacao' | null>(() =>
  q('modo') === 'copia' || q('modo') === 'renovacao' ? (q('modo') as 'copia' | 'renovacao') : null,
);
const origemId = computed(() => (q('origem') ? Number(q('origem')) : null));
const origem = useQuery({
  queryKey: computed(() => ['presc', 'origem', id.value, origemId.value]),
  queryFn: () => lerPrescricao(id.value, origemId.value!),
  enabled: computed(() => origemId.value !== null),
});
const confirmados = reactive<Record<number, boolean>>({});
const origemLevada = ref(false);
function levarOrigem(o: PrescricaoLida): void {
  for (const it of o.itensLidos)
    if (confirmados[it.id] && it.detalhe) {
      if (it.produto) produtosVistos.set(it.produto, it.descricao);
      incluir({
        chave: `o${it.id}`.slice(0, 40),
        detalhe: it.detalhe,
        origem: { item: it.id, alterado: false },
        autopreenchido: [],
        decisoes: [],
        ...(it.observacaoEnfermagem ? { observacaoEnfermagem: it.observacaoEnfermagem } : {}),
      });
    }
  origemLevada.value = true;
}

// ── Protocolo ─────────────────────────────────────────────────────────────────────────────────────
const montar = computed(() => q('montar') === '1');
const protocolos = useQuery({
  queryKey: computed(() => ['presc', 'protocolos', id.value]),
  queryFn: () => listarProtocolos(id.value),
  enabled: montar,
});
const protocolo = ref('');
const opcoesProtocolo = computed(() => [
  { valor: '', rotulo: t('pep.presc.editor.protocoloEscolher') },
  ...(protocolos.data.value ?? []).map((p) => ({
    valor: String(p.id),
    rotulo: p.aplicavel
      ? p.nome
      : `${p.nome} — ${t('pep.presc.editor.protocoloInaplicavel', { motivo: p.motivo ?? '' })}`,
  })),
]);
const avisoProtocolo = ref('');
async function aplicarProtocolo(): Promise<void> {
  if (!protocolo.value) return;
  const escolhido = protocolos.data.value?.find((p) => String(p.id) === protocolo.value);
  if (escolhido && !escolhido.aplicavel) {
    avisoProtocolo.value = t('pep.presc.editor.protocoloInaplicavel', { motivo: escolhido.motivo ?? '' });
    return;
  }
  const ps = await itensDoProtocolo(Number(protocolo.value));
  let ok = 0;
  for (const p of ps)
    if (p.sugestao) {
      ok++;
      incluir({
        chave: `p${p.id}-${Date.now().toString(36)}`.slice(0, 40),
        detalhe: p.sugestao,
        protocolo: Number(protocolo.value),
        autopreenchido: ['dose'],
        decisoes: [],
      });
    }
  avisoProtocolo.value = [
    t('pep.presc.editor.protocoloAplicado', { n: ok }),
    ps.length > ok ? t('pep.presc.editor.protocoloRevisar', { n: ps.length - ok }) : '',
  ]
    .filter(Boolean)
    .join(' ');
}
// ── Kit de medicamentos ou de soluções (03-PEP L107) ──────────────────────────────────────────────
const kits = useQuery({
  queryKey: ['presc', 'kits'],
  queryFn: () => listarKitsPadrao(),
  enabled: montar,
  staleTime: 60_000,
});
const kit = ref('');
const opcoesKit = computed(() => [
  { valor: '', rotulo: t('pep.padroes.aplicarKit.escolher') },
  ...(kits.data.value ?? []).filter((k) => k.ativo).map((k) => ({ valor: String(k.id), rotulo: k.nome })),
]);
const rotuloKit = computed(() => kits.data.value?.find((k) => String(k.id) === kit.value)?.nome ?? '');
/** Aplica o kit: cada linha com detalhe entra marcada com o kit (gravado no item); o resto fica para completar. */
async function aplicarKit(): Promise<void> {
  if (!kit.value) return;
  const id = Number(kit.value);
  const a = await aplicacaoDoKit(id);
  if (a.problema) {
    avisoProtocolo.value = a.mensagem ?? a.problema;
    return;
  }
  for (const l of a.linhas) if (l.produtoNome) produtosVistos.set(l.produto, l.produtoNome);
  let ok = 0;
  for (const [n, d] of a.sugestoes.entries())
    if (d) {
      ok++;
      incluir({
        chave: `k${id}-${n}-${Date.now().toString(36)}`.slice(0, 40),
        detalhe: d,
        kit: id,
        autopreenchido: ['dose'],
        decisoes: [],
      });
    }
  const semDetalhe = a.sugestoes.length - ok;
  avisoProtocolo.value = [
    t('pep.padroes.aplicarKit.aplicado', { n: ok }),
    semDetalhe ? t('pep.padroes.aplicarKit.semDetalhe', { n: semDetalhe }) : '',
    a.revisar.length ? t('pep.padroes.aplicarKit.revisar', { n: a.revisar.length }) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// O último medicamento incluído, que a estrela pode tornar favorito.
const ultimoItem = computed(() => {
  const d = [...itens.value].reverse().find((i) => i.detalhe.tipo === 'medicamento')?.detalhe;
  return d && d.tipo === 'medicamento'
    ? { id: d.item.produto, rotulo: produtosVistos.get(d.item.produto) ?? '' }
    : null;
});
const editorItem = ref<{ escolherFavorito: (produto: number, nome: string) => Promise<boolean> } | null>(
  null,
);

/** Favorito do prescritor em um clique: o protocolo e o kit se aplicam; o item fica escolhido no formulário. */
async function aplicarFavorito(tipo: FavoritoPrescritor['tipo'], id: number, rotulo: string): Promise<void> {
  if (tipo === 'protocolo_prescricao') {
    protocolo.value = String(id);
    await aplicarProtocolo();
  } else if (tipo === 'kit_prescricao') {
    kit.value = String(id);
    await aplicarKit();
  } else {
    aba.value = 'medicamentos';
    await nextTick();
    await editorItem.value?.escolherFavorito(id, rotulo);
  }
}
const rotuloProtocolo = computed(
  () => protocolos.data.value?.find((p) => String(p.id) === protocolo.value)?.nome ?? '',
);

// Itens programados (prescrição futura) que chegaram à data: oferecidos para confirmação.
const futuras = useQuery({
  queryKey: computed(() => ['presc', 'futuras', id.value, atendimento.value]),
  queryFn: () => lerFuturas(id.value, Number(atendimento.value)),
  enabled: computed(() => !!atendimento.value),
});
const futurasDoDia = computed(() =>
  (futuras.data.value?.futuras ?? []).filter(
    (f) => f.situacao === 'programada' && f.aPartirDe <= agoraLocal().slice(0, 10),
  ),
);
const futurasLevadas = ref<number[]>([]);
function levarFutura(fid: number, item: ItemPrescricao): void {
  incluir({ ...item, chave: `f${fid}`.slice(0, 40) });
  futurasLevadas.value = [...futurasLevadas.value, fid];
}

// ── Verificar e assinar ───────────────────────────────────────────────────────────────────────────
const verificacao = ref<Verificacao | null>(null);
const verificadoDe = ref('');
const assinatura = computed(() => JSON.stringify([itens.value, periodo.value, atendimento.value]));
const desatualizada = computed(() => verificacao.value !== null && verificadoDe.value !== assinatura.value);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const chaveGravar = ref(novaChave('prescrever'));

async function fazerVerificacao(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    verificacao.value = await verificar(id.value, {
      atendimento: Number(atendimento.value),
      periodo: periodo.value,
      itens: itens.value,
    });
    verificadoDe.value = assinatura.value;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
function manter(item: string, alerta: string, justificativa: string): void {
  itens.value = itens.value.map((i) =>
    i.chave === item
      ? {
          ...i,
          decisoes: [
            ...i.decisoes.filter((d) => d.alerta !== alerta),
            { alerta, decisao: 'mantido' as const, justificativa },
          ],
        }
      : i,
  );
  void fazerVerificacao();
}
function retirar(item: string): void {
  tirar(item);
  void fazerVerificacao();
}
const podeAssinar = computed(
  () =>
    online.value &&
    itens.value.length > 0 &&
    verificacao.value !== null &&
    !desatualizada.value &&
    !verificacao.value.impede &&
    c.value?.prescritor !== null &&
    liberacao.data.value?.gravacao.pode !== false,
);
async function assinar(): Promise<void> {
  if (!podeAssinar.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await prescrever(
      id.value,
      {
        atendimento: Number(atendimento.value),
        periodo: periodo.value,
        dataHora: agoraLocal(),
        prioridade: prioridade.value,
        itens: itens.value,
        ...(observacaoGeral.value.trim() ? { observacaoGeral: observacaoGeral.value.trim() } : {}),
        ...(justificativaRetroativo.value.trim()
          ? { justificativaRetroativo: justificativaRetroativo.value.trim() }
          : {}),
        ...(modo.value && origemId.value ? { origem: { prescricao: origemId.value, modo: modo.value } } : {}),
        futuras: futurasLevadas.value,
      },
      chaveGravar.value,
    );
    void roteador.push(
      `/pep/paciente/${id.value}/prescricao/${r.prescricao}?assinada=${r.itens}.${r.horarios}`,
    );
  } catch (e) {
    erro.value = e;
    chaveGravar.value = novaChave('prescrever');
  } finally {
    ocupado.value = false;
  }
}
const horariosDe = (chave: string) => verificacao.value?.horarios[chave] ?? [];
const alertas = computed<readonly AlertaPrescricao[]>(() => verificacao.value?.alertas ?? []);
const titulo = computed(() => {
  const o = origem.data.value;
  if (o && modo.value === 'copia') return t('pep.presc.editor.tituloCopia', { data: dataHoraBr(o.dataHora) });
  if (o && modo.value === 'renovacao')
    return t('pep.presc.editor.tituloRenovacao', { data: dataHoraBr(o.dataHora) });
  return montar.value ? t('pep.presc.editor.tituloMontar') : t('pep.presc.editor.titulo');
});
</script>

<template>
  <section class="tela" aria-labelledby="presc-editor-titulo" data-testid="tela-prescricao-editor">
    <h1 id="presc-editor-titulo">{{ titulo }}</h1>
    <p>
      <RouterLink :to="`/pep/paciente/${id}/prescricao`">{{ t('pep.presc.voltar') }}</RouterLink>
    </p>
    <SanteAlerta
      v-if="!online"
      variante="alerta"
      :texto="t('pep.presc.semConexao')"
      anunciar
      data-testid="sem-conexao"
    />
    <MensagemErro v-if="contexto.isError.value" :erro="contexto.error.value" />
    <p v-else-if="!c || !dominios.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else>
      <CabecalhoProntuario :cabecalho="c.cabecalho" />
      <DadosClinicos v-if="c.dadosClinicos" :dados="c.dadosClinicos" />
      <SanteAlerta
        v-if="!c.liberacao.ligada"
        variante="aviso"
        :texto="c.liberacao.motivo ?? t('pep.presc.desligada')"
      />
      <SanteAlerta
        v-if="liberacao.data.value && !liberacao.data.value.gravacao.pode"
        variante="aviso"
        :texto="t('pep.presc.gravacaoRecusada', { motivo: liberacao.data.value.gravacao.motivo ?? '' })"
        data-testid="gravacao-recusada"
      />
      <SanteAlerta v-if="!c.prescritor" variante="aviso" :texto="t('pep.presc.paciente.semPrescritor')" />
      <SanteAlerta
        v-else-if="c.prescritor.coassinatura"
        variante="info"
        :texto="t('pep.presc.paciente.coassinatura')"
      />

      <div class="barra">
        <SanteSelecao
          v-model="atendimento"
          :rotulo="t('pep.presc.paciente.atendimento')"
          :opcoes="opcoesAtendimento"
          data-testid="editor-atendimento"
        />
        <SanteSelecao
          v-if="opcoesPeriodo.length"
          v-model="periodo"
          :rotulo="t('pep.presc.editor.periodo')"
          :opcoes="opcoesPeriodo"
          data-testid="editor-periodo"
        />
        <SanteSelecao
          v-model="prioridade"
          :rotulo="t('pep.presc.editor.prioridade')"
          :opcoes="
            (['rotina', 'urgente'] as const).map((p) => ({
              valor: p,
              rotulo: t(`pep.presc.editor.prioridades.${p}`),
            }))
          "
        />
      </div>
      <SanteAlerta v-if="at && !at.periodos" variante="alerta" :texto="t('pep.presc.paciente.semRegra')" />

      <!-- Copiar ou renovar: confirmação item a item. -->
      <section v-if="origem.data.value && !origemLevada" class="origem" data-testid="origem-itens">
        <p>{{ t('pep.presc.editor.origemConfirmar') }}</p>
        <ul>
          <li v-for="it in origem.data.value.itensLidos" :key="it.id">
            <label v-if="it.detalhe" class="marcar">
              <input
                v-model="confirmados[it.id]"
                type="checkbox"
                :data-testid="`confirmar-origem-${it.id}`"
              />
              {{ t('pep.presc.editor.origemItem', { item: `${it.tipoNome}: ${it.descricao}` }) }}
            </label>
            <span v-else
              >{{ it.tipoNome }}: {{ it.descricao }} — {{ t('pep.presc.editor.origemRevisar') }}</span
            >
          </li>
        </ul>
        <SanteBotao
          :rotulo="t('pep.presc.editor.origemLevar')"
          data-testid="levar-origem"
          @acionar="levarOrigem(origem.data.value)"
        />
      </section>

      <!-- Protocolo -->
      <section v-if="montar" class="origem" data-testid="aplicar-protocolo">
        <div class="barra">
          <SanteSelecao
            v-model="protocolo"
            :rotulo="t('pep.presc.editor.protocolo')"
            :opcoes="opcoesProtocolo"
            data-testid="escolher-protocolo"
          />
          <SanteBotao
            :rotulo="t('pep.presc.editor.protocoloAplicar')"
            variante="secundario"
            data-testid="botao-aplicar-protocolo"
            @acionar="aplicarProtocolo"
          />
        </div>
        <div class="barra" data-testid="aplicar-kit">
          <SanteSelecao
            v-model="kit"
            :rotulo="t('pep.padroes.aplicarKit.kit')"
            :opcoes="opcoesKit"
            data-testid="escolher-kit"
          />
          <SanteBotao
            :rotulo="t('pep.padroes.aplicarKit.aplicar')"
            variante="secundario"
            data-testid="botao-aplicar-kit"
            @acionar="aplicarKit"
          />
        </div>
        <AtalhosFavoritos
          :escolhido="protocolo"
          :rotulo-escolhido="rotuloProtocolo"
          :kit-escolhido="kit"
          :rotulo-kit="rotuloKit"
          :item-escolhido="ultimoItem?.id ?? null"
          :rotulo-item="ultimoItem?.rotulo ?? ''"
          @aplicar="aplicarFavorito"
        />
        <p v-if="avisoProtocolo" role="status" data-testid="aviso-protocolo">{{ avisoProtocolo }}</p>
      </section>

      <!-- Futuras do dia -->
      <section v-if="futurasDoDia.length" class="origem" data-testid="futuras-do-dia">
        <h2>{{ t('pep.presc.futura.programadas') }}</h2>
        <ul>
          <li v-for="f in futurasDoDia" :key="f.id">
            {{ f.descricao }} ({{ f.aPartirDe }})
            <SanteBotao
              v-if="!futurasLevadas.includes(f.id)"
              :rotulo="t('pep.presc.editor.origemItem', { item: f.descricao })"
              variante="secundario"
              @acionar="levarFutura(f.id, f.item)"
            />
          </li>
        </ul>
      </section>

      <div role="tablist" class="abas" :aria-label="t('pep.presc.editor.abas')">
        <button
          v-for="g in GRUPOS_ITEM_PRESCRICAO"
          :id="`aba-${g}`"
          :key="g"
          role="tab"
          type="button"
          :aria-selected="aba === g"
          :aria-controls="`painel-${g}`"
          :tabindex="aba === g ? 0 : -1"
          :data-testid="`aba-${g}`"
          @click="aba = g"
        >
          {{ t(`pep.presc.grupos.${g}`) }}
        </button>
      </div>
      <div :id="`painel-${aba}`" role="tabpanel" :aria-labelledby="`aba-${aba}`" class="painel-aba">
        <ItemEditor
          ref="editorItem"
          :key="aba"
          :grupo="aba"
          :dominios="dominios.data.value"
          :categoria="categoria"
          :dados="c?.dadosClinicos ?? null"
          @incluir="aoIncluir"
        />
      </div>

      <section class="itens" :aria-label="t('pep.presc.editor.itens', { n: itens.length })">
        <h2>{{ t('pep.presc.editor.itens', { n: itens.length }) }}</h2>
        <p v-if="itens.length === 0" role="status">{{ t('pep.presc.editor.semItens') }}</p>
        <table v-else data-testid="itens-prescricao">
          <thead>
            <tr>
              <th scope="col">{{ t('pep.presc.paciente.colunas.itens') }}</th>
              <th scope="col">{{ t('pep.presc.editor.horarios') }}</th>
              <th scope="col">{{ t('pep.presc.paciente.colunas.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in itens" :key="i.chave" :data-testid="`item-${i.chave}`">
              <td>
                <strong>{{ t(`pep.presc.tipos.${i.detalhe.tipo}`) }}</strong>
                {{ rotulos[i.chave] }}
              </td>
              <td>
                <span v-if="verificacao && horariosDe(i.chave).length" class="horas">
                  {{
                    horariosDe(i.chave)
                      .map((h) => h.slice(11, 16))
                      .join(' · ')
                  }}
                </span>
                <span v-else-if="verificacao" class="secundario">{{ t('pep.presc.editor.semHorario') }}</span>
              </td>
              <td>
                <SanteBotao
                  :rotulo="t('pep.presc.editor.tirar', { item: rotulos[i.chave] ?? '' })"
                  variante="texto"
                  @acionar="tirar(i.chave)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <AvisoCoberturaPrescricao :atendimento-id="Number(atendimento) || null" :itens="itensCobertura" />

      <div class="campo">
        <label for="presc-obs-geral">{{ t('pep.presc.editor.observacaoGeral') }}</label>
        <textarea id="presc-obs-geral" v-model="observacaoGeral" maxlength="4000" rows="2" />
      </div>

      <div class="acoes">
        <SanteBotao
          :rotulo="ocupado ? t('pep.presc.editor.verificando') : t('pep.presc.editor.verificar')"
          variante="secundario"
          :desabilitado="itens.length === 0 || ocupado || !online || !atendimento"
          data-testid="verificar-prescricao"
          @acionar="fazerVerificacao"
        />
        <SanteBotao
          :rotulo="ocupado ? t('pep.presc.editor.assinando') : t('pep.presc.editor.assinar')"
          :desabilitado="!podeAssinar || ocupado"
          data-testid="assinar-prescricao"
          @acionar="assinar"
        />
      </div>
      <SanteAlerta
        v-if="desatualizada"
        variante="aviso"
        :texto="t('pep.presc.editor.precisaVerificar')"
        data-testid="verificar-de-novo"
      />
      <MensagemErro v-if="erro" :erro="erro" />
      <PainelAlertas
        v-if="verificacao"
        :alertas="alertas"
        :rotulos="rotulos"
        :base-interacoes="verificacao.baseInteracoes"
        :impede="verificacao.impede"
        :paciente="id"
        @manter="manter"
        @retirar="retirar"
      />
    </template>
  </section>
</template>

<style scoped>
.tela {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.barra,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda-forte);
}
.abas button {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-bottom: none;
  background: var(--sgh-fundo-sutil);
  color: var(--sgh-texto);
  cursor: pointer;
}
.abas button[aria-selected='true'] {
  background: var(--sgh-fundo);
  font-weight: 700;
  border-color: var(--sgh-borda-forte);
}
.painel-aba {
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.origem {
  border: 1px dashed var(--sgh-borda-forte);
  padding: var(--sgh-espaco-2);
}
.origem ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.marcar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.horas {
  font-family: var(--sgh-fonte-codigo);
}
.secundario {
  color: var(--sgh-texto-secundario);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  max-width: 48rem;
}
h2 {
  margin: 0;
}
</style>
