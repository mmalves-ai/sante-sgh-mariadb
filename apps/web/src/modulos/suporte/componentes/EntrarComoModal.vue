<script setup lang="ts">
// Modal do "login como" (ADR 0021), carregado sob demanda (quem não é plataforma nem suporte nem baixa este
// pedaço). Escolhe o estabelecimento (plataforma: todos os configurados; suporte: só os atribuídos), o grupo
// ativo do TBGRUUSU (com a contagem) e o login não bloqueado; motivo ou chamado opcional. A troca é por
// recarga completa (location.assign): nada da sessão anterior fica na tela. ADR 0022: a PLATAFORMA também
// escolhe "Eu mesmo, com acesso total": o usuário escolhido é só "em nome de quem gravar" (padrão do
// estabelecimento pré-selecionado quando configurado).
import type { EstabelecimentoComo, GrupoComo, UsuarioComo } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { mensagemDoErro } from '../../../casca/erros/problem-details.js';
import {
  buscarEu,
  emNomeDeComo,
  entrarComo,
  estabelecimentosComo,
  gruposComo,
  usuariosComo,
} from '../api-suporte.js';

const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const estabelecimentos = ref<EstabelecimentoComo[]>([]);
const grupos = ref<GrupoComo[]>([]);
const usuarios = ref<UsuarioComo[]>([]);
const estabelecimento = ref('');
const grupo = ref('');
const login = ref('');
const motivo = ref('');
const carregando = ref(true);
const abrindo = ref(false);
const erro = ref('');
const podeAcessoTotal = ref(false);
const modo = ref<'como' | 'acesso-total'>('como');
const padraoEmNomeDe = ref<string | null>(null);

async function carregarPadrao(e: string): Promise<void> {
  padraoEmNomeDe.value = null;
  if (!podeAcessoTotal.value || !e) return;
  try {
    padraoEmNomeDe.value = (await emNomeDeComo(e)).login;
    if (modo.value === 'acesso-total' && padraoEmNomeDe.value && !login.value)
      login.value = padraoEmNomeDe.value;
  } catch {
    /* sem padrão: a pessoa escolhe */
  }
}

watch(modo, (m) => {
  if (m === 'acesso-total' && padraoEmNomeDe.value && !login.value) login.value = padraoEmNomeDe.value;
});

onMounted(async () => {
  try {
    podeAcessoTotal.value = (await buscarEu().catch(() => null))?.podeAcessoTotal === true;
    estabelecimentos.value = (await estabelecimentosComo()).filter((e) => e.disponivel);
    estabelecimento.value = estabelecimentos.value[0]?.codigo ?? '';
  } catch {
    erro.value = t('suporte.indisponivel');
  } finally {
    carregando.value = false;
  }
});

watch(estabelecimento, async (e) => {
  grupos.value = [];
  grupo.value = '';
  void carregarPadrao(e);
  if (!e) return;
  try {
    grupos.value = await gruposComo(e);
  } catch {
    erro.value = t('suporte.indisponivel');
  }
});

watch(grupo, async (g) => {
  usuarios.value = [];
  login.value = modo.value === 'acesso-total' ? (padraoEmNomeDe.value ?? '') : '';
  if (!g || !estabelecimento.value) return;
  try {
    usuarios.value = await usuariosComo(estabelecimento.value, g);
  } catch {
    erro.value = t('suporte.indisponivel');
  }
});

// Opções das listas (mesma ordem de antes).
const opcoesEstabelecimentos = computed(() =>
  estabelecimentos.value.map((e) => ({ valor: e.codigo, rotulo: e.nome })),
);
const opcoesGrupos = computed(() =>
  grupos.value.map((g) => ({
    valor: g.grupo,
    rotulo: t('suporte.grupoContagem', { grupo: g.grupo, n: g.usuarios }),
  })),
);
const opcoesUsuarios = computed(() => {
  const padrao = padraoEmNomeDe.value;
  const extra =
    modo.value === 'acesso-total' && padrao && !usuarios.value.some((u) => u.login === padrao)
      ? [{ valor: padrao, rotulo: padrao }]
      : [];
  return [...extra, ...usuarios.value.map((u) => ({ valor: u.login, rotulo: `${u.login} · ${u.nome}` }))];
});

async function abrir(): Promise<void> {
  if (abrindo.value || !estabelecimento.value || !login.value) return;
  abrindo.value = true;
  erro.value = '';
  try {
    await entrarComo({
      estabelecimento: estabelecimento.value,
      login: login.value,
      ...(motivo.value.trim() ? { motivo: motivo.value.trim() } : {}),
      ...(modo.value === 'acesso-total' ? { modo: 'acesso-total' as const } : {}),
    });
    window.location.assign('/inicio');
  } catch (e) {
    erro.value =
      mensagemDoErro(e).tipo === 'indisponivel' ? t('suporte.indisponivel') : t('suporte.erroAbrir');
  } finally {
    abrindo.value = false;
  }
}
</script>

<template>
  <div
    class="como"
    role="dialog"
    aria-modal="true"
    aria-labelledby="como-titulo"
    @keydown.esc="emit('fechar')"
  >
    <div class="como__caixa">
      <h2 id="como-titulo">{{ t('suporte.modalTitulo') }}</h2>
      <p class="como__aviso">{{ t('suporte.modalAviso') }}</p>
      <p v-if="carregando">{{ t('suporte.carregando') }}</p>
      <form v-else class="como__form" @submit.prevent="abrir">
        <fieldset v-if="podeAcessoTotal" class="como__modo" data-testid="como-modo">
          <label>
            <input v-model="modo" type="radio" value="como" data-testid="como-modo-como" />
            {{ t('suporte.modoComo') }}
          </label>
          <label>
            <input v-model="modo" type="radio" value="acesso-total" data-testid="como-modo-total" />
            {{ t('suporte.modoAcessoTotal') }}
          </label>
        </fieldset>
        <p v-if="modo === 'acesso-total'" class="como__aviso" data-testid="como-aviso-total">
          {{ t('suporte.acessoTotalAviso') }}
        </p>
        <SanteSelecao
          v-model="estabelecimento"
          :rotulo="t('suporte.estabelecimento')"
          :opcoes="opcoesEstabelecimentos"
          data-testid="como-estabelecimento"
        />
        <SanteSelecao
          v-model="grupo"
          :rotulo="t('suporte.grupo')"
          :opcoes="opcoesGrupos"
          data-testid="como-grupo"
        />
        <div class="como__campo">
          <SanteSelecao
            v-model="login"
            :rotulo="modo === 'acesso-total' ? t('suporte.emNomeDe') : t('suporte.usuario')"
            :opcoes="opcoesUsuarios"
            data-testid="como-usuario"
          />
          <small v-if="modo === 'acesso-total' && padraoEmNomeDe" data-testid="como-padrao">
            {{ t('suporte.emNomeDePadrao', { login: padraoEmNomeDe }) }}
          </small>
          <small v-if="grupo && usuarios.length === 0">{{ t('suporte.nenhumUsuario') }}</small>
        </div>
        <label class="como__campo">
          <span>{{ t('suporte.motivo') }}</span>
          <input v-model="motivo" maxlength="200" data-testid="como-motivo" />
        </label>
        <p v-if="erro" role="alert" class="como__erro" data-testid="como-erro">{{ erro }}</p>
        <div class="como__acoes">
          <SanteBotao
            :rotulo="
              abrindo
                ? t('suporte.abrindo')
                : modo === 'acesso-total'
                  ? t('suporte.abrirAcessoTotal')
                  : t('suporte.abrir')
            "
            tipo="submit"
            :desabilitado="abrindo || !login"
            data-testid="como-abrir"
          />
          <button type="button" class="como__cancelar" @click="emit('fechar')">
            {{ t('suporte.cancelar') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.como {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: var(--sgh-fundo-sutil);
}
.como__caixa {
  width: min(32rem, 94vw);
  padding: var(--sgh-espaco-4);
  border-radius: 8px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  border: 1px solid var(--sgh-borda-forte);
}
.como__modo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
}
.como__aviso {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
.como__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.como__campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.como__campo select,
.como__campo input {
  min-height: var(--sgh-alvo-minimo);
  font: inherit;
  padding: 0 var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.como__acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.como__cancelar {
  min-height: var(--sgh-alvo-minimo);
  font: inherit;
}
.como__erro {
  color: var(--sgh-alerta);
}
</style>
