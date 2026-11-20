<script setup lang="ts">
// W0-09: Alterar a concessão de perfil (vigência e motivo) num diálogo com a justificativa e a senha digitada na hora
// (reautenticação). O valor anterior fica na alteração (só inclusão) e aparece aqui, no histórico da concessão. O
// servidor invalida o cache do usuário: a permissão efetiva muda na requisição seguinte.
import type { AlteracaoPerfilTela, PerfilConcedidoTela } from '@sgh/contratos';
import { SanteBotao, SanteDialogo } from '@sgh/ui';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { alterarPerfil, lerAlteracoesPerfil } from '../api-gestao.js';

const props = defineProps<{ concessao: PerfilConcedidoTela | null }>();
const emit = defineEmits<{ alterado: [] }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t, te } = useI18n();

const form = ref({ inicio: '', fim: '', motivo: '', justificativa: '' });
const senha = ref('');
const alteracoes = ref<AlteracaoPerfilTela[]>([]);
const erro = ref('');
const falta = ref('');
const ocupado = ref(false);

/** ISO → valor do campo datetime-local (hora local, sem segundos). */
function paraCampoLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR') : t('acesso.perfis.alteracao.semFim');

function mensagem(e: unknown): string {
  if (e instanceof ErroApi) {
    const p = e.problema as { codigo?: string; detail?: string } | null;
    if (p?.codigo && te(`acesso.perfis.recusas.${p.codigo}`)) return t(`acesso.perfis.recusas.${p.codigo}`);
    if (e.status === 401) return t('acesso.perfis.recusas.senha');
    if (e.status === 403) return t('acesso.perfis.recusas.semPermissao');
    if (p?.detail) return p.detail;
  }
  return t('acesso.perfis.erroGenerico');
}

watch(
  () => [visivel.value, props.concessao] as const,
  async ([aberto, c]) => {
    if (!aberto || !c) return;
    form.value = {
      inicio: paraCampoLocal(c.inicio),
      fim: paraCampoLocal(c.fim),
      motivo: c.motivo ?? '',
      justificativa: '',
    };
    senha.value = '';
    erro.value = '';
    falta.value = '';
    alteracoes.value = [];
    try {
      alteracoes.value = await lerAlteracoesPerfil(c.id);
    } catch (e) {
      erro.value = mensagem(e);
    }
  },
  { immediate: true },
);

async function confirmar(): Promise<void> {
  const c = props.concessao;
  falta.value = '';
  if (form.value.motivo.trim().length < 3 || form.value.justificativa.trim().length < 5)
    falta.value = t('acesso.perfis.motivoCurto');
  else if (!form.value.inicio) falta.value = t('acesso.perfis.escolhaObrigatoria');
  else if (!senha.value) falta.value = t('acesso.perfis.senhaObrigatoria');
  if (falta.value || ocupado.value || !c) return;
  ocupado.value = true;
  erro.value = '';
  try {
    await alterarPerfil(c.id, {
      inicio: new Date(form.value.inicio).toISOString(),
      fim: form.value.fim ? new Date(form.value.fim).toISOString() : null,
      motivo: form.value.motivo.trim(),
      justificativa: form.value.justificativa.trim(),
      senha: senha.value,
    });
    visivel.value = false;
    emit('alterado');
  } catch (e) {
    erro.value = mensagem(e);
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo
    v-model:visivel="visivel"
    :titulo="concessao ? t('acesso.perfis.alteracao.titulo', { perfil: concessao.perfil }) : ''"
  >
    <form class="dialogo" data-testid="perfil-alteracao" @submit.prevent="confirmar">
      <p>{{ t('acesso.perfis.alteracao.texto') }}</p>
      <p v-if="erro" role="alert" data-testid="perfil-alteracao-erro">{{ erro }}</p>
      <label class="campo">
        <span>{{ t('acesso.perfis.inicio') }}</span>
        <input v-model="form.inicio" type="datetime-local" required data-testid="perfil-alteracao-inicio" />
      </label>
      <label class="campo">
        <span>{{ t('acesso.perfis.fim') }}</span>
        <input v-model="form.fim" type="datetime-local" data-testid="perfil-alteracao-fim" />
      </label>
      <label class="campo">
        <span>{{ t('acesso.perfis.motivo') }}</span>
        <input v-model="form.motivo" maxlength="200" required data-testid="perfil-alteracao-motivo" />
      </label>
      <label class="campo">
        <span>{{ t('acesso.perfis.alteracao.justificativa') }}</span>
        <textarea
          v-model="form.justificativa"
          maxlength="400"
          rows="2"
          required
          data-testid="perfil-alteracao-justificativa"
        />
      </label>
      <label class="campo">
        <span>{{ t('acesso.perfis.senhaDialogo') }}</span>
        <input
          v-model="senha"
          type="password"
          autocomplete="current-password"
          required
          data-testid="perfil-alteracao-senha"
        />
      </label>
      <p v-if="falta" role="alert" data-testid="perfil-alteracao-falta">{{ falta }}</p>
      <div class="botoes">
        <SanteBotao
          :rotulo="t('acesso.perfis.alterar')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="perfil-alteracao-confirmar"
        />
        <SanteBotao
          :rotulo="t('acesso.perfis.cancelarDialogo')"
          variante="texto"
          @acionar="visivel = false"
        />
      </div>
      <section data-testid="perfil-alteracoes">
        <h3>{{ t('acesso.perfis.alteracao.historico') }}</h3>
        <p v-if="alteracoes.length === 0">{{ t('acesso.perfis.alteracao.nenhuma') }}</p>
        <ul v-else>
          <li v-for="a in alteracoes" :key="a.id">
            <div>
              {{
                t('acesso.perfis.alteracao.por', {
                  quem: a.alteradoPor,
                  quando: quando(a.alteradoEm),
                  justificativa: a.justificativa,
                })
              }}
            </div>
            <div>
              {{
                t('acesso.perfis.alteracao.antes', {
                  inicio: quando(a.inicioAntes),
                  fim: quando(a.fimAntes),
                  motivo: a.motivoAntes ?? '—',
                })
              }}
            </div>
            <div>
              {{
                t('acesso.perfis.alteracao.depois', {
                  inicio: quando(a.inicio),
                  fim: quando(a.fim),
                  motivo: a.motivo,
                })
              }}
            </div>
          </li>
        </ul>
      </section>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.dialogo,
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
