<script setup lang="ts">
// Requisições transfusionais e amostras (M47, etapa 1; ficha, seção 7 e regra 1): as prescrições de hemoterapia
// vigentes a atender (o médico requisita a partir do item: a proposta vem do item, com a urgência dos 4 tipos de
// transfusão, a indicação, o termo de consentimento assinado e, na extrema urgência sem termo, a justificativa); a lista
// das requisições com o filtro (situação, urgência, período, paciente), o prazo e o atraso; a coleta da amostra à
// beira do leito com a pulseira e o cancelamento antes da transfusão; o atalho para o ato à beira do leito.
// W0-03: alterar hemocomponente, volume e urgência antes do atendimento, com o motivo no diálogo único; as versões
// anteriores ficam legíveis (RDC 34/2014 art. 15 §1º).
import {
  ESTADOS_REQUISICAO_TRANSFUSAO,
  HEMOCOMPONENTES_VISTOS,
  type RequisicaoTransfusionalLida,
  rotuloTipagem,
  rotuloUrgencia,
  URGENCIAS_TRANSFUSAO,
  type UrgenciaTransfusao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarRequisicao,
  cancelarRequisicao,
  type DetalheRequisicao,
  lerRequisicao,
  type ItemDetalhe,
  lerItem,
  lerItens,
  lerRequisicoes,
  registrarAmostra,
  requisitar,
} from '../api-transfusao.js';
import ErroTransfusao from '../componentes/ErroTransfusao.vue';
import DialogoCorrecao, { type DadosCorrecao } from '../../enfermagem/componentes/DialogoCorrecao.vue';
import { novaChave } from '../../enfermagem/api-enfermagem.js';

const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`sadt.transfusao.${k}`, p ?? {});
const hora = (x: string | null) => (x ? x.slice(0, 16).replace('T', ' ') : '—');

const itens = useQuery({ queryKey: ['transfusao', 'itens'], queryFn: () => lerItens() });
const filtro = reactive({ estado: '', urgencia: '', de: '', ate: '', termo: '' });
const aplicado = ref<Record<string, string>>({});
const lista = useQuery({
  queryKey: computed(() => ['transfusao', 'requisicoes', aplicado.value]),
  queryFn: () => lerRequisicoes(aplicado.value),
});
function filtrar(): void {
  aplicado.value = { ...filtro, termo: filtro.termo.trim() };
}
const gravacao = computed(() => itens.data.value?.gravacao ?? lista.data.value?.gravacao ?? null);
const opcoesEstado = computed(() => [
  { valor: '', rotulo: T('todos') },
  ...ESTADOS_REQUISICAO_TRANSFUSAO.map((e) => ({ valor: e.codigo, rotulo: e.rotulo })),
]);
const opcoesUrgenciaFiltro = computed(() => [
  { valor: '', rotulo: T('todos') },
  ...URGENCIAS_TRANSFUSAO.map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
]);
const opcoesUrgencia = URGENCIAS_TRANSFUSAO.map((u) => ({ valor: u.codigo, rotulo: u.rotulo }));
const opcoesSimNao = computed(() => [
  { valor: 'nao', rotulo: T('requisicoes.nao') },
  { valor: 'sim', rotulo: T('requisicoes.sim') },
  { valor: 'naoSabe', rotulo: T('requisicoes.naoSabe') },
]);
const opcoesGestacao = computed(() => [
  { valor: 'naoSeAplica', rotulo: T('requisicoes.naoSeAplica') },
  { valor: 'nao', rotulo: T('requisicoes.nao') },
  { valor: 'sim', rotulo: T('requisicoes.sim') },
]);

// A chave de cada pedido fica a mesma até gravar: o reenvio não grava duas vezes.
const chaves: Record<string, string> = {};
const chaveDe = (acao: string) => (chaves[acao] ??= novaChave(`transfusao-${acao}`));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function recarregar(): Promise<void> {
  await Promise.all([itens.refetch(), lista.refetch()]);
}

// ── A requisição a partir do item ────────────────────────────────────────────────────────────────
const detalhe = ref<ItemDetalhe | null>(null);
const form = reactive({
  quantidadeBolsas: '1',
  volumeMl: '',
  urgencia: 'rotina' as UrgenciaTransfusao,
  programadaPara: '',
  indicacao: '',
  examesDeApoio: '',
  termo: '',
  justificativaUrgencia: '',
  transfusaoAnterior: 'nao',
  reacaoAnterior: 'nao',
  gestacaoAnterior: 'naoSeAplica',
});
const opcoesTermo = computed(() => [
  { valor: '', rotulo: T('requisicoes.semTermo') },
  ...(detalhe.value?.termos ?? []).map((x) => ({
    valor: String(x.id),
    rotulo: `${x.procedimento} · ${x.em.slice(0, 10)}`,
  })),
]);
async function abrirRequisicao(item: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const d = await lerItem(item);
    detalhe.value = d;
    Object.assign(form, {
      quantidadeBolsas: String(d.proposta.quantidadeBolsas),
      volumeMl: d.proposta.volumeMl === null ? '' : String(d.proposta.volumeMl),
      urgencia: d.proposta.urgencia,
      programadaPara: '',
      indicacao: d.proposta.indicacao,
      examesDeApoio: '',
      termo: d.termos[0] ? String(d.termos[0].id) : '',
      justificativaUrgencia: '',
      transfusaoAnterior: 'nao',
      reacaoAnterior: 'nao',
      gestacaoAnterior: 'naoSeAplica',
    });
  } catch (x) {
    erro.value = x;
  }
}
const prontoRequisicao = computed(
  () =>
    !!detalhe.value &&
    Number(form.quantidadeBolsas) >= 1 &&
    form.indicacao.trim().length >= 10 &&
    (form.urgencia !== 'programada' || !!form.programadaPara) &&
    (!!form.termo || (form.urgencia === 'extremaUrgencia' && form.justificativaUrgencia.trim().length >= 10)),
);
async function enviarRequisicao(): Promise<void> {
  const d = detalhe.value;
  if (!d) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const k = chaveDe(`requisicao-${d.item.item}`);
    const r = await requisitar(
      {
        itemHemoterapia: d.item.item,
        atendimento: d.item.atendimento,
        quantidadeBolsas: Number(form.quantidadeBolsas),
        volumeMl: form.volumeMl ? Number(form.volumeMl) : null,
        urgencia: form.urgencia,
        programadaPara: form.urgencia === 'programada' ? form.programadaPara : null,
        indicacao: form.indicacao.trim(),
        examesDeApoio: form.examesDeApoio.trim() || null,
        termo: form.termo ? Number(form.termo) : null,
        justificativaUrgencia: form.justificativaUrgencia.trim() || null,
        transfusaoAnterior: form.transfusaoAnterior,
        reacaoAnterior: form.reacaoAnterior,
        gestacaoAnterior: form.gestacaoAnterior,
      },
      k,
    );
    delete chaves[`requisicao-${d.item.item}`];
    mensagem.value = `${r.mensagem} ${T('prazo')}: ${hora(r.prazo)}`;
    detalhe.value = null;
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── A amostra e o cancelamento ───────────────────────────────────────────────────────────────────
const amostraDe = ref<number | null>(null);
const amostra = reactive({ pulseira: '', identificadores: false, rotulada: false, coletadaEm: '' });
function abrirAmostra(id: number): void {
  amostraDe.value = id;
  cancelarDe.value = null;
  Object.assign(amostra, { pulseira: '', identificadores: false, rotulada: false, coletadaEm: '' });
}
async function enviarAmostra(): Promise<void> {
  if (!amostraDe.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const agora = lista.data.value?.agora ?? itens.data.value?.agora ?? '';
    const acao = `amostra-${amostraDe.value}`;
    const r = await registrarAmostra(
      amostraDe.value,
      {
        pulseira: { lida: true, codigo: amostra.pulseira.trim() },
        identificadoresConferidos: amostra.identificadores,
        rotuladaNoLeito: amostra.rotulada,
        coletadaEm: amostra.coletadaEm || agora.slice(0, 16),
      },
      chaveDe(acao),
    );
    delete chaves[acao];
    mensagem.value = r.mensagem;
    amostraDe.value = null;
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const cancelarDe = ref<number | null>(null);
const motivo = ref('');
async function enviarCancelamento(): Promise<void> {
  if (!cancelarDe.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    mensagem.value = (await cancelarRequisicao(cancelarDe.value, motivo.value.trim())).mensagem;
    cancelarDe.value = null;
    motivo.value = '';
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
// ── W0-03: alterar antes do atendimento e as versões ───────────────────────────────────────────
const C = (k: string, p?: Record<string, unknown>) => t(`enfermagem.correcao.hemo.${k}`, p ?? {});
const opcoesHemocomponente = Object.entries(HEMOCOMPONENTES_VISTOS).map(([valor, h]) => ({
  valor,
  rotulo: h.rotulo,
}));
const alterarDe = ref<RequisicaoTransfusionalLida | null>(null);
const dialogoAlterar = ref(false);
const alt = reactive({
  hemocomponente: '',
  volumeMl: '',
  urgencia: 'rotina' as UrgenciaTransfusao,
  programadaPara: '',
});
function abrirAlterar(r: RequisicaoTransfusionalLida): void {
  alterarDe.value = r;
  Object.assign(alt, {
    hemocomponente: r.hemocomponente.codigo,
    volumeMl: r.volumeMl === null ? '' : String(r.volumeMl),
    urgencia: r.urgencia,
    programadaPara: r.programadaPara ? r.programadaPara.slice(0, 16) : '',
  });
  dialogoAlterar.value = true;
}
const mudouAlguma = computed(() => {
  const r = alterarDe.value;
  if (!r) return false;
  return (
    alt.hemocomponente !== r.hemocomponente.codigo ||
    (alt.volumeMl === '' ? null : Number(alt.volumeMl)) !== r.volumeMl ||
    alt.urgencia !== r.urgencia ||
    (alt.urgencia === 'programada' && alt.programadaPara !== (r.programadaPara ?? '').slice(0, 16))
  );
});
const podeAlterar = computed(
  () => mudouAlguma.value && (alt.urgencia !== 'programada' || alt.programadaPara !== ''),
);
async function confirmarAlterar(d: DadosCorrecao): Promise<void> {
  const r = alterarDe.value;
  if (!r) return;
  const x = await alterarRequisicao(r.id, {
    hemocomponente: alt.hemocomponente,
    volumeMl: alt.volumeMl === '' ? null : Number(alt.volumeMl),
    urgencia: alt.urgencia,
    programadaPara: alt.urgencia === 'programada' ? alt.programadaPara : null,
    motivo: d.motivo,
  });
  mensagem.value = x.mensagem;
  await recarregar();
  if (versoesDe.value?.requisicao.id === r.id) await abrirVersoes(r.id);
}
const versoesDe = ref<DetalheRequisicao | null>(null);
async function abrirVersoes(id: number): Promise<void> {
  erro.value = null;
  try {
    versoesDe.value = await lerRequisicao(id);
  } catch (x) {
    erro.value = x;
  }
}
const rotuloHemo = (c: string) => HEMOCOMPONENTES_VISTOS[c]?.rotulo ?? c;
const passos = computed(() => (gravacao.value?.passos ?? []).map((p) => T(`passos.${p}`)).join(', '));
</script>

<template>
  <section class="tela-transfusao" aria-labelledby="tr-titulo" data-testid="tela-requisicoes-transfusao">
    <h1 id="tr-titulo">{{ T('requisicoes.titulo') }}</h1>
    <SanteAlerta
      v-if="gravacao && !gravacao.ligada"
      variante="aviso"
      :texto="gravacao.motivo ?? T('desligado')"
      data-testid="tr-desligado"
    />
    <p v-else-if="passos" class="secundario">{{ T('passosDoFluxo', { passos }) }}</p>
    <p v-if="mensagem" role="status" data-testid="tr-mensagem">{{ mensagem }}</p>
    <ErroTransfusao v-if="erro" :erro="erro" />

    <section aria-labelledby="tr-itens">
      <h2 id="tr-itens">{{ T('requisicoes.aAtender') }}</h2>
      <ErroTransfusao v-if="itens.isError.value" :erro="itens.error.value" />
      <p v-else-if="!itens.data.value" role="status">{{ T('carregando') }}</p>
      <p v-else-if="itens.data.value.itens.length === 0">{{ T('requisicoes.semItens') }}</p>
      <table v-else class="tabela" data-testid="tr-itens">
        <caption class="sr">
          {{
            T('requisicoes.aAtender')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T('paciente') }}</th>
            <th scope="col">{{ T('hemocomponente') }}</th>
            <th scope="col">{{ T('dose') }}</th>
            <th scope="col">{{ T('prescritoEm') }}</th>
            <th scope="col">{{ T('horariosPrescricao') }}</th>
            <th scope="col">{{ T('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itens.data.value.itens" :key="i.item" :data-testid="`tr-item-${i.item}`">
            <td>{{ i.paciente.nome }} · {{ T('prontuario', { n: i.paciente.prontuario ?? '—' }) }}</td>
            <td>{{ i.hemocomponente.rotulo }}</td>
            <td>{{ i.dose }} {{ i.unidadeDose }}</td>
            <td>{{ hora(i.prescritoEm) }}</td>
            <td>{{ i.horarios || T('semHorario') }}</td>
            <td>
              <SanteBotao
                v-if="gravacao?.acoes.requisitar"
                :rotulo="T('requisicoes.requisitar')"
                :data-testid="`tr-requisitar-${i.item}`"
                @acionar="abrirRequisicao(i.item)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="itens.data.value?.cortada" class="secundario">{{ T('cortada') }}</p>
    </section>

    <form
      v-if="detalhe"
      class="cartao"
      aria-labelledby="tr-form-titulo"
      data-testid="tr-form-requisicao"
      @submit.prevent="enviarRequisicao"
    >
      <h2 id="tr-form-titulo">
        {{ T('requisicoes.requisitar') }}: {{ detalhe.proposta.rotulo }} · {{ detalhe.item.paciente.nome }}
      </h2>
      <p class="secundario">{{ T('tipagemCadastro', { t: rotuloTipagem(detalhe.tipagem) }) }}</p>
      <div class="barra">
        <span class="campo">
          <label for="tr-qtde">{{ T('requisicoes.quantidade') }}</label>
          <input
            id="tr-qtde"
            v-model="form.quantidadeBolsas"
            type="number"
            min="1"
            max="20"
            data-testid="tr-qtde"
          />
        </span>
        <span class="campo">
          <label for="tr-volume">{{ T('requisicoes.volume') }}</label>
          <input id="tr-volume" v-model="form.volumeMl" type="number" min="1" max="5000" />
        </span>
        <SanteSelecao
          v-model="form.urgencia"
          :rotulo="T('urgencia')"
          :opcoes="opcoesUrgencia"
          data-testid="tr-urgencia"
        />
        <span v-if="form.urgencia === 'programada'" class="campo">
          <label for="tr-programada">{{ T('requisicoes.programadaPara') }}</label>
          <input id="tr-programada" v-model="form.programadaPara" type="datetime-local" />
        </span>
      </div>
      <SanteCampoTexto
        id="tr-indicacao"
        v-model="form.indicacao"
        :rotulo="T('requisicoes.indicacao')"
        :max-bytes="2000"
        :multilinha="true"
        :obrigatorio="true"
      />
      <SanteCampoTexto
        id="tr-exames"
        v-model="form.examesDeApoio"
        :rotulo="T('requisicoes.examesApoio')"
        :max-bytes="500"
      />
      <div class="barra">
        <SanteSelecao
          v-model="form.termo"
          :rotulo="T('requisicoes.termo')"
          :opcoes="opcoesTermo"
          :busca="true"
          data-testid="tr-termo"
        />
        <SanteSelecao
          v-model="form.transfusaoAnterior"
          :rotulo="T('requisicoes.transfusaoAnterior')"
          :opcoes="opcoesSimNao"
          data-testid="tr-transf-anterior"
        />
        <SanteSelecao
          v-model="form.reacaoAnterior"
          :rotulo="T('requisicoes.reacaoAnterior')"
          :opcoes="opcoesSimNao"
          data-testid="tr-reacao-anterior"
        />
        <SanteSelecao
          v-model="form.gestacaoAnterior"
          :rotulo="T('requisicoes.gestacaoAnterior')"
          :opcoes="opcoesGestacao"
          data-testid="tr-gestacao"
        />
      </div>
      <template v-if="form.urgencia === 'extremaUrgencia'">
        <p class="secundario">{{ T('requisicoes.dispensaProvas') }}</p>
        <SanteCampoTexto
          id="tr-justificativa"
          v-model="form.justificativaUrgencia"
          :rotulo="T('requisicoes.justificativaUrgencia')"
          :max-bytes="500"
          :multilinha="true"
        />
      </template>
      <div class="barra">
        <SanteBotao
          tipo="submit"
          :rotulo="T('gravar')"
          :desabilitado="!prontoRequisicao || ocupado"
          data-testid="tr-gravar-requisicao"
        />
        <SanteBotao variante="texto" :rotulo="T('cancelar')" @acionar="detalhe = null" />
      </div>
    </form>

    <section aria-labelledby="tr-lista">
      <h2 id="tr-lista">{{ T('requisicoes.lista') }}</h2>
      <form class="barra" role="search" data-testid="tr-filtro" @submit.prevent="filtrar">
        <SanteSelecao
          v-model="filtro.estado"
          :rotulo="T('situacao')"
          :opcoes="opcoesEstado"
          data-testid="tr-f-estado"
        />
        <SanteSelecao
          v-model="filtro.urgencia"
          :rotulo="T('urgencia')"
          :opcoes="opcoesUrgenciaFiltro"
          data-testid="tr-f-urgencia"
        />
        <span class="campo">
          <label for="tr-f-de">{{ T('de') }}</label>
          <input id="tr-f-de" v-model="filtro.de" type="date" />
        </span>
        <span class="campo">
          <label for="tr-f-ate">{{ T('ate') }}</label>
          <input id="tr-f-ate" v-model="filtro.ate" type="date" />
        </span>
        <SanteCampoTexto
          id="tr-f-termo"
          v-model="filtro.termo"
          :rotulo="T('buscarPaciente')"
          :max-bytes="60"
        />
        <SanteBotao tipo="submit" :rotulo="T('filtrar')" data-testid="tr-filtrar" />
      </form>
      <ErroTransfusao v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ T('carregando') }}</p>
      <p v-else-if="lista.data.value.itens.length === 0">{{ T('requisicoes.semRequisicoes') }}</p>
      <table v-else class="tabela" data-testid="tr-requisicoes">
        <caption class="sr">
          {{
            T('requisicoes.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T('requisitadaEm') }}</th>
            <th scope="col">{{ T('paciente') }}</th>
            <th scope="col">{{ T('hemocomponente') }}</th>
            <th scope="col">{{ T('urgencia') }}</th>
            <th scope="col">{{ T('prazo') }}</th>
            <th scope="col">{{ T('situacao') }}</th>
            <th scope="col">{{ T('requisicoes.amostra') }}</th>
            <th scope="col">{{ T('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in lista.data.value.itens"
            :key="r.id"
            :data-testid="`tr-req-${r.id}`"
            :data-estado="r.estado"
            :data-item="r.item"
          >
            <td>{{ hora(r.requisitadaEm) }}</td>
            <td>{{ r.paciente.nome }} · {{ rotuloTipagem(r.tipagem) }}</td>
            <td>
              {{ r.hemocomponente.rotulo }} ·
              {{ T('bolsas', { feitas: r.bolsasTransfundidas, pedidas: r.quantidadeBolsas }) }}
            </td>
            <td>{{ rotuloUrgencia(r.urgencia) }}</td>
            <td>
              {{ hora(r.prazo) }}
              <strong v-if="r.atrasada" class="alerta">{{ T('atrasada') }}</strong>
            </td>
            <td>{{ ESTADOS_REQUISICAO_TRANSFUSAO.find((e) => e.codigo === r.estado)?.rotulo }}</td>
            <td>{{ r.amostra ? r.amostra.codigo : '—' }}</td>
            <td class="acoes">
              <SanteBotao
                v-if="gravacao?.acoes.amostra && ['requisitada', 'amostraColetada'].includes(r.estado)"
                variante="texto"
                :rotulo="T('requisicoes.coletarAmostra')"
                :data-testid="`tr-amostra-${r.id}`"
                @acionar="abrirAmostra(r.id)"
              />
              <SanteBotao
                v-if="gravacao?.acoes.alterar && ['requisitada', 'amostraColetada'].includes(r.estado)"
                variante="texto"
                :rotulo="C('alterar')"
                :data-testid="`tr-alterar-${r.id}`"
                @acionar="abrirAlterar(r)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="C('versoes')"
                :data-testid="`tr-versoes-${r.id}`"
                @acionar="abrirVersoes(r.id)"
              />
              <SanteBotao
                v-if="gravacao?.acoes.cancelar && ['requisitada', 'amostraColetada'].includes(r.estado)"
                variante="texto"
                :rotulo="T('requisicoes.cancelarRequisicao')"
                :data-testid="`tr-cancelar-${r.id}`"
                @acionar="((cancelarDe = r.id), (amostraDe = null))"
              />
              <RouterLink
                v-if="['requisitada', 'amostraColetada', 'emAtendimento', 'atendida'].includes(r.estado)"
                :to="{ name: 'enfermagem.transfusao', params: { req: String(r.id) } }"
                :data-testid="`tr-ato-${r.id}`"
              >
                {{ T('abrirAto') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="lista.data.value?.cortada" class="secundario">{{ T('cortada') }}</p>
    </section>

    <section
      v-if="versoesDe"
      class="cartao"
      aria-labelledby="tr-versoes-titulo"
      :data-testid="`tr-painel-versoes-${versoesDe.requisicao.id}`"
    >
      <h2 id="tr-versoes-titulo">{{ C('tituloVersoes', { id: versoesDe.requisicao.id }) }}</h2>
      <table class="tabela">
        <caption class="sr">
          {{
            C('tituloVersoes', { id: versoesDe.requisicao.id })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ C('versoes') }}</th>
            <th scope="col">{{ C('hemocomponente') }}</th>
            <th scope="col">{{ C('volume') }}</th>
            <th scope="col">{{ C('urgencia') }}</th>
            <th scope="col">{{ T('prazo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr data-testid="tr-versao-vigente">
            <td>
              <strong>{{ C('vigente', { versao: versoesDe.versaoVigente ?? 1 }) }}</strong>
            </td>
            <td>{{ versoesDe.requisicao.hemocomponente.rotulo }}</td>
            <td>{{ versoesDe.requisicao.volumeMl ?? '—' }}</td>
            <td>{{ rotuloUrgencia(versoesDe.requisicao.urgencia) }}</td>
            <td>{{ hora(versoesDe.requisicao.prazo) }}</td>
          </tr>
          <tr
            v-for="v in [...(versoesDe.versoes ?? [])].reverse()"
            :key="v.versao"
            class="inativa"
            :data-testid="`tr-versao-${v.versao}`"
          >
            <td>
              {{ C('versao', { versao: v.versao }) }}
              <small class="secundario">
                {{ C('alteradaPor', { por: v.alteradaPor, quando: hora(v.alteradaEm), motivo: v.motivo }) }}
              </small>
            </td>
            <td>{{ rotuloHemo(v.hemocomponente) }}</td>
            <td>{{ v.volumeMl ?? '—' }}</td>
            <td>{{ rotuloUrgencia(v.urgencia) }}</td>
            <td>{{ hora(v.prazo) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!(versoesDe.versoes ?? []).length" class="secundario">{{ C('semVersoes') }}</p>
      <SanteBotao variante="texto" :rotulo="C('fecharVersoes')" @acionar="versoesDe = null" />
    </section>

    <DialogoCorrecao
      v-model:visivel="dialogoAlterar"
      :titulo="C('tituloAlterar')"
      :texto="C('textoAlterar')"
      testid="tr-dialogo-alterar"
      :pode-confirmar="podeAlterar"
      :executar="confirmarAlterar"
    >
      <div class="barra">
        <SanteSelecao
          v-model="alt.hemocomponente"
          :rotulo="C('hemocomponente')"
          :opcoes="opcoesHemocomponente"
          data-testid="tr-alt-hemocomponente"
        />
        <span class="campo">
          <label for="tr-alt-volume">{{ C('volume') }}</label>
          <input
            id="tr-alt-volume"
            v-model="alt.volumeMl"
            type="number"
            min="1"
            max="5000"
            data-testid="tr-alt-volume"
          />
        </span>
        <SanteSelecao
          v-model="alt.urgencia"
          :rotulo="C('urgencia')"
          :opcoes="opcoesUrgencia"
          data-testid="tr-alt-urgencia"
        />
        <span v-if="alt.urgencia === 'programada'" class="campo">
          <label for="tr-alt-programada">{{ C('programadaPara') }}</label>
          <input id="tr-alt-programada" v-model="alt.programadaPara" type="datetime-local" />
        </span>
      </div>
    </DialogoCorrecao>

    <form v-if="amostraDe" class="cartao" data-testid="tr-form-amostra" @submit.prevent="enviarAmostra">
      <h2>{{ T('requisicoes.coletarAmostra') }} · {{ T('requisicoes.detalhe', { id: amostraDe }) }}</h2>
      <SanteCampoTexto
        id="tr-pulseira"
        v-model="amostra.pulseira"
        :rotulo="T('requisicoes.lerPulseira')"
        :max-bytes="64"
      />
      <label class="marca">
        <input v-model="amostra.identificadores" type="checkbox" data-testid="tr-identificadores" />
        {{ T('requisicoes.identificadores') }}
      </label>
      <label class="marca">
        <input v-model="amostra.rotulada" type="checkbox" data-testid="tr-rotulada" />
        {{ T('requisicoes.rotuladaNoLeito') }}
      </label>
      <span class="campo">
        <label for="tr-coletada">{{ T('requisicoes.coletadaEm') }}</label>
        <input id="tr-coletada" v-model="amostra.coletadaEm" type="datetime-local" />
      </span>
      <div class="barra">
        <SanteBotao
          tipo="submit"
          :rotulo="T('gravar')"
          :desabilitado="!amostra.pulseira.trim() || !amostra.identificadores || !amostra.rotulada || ocupado"
          data-testid="tr-gravar-amostra"
        />
        <SanteBotao variante="texto" :rotulo="T('cancelar')" @acionar="amostraDe = null" />
      </div>
    </form>

    <form
      v-if="cancelarDe"
      class="cartao"
      data-testid="tr-form-cancelar"
      @submit.prevent="enviarCancelamento"
    >
      <h2>{{ T('requisicoes.cancelarRequisicao') }} · {{ T('requisicoes.detalhe', { id: cancelarDe }) }}</h2>
      <SanteCampoTexto
        id="tr-motivo"
        v-model="motivo"
        :rotulo="T('requisicoes.motivoCancelamento')"
        :max-bytes="200"
      />
      <div class="barra">
        <SanteBotao
          tipo="submit"
          :rotulo="T('confirmar')"
          :desabilitado="motivo.trim().length < 5 || ocupado"
          data-testid="tr-confirmar-cancelar"
        />
        <SanteBotao variante="texto" :rotulo="T('voltar')" @acionar="cancelarDe = null" />
      </div>
    </form>
  </section>
</template>

<style src="./estilo-transfusao.css"></style>
