<script setup lang="ts">
// Geração das mensalidades da competência (M56, etapa 3, F2): a prévia (nada é gravado) com as cobranças, os itens por
// beneficiário (faixa, idade, preço da tabela e o valor reajustado) e os contratos que ficam de fora com o motivo; a
// geração, com a confirmação, não repete a mensalidade já gerada.
import { MENSAGENS_COBRANCA, type PreviaMensalidades, type TelaCobranca } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gerarMensalidades, previaMensalidades } from '../../api-cobranca.js';
import ErroOperadora from '../f1/ErroOperadora.vue';
import { competenciaBr, competenciaDe, dataBr, reais, brl } from './comum.js';
import SeletorContrato from './SeletorContrato.vue';

const props = defineProps<{ tela: TelaCobranca; operadora: number }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const competencia = ref(props.tela.hoje ? competenciaDe(props.tela.hoje, 1) : '');
const contrato = ref<number | null>(null);
const previa = ref<PreviaMensalidades | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const corpo = () => ({
  operadora: props.operadora,
  competencia: competencia.value.trim(),
  contrato: contrato.value,
});

async function verPrevia(): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    previa.value = await previaMensalidades(corpo());
  } catch (e) {
    erro.value = e;
    previa.value = null;
  } finally {
    ocupado.value = false;
  }
}

async function gerar(): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await gerarMensalidades(corpo());
    mensagem.value = r.mensagem;
    previa.value = null;
    await cliente.invalidateQueries({ queryKey: ['operadora', 'cobrancas'] });
    emit('mudou');
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ope-mensalidades-titulo" data-testid="operadora-mensalidades">
    <h2 id="ope-mensalidades-titulo">{{ t('operadoraCobranca.mensalidades.titulo') }}</h2>
    <p>{{ t('operadoraCobranca.mensalidades.texto') }}</p>
    <form class="campos" @submit.prevent="verPrevia">
      <SanteCampoTexto
        v-model="competencia"
        :rotulo="t('operadoraCobranca.mensalidades.competencia')"
        :max-bytes="7"
        obrigatorio
      />
    </form>
    <SeletorContrato
      v-model="contrato"
      :operadora="operadora"
      :rotulo="t('operadoraCobranca.mensalidades.contrato')"
      :vazio="t('operadoraCobranca.mensalidades.todos')"
      testid="mensalidades-contrato"
    />
    <div class="acoes">
      <SanteBotao
        :rotulo="t('operadoraCobranca.mensalidades.previa')"
        variante="secundario"
        :desabilitado="ocupado"
        data-testid="mensalidades-previa"
        @acionar="verPrevia"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="mensagem-mensalidades">{{ mensagem }}</p>
    <ErroOperadora v-if="erro" :erro="erro" />
    <template v-if="previa">
      <p data-testid="previa-resumo">
        {{ competenciaBr(previa.competencia) }}:
        {{
          t('operadoraCobranca.mensalidades.resumo', {
            n: previa.quantidade,
            valor: reais(previa.valorTotal),
            ja: previa.jaGeradas,
          })
        }}
        <span v-if="previa.cobrancas.length < previa.quantidade">
          {{ t('operadoraCobranca.mensalidades.mostrando', { n: previa.cobrancas.length }) }}
        </span>
      </p>
      <table v-if="previa.cobrancas.length" class="tabela" data-testid="tabela-previa">
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraCobranca.colunas.contrato') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.pagador') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.vencimento') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.beneficiario') }}</th>
            <th scope="col">{{ t('operadoraCobranca.colunas.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in previa.cobrancas" :key="c.contrato" :data-testid="`previa-${c.contratoNumero}`">
            <th scope="row">{{ c.contratoNumero }}</th>
            <td>{{ c.pagadorNome }}</td>
            <td>{{ dataBr(c.vencimento) }}</td>
            <td>
              <ul>
                <li v-for="i in c.itens" :key="i.beneficiario">
                  {{
                    t('operadoraCobranca.mensalidades.item', {
                      nome: i.nome,
                      idade: i.idade,
                      tabela: brl(i.valorTabela),
                      valor: brl(i.valor),
                    })
                  }}
                </li>
              </ul>
            </td>
            <td>{{ brl(c.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <template v-if="previa.ignorados.length">
        <h3>{{ t('operadoraCobranca.mensalidades.ignorados') }}</h3>
        <ul data-testid="previa-ignorados">
          <li v-for="i in previa.ignorados" :key="i.contrato">
            {{ i.contratoNumero }}: {{ MENSAGENS_COBRANCA[i.motivo] ?? i.motivo }}
          </li>
        </ul>
      </template>
      <div v-if="tela.acoes.gerar && previa.quantidade > 0" class="acoes">
        <SanteBotao
          :rotulo="t('operadoraCobranca.mensalidades.gerar')"
          variante="destrutivo"
          :confirmacao="t('operadoraCobranca.mensalidades.confirmarGerar')"
          :desabilitado="ocupado"
          data-testid="mensalidades-gerar"
          @acionar="gerar"
        />
      </div>
    </template>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
