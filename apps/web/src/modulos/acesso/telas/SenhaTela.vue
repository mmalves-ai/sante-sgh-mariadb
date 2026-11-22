<script setup lang="ts">
// Trocar a senha (M05; W1-01): a própria senha, por vontade ou por troca obrigatória (expirada ou sem cifra). A
// senha atual confere de novo (vale como reautenticação); a nova passa pela política do estabelecimento e pelo
// histórico; recusada, a tela lista as regras que faltam (só códigos vêm do servidor). Sem a troca liberada no
// estabelecimento (a combinação do resumo ainda não confirmada), a tela explica e não mostra o formulário.
// As regras da política vigente aparecem antes de digitar e são conferidas ao vivo (ok ou pendente); a recusa do
// servidor aparece em destaque (alerta de erro, com foco) com a regra que falhou.
import type { Sessao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import { trocarSenha } from '../../../api.js';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { CHAVE_SESSAO, usarSessao } from '../../../casca/sessao/sessao.js';
import { destinoDepoisDoLogin } from '../identidade-tela.js';
import { buscarRegrasSenha, estadoRegra, type RegraSenha, type RegrasSenha } from '../regras-senha-tela.js';

const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const { sessao } = usarSessao();
const disponivel = computed(() => sessao.value?.trocaSenhaPeloNovo === true);
const motivo = computed(() => sessao.value?.trocaSenha ?? null);

const atual = ref('');
const nova = ref('');
const confirmacao = ref('');
const ocupado = ref(false);
const erro = ref<unknown>(null);
const aviso = ref('');
const falhas = ref<string[]>([]);
const trocada = ref<Sessao | null>(null);
const naoConfere = computed(() => confirmacao.value !== '' && confirmacao.value !== nova.value);
const politica = ref<RegrasSenha | null>(null);
const alertaFalhas = ref<HTMLElement | null>(null);

onMounted(async () => {
  try {
    politica.value = await buscarRegrasSenha();
  } catch {
    // Sem a lista, a tela segue com o texto geral das regras; a recusa do servidor continua dizendo qual falhou.
    politica.value = null;
  }
});

function textoRegra(r: Pick<RegraSenha, 'codigo' | 'valor'>): string {
  if (r.codigo === 'repetida' && r.valor) return t('senha.regra.repetidaDias', { n: r.valor });
  return t(`senha.regra.${r.codigo}`, { n: r.valor ?? 0, login: politica.value?.login ?? '' });
}

const regrasAoVivo = computed(() =>
  (politica.value?.regras ?? []).map((r) => ({
    ...r,
    texto: textoRegra(r),
    estado: estadoRegra(r, nova.value, politica.value?.login ?? '', atual.value),
  })),
);

function textoFalha(codigo: string): string {
  const r = politica.value?.regras.find((x) => x.codigo === codigo);
  return r ? textoRegra(r) : t(`senha.falha.${codigo}`);
}

async function trocar(): Promise<void> {
  if (ocupado.value || naoConfere.value) return;
  erro.value = null;
  aviso.value = '';
  falhas.value = [];
  ocupado.value = true;
  try {
    const s = await trocarSenha({
      senhaAtual: atual.value,
      senhaNova: nova.value,
      confirmacao: confirmacao.value,
    });
    cliente.setQueryData(CHAVE_SESSAO, s);
    trocada.value = s;
  } catch (x) {
    const p = x instanceof ErroApi ? x.problema : null;
    if (p?.falhas?.length) {
      falhas.value = p.falhas;
      await nextTick();
      alertaFalhas.value?.focus();
    } else if (x instanceof ErroApi && x.status === 401) aviso.value = t('senha.atualInvalida');
    else erro.value = x;
  } finally {
    // A senha digitada nunca fica na tela depois do pedido.
    atual.value = '';
    nova.value = '';
    confirmacao.value = '';
    ocupado.value = false;
  }
}

async function continuar(): Promise<void> {
  await roteador.replace(trocada.value ? destinoDepoisDoLogin(trocada.value) : '/inicio');
}
</script>

<template>
  <section class="tela" aria-labelledby="senha-titulo">
    <h1 id="senha-titulo">{{ t('senha.titulo') }}</h1>
    <SanteAlerta
      v-if="motivo && !trocada"
      variante="aviso"
      :texto="t(`senha.motivo.${motivo}`)"
      data-testid="senha-motivo"
    />
    <template v-if="sessao && !disponivel && !trocada">
      <SanteAlerta variante="aviso" :texto="t('senha.indisponivel')" data-testid="senha-indisponivel" />
      <p>
        <RouterLink to="/entrar">{{ t('senha.voltar') }}</RouterLink>
      </p>
    </template>
    <template v-else-if="trocada">
      <SanteAlerta variante="info" :texto="t('senha.trocada')" anunciar data-testid="senha-trocada" />
      <SanteBotao :rotulo="t('senha.continuar')" data-testid="senha-continuar" @acionar="continuar" />
    </template>
    <form v-else-if="disponivel" class="formulario" data-testid="form-senha" @submit.prevent="trocar">
      <div
        v-if="falhas.length"
        ref="alertaFalhas"
        class="falhas"
        role="alert"
        tabindex="-1"
        data-testid="senha-falhas"
      >
        <p class="falhas-titulo">{{ t('senha.recusada') }}</p>
        <ul>
          <li v-for="f in falhas" :key="f" :data-falha="f">{{ textoFalha(f) }}</li>
        </ul>
      </div>
      <MensagemErro v-if="erro" :erro="erro" />
      <SanteAlerta v-if="aviso" variante="alerta" :texto="aviso" anunciar data-testid="senha-aviso" />
      <div v-if="politica" class="regras" data-testid="senha-regras">
        <p id="senha-regras-titulo">{{ t('senha.regrasTitulo') }}</p>
        <ul aria-labelledby="senha-regras-titulo" aria-live="polite">
          <li
            v-for="r in regrasAoVivo"
            :key="r.codigo"
            :class="`regra regra--${r.estado}`"
            :data-regra="r.codigo"
            :data-estado="r.estado"
          >
            <span class="marca" aria-hidden="true">{{
              r.estado === 'ok' ? '✓' : r.estado === 'pendente' ? '○' : '…'
            }}</span>
            <span>{{ r.texto }}</span>
            <span class="estado">({{ t(`senha.estadoRegra.${r.estado}`) }})</span>
          </li>
        </ul>
      </div>
      <p v-else>{{ t('senha.regras') }}</p>
      <label class="campo" for="senha-atual">
        <span>{{ t('senha.atual') }}</span>
        <input
          id="senha-atual"
          v-model="atual"
          type="password"
          autocomplete="current-password"
          required
          data-testid="senha-atual"
        />
      </label>
      <label class="campo" for="senha-nova">
        <span>{{ t('senha.nova') }}</span>
        <input
          id="senha-nova"
          v-model="nova"
          type="password"
          autocomplete="new-password"
          required
          aria-describedby="senha-regras-titulo"
          data-testid="senha-nova"
        />
      </label>
      <label class="campo" for="senha-confirmacao">
        <span>{{ t('senha.confirmacao') }}</span>
        <input
          id="senha-confirmacao"
          v-model="confirmacao"
          type="password"
          autocomplete="new-password"
          required
          :aria-invalid="naoConfere"
          data-testid="senha-confirmacao"
        />
      </label>
      <p v-if="naoConfere" class="nao-confere" data-testid="senha-nao-confere">{{ t('senha.naoConfere') }}</p>
      <SanteBotao
        :rotulo="t('senha.trocar')"
        tipo="submit"
        :desabilitado="ocupado || naoConfere"
        data-testid="senha-trocar"
      />
    </form>
  </section>
</template>

<style scoped>
.formulario,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 28rem;
}
.falhas {
  border: 2px solid var(--sgh-alerta);
  border-left-width: 6px;
  background: var(--sgh-alerta-suave);
  color: var(--sgh-texto);
  padding: var(--sgh-espaco-2);
  border-radius: 4px;
}
.falhas:focus {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 2px;
}
.falhas-titulo {
  font-weight: 700;
  margin: 0;
}
.falhas ul,
.regras ul {
  margin: 0;
}
.regras ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 2px;
}
.regra {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.regra--ok .marca {
  color: var(--sgh-sucesso);
  font-weight: 700;
}
.regra--pendente {
  color: var(--sgh-texto-secundario);
}
.estado {
  font-size: 0.875em;
}
.nao-confere {
  font-weight: 600;
  margin: 0;
}
</style>
