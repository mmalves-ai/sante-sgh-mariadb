<script setup lang="ts">
// Vínculos de um cadastro com a pessoa da Rede (M57, etapa 1; ficha, seção 7): a lista (ativos e desfeitos, com quem e
// quando) e "Desfazer" (só com `rede.mpi.desfazer`): a justificativa é obrigatória e "Devolver o par à fila" reabre o
// par; desfazer apaga só a ligação do índice, nunca o cadastro (regra 1). Aberto pelo par da fila (ParRedeDialogo); o
// paciente se acha pela busca por prontuário da fila (FilaRedeTela).
import type { VinculosCadastroRede } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { carimboBr } from '../../cadastro/formato.js';
import { desfazerVinculoRede, lerVinculosRede, resumoGravacao } from '../api-rede.js';

const props = defineProps<{
  estabelecimento: string;
  id: number;
  nomes?: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{ alterado: [] }>();
const { t } = useI18n();

const consulta = useQuery({
  queryKey: computed(() => ['rede', 'vinculos', props.estabelecimento, props.id]),
  queryFn: () => lerVinculosRede(props.estabelecimento, props.id),
});
const v = computed<VinculosCadastroRede | undefined>(() => consulta.data.value);
const podeDesfazer = computed(() => pode('rede.mpi.desfazer'));

const escolhido = ref<string | null>(null);
const justificativa = ref('');
const reabrir = ref(true);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

function abrir(chave: string): void {
  escolhido.value = chave;
  justificativa.value = '';
  reabrir.value = true;
  erro.value = null;
}

async function desfazer(): Promise<void> {
  if (!escolhido.value) return;
  erro.value = null;
  try {
    const r = await desfazerVinculoRede(escolhido.value, {
      justificativa: justificativa.value.trim(),
      reabrir: reabrir.value,
    });
    const g = resumoGravacao(r);
    mensagem.value = g.pendente
      ? t('rede.decisao.pendente', { gravados: g.gravados, total: g.total })
      : t('rede.desfazer.feito');
    escolhido.value = null;
    await consulta.refetch();
    emit('alterado');
  } catch (e) {
    erro.value = e;
  }
}

const nome = (est: string) => props.nomes?.[est] ?? est;
</script>

<template>
  <section class="vinculos" aria-labelledby="vinculos-titulo" data-testid="vinculos-cadastro-rede">
    <h3 id="vinculos-titulo">{{ t('rede.vinculos.titulo') }}</h3>
    <p v-if="mensagem" role="status" data-testid="mensagem-vinculos">{{ mensagem }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!v">{{ t('rede.carregando') }}</p>
    <template v-else>
      <p v-if="v.vinculos.length === 0">{{ t('rede.vinculos.nenhum') }}</p>
      <ul v-else>
        <li v-for="x in v.vinculos" :key="x.chave" :data-testid="`vinculo-${x.chave}`">
          <span>
            {{ nome(x.estabelecimento) }} · {{ t('rede.colunas.prontuario') }} {{ x.prontuarioRemoto }} ·
            {{ t(`rede.origens.${x.origem}`) }} · {{ x.criadoPor }} {{ carimboBr(x.criadoEm) }}
          </span>
          <span v-if="x.situacao === 'desfeito'" class="pequeno">
            {{
              t('rede.vinculos.desfeitoPor', { quem: x.desfeitoPor ?? '', quando: carimboBr(x.desfeitoEm) })
            }}
          </span>
          <SanteBotao
            v-else-if="podeDesfazer"
            :rotulo="t('rede.desfazer.acao')"
            variante="secundario"
            :data-testid="`desfazer-${x.chave}`"
            @acionar="abrir(x.chave)"
          />
        </li>
      </ul>
      <form v-if="escolhido" class="form" data-testid="form-desfazer" @submit.prevent="desfazer">
        <SanteAlerta :texto="t('rede.desfazer.confirmar')" variante="aviso" />
        <MensagemErro v-if="erro" :erro="erro" />
        <label for="justificativa-desfazer">{{ t('rede.desfazer.justificativa') }}</label>
        <textarea
          id="justificativa-desfazer"
          v-model="justificativa"
          maxlength="200"
          rows="2"
          required
          data-testid="justificativa-desfazer"
        />
        <label class="marcar">
          <input v-model="reabrir" type="checkbox" data-testid="reabrir" />
          {{ t('rede.desfazer.reabrir') }}
        </label>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('rede.desfazer.titulo')"
            variante="primario"
            tipo="submit"
            :desabilitado="justificativa.trim().length < 5"
            data-testid="botao-desfazer"
          />
          <SanteBotao :rotulo="t('rede.fechar')" variante="texto" @acionar="escolhido = null" />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.pequeno {
  font-size: var(--sgh-fonte-pequena);
}
.form {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
.marcar {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
