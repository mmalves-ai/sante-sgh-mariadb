<script setup lang="ts">
// Agregação de valor na ficha do bem (F8, 07-FIN linha 149; CPC 27 / NBC TG 27): melhoria, componente (outro bem
// incorporado), serviço ou outro gasto que aumenta a vida útil ou a capacidade soma ao custo e entra na base da
// depreciação da competência seguinte. A retirada (desagregação) vale dali em diante, com data e motivo: nada se apaga,
// e a linha retirada segue na lista. O servidor confere a permissão e a regra de novo.
import type { BemPatrimonial } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AgregacaoLida,
  agregar,
  lerAgregacoes,
  retirarAgregacao,
  TIPOS_AGREGACAO,
} from './api-complementos.js';
import BuscaBem from './BuscaBem.vue';
import { centavosOuZero, dataBr, hojeLocal, reais } from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

const props = defineProps<{ bem: BemPatrimonial; podeAgregar: boolean; hoje?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const hoje = computed(() => props.hoje ?? hojeLocal());
const K = 'patrimonio.complementos';

const consulta = useQuery({
  queryKey: computed(() => ['patrimonio', 'agregacoes', props.bem.id]),
  queryFn: () => lerAgregacoes(props.bem.id),
  retry: false,
});
const dados = computed(() => consulta.data.value ?? null);
const lista = computed(() => [...(dados.value?.agregacoes ?? [])].sort((a, b) => b.sequencia - a.sequencia));
const podeGravar = computed(() => props.podeAgregar && props.bem.situacao !== 'baixado');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

async function atualizar() {
  await cliente.invalidateQueries({ queryKey: ['patrimonio', 'agregacoes', props.bem.id] });
  await cliente.invalidateQueries({ queryKey: ['patrimonio', 'bem', props.bem.id] });
}

// ── Registrar ──
const registrando = ref(false);
const vazio = () => ({
  tipo: 'melhoria' as (typeof TIPOS_AGREGACAO)[number],
  componente: null as number | null,
  documento: '',
  descricao: '',
  data: hoje.value,
  valor: '',
  agregaValor: 'sim',
});
const r = ref(vazio());
const opcoesTipo = TIPOS_AGREGACAO.map((x) => ({ valor: x, rotulo: t(`${K}.agregacao.tipos.${x}`) }));
const opcoesSimNao = [
  { valor: 'sim', rotulo: t(`${K}.sim`) },
  { valor: 'nao', rotulo: t(`${K}.nao`) },
];
const valorCent = computed(() => (r.value.valor.trim() === '' ? 0 : centavosOuZero(r.value.valor)));
const problemas = computed(() => {
  const p: string[] = [];
  const x = r.value;
  if (x.tipo === 'componente' && x.componente === null) p.push('componente');
  if (x.descricao.trim().length < 5) p.push('descricao');
  if (x.data === '' || x.data > hoje.value) p.push('data');
  if (valorCent.value === null || (x.agregaValor === 'sim' && valorCent.value <= 0)) p.push('valor');
  return p;
});
async function registrar() {
  const d = dados.value;
  if (!d || problemas.value.length > 0) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const x = r.value;
    await agregar(props.bem.id, {
      versao: d.versaoBem,
      tipo: x.tipo,
      bemAgregado: x.tipo === 'componente' ? x.componente : null,
      numeroDocumento: x.documento.trim() || null,
      descricao: x.descricao.trim(),
      data: x.data,
      valorCent: valorCent.value ?? 0,
      agregaValor: x.agregaValor === 'sim',
      conta: null,
      observacao: null,
    });
    mensagem.value = t(`${K}.agregacao.gravada`);
    registrando.value = false;
    r.value = vazio();
    await atualizar();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Retirar ──
const retirando = ref<AgregacaoLida | null>(null);
const retirada = ref({ data: '', motivo: '' });
const retiradaPronta = computed(
  () =>
    retirada.value.data !== '' &&
    retirada.value.data <= hoje.value &&
    retirada.value.motivo.trim().length >= 5,
);
function abrirRetirada(a: AgregacaoLida) {
  retirando.value = a;
  retirada.value = { data: hoje.value, motivo: '' };
  mensagem.value = null;
  erro.value = null;
}
async function retirar() {
  const a = retirando.value;
  if (!a || !retiradaPronta.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    await retirarAgregacao(a.id, {
      versao: a.versao,
      data: retirada.value.data,
      motivo: retirada.value.motivo.trim(),
    });
    mensagem.value = t(`${K}.agregacao.retiradaOk`);
    retirando.value = null;
    await atualizar();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="agregacoes-titulo" data-testid="agregacoes-bem">
    <h3 id="agregacoes-titulo">{{ t(`${K}.agregacao.titulo`) }}</h3>
    <p class="secundario">{{ t(`${K}.agregacao.ajuda`) }}</p>
    <p v-if="dados" data-testid="agregacoes-custo">
      {{
        t(`${K}.agregacao.custo`, {
          custo: reais(dados.custoCent),
          agregado: reais(dados.agregadoVigenteCent),
        })
      }}
    </p>
    <p v-if="mensagem" role="status" class="ok" data-testid="agregacoes-mensagem">{{ mensagem }}</p>
    <ErroPatrimonio v-if="erro" :erro="erro" escopo="complementos" />
    <p v-if="!podeAgregar" class="secundario">{{ t(`${K}.semPermissao`) }}</p>
    <div v-else-if="podeGravar && !registrando" class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="t(`${K}.agregacao.registrar`)"
        data-testid="agregacoes-registrar"
        @acionar="
          registrando = true;
          retirando = null;
          mensagem = null;
          erro = null;
        "
      />
    </div>
    <form v-if="registrando" class="bloco" data-testid="agregacoes-form" @submit.prevent="registrar">
      <h4>{{ t(`${K}.agregacao.registrar`) }}</h4>
      <div class="campos">
        <SanteSelecao
          v-model="r.tipo"
          :rotulo="t(`${K}.agregacao.tipo`)"
          :opcoes="opcoesTipo"
          data-testid="agregacoes-tipo"
        />
        <BuscaBem
          v-if="r.tipo === 'componente'"
          v-model="r.componente"
          :rotulo-busca="t(`${K}.agregacao.buscarComponente`)"
          :rotulo="t(`${K}.agregacao.componente`)"
          :excluir="bem.id"
          testid="agregacoes-componente"
        />
        <SanteCampoTexto
          v-model="r.documento"
          :rotulo="t(`${K}.agregacao.documento`)"
          :max-bytes="30"
          data-testid="agregacoes-documento"
        />
        <SanteCampoTexto
          v-model="r.descricao"
          :rotulo="t(`${K}.agregacao.descricao`)"
          :max-bytes="200"
          obrigatorio
          data-testid="agregacoes-descricao"
        />
        <SanteData
          v-model="r.data"
          :rotulo="t(`${K}.agregacao.data`)"
          editavel
          :maximo="hoje"
          data-testid="agregacoes-data"
        />
        <SanteCampoTexto
          v-model="r.valor"
          :rotulo="t(`${K}.agregacao.valor`)"
          :max-bytes="20"
          data-testid="agregacoes-valor"
        />
        <SanteSelecao
          v-model="r.agregaValor"
          :rotulo="t(`${K}.agregacao.agregaValor`)"
          :opcoes="opcoesSimNao"
          data-testid="agregacoes-soma"
        />
      </div>
      <ul v-if="problemas.length > 0" class="secundario" data-testid="agregacoes-problemas">
        <li v-for="p in problemas" :key="p">{{ t(`${K}.agregacao.problemas.${p}`) }}</li>
      </ul>
      <div class="acoes">
        <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="registrando = false" />
        <SanteBotao
          tipo="submit"
          :rotulo="t('patrimonio.gravar')"
          :desabilitado="ocupado || problemas.length > 0"
          data-testid="agregacoes-gravar"
        />
      </div>
    </form>
    <p v-if="consulta.isError.value" class="secundario">—</p>
    <p v-else-if="!dados" role="status">{{ t('patrimonio.carregando') }}</p>
    <p v-else-if="lista.length === 0" class="secundario" data-testid="agregacoes-nenhuma">
      {{ t(`${K}.agregacao.nenhuma`) }}
    </p>
    <ul v-else data-testid="agregacoes-lista">
      <li v-for="a in lista" :key="a.id" :data-testid="`agregacao-${a.id}`">
        {{
          t(`${K}.agregacao.linha`, {
            data: dataBr(a.data),
            tipo: t(`${K}.agregacao.tipos.${a.tipo}`),
            descricao: a.bemAgregado ? `${a.bemAgregado.plaqueta} — ${a.descricao}` : a.descricao,
            valor: reais(a.valorCent),
          })
        }}
        <template v-if="!a.agregaValor"> {{ t(`${K}.agregacao.naoSoma`) }}</template>
        <span v-if="a.dataDesagregacao" class="secundario" :data-testid="`agregacao-retirada-${a.id}`">
          · {{ t(`${K}.agregacao.retirada`, { data: dataBr(a.dataDesagregacao) }) }}
        </span>
        <SanteBotao
          v-if="!a.dataDesagregacao && podeGravar && retirando?.id !== a.id"
          variante="texto"
          :rotulo="t(`${K}.agregacao.retirar`)"
          :data-testid="`agregacao-retirar-${a.id}`"
          @acionar="abrirRetirada(a)"
        />
        <form
          v-if="retirando?.id === a.id"
          class="bloco"
          :aria-label="t(`${K}.agregacao.retirar`)"
          data-testid="agregacoes-retirada"
          @submit.prevent="retirar"
        >
          <div class="campos">
            <SanteData
              v-model="retirada.data"
              :rotulo="t(`${K}.agregacao.dataRetirada`)"
              editavel
              :maximo="hoje"
              data-testid="agregacoes-retirada-data"
            />
            <SanteCampoTexto
              v-model="retirada.motivo"
              :rotulo="t(`${K}.agregacao.motivo`)"
              :max-bytes="400"
              multilinha
              obrigatorio
              data-testid="agregacoes-retirada-motivo"
            />
          </div>
          <p v-if="retirada.motivo !== '' && retirada.motivo.trim().length < 5" class="secundario">
            {{ t(`${K}.agregacao.problemas.motivo`) }}
          </p>
          <div class="acoes">
            <SanteBotao
              variante="secundario"
              :rotulo="t('patrimonio.cancelar')"
              @acionar="retirando = null"
            />
            <SanteBotao
              tipo="submit"
              variante="destrutivo"
              :rotulo="t(`${K}.agregacao.confirmarRetirada`)"
              :desabilitado="ocupado || !retiradaPronta"
              data-testid="agregacoes-retirada-confirmar"
            />
          </div>
        </form>
      </li>
    </ul>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
