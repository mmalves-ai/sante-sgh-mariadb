<script setup lang="ts">
// Central de material esterilizado (CME; F7, 05-SUP linha 29; RDC 15/2012): `/cirurgia/cme`. Uma tela só, na ordem do
// trabalho: o rastreio pela etiqueta no topo (leitor de código de barras), os pedidos de material com "preparar pacote"
// e "entregar à cirurgia" na própria linha, a carga (marcar os pacotes aguardando e abrir o ciclo), os ciclos com os
// indicadores (conclusão e liberação do lote na linha) e o cadastro das caixas e dos equipamentos. Validação na hora
// pela regra do domínio; tudo se escolhe pelo nome.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirCicloCme,
  type CicloCme,
  concluirCicloCme,
  criarEquipamentoCme,
  entregarPacoteCme,
  type Indicador,
  lerPainelCme,
  liberarCicloCme,
  prepararPacoteCme,
  rastrearPacote,
  type RastreioCme,
  solicitarCme,
  usarPacoteCme,
} from '../api-cme.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['cirurgia', 'cme'], queryFn: lerPainelCme });
const p = computed(() => painel.data.value);
const erro = ref<unknown>(null);
const aviso = ref('');
const sit = (s: string) => t(`cirurgia.cme.situacoes.${s}`);
const escolha = { valor: '', rotulo: t('cirurgia.cme.escolha') };
const opcoes = (xs: { id: number; nome?: string; descricao?: string }[] | undefined) => [
  escolha,
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome ?? x.descricao ?? '' })),
];
const opcoesCaixa = computed(() => opcoes(p.value?.caixas));
const opcoesSetor = computed(() => opcoes(p.value?.setores));
const opcoesUnidade = computed(() => opcoes(p.value?.unidades));
const opcoesEquipamento = computed(() => opcoes(p.value?.equipamentos));
const opcoesMetodo = computed(() => opcoes(p.value?.metodos));
const opcoesAgendamento = computed(() => [
  escolha,
  ...(p.value?.agendamentos ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: `${a.numero} · ${a.paciente}${a.inicio ? ` · ${a.inicio.slice(0, 16).replace('T', ' ')}` : ''}`,
  })),
]);
const opcoesIndicador = (['pendente', 'conforme', 'nao_conforme'] as const).map((r) => ({
  valor: r,
  rotulo: t(`cirurgia.cme.resultado.${r}`),
}));
const opcoesNatureza = (
  [
    'autoclave',
    'termodesinfectora',
    'lavadora_ultrassonica',
    'lavadora',
    'peroxido_hidrogenio',
    'oxido_etileno',
    'outro',
  ] as const
).map((n) => ({ valor: n, rotulo: t(`cirurgia.cme.naturezas.${n}`) }));
const nomeCaixa = (id: number) => p.value?.caixas.find((c) => c.id === id)?.descricao ?? '—';
const nomeAgendamento = (id: number | null) =>
  opcoesAgendamento.value.find((o) => o.valor === String(id))?.rotulo ?? '—';

/** Executa a gravação, mostra o aviso e relê o painel. */
const acao = useMutation({
  mutationFn: async (f: () => Promise<string>) => f(),
  onMutate: () => {
    erro.value = null;
    aviso.value = '';
  },
  onSuccess: async (texto) => {
    aviso.value = texto;
    await cliente.invalidateQueries({ queryKey: ['cirurgia', 'cme'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
const fazer = (f: () => Promise<string>) => acao.mutate(f);

// ── Rastreio ───────────────────────────────────────────────────────────────────────────────────────────────────
const etiqueta = ref('');
const rastreio = ref<RastreioCme | null>(null);
const rastrear = () =>
  fazer(async () => {
    rastreio.value = await rastrearPacote(etiqueta.value.trim());
    return '';
  });
const usar = (agendamento: number) =>
  fazer(async () => {
    await usarPacoteCme(rastreio.value!.pacote.id, { agendamento });
    rastreio.value = await rastrearPacote(rastreio.value!.pacote.etiqueta);
    return t('cirurgia.cme.gravado');
  });

// ── Pedidos, pacote e entrega ──────────────────────────────────────────────────────────────────────────────────
const sol = reactive({
  tipo: 'cirurgia' as 'setor' | 'cirurgia',
  unidade: '',
  agendamento: '',
  caixa: '',
  quantidade: 1,
});
const faltaSol = computed(() =>
  !sol.caixa
    ? t('cirurgia.cme.validacao.escolhaCaixa')
    : sol.tipo === 'cirurgia' && !sol.agendamento
      ? t('cirurgia.cme.validacao.escolhaCirurgia')
      : !sol.unidade
        ? t('cirurgia.cme.validacao.escolhaSetor')
        : '',
);
const pedir = () =>
  fazer(async () => {
    await solicitarCme({
      tipo: sol.tipo,
      setor: Number(sol.unidade),
      agendamento: sol.tipo === 'cirurgia' ? Number(sol.agendamento) : null,
      itens: [{ caixa: Number(sol.caixa), quantidade: sol.quantidade }],
    });
    return t('cirurgia.cme.gravado');
  });
const preparar = (caixa: number, solicitacaoItem: number | null) =>
  fazer(async () => {
    const r = await prepararPacoteCme({ caixa, solicitacaoItem });
    return t('cirurgia.cme.pacotePronto', { etiqueta: r.etiqueta });
  });
const entrega = reactive({ cme: '', setor: '' });
const pacoteDe = (id: number | null) => p.value?.pacotes.find((x) => x.id === id) ?? null;
const entregar = (pacote: number, agendamento: number) =>
  fazer(async () => {
    if (!entrega.cme || !entrega.setor) throw new Error(t('cirurgia.cme.validacao.escolhaSetor'));
    await entregarPacoteCme(pacote, { agendamento, cme: Number(entrega.cme), setor: Number(entrega.setor) });
    return t('cirurgia.cme.gravado');
  });

// ── Carga e ciclos ─────────────────────────────────────────────────────────────────────────────────────────────
const carga = reactive({ equipamento: '', metodo: '', pacotes: [] as number[] });
const aguardando = computed(() =>
  (p.value?.pacotes ?? []).filter((x) => x.situacao === 'aguardando_esterilizacao' && !x.ciclo),
);
const abrir = () =>
  fazer(async () => {
    await abrirCicloCme({
      equipamento: Number(carga.equipamento),
      metodo: Number(carga.metodo),
      pacotes: carga.pacotes,
    });
    carga.pacotes = [];
    return t('cirurgia.cme.gravado');
  });
const leituras = reactive<
  Record<
    number,
    { fisico: Indicador; quimico: Indicador; biologico: Indicador; temperatura: string; tempo: string }
  >
>({});
const leitura = (c: CicloCme) =>
  (leituras[c.id] ??= {
    fisico: 'pendente',
    quimico: 'pendente',
    biologico: 'pendente',
    temperatura: '',
    tempo: '',
  });
const concluir = (c: CicloCme) =>
  fazer(async () => {
    const l = leitura(c);
    const r = await concluirCicloCme(c.id, {
      versao: c.versao,
      fisico: l.fisico,
      quimico: l.quimico,
      biologico: l.biologico,
      temperatura: l.temperatura ? Number(l.temperatura) : null,
      tempoExposicao: l.tempo ? Number(l.tempo) : null,
    });
    return t('cirurgia.cme.desfecho', { situacao: sit(r.situacao), motivo: r.motivo });
  });
const liberar = (c: CicloCme) =>
  fazer(async () => {
    const r = await liberarCicloCme(c.id, { versao: c.versao, biologico: leitura(c).biologico });
    return t('cirurgia.cme.desfecho', { situacao: sit(r.situacao), motivo: r.motivo });
  });

// ── Cadastros ──────────────────────────────────────────────────────────────────────────────────────────────────
// A caixa, o kit e o pacote avulso se cadastram só no cadastro da CME (/cirurgia/cme/cadastro: composição, fases e
// foto, com as regras de cme/cadastro); aqui fica só o equipamento.
const eq = reactive({ codigo: '', descricao: '', natureza: 'autoclave', metodo: '' });
const salvarEquipamento = () =>
  fazer(async () => {
    await criarEquipamentoCme({ ...eq, metodo: eq.metodo ? Number(eq.metodo) : null });
    Object.assign(eq, { codigo: '', descricao: '' });
    return t('cirurgia.cme.gravado');
  });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cme-titulo" data-testid="tela-cme">
    <h1 id="cme-titulo">{{ t('cirurgia.cme.titulo') }}</h1>
    <p>{{ t('cirurgia.cme.texto') }}</p>
    <ErroCirurgia v-if="painel.isError.value" :erro="painel.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cme-aviso">{{ aviso }}</p>

    <h2>{{ t('cirurgia.cme.rastreio') }}</h2>
    <form class="filtros" data-testid="cme-rastreio-form" @submit.prevent="rastrear">
      <label
        >{{ t('cirurgia.cme.etiqueta') }}
        <input v-model="etiqueta" autocomplete="off" data-testid="cme-etiqueta"
      /></label>
      <button type="submit" :disabled="!etiqueta.trim()" data-testid="cme-rastrear">
        {{ t('cirurgia.cme.rastrear') }}
      </button>
    </form>
    <div v-if="rastreio" data-testid="cme-rastreio">
      <p>
        <strong>{{ rastreio.pacote.etiqueta }}</strong> · {{ rastreio.pacote.produto }} ·
        <span data-testid="cme-rastreio-situacao">{{ sit(rastreio.pacote.situacao) }}</span> ·
        {{ t('cirurgia.cme.lote') }} {{ rastreio.pacote.lote ?? '—' }} · {{ t('cirurgia.cme.validade') }}
        {{ rastreio.pacote.validade ?? '—' }} · {{ t('cirurgia.cme.metodo') }}
        {{ rastreio.pacote.metodo ?? '—' }} · {{ t('cirurgia.cme.preparadoPor') }}
        {{ rastreio.pacote.preparadoPor ?? '—' }}
      </p>
      <p data-testid="cme-rastreio-etiqueta">
        {{
          rastreio.pacote.faltasEtiqueta.length
            ? t('cirurgia.cme.faltasEtiqueta', { faltas: rastreio.pacote.faltasEtiqueta.join(', ') })
            : t('cirurgia.cme.etiquetaCompleta')
        }}
      </p>
      <p v-if="rastreio.ciclo">
        {{ rastreio.ciclo.numero }} · {{ rastreio.ciclo.equipamento }} · {{ sit(rastreio.ciclo.situacao) }}
      </p>
      <table class="tabela" data-testid="cme-rastreio-cirurgias">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.cme.cirurgia') }}</th>
            <th scope="col">{{ t('cirurgia.cme.paciente') }}</th>
            <th scope="col">{{ t('cirurgia.cme.entregueEm') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in rastreio.cirurgias" :key="c.movimento">
            <td>{{ c.agendamentoNumero ?? '—' }}</td>
            <td>{{ c.pacienteNome ?? '—' }}</td>
            <td>{{ c.entregueEm?.replace('T', ' ').slice(0, 16) ?? '—' }}</td>
            <td>
              <span v-if="c.usado">{{ t('cirurgia.cme.usado') }}</span>
              <button
                v-else-if="rastreio.pacote.situacao === 'distribuido' && c.agendamento"
                type="button"
                data-testid="cme-usar"
                @click="usar(c.agendamento)"
              >
                {{ t('cirurgia.cme.registrarUso') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!p" role="status">{{ t('cirurgia.carregando') }}</p>
    <template v-else>
      <h2>{{ t('cirurgia.cme.solicitacoes') }}</h2>
      <form class="filtros" data-testid="cme-solicitacao-form" @submit.prevent="pedir">
        <SanteSelecao
          v-model="sol.tipo"
          :rotulo="t('cirurgia.cme.tipo')"
          :opcoes="[
            { valor: 'cirurgia', rotulo: t('cirurgia.cme.tipos.cirurgia') },
            { valor: 'setor', rotulo: t('cirurgia.cme.tipos.setor') },
          ]"
          data-testid="cme-sol-tipo"
        />
        <SanteSelecao
          v-if="sol.tipo === 'cirurgia'"
          v-model="sol.agendamento"
          :rotulo="t('cirurgia.cme.agendamento')"
          :opcoes="opcoesAgendamento"
          data-testid="cme-sol-agendamento"
        />
        <SanteSelecao
          v-model="sol.unidade"
          :rotulo="t('cirurgia.cme.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="cme-sol-unidade"
        />
        <SanteSelecao
          v-model="sol.caixa"
          :rotulo="t('cirurgia.cme.caixa')"
          :opcoes="opcoesCaixa"
          data-testid="cme-sol-caixa"
        />
        <label
          >{{ t('cirurgia.cme.quantidade') }}
          <input
            v-model.number="sol.quantidade"
            type="number"
            min="1"
            max="50"
            data-testid="cme-sol-quantidade"
        /></label>
        <p v-if="faltaSol" class="dica">{{ faltaSol }}</p>
        <button type="submit" :disabled="!!faltaSol || acao.isPending.value" data-testid="cme-pedir">
          {{ t('cirurgia.cme.pedir') }}
        </button>
      </form>
      <div class="filtros">
        <SanteSelecao
          v-model="entrega.cme"
          :rotulo="t('cirurgia.cme.setorCme')"
          :opcoes="opcoesSetor"
          data-testid="cme-entrega-cme"
        />
        <SanteSelecao
          v-model="entrega.setor"
          :rotulo="t('cirurgia.cme.setorDestino')"
          :opcoes="opcoesSetor"
          data-testid="cme-entrega-setor"
        />
      </div>
      <p v-if="p.solicitacoes.length === 0">{{ t('cirurgia.cme.nenhum') }}</p>
      <table v-else class="tabela" data-testid="cme-solicitacoes">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.cme.numero') }}</th>
            <th scope="col">{{ t('cirurgia.cme.agendamento') }}</th>
            <th scope="col">{{ t('cirurgia.cme.caixa') }}</th>
            <th scope="col">{{ t('cirurgia.cme.situacao') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="s in p.solicitacoes" :key="s.id">
            <tr v-for="i in s.itens" :key="i.id" :data-testid="`cme-sol-item-${i.id}`">
              <td>{{ s.numero }}</td>
              <td>{{ s.agendamento ? nomeAgendamento(s.agendamento) : t('cirurgia.cme.tipos.setor') }}</td>
              <td>{{ nomeCaixa(i.caixa) }}</td>
              <td>
                {{ sit(i.situacao)
                }}<span v-if="pacoteDe(i.pacote)"> · {{ pacoteDe(i.pacote)?.etiqueta }}</span>
              </td>
              <td>
                <button
                  v-if="i.situacao === 'pendente'"
                  type="button"
                  :disabled="acao.isPending.value"
                  :data-testid="`cme-preparar-${i.id}`"
                  @click="preparar(i.caixa, i.id)"
                >
                  {{ t('cirurgia.cme.preparar') }}
                </button>
                <button
                  v-else-if="i.situacao === 'pronto' && s.agendamento && i.pacote"
                  type="button"
                  :disabled="acao.isPending.value"
                  :data-testid="`cme-entregar-${i.id}`"
                  @click="entregar(i.pacote, s.agendamento)"
                >
                  {{ t('cirurgia.cme.entregar') }}
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <h2>{{ t('cirurgia.cme.carga') }}</h2>
      <form class="filtros" data-testid="cme-carga-form" @submit.prevent="abrir">
        <SanteSelecao
          v-model="carga.equipamento"
          :rotulo="t('cirurgia.cme.equipamento')"
          :opcoes="opcoesEquipamento"
          data-testid="cme-carga-equipamento"
        />
        <SanteSelecao
          v-model="carga.metodo"
          :rotulo="t('cirurgia.cme.metodo')"
          :opcoes="opcoesMetodo"
          data-testid="cme-carga-metodo"
        />
        <fieldset>
          <legend>{{ t('cirurgia.cme.pacotes') }}</legend>
          <label v-for="x in aguardando" :key="x.id">
            <input
              v-model="carga.pacotes"
              type="checkbox"
              :value="x.id"
              :data-testid="`cme-carga-pacote-${x.etiqueta}`"
            />
            {{ x.etiqueta }} · {{ x.produto }}
          </label>
          <p v-if="aguardando.length === 0">{{ t('cirurgia.cme.nenhum') }}</p>
        </fieldset>
        <p v-if="!carga.equipamento || !carga.metodo || carga.pacotes.length === 0" class="dica">
          {{ t('cirurgia.cme.validacao.escolhaCarga') }}
        </p>
        <button
          type="submit"
          :disabled="
            !carga.equipamento || !carga.metodo || carga.pacotes.length === 0 || acao.isPending.value
          "
          data-testid="cme-abrir-ciclo"
        >
          {{ t('cirurgia.cme.abrirCiclo', { n: carga.pacotes.length }) }}
        </button>
      </form>

      <h2>{{ t('cirurgia.cme.ciclos') }}</h2>
      <p v-if="p.ciclos.length === 0">{{ t('cirurgia.cme.nenhum') }}</p>
      <table v-else class="tabela" data-testid="cme-ciclos">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.cme.numero') }}</th>
            <th scope="col">{{ t('cirurgia.cme.lote') }}</th>
            <th scope="col">{{ t('cirurgia.cme.equipamento') }}</th>
            <th scope="col">{{ t('cirurgia.cme.pacotes') }}</th>
            <th scope="col">{{ t('cirurgia.cme.situacao') }}</th>
            <th scope="col">{{ t('cirurgia.cme.indicadores') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in p.ciclos" :key="c.id" :data-testid="`cme-ciclo-${c.numero}`">
            <td>{{ c.numero }}</td>
            <td>{{ c.lote }}</td>
            <td>{{ c.equipamento }} · {{ c.metodo }}</td>
            <td>{{ c.pacotes }}</td>
            <td :data-testid="`cme-ciclo-situacao-${c.numero}`">{{ sit(c.situacao) }}</td>
            <td>
              <div v-if="c.situacao === 'em_andamento' || c.situacao === 'concluido'" class="filtros">
                <template v-if="c.situacao === 'em_andamento'">
                  <SanteSelecao
                    v-model="leitura(c).fisico"
                    :rotulo="t('cirurgia.cme.fisico')"
                    :opcoes="opcoesIndicador"
                    :data-testid="`cme-fisico-${c.numero}`"
                  />
                  <SanteSelecao
                    v-model="leitura(c).quimico"
                    :rotulo="t('cirurgia.cme.quimico')"
                    :opcoes="opcoesIndicador"
                    :data-testid="`cme-quimico-${c.numero}`"
                  />
                  <label
                    >{{ t('cirurgia.cme.temperatura') }}
                    <input v-model="leitura(c).temperatura" type="number" min="0" max="999"
                  /></label>
                  <label
                    >{{ t('cirurgia.cme.tempo') }}
                    <input v-model="leitura(c).tempo" type="number" min="0" max="1440"
                  /></label>
                </template>
                <SanteSelecao
                  v-model="leitura(c).biologico"
                  :rotulo="t('cirurgia.cme.biologico')"
                  :opcoes="opcoesIndicador"
                  :data-testid="`cme-biologico-${c.numero}`"
                />
                <button
                  v-if="c.situacao === 'em_andamento'"
                  type="button"
                  :disabled="
                    leitura(c).fisico === 'pendente' ||
                    leitura(c).quimico === 'pendente' ||
                    acao.isPending.value
                  "
                  :title="t('cirurgia.cme.validacao.indicadores')"
                  :data-testid="`cme-concluir-${c.numero}`"
                  @click="concluir(c)"
                >
                  {{ t('cirurgia.cme.concluir') }}
                </button>
                <button
                  v-else
                  type="button"
                  :disabled="leitura(c).biologico === 'pendente' || acao.isPending.value"
                  :data-testid="`cme-liberar-${c.numero}`"
                  @click="liberar(c)"
                >
                  {{ t('cirurgia.cme.liberar') }}
                </button>
              </div>
              <span v-else>
                {{ t('cirurgia.cme.fisico') }} {{ c.fisico ? '✓' : '✗' }} · {{ t('cirurgia.cme.quimico') }}
                {{ c.quimico ? '✓' : '✗' }} · {{ t('cirurgia.cme.biologico') }} {{ c.biologico ? '✓' : '—' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{{ t('cirurgia.cme.caixas') }}</h2>
      <p>
        <RouterLink to="/cirurgia/cme/cadastro" data-testid="cme-caixa-cadastro">{{
          t('cirurgia.cmeCadastro.titulo')
        }}</RouterLink>
      </p>
      <table class="tabela" data-testid="cme-caixas">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.cme.codigo') }}</th>
            <th scope="col">{{ t('cirurgia.cme.descricao') }}</th>
            <th scope="col">{{ t('cirurgia.cme.pecas') }}</th>
            <th scope="col">{{ t('cirurgia.cme.reprocessamentos') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in p.caixas" :key="c.id">
            <td>{{ c.codigo }}</td>
            <td>{{ c.descricao }}</td>
            <td>{{ c.pecas }}</td>
            <td>{{ c.reprocessamentos }}{{ c.limite ? ` / ${c.limite}` : '' }}</td>
            <td>
              <button
                type="button"
                :disabled="acao.isPending.value"
                :data-testid="`cme-caixa-preparar-${c.codigo}`"
                @click="preparar(c.id, null)"
              >
                {{ t('cirurgia.cme.preparar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{{ t('cirurgia.cme.equipamentos') }}</h2>
      <form class="filtros" data-testid="cme-equipamento-form" @submit.prevent="salvarEquipamento">
        <label
          >{{ t('cirurgia.cme.codigo') }}
          <input v-model="eq.codigo" maxlength="30" data-testid="cme-eq-codigo"
        /></label>
        <label
          >{{ t('cirurgia.cme.descricao') }}
          <input v-model="eq.descricao" maxlength="150" data-testid="cme-eq-descricao"
        /></label>
        <SanteSelecao
          v-model="eq.natureza"
          :rotulo="t('cirurgia.cme.natureza')"
          :opcoes="opcoesNatureza"
          data-testid="cme-eq-natureza"
        />
        <SanteSelecao
          v-model="eq.metodo"
          :rotulo="t('cirurgia.cme.metodo')"
          :opcoes="opcoesMetodo"
          data-testid="cme-eq-metodo"
        />
        <button
          type="submit"
          :disabled="!eq.codigo.trim() || !eq.descricao.trim() || acao.isPending.value"
          data-testid="cme-eq-salvar"
        >
          {{ t('cirurgia.cme.salvarEquipamento') }}
        </button>
      </form>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
