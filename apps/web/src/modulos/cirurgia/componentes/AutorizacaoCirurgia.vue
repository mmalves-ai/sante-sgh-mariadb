<script setup lang="ts">
// Autorização prévia da cirurgia eletiva por etapas (C1-117, 04-CC linha 102; TISS/ANS): na própria cirurgia, a etapa
// em que a autorização está (sem guia, em preparo, pronta, aguardando a operadora, autorizada, negada), as guias
// ligadas com a senha, e o pedido em um passo: a carteira ativa do paciente vem marcada, o cirurgião é o solicitante e
// o procedimento é conferido na hora (código TUSS de 8 dígitos). A eletiva de convênio só entra no bloco com a senha;
// na urgência, a exceção é registrada com a justificativa e a guia é comunicada depois.
import {
  conferirConferenciaParcial,
  conferirExcecaoUrgencia,
  naturezaDeUrgencia,
} from '@sgh/dominio-cirurgia';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  lerAutorizacaoDaCirurgia,
  lerCoberturasDoPaciente,
  pedirAutorizacaoDaCirurgia,
  registrarConferenciaParcialDaCirurgia,
  registrarUrgenciaDaCirurgia,
} from '../api-autorizacao-cirurgia.js';
import ErroCirurgia from './ErroCirurgia.vue';

const props = defineProps<{ agendamento: number }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Autorização da operadora',
      etapa: 'Etapa',
      etapas: {
        sem_guia: 'Sem guia',
        guia_em_preparo: 'Guia em preparo',
        pronta_envio: 'Pronta para enviar',
        aguardando_operadora: 'Aguardando a operadora',
        pendente_documentacao: 'Pendente de documentação',
        autorizada: 'Autorizada',
        autorizada_parcial: 'Autorizada em parte',
        negada: 'Negada',
        nao_exigida: 'Não exigida (não é convênio)',
      },
      senha: 'Senha: {senha}',
      semSenha: 'Sem senha: a cirurgia eletiva não entra no bloco até a operadora autorizar.',
      guia: 'Guia {numero} · {situacao}',
      nenhumaGuia: 'Nenhuma guia ligada a esta cirurgia.',
      pedir: 'Pedir autorização',
      carteira: 'Carteira do paciente',
      codigo: 'Código TUSS do procedimento',
      codigoInvalido: 'O código TUSS tem 8 dígitos.',
      descricao: 'Procedimento',
      indicacao: 'Indicação clínica',
      canal: 'Canal',
      canais: {
        webservice: 'Mensagem TISS',
        portal: 'Portal da operadora',
        telefone: 'Telefone',
        email: 'E-mail',
        presencial: 'Presencial',
      },
      enviar: 'Gravar o pedido',
      pedido: 'Guia {numero} gravada e ligada à cirurgia.',
      urgencia: 'Exceção de urgência',
      justificativa: 'Justificativa da urgência',
      registrar: 'Registrar a exceção',
      registrada: 'Exceção registrada: a guia é comunicada à operadora depois.',
      posterior: 'Urgência sem senha: {justificativa}',
      parcial:
        'A operadora autorizou só parte da guia: confira os itens autorizados e registre a conferência antes de confirmar.',
      conferir: 'Registrar a conferência',
      conferencia: 'O que segue autorizado e o que foi retirado ou complementado',
      gravarConferencia: 'Gravar a conferência',
      conferida: 'Conferência registrada: a cirurgia pode ser confirmada.',
      parcialConferida: 'Autorização parcial conferida: {justificativa}',
      escolha: 'Escolha',
    },
  },
});

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const veAutorizacao = computed(() => permissoes.value.has('faturamento.autorizacao.ler'));
const podePedir = computed(() => permissoes.value.has('faturamento.autorizacao.solicitar'));
const chave = computed(() => ['cirurgia', 'autorizacao', props.agendamento]);
const consulta = useQuery({
  queryKey: chave,
  queryFn: () => lerAutorizacaoDaCirurgia(props.agendamento),
  enabled: veAutorizacao,
});
const d = computed(() => consulta.data.value);
const coberturas = useQuery({
  queryKey: computed(() => ['cirurgia', 'autorizacao', 'coberturas', d.value?.paciente ?? 0]),
  queryFn: () => lerCoberturasDoPaciente(d.value!.paciente),
  enabled: computed(() => podePedir.value && !!d.value && d.value.etapa !== 'nao_exigida'),
});

const aberto = ref<'' | 'pedido' | 'urgencia' | 'parcial'>('');
const cobertura = ref('');
const codigo = ref('');
const descricao = ref('');
const indicacao = ref('');
const canal = ref<'webservice' | 'portal' | 'telefone' | 'email' | 'presencial'>('portal');
const justificativa = ref('');
const conferencia = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// A carteira ativa principal já vem marcada (a lista vem da principal para as demais).
watch(
  () => coberturas.data.value,
  (l) => {
    if (l?.length && !cobertura.value) cobertura.value = String(l[0]!.id);
  },
  { immediate: true },
);

const opcoesCobertura = computed(() => [
  { valor: '', rotulo: t('escolha') },
  ...(coberturas.data.value ?? []).map((c) => ({
    valor: String(c.id),
    rotulo: `${c.fontePagadora} · ${c.carteira ?? ''}`,
  })),
]);
const opcoesCanal = computed(() =>
  (['portal', 'webservice', 'telefone', 'email', 'presencial'] as const).map((c) => ({
    valor: c,
    rotulo: t(`canais.${c}`),
  })),
);
const codigoValido = computed(() => /^\d{8}$/.test(codigo.value.trim()));
const podeGravarPedido = computed(
  () => !!cobertura.value && codigoValido.value && descricao.value.trim().length >= 3 && !ocupado.value,
);
const guiaAberta = computed(() =>
  (d.value?.guias ?? []).some((g) => !['cancelada', 'negada'].includes(g.situacao)),
);
const urgente = computed(() => !!d.value && naturezaDeUrgencia(d.value.natureza));
const problemasUrgencia = computed(() =>
  d.value
    ? conferirExcecaoUrgencia(
        { tipoCobertura: 'convenio', natureza: d.value.natureza, senha: d.value.senha, guia: null },
        justificativa.value,
      )
    : [],
);

const parcialPendente = computed(
  () => !!d.value && d.value.etapa === 'autorizada_parcial' && !d.value.conferenciaParcial,
);
// A mesma regra do domínio que a gravação reconfere: validação na hora, antes de mandar.
const problemasParcial = computed(() => {
  const v = d.value;
  if (!v) return [];
  const vigente = v.guias.find((g) => g.situacao !== 'cancelada') ?? null;
  return conferirConferenciaParcial(
    {
      tipoCobertura: 'convenio',
      natureza: v.natureza,
      senha: v.senha,
      guia: vigente ? { situacao: vigente.situacao, senha: vigente.senha } : null,
      parcialConferida: !!v.conferenciaParcial,
    },
    conferencia.value,
  );
});

async function rodar(fn: () => Promise<string>): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = await fn();
    aberto.value = '';
    await cliente.invalidateQueries({ queryKey: ['cirurgia'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const pedir = () =>
  rodar(async () => {
    const r = await pedirAutorizacaoDaCirurgia({
      agendamento: props.agendamento,
      cobertura: Number(cobertura.value),
      cirurgiao: d.value!.cirurgiao,
      codigoProcedimento: codigo.value,
      descricao: descricao.value,
      indicacaoClinica: indicacao.value,
      canal: canal.value,
    });
    return t('pedido', { numero: r.numero });
  });

const registrar = () =>
  rodar(async () => {
    await registrarUrgenciaDaCirurgia(props.agendamento, d.value!.versao, justificativa.value);
    return t('registrada');
  });

const conferir = () =>
  rodar(async () => {
    await registrarConferenciaParcialDaCirurgia(props.agendamento, d.value!.versao, conferencia.value);
    return t('conferida');
  });
</script>

<template>
  <section
    v-if="veAutorizacao"
    class="painel"
    aria-labelledby="autorizacao-cirurgia-titulo"
    data-testid="autorizacao-cirurgia"
  >
    <h2 id="autorizacao-cirurgia-titulo">{{ t('titulo') }}</h2>
    <ErroCirurgia v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-if="d">
      <p>
        {{ t('etapa') }}:
        <strong data-testid="autorizacao-etapa" :data-etapa="d.etapa">{{ t(`etapas.${d.etapa}`) }}</strong>
      </p>
      <p v-if="d.senha" data-testid="autorizacao-senha">{{ t('senha', { senha: d.senha }) }}</p>
      <p v-else-if="d.autorizacaoPosterior" data-testid="autorizacao-posterior">
        {{ t('posterior', { justificativa: d.autorizacaoPosterior.justificativa ?? '' }) }}
      </p>
      <p v-else-if="d.etapa !== 'nao_exigida'" class="secundario">{{ t('semSenha') }}</p>
      <p v-if="parcialPendente" class="secundario" data-testid="autorizacao-parcial">{{ t('parcial') }}</p>
      <p v-else-if="d.conferenciaParcial" data-testid="autorizacao-parcial-conferida">
        {{ t('parcialConferida', { justificativa: d.conferenciaParcial.justificativa ?? '' }) }}
      </p>
      <div v-if="podePedir && parcialPendente" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('conferir')"
          data-testid="autorizacao-conferir"
          @acionar="aberto = 'parcial'"
        />
      </div>
      <ul v-if="d.guias.length" class="guias" data-testid="autorizacao-guias">
        <li v-for="g in d.guias" :key="g.id">
          {{ t('guia', { numero: g.numero, situacao: g.situacao }) }}
          <span v-if="g.senha"> · {{ t('senha', { senha: g.senha }) }}</span>
        </li>
      </ul>
      <p v-else-if="d.etapa !== 'nao_exigida'" class="secundario">{{ t('nenhumaGuia') }}</p>

      <div v-if="podePedir && d.etapa !== 'nao_exigida' && !d.senha" class="acoes">
        <SanteBotao
          v-if="!guiaAberta"
          variante="secundario"
          :rotulo="t('pedir')"
          data-testid="autorizacao-pedir"
          @acionar="aberto = 'pedido'"
        />
        <SanteBotao
          v-if="urgente && !d.autorizacaoPosterior"
          variante="secundario"
          :rotulo="t('urgencia')"
          data-testid="autorizacao-urgencia"
          @acionar="aberto = 'urgencia'"
        />
      </div>

      <form
        v-if="aberto === 'pedido'"
        class="formulario"
        data-testid="autorizacao-form"
        @submit.prevent="pedir"
      >
        <SanteSelecao v-model="cobertura" :rotulo="t('carteira')" :opcoes="opcoesCobertura" obrigatorio />
        <div class="campo">
          <label for="autorizacao-codigo">{{ t('codigo') }}</label>
          <input
            id="autorizacao-codigo"
            v-model="codigo"
            inputmode="numeric"
            maxlength="8"
            data-testid="autorizacao-codigo"
            :aria-invalid="codigo !== '' && !codigoValido"
          />
          <small v-if="codigo !== '' && !codigoValido" class="erro-campo">{{ t('codigoInvalido') }}</small>
        </div>
        <SanteCampoTexto v-model="descricao" :rotulo="t('descricao')" :max-bytes="150" />
        <SanteCampoTexto v-model="indicacao" :rotulo="t('indicacao')" :max-bytes="1000" />
        <SanteSelecao v-model="canal" :rotulo="t('canal')" :opcoes="opcoesCanal" />
        <SanteBotao
          :rotulo="t('enviar')"
          :desabilitado="!podeGravarPedido"
          data-testid="autorizacao-gravar"
          @acionar="pedir"
        />
      </form>

      <form
        v-if="aberto === 'urgencia'"
        class="formulario"
        data-testid="autorizacao-urgencia-form"
        @submit.prevent="registrar"
      >
        <SanteCampoTexto v-model="justificativa" :rotulo="t('justificativa')" :max-bytes="500" />
        <small v-for="p in problemasUrgencia" :key="p.mensagem" class="erro-campo">{{ p.mensagem }}</small>
        <SanteBotao
          :rotulo="t('registrar')"
          :desabilitado="problemasUrgencia.length > 0 || ocupado"
          data-testid="autorizacao-registrar-urgencia"
          @acionar="registrar"
        />
      </form>
      <form
        v-if="aberto === 'parcial'"
        class="formulario"
        data-testid="autorizacao-parcial-form"
        @submit.prevent="conferir"
      >
        <SanteCampoTexto v-model="conferencia" :rotulo="t('conferencia')" :max-bytes="500" />
        <small v-for="p in problemasParcial" :key="p.mensagem" class="erro-campo">{{ p.mensagem }}</small>
        <SanteBotao
          :rotulo="t('gravarConferencia')"
          :desabilitado="problemasParcial.length > 0 || ocupado"
          data-testid="autorizacao-gravar-conferencia"
          @acionar="conferir"
        />
      </form>
    </template>
    <p v-if="mensagem" role="status" data-testid="autorizacao-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped>
.guias {
  list-style: none;
  padding: 0;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.erro-campo {
  color: var(--sgh-texto-secundario);
}
.secundario {
  color: var(--sgh-texto-secundario);
}
</style>
