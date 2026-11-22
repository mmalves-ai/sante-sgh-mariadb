<script setup lang="ts">
// ADR 0009: inclusão das regras da agenda pela tela: cobertura por convênio e por plano/subplano (aceita ou exclui),
// restrição (sexo, idade, retorno e encaixe; nulo herda da agenda) e preparo. A regra pode apontar o texto de origem que
// ela substitui: a tela destaca esse texto ao lado (o trecho não interpretado continua marcado e valendo pelo texto).
// A regra incluída aqui entra confirmada. Os planos vêm do cadastro do convênio (nome; o subplano é um plano dele).
import type { TextoOrigemAgenda } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarContrato } from '../../precos/api-precos.js';
import { novaChave } from '../api-agenda.js';
import { incluirCobertura, incluirPreparo, incluirRestricao } from '../api-estruturada.js';
import {
  type CamposCobertura,
  type CamposPreparo,
  type CamposRestricao,
  montarCobertura,
  montarPreparo,
  montarRestricao,
} from '../estruturada-edicao.js';

export type TipoRegraEstruturada = 'cobertura' | 'restricao' | 'preparo';
const props = defineProps<{
  agendaId: number;
  tipo: TipoRegraEstruturada;
  convenios: readonly { fontePagadoraId: number; nome: string }[];
  textos: readonly TextoOrigemAgenda[];
  /** Rótulo do texto (campo e convênio), para a escolha do texto de origem. */
  rotuloTexto: (x: TextoOrigemAgenda) => string;
  hoje: string;
}>();
const emit = defineEmits<{ gravado: [mensagem: string]; cancelar: []; verTexto: [id: number] }>();
const { t } = useI18n();

const convenio = ref('');
const plano = ref('');
const texto = ref('');
const aceita = ref('sim');
const c = reactive({
  vigenciaInicio: props.hoje,
  vigenciaFim: '',
  sexoAtendido: '' as CamposRestricao['sexoAtendido'],
  idadeMinimaAnos: '',
  idadeMaximaAnos: '',
  aceitaRetorno: '' as CamposRestricao['aceitaRetorno'],
  diasRetorno: '',
  permiteEncaixe: '' as CamposRestricao['permiteEncaixe'],
  tipoPreparo: 'preparo' as CamposPreparo['tipo'],
  descricao: '',
  jejumHoras: '',
});
const erro = ref<unknown>(null);
const problema = ref<string | null>(null);
const ocupado = ref(false);
const chave = ref(novaChave(`agenda-${props.tipo}`));

const convenioId = computed(() => (convenio.value ? Number(convenio.value) : null));
const planos = useQuery({
  queryKey: computed(() => ['contrato', convenioId.value]),
  queryFn: () => buscarContrato(Number(convenioId.value)),
  enabled: computed(() => convenioId.value !== null && props.tipo !== 'preparo'),
});
watch(convenio, () => (plano.value = ''));
watch(texto, (v) => v && emit('verTexto', Number(v)));

const opcoesConvenio = computed(() => [
  {
    valor: '',
    rotulo: props.tipo === 'cobertura' ? t('agenda.escolha') : t('estruturada.edicao.todosConvenios'),
  },
  ...props.convenios.map((x) => ({ valor: String(x.fontePagadoraId), rotulo: x.nome })),
]);
const opcoesPlano = computed(() => [
  { valor: '', rotulo: t('estruturada.cobertura.convenioInteiro') },
  ...(planos.data.value?.planos ?? [])
    .filter((p) => p.ativo)
    .map((p) => ({ valor: String(p.id), rotulo: p.nome })),
]);
const opcoesTexto = computed(() => [
  { valor: '', rotulo: t('estruturada.edicao.semTexto') },
  ...props.textos.map((x) => ({ valor: String(x.id), rotulo: props.rotuloTexto(x) })),
]);
const opcoesAceita = computed(() => [
  { valor: 'sim', rotulo: t('estruturada.cobertura.aceita') },
  { valor: 'nao', rotulo: t('estruturada.cobertura.exclui') },
]);
const opcoesSexo = computed(() => [
  { valor: '', rotulo: t('estruturada.restricao.herda') },
  { valor: 'todos', rotulo: t('estruturada.restricao.sexos.todos') },
  { valor: 'feminino', rotulo: t('estruturada.restricao.sexos.feminino') },
  { valor: 'masculino', rotulo: t('estruturada.restricao.sexos.masculino') },
]);
const opcoesTri = computed(() => [
  { valor: '', rotulo: t('estruturada.restricao.herda') },
  { valor: 'sim', rotulo: t('estruturada.edicao.sim') },
  { valor: 'nao', rotulo: t('estruturada.edicao.nao') },
]);
const opcoesTipoPreparo = computed(() =>
  (['preparo', 'documento', 'orientacao'] as const).map((v) => ({
    valor: v,
    rotulo: t(`estruturada.preparo.tipos.${v}`),
  })),
);

function montar() {
  const comuns = {
    vigenciaInicio: c.vigenciaInicio,
    vigenciaFim: c.vigenciaFim,
    textoOrigemId: texto.value ? Number(texto.value) : null,
  };
  const planoId = plano.value ? Number(plano.value) : null;
  if (props.tipo === 'cobertura')
    return montarCobertura(props.agendaId, {
      ...comuns,
      fontePagadoraId: convenioId.value,
      planoId,
      aceita: aceita.value === 'sim',
    } satisfies CamposCobertura);
  if (props.tipo === 'restricao')
    return montarRestricao(props.agendaId, {
      ...comuns,
      fontePagadoraId: convenioId.value,
      planoId,
      sexoAtendido: c.sexoAtendido,
      idadeMinimaAnos: String(c.idadeMinimaAnos ?? ''),
      idadeMaximaAnos: String(c.idadeMaximaAnos ?? ''),
      aceitaRetorno: c.aceitaRetorno,
      diasRetorno: String(c.diasRetorno ?? ''),
      permiteEncaixe: c.permiteEncaixe,
    } satisfies CamposRestricao);
  return montarPreparo(props.agendaId, {
    ...comuns,
    tipo: c.tipoPreparo,
    descricao: c.descricao,
    jejumHoras: String(c.jejumHoras ?? ''),
  } satisfies CamposPreparo);
}

async function gravar(): Promise<void> {
  erro.value = null;
  const m = montar();
  if (!m.ok) {
    problema.value = t(m.erro);
    return;
  }
  problema.value = null;
  ocupado.value = true;
  try {
    const e = m.entrada;
    const r =
      props.tipo === 'cobertura'
        ? await incluirCobertura(e as Parameters<typeof incluirCobertura>[0], chave.value)
        : props.tipo === 'restricao'
          ? await incluirRestricao(e as Parameters<typeof incluirRestricao>[0], chave.value)
          : await incluirPreparo(e as Parameters<typeof incluirPreparo>[0], chave.value);
    emit('gravado', r.mensagem);
  } catch (x) {
    erro.value = x;
  } finally {
    chave.value = novaChave(`agenda-${props.tipo}`);
    ocupado.value = false;
  }
}
</script>

<template>
  <form class="form" :data-testid="`form-${tipo}`" @submit.prevent="gravar">
    <h4>{{ t(`estruturada.edicao.titulos.${tipo}`) }}</h4>
    <div class="linha">
      <template v-if="tipo !== 'preparo'">
        <SanteSelecao
          :id="`${tipo}-convenio`"
          v-model="convenio"
          :rotulo="t('estruturada.cobertura.convenio')"
          :opcoes="opcoesConvenio"
          :data-testid="`${tipo}-convenio`"
        />
        <SanteSelecao
          :id="`${tipo}-plano`"
          v-model="plano"
          :rotulo="t('estruturada.edicao.planoOuSubplano')"
          :opcoes="opcoesPlano"
          :data-testid="`${tipo}-plano`"
        />
      </template>
      <SanteSelecao
        v-if="tipo === 'cobertura'"
        id="cobertura-aceita"
        v-model="aceita"
        :rotulo="t('estruturada.edicao.aceitaOuExclui')"
        :opcoes="opcoesAceita"
        data-testid="cobertura-aceita"
      />
    </div>

    <div v-if="tipo === 'restricao'" class="linha">
      <SanteSelecao
        id="restricao-sexo"
        v-model="c.sexoAtendido"
        :rotulo="t('estruturada.restricao.sexo')"
        :opcoes="opcoesSexo"
        data-testid="restricao-sexo"
      />
      <div class="campo">
        <label for="restricao-idade-min">{{ t('estruturada.edicao.idadeMinima') }}</label>
        <input
          id="restricao-idade-min"
          v-model="c.idadeMinimaAnos"
          type="number"
          min="0"
          max="130"
          data-testid="restricao-idade-min"
        />
      </div>
      <div class="campo">
        <label for="restricao-idade-max">{{ t('estruturada.edicao.idadeMaxima') }}</label>
        <input
          id="restricao-idade-max"
          v-model="c.idadeMaximaAnos"
          type="number"
          min="0"
          max="130"
          data-testid="restricao-idade-max"
        />
      </div>
      <SanteSelecao
        id="restricao-retorno"
        v-model="c.aceitaRetorno"
        :rotulo="t('estruturada.restricao.retorno')"
        :opcoes="opcoesTri"
        data-testid="restricao-retorno"
      />
      <div class="campo">
        <label for="restricao-dias">{{ t('estruturada.edicao.diasRetorno') }}</label>
        <input
          id="restricao-dias"
          v-model="c.diasRetorno"
          type="number"
          min="0"
          data-testid="restricao-dias"
        />
      </div>
      <SanteSelecao
        id="restricao-encaixe"
        v-model="c.permiteEncaixe"
        :rotulo="t('estruturada.restricao.encaixe')"
        :opcoes="opcoesTri"
        data-testid="restricao-encaixe"
      />
    </div>

    <div v-if="tipo === 'preparo'" class="linha">
      <SanteSelecao
        id="preparo-tipo"
        v-model="c.tipoPreparo"
        :rotulo="t('estruturada.preparo.tipo')"
        :opcoes="opcoesTipoPreparo"
        data-testid="preparo-tipo"
      />
      <div class="campo largo">
        <label for="preparo-descricao">{{ t('estruturada.edicao.descricao') }}</label>
        <textarea
          id="preparo-descricao"
          v-model="c.descricao"
          rows="3"
          data-testid="preparo-descricao"
        ></textarea>
      </div>
      <div class="campo">
        <label for="preparo-jejum">{{ t('estruturada.edicao.jejumHoras') }}</label>
        <input
          id="preparo-jejum"
          v-model="c.jejumHoras"
          type="number"
          min="1"
          max="72"
          data-testid="preparo-jejum"
        />
      </div>
    </div>

    <div class="linha">
      <div class="campo">
        <label :for="`${tipo}-inicio`">{{ t('estruturada.preco.inicio') }}</label>
        <input
          :id="`${tipo}-inicio`"
          v-model="c.vigenciaInicio"
          type="date"
          :data-testid="`${tipo}-inicio`"
        />
      </div>
      <div class="campo">
        <label :for="`${tipo}-fim`">{{ t('estruturada.preco.fim') }}</label>
        <input :id="`${tipo}-fim`" v-model="c.vigenciaFim" type="date" :data-testid="`${tipo}-fim`" />
      </div>
      <SanteSelecao
        v-if="textos.length"
        :id="`${tipo}-texto`"
        v-model="texto"
        :rotulo="t('estruturada.edicao.textoOrigem')"
        :opcoes="opcoesTexto"
        :data-testid="`${tipo}-texto`"
      />
    </div>
    <p v-if="texto" class="secundario">{{ t('estruturada.edicao.textoAoLado') }}</p>
    <p v-if="problema" role="alert" :data-testid="`${tipo}-problema`">{{ problema }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <div class="linha">
      <SanteBotao
        tipo="submit"
        :rotulo="t('estruturada.edicao.incluir')"
        :desabilitado="ocupado"
        :data-testid="`${tipo}-gravar`"
      />
      <SanteBotao variante="texto" :rotulo="t('estruturada.edicao.cancelar')" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>

<style scoped>
.form {
  display: grid;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
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
.largo {
  flex: 1 1 20rem;
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
