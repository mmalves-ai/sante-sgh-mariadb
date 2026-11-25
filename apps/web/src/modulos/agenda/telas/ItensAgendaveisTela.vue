<script setup lang="ts">
// 02-AGE linha 45: itens agendáveis. Uma tela só, em duas partes. (1) O cadastro do item (consulta, exame,
// procedimento, sessão ou pacote) com as regras que valem na marcação, todas no mesmo formulário: composição do
// pacote, pré-requisito com validade, conflito com intervalo e sentido, recurso ou equipamento exigido e orientação de
// preparo por convênio. A validação é a do domínio, na hora; o servidor confere de novo (código repetido, ciclo de
// pré-requisito, pacote dentro de pacote). (2) Na marcação (?marcacao=): escolher os itens, ver na hora o que bloqueia
// (pré-requisito, conflito, equipamento ocupado) e o preparo que o paciente recebe, lançar e imprimir o preparo.
import { type ItemAgendavelEntrada, validarItemAgendavel } from '@sgh/dominio-agenda';
import { SanteBotao, SanteCampoTexto, SanteChave, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { novaChave } from '../api-agenda.js';
import {
  type CriticaMarcacao,
  criticarItensMarcacao,
  DIRECOES,
  type EntradaItem,
  type ItemLido,
  lancarItensMarcacao,
  lerItemAgendavel,
  lerItensAgendaveis,
  lerItensDaMarcacao,
  lerOpcoesItem,
  PAPEIS,
  salvarItemAgendavel,
  TIPOS_ITEM,
  TIPOS_REQUISITO,
} from '../api-itens-agendaveis.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Itens agendáveis',
      explicacao:
        'O que se marca, com as regras conferidas na marcação: pré-requisito, conflito entre itens, equipamento livre e o preparo entregue ao paciente (com a orientação do convênio).',
      buscar: 'Buscar por código ou descrição',
      nenhum: 'Nenhum item encontrado.',
      novo: 'Novo item',
      editar: 'Editar {codigo}',
      codigo: 'Código',
      descricao: 'Descrição',
      tipo: 'Tipo',
      duracao: 'Duração (min)',
      diasPreparo: 'Dias de preparo',
      orientacaoPreparo: 'Orientação de preparo ao paciente',
      intervalo: 'Intervalo mínimo entre realizações (min)',
      exigeAutorizacao: 'Exige guia autorizada',
      exigeIndicacao: 'Exige indicação clínica',
      teleatendimento: 'Pode ser por teleatendimento',
      ativo: 'Ativo',
      inativo: 'inativo',
      regras: 'Regras',
      resumo:
        '{req} pré-requisito(s), {conf} conflito(s), {rec} recurso(s), {ori} orientação(ões) por convênio',
      tipos: {
        consulta: 'Consulta',
        exame: 'Exame',
        procedimento: 'Procedimento',
        sessao: 'Sessão',
        composto: 'Pacote (composto)',
      },
      composicao: 'Itens do pacote',
      requisitos: 'Pré-requisitos',
      conflitos: 'Conflitos com outros itens',
      recursos: 'Recursos e equipamentos',
      orientacoes: 'Orientação por convênio',
      item: 'Item',
      quantidade: 'Quantidade',
      tipoRequisito: 'Exigência',
      tiposRequisito: {
        item_realizado: 'Item realizado antes',
        item_marcado: 'Item marcado antes',
        autorizacao: 'Autorização',
        documento: 'Documento',
        condicao: 'Outra condição',
      },
      condicao: 'Condição a conferir',
      prazo: 'Validade (dias)',
      bloqueia: 'Bloqueia a marcação',
      soAlerta: 'só alerta',
      horas: 'Intervalo mínimo (h)',
      sentido: 'Sentido',
      sentidos: { ambos: 'Antes ou depois', antes: 'O outro antes deste', depois: 'O outro depois deste' },
      recurso: 'Recurso',
      papel: 'Papel',
      papeis: { exigido: 'Exigido junto', realiza: 'Realiza o item' },
      convenio: 'Convênio',
      orientacao: 'Orientação',
      incluir: 'Incluir',
      retirar: 'Retirar',
      gravar: 'Gravar item',
      fechar: 'Fechar',
      marcacao: 'Itens na marcação',
      numeroMarcacao: 'Número interno da marcação',
      escolherItem: 'Item a marcar',
      conferir: 'Conferir',
      lancar: 'Lançar na marcação',
      bloqueios: 'Impede a marcação',
      alertas: 'Atenção',
      preparo: 'Preparo do paciente',
      semPreparo: 'Sem preparo.',
      lancados: 'Itens lançados',
      equipamentos: 'Equipamentos reservados',
      imprimir: 'Imprimir o preparo',
      descricaoDuracao: '{descricao} · {minutos} min',
      vezes: '{nome} × {quantidade}',
      conflitoLinha: '{nome}: {horas} h, {sentido}',
      recursoLinha: '{nome} — {papel} × {quantidade}',
    },
  },
});
const qc = useQueryClient();
const route = useRoute();
const podeEditar = computed(() => podePermissao('agenda.cobertura.editar'));
const podeAgendar = computed(() => podePermissao('agenda.marcacao.agendar'));
const busca = ref('');
const lista = useQuery({
  queryKey: computed(() => ['agenda-itens-agendaveis', busca.value.trim()]),
  queryFn: () => lerItensAgendaveis(busca.value),
});
const opcoes = useQuery({ queryKey: ['agenda-itens-agendaveis-opcoes'], queryFn: lerOpcoesItem });
const erro = ref<unknown>(null);
const mensagem = ref('');
const opcoesDe = (xs: { id: number; nome: string }[] | undefined, excluir: number[] = []) => [
  { valor: '', rotulo: '—' },
  ...(xs ?? []).filter((x) => !excluir.includes(x.id)).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const nomeDe = (xs: { id: number; nome: string }[] | undefined, id: number | null) =>
  xs?.find((x) => x.id === id)?.nome ?? `#${id}`;

// ── Cadastro ────────────────────────────────────────────────────────────────────────────────────────
const editando = ref<number | 'novo' | null>(null);
const versaoLida = ref<number | null>(null);
const vazio = (): EntradaItem => ({
  codigo: '',
  descricao: '',
  tipoItem: 'exame',
  duracaoMinutos: 30,
  diasPreparo: null,
  orientacaoPreparo: null,
  intervaloRepeticaoMinutos: null,
  exigeAutorizacao: false,
  exigeIndicacaoClinica: false,
  teleatendimento: false,
  ativo: true,
  composicao: [],
  conflitos: [],
  requisitos: [],
  recursos: [],
  orientacoes: [],
});
const form = reactive<EntradaItem>(vazio());
/** Campos numéricos digitados como texto (vazio = sem valor). */
const txt = reactive({ duracao: '30', dias: '', intervalo: '', orientacao: '' });
const inteiro = (s: string): number | null => (s.trim() === '' ? null : Number(s.trim()));
function preencher(i: ItemLido | null) {
  Object.assign(form, vazio(), i ? { ...i } : {});
  txt.duracao = String(form.duracaoMinutos);
  txt.dias = form.diasPreparo === null ? '' : String(form.diasPreparo);
  txt.intervalo = form.intervaloRepeticaoMinutos === null ? '' : String(form.intervaloRepeticaoMinutos);
  txt.orientacao = form.orientacaoPreparo ?? '';
}
async function abrir(id: number | null) {
  erro.value = null;
  mensagem.value = '';
  try {
    const i = id === null ? null : await lerItemAgendavel(id);
    preencher(i);
    versaoLida.value = i?.versao ?? null;
    editando.value = id ?? 'novo';
  } catch (e) {
    erro.value = e;
  }
}
const entrada = computed<EntradaItem>(() => ({
  ...form,
  codigo: form.codigo.trim(),
  descricao: form.descricao.trim(),
  duracaoMinutos: inteiro(txt.duracao) ?? 0,
  diasPreparo: inteiro(txt.dias),
  intervaloRepeticaoMinutos: inteiro(txt.intervalo),
  orientacaoPreparo: txt.orientacao.trim() || null,
  composicao: form.tipoItem === 'composto' ? form.composicao : [],
}));
const recusa = computed(() =>
  editando.value === null
    ? null
    : validarItemAgendavel(
        entrada.value as ItemAgendavelEntrada,
        editando.value === 'novo' ? null : editando.value,
      ),
);
const opcoesTipo = computed(() => TIPOS_ITEM.map((x) => ({ valor: x, rotulo: t(`tipos.${x}`) })));
const outrosItens = computed(() => (opcoes.data.value?.itens ?? []).filter((x) => x.id !== editando.value));

// Linhas novas de cada regra (o combo some com o que já está na lista).
const nova = reactive({
  componente: '',
  qtdComp: '1',
  reqTipo: 'item_realizado',
  reqItem: '',
  reqCond: '',
  reqPrazo: '',
  reqBloqueia: true,
  confItem: '',
  confHoras: '24',
  confSentido: 'ambos',
  recurso: '',
  papel: 'exigido',
  qtdRec: '1',
  fonte: '',
  orientacao: '',
});
const reqPorItem = computed(() => nova.reqTipo === 'item_realizado' || nova.reqTipo === 'item_marcado');
function incluirComposicao() {
  form.composicao.push({ componente: Number(nova.componente), quantidade: Number(nova.qtdComp) || 1 });
  nova.componente = '';
}
function incluirRequisito() {
  form.requisitos.push({
    tipo: nova.reqTipo as (typeof TIPOS_REQUISITO)[number],
    item: reqPorItem.value ? Number(nova.reqItem) : null,
    descricao: reqPorItem.value ? null : nova.reqCond.trim(),
    prazoMaximoDias: inteiro(nova.reqPrazo),
    bloqueia: nova.reqBloqueia,
  });
  nova.reqItem = '';
  nova.reqCond = '';
}
function incluirConflito() {
  form.conflitos.push({
    item: Number(nova.confItem),
    intervaloMinimoHoras: Number(nova.confHoras.replace(',', '.')),
    direcao: nova.confSentido as (typeof DIRECOES)[number],
  });
  nova.confItem = '';
}
function incluirRecurso() {
  form.recursos.push({
    recurso: Number(nova.recurso),
    papel: nova.papel as (typeof PAPEIS)[number],
    quantidade: Number(nova.qtdRec) || 1,
  });
  nova.recurso = '';
}
function incluirOrientacao() {
  form.orientacoes.push({ fontePagadora: Number(nova.fonte), orientacao: nova.orientacao.trim() });
  nova.fonte = '';
  nova.orientacao = '';
}

async function gravar() {
  if (recusa.value) return;
  erro.value = null;
  try {
    const id = editando.value === 'novo' ? null : (editando.value as number);
    const r = await salvarItemAgendavel(
      id,
      { ...entrada.value, ...(id !== null && versaoLida.value !== null ? { versao: versaoLida.value } : {}) },
      novaChave('item-agendavel'),
    );
    await qc.invalidateQueries({ queryKey: ['agenda-itens-agendaveis'] });
    await qc.invalidateQueries({ queryKey: ['agenda-itens-agendaveis-opcoes'] });
    // Reabre pelo que o banco devolveu: a versão nova passa a ser a lida.
    await abrir(Number(r.resultado['item']));
    mensagem.value = r.mensagem ?? '';
  } catch (e) {
    erro.value = e;
  }
}

// ── Na marcação ─────────────────────────────────────────────────────────────────────────────────────
const marcacao = ref(typeof route.query['marcacao'] === 'string' ? route.query['marcacao'] : '');
const marcacaoId = computed(() =>
  /^\d+$/.test(marcacao.value.trim()) ? Number(marcacao.value.trim()) : null,
);
const escolhidos = ref<number[]>([]);
const novoEscolhido = ref('');
const critica = ref<CriticaMarcacao | null>(null);
const lancados = useQuery({
  queryKey: computed(() => ['agenda-itens-da-marcacao', marcacaoId.value]),
  queryFn: () => lerItensDaMarcacao(marcacaoId.value as number),
  enabled: computed(() => marcacaoId.value !== null),
});
watch([escolhidos, marcacaoId], () => (critica.value = null), { deep: true });
function escolher() {
  if (novoEscolhido.value) escolhidos.value = [...escolhidos.value, Number(novoEscolhido.value)];
  novoEscolhido.value = '';
}
async function conferir() {
  if (marcacaoId.value === null || escolhidos.value.length === 0) return;
  erro.value = null;
  try {
    critica.value = await criticarItensMarcacao(marcacaoId.value, escolhidos.value);
  } catch (e) {
    erro.value = e;
  }
}
async function lancar() {
  if (marcacaoId.value === null || !critica.value || critica.value.bloqueios.length > 0) return;
  erro.value = null;
  try {
    const r = await lancarItensMarcacao(marcacaoId.value, escolhidos.value, novaChave('itens-marcacao'));
    mensagem.value = r.mensagem ?? '';
    escolhidos.value = [];
    await qc.invalidateQueries({ queryKey: ['agenda-itens-da-marcacao'] });
  } catch (e) {
    erro.value = e;
  }
}
const imprimir = () => window.print();
</script>

<template>
  <section class="agenda" aria-labelledby="itens-titulo" data-testid="itens-agendaveis">
    <h1 id="itens-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>

    <section class="painel" aria-labelledby="itens-marcacao" data-testid="itens-marcacao">
      <h2 id="itens-marcacao">{{ t('marcacao') }}</h2>
      <div class="filtros">
        <SanteCampoTexto v-model="marcacao" :rotulo="t('numeroMarcacao')" :max-bytes="20" />
        <SanteSelecao
          id="itens-escolher"
          v-model="novoEscolhido"
          :rotulo="t('escolherItem')"
          :opcoes="opcoesDe(opcoes.data.value?.itens, escolhidos)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('incluir')"
          :desabilitado="!novoEscolhido"
          data-testid="itens-escolher-incluir"
          @acionar="escolher"
        />
      </div>
      <ul v-if="escolhidos.length > 0" data-testid="itens-escolhidos">
        <li v-for="(x, i) in escolhidos" :key="x">
          {{ nomeDe(opcoes.data.value?.itens, x) }}
          <SanteBotao variante="secundario" :rotulo="t('retirar')" @acionar="escolhidos.splice(i, 1)" />
        </li>
      </ul>
      <SanteBotao
        :rotulo="t('conferir')"
        :desabilitado="marcacaoId === null || escolhidos.length === 0"
        data-testid="itens-conferir"
        @acionar="conferir"
      />
      <template v-if="critica">
        <div v-if="critica.bloqueios.length > 0" role="alert" data-testid="itens-bloqueios">
          <h3>{{ t('bloqueios') }}</h3>
          <ul>
            <li v-for="b in critica.bloqueios" :key="`${b.codigo}:${b.item}:${b.mensagem}`">
              {{ b.mensagem }}
            </li>
          </ul>
        </div>
        <div v-if="critica.alertas.length > 0" role="status" data-testid="itens-alertas">
          <h3>{{ t('alertas') }}</h3>
          <ul>
            <li v-for="a in critica.alertas" :key="`${a.codigo}:${a.item}:${a.mensagem}`">
              {{ a.mensagem }}
            </li>
          </ul>
        </div>
        <h3>{{ t('preparo') }}</h3>
        <dl data-testid="itens-preparo">
          <template v-for="i in critica.itens" :key="i.id">
            <dt>{{ i.descricao }}</dt>
            <dd class="preparo">{{ i.preparo ?? t('semPreparo') }}</dd>
          </template>
        </dl>
        <SanteBotao
          v-if="podeAgendar"
          :rotulo="t('lancar')"
          :desabilitado="critica.bloqueios.length > 0"
          data-testid="itens-lancar"
          @acionar="lancar"
        />
      </template>
      <template v-if="lancados.data.value && lancados.data.value.itens.length > 0">
        <h3>{{ t('lancados') }}</h3>
        <table class="tabela" data-testid="itens-lancados">
          <thead>
            <tr>
              <th scope="col">{{ t('item') }}</th>
              <th scope="col">{{ t('preparo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in lancados.data.value.itens" :key="x.sequencia">
              <td>{{ x.descricao }}</td>
              <td class="preparo">{{ x.preparo ?? t('semPreparo') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="lancados.data.value.equipamentos.length > 0">
          {{ t('equipamentos') }}:
          {{ lancados.data.value.equipamentos.map((e) => `${e.nome} (${e.quantidade})`).join('; ') }}
        </p>
        <SanteBotao variante="secundario" :rotulo="t('imprimir')" @acionar="imprimir" />
      </template>
    </section>

    <div class="filtros">
      <SanteCampoTexto v-model="busca" :rotulo="t('buscar')" :max-bytes="150" />
    </div>
    <template v-if="lista.data.value">
      <p v-if="lista.data.value.length === 0" data-testid="itens-vazio">{{ t('nenhum') }}</p>
      <table v-else class="tabela" data-testid="itens-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('codigo') }}</th>
            <th scope="col">{{ t('descricao') }}</th>
            <th scope="col">{{ t('tipo') }}</th>
            <th scope="col">{{ t('regras') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value" :key="x.id">
            <td>
              {{ x.codigo }}<span v-if="!x.ativo"> ({{ t('inativo') }})</span>
            </td>
            <td>{{ t('descricaoDuracao', { descricao: x.descricao, minutos: x.duracaoMinutos }) }}</td>
            <td>{{ t(`tipos.${x.tipoItem}`) }}</td>
            <td>
              {{
                t('resumo', {
                  req: x.regras.requisitos,
                  conf: x.regras.conflitos,
                  rec: x.regras.recursos,
                  ori: x.regras.orientacoes,
                })
              }}
            </td>
            <td class="acoes">
              <SanteBotao
                v-if="podeEditar"
                variante="secundario"
                :rotulo="t('editar', { codigo: x.codigo })"
                @acionar="abrir(x.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <SanteBotao
      v-if="podeEditar && editando === null"
      :rotulo="t('novo')"
      data-testid="itens-novo"
      @acionar="abrir(null)"
    />

    <section v-if="editando !== null" class="painel" aria-labelledby="item-edicao" data-testid="item-edicao">
      <h2 id="item-edicao">{{ editando === 'novo' ? t('novo') : t('editar', { codigo: form.codigo }) }}</h2>
      <form class="filtros" @submit.prevent="gravar">
        <SanteCampoTexto v-model="form.codigo" :rotulo="t('codigo')" :max-bytes="30" obrigatorio />
        <SanteCampoTexto v-model="form.descricao" :rotulo="t('descricao')" :max-bytes="150" obrigatorio />
        <SanteSelecao id="item-tipo" v-model="form.tipoItem" :rotulo="t('tipo')" :opcoes="opcoesTipo" />
        <SanteCampoTexto v-model="txt.duracao" :rotulo="t('duracao')" :max-bytes="4" obrigatorio />
        <SanteCampoTexto v-model="txt.dias" :rotulo="t('diasPreparo')" :max-bytes="3" />
        <SanteCampoTexto v-model="txt.intervalo" :rotulo="t('intervalo')" :max-bytes="6" />
        <SanteCampoTexto
          v-model="txt.orientacao"
          :rotulo="t('orientacaoPreparo')"
          :max-bytes="4000"
          multilinha
        />
        <SanteChave
          :ligada="form.exigeAutorizacao"
          :rotulo="t('exigeAutorizacao')"
          @alternar="(v: boolean) => (form.exigeAutorizacao = v)"
        />
        <SanteChave
          :ligada="form.exigeIndicacaoClinica"
          :rotulo="t('exigeIndicacao')"
          @alternar="(v: boolean) => (form.exigeIndicacaoClinica = v)"
        />
        <SanteChave
          :ligada="form.teleatendimento"
          :rotulo="t('teleatendimento')"
          @alternar="(v: boolean) => (form.teleatendimento = v)"
        />
        <SanteChave :ligada="form.ativo" :rotulo="t('ativo')" @alternar="(v: boolean) => (form.ativo = v)" />
      </form>

      <template v-if="form.tipoItem === 'composto'">
        <h3>{{ t('composicao') }}</h3>
        <ul data-testid="item-composicao">
          <li v-for="(c, i) in form.composicao" :key="c.componente">
            {{ t('vezes', { nome: nomeDe(outrosItens, c.componente), quantidade: c.quantidade }) }}
            <SanteBotao
              variante="secundario"
              :rotulo="t('retirar')"
              @acionar="form.composicao.splice(i, 1)"
            />
          </li>
        </ul>
        <div class="filtros">
          <SanteSelecao
            id="item-componente"
            v-model="nova.componente"
            :rotulo="t('item')"
            :opcoes="
              opcoesDe(
                outrosItens.filter((x) => x.tipo !== 'composto'),
                form.composicao.map((c) => c.componente),
              )
            "
          />
          <SanteCampoTexto v-model="nova.qtdComp" :rotulo="t('quantidade')" :max-bytes="6" />
          <SanteBotao
            variante="secundario"
            :rotulo="t('incluir')"
            :desabilitado="!nova.componente"
            data-testid="item-incluir-componente"
            @acionar="incluirComposicao"
          />
        </div>
      </template>

      <h3>{{ t('requisitos') }}</h3>
      <ul data-testid="item-requisitos">
        <li v-for="(r, i) in form.requisitos" :key="`${r.tipo}:${r.item}:${r.descricao}`">
          {{ t(`tiposRequisito.${r.tipo}`) }}:
          {{ r.item !== null ? nomeDe(outrosItens, r.item) : r.descricao }}
          <span v-if="r.prazoMaximoDias !== null"> ({{ r.prazoMaximoDias }} {{ t('prazo') }})</span>
          <span v-if="!r.bloqueia"> — {{ t('soAlerta') }}</span>
          <SanteBotao variante="secundario" :rotulo="t('retirar')" @acionar="form.requisitos.splice(i, 1)" />
        </li>
      </ul>
      <div class="filtros">
        <SanteSelecao
          id="item-req-tipo"
          v-model="nova.reqTipo"
          :rotulo="t('tipoRequisito')"
          :opcoes="TIPOS_REQUISITO.map((x) => ({ valor: x, rotulo: t(`tiposRequisito.${x}`) }))"
        />
        <SanteSelecao
          v-if="reqPorItem"
          id="item-req-item"
          v-model="nova.reqItem"
          :rotulo="t('item')"
          :opcoes="
            opcoesDe(
              outrosItens,
              form.requisitos.filter((r) => r.item !== null).map((r) => r.item as number),
            )
          "
        />
        <SanteCampoTexto v-else v-model="nova.reqCond" :rotulo="t('condicao')" :max-bytes="500" />
        <SanteCampoTexto v-model="nova.reqPrazo" :rotulo="t('prazo')" :max-bytes="4" />
        <SanteChave
          :ligada="nova.reqBloqueia"
          :rotulo="t('bloqueia')"
          @alternar="(v: boolean) => (nova.reqBloqueia = v)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('incluir')"
          :desabilitado="reqPorItem ? !nova.reqItem : !nova.reqCond.trim()"
          data-testid="item-incluir-requisito"
          @acionar="incluirRequisito"
        />
      </div>

      <h3>{{ t('conflitos') }}</h3>
      <ul data-testid="item-conflitos">
        <li v-for="(c, i) in form.conflitos" :key="c.item">
          {{
            t('conflitoLinha', {
              nome: nomeDe(outrosItens, c.item),
              horas: c.intervaloMinimoHoras,
              sentido: t(`sentidos.${c.direcao}`),
            })
          }}
          <SanteBotao variante="secundario" :rotulo="t('retirar')" @acionar="form.conflitos.splice(i, 1)" />
        </li>
      </ul>
      <div class="filtros">
        <SanteSelecao
          id="item-conf-item"
          v-model="nova.confItem"
          :rotulo="t('item')"
          :opcoes="
            opcoesDe(
              outrosItens,
              form.conflitos.map((c) => c.item),
            )
          "
        />
        <SanteCampoTexto v-model="nova.confHoras" :rotulo="t('horas')" :max-bytes="8" />
        <SanteSelecao
          id="item-conf-sentido"
          v-model="nova.confSentido"
          :rotulo="t('sentido')"
          :opcoes="DIRECOES.map((x) => ({ valor: x, rotulo: t(`sentidos.${x}`) }))"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('incluir')"
          :desabilitado="!nova.confItem"
          data-testid="item-incluir-conflito"
          @acionar="incluirConflito"
        />
      </div>

      <h3>{{ t('recursos') }}</h3>
      <ul data-testid="item-recursos">
        <li v-for="(r, i) in form.recursos" :key="r.recurso">
          {{
            t('recursoLinha', {
              nome: nomeDe(opcoes.data.value?.recursos, r.recurso),
              papel: t(`papeis.${r.papel}`),
              quantidade: r.quantidade,
            })
          }}
          <SanteBotao variante="secundario" :rotulo="t('retirar')" @acionar="form.recursos.splice(i, 1)" />
        </li>
      </ul>
      <div class="filtros">
        <SanteSelecao
          id="item-recurso"
          v-model="nova.recurso"
          :rotulo="t('recurso')"
          :opcoes="
            opcoesDe(
              opcoes.data.value?.recursos,
              form.recursos.map((r) => r.recurso),
            )
          "
        />
        <SanteSelecao
          id="item-papel"
          v-model="nova.papel"
          :rotulo="t('papel')"
          :opcoes="PAPEIS.map((x) => ({ valor: x, rotulo: t(`papeis.${x}`) }))"
        />
        <SanteCampoTexto v-model="nova.qtdRec" :rotulo="t('quantidade')" :max-bytes="6" />
        <SanteBotao
          variante="secundario"
          :rotulo="t('incluir')"
          :desabilitado="!nova.recurso"
          data-testid="item-incluir-recurso"
          @acionar="incluirRecurso"
        />
      </div>

      <h3>{{ t('orientacoes') }}</h3>
      <ul data-testid="item-orientacoes">
        <li v-for="(o, i) in form.orientacoes" :key="o.fontePagadora">
          {{ nomeDe(opcoes.data.value?.fontes, o.fontePagadora) }}: {{ o.orientacao }}
          <SanteBotao variante="secundario" :rotulo="t('retirar')" @acionar="form.orientacoes.splice(i, 1)" />
        </li>
      </ul>
      <div class="filtros">
        <SanteSelecao
          id="item-fonte"
          v-model="nova.fonte"
          :rotulo="t('convenio')"
          :opcoes="
            opcoesDe(
              opcoes.data.value?.fontes,
              form.orientacoes.map((o) => o.fontePagadora),
            )
          "
        />
        <SanteCampoTexto v-model="nova.orientacao" :rotulo="t('orientacao')" :max-bytes="4000" multilinha />
        <SanteBotao
          variante="secundario"
          :rotulo="t('incluir')"
          :desabilitado="!nova.fonte || !nova.orientacao.trim()"
          data-testid="item-incluir-orientacao"
          @acionar="incluirOrientacao"
        />
      </div>

      <p v-if="recusa" role="alert" data-testid="item-recusa">{{ recusa.mensagem }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('gravar')"
          :desabilitado="!!recusa"
          data-testid="item-gravar"
          @acionar="gravar"
        />
        <SanteBotao variante="secundario" :rotulo="t('fechar')" @acionar="editando = null" />
      </div>
    </section>
    <p v-if="mensagem" role="status" data-testid="itens-mensagem">{{ mensagem }}</p>
    <ErroAgenda v-if="erro || lista.error.value" :erro="erro ?? lista.error.value" />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
<style scoped>
.preparo {
  white-space: pre-line;
}
</style>
