<script setup lang="ts">
// Comparação lado a lado de um par provável da Rede (M57, etapa 1; ficha, seção 7; regras 2 e 3): os dois cadastros
// lidos ao vivo, cada um no banco do seu estabelecimento (mãe em iniciais, CPF e CNS mascarados pelo servidor), o que
// bateu e o que diverge, e a decisão: "É a mesma pessoa" (vincula nos dois estabelecimentos) ou "É outra pessoa"
// (justificativa obrigatória). O resultado diz se algum estabelecimento ficou para trás (completado no relatório
// diário). No par já vinculado, os vínculos do cadastro com "Desfazer".
import type { CandidatoRede, LadoCandidatoRede } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { dataBr } from '../../cadastro/formato.js';
import { decidirParRede, lerCandidatoRede, resumoGravacao } from '../api-rede.js';
import VinculosCadastroRede from './VinculosCadastroRede.vue';

const props = defineProps<{ chave: string | null }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ decidido: [mensagem: string] }>();
const { t } = useI18n();

const consulta = useQuery({
  queryKey: computed(() => ['rede', 'par', props.chave]),
  queryFn: () => lerCandidatoRede(props.chave as string),
  enabled: computed(() => visivel.value && !!props.chave),
});
const par = computed<CandidatoRede | undefined>(() => consulta.data.value);
const podeVincular = computed(() => pode('rede.mpi.vincular'));

const justificativa = ref('');
const confirmando = ref(false);
const erro = ref<unknown>(null);
watch(
  () => [props.chave, visivel.value],
  () => {
    justificativa.value = '';
    confirmando.value = false;
    erro.value = null;
  },
);

const linhas = computed(() => [
  { rotulo: t('rede.colunas.estabelecimento'), campo: 'estabelecimentoNome' as const },
  { rotulo: t('rede.colunas.prontuario'), campo: 'prontuario' as const },
  { rotulo: t('rede.colunas.nome'), campo: 'nome' as const },
  { rotulo: t('rede.colunas.nascimento'), campo: 'nascimento' as const },
  { rotulo: t('rede.colunas.sexo'), campo: 'sexo' as const },
  { rotulo: t('rede.colunas.mae'), campo: 'maeMascarada' as const },
  { rotulo: t('rede.colunas.cpf'), campo: 'cpfMascarado' as const },
  { rotulo: t('rede.colunas.cns'), campo: 'cnsMascarado' as const },
]);
type Campo = (typeof linhas.value)[number]['campo'];
function valor(l: LadoCandidatoRede, campo: Campo): string {
  if (campo === 'nascimento') return dataBr(l.nascimento);
  const v = l[campo];
  return v === null || v === undefined ? '' : String(v);
}

async function decidir(decisao: 'mesma_pessoa' | 'outra_pessoa'): Promise<void> {
  if (!props.chave) return;
  erro.value = null;
  try {
    const r = await decidirParRede(
      props.chave,
      decisao === 'outra_pessoa'
        ? { decisao, justificativa: justificativa.value.trim() }
        : {
            decisao,
            ...(justificativa.value.trim().length >= 5 ? { justificativa: justificativa.value.trim() } : {}),
          },
    );
    const g = resumoGravacao(r);
    const base = decisao === 'mesma_pessoa' ? t('rede.decisao.vinculado') : t('rede.decisao.descartado');
    visivel.value = false;
    emit('decidido', g.pendente ? `${base} ${t('rede.decisao.pendente', g)}` : base);
  } catch (e) {
    erro.value = e;
  }
}

const nomes = computed(() =>
  par.value
    ? {
        [par.value.local.estabelecimento]: par.value.local.estabelecimentoNome,
        [par.value.remoto.estabelecimento]: par.value.remoto.estabelecimentoNome,
      }
    : {},
);
const podeDecidir = computed(
  () =>
    podeVincular.value &&
    par.value?.situacao === 'aberto' &&
    par.value.local.disponivel &&
    par.value.remoto.disponivel,
);
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('rede.comparar')" largura="56rem">
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!par">{{ t('rede.carregando') }}</p>
    <div v-else data-testid="comparacao-rede">
      <table>
        <caption>
          {{
            t('rede.colunas.pontuacao')
          }}:
          {{
            par.pontuacao
          }}
          ·
          {{
            t(`rede.situacoes.${par.situacao}`)
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span class="oculto">{{ t('rede.colunas.acoes') }}</span>
            </th>
            <th scope="col">{{ t('rede.local') }}</th>
            <th scope="col">{{ t('rede.remoto') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in linhas"
            :key="l.campo"
            :class="{
              igual:
                l.campo !== 'estabelecimentoNome' && valor(par.local, l.campo) === valor(par.remoto, l.campo),
            }"
          >
            <th scope="row">{{ l.rotulo }}</th>
            <td>{{ valor(par.local, l.campo) }}</td>
            <td>{{ valor(par.remoto, l.campo) }}</td>
          </tr>
        </tbody>
      </table>
      <p data-testid="criterios-par">
        <strong>{{ t('rede.colunas.criterios') }}:</strong>
        {{ par.criterios.map((c) => t(`rede.criterios.${c}`)).join(', ') || '—' }}
      </p>
      <p v-if="par.divergencias.length" data-testid="divergencias-par">
        <strong>{{ t('rede.colunas.divergencias') }}:</strong>
        {{ par.divergencias.map((d) => t(`rede.divergencias.${d}`)).join(', ') }}
      </p>
      <SanteAlerta
        v-if="!par.local.disponivel || !par.remoto.disponivel"
        :texto="t('rede.indisponivel')"
        variante="aviso"
      />
      <p class="acoes">
        <RouterLink :to="`/cadastros/pacientes/${par.local.id}`">{{ t('rede.abrirFicha') }}</RouterLink>
      </p>

      <form
        v-if="podeDecidir"
        class="form"
        data-testid="form-decisao-rede"
        @submit.prevent="decidir('outra_pessoa')"
      >
        <MensagemErro v-if="erro" :erro="erro" />
        <label for="justificativa-rede">{{ t('rede.decisao.justificativa') }}</label>
        <textarea
          id="justificativa-rede"
          v-model="justificativa"
          maxlength="200"
          rows="2"
          aria-describedby="justificativa-rede-ajuda"
          data-testid="justificativa-rede"
        />
        <small id="justificativa-rede-ajuda">{{ t('rede.decisao.justificativaObrigatoria') }}</small>
        <SanteAlerta v-if="confirmando" :texto="t('rede.decisao.confirmarMesma')" variante="info" />
        <div class="acoes">
          <SanteBotao
            v-if="!confirmando"
            :rotulo="t('rede.decisao.mesmaPessoa')"
            variante="primario"
            data-testid="botao-mesma-pessoa"
            @acionar="confirmando = true"
          />
          <SanteBotao
            v-else
            :rotulo="t('rede.decisao.mesmaPessoa')"
            variante="primario"
            data-testid="botao-confirmar-mesma"
            @acionar="decidir('mesma_pessoa')"
          />
          <SanteBotao
            :rotulo="t('rede.decisao.outraPessoa')"
            variante="secundario"
            tipo="submit"
            :desabilitado="justificativa.trim().length < 5"
            data-testid="botao-outra-pessoa-rede"
          />
          <SanteBotao :rotulo="t('rede.fechar')" variante="texto" @acionar="visivel = false" />
        </div>
      </form>
      <VinculosCadastroRede
        v-if="par.situacao === 'vinculado'"
        :estabelecimento="par.local.estabelecimento"
        :id="par.local.id"
        :nomes="nomes"
        @alterado="emit('decidido', t('rede.desfazer.feito'))"
      />
    </div>
  </SanteDialogo>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
tr.igual td {
  font-weight: 600;
}
.form {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.acoes a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
