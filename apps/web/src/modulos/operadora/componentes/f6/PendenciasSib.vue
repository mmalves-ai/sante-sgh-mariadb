<script setup lang="ts">
// Pendências do cadastro de beneficiários para o SIB (M56, etapa 7, F6; `operadora.ans.ler`): os beneficiários com
// movimento a enviar e o que impede cada um (CPF, CNS ou DNV, endereço, registro do plano, CCO, motivo do cancelamento),
// em páginas; o complemento do beneficiário (endereço, DNV, cobertura, CCO, motivo do cancelamento) abre num diálogo e
// grava só com `operadora.ans.gerar`, sobre a versão vista (o cadastro do beneficiário segue na tela de beneficiários).
import {
  type ApoioAns,
  type ComplementoSib,
  MOTIVOS_CANCELAMENTO_SIB,
  type PendenciaSib,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { gravarComplementoSib, lerComplementoSib, lerPendenciasSib } from '../../api-ans.js';
import { dataBr } from '../f1/comum.js';

const props = defineProps<{ apoio: ApoioAns; operadora: number; podeGerar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();

const cursores = ref<(number | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const lista = useQuery({
  queryKey: computed(() => ['operadora', 'ans', 'sib', props.operadora, cursor.value]),
  queryFn: () => lerPendenciasSib(props.operadora, cursor.value),
});

// ── Complemento ────────────────────────────────────────────────────────────────────────────────
const alvo = ref<PendenciaSib | null>(null);
const visivel = computed({
  get: () => alvo.value !== null,
  set: (v: boolean) => {
    if (!v) alvo.value = null;
  },
});
const atual = ref<ComplementoSib | null>(null);
const erroLer = ref<unknown>(null);
const f = ref({
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipio: '',
  cep: '',
  resideExterior: false,
  dnv: '',
  coberturaParcial: false,
  itensExcluidos: false,
  cco: '',
  motivoCancelamento: null as number | null,
});
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviando = ref(false);
const mensagem = ref<string | null>(null);

async function abrir(p: PendenciaSib): Promise<void> {
  alvo.value = p;
  atual.value = null;
  erroLer.value = null;
  recusa.value = null;
  erro.value = null;
  mensagem.value = null;
  try {
    const c = await lerComplementoSib(p.beneficiario);
    atual.value = c;
    f.value = {
      logradouro: c.logradouro ?? '',
      numero: c.numero ?? '',
      complemento: c.complemento ?? '',
      bairro: c.bairro ?? '',
      municipio: c.municipio !== null ? String(c.municipio) : '',
      cep: c.cep ?? '',
      resideExterior: c.resideExterior,
      dnv: c.dnv ?? '',
      coberturaParcial: c.coberturaParcial,
      itensExcluidos: c.itensExcluidos,
      cco: c.cco ?? '',
      motivoCancelamento: c.motivoCancelamento,
    };
  } catch (x) {
    erroLer.value = x;
  }
}

const invalidos = computed(() => {
  const x = f.value;
  const r: string[] = [];
  if (x.municipio.trim() && !/^\d{7}$/.test(x.municipio.trim()))
    r.push(t('operadoraAns.complemento.municipio'));
  if (x.cep.trim() && !/^\d{8}$/.test(x.cep.trim())) r.push(t('operadoraAns.complemento.cep'));
  if (x.dnv.trim() && !/^\d{11}$/.test(x.dnv.trim())) r.push(t('operadoraAns.complemento.dnv'));
  if (x.cco.trim() && !/^\d{12}$/.test(x.cco.trim())) r.push(t('operadoraAns.complemento.cco'));
  return r;
});
const vazio = (v: string) => (v.trim() ? v.trim() : null);

async function gravar(): Promise<void> {
  const c = atual.value;
  if (!c || !props.podeGerar || invalidos.value.length) return;
  recusa.value = null;
  erro.value = null;
  enviando.value = true;
  try {
    const x = f.value;
    atual.value = await gravarComplementoSib(c.beneficiario, {
      versao: c.versao,
      logradouro: vazio(x.logradouro),
      numero: vazio(x.numero),
      complemento: vazio(x.complemento),
      bairro: vazio(x.bairro),
      municipio: x.municipio.trim() ? Number(x.municipio.trim()) : null,
      cep: vazio(x.cep),
      resideExterior: x.resideExterior,
      dnv: vazio(x.dnv),
      coberturaParcial: x.coberturaParcial,
      itensExcluidos: x.itensExcluidos,
      cco: vazio(x.cco),
      motivoCancelamento: x.motivoCancelamento,
    });
    mensagem.value = t('operadoraAns.complemento.gravado');
    alvo.value = null;
    await cliente.invalidateQueries({ queryKey: ['operadora', 'ans', 'sib'] });
  } catch (x) {
    if (x instanceof ErroApi && x.problema?.detail && [400, 403, 404, 409, 422].includes(x.status))
      recusa.value = x.problema.detail;
    else erro.value = x;
  } finally {
    enviando.value = false;
  }
}

const opcoesMotivo = computed(() => [
  { valor: null as number | null, rotulo: t('operadoraAns.complemento.nenhumMotivo') },
  ...props.apoio.motivosSib
    .filter((m) => (MOTIVOS_CANCELAMENTO_SIB as readonly number[]).includes(m.codigo))
    .map((m) => ({ valor: m.codigo as number | null, rotulo: m.nome })),
]);
const movimento = (p: PendenciaSib) =>
  p.movimento ? t(`operadoraAns.itens.tipos.${p.movimento}`) : t('operadoraAns.sib.semMovimento');
</script>

<template>
  <section class="bloco" aria-labelledby="ans-sib-titulo" data-testid="ans-sib">
    <h2 id="ans-sib-titulo">{{ t('operadoraAns.sib.titulo') }}</h2>
    <p class="secundario">{{ t('operadoraAns.sib.texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="ans-sib-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('operadoraAns.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0" data-testid="ans-sib-vazia">
      {{ t('operadoraAns.sib.nenhuma') }}
    </p>
    <table v-else class="tabela" data-testid="ans-sib-lista">
      <caption class="visualmente-oculto">
        {{
          t('operadoraAns.sib.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('operadoraAns.sib.carteirinha') }}</th>
          <th scope="col">{{ t('operadoraAns.sib.nome') }}</th>
          <th scope="col">{{ t('operadoraAns.sib.movimento') }}</th>
          <th scope="col">{{ t('operadoraAns.sib.problemas') }}</th>
          <th scope="col">
            <span class="visualmente-oculto">{{ t('operadoraAns.colunas.acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="p in lista.data.value.itens"
          :key="p.beneficiario"
          :data-testid="`ans-sib-${p.beneficiario}`"
        >
          <td>{{ p.carteirinha }}</td>
          <td>{{ p.nome }}</td>
          <td>{{ movimento(p) }}</td>
          <td>
            <ul class="lista-curta">
              <li v-for="(x, i) in p.problemas" :key="i" :data-codigo="x.codigo">{{ x.mensagem }}</li>
            </ul>
          </td>
          <td>
            <SanteBotao
              variante="texto"
              :rotulo="t('operadoraAns.sib.complementar', { nome: p.nome })"
              :data-testid="`ans-sib-complementar-${p.beneficiario}`"
              @acionar="abrir(p)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="lista.data.value" class="acoes">
      <SanteBotao
        v-if="cursores.length > 1"
        variante="secundario"
        :rotulo="t('operadoraAns.paginas.anterior')"
        @acionar="cursores = cursores.slice(0, -1)"
      />
      <SanteBotao
        v-if="lista.data.value.proxima"
        variante="secundario"
        :rotulo="t('operadoraAns.paginas.proxima')"
        @acionar="cursores = [...cursores, lista.data.value.proxima]"
      />
    </div>

    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="t('operadoraAns.complemento.titulo', { nome: alvo?.nome ?? '' })"
      largura="44rem"
    >
      <MensagemErro v-if="erroLer" :erro="erroLer" />
      <p v-else-if="!atual" role="status">{{ t('operadoraAns.carregando') }}</p>
      <form v-else class="dialogo" data-testid="ans-complemento" @submit.prevent="gravar">
        <p class="secundario">
          {{
            atual.aceitoEm
              ? t('operadoraAns.complemento.aceitoEm', { data: dataBr(atual.aceitoEm) })
              : t('operadoraAns.complemento.nuncaAceito')
          }}
        </p>
        <div class="campos">
          <SanteCampoTexto
            id="sib-logradouro"
            v-model="f.logradouro"
            :rotulo="t('operadoraAns.complemento.logradouro')"
            :max-bytes="60"
          />
          <SanteCampoTexto
            id="sib-numero"
            v-model="f.numero"
            :rotulo="t('operadoraAns.complemento.numero')"
            :max-bytes="10"
          />
          <SanteCampoTexto
            id="sib-complemento"
            v-model="f.complemento"
            :rotulo="t('operadoraAns.complemento.complemento')"
            :max-bytes="30"
          />
          <SanteCampoTexto
            id="sib-bairro"
            v-model="f.bairro"
            :rotulo="t('operadoraAns.complemento.bairro')"
            :max-bytes="40"
          />
          <SanteCampoTexto
            id="sib-municipio"
            v-model="f.municipio"
            :rotulo="t('operadoraAns.complemento.municipio')"
            :max-bytes="7"
          />
          <SanteCampoTexto
            id="sib-cep"
            v-model="f.cep"
            :rotulo="t('operadoraAns.complemento.cep')"
            :max-bytes="8"
          />
          <SanteCampoTexto
            id="sib-dnv"
            v-model="f.dnv"
            :rotulo="t('operadoraAns.complemento.dnv')"
            :max-bytes="11"
          />
          <SanteCampoTexto
            id="sib-cco"
            v-model="f.cco"
            :rotulo="t('operadoraAns.complemento.cco')"
            :max-bytes="12"
          />
          <SanteSelecao
            v-model="f.motivoCancelamento"
            :rotulo="t('operadoraAns.complemento.motivoCancelamento')"
            :opcoes="opcoesMotivo"
            data-testid="sib-motivo"
          />
        </div>
        <label class="marcar"
          ><input v-model="f.resideExterior" type="checkbox" data-testid="sib-exterior" />
          {{ t('operadoraAns.complemento.resideExterior') }}</label
        >
        <label class="marcar"
          ><input v-model="f.coberturaParcial" type="checkbox" />
          {{ t('operadoraAns.complemento.coberturaParcial') }}</label
        >
        <label class="marcar"
          ><input v-model="f.itensExcluidos" type="checkbox" />
          {{ t('operadoraAns.complemento.itensExcluidos') }}</label
        >
        <p v-if="invalidos.length" class="erro" role="alert">
          {{ t('operadoraAns.complemento.invalidos', { campos: invalidos.join(', ') }) }}
        </p>
        <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="ans-complemento-recusa" />
        <MensagemErro v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            v-if="podeGerar"
            tipo="submit"
            :rotulo="t('operadoraAns.complemento.gravar')"
            :desabilitado="enviando || invalidos.length > 0"
            data-testid="ans-complemento-gravar"
          />
          <p v-else class="secundario">{{ t('operadoraAns.complemento.somenteLeitura') }}</p>
          <SanteBotao variante="texto" :rotulo="t('operadoraAns.acoes.cancelar')" @acionar="alvo = null" />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.dialogo {
  display: grid;
  gap: 0.75rem;
}
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
.lista-curta {
  margin: 0;
  padding-left: 1rem;
}
.erro {
  color: var(--sgh-perigo);
}
</style>
