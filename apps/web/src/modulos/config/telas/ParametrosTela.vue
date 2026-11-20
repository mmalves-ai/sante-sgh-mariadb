<script setup lang="ts">
// "Parâmetros hierárquicos por módulo" (M08; regras 7 e 8): os parâmetros do sistema NOVO, com o valor que
// vale para a sessão e "explicar valor" (de onde veio, o que foi sobreposto), e a definição de uma versão
// nova (nível permitido, alvo, justificativa; parâmetro crítico pede a senha); e os do sistema ATUAL como ele
// os vê (só leitura: coluna não declarada aparece "não interpretada", sem valor; credencial e dado pessoal,
// ocultos). Com `chave`, abre direto no parâmetro. W0-09: no "Explicar valor", cada sobreposição em vigor pode voltar
// a herdar (justificativa e, no crítico, a senha) e as versões mostram quem retirou e o motivo.
import type { ParametroNovoDescrito } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { buscarParametros, definirParametro } from '../api-m08.js';
import ParametrosBancoPainel from '../../administracao/componentes/ParametrosBancoPainel.vue';
import ParametroHeranca from '../componentes/ParametroHeranca.vue';
import VigiaReconciliacaoPainel from '../componentes/VigiaReconciliacaoPainel.vue';

const props = defineProps<{ chave?: string }>();
const { t } = useI18n();
const consulta = useQuery({ queryKey: ['parametros'], queryFn: () => buscarParametros() });
const novos = computed(() => consulta.data.value?.novos ?? []);
const legado = computed(() => consulta.data.value?.legado ?? []);
const aberto = ref<string | null>(props.chave ?? null);
const definindo = ref<ParametroNovoDescrito | null>(null);
const pedido = reactive({ nivel: '', alvo: '', valor: '', justificativa: '', senha: '' });
const opcoesNivel = computed(() =>
  (definindo.value?.niveis ?? []).map((n) => ({ valor: n, rotulo: t(`parametros.niveis.${n}`) })),
);
const opcoesValor = computed(() => (definindo.value?.opcoes ?? []).map((o) => ({ valor: o, rotulo: o })));
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);

function abrirDefinir(p: ParametroNovoDescrito): void {
  definindo.value = p;
  pedido.nivel = p.niveis.includes('estabelecimento') ? 'estabelecimento' : (p.niveis[0] ?? '');
  pedido.alvo = pedido.nivel === 'estabelecimento' ? (consulta.data.value?.estabelecimento ?? '') : '';
  pedido.valor = p.explicacao.valor;
  pedido.justificativa = '';
  pedido.senha = '';
  recusa.value = null;
  erro.value = null;
}

/** W0-09: a sobreposição retirada; o valor herdado vem na releitura do painel. */
async function voltouAHerdar(chave: string, ms: number): Promise<void> {
  mensagem.value = t('parametros.herdar.feito', { ms });
  aberto.value = chave;
  await consulta.refetch();
}

async function salvar(): Promise<void> {
  if (!definindo.value) return;
  recusa.value = null;
  erro.value = null;
  try {
    const r = await definirParametro(definindo.value.chave, {
      nivel: pedido.nivel,
      alvo: pedido.alvo,
      valor: String(pedido.valor),
      justificativa: pedido.justificativa,
      ...(definindo.value.critico ? { senha: pedido.senha } : {}),
    });
    mensagem.value = t('parametros.definido', { ms: r.atrasoInvalidacaoMs });
    aberto.value = definindo.value.chave;
    definindo.value = null;
    await consulta.refetch();
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && (e.status === 409 || e.status === 422))
      recusa.value = e.problema.detail;
    else erro.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="parametros-titulo">
    <h1 id="parametros-titulo">{{ t('parametros.titulo') }}</h1>
    <p>{{ t('parametros.texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="mensagem-parametro">{{ mensagem }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="consulta.data.value">
      <h2>{{ t('parametros.novos') }}</h2>
      <table data-testid="tabela-parametros-novos">
        <caption>
          {{
            t('parametros.novos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('parametros.chave') }}</th>
            <th scope="col">{{ t('parametros.valor') }}</th>
            <th scope="col">{{ t('parametros.origem') }}</th>
            <th scope="col">{{ t('dominios.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="p in novos" :key="p.chave">
            <tr :data-testid="`parametro-${p.chave}`">
              <th scope="row">
                <span>{{ p.descricao }}</span>
                <code class="chave">{{ p.chave }}</code>
              </th>
              <td>{{ p.explicacao.valor }}</td>
              <td>
                {{ t(`parametros.niveis.${p.explicacao.origem}`)
                }}<span v-if="p.explicacao.alvo">({{ p.explicacao.alvo }})</span>
              </td>
              <td class="acoes">
                <SanteBotao
                  :rotulo="t('parametros.explicar')"
                  variante="texto"
                  :data-testid="`explicar-${p.chave}`"
                  @acionar="aberto = aberto === p.chave ? null : p.chave"
                />
                <SanteBotao
                  :rotulo="t('parametros.definir')"
                  variante="secundario"
                  :data-testid="`definir-${p.chave}`"
                  @acionar="abrirDefinir(p)"
                />
              </td>
            </tr>
            <tr v-if="aberto === p.chave">
              <td colspan="4">
                <ol
                  class="passos"
                  :aria-label="t('parametros.passos')"
                  :data-testid="`explicacao-${p.chave}`"
                >
                  <li v-for="(x, i) in p.explicacao.passos" :key="i">
                    {{ t(`parametros.niveis.${x.nivel}`) }}<span v-if="x.alvo">({{ x.alvo }})</span>:
                    {{ x.valor ?? '' }} ({{ t(`parametros.situacoes.${x.situacao}`) }})
                  </li>
                </ol>
                <p v-if="p.explicacao.justificativa">
                  {{ t('parametros.justificativa') }}: {{ p.explicacao.justificativa }} ({{
                    p.explicacao.autor
                  }})
                </p>
                <ParametroHeranca :parametro="p" @feito="voltouAHerdar(p.chave, $event)" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <form v-if="definindo" class="form" data-testid="form-parametro" @submit.prevent="salvar">
        <h3>{{ t('parametros.definir') }}: {{ definindo.descricao }}</h3>
        <div class="campo">
          <SanteSelecao
            id="parametro-nivel"
            v-model="pedido.nivel"
            :rotulo="t('parametros.nivel')"
            :opcoes="opcoesNivel"
            data-testid="parametro-nivel"
          />
        </div>
        <div class="campo">
          <label for="parametro-alvo">{{ t('parametros.alvo') }}</label>
          <input
            id="parametro-alvo"
            v-model="pedido.alvo"
            required
            maxlength="40"
            data-testid="parametro-alvo"
          />
        </div>
        <div class="campo">
          <SanteSelecao
            v-if="definindo.opcoes"
            id="parametro-valor"
            v-model="pedido.valor"
            :rotulo="t('parametros.valor')"
            :opcoes="opcoesValor"
            data-testid="parametro-valor"
          />
          <template v-else>
            <label for="parametro-valor">{{ t('parametros.valor') }}</label>
            <input
              id="parametro-valor"
              v-model="pedido.valor"
              required
              :type="definindo.tipo === 'inteiro' ? 'number' : 'text'"
              :min="definindo.minimo"
              :max="definindo.maximo"
              data-testid="parametro-valor"
            />
          </template>
        </div>
        <SanteCampoTexto
          v-model="pedido.justificativa"
          :rotulo="t('parametros.justificativa')"
          :max-bytes="400"
          obrigatorio
          data-testid="parametro-justificativa"
        />
        <div v-if="definindo.critico" class="campo">
          <label for="parametro-senha">{{ t('parametros.senha') }}</label>
          <input
            id="parametro-senha"
            v-model="pedido.senha"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <p v-if="recusa" role="alert">{{ recusa }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
        <div class="botoes">
          <SanteBotao
            :rotulo="t('parametros.salvar')"
            variante="primario"
            tipo="submit"
            data-testid="parametro-salvar"
          />
          <SanteBotao :rotulo="t('dominios.cancelar')" variante="texto" @acionar="definindo = null" />
        </div>
      </form>
      <h2>{{ t('parametros.legado') }}</h2>
      <p>
        {{
          t('parametros.resumoLegado', {
            interpretadas: consulta.data.value.resumoLegado.interpretadas,
            naoInterpretadas: consulta.data.value.resumoLegado.naoInterpretadas,
            ocultas: consulta.data.value.resumoLegado.ocultas,
          })
        }}
      </p>
      <table data-testid="tabela-parametros-legado">
        <caption>
          {{
            t('parametros.legado')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('parametros.grupo') }}</th>
            <th scope="col">{{ t('parametros.campo') }}</th>
            <th scope="col">{{ t('parametros.valor') }}</th>
            <th scope="col">{{ t('parametros.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in legado.filter((x) => x.situacao !== 'nao-interpretada' && x.situacao !== 'oculta')"
            :key="`${p.grupo}.${p.campo}`"
          >
            <td>{{ t(`parametros.grupos.${p.grupo}`) }}</td>
            <td>
              <code>{{ p.campo }}</code>
            </td>
            <td>{{ p.valor ?? p.bruto ?? '' }}</td>
            <td>{{ t(`parametros.situacoes.${p.situacao}`) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
    <!-- Revisão do W0-02: o relatório da vigia de reconciliação dos cadastros (ligada pelo parâmetro acima). -->
    <VigiaReconciliacaoPainel />
    <!-- M10: os parâmetros gravados no banco, por módulo (só consulta). -->
    <ParametrosBancoPainel />
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: var(--sgh-espaco-3);
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.chave {
  display: block;
  font-family: var(--sgh-fonte-codigo);
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.acoes,
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
  margin-bottom: var(--sgh-espaco-3);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
