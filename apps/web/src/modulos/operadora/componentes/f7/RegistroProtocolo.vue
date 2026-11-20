<script setup lang="ts">
// Registro do contato do beneficiário com o protocolo dado na hora (M56, etapa 8, F7): a operadora, a instância
// (atendimento, ouvidoria ou notificação da ANS), a natureza (a classe sai dela), o canal, a origem do atendimento, quem
// fez o contato, a carteirinha, o pedido de autorização a que a cobertura se refere (pelo protocolo dele), o número da
// demanda na ANS, a urgência, a alta complexidade, o assunto, o relato e o pedido da resposta por escrito. As mesmas
// regras do servidor (@sgh/dominio-operadora) mostram a recusa antes de gravar e o prazo previsto; o servidor confere
// de novo e devolve o número e o prazo.
import {
  type ApoioProtocolos,
  CANAIS_PROTOCOLO,
  INSTANCIAS_PROTOCOLO,
  MENSAGENS_ATENDIMENTO,
  NATUREZAS_PROTOCOLO,
  type ResultadoProtocoloOpe,
  SOLICITANTES_PROTOCOLO,
} from '@sgh/contratos';
import { conferirRegistroProtocolo, prazoDoProtocolo } from '@sgh/dominio-operadora';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { consultarProtocolo, registrarProtocolo } from '../../api-atendimento.js';

const props = defineProps<{ apoio: ApoioProtocolos }>();
const emit = defineEmits<{ gravado: [r: ResultadoProtocoloOpe]; cancelar: [] }>();
const { t } = useI18n();

const f = reactive({
  operadora: (props.apoio.operadoras.length === 1 ? props.apoio.operadoras[0]!.id : null) as number | null,
  instancia: 'atendimento' as (typeof INSTANCIAS_PROTOCOLO)[number],
  natureza: null as (typeof NATUREZAS_PROTOCOLO)[number] | null,
  canal: 'telefone' as (typeof CANAIS_PROTOCOLO)[number],
  origem: (props.apoio.dominios.origem[0]?.codigo ?? null) as number | null,
  solicitante: 'beneficiario' as (typeof SOLICITANTES_PROTOCOLO)[number],
  carteirinha: '',
  solicitanteNome: '',
  autorizacao: '',
  numeroNip: '',
  urgente: false,
  altaComplexidade: false,
  assunto: '',
  relato: '',
  escritaPedida: false,
});

const escolha = () => ({ valor: null, rotulo: t('operadoraAtendimento.form.escolha') });
const opcoesOperadora = computed(() => [
  escolha(),
  ...props.apoio.operadoras.map((o) => ({ valor: o.id, rotulo: `${o.nome} · ANS ${o.registroAns}` })),
]);
const opcoesInstancia = computed(() =>
  INSTANCIAS_PROTOCOLO.map((v) => ({ valor: v, rotulo: t(`operadoraAtendimento.instancias.${v}`) })),
);
const opcoesNatureza = computed(() => [
  escolha(),
  ...NATUREZAS_PROTOCOLO.map((v) => ({ valor: v, rotulo: t(`operadoraAtendimento.naturezas.${v}`) })),
]);
const opcoesCanal = computed(() =>
  CANAIS_PROTOCOLO.map((v) => ({ valor: v, rotulo: t(`operadoraAtendimento.canais.${v}`) })),
);
const opcoesSolicitante = computed(() =>
  SOLICITANTES_PROTOCOLO.map((v) => ({ valor: v, rotulo: t(`operadoraAtendimento.solicitantes.${v}`) })),
);
const opcoesOrigem = computed(() => [
  escolha(),
  ...props.apoio.dominios.origem.map((o) => ({ valor: o.codigo, rotulo: o.rotulo })),
]);

const nip = computed(() => f.instancia === 'nip');
const cobertura = computed(() => f.natureza === 'cobertura');
const pedeNome = computed(() => f.solicitante !== 'beneficiario' && f.solicitante !== 'ans');

// As recusas que não dependem do banco, com o mesmo texto do servidor.
const recusasLocais = computed(() => {
  if (!f.natureza) return [];
  return conferirRegistroProtocolo({
    instancia: f.instancia,
    natureza: f.natureza,
    canal: f.canal,
    solicitante: f.solicitante,
    carteirinha: f.carteirinha.trim() || null,
    solicitanteNome: f.solicitanteNome.trim() || null,
    numeroNip: f.numeroNip.trim() || null,
    urgente: f.urgente,
    altaComplexidade: f.altaComplexidade,
    temAutorizacao: !!f.autorizacao.trim(),
    temOrigemProtocolo: false,
  }).map((p) => MENSAGENS_ATENDIMENTO[p.codigo] ?? p.codigo);
});

const prazoPrevisto = computed(() => {
  if (!f.natureza) return null;
  const p = prazoDoProtocolo(
    {
      instancia: f.instancia,
      natureza: f.natureza,
      urgente: f.urgente,
      altaComplexidade: f.altaComplexidade,
    },
    `${props.apoio.hoje}T12:00:00`,
  );
  const x = props.apoio.parametros;
  const dias: Record<string, number> = {
    assistencial: x.diasUteisAssistencial,
    complexo: x.diasUteisComplexo,
    'nao-assistencial': x.diasUteisNaoAssistencial,
    ouvidoria: x.diasUteisOuvidoria,
    'nip-assistencial': x.diasUteisNipAssistencial,
    'nip-nao-assistencial': x.diasUteisNipNaoAssistencial,
  };
  return t(`operadoraAtendimento.prazos.${p.tipo}`, {
    dias: dias[p.tipo] ?? 0,
    maximo: x.diasUteisOuvidoriaMaximo,
  });
});

const completo = computed(
  () =>
    f.operadora !== null &&
    f.natureza !== null &&
    f.origem !== null &&
    f.assunto.trim().length >= 5 &&
    f.relato.trim().length >= 10 &&
    (!f.carteirinha.trim() || /^\d{16}$/.test(f.carteirinha.trim())) &&
    (!f.autorizacao.trim() || /^\d{20}$/.test(f.autorizacao.trim())) &&
    recusasLocais.value.length === 0,
);

const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

async function idDaAutorizacao(): Promise<number | null | 'nao-achada'> {
  const n = f.autorizacao.trim();
  if (!n) return null;
  try {
    const r = await consultarProtocolo(n);
    return r.tipo === 'autorizacao' ? r.id : 'nao-achada';
  } catch (e) {
    if (e instanceof ErroApi && [400, 404].includes(e.status)) return 'nao-achada';
    throw e;
  }
}

async function gravar(): Promise<void> {
  if (!completo.value || gravando.value) return;
  recusa.value = null;
  erro.value = null;
  gravando.value = true;
  try {
    const autorizacao = cobertura.value ? await idDaAutorizacao() : null;
    if (autorizacao === 'nao-achada') {
      recusa.value = t('operadoraAtendimento.form.autorizacaoNaoAchada');
      return;
    }
    const r = await registrarProtocolo({
      operadora: f.operadora,
      instancia: f.instancia,
      natureza: f.natureza,
      canal: f.canal,
      origem: f.origem,
      solicitante: f.solicitante,
      ...(f.carteirinha.trim() ? { carteirinha: f.carteirinha.trim() } : {}),
      ...(pedeNome.value && f.solicitanteNome.trim() ? { solicitanteNome: f.solicitanteNome } : {}),
      ...(autorizacao ? { autorizacao } : {}),
      ...(nip.value && f.numeroNip.trim() ? { numeroNip: f.numeroNip.trim() } : {}),
      urgente: f.urgente,
      altaComplexidade: cobertura.value && f.altaComplexidade,
      assunto: f.assunto,
      relato: f.relato,
      escritaPedida: f.escritaPedida,
    });
    emit('gravado', r);
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}

function aoMudarInstancia(): void {
  if (nip.value) {
    f.canal = 'ans';
    f.solicitante = 'ans';
  } else if (f.canal === 'ans') {
    f.canal = 'telefone';
    f.solicitante = 'beneficiario';
  }
}
</script>

<template>
  <form class="formulario" data-testid="form-protocolo" @submit.prevent="gravar">
    <div class="campos">
      <SanteSelecao
        v-model="f.operadora"
        :rotulo="t('operadoraAtendimento.form.operadora')"
        :opcoes="opcoesOperadora"
        obrigatorio
        data-testid="prot-operadora"
      />
      <SanteSelecao
        v-model="f.instancia"
        :rotulo="t('operadoraAtendimento.form.instancia')"
        :opcoes="opcoesInstancia"
        obrigatorio
        data-testid="prot-instancia"
        @update:model-value="aoMudarInstancia"
      />
      <SanteSelecao
        v-model="f.natureza"
        :rotulo="t('operadoraAtendimento.form.natureza')"
        :opcoes="opcoesNatureza"
        obrigatorio
        data-testid="prot-natureza"
      />
      <SanteSelecao
        v-model="f.canal"
        :rotulo="t('operadoraAtendimento.form.canal')"
        :opcoes="opcoesCanal"
        obrigatorio
        data-testid="prot-canal"
      />
      <SanteSelecao
        v-model="f.origem"
        :rotulo="t('operadoraAtendimento.form.origem')"
        :opcoes="opcoesOrigem"
        obrigatorio
        data-testid="prot-origem"
      />
      <SanteSelecao
        v-model="f.solicitante"
        :rotulo="t('operadoraAtendimento.form.solicitante')"
        :opcoes="opcoesSolicitante"
        obrigatorio
        data-testid="prot-solicitante"
      />
      <SanteCampoTexto
        id="prot-carteirinha"
        v-model="f.carteirinha"
        :rotulo="t('operadoraAtendimento.form.carteirinha')"
        :max-bytes="16"
      />
      <SanteCampoTexto
        v-if="pedeNome"
        id="prot-solicitante-nome"
        v-model="f.solicitanteNome"
        :rotulo="t('operadoraAtendimento.form.solicitanteNome')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteCampoTexto
        v-if="cobertura"
        id="prot-autorizacao"
        v-model="f.autorizacao"
        :rotulo="t('operadoraAtendimento.form.autorizacao')"
        :max-bytes="20"
      />
      <SanteCampoTexto
        v-if="nip"
        id="prot-nip"
        v-model="f.numeroNip"
        :rotulo="t('operadoraAtendimento.form.numeroNip')"
        :max-bytes="30"
        obrigatorio
      />
    </div>
    <div class="campos">
      <label class="marcar"
        ><input v-model="f.urgente" type="checkbox" data-testid="prot-urgente" />
        {{ t('operadoraAtendimento.form.urgente') }}</label
      >
      <label v-if="cobertura" class="marcar"
        ><input v-model="f.altaComplexidade" type="checkbox" data-testid="prot-complexo" />
        {{ t('operadoraAtendimento.form.altaComplexidade') }}</label
      >
      <label class="marcar"
        ><input v-model="f.escritaPedida" type="checkbox" data-testid="prot-escrita" />
        {{ t('operadoraAtendimento.form.escritaPedida') }}</label
      >
    </div>
    <SanteCampoTexto
      id="prot-assunto"
      v-model="f.assunto"
      :rotulo="t('operadoraAtendimento.form.assunto')"
      :max-bytes="200"
      obrigatorio
    />
    <SanteCampoTexto
      id="prot-relato"
      v-model="f.relato"
      :rotulo="t('operadoraAtendimento.form.relato')"
      :max-bytes="2000"
      multilinha
      obrigatorio
    />
    <p v-if="prazoPrevisto" class="secundario" data-testid="prot-prazo-previsto">
      {{ t('operadoraAtendimento.form.prazoPrevisto', { prazo: prazoPrevisto }) }}
    </p>
    <div v-if="recusasLocais.length" class="recusas" data-testid="prot-recusas-locais">
      <SanteAlerta v-for="r in recusasLocais" :key="r" :texto="r" variante="aviso" />
    </div>
    <div v-if="recusa" role="alert" data-testid="prot-recusa">
      <SanteAlerta :texto="recusa" variante="alerta" />
    </div>
    <MensagemErro v-if="erro" :erro="erro" />
    <div class="botoes">
      <SanteBotao
        tipo="submit"
        :rotulo="t('operadoraAtendimento.form.registrar')"
        :desabilitado="!completo || gravando"
        data-testid="prot-registrar"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('operadoraAtendimento.form.cancelar')"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>

<style scoped>
.formulario {
  display: grid;
  gap: 0.75rem;
}
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 0.75rem;
  border: 0;
  padding: 0;
  margin: 0;
}
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
.botoes {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.recusas {
  display: grid;
  gap: 0.25rem;
}
</style>
