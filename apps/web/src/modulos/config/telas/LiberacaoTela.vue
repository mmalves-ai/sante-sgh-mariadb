<script setup lang="ts">
// "Funcionalidades por estabelecimento (feature flags)" (M08; POL-3; DP-4): cada recurso construído e
// desligado com descrição, estado, pré-requisitos e o que falta; as operações de gravação com o estado no
// catálogo. Ligar ou desligar por estabelecimento, setores, grupos ou pessoas numa ação só (lote reversível),
// com justificativa e a senha de novo (crítica); registrar pré-requisito (situação, validade e a referência da
// evidência, nunca o segredo). O servidor recusa ligar com pré-requisito pendente e diz o que falta.
import type { FuncionalidadeDescrita } from '@sgh/contratos';
import { ESCOPOS_LIBERACAO, SITUACOES_PREREQUISITO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { aplicarLiberacao, buscarLiberacao, registrarPrerequisito, reverterLote } from '../api-m08.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['liberacao'], queryFn: () => buscarLiberacao() });
const recursos = computed(() =>
  (consulta.data.value?.funcionalidades ?? []).filter((f) => f.tipo === 'recurso'),
);
const operacoes = computed(() =>
  (consulta.data.value?.funcionalidades ?? []).filter((f) => f.tipo === 'operacao'),
);

const alvo = ref<FuncionalidadeDescrita | null>(null);
const pedido = reactive({
  ligar: true,
  escopo: 'hospital' as (typeof ESCOPOS_LIBERACAO)[number],
  valores: '*',
  justificativa: '',
  senha: '',
  referenciaAutorizacao: '',
});
const prereq = reactive({
  tipo: '',
  situacao: 'cumprido',
  validade: '',
  evidencia: '',
  referenciaAutorizacao: '',
  senha: '',
});
const opcoesEscopo = computed(() =>
  ESCOPOS_LIBERACAO.map((e) => ({ valor: e, rotulo: t(`liberacao.escopos.${e}`) })),
);
const opcoesPrereqTipo = computed(() =>
  (alvo.value?.prerequisitos ?? []).map((p) => ({ valor: p.tipo, rotulo: p.descricao })),
);
const opcoesSituacao = computed(() =>
  SITUACOES_PREREQUISITO.map((s) => ({ valor: s, rotulo: t(`liberacao.situacoes.${s}`) })),
);
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const ultimoLote = ref<string | null>(null);

function abrir(f: FuncionalidadeDescrita): void {
  alvo.value = f;
  pedido.ligar = !f.ligadaNoEstabelecimento;
  pedido.escopo = 'hospital';
  pedido.valores = '*';
  pedido.justificativa = '';
  pedido.senha = '';
  pedido.referenciaAutorizacao = '';
  prereq.tipo = f.prerequisitos.find((p) => p.falta)?.tipo ?? f.prerequisitos[0]?.tipo ?? '';
  prereq.situacao = 'cumprido';
  prereq.validade = '';
  prereq.evidencia = '';
  prereq.referenciaAutorizacao = '';
  prereq.senha = '';
  recusa.value = null;
  erro.value = null;
}

function tratar(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && (e.status === 409 || e.status === 400))
    recusa.value = e.problema.detail;
  else erro.value = e;
}

async function aplicar(): Promise<void> {
  if (!alvo.value) return;
  recusa.value = null;
  erro.value = null;
  try {
    const r = await aplicarLiberacao({
      chave: alvo.value.chave,
      tipo: alvo.value.tipo,
      escopo: pedido.escopo,
      valores: pedido.valores
        .split(/[\n,;]+/)
        .map((v) => v.trim())
        .filter(Boolean),
      ligar: pedido.ligar,
      justificativa: pedido.justificativa,
      senha: pedido.senha,
      ...(pedido.referenciaAutorizacao.trim()
        ? { referenciaAutorizacao: pedido.referenciaAutorizacao.trim() }
        : {}),
    });
    ultimoLote.value = r.lote || null;
    mensagem.value =
      t('liberacao.aplicado', { lote: r.lote, n: r.alteradas }) +
      (r.destino === 'memoria' ? ` ${t('liberacao.memoria')}` : '');
    pedido.senha = '';
    await consulta.refetch();
  } catch (e) {
    tratar(e);
  }
}

async function reverter(): Promise<void> {
  if (!ultimoLote.value) return;
  try {
    const r = await reverterLote(
      ultimoLote.value,
      pedido.justificativa || 'reversão do lote pela tela',
      pedido.senha,
      pedido.referenciaAutorizacao.trim() || undefined,
    );
    mensagem.value = t('liberacao.revertido', { n: r.alteradas });
    ultimoLote.value = null;
    await consulta.refetch();
  } catch (e) {
    tratar(e);
  }
}

async function registrar(): Promise<void> {
  if (!alvo.value) return;
  recusa.value = null;
  erro.value = null;
  try {
    await registrarPrerequisito({
      recurso: alvo.value.chave,
      tipo: prereq.tipo,
      situacao: prereq.situacao,
      validade: prereq.validade || null,
      evidencia: prereq.evidencia || null,
      ...(prereq.referenciaAutorizacao.trim()
        ? { referenciaAutorizacao: prereq.referenciaAutorizacao.trim() }
        : {}),
      senha: prereq.senha,
    });
    mensagem.value = t('liberacao.registrado');
    prereq.senha = '';
    await consulta.refetch();
    alvo.value = consulta.data.value?.funcionalidades.find((f) => f.chave === alvo.value?.chave) ?? null;
  } catch (e) {
    tratar(e);
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="liberacao-titulo">
    <h1 id="liberacao-titulo">{{ t('liberacao.titulo') }}</h1>
    <p>{{ t('liberacao.texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="mensagem-liberacao">{{ mensagem }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="consulta.data.value">
      <h2>{{ t('liberacao.recursos') }}</h2>
      <ul class="cartoes">
        <li v-for="f in recursos" :key="f.chave" class="cartao" :data-testid="`recurso-${f.chave}`">
          <h3>{{ f.titulo }}</h3>
          <p>{{ f.descricao }}</p>
          <p>
            {{ t('liberacao.estado') }}:
            <strong>{{
              f.ligadaNoEstabelecimento ? t('liberacao.ligada') : t('liberacao.desligada')
            }}</strong>
            · {{ t('liberacao.marco', { marco: f.marco ?? '' }) }}
          </p>
          <p v-if="f.prerequisitos.length === 0">{{ t('liberacao.semPrerequisito') }}</p>
          <ul v-else>
            <li v-for="p in f.prerequisitos" :key="p.tipo">
              {{ t(`liberacao.tipos.${p.tipo}`) }}: {{ p.descricao }} —
              {{ p.falta ? `${t('liberacao.falta')} (${p.motivo})` : t('liberacao.cumprido') }}
            </li>
          </ul>
          <SanteAlerta v-if="f.motivoBloqueio" :texto="f.motivoBloqueio" variante="aviso" />
          <SanteBotao
            :rotulo="f.ligadaNoEstabelecimento ? t('liberacao.desligar') : t('liberacao.ligar')"
            variante="secundario"
            :data-testid="`abrir-${f.chave}`"
            @acionar="abrir(f)"
          />
        </li>
      </ul>
      <h2>{{ t('liberacao.operacoes') }}</h2>
      <table data-testid="tabela-operacoes-liberacao">
        <caption>
          {{
            t('liberacao.operacoes')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('parametros.chave') }}</th>
            <th scope="col">{{ t('liberacao.estado') }}</th>
            <th scope="col">{{ t('liberacao.chaves') }}</th>
            <th scope="col">{{ t('dominios.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in operacoes" :key="f.chave" :data-testid="`operacao-${f.chave}`">
            <th scope="row">
              <code>{{ f.chave }}</code>
              <!-- M41 (regra 1): a dispensação e a entrega dizem antes por que ainda não podem ligar. -->
              <SanteAlerta
                v-if="f.motivoBloqueio"
                :texto="f.motivoBloqueio"
                variante="aviso"
                data-testid="bloqueio-operacao"
              />
            </th>
            <td>{{ t('liberacao.estadoCatalogo', { estado: f.estadoCatalogo ?? '' }) }}</td>
            <td>{{ f.chaves.filter((c) => c.ligada).length }}</td>
            <td><SanteBotao :rotulo="t('liberacao.ligar')" variante="texto" @acionar="abrir(f)" /></td>
          </tr>
        </tbody>
      </table>
      <section v-if="alvo" class="form" aria-labelledby="liberacao-acao" data-testid="form-liberacao">
        <h2 id="liberacao-acao">{{ alvo.titulo }}</h2>
        <form class="form" @submit.prevent="aplicar">
          <fieldset>
            <legend>{{ t('liberacao.estado') }}</legend>
            <label
              ><input v-model="pedido.ligar" type="radio" :value="true" data-testid="opcao-ligar" />
              {{ t('liberacao.ligar') }}</label
            >
            <label
              ><input v-model="pedido.ligar" type="radio" :value="false" data-testid="opcao-desligar" />
              {{ t('liberacao.desligar') }}</label
            >
          </fieldset>
          <div class="campo">
            <SanteSelecao
              id="liberacao-escopo"
              v-model="pedido.escopo"
              :rotulo="t('liberacao.escopo')"
              :opcoes="opcoesEscopo"
              data-testid="liberacao-escopo"
              @update:model-value="(e) => (pedido.valores = e === 'hospital' ? '*' : '')"
            />
          </div>
          <div class="campo">
            <label for="liberacao-valores">{{ t('liberacao.valores') }}</label>
            <textarea
              id="liberacao-valores"
              v-model="pedido.valores"
              rows="3"
              data-testid="liberacao-valores"
            />
          </div>
          <SanteCampoTexto
            v-model="pedido.justificativa"
            :rotulo="t('liberacao.justificativa')"
            :max-bytes="200"
            obrigatorio
            data-testid="liberacao-justificativa"
          />
          <SanteCampoTexto
            v-model="pedido.referenciaAutorizacao"
            :rotulo="t('liberacao.referenciaAutorizacao')"
            :max-bytes="200"
            data-testid="liberacao-autorizacao"
          />
          <div class="campo">
            <label for="liberacao-senha">{{ t('liberacao.senha') }}</label>
            <input
              id="liberacao-senha"
              v-model="pedido.senha"
              type="password"
              autocomplete="current-password"
              required
              data-testid="liberacao-senha"
            />
          </div>
          <SanteAlerta
            v-if="recusa"
            :texto="recusa"
            variante="aviso"
            anunciar
            data-testid="recusa-liberacao"
          />
          <MensagemErro v-if="erro" :erro="erro" />
          <div class="botoes">
            <SanteBotao
              :rotulo="t('liberacao.aplicar')"
              variante="primario"
              tipo="submit"
              data-testid="liberacao-aplicar"
            />
            <SanteBotao
              v-if="ultimoLote"
              :rotulo="t('liberacao.reverter', { lote: ultimoLote })"
              variante="secundario"
              data-testid="liberacao-reverter"
              @acionar="reverter"
            />
          </div>
        </form>
        <form
          v-if="alvo.prerequisitos.length > 0"
          class="form"
          data-testid="form-prerequisito"
          @submit.prevent="registrar"
        >
          <h3>{{ t('liberacao.registrarPrerequisito') }}</h3>
          <div class="campo">
            <SanteSelecao
              id="prereq-tipo"
              v-model="prereq.tipo"
              :rotulo="t('liberacao.prerequisitos')"
              :opcoes="opcoesPrereqTipo"
            />
          </div>
          <div class="campo">
            <SanteSelecao
              id="prereq-situacao"
              v-model="prereq.situacao"
              :rotulo="t('liberacao.situacao')"
              :opcoes="opcoesSituacao"
            />
          </div>
          <div class="campo">
            <label for="prereq-validade">{{ t('liberacao.validade') }}</label>
            <input id="prereq-validade" v-model="prereq.validade" pattern="\d{4}-\d{2}-\d{2}" />
          </div>
          <SanteCampoTexto v-model="prereq.evidencia" :rotulo="t('liberacao.evidencia')" :max-bytes="200" />
          <SanteCampoTexto
            v-if="prereq.situacao === 'dispensado'"
            v-model="prereq.referenciaAutorizacao"
            :rotulo="t('liberacao.referenciaAutorizacao')"
            :max-bytes="200"
            obrigatorio
          />
          <div class="campo">
            <label for="prereq-senha">{{ t('liberacao.senha') }}</label>
            <input
              id="prereq-senha"
              v-model="prereq.senha"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <SanteBotao :rotulo="t('liberacao.registrarPrerequisito')" variante="secundario" tipo="submit" />
        </form>
      </section>
    </template>
  </section>
</template>

<style scoped>
.cartoes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: var(--sgh-espaco-2);
  padding: 0;
  list-style: none;
}
.cartao {
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-elevado);
  padding: var(--sgh-espaco-2);
}
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
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
  margin: var(--sgh-espaco-2) 0;
}
.botoes {
  display: flex;
  gap: var(--sgh-espaco-2);
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
