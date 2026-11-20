<script setup lang="ts">
// W0-09: "Voltar a herdar" no parâmetro hierárquico. Cada sobreposição em vigor (nível e alvo com valor) pode ser
// retirada com justificativa (10 caracteres ou mais) e, no parâmetro crítico, a senha; o nível e o alvo voltam a
// herdar do nível acima e o cache é invalidado. As versões ficam visíveis, com quem retirou e o motivo (a trilha do
// valor anterior não se apaga).
import type { ParametroNovoDescrito } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarVersoesParametro, retirarParametro } from '../api-m08.js';

const props = defineProps<{ parametro: ParametroNovoDescrito }>();
const emit = defineEmits<{ feito: [atrasoMs: number] }>();
const { t } = useI18n();
const podeEditar = computed(() => pode('config.parametro.editar'));
const versoes = useQuery({
  queryKey: ['parametros', 'versoes', props.parametro.chave],
  queryFn: () => buscarVersoesParametro(props.parametro.chave),
});

/** As sobreposições em vigor: os passos com valor, fora o padrão do sistema. */
const sobreposicoes = computed(() =>
  props.parametro.explicacao.passos.filter(
    (x) =>
      x.nivel !== 'padrao' &&
      x.alvo !== null &&
      x.valor !== null &&
      (x.situacao === 'vale' || x.situacao === 'sobreposto' || x.situacao === 'conflito'),
  ),
);
const id = (nivel: string, alvo: string | null) => `${props.parametro.chave}-${nivel}-${alvo ?? ''}`;

const alvo = ref<{ nivel: string; alvo: string } | null>(null);
const pedido = reactive({ justificativa: '', senha: '' });
const falta = ref('');
const recusa = ref('');
const ocupado = ref(false);

function abrir(nivel: string, a: string): void {
  alvo.value = { nivel, alvo: a };
  pedido.justificativa = '';
  pedido.senha = '';
  falta.value = '';
  recusa.value = '';
}

async function confirmar(): Promise<void> {
  if (!alvo.value || ocupado.value) return;
  falta.value = '';
  recusa.value = '';
  if (pedido.justificativa.trim().length < 10) falta.value = t('parametros.herdar.justificativaCurta');
  else if (props.parametro.critico && !pedido.senha) falta.value = t('parametros.herdar.senhaObrigatoria');
  if (falta.value) return;
  ocupado.value = true;
  try {
    const r = await retirarParametro(props.parametro.chave, {
      nivel: alvo.value.nivel,
      alvo: alvo.value.alvo,
      justificativa: pedido.justificativa.trim(),
      ...(props.parametro.critico ? { senha: pedido.senha } : {}),
    });
    alvo.value = null;
    await versoes.refetch();
    emit('feito', r.atrasoInvalidacaoMs);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) recusa.value = t('parametros.herdar.senhaIncorreta');
    else if (e instanceof ErroApi && e.problema?.detail) recusa.value = e.problema.detail;
    else recusa.value = t('parametros.herdar.erro');
  } finally {
    pedido.senha = '';
    ocupado.value = false;
  }
}
const dia = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '—');
</script>

<template>
  <div class="heranca" :data-testid="`heranca-${props.parametro.chave}`">
    <ul v-if="podeEditar && sobreposicoes.length > 0" class="sobreposicoes">
      <li v-for="x in sobreposicoes" :key="id(x.nivel, x.alvo)">
        {{ t(`parametros.niveis.${x.nivel}`) }} ({{ x.alvo }}): {{ x.valor }}
        <SanteBotao
          :rotulo="t('parametros.herdar.botao')"
          variante="texto"
          :data-testid="`herdar-${id(x.nivel, x.alvo)}`"
          @acionar="abrir(x.nivel, x.alvo ?? '')"
        />
      </li>
    </ul>
    <form v-if="alvo" class="form" data-testid="form-herdar" @submit.prevent="confirmar">
      <p>
        {{
          t('parametros.herdar.texto', {
            nivel: t(`parametros.niveis.${alvo.nivel}`),
            alvo: alvo.alvo,
          })
        }}
      </p>
      <label class="campo">
        <span>{{ t('parametros.justificativa') }}</span>
        <textarea
          v-model="pedido.justificativa"
          rows="2"
          maxlength="400"
          required
          data-testid="herdar-justificativa"
        />
      </label>
      <label v-if="props.parametro.critico" class="campo">
        <span>{{ t('parametros.senha') }}</span>
        <input
          v-model="pedido.senha"
          type="password"
          autocomplete="current-password"
          required
          data-testid="herdar-senha"
        />
      </label>
      <p v-if="falta" role="alert" data-testid="herdar-falta">{{ falta }}</p>
      <p v-if="recusa" role="alert" data-testid="herdar-recusa">{{ recusa }}</p>
      <div class="botoes">
        <SanteBotao
          :rotulo="t('parametros.herdar.confirmar')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="herdar-confirmar"
        />
        <SanteBotao :rotulo="t('dominios.cancelar')" variante="texto" @acionar="alvo = null" />
      </div>
    </form>
    <table v-if="(versoes.data.value ?? []).length > 0" :data-testid="`versoes-${props.parametro.chave}`">
      <caption>
        {{
          t('parametros.herdar.versoes')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('parametros.nivel') }}</th>
          <th scope="col">{{ t('parametros.valor') }}</th>
          <th scope="col">{{ t('parametros.herdar.vigencia') }}</th>
          <th scope="col">{{ t('parametros.justificativa') }}</th>
          <th scope="col">{{ t('parametros.herdar.retirada') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in versoes.data.value" :key="v.id">
          <td>{{ t(`parametros.niveis.${v.nivel}`) }} ({{ v.alvo }})</td>
          <td>{{ v.valor }}</td>
          <td>{{ t('parametros.herdar.periodo', { de: dia(v.vigenteDesde), ate: dia(v.vigenteAte) }) }}</td>
          <td>{{ v.justificativa }} ({{ v.autor }})</td>
          <td :data-testid="`versao-retirada-${v.id}`">
            <template v-if="v.retiradaPor">{{ v.retiradaMotivo }} ({{ v.retiradaPor }})</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.heranca,
.form,
.campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
