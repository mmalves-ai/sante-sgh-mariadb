<script setup lang="ts">
// Anotações administrativas do caso (03-PEP L147), numa tela só por paciente: o registro NÃO clínico da equipe
// (serviço social, NIR, gestão de leito, faturamento) sobre o atendimento. A anotação nova cabe numa linha de
// decisões: atendimento (o mais recente já vem escolhido), categoria, quem lê e quem avisar (busca da conta pelo nome,
// sem lista enorme). Validação na hora: o botão só libera com atendimento, categoria, texto e, na anotação restrita,
// ao menos um destinatário; o contador mostra o que resta. Abaixo, as anotações que esta pessoa pode ver, com as
// endereçadas a ela marcadas e o "marcar como lida" num clique. Nada é apagado: o autor cancela com motivo.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type AnotacaoTela,
  buscarDestinatarios,
  gravarAnotacao,
  lerAnotacoesPaciente,
} from '../api-anotacoes-administrativas.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const chave = computed(() => ['pep', 'anotacoes-administrativas', id.value]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerAnotacoesPaciente(id.value), staleTime: 0 });
const d = computed(() => dados.data.value);
const erro = ref<unknown>(null);
const ok = ref('');
const MAXIMO = 2000;

const podeGravar = computed(
  () =>
    (pode('pep.evolucao.criar') ||
      pode('pep.social.registrar') ||
      pode('internacao.solicitacaoLeito.priorizar')) &&
    Boolean(d.value?.podeEscrever),
);
const nova = reactive({
  atendimento: '',
  categoria: '',
  texto: '',
  acesso: 'equipe',
  finalizaAcao: false,
  destinatarios: [] as { id: number; nome: string }[],
});
// O atendimento mais recente já vem escolhido.
watch(
  () => d.value?.atendimentos,
  (a) => {
    if (a?.length && !nova.atendimento) nova.atendimento = String(a[0]!.id);
  },
  { immediate: true },
);
const opcoesAtendimento = computed(() =>
  (d.value?.atendimentos ?? []).map((a) => ({
    valor: String(a.id),
    rotulo: t('pep.anotAdm.atendimentoOpcao', { numero: a.numero, quando: dataHoraBr(a.entradaEm) }),
  })),
);
const opcoesCategoria = computed(() =>
  (d.value?.categorias ?? []).map((c) => ({ valor: String(c.id), rotulo: c.descricao })),
);
const opcoesAcesso = computed(() =>
  (['equipe', 'destinatarios', 'todos'] as const).map((v) => ({
    valor: v,
    rotulo: t(`pep.anotAdm.acessos.${v}`),
  })),
);
const restam = computed(() => MAXIMO - nova.texto.length);
const faltaDestinatario = computed(() => nova.acesso === 'destinatarios' && nova.destinatarios.length === 0);
const novaPronta = computed(
  () =>
    Boolean(nova.atendimento) &&
    Boolean(nova.categoria) &&
    nova.texto.trim().length > 0 &&
    restam.value >= 0 &&
    !faltaDestinatario.value,
);

// Busca da conta para avisar: a partir de 3 letras.
const termo = ref('');
const pedido = ref('');
const contas = useQuery({
  queryKey: computed(() => ['pep', 'anotacoes-administrativas', 'usuarios', pedido.value]),
  queryFn: () => buscarDestinatarios(pedido.value),
  enabled: computed(() => pedido.value.length >= 3),
  staleTime: 30_000,
});
const procurar = () => {
  pedido.value = termo.value.trim();
};
const candidatos = computed(() =>
  (contas.data.value ?? []).filter((c) => !nova.destinatarios.some((x) => x.id === c.id)),
);
const adicionar = (c: { id: number; nome: string }) => nova.destinatarios.push(c);
const remover = (c: { id: number }) => {
  nova.destinatarios = nova.destinatarios.filter((x) => x.id !== c.id);
};

const filtroAtendimento = ref('');
const opcoesFiltro = computed(() => [
  { valor: '', rotulo: t('pep.anotAdm.todosAtendimentos') },
  ...[
    ...new Map(
      (d.value?.anotacoes ?? []).map((a) => [String(a.atendimento.id), a.atendimento.numero]),
    ).entries(),
  ].map(([valor, numero]) => ({ valor, rotulo: t('pep.anotAdm.atendimentoNumero', { numero }) })),
]);
const mostrarCanceladas = ref(false);
const visiveis = computed(() =>
  (d.value?.anotacoes ?? []).filter(
    (a) =>
      (mostrarCanceladas.value || a.situacao === 'ativa') &&
      (!filtroAtendimento.value || String(a.atendimento.id) === filtroAtendimento.value),
  ),
);

async function gravar(corpo: Record<string, unknown>, depois?: () => void): Promise<void> {
  erro.value = null;
  ok.value = '';
  try {
    await gravarAnotacao(corpo);
    ok.value = t('pep.anotAdm.gravada');
    depois?.();
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  }
}

const registrar = () =>
  gravar(
    {
      acao: 'registrar',
      paciente: id.value,
      atendimento: Number(nova.atendimento),
      categoria: Number(nova.categoria),
      texto: nova.texto,
      acesso: nova.acesso,
      destinatarios: nova.destinatarios.map((x) => x.id),
      finalizaAcao: nova.finalizaAcao,
    },
    () => Object.assign(nova, { texto: '', finalizaAcao: false, destinatarios: [] }),
  );

const motivos = reactive<Record<number, string>>({});
const motivoOk = (a: AnotacaoTela) => (motivos[a.id] ?? '').trim().length >= 5;
const marcarLida = (a: AnotacaoTela) => gravar({ acao: 'marcar_lida', anotacao: a.id });
const cancelar = (a: AnotacaoTela) =>
  gravar({ acao: 'cancelar', anotacao: a.id, versao: a.versao, motivo: (motivos[a.id] ?? '').trim() });
</script>

<template>
  <section class="anot" data-testid="anotacoes-adm-tela">
    <h1>{{ t('pep.anotAdm.titulo') }}</h1>
    <p>{{ t('pep.anotAdm.explicacao') }}</p>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="anotacoes-adm-ok" />
    <p v-if="!d && !dados.error.value">{{ t('pep.carregando') }}</p>
    <template v-else-if="d">
      <SanteAlerta
        v-if="d.pendentesParaMim > 0"
        variante="aviso"
        :texto="t('pep.anotAdm.pendentes', { n: d.pendentesParaMim })"
        data-testid="anotacoes-adm-pendentes"
      />

      <h2>{{ t('pep.anotAdm.nova') }}</h2>
      <p v-if="!d.podeEscrever">{{ t('pep.anotAdm.semConta') }}</p>
      <p v-else-if="podeGravar && d.atendimentos.length === 0" data-testid="anotacoes-adm-sem-atendimento">
        {{ t('pep.anotAdm.semAtendimento') }}
      </p>
      <p v-else-if="podeGravar && d.categorias.length === 0" data-testid="anotacoes-adm-sem-categorias">
        {{ t('pep.anotAdm.semCategorias') }}
      </p>
      <form
        v-else-if="podeGravar"
        class="anot__nova"
        data-testid="anotacoes-adm-nova"
        @submit.prevent="registrar"
      >
        <SanteSelecao
          v-model="nova.atendimento"
          :rotulo="t('pep.anotAdm.atendimento')"
          :opcoes="opcoesAtendimento"
          data-testid="anotacoes-adm-atendimento"
        />
        <SanteSelecao
          v-model="nova.categoria"
          :rotulo="t('pep.anotAdm.categoria')"
          :opcoes="opcoesCategoria"
          data-testid="anotacoes-adm-categoria"
        />
        <label class="anot__texto">
          {{ t('pep.anotAdm.texto') }}
          <textarea
            v-model="nova.texto"
            :maxlength="MAXIMO"
            rows="3"
            required
            data-testid="anotacoes-adm-texto"
          />
          <small>{{ t('pep.anotAdm.restam', { n: restam }) }}</small>
        </label>
        <SanteSelecao
          v-model="nova.acesso"
          :rotulo="t('pep.anotAdm.acesso')"
          :opcoes="opcoesAcesso"
          data-testid="anotacoes-adm-acesso"
        />
        <fieldset class="anot__destinatarios">
          <legend>{{ t('pep.anotAdm.destinatarios') }}</legend>
          <ul v-if="nova.destinatarios.length" class="anot__lista">
            <li v-for="c in nova.destinatarios" :key="c.id">
              {{ c.nome }}
              <SanteBotao
                variante="secundario"
                :rotulo="t('pep.anotAdm.remover', { nome: c.nome })"
                :data-testid="`anotacoes-adm-remover-${c.id}`"
                @click="remover(c)"
              />
            </li>
          </ul>
          <label>
            {{ t('pep.anotAdm.buscarDestinatario') }}
            <input
              v-model="termo"
              type="search"
              maxlength="80"
              autocomplete="off"
              data-testid="anotacoes-adm-busca-conta"
              @keydown.enter.prevent="procurar"
              @blur="procurar"
            />
          </label>
          <ul v-if="candidatos.length" class="anot__lista" data-testid="anotacoes-adm-contas">
            <li v-for="c in candidatos" :key="c.id">
              <SanteBotao
                variante="secundario"
                :rotulo="t('pep.anotAdm.adicionar', { nome: c.nome })"
                :data-testid="`anotacoes-adm-conta-${c.id}`"
                @click="adicionar(c)"
              />
            </li>
          </ul>
          <SanteAlerta
            v-if="faltaDestinatario"
            variante="alerta"
            :texto="t('pep.anotAdm.semDestinatario')"
            data-testid="anotacoes-adm-falta-destinatario"
          />
        </fieldset>
        <label>
          <input v-model="nova.finalizaAcao" type="checkbox" data-testid="anotacoes-adm-finaliza" />
          {{ t('pep.anotAdm.finalizaAcao') }}
        </label>
        <SanteBotao
          tipo="submit"
          :desabilitado="!novaPronta"
          data-testid="anotacoes-adm-registrar"
          :rotulo="t('pep.anotAdm.registrar')"
        />
      </form>

      <div class="anot__filtros">
        <SanteSelecao
          v-model="filtroAtendimento"
          :rotulo="t('pep.anotAdm.filtroAtendimento')"
          :opcoes="opcoesFiltro"
          data-testid="anotacoes-adm-filtro"
        />
        <label>
          <input v-model="mostrarCanceladas" type="checkbox" data-testid="anotacoes-adm-canceladas" />
          {{ t('pep.anotAdm.mostrarCanceladas') }}
        </label>
      </div>
      <p v-if="visiveis.length === 0">{{ t('pep.anotAdm.nenhuma') }}</p>
      <article
        v-for="a in visiveis"
        :key="a.id"
        class="anot__item"
        :class="{ 'anot__item--fora': a.situacao !== 'ativa', 'anot__item--minha': a.pendenteParaMim }"
        :data-testid="`anotacao-${a.id}`"
      >
        <h3>
          {{ a.categoria.descricao }} ·
          {{ t('pep.anotAdm.atendimentoNumero', { numero: a.atendimento.numero }) }} ·
          <span :data-testid="`anotacao-situacao-${a.id}`">{{
            t(`pep.anotAdm.situacao.${a.situacao}`)
          }}</span>
          <span v-if="a.pendenteParaMim"> · {{ t('pep.anotAdm.paraVoce') }}</span>
        </h3>
        <p class="anot__corpo">{{ a.texto }}</p>
        <p class="anot__meta">
          {{ t('pep.anotAdm.por', { autor: a.autor ?? '', quando: dataHoraBr(a.registradaEm) }) }}
          · {{ t(`pep.anotAdm.acessos.${a.acesso}`) }}
          <span v-if="a.finalizaAcao"> · {{ t('pep.anotAdm.encerra') }}</span>
        </p>
        <p v-if="a.destinatarios.length" class="anot__meta">
          <span v-for="x in a.destinatarios" :key="x.usuario">
            {{ x.nome }} ({{
              x.lidaEm ? t('pep.anotAdm.lida', { quando: dataHoraBr(x.lidaEm) }) : t('pep.anotAdm.naoLida')
            }})
          </span>
        </p>
        <p v-if="a.situacao === 'cancelada'" class="anot__meta">
          {{
            t('pep.anotAdm.canceladaPor', {
              quando: dataHoraBr(a.canceladaEm),
              motivo: a.motivoCancelamento ?? '',
            })
          }}
        </p>
        <div v-if="podeGravar && a.situacao === 'ativa'" class="anot__acoes">
          <SanteBotao
            v-if="a.pendenteParaMim"
            :rotulo="t('pep.anotAdm.marcarLida')"
            :data-testid="`anotacao-lida-${a.id}`"
            @click="marcarLida(a)"
          />
          <template v-if="a.doAutor">
            <label>
              {{ t('pep.anotAdm.motivo') }}
              <input v-model="motivos[a.id]" maxlength="300" :data-testid="`anotacao-motivo-${a.id}`" />
            </label>
            <SanteBotao
              variante="secundario"
              :desabilitado="!motivoOk(a)"
              :rotulo="t('pep.anotAdm.cancelar')"
              :data-testid="`anotacao-cancelar-${a.id}`"
              @click="cancelar(a)"
            />
          </template>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.anot {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.anot__nova,
.anot__filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.anot__texto {
  display: grid;
  flex: 1 1 100%;
}
.anot__destinatarios {
  flex: 1 1 100%;
}
.anot__lista {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
.anot__item {
  border-left: 4px solid var(--sgh-borda);
  padding-left: var(--sgh-espaco-3);
}
.anot__item--minha {
  border-left-color: var(--sgh-aviso);
}
.anot__item--fora {
  opacity: 0.7;
}
.anot__corpo {
  white-space: pre-wrap;
}
.anot__acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
</style>
