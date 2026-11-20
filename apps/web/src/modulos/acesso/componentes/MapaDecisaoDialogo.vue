<script setup lang="ts">
// W0-09: decisão do mapa (aprovar, recusar, propor ou voltar a 'proposta') sempre num diálogo: antes de confirmar,
// a prévia diz quantos usuários ativos perdem o acesso (e quais, até 20); o motivo é obrigatório na tela (o servidor
// exige quando a decisão tira uma aprovação) e a senha é digitada de novo (reautenticação). As decisões anteriores
// da linha aparecem com o motivo e os afetados. Confirmado, o servidor invalida o cache: vale na requisição seguinte.
import type { ChaveMapa, DecisaoMapaTela, PreviaMapaTela, SituacaoMapa } from '@sgh/contratos';
import { SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { decidirMapa, lerDecisoesMapa, previaMapa } from '../api-gestao.js';

const props = defineProps<{ chave: ChaveMapa | null; situacao: SituacaoMapa; linhaId: string | null }>();
const emit = defineEmits<{ decidido: [] }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t, te } = useI18n();

const previa = ref<PreviaMapaTela | null>(null);
const decisoes = ref<DecisaoMapaTela[]>([]);
const motivo = ref('');
const senha = ref('');
const erro = ref('');
const falta = ref('');
const ocupado = ref(false);

const rotuloLinha = computed(() => {
  const c = props.chave;
  if (!c) return '';
  return c.tipo === 'grupo-perfil' ? `${c.grupo} → ${c.perfil}` : `${c.perfil} → ${c.permissao}`;
});

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
  () => [visivel.value, props.chave, props.situacao] as const,
  async ([aberto, chave, situacao]) => {
    if (!aberto || !chave) return;
    previa.value = null;
    decisoes.value = [];
    motivo.value = '';
    senha.value = '';
    erro.value = '';
    falta.value = '';
    try {
      const [p, d] = await Promise.all([
        previaMapa(chave, situacao),
        props.linhaId ? lerDecisoesMapa(props.linhaId) : Promise.resolve([]),
      ]);
      previa.value = p;
      decisoes.value = d;
    } catch (e) {
      erro.value = mensagem(e);
    }
  },
  { immediate: true },
);

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const situacaoTexto = (s: SituacaoMapa | null) => (s ? t(`acesso.perfis.situacoes.${s}`) : '—');

async function confirmar(): Promise<void> {
  falta.value = '';
  if (motivo.value.trim().length < 5) falta.value = t('acesso.perfis.motivoCurto');
  else if (!senha.value) falta.value = t('acesso.perfis.senhaObrigatoria');
  if (falta.value || ocupado.value || !props.chave) return;
  ocupado.value = true;
  erro.value = '';
  try {
    await decidirMapa(props.chave, props.situacao, senha.value, motivo.value.trim());
    visivel.value = false;
    emit('decidido');
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
    :titulo="
      t('acesso.perfis.decisaoMapa.titulo', {
        acao: t(`acesso.perfis.decisaoMapa.acoes.${situacao}`),
        linha: rotuloLinha,
      })
    "
  >
    <form class="dialogo" data-testid="mapa-decisao" @submit.prevent="confirmar">
      <p v-if="!previa && !erro" role="status">{{ t('acesso.perfis.decisaoMapa.calculando') }}</p>
      <div v-if="previa" data-testid="mapa-previa" role="status">
        <p v-if="previa.doCatalogo">{{ t('acesso.perfis.decisaoMapa.doCatalogo') }}</p>
        <p v-else-if="previa.perdem === 0">{{ t('acesso.perfis.decisaoMapa.ninguemPerde') }}</p>
        <p v-else data-testid="mapa-previa-perdem">
          {{
            previa.limitado
              ? t('acesso.perfis.decisaoMapa.perdemMinimo', { n: previa.perdem })
              : t('acesso.perfis.decisaoMapa.perdem', { n: previa.perdem })
          }}
        </p>
        <ul v-if="previa.amostra.length > 0" data-testid="mapa-previa-amostra">
          <li v-for="l in previa.amostra" :key="l">{{ l }}</li>
        </ul>
        <p v-if="previa.exigeMotivo">{{ t('acesso.perfis.decisaoMapa.exigeMotivo') }}</p>
      </div>
      <p v-if="erro" role="alert" data-testid="mapa-decisao-erro">{{ erro }}</p>
      <label class="campo">
        <span>{{ t('acesso.perfis.motivo') }}</span>
        <input v-model="motivo" maxlength="400" required data-testid="mapa-decisao-motivo" />
      </label>
      <label class="campo">
        <span>{{ t('acesso.perfis.senhaDialogo') }}</span>
        <input
          v-model="senha"
          type="password"
          autocomplete="current-password"
          required
          data-testid="mapa-decisao-senha"
        />
      </label>
      <p v-if="falta" role="alert" data-testid="mapa-decisao-falta">{{ falta }}</p>
      <div class="botoes">
        <SanteBotao
          :rotulo="t('acesso.perfis.decisaoMapa.confirmar')"
          tipo="submit"
          :desabilitado="ocupado || !previa"
          data-testid="mapa-decisao-confirmar"
        />
        <SanteBotao
          :rotulo="t('acesso.perfis.cancelarDialogo')"
          variante="texto"
          @acionar="visivel = false"
        />
      </div>
      <section v-if="linhaId" data-testid="mapa-decisoes">
        <h3>{{ t('acesso.perfis.decisaoMapa.historico') }}</h3>
        <p v-if="decisoes.length === 0">{{ t('acesso.perfis.decisaoMapa.nenhuma') }}</p>
        <ul v-else>
          <li v-for="d in decisoes" :key="d.id">
            {{
              t('acesso.perfis.decisaoMapa.linhaHistorico', {
                quando: quando(d.decididoEm),
                quem: d.decididoPor,
                antes: situacaoTexto(d.situacaoAntes),
                depois: situacaoTexto(d.situacao),
                motivo: d.motivo ? `: ${d.motivo}` : '',
                afetados:
                  d.usuariosAfetados !== null
                    ? t('acesso.perfis.decisaoMapa.afetados', { n: d.usuariosAfetados })
                    : '',
              })
            }}
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
