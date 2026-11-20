<script setup lang="ts">
// Ficha do usuário > "Papéis" > "Aplicar acessos de outro usuário" (W1-01, parte 12a; mercado n). Busca o
// usuário-modelo, mostra a diferença (grupo, papéis SBIS, perfis do Sante; o que fica de fora e por quê) e só então
// aplica, com motivo e a senha no diálogo único. A gravação confere a prévia: se o modelo ou o usuário mudou no meio,
// o servidor recusa e a diferença tem de ser mostrada de novo. O resultado vem passo a passo.
import type { PreviaModeloTela, ResultadoModeloTela } from '@sgh/contratos';
import { SanteBotao, SanteDialogoGravacao, SanteSelecao, type PedidoGravacao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarUsuariosGestao } from '../../acesso/api-gestao.js';
import { aplicarModelo, previaModelo } from '../api.js';

const props = defineProps<{ login: string }>();
const emit = defineEmits<{ aplicado: [ResultadoModeloTela] }>();
const P = 'adm.ficha.modelo';
const { t } = useI18n();

const termo = ref('');
const achados = ref<{ login: string; nome: string }[] | null>(null);
const modelo = ref('');
const modo = ref<'somar' | 'igualar'>('somar');
const previa = ref<PreviaModeloTela | null>(null);
const motivo = ref('');
const resultado = ref<ResultadoModeloTela | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const dialogo = ref(false);

watch(
  () => props.login,
  () => {
    achados.value = null;
    modelo.value = '';
    previa.value = null;
    resultado.value = null;
  },
);
// A prévia vale para o modelo e o modo escolhidos: trocar um deles pede outra.
watch([modelo, modo], () => {
  previa.value = null;
});

async function buscar(): Promise<void> {
  erro.value = null;
  try {
    const r = await buscarUsuariosGestao(termo.value.trim());
    achados.value = r.filter((u) => u.login !== props.login && u.ativo && !u.bloqueado);
    modelo.value = achados.value[0]?.login ?? '';
  } catch (e) {
    erro.value = e;
  }
}

const opcoesModelo = computed(() => [
  { valor: '', rotulo: t(`${P}.escolha`) },
  ...(achados.value ?? []).map((u) => ({ valor: u.login, rotulo: `${u.login} · ${u.nome}` })),
]);
const opcoesModo = computed(() =>
  (['somar', 'igualar'] as const).map((m) => ({ valor: m, rotulo: t(`${P}.modos.${m}`) })),
);

async function mostrar(): Promise<void> {
  erro.value = null;
  resultado.value = null;
  try {
    previa.value = await previaModelo(props.login, modelo.value, modo.value);
  } catch (e) {
    previa.value = null;
    erro.value = e;
  }
}

const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const linhas = computed(() => {
  const p = previa.value;
  if (!p) return [];
  const l: { chave: string; texto: string }[] = [];
  if (p.grupo)
    l.push({
      chave: 'g',
      texto: t(`${P}.grupo`, { de: p.grupo.de ?? t(`${P}.semGrupo`), para: p.grupo.para }),
    });
  const papel = (x: { papel: number; nome: string }) => `${x.papel} ${x.nome}`;
  for (const x of p.papeisConceder)
    l.push({ chave: `pc${x.papel}`, texto: t(`${P}.papelConceder`, { item: papel(x) }) });
  for (const x of p.papeisReativar)
    l.push({ chave: `pa${x.papel}`, texto: t(`${P}.papelReativar`, { item: papel(x) }) });
  for (const x of p.papeisRetirar)
    l.push({ chave: `pr${x.papel}`, texto: t(`${P}.papelRetirar`, { item: papel(x) }) });
  for (const x of p.perfisConceder)
    l.push({
      chave: `fc${x.perfil}`,
      texto: x.fim
        ? t(`${P}.perfilConcederAte`, { item: x.perfil, fim: dia(x.fim) })
        : t(`${P}.perfilConceder`, { item: x.perfil }),
    });
  for (const x of p.perfisRetirar)
    l.push({ chave: `fr${x.id}`, texto: t(`${P}.perfilRetirar`, { item: x.perfil }) });
  return l;
});
const podeAplicar = computed(
  () => !!previa.value && previa.value.passos > 0 && motivo.value.trim().length >= 10,
);

const pedido = computed<PedidoGravacao | null>(() => {
  const p = previa.value;
  if (!p) return null;
  return {
    titulo: t(`${P}.dialogo`, { login: props.login, modelo: p.modelo }),
    texto: t(`${P}.dialogoTexto`),
    senha: true,
    confirmar: t(`${P}.confirmar`),
    gravar: async ({ senha }) => {
      resultado.value = await aplicarModelo(
        props.login,
        { modelo: p.modelo, modo: p.modo, conferencia: p.conferencia, motivo: motivo.value.trim() },
        senha,
      );
    },
  };
});
function concluido(): void {
  previa.value = null;
  motivo.value = '';
  if (resultado.value) emit('aplicado', resultado.value);
}
function falhou(e: unknown): void {
  erro.value = e;
}
function abrir(): void {
  erro.value = null;
  dialogo.value = true;
}
</script>

<template>
  <section class="cartao modelo" aria-labelledby="ficha-modelo" data-testid="ficha-modelo">
    <h2 id="ficha-modelo" class="cartao__titulo">{{ t(`${P}.titulo`) }}</h2>
    <p class="nota">{{ t(`${P}.texto`) }}</p>
    <MensagemErro v-if="erro" :erro="erro" />

    <form class="modelo__form" data-testid="ficha-modelo-busca" @submit.prevent="buscar">
      <div class="modelo__campo modelo__campo--largo">
        <label for="modelo-termo" class="rotulo">{{ t(`${P}.buscar`) }}</label>
        <input
          id="modelo-termo"
          v-model="termo"
          type="search"
          maxlength="40"
          data-testid="ficha-modelo-termo"
        />
      </div>
      <SanteBotao
        :rotulo="t(`${P}.buscarBotao`)"
        tipo="submit"
        variante="secundario"
        data-testid="ficha-modelo-buscar"
      />
    </form>

    <p v-if="achados && achados.length === 0" data-testid="ficha-modelo-nenhum">{{ t(`${P}.nenhum`) }}</p>
    <form v-else-if="achados" class="modelo__form" @submit.prevent="mostrar">
      <SanteSelecao
        id="modelo-login"
        v-model="modelo"
        :rotulo="t(`${P}.modelo`)"
        :opcoes="opcoesModelo"
        :busca="true"
        data-testid="ficha-modelo-login"
      />
      <SanteSelecao
        id="modelo-modo"
        v-model="modo"
        :rotulo="t(`${P}.modo`)"
        :opcoes="opcoesModo"
        data-testid="ficha-modelo-modo"
      />
      <SanteBotao
        :rotulo="t(`${P}.previa`)"
        tipo="submit"
        :desabilitado="!modelo"
        data-testid="ficha-modelo-previa"
      />
    </form>

    <div v-if="previa" class="modelo__previa" data-testid="ficha-modelo-diferenca">
      <ul v-if="linhas.length" class="lista-linhas">
        <li v-for="l in linhas" :key="l.chave">{{ l.texto }}</li>
      </ul>
      <p v-else data-testid="ficha-modelo-nada">{{ t(`${P}.nadaAAplicar`) }}</p>
      <p class="nota">{{ t(`${P}.iguais`, { n: previa.iguais }) }}</p>
      <template v-if="previa.ignorados.length">
        <h3 class="modelo__sub">{{ t(`${P}.ignorados`) }}</h3>
        <ul class="lista-linhas" data-testid="ficha-modelo-ignorados">
          <li v-for="i in previa.ignorados" :key="`${i.tipo}${i.item}`">
            <span>{{ i.item }}</span>
            <span class="nota">{{ t(`${P}.motivos.${i.motivo}`) }}</span>
          </li>
        </ul>
      </template>
      <form v-if="previa.passos > 0" class="modelo__form" @submit.prevent="abrir">
        <div class="modelo__campo modelo__campo--largo">
          <label for="modelo-motivo" class="rotulo">{{ t(`${P}.motivo`) }}</label>
          <textarea
            id="modelo-motivo"
            v-model="motivo"
            rows="2"
            maxlength="160"
            data-testid="ficha-modelo-motivo"
          />
        </div>
        <SanteBotao
          :rotulo="t(`${P}.aplicar`, { n: previa.passos })"
          tipo="submit"
          :desabilitado="!podeAplicar || ocupado"
          data-testid="ficha-modelo-aplicar"
        />
      </form>
    </div>

    <div v-if="resultado" role="status" data-testid="ficha-modelo-resultado">
      <p>{{ t(`${P}.resultado`, { feitos: resultado.feitos, falhas: resultado.falhas }) }}</p>
      <ul class="lista-linhas">
        <li v-for="(x, i) in resultado.passos" :key="i">
          <span>{{ t(`${P}.acoes.${x.acao}`) }}: {{ x.item }}</span>
          <span :class="['pilula', x.feito ? 'pilula--ok' : 'pilula--neutra']">{{
            x.feito ? t(`${P}.feito`) : x.erro
          }}</span>
        </li>
      </ul>
    </div>

    <SanteDialogoGravacao
      v-model:visivel="dialogo"
      v-model:ocupado="ocupado"
      :pedido="pedido"
      @feito="concluido"
      @falha="falhou"
    />
  </section>
</template>

<style scoped>
.modelo {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.modelo__form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
}
.modelo__campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.modelo__campo--largo {
  flex: 1 1 18rem;
}
.modelo__previa {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.modelo__sub {
  margin: 0;
  font-size: 1rem;
}
.nota {
  color: var(--sgh-texto-secundario);
}
</style>
