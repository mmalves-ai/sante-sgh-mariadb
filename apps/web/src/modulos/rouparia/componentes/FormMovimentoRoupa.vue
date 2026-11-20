<script setup lang="ts">
// Registrar um movimento da rouparia: coleta pesada no setor, envio à lavanderia (própria ou terceirizada, com o
// fornecedor), retorno conferido com o envio (a prévia da diferença de peso e das peças faltando, com a ocorrência),
// entrega de roupa limpa, perda com o motivo e inventário. Mostra só os campos que o movimento pede; a mesma
// conferência do servidor roda antes de gravar. Usado no painel do dia e na versão para celular.
import type { DetalheMovimentoRoupa, PainelRouparia, TipoMovimentoRoupa } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarFornecedoresRouparia,
  lerMovimentoRoupa,
  novaChaveRouparia,
  registrarMovimentoRoupa,
} from '../api-rouparia.js';
import {
  camposDoTipo,
  dataCurta,
  fmtKg,
  fmtNumero,
  formVazio,
  montarMovimento,
  nomeDe,
  previaRetorno,
} from '../regras-rouparia.js';
import { CHAVE_PAINEL_ROUPARIA, OPCOES_LAVANDERIA, OPCOES_MOTIVO, OPCOES_TIPO } from '../usar-rouparia.js';
import ErroRouparia from './ErroRouparia.vue';

const props = withDefaults(
  defineProps<{
    painel: PainelRouparia;
    /** Os movimentos oferecidos (o celular só coleta e entrega). */
    tipos?: readonly TipoMovimentoRoupa[] | undefined;
    /** O envio a retornar, escolhido no painel. */
    remessa?: number | null;
    prefixo?: string;
  }>(),
  { tipos: undefined, remessa: null, prefixo: 'rouparia' },
);
const emit = defineEmits<{ gravado: [mensagem: string] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const opcoesTipo = computed(() =>
  props.tipos ? OPCOES_TIPO.filter((o) => props.tipos!.includes(o.valor)) : OPCOES_TIPO,
);
const f = reactive(formVazio(opcoesTipo.value[0]?.valor ?? 'coleta', props.painel.hoje));
const campos = computed(() => camposDoTipo(f.tipo));
const opcoesSetor = computed(() =>
  props.painel.setores.map((s) => ({ valor: s.codigo, rotulo: `${s.nome} (${s.codigo})` })),
);
const opcoesPeca = computed(() =>
  props.painel.pecas.filter((p) => p.ativa).map((p) => ({ valor: p.id, rotulo: p.nome })),
);
const opcoesRemessa = computed(() =>
  props.painel.enviosAbertos.map((e) => ({
    valor: e.id,
    rotulo: t('rouparia.detalhe.envio', { data: dataCurta(e.data), peso: fmtKg(e.pesoKg), pecas: e.pecas }),
  })),
);

watch(
  () => props.remessa,
  (r) => {
    if (r !== null && r !== undefined && opcoesTipo.value.some((o) => o.valor === 'retorno')) {
      f.tipo = 'retorno';
      f.remessa = r;
    }
  },
  { immediate: true },
);

// O envio escolhido no retorno (com as peças, para a prévia da conferência).
const envio = ref<DetalheMovimentoRoupa['movimento'] | null>(null);
watch(
  () => (campos.value.remessa ? f.remessa : null),
  async (id) => {
    envio.value = null;
    if (id === null) return;
    try {
      envio.value = (await lerMovimentoRoupa(id)).movimento;
    } catch {
      envio.value = null;
    }
  },
  { immediate: true },
);
const previa = computed(() =>
  campos.value.remessa ? previaRetorno(envio.value, f, props.painel.parametros.toleranciaPct) : null,
);

// Fornecedor da lavanderia terceirizada (busca no cadastro).
const termoFornecedor = ref('');
const fornecedores = ref<{ valor: number; rotulo: string }[]>([]);
async function pesquisarFornecedor(): Promise<void> {
  const r = await buscarFornecedoresRouparia(termoFornecedor.value.trim());
  fornecedores.value = r.itens.map((x) => ({ valor: x.codigo, rotulo: `${x.nome} (${x.codigo})` }));
}

function adicionarLinha(): void {
  f.linhas.push({ peca: null, quantidade: '' });
}
function removerLinha(i: number): void {
  f.linhas.splice(i, 1);
  if (f.linhas.length === 0) adicionarLinha();
}

const chave = ref(novaChaveRouparia('movimento'));
const avisos = ref<readonly string[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
// Mudou o movimento: é outra intenção de gravar (nova chave).
watch(
  () => [f.tipo, f.centroCusto, f.data, f.remessa],
  () => {
    chave.value = novaChaveRouparia('movimento');
  },
);

async function registrar(): Promise<void> {
  erro.value = null;
  avisos.value = [];
  mensagem.value = null;
  const m = montarMovimento(f, chave.value, {
    hoje: props.painel.hoje,
    pecas: props.painel.pecas,
    setores: props.painel.setores,
    remessa: envio.value,
  });
  if (!m.ok) {
    avisos.value = m.mensagens;
    return;
  }
  ocupado.value = true;
  try {
    const r = await registrarMovimentoRoupa(m.corpo);
    mensagem.value = r.mensagem;
    const tipo = f.tipo;
    Object.assign(f, formVazio(tipo, props.painel.hoje));
    chave.value = novaChaveRouparia('movimento');
    await cliente.invalidateQueries({ queryKey: ['rouparia'] });
    await cliente.invalidateQueries({ queryKey: CHAVE_PAINEL_ROUPARIA });
    emit('gravado', r.mensagem);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const id = (s: string) => `${props.prefixo}-${s}`;
</script>

<template>
  <form class="formulario" :data-testid="`${prefixo}-form`" @submit.prevent="registrar">
    <SanteAlerta
      v-if="mensagem"
      variante="info"
      :texto="mensagem"
      anunciar
      :data-testid="`${prefixo}-mensagem`"
    />
    <div class="grade">
      <SanteSelecao
        v-model="f.tipo"
        :rotulo="t('rouparia.campos.tipo')"
        :opcoes="opcoesTipo"
        obrigatorio
        :data-testid="`${prefixo}-tipo`"
      />
      <SanteData v-model="f.data" :rotulo="t('rouparia.campos.data')" editavel />
      <SanteSelecao
        v-if="campos.setor"
        v-model="f.centroCusto"
        :rotulo="t('rouparia.campos.setor')"
        :opcoes="opcoesSetor"
        :obrigatorio="campos.setorObrigatorio"
        busca
        :data-testid="`${prefixo}-setor`"
      />
      <div class="campo">
        <label :for="id('peso')">{{
          campos.pesoObrigatorio ? t('rouparia.campos.peso') : t('rouparia.campos.pesoOpcional')
        }}</label>
        <input
          :id="id('peso')"
          v-model="f.peso"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          :required="campos.pesoObrigatorio"
          :data-testid="`${prefixo}-peso`"
        />
      </div>
    </div>

    <div v-if="campos.remessa" class="grade">
      <p v-if="opcoesRemessa.length === 0" class="secundario">{{ t('rouparia.form.semEnvios') }}</p>
      <SanteSelecao
        v-else
        v-model="f.remessa"
        :rotulo="t('rouparia.campos.remessa')"
        :opcoes="opcoesRemessa"
        obrigatorio
        busca
        :data-testid="`${prefixo}-remessa`"
      />
    </div>

    <div v-if="campos.lavanderia" class="grade">
      <SanteSelecao
        v-model="f.lavanderia"
        :rotulo="t('rouparia.campos.lavanderia')"
        :opcoes="OPCOES_LAVANDERIA"
        obrigatorio
        :data-testid="`${prefixo}-lavanderia`"
      />
      <template v-if="f.lavanderia === 'terceirizada'">
        <SanteCampoTexto
          v-model="termoFornecedor"
          :rotulo="t('rouparia.campos.buscarFornecedor')"
          :max-bytes="60"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('rouparia.campos.pesquisar')"
          :data-testid="`${prefixo}-pesquisar-fornecedor`"
          @click="pesquisarFornecedor"
        />
        <SanteSelecao
          v-model="f.fornecedor"
          :rotulo="t('rouparia.campos.fornecedor')"
          :opcoes="fornecedores"
          obrigatorio
          busca
          :data-testid="`${prefixo}-fornecedor`"
        />
      </template>
    </div>

    <SanteSelecao
      v-if="campos.motivo"
      v-model="f.motivoPerda"
      :rotulo="t('rouparia.campos.motivoPerda')"
      :opcoes="OPCOES_MOTIVO"
      obrigatorio
      :data-testid="`${prefixo}-motivo`"
    />

    <fieldset class="itens">
      <legend>{{ t('rouparia.campos.pecas') }}</legend>
      <p v-if="f.tipo === 'coleta'" class="secundario">{{ t('rouparia.form.pecasDica') }}</p>
      <div v-for="(l, i) in f.linhas" :key="i" class="linha-peca" :data-testid="`${prefixo}-linha-${i}`">
        <SanteSelecao
          v-model="l.peca"
          :rotulo="`${t('rouparia.campos.peca')} ${i + 1}`"
          :opcoes="opcoesPeca"
          busca
          :data-testid="`${prefixo}-peca-${i}`"
        />
        <div class="campo">
          <label :for="id(`qtd-${i}`)">{{ t('rouparia.campos.quantidade') }} {{ i + 1 }}</label>
          <input
            :id="id(`qtd-${i}`)"
            v-model="l.quantidade"
            type="number"
            min="0"
            max="99999"
            :data-testid="`${prefixo}-qtd-${i}`"
          />
        </div>
        <SanteBotao
          variante="texto"
          :rotulo="t('rouparia.form.removerPeca', { n: i + 1 })"
          @click="removerLinha(i)"
        />
      </div>
      <SanteBotao
        variante="secundario"
        :rotulo="t('rouparia.form.adicionarPeca')"
        :data-testid="`${prefixo}-adicionar-peca`"
        @click="adicionarLinha"
      />
    </fieldset>

    <section
      v-if="previa"
      class="painel"
      :data-testid="`${prefixo}-previa`"
      :data-ocorrencia="previa.ocorrencia"
    >
      <h3>{{ t('rouparia.form.previa') }}</h3>
      <p>
        {{
          t('rouparia.form.previaConta', {
            enviado: fmtKg(previa.pesoEnviadoKg),
            retornado: fmtKg(previa.pesoRetornadoKg),
            diferenca: fmtKg(previa.diferencaKg),
            pct: fmtNumero(previa.diferencaPct),
            tol: fmtNumero(previa.toleranciaPct),
          })
        }}
      </p>
      <ul v-if="previa.pecasFaltando.length" class="lista-simples">
        <li v-for="x in previa.pecasFaltando" :key="x.peca">
          {{
            t('rouparia.form.faltando', {
              peca: nomeDe(painel.pecas, (p) => p.id, x.peca),
              enviadas: x.enviadas,
              retornadas: x.retornadas,
              faltam: x.faltam,
            })
          }}
        </li>
      </ul>
      <p :class="previa.ocorrencia ? 'alerta-texto' : 'secundario'">
        {{ previa.ocorrencia ? t('rouparia.form.previaOcorrencia') : t('rouparia.form.previaOk') }}
      </p>
    </section>

    <SanteCampoTexto v-model="f.observacao" :rotulo="t('rouparia.campos.observacao')" :max-bytes="200" />
    <ErroRouparia :erro="erro" :mensagens="avisos" />
    <SanteBotao
      tipo="submit"
      :rotulo="t('rouparia.form.registrar')"
      :desabilitado="ocupado"
      :data-testid="`${prefixo}-gravar`"
    />
  </form>
</template>

<style scoped>
.linha-peca {
  display: grid;
  grid-template-columns: minmax(12rem, 2fr) minmax(6rem, 1fr) auto;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
@media (max-width: 40rem) {
  .linha-peca {
    grid-template-columns: 1fr;
  }
}
</style>
