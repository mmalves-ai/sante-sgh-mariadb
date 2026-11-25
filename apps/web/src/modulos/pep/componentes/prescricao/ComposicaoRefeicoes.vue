<script setup lang="ts">
// Composição da dieta oral ou livre por refeição (03-PEP L112): em cada refeição do dia, o alimento, a quantidade, a
// medida caseira e a parte das calorias do dia; "Substituto" acrescenta, logo abaixo do titular e na mesma refeição,
// o alimento que pode trocá-lo (um clique, sem digitar posição). A conferência é a do domínio, na hora, com a soma
// das calorias à vista; o servidor repete a mesma regra ao gravar.
import type { ClasseDieta } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DominiosPrescricao } from '../../api-prescricao.js';
import {
  acrescentarSubstituto,
  type LinhaRefeicao,
  linhaVazia,
  percentualDaComposicao,
  recusaDaComposicao,
  removerLinha,
} from './composicao-refeicoes.js';

const props = defineProps<{ classe: ClasseDieta; dominios: DominiosPrescricao; prefixo: string }>();
const linhas = defineModel<LinhaRefeicao[]>({ required: true });
const { t } = useI18n();

const opcoes = (k: string, filtro?: (g: string | null | undefined) => boolean) => [
  { valor: '', rotulo: t('pep.presc.item.escolha') },
  ...(props.dominios[k] ?? [])
    .filter((o) => !filtro || filtro(o.grupo))
    .map((o) => ({ valor: o.id, rotulo: o.nome })),
];
const opcoesRefeicao = computed(() => opcoes('refeicoes'));
const opcoesAlimento = computed(() => opcoes('alimentos'));
/** Medida caseira do alimento escolhido ou genérica (sem alimento). */
const opcoesMedida = (alimento: string) => opcoes('medidasCaseiras', (g) => !g || g === alimento);
const nomeAlimento = (id: string) => props.dominios['alimentos']?.find((o) => o.id === id)?.nome ?? '';

const recusa = computed(() => recusaDaComposicao(props.classe, linhas.value));
const percentual = computed(() => percentualDaComposicao(linhas.value));

function acrescentar(): void {
  const ultima = linhas.value.at(-1);
  linhas.value = [...linhas.value, linhaVazia(ultima?.refeicao ?? '')];
}
</script>

<template>
  <fieldset class="composicao" data-testid="composicao-refeicoes">
    <legend>{{ t('pep.presc.item.composicao') }}</legend>
    <div
      v-for="(x, i) in linhas"
      :key="i"
      class="linha"
      :class="{ substituto: x.substitui !== null }"
      :data-testid="`refeicao-linha-${i + 1}`"
    >
      <span v-if="x.substitui !== null" class="marca">
        {{
          t('pep.presc.item.substitutoDe', {
            alimento: nomeAlimento(linhas[x.substitui - 1]?.alimento ?? ''),
          })
        }}
      </span>
      <SanteSelecao
        v-else
        v-model="x.refeicao"
        :rotulo="t('pep.presc.item.refeicao')"
        :opcoes="opcoesRefeicao"
        :data-testid="`refeicao-${i + 1}`"
      />
      <SanteSelecao
        v-model="x.alimento"
        :rotulo="t('pep.presc.item.alimento')"
        :opcoes="opcoesAlimento"
        :busca="true"
        :data-testid="`alimento-${i + 1}`"
      />
      <div class="campo curto">
        <label :for="`${prefixo}-rq-${i}`">{{ t('pep.presc.item.quantidadeAlimento') }}</label>
        <input
          :id="`${prefixo}-rq-${i}`"
          v-model="x.quantidade"
          inputmode="decimal"
          :data-testid="`quantidade-alimento-${i + 1}`"
        />
      </div>
      <SanteSelecao
        v-model="x.medidaCaseira"
        :rotulo="t('pep.presc.item.medidaCaseira')"
        :opcoes="opcoesMedida(x.alimento)"
      />
      <div v-if="x.medidaCaseira" class="campo curto">
        <label :for="`${prefixo}-rm-${i}`">{{ t('pep.presc.item.quantidadeMedida') }}</label>
        <input :id="`${prefixo}-rm-${i}`" v-model="x.quantidadeMedidaCaseira" inputmode="decimal" />
      </div>
      <div v-if="x.substitui === null" class="campo curto">
        <label :for="`${prefixo}-rp-${i}`">{{ t('pep.presc.item.percentualDiario') }}</label>
        <input
          :id="`${prefixo}-rp-${i}`"
          v-model="x.percentualDiario"
          inputmode="decimal"
          :data-testid="`percentual-${i + 1}`"
        />
      </div>
      <SanteBotao
        v-if="x.substitui === null"
        :rotulo="t('pep.presc.item.acrescentarSubstituto')"
        variante="secundario"
        :data-testid="`substituto-${i + 1}`"
        @acionar="linhas = acrescentarSubstituto(linhas, i)"
      />
      <SanteBotao
        :rotulo="t('pep.presc.item.removerAlimento')"
        variante="secundario"
        @acionar="linhas = removerLinha(linhas, i)"
      />
    </div>
    <p v-if="linhas.length" role="status" data-testid="percentual-total">
      {{ t('pep.presc.item.percentualTotal', { valor: String(percentual).replace('.', ',') }) }}
    </p>
    <SanteAlerta v-if="recusa" variante="alerta" :texto="recusa" data-testid="composicao-recusa" />
    <SanteBotao
      :rotulo="t('pep.presc.item.acrescentarAlimento')"
      variante="secundario"
      data-testid="acrescentar-alimento"
      @acionar="acrescentar"
    />
  </fieldset>
</template>

<style scoped>
.composicao {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  display: grid;
  gap: var(--sgh-espaco-2);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.linha.substituto {
  padding-left: var(--sgh-espaco-4);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.campo.curto input {
  width: 8rem;
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
}
.marca {
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
}
</style>
