<script setup lang="ts">
// Estoque de hemocomponentes (M47, etapa 2; ficha, seção 7 e regra 3; construída e desligada pela chave da agência
// completa até a DP-21): o painel por hemocomponente e tipo (liberadas, reservadas, em quarentena e as que vencem em 3
// dias), a grade das bolsas com o filtro (situação, hemocomponente, tipo, validade, número), o recebimento do
// hemocentro com a inspeção e a temperatura de chegada (fora da faixa entra em quarentena), os movimentos (liberar,
// bloquear, reservar para a requisição, cancelar a reserva, descartar e devolver, com o motivo) e o histórico de cada
// bolsa (a transfusão no fim). As ações aparecem só com a permissão e a chave; o servidor confere de novo.
// W0-03: corrigir a etiqueta (número e tipagem), a validade e o volume antes do uso, com o motivo no diálogo único; as
// versões anteriores ficam legíveis no detalhe da bolsa (RDC 34/2014 art. 15 §1º).
import {
  ACOES_BOLSA,
  type AcaoBolsa,
  FATORES_RH,
  GRUPOS_ABO,
  HEMOCOMPONENTES_VISTOS,
  type MovimentoBolsaLido,
  type FatorRh,
  type GrupoAbo,
  type VersaoBolsaLida,
  rotuloTipagem,
  SITUACOES_BOLSA,
  temperaturaNaFaixaDoHemocomponente,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type BolsaComAcoes,
  corrigirBolsa,
  lerBolsa,
  lerCadastrosDoEstoque,
  lerEstoque,
  lerRequisicoesDoEstoque,
  movimentarBolsa,
  receberBolsa,
} from '../api-agencia.js';
import ErroTransfusao from '../componentes/ErroTransfusao.vue';
import { novaChave } from '../../enfermagem/api-enfermagem.js';
import DialogoCorrecao, { type DadosCorrecao } from '../../enfermagem/componentes/DialogoCorrecao.vue';

const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`sadt.agencia.${k}`, p ?? {});
const hora = (x: string | null) => (x ? x.slice(0, 16).replace('T', ' ') : '—');
const rotuloSituacao = (c: string) => SITUACOES_BOLSA.find((x) => x.codigo === c)?.rotulo ?? c;
const rotuloAcao = (c: string) => ACOES_BOLSA.find((x) => x.codigo === c)?.rotulo ?? c;
const rotuloRh = (r: string | null) =>
  r === 'positivo' ? 'Rh positivo' : r === 'negativo' ? 'Rh negativo' : '';

const filtro = reactive({ situacao: '', hemocomponente: '', abo: '', rh: '', venceEmDias: '', numero: '' });
const aplicado = ref<Record<string, string>>({});
const estoque = useQuery({
  queryKey: computed(() => ['agencia', 'estoque', aplicado.value]),
  queryFn: () => lerEstoque(aplicado.value),
});
const requisicoes = useQuery({
  queryKey: ['agencia', 'estoque', 'requisicoes'],
  queryFn: () => lerRequisicoesDoEstoque(),
});
// Os combos do local de armazenagem e do motivo de devolução ou perda vêm do cadastro da agência (ADR 0027).
const cadastros = useQuery({
  queryKey: ['agencia', 'estoque', 'cadastros'],
  queryFn: () => lerCadastrosDoEstoque(),
});
const opcoesLocal = computed(() =>
  (cadastros.data.value?.locais ?? []).map((x) => ({ valor: String(x.codigo), rotulo: x.descricao })),
);
const opcoesMotivo = computed(() =>
  (cadastros.data.value?.motivos ?? []).map((x) => ({ valor: String(x.codigo), rotulo: x.descricao })),
);
const rotuloMotivo = (c: number) =>
  cadastros.data.value?.motivos.find((x) => x.codigo === c)?.descricao ?? String(c);
const gravacao = computed(() => estoque.data.value?.gravacao ?? null);
function filtrar(): void {
  aplicado.value = { ...filtro, numero: filtro.numero.trim().toUpperCase() };
}

const todos = computed(() => [{ valor: '', rotulo: T('todos') }]);
const opcoesSituacao = computed(() => [
  ...todos.value,
  ...SITUACOES_BOLSA.map((s) => ({ valor: s.codigo, rotulo: s.rotulo })),
]);
const opcoesHemo = Object.entries(HEMOCOMPONENTES_VISTOS).map(([c, h]) => ({ valor: c, rotulo: h.rotulo }));
const opcoesHemoFiltro = computed(() => [...todos.value, ...opcoesHemo]);
const opcoesAbo = GRUPOS_ABO.map((g) => ({ valor: g, rotulo: g }));
const opcoesRh = FATORES_RH.map((r) => ({ valor: r, rotulo: rotuloRh(r) }));
const opcoesAboFiltro = computed(() => [...todos.value, ...opcoesAbo]);
const opcoesRhFiltro = computed(() => [...todos.value, ...opcoesRh]);
const opcoesSimNao = computed(() => [
  { valor: 'sim', rotulo: T('imuno.sim') },
  { valor: 'nao', rotulo: T('imuno.nao') },
]);

const chaves: Record<string, string> = {};
const chaveDe = (acao: string) => (chaves[acao] ??= novaChave(`estoque-${acao}`));
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// ── O recebimento ──────────────────────────────────────────────────────────────────────────────────
const receber = ref(false);
const rec = reactive({
  numero: '',
  hemocomponente: 'CH',
  abo: 'O',
  rh: 'positivo',
  volumeMl: '',
  validade: '',
  origem: '',
  local: '0',
  irradiada: 'nao',
  leucorreduzida: 'nao',
  temperaturaC: '',
  inspecaoOk: 'sim',
  liberarNaEntrada: 'sim',
});
const prontoReceber = computed(
  () =>
    /^[0-9A-Z][0-9A-Z-]{3,23}$/i.test(rec.numero.trim()) &&
    Number(rec.volumeMl) >= 1 &&
    !!rec.validade &&
    rec.origem.trim().length >= 2 &&
    rec.temperaturaC !== '' &&
    !ocupado.value,
);
async function enviarRecebimento(): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  avisos.value = [];
  try {
    const acao = `receber-${rec.numero.trim().toUpperCase()}`;
    const r = await receberBolsa(
      {
        numero: rec.numero.trim().toUpperCase(),
        hemocomponente: rec.hemocomponente,
        tipagem: { abo: rec.abo as 'O', rh: rec.rh as 'positivo' },
        volumeMl: Number(rec.volumeMl),
        validade: rec.validade.slice(0, 16),
        origem: rec.origem.trim(),
        local: Number(rec.local) || 0,
        irradiada: rec.irradiada === 'sim',
        leucorreduzida: rec.leucorreduzida === 'sim',
        temperaturaC: Number(rec.temperaturaC),
        inspecaoOk: rec.inspecaoOk === 'sim',
        liberarNaEntrada: rec.liberarNaEntrada === 'sim',
      },
      chaveDe(acao),
    );
    delete chaves[acao];
    mensagem.value = r.mensagem;
    avisos.value = r.alertas ?? [];
    receber.value = false;
    Object.assign(rec, { numero: '', volumeMl: '', temperaturaC: '' });
    await estoque.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── W0-03: corrigir a bolsa antes do uso ────────────────────────────────────────────────────────
const C = (k: string, p?: Record<string, unknown>) => t(`enfermagem.correcao.hemo.${k}`, p ?? {});
const dialogoCorrigir = ref(false);
const corr = reactive({
  numero: '',
  abo: 'O' as GrupoAbo,
  rh: 'positivo' as FatorRh,
  validade: '',
  volumeMl: '',
});
const corrigivel = computed(
  () => !!aberta.value && !aberta.value.ato && ['quarentena', 'liberada'].includes(aberta.value.situacao),
);
function abrirCorrigir(): void {
  const b = aberta.value;
  if (!b) return;
  Object.assign(corr, {
    numero: b.numero,
    abo: b.tipagem.abo ?? 'O',
    rh: b.tipagem.rh ?? 'positivo',
    validade: b.validade.slice(0, 16),
    volumeMl: String(b.volumeMl),
  });
  dialogoCorrigir.value = true;
}
const mudancasBolsa = computed(() => {
  const b = aberta.value;
  if (!b) return null;
  const m: Record<string, unknown> = {};
  if (corr.numero.trim().toUpperCase() !== b.numero) m['numero'] = corr.numero.trim().toUpperCase();
  if (corr.abo !== b.tipagem.abo || corr.rh !== b.tipagem.rh) m['tipagem'] = { abo: corr.abo, rh: corr.rh };
  if (corr.validade !== b.validade.slice(0, 16)) m['validade'] = corr.validade;
  if (Number(corr.volumeMl) !== b.volumeMl) m['volumeMl'] = Number(corr.volumeMl);
  return Object.keys(m).length ? m : null;
});
async function confirmarCorrigir(d: DadosCorrecao): Promise<void> {
  const b = aberta.value;
  if (!b || !mudancasBolsa.value) return;
  const r = await corrigirBolsa(b.id, { ...mudancasBolsa.value, versao: b.versao, motivo: d.motivo });
  mensagem.value = r.mensagem;
  await estoque.refetch();
  await abrir(b);
}
const opcoesAboCorr = GRUPOS_ABO.map((g) => ({ valor: g, rotulo: g }));
const opcoesRhCorr = FATORES_RH.map((f) => ({ valor: f, rotulo: rotuloRh(f) }));

// ── Os movimentos e o histórico ───────────────────────────────────────────────────────────────────
const aberta = ref<BolsaComAcoes | null>(null);
const historico = ref<readonly MovimentoBolsaLido[]>([]);
const versoes = ref<readonly VersaoBolsaLida[]>([]);
const mov = reactive({
  acao: '' as AcaoBolsa | '',
  requisicao: '',
  motivoCadastro: '0',
  motivo: '',
  reinspecao: 'nao',
});
async function abrir(b: BolsaComAcoes): Promise<void> {
  erro.value = null;
  try {
    const r = await lerBolsa(b.id);
    aberta.value = r.bolsa;
    historico.value = r.movimentos;
    versoes.value = r.versoes ?? [];
    Object.assign(mov, {
      acao: r.bolsa.acoes[0] ?? '',
      requisicao: '',
      motivoCadastro: '0',
      motivo: '',
      reinspecao: 'nao',
    });
  } catch (x) {
    erro.value = x;
  }
}
const opcoesAcao = computed(() =>
  (aberta.value?.acoes ?? []).map((a) => ({ valor: a, rotulo: rotuloAcao(a) })),
);
const opcoesRequisicao = computed(() =>
  (requisicoes.data.value?.itens ?? [])
    .filter((r) => !aberta.value || r.hemocomponente.codigo === aberta.value.hemocomponente.codigo)
    .map((r) => ({
      valor: String(r.id),
      rotulo: `${r.paciente.nome} · ${r.hemocomponente.rotulo} · ${hora(r.requisitadaEm)}`,
    })),
);
// Liberar da quarentena a bolsa que entrou com a temperatura fora da faixa ou a inspeção reprovada pede o motivo; a de
// inspeção reprovada pede também a reinspeção aprovada (o servidor confere de novo).
const pedeReinspecao = computed(() => mov.acao === 'liberar' && !!aberta.value && !aberta.value.inspecaoOk);
const pedeMotivoLiberacao = computed(
  () =>
    mov.acao === 'liberar' &&
    !!aberta.value &&
    (!aberta.value.inspecaoOk ||
      !temperaturaNaFaixaDoHemocomponente(aberta.value.hemocomponente.codigo, aberta.value.temperaturaC)),
);
const pedeMotivo = computed(
  () => ['bloquear', 'descartar', 'devolver'].includes(mov.acao) || pedeMotivoLiberacao.value,
);
const prontoMov = computed(
  () =>
    !!aberta.value &&
    !!mov.acao &&
    (mov.acao !== 'reservar' || !!mov.requisicao) &&
    (!pedeMotivo.value || mov.motivo.trim().length >= 5) &&
    (!pedeReinspecao.value || mov.reinspecao === 'sim') &&
    !ocupado.value,
);
async function movimentar(): Promise<void> {
  const b = aberta.value;
  if (!b || !mov.acao) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  avisos.value = [];
  try {
    const acao = `mov-${b.id}-${b.versao}-${mov.acao}`;
    const r = await movimentarBolsa(
      b.id,
      {
        acao: mov.acao,
        requisicao: mov.acao === 'reservar' ? Number(mov.requisicao) : null,
        motivoCadastro: ['descartar', 'devolver'].includes(mov.acao) ? Number(mov.motivoCadastro) || 0 : null,
        motivo: mov.motivo.trim() || null,
        ...(pedeReinspecao.value ? { inspecaoConferida: mov.reinspecao === 'sim' } : {}),
        versao: b.versao,
      },
      chaveDe(acao),
    );
    delete chaves[acao];
    mensagem.value = `${r.mensagem} ${rotuloSituacao(r.situacao ?? '')}`.trim();
    avisos.value = r.alertas ?? [];
    await estoque.refetch();
    await abrir(b);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-transfusao" aria-labelledby="ag-estoque-titulo" data-testid="tela-estoque">
    <h1 id="ag-estoque-titulo">{{ T('estoque.titulo') }}</h1>
    <SanteAlerta
      v-if="gravacao && !gravacao.ligada"
      variante="aviso"
      :texto="gravacao.motivo ?? T('desligada')"
      data-testid="ag-desligada"
    />
    <p v-if="mensagem" role="status" data-testid="ag-mensagem">{{ mensagem }}</p>
    <ul v-if="avisos.length" class="secundario" data-testid="ag-avisos">
      <li v-for="a in avisos" :key="a">{{ a }}</li>
    </ul>
    <ErroTransfusao v-if="erro" :erro="erro" />

    <section aria-labelledby="ag-resumo">
      <h2 id="ag-resumo">{{ T('estoque.resumo') }}</h2>
      <table v-if="estoque.data.value?.resumo.length" class="tabela" data-testid="ag-resumo">
        <caption class="sr">
          {{
            T('estoque.resumo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T('hemocomponente') }}</th>
            <th scope="col">{{ T('tipagem') }}</th>
            <th scope="col">{{ T('estoque.liberadas') }}</th>
            <th scope="col">{{ T('estoque.reservadas') }}</th>
            <th scope="col">{{ T('estoque.quarentena') }}</th>
            <th scope="col">{{ T('estoque.vencendo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in estoque.data.value.resumo"
            :key="`${r.hemocomponente}${r.abo}${r.rh}`"
            :data-testid="`ag-resumo-${r.hemocomponente}-${r.abo}-${r.rh}`"
          >
            <td>{{ HEMOCOMPONENTES_VISTOS[r.hemocomponente]?.rotulo ?? r.hemocomponente }}</td>
            <td>{{ rotuloTipagem({ abo: r.abo, rh: r.rh }) }}</td>
            <td>{{ r.liberadas }}</td>
            <td>{{ r.reservadas }}</td>
            <td>{{ r.quarentena }}</td>
            <td>{{ r.vencendo }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="estoque.data.value">{{ T('estoque.semBolsas') }}</p>
    </section>

    <div class="barra">
      <SanteBotao
        v-if="gravacao?.acoes.receber"
        :rotulo="T('estoque.receber')"
        data-testid="ag-abrir-receber"
        @acionar="receber = !receber"
      />
    </div>
    <form
      v-if="receber"
      class="cartao"
      aria-labelledby="ag-receber"
      data-testid="ag-form-receber"
      @submit.prevent="enviarRecebimento"
    >
      <h2 id="ag-receber">{{ T('estoque.receber') }}</h2>
      <div class="barra">
        <SanteCampoTexto
          id="ag-r-numero"
          v-model="rec.numero"
          :rotulo="T('estoque.numero')"
          :max-bytes="24"
        />
        <SanteSelecao
          v-model="rec.hemocomponente"
          :rotulo="T('hemocomponente')"
          :opcoes="opcoesHemo"
          data-testid="ag-r-hemo"
        />
        <SanteSelecao v-model="rec.abo" :rotulo="T('tipagem')" :opcoes="opcoesAbo" data-testid="ag-r-abo" />
        <SanteSelecao v-model="rec.rh" :rotulo="T('estoque.rh')" :opcoes="opcoesRh" data-testid="ag-r-rh" />
        <span class="campo">
          <label for="ag-r-volume">{{ T('estoque.volume') }}</label>
          <input
            id="ag-r-volume"
            v-model="rec.volumeMl"
            type="number"
            min="1"
            max="1000"
            data-testid="ag-r-volume"
          />
        </span>
        <span class="campo">
          <label for="ag-r-validade">{{ T('validade') }}</label>
          <input
            id="ag-r-validade"
            v-model="rec.validade"
            type="datetime-local"
            data-testid="ag-r-validade"
          />
        </span>
      </div>
      <div class="barra">
        <SanteCampoTexto
          id="ag-r-origem"
          v-model="rec.origem"
          :rotulo="T('estoque.origem')"
          :max-bytes="80"
        />
        <SanteSelecao
          v-model="rec.local"
          :rotulo="T('estoque.local')"
          :opcoes="opcoesLocal"
          :busca="true"
          data-testid="ag-r-local"
        />
        <span class="campo">
          <label for="ag-r-temp">{{ T('estoque.temperatura') }}</label>
          <input
            id="ag-r-temp"
            v-model="rec.temperaturaC"
            type="number"
            step="0.1"
            min="-80"
            max="40"
            data-testid="ag-r-temp"
          />
        </span>
        <SanteSelecao
          v-model="rec.irradiada"
          :rotulo="T('estoque.irradiada')"
          :opcoes="opcoesSimNao"
          data-testid="ag-r-irradiada"
        />
        <SanteSelecao
          v-model="rec.leucorreduzida"
          :rotulo="T('estoque.leucorreduzida')"
          :opcoes="opcoesSimNao"
          data-testid="ag-r-leuco"
        />
        <SanteSelecao
          v-model="rec.inspecaoOk"
          :rotulo="T('estoque.inspecao')"
          :opcoes="opcoesSimNao"
          data-testid="ag-r-inspecao"
        />
        <SanteSelecao
          v-model="rec.liberarNaEntrada"
          :rotulo="T('estoque.liberarNaEntrada')"
          :opcoes="opcoesSimNao"
          data-testid="ag-r-liberar"
        />
      </div>
      <div class="barra">
        <SanteBotao
          tipo="submit"
          :rotulo="T('gravar')"
          :desabilitado="!prontoReceber"
          data-testid="ag-r-gravar"
        />
        <SanteBotao variante="texto" :rotulo="T('cancelar')" @acionar="receber = false" />
      </div>
    </form>

    <section aria-labelledby="ag-bolsas">
      <h2 id="ag-bolsas">{{ T('estoque.bolsas') }}</h2>
      <form class="barra" role="search" data-testid="ag-filtro" @submit.prevent="filtrar">
        <SanteSelecao
          v-model="filtro.situacao"
          :rotulo="T('situacao')"
          :opcoes="opcoesSituacao"
          data-testid="ag-f-situacao"
        />
        <SanteSelecao
          v-model="filtro.hemocomponente"
          :rotulo="T('hemocomponente')"
          :opcoes="opcoesHemoFiltro"
          data-testid="ag-f-hemo"
        />
        <SanteSelecao
          v-model="filtro.abo"
          :rotulo="T('tipagem')"
          :opcoes="opcoesAboFiltro"
          data-testid="ag-f-abo"
        />
        <SanteSelecao
          v-model="filtro.rh"
          :rotulo="T('estoque.rh')"
          :opcoes="opcoesRhFiltro"
          data-testid="ag-f-rh"
        />
        <span class="campo">
          <label for="ag-f-vence">{{ T('estoque.venceEmDias') }}</label>
          <input id="ag-f-vence" v-model="filtro.venceEmDias" type="number" min="0" max="60" />
        </span>
        <SanteCampoTexto
          id="ag-f-numero"
          v-model="filtro.numero"
          :rotulo="T('estoque.numero')"
          :max-bytes="24"
        />
        <SanteBotao tipo="submit" :rotulo="T('estoque.filtrar')" data-testid="ag-filtrar" />
      </form>
      <ErroTransfusao v-if="estoque.isError.value" :erro="estoque.error.value" />
      <p v-else-if="!estoque.data.value" role="status">{{ T('carregando') }}</p>
      <p v-else-if="estoque.data.value.itens.length === 0">{{ T('estoque.semBolsas') }}</p>
      <table v-else class="tabela grade" data-testid="ag-bolsas">
        <caption class="sr">
          {{
            T('estoque.bolsas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T('estoque.numero') }}</th>
            <th scope="col">{{ T('hemocomponente') }}</th>
            <th scope="col">{{ T('tipagem') }}</th>
            <th scope="col">{{ T('estoque.volume') }}</th>
            <th scope="col">{{ T('validade') }}</th>
            <th scope="col">{{ T('situacao') }}</th>
            <th scope="col">{{ T('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="b in estoque.data.value.itens"
            :key="b.id"
            :data-testid="`ag-bolsa-${b.numero}`"
            :data-situacao="b.situacao"
          >
            <td>{{ b.numero }}</td>
            <td>{{ b.hemocomponente.rotulo }}{{ b.irradiada ? ` · ${T('estoque.irradiadaCurta')}` : '' }}</td>
            <td>{{ rotuloTipagem(b.tipagem) }}</td>
            <td>{{ b.volumeMl }}</td>
            <td>
              {{ hora(b.validade) }}<span v-if="b.vencida" class="marca"> {{ T('estoque.vencida') }}</span>
            </td>
            <td :data-testid="`ag-situacao-${b.numero}`">
              {{ rotuloSituacao(b.situacao) }}
              <span v-if="b.reservadaPara" class="secundario">{{
                T('estoque.reservadaPara', { r: b.reservadaPara.requisicao })
              }}</span>
            </td>
            <td>
              <SanteBotao
                :rotulo="T('estoque.movimentar')"
                :data-testid="`ag-abrir-bolsa-${b.numero}`"
                @acionar="abrir(b)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="estoque.data.value?.cortada" class="secundario">{{ T('cortada') }}</p>
    </section>

    <section v-if="aberta" class="cartao" aria-labelledby="ag-bolsa-aberta" data-testid="ag-bolsa-aberta">
      <h2 id="ag-bolsa-aberta">
        {{ aberta.numero }} · {{ aberta.hemocomponente.rotulo }} · {{ rotuloTipagem(aberta.tipagem) }} ·
        {{ rotuloSituacao(aberta.situacao) }}
      </h2>
      <p v-if="aberta.ato" class="secundario">{{ T('estoque.transfundida', { a: aberta.ato }) }}</p>
      <form
        v-if="gravacao?.acoes.movimentar && aberta.acoes.length"
        class="barra"
        data-testid="ag-form-mov"
        @submit.prevent="movimentar"
      >
        <SanteSelecao
          v-model="mov.acao"
          :rotulo="T('estoque.acao')"
          :opcoes="opcoesAcao"
          data-testid="ag-mov-acao"
        />
        <SanteSelecao
          v-if="mov.acao === 'reservar'"
          v-model="mov.requisicao"
          :rotulo="T('estoque.requisicao')"
          :opcoes="opcoesRequisicao"
          :busca="true"
          data-testid="ag-mov-requisicao"
        />
        <SanteSelecao
          v-if="mov.acao === 'descartar' || mov.acao === 'devolver'"
          v-model="mov.motivoCadastro"
          :rotulo="T('estoque.motivoCadastro')"
          :opcoes="opcoesMotivo"
          :busca="true"
          data-testid="ag-mov-motcad"
        />
        <SanteSelecao
          v-if="pedeReinspecao"
          v-model="mov.reinspecao"
          :rotulo="T('estoque.reinspecao')"
          :opcoes="opcoesSimNao"
          data-testid="ag-mov-reinspecao"
        />
        <p v-if="pedeReinspecao" class="secundario" data-testid="ag-mov-pede-reinspecao">
          {{ T('estoque.pedeReinspecao') }}
        </p>
        <p v-else-if="pedeMotivoLiberacao" class="secundario" data-testid="ag-mov-pede-motivo">
          {{ T('estoque.pedeMotivoLiberacao') }}
        </p>
        <SanteCampoTexto id="ag-mov-motivo" v-model="mov.motivo" :rotulo="T('motivo')" :max-bytes="300" />
        <SanteBotao
          tipo="submit"
          :rotulo="T('gravar')"
          :desabilitado="!prontoMov"
          data-testid="ag-mov-gravar"
        />
      </form>
      <SanteBotao
        v-if="gravacao?.acoes.corrigir && corrigivel"
        variante="secundario"
        :rotulo="C('corrigir')"
        data-testid="ag-corrigir"
        @acionar="abrirCorrigir"
      />
      <template v-if="versoes.length">
        <h3>{{ C('versoesBolsa') }}</h3>
        <ol class="tarefas" data-testid="ag-versoes">
          <li
            v-for="v in [...versoes].reverse()"
            :key="v.versao"
            class="inativa"
            :data-testid="`ag-versao-${v.versao}`"
          >
            {{
              C('corrigidaPor', {
                versao: v.versao,
                numero: v.numero,
                tipagem: rotuloTipagem(v.tipagem),
                volume: v.volumeMl,
                validade: hora(v.validade),
                por: v.corrigidaPor,
                quando: hora(v.corrigidaEm),
                motivo: v.motivo,
              })
            }}
          </li>
        </ol>
      </template>
      <h3>{{ T('estoque.historico') }}</h3>
      <ol class="tarefas" data-testid="ag-historico">
        <li v-for="m in historico" :key="m.id" :data-tipo="m.tipo">
          {{ hora(m.em) }} · {{ T(`estoque.tipos.${m.tipo}`) }} · {{ rotuloSituacao(m.situacaoDepois) }} ·
          {{ m.usuario }}<span v-if="m.motivoCadastro"> · {{ rotuloMotivo(m.motivoCadastro) }}</span
          ><span v-if="m.motivo"> · {{ m.motivo }}</span>
        </li>
      </ol>
      <SanteBotao variante="texto" :rotulo="T('fechar')" @acionar="aberta = null" />
    </section>
    <DialogoCorrecao
      v-model:visivel="dialogoCorrigir"
      :titulo="C('tituloCorrigir')"
      :texto="C('textoCorrigir')"
      testid="ag-dialogo-corrigir"
      :pode-confirmar="
        !!mudancasBolsa && Number(corr.volumeMl) > 0 && !!corr.validade && corr.numero.trim().length >= 4
      "
      :executar="confirmarCorrigir"
    >
      <div class="barra">
        <span class="campo">
          <label for="ag-corr-numero">{{ C('numero') }}</label>
          <input id="ag-corr-numero" v-model="corr.numero" maxlength="24" data-testid="ag-corr-numero" />
        </span>
        <SanteSelecao
          v-model="corr.abo"
          :rotulo="C('abo')"
          :opcoes="opcoesAboCorr"
          data-testid="ag-corr-abo"
        />
        <SanteSelecao v-model="corr.rh" :rotulo="C('rh')" :opcoes="opcoesRhCorr" data-testid="ag-corr-rh" />
        <span class="campo">
          <label for="ag-corr-validade">{{ C('validade') }}</label>
          <input
            id="ag-corr-validade"
            v-model="corr.validade"
            type="datetime-local"
            data-testid="ag-corr-validade"
          />
        </span>
        <span class="campo">
          <label for="ag-corr-volume">{{ C('volume') }}</label>
          <input
            id="ag-corr-volume"
            v-model="corr.volumeMl"
            type="number"
            min="1"
            max="1000"
            data-testid="ag-corr-volume"
          />
        </span>
      </div>
    </DialogoCorrecao>
  </section>
</template>

<style src="./estilo-transfusao.css"></style>
