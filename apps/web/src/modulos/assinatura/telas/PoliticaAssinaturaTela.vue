<script setup lang="ts">
// Política de assinatura por tipo de documento (ficha do M49, seção 7; regra 6; etapa 1):
// `/administracao/assinatura/politica`. Mostra o que vale hoje para cada tipo e destino (a regra cadastrada ou o mínimo
// legal) e as regras cadastradas. Quem edita (diretoria clínica e jurídico, pelo administrador) grava uma regra nova
// com justificativa; o servidor recusa abaixo do mínimo legal e diz qual é o mínimo. Tirar a regra volta ao mínimo.
import {
  DESTINOS_DOCUMENTO,
  FORMATOS_ASSINATURA,
  NIVEIS_ASSINATURA,
  POLITICAS_ASSINATURA_ICP,
  TIPOS_DOCUMENTO_POLITICA,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroAssinatura from '../componentes/ErroAssinatura.vue';
import { definirPolitica, lerPoliticas, removerPolitica } from '../api-assinatura.js';

const { t } = useI18n();
const q = useQuery({ queryKey: ['assinatura', 'politica'], queryFn: lerPoliticas });
const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);

const tipo = ref<string>('atestado');
const conselho = ref<string>('');
const destino = ref<string>('externo');
const nivel = ref<string>('icp-brasil');
const politicaIcp = ref<string>('AD-RT');
const formato = ref<string>('pades');
const justificativa = ref('');
const remover = ref<{ tipoDocumento: string; conselho: string | null; destino: string } | null>(null);
const justificativaRemocao = ref('');

const opcoes = <T extends string>(lista: readonly T[], chave: string) =>
  lista.map((v) => ({ valor: v as string, rotulo: t(`${chave}.${v}`) }));
const opcoesTipo = computed(() => opcoes(TIPOS_DOCUMENTO_POLITICA, 'assinatura.politica.tipos'));
const opcoesDestino = computed(() => opcoes(DESTINOS_DOCUMENTO, 'assinatura.destinos'));
const opcoesNivel = computed(() => opcoes(NIVEIS_ASSINATURA, 'assinatura.niveis'));
const opcoesPolitica = computed(() => opcoes(POLITICAS_ASSINATURA_ICP, 'assinatura.politicas'));
const opcoesFormato = computed(() => opcoes(FORMATOS_ASSINATURA, 'assinatura.formatos'));
const opcoesConselho = computed(() => [
  { valor: '', rotulo: t('assinatura.politica.qualquerConselho') },
  // As siglas do cadastro de conselhos profissionais (servidas com a política).
  ...(q.data.value?.conselhos ?? []).map((c) => ({ valor: c, rotulo: c })),
]);

const exigido = (e: { nivel: string; politicaIcp: string | null }) =>
  e.politicaIcp
    ? `${t(`assinatura.niveis.${e.nivel}`)} · ${t(`assinatura.politicas.${e.politicaIcp}`)}`
    : t(`assinatura.niveis.${e.nivel}`);

async function agir(fn: () => Promise<void>) {
  erro.value = null;
  aviso.value = '';
  ocupado.value = true;
  try {
    await fn();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const gravar = () =>
  agir(async () => {
    const r = await definirPolitica({
      tipoDocumento: tipo.value,
      conselho: conselho.value || null,
      destino: destino.value,
      nivel: nivel.value,
      politicaIcp: nivel.value === 'icp-brasil' ? politicaIcp.value : null,
      formato: formato.value,
      justificativa: justificativa.value,
    });
    q.data.value = r;
    justificativa.value = '';
    aviso.value = t('assinatura.politica.gravada');
    await q.refetch();
  });

const confirmarRemocao = () =>
  agir(async () => {
    if (!remover.value) return;
    await removerPolitica({ ...remover.value, justificativa: justificativaRemocao.value });
    remover.value = null;
    justificativaRemocao.value = '';
    aviso.value = t('assinatura.politica.removida');
    await q.refetch();
  });
</script>

<template>
  <section class="tela-assinatura" aria-labelledby="pol-titulo" data-testid="tela-politica-assinatura">
    <h1 id="pol-titulo">{{ t('assinatura.politica.titulo') }}</h1>
    <p>{{ t('assinatura.politica.subtitulo') }}</p>
    <p class="secundario">{{ t('assinatura.politica.decisao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="pol-aviso" />
    <ErroAssinatura v-if="erro || q.error.value" :erro="erro ?? q.error.value" />
    <template v-if="q.data.value">
      <form v-if="q.data.value.podeEditar" class="bloco" data-testid="pol-nova" @submit.prevent="gravar">
        <h2>{{ t('assinatura.politica.nova') }}</h2>
        <div class="blocos">
          <SanteSelecao
            id="pol-tipo"
            v-model="tipo"
            :rotulo="t('assinatura.politica.tipoDocumento')"
            :opcoes="opcoesTipo"
            data-testid="pol-tipo"
          />
          <SanteSelecao
            id="pol-conselho"
            v-model="conselho"
            :rotulo="t('assinatura.politica.conselho')"
            :opcoes="opcoesConselho"
          />
          <SanteSelecao
            id="pol-destino"
            v-model="destino"
            :rotulo="t('assinatura.politica.destino')"
            :opcoes="opcoesDestino"
            data-testid="pol-destino"
          />
          <SanteSelecao
            id="pol-nivel"
            v-model="nivel"
            :rotulo="t('assinatura.politica.nivel')"
            :opcoes="opcoesNivel"
            data-testid="pol-nivel"
          />
          <SanteSelecao
            v-if="nivel === 'icp-brasil'"
            id="pol-icp"
            v-model="politicaIcp"
            :rotulo="t('assinatura.politica.politicaIcp')"
            :opcoes="opcoesPolitica"
            data-testid="pol-icp"
          />
          <SanteSelecao
            id="pol-formato"
            v-model="formato"
            :rotulo="t('assinatura.politica.formato')"
            :opcoes="opcoesFormato"
          />
        </div>
        <SanteCampoTexto
          id="pol-justificativa"
          v-model="justificativa"
          :rotulo="t('assinatura.justificativa')"
          :max-bytes="400"
          multilinha
          obrigatorio
          data-testid="pol-justificativa"
        />
        <span class="acoes">
          <SanteBotao
            :rotulo="t('assinatura.gravar')"
            tipo="submit"
            :desabilitado="ocupado || justificativa.trim().length < 10"
            data-testid="pol-gravar"
          />
        </span>
      </form>

      <h2>{{ t('assinatura.politica.cadastradas') }}</h2>
      <table v-if="q.data.value.regras.length" class="tabela" data-testid="pol-regras">
        <thead>
          <tr>
            <th scope="col">{{ t('assinatura.politica.tipoDocumento') }}</th>
            <th scope="col">{{ t('assinatura.politica.conselho') }}</th>
            <th scope="col">{{ t('assinatura.politica.destino') }}</th>
            <th scope="col">{{ t('assinatura.politica.nivel') }}</th>
            <th scope="col">{{ t('assinatura.politica.formato') }}</th>
            <th scope="col">{{ t('assinatura.politica.alteradaEm') }}</th>
            <th scope="col">{{ t('assinatura.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in q.data.value.regras" :key="r.id" data-testid="pol-regra">
            <td>{{ t(`assinatura.politica.tipos.${r.tipoDocumento}`) }}</td>
            <td>{{ r.conselho ?? t('assinatura.politica.qualquerConselho') }}</td>
            <td>{{ t(`assinatura.destinos.${r.destino}`) }}</td>
            <td>{{ exigido(r) }}</td>
            <td>{{ t(`assinatura.formatos.${r.formato}`) }}</td>
            <td>{{ new Date(r.alteradaEm).toLocaleString('pt-BR') }} · {{ r.alteradaPor }}</td>
            <td>
              <SanteBotao
                v-if="q.data.value.podeEditar"
                :rotulo="t('assinatura.politica.remover')"
                variante="secundario"
                data-testid="pol-remover"
                @acionar="
                  remover = { tipoDocumento: r.tipoDocumento, conselho: r.conselho, destino: r.destino }
                "
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="pol-sem-regras">{{ t('assinatura.politica.nenhumaRegra') }}</p>
      <form v-if="remover" class="bloco" data-testid="pol-remocao" @submit.prevent="confirmarRemocao">
        <p>{{ t('assinatura.politica.removerAjuda') }}</p>
        <SanteCampoTexto
          id="pol-just-remocao"
          v-model="justificativaRemocao"
          :rotulo="t('assinatura.justificativa')"
          :max-bytes="400"
          multilinha
          obrigatorio
        />
        <span class="acoes">
          <SanteBotao
            :rotulo="t('assinatura.politica.confirmarRemocao')"
            tipo="submit"
            :desabilitado="ocupado || justificativaRemocao.trim().length < 10"
          />
          <SanteBotao :rotulo="t('assinatura.cancelar')" variante="texto" @acionar="remover = null" />
        </span>
      </form>

      <h2>{{ t('assinatura.politica.vigente') }}</h2>
      <table class="tabela" data-testid="pol-vigente">
        <thead>
          <tr>
            <th scope="col">{{ t('assinatura.politica.tipoDocumento') }}</th>
            <th scope="col">{{ t('assinatura.politica.destino') }}</th>
            <th scope="col">{{ t('assinatura.politica.nivel') }}</th>
            <th scope="col">{{ t('assinatura.politica.carimbo') }}</th>
            <th scope="col">{{ t('assinatura.politica.origem') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="v in q.data.value.vigente"
            :key="`${v.tipoDocumento}-${v.destino}`"
            :data-testid="`pol-vig-${v.tipoDocumento}-${v.destino}`"
          >
            <td>{{ t(`assinatura.politica.tipos.${v.tipoDocumento}`) }}</td>
            <td>{{ t(`assinatura.destinos.${v.destino}`) }}</td>
            <td>{{ exigido(v.exigencia) }}</td>
            <td>{{ v.exigencia.carimboDoTempo ? t('assinatura.sim') : t('assinatura.nao') }}</td>
            <td>
              {{
                v.exigencia.origem === 'piso-legal'
                  ? t('assinatura.politica.pisoLegal')
                  : t('assinatura.politica.origemRegra')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../estilo-assinatura.css"></style>
