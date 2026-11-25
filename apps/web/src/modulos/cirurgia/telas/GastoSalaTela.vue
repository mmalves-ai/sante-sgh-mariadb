<script setup lang="ts">
// Gasto de sala do ato cirúrgico (F3.4-5, 04-CC linha 100). Uma tela só, por ato: a lista padrão do procedimento já
// vem como sugestão (um clique), a diferença e as pendências aparecem na hora, o lote é escolhido pelo saldo do local e
// o obrigatório não usado pede o motivo ali mesmo. Conferir, reabrir, cancelar e debitar aparecem pelo nível de acesso
// do cargo; quem mantém a lista padrão a ajusta no mesmo lugar. Nada se apaga: tirar um item ou uma linha deixa
// histórico no servidor.
import { MINIMO_MOTIVO_GASTO_SALA } from '@sgh/dominio-cirurgia';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  alterarLinhaPadrao,
  cancelarGasto,
  conferirGasto,
  debitarGasto,
  type GastoSala,
  gravarGasto,
  incluirLinhaPadrao,
  type ItemEntrada,
  lerApoioGasto,
  lerGastoDoAto,
  lerListaPadrao,
  lerLotesGasto,
  type LoteGasto,
  reabrirGasto,
} from '../api-gasto-sala.js';
import { lerCartaoAplicavel } from '../api-cartao-preferencia.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const props = defineProps<{ ato: string }>();
const { t } = useI18n();
const router = useRouter();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const tem = (p: string) => permissoes.value.has(p);
const podeLancar = computed(() => tem('cirurgia.registro.criar'));
const podeConferir = computed(() => tem('faturamento.item.conferir'));
const podeDebitar = computed(() => tem('faturamento.item.lancar'));
const podeLista = computed(() => tem('cirurgia.sala.editar'));

const atoId = computed(() => (/^\d+$/.test(props.ato) ? Number(props.ato) : null));
const atoBusca = ref(props.ato);
const chave = computed(() => ['cirurgia', 'gasto-sala', atoId.value]);
const consulta = useQuery({
  queryKey: chave,
  queryFn: () => lerGastoDoAto(atoId.value!),
  enabled: computed(() => atoId.value !== null),
});
const dados = computed<GastoSala | undefined>(() => consulta.data.value);

// ── Edição local do gasto ──
interface ItemTela extends ItemEntrada {
  nome: string;
  controlaLote: boolean;
}
const local = ref('');
const itens = ref<ItemTela[]>([]);
const justificativas = ref<Record<number, string>>({});
const motivo = ref('');
const nomes = ref(new Map<number, string>());
const nomeDe = (insumo: number) => nomes.value.get(insumo) ?? `#${insumo}`;

watch(
  dados,
  (d) => {
    if (!d) return;
    for (const s of d.sugestao) nomes.value.set(s.insumo, s.insumoNome);
    for (const i of d.itens) nomes.value.set(i.insumo, i.insumoNome);
    local.value = d.gasto?.local ? String(d.gasto.local) : local.value;
    itens.value = d.itens.map((i) => ({
      insumo: i.insumo,
      quantidade: i.quantidade,
      lote: i.lote,
      implantePermanente: i.implantePermanente,
      faturar: i.faturar,
      nome: i.insumoNome,
      controlaLote: i.lote !== null,
    }));
    justificativas.value = Object.fromEntries(
      d.motivos.filter((m) => m.tipo === 'item_nao_usado' && m.insumo).map((m) => [m.insumo!, m.motivo]),
    );
  },
  { immediate: true },
);

const situacao = computed(() => dados.value?.gasto?.situacao ?? 'nova');
const editavel = computed(
  () => podeLancar.value && (situacao.value === 'nova' || situacao.value === 'aberta'),
);

function usarSugestao(): void {
  const d = dados.value;
  if (!d) return;
  const ja = new Set(itens.value.map((i) => i.insumo));
  for (const s of d.sugestao)
    if (!ja.has(s.insumo))
      itens.value.push({
        insumo: s.insumo,
        quantidade: s.quantidade,
        lote: null,
        implantePermanente: false,
        faturar: true,
        nome: s.insumoNome,
        controlaLote: false,
      });
}

// F8, 04-CC L105: os produtos do cartão de preferência do cirurgião (o do procedimento ou o geral), num clique.
const avisoCartao = ref('');
async function usarCartao(): Promise<void> {
  const d = dados.value;
  if (!d?.cirurgiaoLista) return;
  try {
    const r = await lerCartaoAplicavel(d.cirurgiaoLista, d.ato.procedimentos[0]?.id ?? null);
    avisoCartao.value = r.gasto.length ? '' : t('cirurgia.cartaoPreferencia.cartaoVazio');
    const ja = new Set(itens.value.map((i) => i.insumo));
    for (const g of r.gasto)
      if (!ja.has(g.insumo)) {
        nomes.value.set(g.insumo, g.insumoNome);
        itens.value.push({
          insumo: g.insumo,
          quantidade: g.quantidade,
          lote: null,
          implantePermanente: false,
          faturar: true,
          nome: g.insumoNome,
          controlaLote: false,
        });
      }
  } catch (e) {
    erro.value = e;
  }
}

// ── Apoio: locais, busca de produto e lotes ──
const busca = ref('');
const termo = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (v) => {
  clearTimeout(espera);
  espera = setTimeout(() => (termo.value = v.trim()), 300);
});
const apoio = useQuery({
  queryKey: computed(() => ['cirurgia', 'gasto-sala', 'apoio', termo.value.length >= 3 ? termo.value : '']),
  queryFn: () => lerApoioGasto(termo.value.length >= 3 ? termo.value : ''),
  enabled: computed(() => atoId.value !== null),
});
const opcoesLocal = computed(() => [
  { valor: '', rotulo: t('cirurgia.escolha') },
  ...(apoio.data.value?.locais ?? []).map((l) => ({
    valor: String(l.id),
    rotulo: l.comCentro ? l.nome : `${l.nome} ${t('cirurgia.gastoSala.semCentro')}`,
  })),
]);
const produtos = computed(() => (termo.value.length >= 3 ? (apoio.data.value?.produtos ?? []) : []));
function incluir(p: { id: number; nome: string; controlaLote: boolean; opme: boolean }): void {
  nomes.value.set(p.id, p.nome);
  itens.value.push({
    insumo: p.id,
    quantidade: 1,
    lote: null,
    implantePermanente: false,
    faturar: true,
    nome: p.nome,
    controlaLote: p.controlaLote || p.opme,
  });
  busca.value = '';
}

const lotes = ref(new Map<number, LoteGasto[]>());
watch(
  [() => itens.value.map((i) => i.insumo).join(','), local],
  async () => {
    const l = local.value ? Number(local.value) : null;
    const m = new Map<number, LoteGasto[]>();
    for (const i of new Set(itens.value.map((x) => x.insumo)))
      m.set(i, await lerLotesGasto(i, l).catch(() => []));
    lotes.value = m;
    for (const it of itens.value) if ((m.get(it.insumo) ?? []).length) it.controlaLote = true;
  },
  { immediate: true },
);
const opcoesLote = (insumo: number) => [
  { valor: '', rotulo: t('cirurgia.gastoSala.semLote') },
  ...(lotes.value.get(insumo) ?? []).map((l) => ({
    valor: String(l.id),
    rotulo: t('cirurgia.gastoSala.loteRotulo', { numero: l.numero, validade: l.validade, saldo: l.saldo }),
  })),
];
const loteDe = (i: ItemTela) =>
  computed({
    get: () => (i.lote === null ? '' : String(i.lote)),
    set: (v: string) => (i.lote = v ? Number(v) : null),
  });

// ── Validação na hora (a mesma que o servidor confere) ──
const obrigatoriosAusentes = computed(() =>
  (dados.value?.sugestao ?? []).filter(
    (s) => s.obrigatorio && !itens.value.some((i) => i.insumo === s.insumo && i.quantidade > 0),
  ),
);
const problemas = computed(() => {
  const p: string[] = [];
  if (!local.value) p.push(t('cirurgia.gastoSala.localFalta'));
  const vistos = new Set<string>();
  itens.value.forEach((i, k) => {
    if (!(i.quantidade > 0)) p.push(t('cirurgia.gastoSala.quantidadeInvalida', { n: k + 1 }));
    if (i.controlaLote && i.lote === null) p.push(t('cirurgia.gastoSala.loteFalta', { n: k + 1 }));
    const c = `${i.insumo}:${i.lote ?? ''}`;
    if (vistos.has(c)) p.push(t('cirurgia.gastoSala.repetido', { n: k + 1 }));
    vistos.add(c);
  });
  for (const s of obrigatoriosAusentes.value)
    if ((justificativas.value[s.insumo] ?? '').trim().length < MINIMO_MOTIVO_GASTO_SALA)
      p.push(t('cirurgia.gastoSala.justificativaFalta', { nome: s.insumoNome }));
  return p;
});

// ── Ações ──
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
async function agir(fn: () => Promise<unknown>, msg = t('cirurgia.gastoSala.feito')): Promise<void> {
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    await fn();
    aviso.value = msg;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const versao = () => dados.value!.gasto!.versao;
const salvar = () =>
  agir(
    () =>
      gravarGasto(atoId.value!, {
        local: Number(local.value),
        cirurgiao: dados.value?.cirurgiaoLista ?? null,
        ...(dados.value?.gasto ? { versao: versao() } : {}),
        itens: itens.value.map(({ insumo, quantidade, lote, implantePermanente, faturar }) => ({
          insumo,
          quantidade,
          lote,
          implantePermanente,
          faturar,
        })),
        justificativas: obrigatoriosAusentes.value.map((s) => ({
          insumo: s.insumo,
          motivo: (justificativas.value[s.insumo] ?? '').trim(),
        })),
      }),
    t('cirurgia.gastoSala.salvo'),
  );
const motivoValido = computed(() => motivo.value.trim().length >= MINIMO_MOTIVO_GASTO_SALA);

// ── Lista padrão do procedimento (quem mantém o cadastro do bloco) ──
const procedimento = computed(() => dados.value?.ato.procedimentos[0] ?? null);
const lista = useQuery({
  queryKey: computed(() => ['cirurgia', 'gasto-sala', 'lista', procedimento.value?.id ?? null]),
  queryFn: () => lerListaPadrao(procedimento.value!.id),
  enabled: computed(() => podeLista.value && procedimento.value !== null),
});
const paraCirurgiao = ref(false);
const obrigatorioNovo = ref(false);
async function agirLista(fn: () => Promise<unknown>): Promise<void> {
  await agir(fn);
  await cliente.invalidateQueries({ queryKey: ['cirurgia', 'gasto-sala', 'lista'] });
}
const incluirNaLista = (p: { id: number; nome: string }) =>
  agirLista(() =>
    incluirLinhaPadrao({
      procedimento: procedimento.value!.id,
      cirurgiao: paraCirurgiao.value ? (dados.value?.cirurgiaoLista ?? null) : null,
      tipoAnestesia: null,
      insumo: p.id,
      kit: null,
      quantidade: 1,
      obrigatorio: obrigatorioNovo.value,
    }),
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="gasto-titulo" data-testid="tela-gasto-sala">
    <h1 id="gasto-titulo">{{ t('cirurgia.gastoSala.titulo', { numero: dados?.ato.numero ?? '' }) }}</h1>
    <p class="secundario">{{ t('cirurgia.gastoSala.texto') }}</p>
    <form
      class="filtros"
      role="search"
      @submit.prevent="router.push({ name: 'cirurgia.gasto-sala', params: { ato: atoBusca } })"
    >
      <div class="campo">
        <label for="gasto-ato">{{ t('cirurgia.gastoSala.atoNumero') }}</label>
        <input id="gasto-ato" v-model="atoBusca" inputmode="numeric" data-testid="gasto-ato" />
      </div>
      <SanteBotao tipo="submit" :rotulo="t('cirurgia.gastoSala.irAto')" />
    </form>

    <ErroCirurgia v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="atoId !== null && !dados" role="status">{{ t('cirurgia.carregando') }}</p>
    <template v-else-if="dados">
      <section class="painel" aria-labelledby="gasto-cabecalho">
        <h2 id="gasto-cabecalho" data-testid="gasto-situacao">
          {{ t('cirurgia.gastoSala.situacao', { s: t(`cirurgia.gastoSala.situacoes.${situacao}`) }) }}
        </h2>
        <p>
          {{
            t('cirurgia.gastoSala.procedimentos', {
              lista: dados.ato.procedimentos.map((p) => p.descricao).join(', '),
            })
          }}
          ·
          {{ t(`cirurgia.gastoSala.listaDo.${dados.cirurgiaoLista ? 'cirurgiao' : 'servico'}`) }}
        </p>
        <SanteSelecao
          v-model="local"
          :rotulo="t('cirurgia.gastoSala.local')"
          :opcoes="opcoesLocal"
          :desabilitado="!editavel"
          data-testid="gasto-local"
        />
      </section>

      <section class="painel" aria-labelledby="gasto-itens">
        <h2 id="gasto-itens">{{ t('cirurgia.gastoSala.itens') }}</h2>
        <SanteBotao
          v-if="editavel && dados.sugestao.length"
          variante="secundario"
          :rotulo="t('cirurgia.gastoSala.usarSugestao')"
          data-testid="gasto-usar-sugestao"
          @acionar="usarSugestao"
        />
        <SanteBotao
          v-if="editavel && dados.cirurgiaoLista"
          variante="secundario"
          :rotulo="t('cirurgia.cartaoPreferencia.usarCartao')"
          data-testid="gasto-usar-cartao"
          @acionar="usarCartao"
        />
        <p v-if="avisoCartao" role="status" data-testid="gasto-aviso-cartao">{{ avisoCartao }}</p>
        <p v-if="!itens.length">{{ t('cirurgia.gastoSala.nenhumItem') }}</p>
        <table v-else class="tabela" data-testid="gasto-tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('cirurgia.gastoSala.produto') }}</th>
              <th scope="col">{{ t('cirurgia.gastoSala.quantidade') }}</th>
              <th scope="col">{{ t('cirurgia.gastoSala.lote') }}</th>
              <th scope="col">{{ t('cirurgia.gastoSala.faturar') }}</th>
              <th scope="col">{{ t('cirurgia.gastoSala.implante') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('cirurgia.gastoSala.tirar') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(i, k) in itens" :key="`${i.insumo}-${k}`" :data-testid="`gasto-item-${k}`">
              <td>{{ i.nome }}</td>
              <td>
                <label :for="`gasto-qtd-${k}`" class="sr-only">{{
                  t('cirurgia.gastoSala.quantidade')
                }}</label>
                <input
                  :id="`gasto-qtd-${k}`"
                  v-model.number="i.quantidade"
                  type="number"
                  min="0"
                  step="any"
                  :disabled="!editavel"
                  :data-testid="`gasto-qtd-${k}`"
                />
              </td>
              <td>
                <SanteSelecao
                  v-model="loteDe(i).value"
                  :rotulo="t('cirurgia.gastoSala.lote')"
                  :opcoes="opcoesLote(i.insumo)"
                  :desabilitado="!editavel"
                  :data-testid="`gasto-lote-${k}`"
                />
              </td>
              <td>
                <input
                  v-model="i.faturar"
                  type="checkbox"
                  :disabled="!editavel"
                  :aria-label="t('cirurgia.gastoSala.faturar')"
                />
              </td>
              <td>
                <input
                  v-model="i.implantePermanente"
                  type="checkbox"
                  :disabled="!editavel"
                  :aria-label="t('cirurgia.gastoSala.implante')"
                />
              </td>
              <td>
                <SanteBotao
                  v-if="editavel"
                  variante="texto"
                  :rotulo="t('cirurgia.gastoSala.tirar')"
                  @acionar="itens.splice(k, 1)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="editavel || podeLista" class="campo">
          <label for="gasto-busca">{{ t('cirurgia.gastoSala.buscar') }}</label>
          <input id="gasto-busca" v-model="busca" data-testid="gasto-busca" />
        </div>
        <ul v-if="produtos.length" class="secundario" data-testid="gasto-produtos">
          <li v-for="p in produtos" :key="p.id">
            {{ p.codigo }} · {{ p.nome }}
            <SanteBotao
              v-if="editavel"
              variante="texto"
              :rotulo="t('cirurgia.gastoSala.incluir', { nome: p.nome })"
              @acionar="incluir(p)"
            />
            <SanteBotao
              v-if="podeLista && procedimento"
              variante="texto"
              :rotulo="t('cirurgia.gastoSala.lista.incluirNaLista', { nome: p.nome })"
              @acionar="incluirNaLista(p)"
            />
          </li>
        </ul>
      </section>

      <section
        v-if="dados.diferencas.length || obrigatoriosAusentes.length"
        class="painel"
        aria-labelledby="gasto-dif"
      >
        <h2 id="gasto-dif">{{ t('cirurgia.gastoSala.diferencas') }}</h2>
        <ul data-testid="gasto-diferencas">
          <li v-for="d in dados.diferencas" :key="d.insumo">
            {{
              t('cirurgia.gastoSala.diferencaLinha', {
                nome: nomeDe(d.insumo),
                sugerido: d.sugerido,
                lancado: d.lancado,
                tipo: t(`cirurgia.gastoSala.tipos.${d.tipo}`),
              })
            }}
          </li>
        </ul>
        <div v-for="s in obrigatoriosAusentes" :key="s.insumo" class="campo">
          <label :for="`gasto-just-${s.insumo}`">{{
            t('cirurgia.gastoSala.justificar', { nome: s.insumoNome })
          }}</label>
          <input
            :id="`gasto-just-${s.insumo}`"
            v-model="justificativas[s.insumo]"
            :disabled="!editavel"
            :data-testid="`gasto-just-${s.insumo}`"
          />
        </div>
      </section>

      <div v-if="editavel && problemas.length" data-testid="gasto-problemas">
        <SanteAlerta variante="aviso" :texto="t('cirurgia.gastoSala.problemas')" />
        <ul>
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
      </div>
      <div v-if="situacao === 'aberta' && dados.pendencias.length" data-testid="gasto-pendencias">
        <SanteAlerta variante="aviso" :texto="t('cirurgia.gastoSala.pendencias')" />
        <ul>
          <li v-for="p in dados.pendencias" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
        </ul>
      </div>

      <section class="painel acoes" :aria-label="t('cirurgia.gastoSala.acoes')">
        <SanteBotao
          v-if="editavel"
          :rotulo="t('cirurgia.gastoSala.salvar')"
          :desabilitado="ocupado || problemas.length > 0"
          data-testid="gasto-salvar"
          @acionar="salvar"
        />
        <SanteBotao
          v-if="podeConferir && situacao === 'aberta'"
          variante="secundario"
          :rotulo="t('cirurgia.gastoSala.conferir')"
          :desabilitado="ocupado || dados.pendencias.length > 0"
          data-testid="gasto-conferir"
          @acionar="agir(() => conferirGasto(atoId!, versao()))"
        />
        <SanteBotao
          v-if="podeDebitar && situacao === 'conferida'"
          :rotulo="t('cirurgia.gastoSala.debitar')"
          :desabilitado="ocupado"
          data-testid="gasto-debitar"
          @acionar="agir(() => debitarGasto(atoId!, versao()))"
        />
        <template
          v-if="
            (podeConferir && situacao === 'conferida') ||
            (podeLancar && (situacao === 'aberta' || (situacao === 'conferida' && podeConferir)))
          "
        >
          <div class="campo">
            <label for="gasto-motivo">{{ t('cirurgia.gastoSala.motivo') }}</label>
            <input id="gasto-motivo" v-model="motivo" data-testid="gasto-motivo" />
          </div>
          <SanteBotao
            v-if="podeConferir && situacao === 'conferida'"
            variante="secundario"
            :rotulo="t('cirurgia.gastoSala.reabrir')"
            :desabilitado="ocupado || !motivoValido"
            data-testid="gasto-reabrir"
            @acionar="agir(() => reabrirGasto(atoId!, versao(), motivo.trim()))"
          />
          <SanteBotao
            v-if="podeLancar"
            variante="secundario"
            :rotulo="t('cirurgia.gastoSala.cancelar')"
            :desabilitado="ocupado || !motivoValido"
            data-testid="gasto-cancelar"
            @acionar="agir(() => cancelarGasto(atoId!, versao(), motivo.trim()))"
          />
        </template>
      </section>
      <p v-if="aviso" role="status" data-testid="gasto-aviso">{{ aviso }}</p>
      <ErroCirurgia v-if="erro" :erro="erro" />

      <section v-if="dados.motivos.length" class="painel" aria-labelledby="gasto-hist">
        <h2 id="gasto-hist">{{ t('cirurgia.gastoSala.historico') }}</h2>
        <ul>
          <li v-for="(m, k) in dados.motivos" :key="k">
            {{ t(`cirurgia.gastoSala.motivosTipo.${m.tipo}`) }}
            <template v-if="m.insumo">· {{ nomeDe(m.insumo) }}</template>
            · {{ m.motivo }}
          </li>
        </ul>
      </section>

      <section v-if="podeLista && procedimento" class="painel" aria-labelledby="gasto-lista">
        <h2 id="gasto-lista">
          {{ t('cirurgia.gastoSala.lista.titulo', { procedimento: procedimento.descricao }) }}
        </h2>
        <label>
          <input v-model="paraCirurgiao" type="checkbox" :disabled="!dados.cirurgiaoLista" />
          {{ t('cirurgia.gastoSala.lista.paraCirurgiao') }}
        </label>
        <label>
          <input v-model="obrigatorioNovo" type="checkbox" />
          {{ t('cirurgia.gastoSala.lista.obrigatorio') }}
        </label>
        <p v-if="!(lista.data.value ?? []).length">{{ t('cirurgia.gastoSala.lista.vazia') }}</p>
        <ul v-else data-testid="gasto-lista-padrao">
          <li v-for="l in lista.data.value" :key="l.id">
            {{ l.nome }} · {{ l.quantidade }} ·
            {{ t(`cirurgia.gastoSala.lista.${l.cirurgiao ? 'doCirurgiao' : 'doServico'}`) }}
            <template v-if="l.obrigatorio"> · {{ t('cirurgia.gastoSala.lista.obrigatorio') }}</template>
            <template v-if="!l.ativo"> · {{ t('cirurgia.gastoSala.lista.foraDeUso') }}</template>
            <SanteBotao
              variante="texto"
              :rotulo="t(`cirurgia.gastoSala.lista.${l.ativo ? 'tirarDeUso' : 'voltar'}`)"
              @acionar="agirLista(() => alterarLinhaPadrao(l.id, { versao: l.versao, ativo: !l.ativo }))"
            />
            <SanteBotao
              v-if="l.ativo"
              variante="texto"
              :rotulo="
                t(`cirurgia.gastoSala.lista.${l.obrigatorio ? 'desmarcarObrigatorio' : 'marcarObrigatorio'}`)
              "
              @acionar="
                agirLista(() => alterarLinhaPadrao(l.id, { versao: l.versao, obrigatorio: !l.obrigatorio }))
              "
            />
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
