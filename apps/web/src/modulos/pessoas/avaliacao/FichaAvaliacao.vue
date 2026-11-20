<script setup lang="ts">
// Ficha da avaliação de desempenho (W0-06, parte 5d-2): as notas por competência até a escala do ciclo, com o
// comentário, e o parecer (só no rascunho); finalizar (toda competência com nota; a finalizada fica imutável); a ciência
// colhida em papel e registrada pelo RH (como e quando foi colhida); a correção da finalizada por versão nova com a
// justificativa (a anterior continua visível na lista das versões); a exclusão do rascunho com motivo (uma cópia fica
// guardada). As ações vêm do servidor (`acoes`), que confere de novo cada uma.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import {
  cienciaRegistrada,
  corrigirAvaliacao,
  excluirAvaliacao,
  finalizarAvaliacao,
  lancarNotas,
  lerFichaAvaliacao,
} from './api-avaliacao.js';
import {
  type LinhaNota,
  linhasDasNotas,
  notasMudaram,
  notasParaGravar,
  opcoesNota,
  semNota,
} from './avaliacao-comum.js';

/** A avaliação aberta; a correção troca para a versão nova, a exclusão fecha (null). */
const id = defineModel<number | null>('id', { required: true });
const emit = defineEmits<{ gravado: [r: unknown] }>();
const { t } = useI18n();
const ficha = useQuery({
  queryKey: computed(() => ['pessoas', 'avaliacao', 'avaliacao', id.value]),
  queryFn: () => lerFichaAvaliacao(id.value as number),
  enabled: computed(() => typeof id.value === 'number'),
});
const f = computed(() => ficha.data.value ?? null);
const a = computed(() => f.value?.avaliacao ?? null);
const acoes = computed(() => f.value?.acoes ?? null);

const linhas = ref<LinhaNota[]>([]);
const parecer = ref('');
watch(
  f,
  (x) => {
    if (!x) return;
    linhas.value = linhasDasNotas(x.notas);
    parecer.value = x.avaliacao.parecer ?? '';
  },
  { immediate: true },
);
const notas = computed(() => opcoesNota(f.value?.ciclo.notaMax ?? 5, t('pessoas.avaliacao.ficha.semNota')));
const faltam = computed(() => semNota(linhas.value));
const mudou = computed(() =>
  f.value ? notasMudaram(linhas.value, parecer.value, f.value.notas, f.value.avaliacao.parecer) : false,
);

const erro = ref<unknown>(null);
const ocupado = ref(false);
async function executar(fn: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    emit('gravado', await fn());
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const gravarNotas = () =>
  executar(() =>
    lancarNotas({
      avaliacao: a.value!.id,
      versao: a.value!.versao,
      parecer: parecer.value.trim() === '' ? null : parecer.value.trim(),
      notas: notasParaGravar(linhas.value),
    }),
  );
const dialogoFinalizar = ref(false);
async function finalizar(): Promise<void> {
  dialogoFinalizar.value = false;
  await executar(() => finalizarAvaliacao({ avaliacao: a.value!.id, versao: a.value!.versao }));
}

const dialogoCiencia = ref(false);
const registrarCiencia = (observacao: string) =>
  cienciaRegistrada({ avaliacao: a.value!.id, versao: a.value!.versao, observacao });
const dialogoCorrigir = ref(false);
const corrigir = (motivo: string) =>
  corrigirAvaliacao({ avaliacao: a.value!.id, versao: a.value!.versao, motivo });
function aposCorrigir(r: unknown): void {
  emit('gravado', r);
  const novo = (r as { id?: unknown } | null)?.id;
  if (typeof novo === 'number') id.value = novo;
}
const dialogoExcluir = ref(false);
const excluir = (motivo: string) =>
  excluirAvaliacao({ avaliacao: a.value!.id, versao: a.value!.versao, motivo });
function aposExcluir(r: unknown): void {
  emit('gravado', r);
  id.value = null;
}

const quando = (em: string | null) => (em ? `${dataBr(em.slice(0, 10))} ${em.slice(11, 16)}` : '—');
const outras = computed(() => (f.value?.versoes ?? []).filter((v) => v.avaliacao.id !== a.value?.id));
const marco = (m: 45 | 90 | null) => (m === null ? '' : t('pessoas.avaliacao.ficha.marcoTexto', { m }));
</script>

<template>
  <section class="bloco" aria-labelledby="pes-aval-ficha" data-testid="ficha-avaliacao">
    <h2 id="pes-aval-ficha">
      {{ a ? t('pessoas.avaliacao.ficha.titulo', { nome: a.colaborador, numero: a.numero }) : '' }}
    </h2>
    <ErroPessoas v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!f || !a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <dl class="dados">
        <dt>{{ t('pessoas.avaliacao.ficha.ciclo') }}</dt>
        <dd>{{ f.ciclo.nome }} {{ marco(a.marco) }}</dd>
        <dt>{{ t('pessoas.avaliacao.ciclos.avaliador') }}</dt>
        <dd>{{ a.avaliador }}</dd>
        <dt>{{ t('pessoas.avaliacao.ciclos.situacao') }}</dt>
        <dd data-testid="avaliacao-situacao">
          {{ t(`pessoas.avaliacao.situacoesAvaliacao.${a.situacao}`) }}
          <span v-if="a.substituida" class="secundario">({{ t('pessoas.avaliacao.substituida') }})</span>
        </dd>
        <dt>{{ t('pessoas.avaliacao.ciclos.escala') }}</dt>
        <dd>{{ t('pessoas.avaliacao.ciclos.escalaTexto', { max: f.ciclo.notaMax }) }}</dd>
        <template v-if="a.motivoCorrecao">
          <dt>{{ t('pessoas.avaliacao.ficha.motivoCorrecao') }}</dt>
          <dd data-testid="avaliacao-motivo-correcao">{{ a.motivoCorrecao }}</dd>
        </template>
        <template v-if="a.finalizadaEm">
          <dt>{{ t('pessoas.avaliacao.ficha.finalizada') }}</dt>
          <dd>
            {{ t('pessoas.avaliacao.ficha.porEm', { por: a.finalizadaPor, em: quando(a.finalizadaEm) }) }}
          </dd>
        </template>
        <template v-if="a.cienciaEm">
          <dt>{{ t('pessoas.avaliacao.ficha.ciencia') }}</dt>
          <dd data-testid="avaliacao-ciencia">
            {{ t('pessoas.avaliacao.ficha.porEm', { por: a.cienciaPor, em: quando(a.cienciaEm) }) }}
            · {{ t(`pessoas.avaliacao.ficha.modos.${a.cienciaModo ?? 'proprio'}`) }}
            <div v-if="a.cienciaObs" class="secundario">{{ a.cienciaObs }}</div>
          </dd>
        </template>
      </dl>
      <ErroPessoas v-if="erro" :erro="erro" />

      <form class="bloco" data-testid="form-notas" @submit.prevent="gravarNotas">
        <h3>{{ t('pessoas.avaliacao.ficha.notas') }}</h3>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('pessoas.avaliacao.competencias.nome') }}</th>
              <th scope="col">{{ t('pessoas.avaliacao.ficha.nota') }}</th>
              <th scope="col">{{ t('pessoas.avaliacao.ficha.comentario') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in linhas" :key="l.competencia" :data-testid="`nota-${l.competencia}`">
              <th scope="row">{{ l.nome }}</th>
              <td>
                <SanteSelecao
                  v-model="l.nota"
                  :rotulo="t('pessoas.avaliacao.ficha.notaDe', { nome: l.nome })"
                  ocultar-rotulo
                  :opcoes="notas"
                  :desabilitado="!acoes?.lancar"
                  :data-testid="`nota-${l.competencia}-valor`"
                />
              </td>
              <td>
                <SanteCampoTexto
                  v-if="acoes?.lancar"
                  v-model="l.comentario"
                  :rotulo="t('pessoas.avaliacao.ficha.comentarioDe', { nome: l.nome })"
                  :max-bytes="1000"
                  :data-testid="`nota-${l.competencia}-comentario`"
                />
                <span v-else>{{ l.comentario || '—' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <SanteCampoTexto
          v-if="acoes?.lancar"
          v-model="parecer"
          :rotulo="t('pessoas.avaliacao.ficha.parecer')"
          :max-bytes="2000"
          multilinha
          data-testid="avaliacao-parecer"
        />
        <template v-else-if="a.parecer">
          <h4>{{ t('pessoas.avaliacao.ficha.parecer') }}</h4>
          <p data-testid="avaliacao-parecer-lido">{{ a.parecer }}</p>
        </template>
        <SanteAlerta
          v-if="acoes?.finalizar && faltam > 0"
          :texto="t('pessoas.avaliacao.ficha.faltam', { n: faltam })"
          variante="info"
        />
        <SanteAlerta
          v-if="acoes?.finalizar && mudou"
          :texto="t('pessoas.avaliacao.ficha.graveAntes')"
          variante="info"
        />
        <div class="acoes">
          <SanteBotao
            v-if="acoes?.lancar"
            :rotulo="t('pessoas.avaliacao.ficha.gravarNotas')"
            tipo="submit"
            :desabilitado="ocupado || !mudou"
            data-testid="gravar-notas"
          />
          <SanteBotao
            v-if="acoes?.finalizar"
            :rotulo="t('pessoas.avaliacao.ficha.finalizar')"
            variante="secundario"
            :desabilitado="ocupado || mudou || faltam > 0"
            data-testid="finalizar-avaliacao"
            @acionar="dialogoFinalizar = true"
          />
          <SanteBotao
            v-if="acoes?.cienciaRegistrada"
            :rotulo="t('pessoas.avaliacao.ficha.registrarCiencia')"
            variante="secundario"
            data-testid="registrar-ciencia"
            @acionar="dialogoCiencia = true"
          />
          <SanteBotao
            v-if="acoes?.corrigir"
            :rotulo="t('pessoas.avaliacao.ficha.corrigir')"
            variante="secundario"
            data-testid="corrigir-avaliacao"
            @acionar="dialogoCorrigir = true"
          />
          <SanteBotao
            v-if="acoes?.excluir"
            :rotulo="t('pessoas.avaliacao.ficha.excluirRascunho')"
            variante="texto"
            data-testid="excluir-avaliacao"
            @acionar="dialogoExcluir = true"
          />
          <SanteBotao :rotulo="t('pessoas.avaliacao.fechar')" variante="texto" @acionar="id = null" />
        </div>
      </form>

      <section class="bloco" data-testid="avaliacao-versoes">
        <h3>{{ t('pessoas.avaliacao.ficha.versoes') }}</h3>
        <p v-if="outras.length === 0" class="secundario">{{ t('pessoas.avaliacao.ficha.semVersoes') }}</p>
        <ul v-else>
          <li
            v-for="v in outras"
            :key="v.avaliacao.id"
            :data-testid="`avaliacao-versao-${v.avaliacao.numero}`"
          >
            {{
              t('pessoas.avaliacao.ficha.versaoLinha', {
                numero: v.avaliacao.numero,
                situacao: t(`pessoas.avaliacao.situacoesAvaliacao.${v.avaliacao.situacao}`),
                em: quando(v.avaliacao.finalizadaEm ?? v.avaliacao.criadoEm),
              })
            }}
            <span v-if="v.avaliacao.substituida" class="secundario"
              >({{ t('pessoas.avaliacao.substituida') }})</span
            >
            <div v-if="v.avaliacao.motivoCorrecao" class="secundario">{{ v.avaliacao.motivoCorrecao }}</div>
            <ul class="secundario">
              <li v-for="n in v.notas" :key="n.competencia">
                {{ t('pessoas.avaliacao.ficha.notaLinha', { nome: n.nome, nota: n.nota ?? '—' }) }}
              </li>
            </ul>
            <SanteBotao
              :rotulo="t('pessoas.avaliacao.ficha.verVersao', { numero: v.avaliacao.numero })"
              variante="texto"
              :data-testid="`ver-versao-${v.avaliacao.numero}`"
              @acionar="id = v.avaliacao.id"
            />
          </li>
        </ul>
      </section>
    </template>

    <SanteDialogo v-model:visivel="dialogoFinalizar" :titulo="t('pessoas.avaliacao.ficha.finalizar')">
      <div class="bloco" data-testid="dialogo-finalizar">
        <p>{{ t('pessoas.avaliacao.ficha.finalizarTexto') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.avaliacao.ficha.finalizar')"
            :desabilitado="ocupado"
            data-testid="dialogo-finalizar-confirmar"
            @acionar="finalizar"
          />
          <SanteBotao
            :rotulo="t('pessoas.avaliacao.fechar')"
            variante="texto"
            @acionar="dialogoFinalizar = false"
          />
        </div>
      </div>
    </SanteDialogo>
    <DialogoMotivo
      v-model:visivel="dialogoCiencia"
      :titulo="t('pessoas.avaliacao.ficha.registrarCiencia')"
      :texto="t('pessoas.avaliacao.ficha.cienciaTexto')"
      :confirmar="t('pessoas.avaliacao.ficha.registrarCiencia')"
      variante="primario"
      :acao="registrarCiencia"
      testid="dialogo-ciencia"
      @feito="emit('gravado', $event)"
    />
    <DialogoMotivo
      v-model:visivel="dialogoCorrigir"
      :titulo="t('pessoas.avaliacao.ficha.corrigir')"
      :texto="t('pessoas.avaliacao.ficha.corrigirTexto')"
      :confirmar="t('pessoas.avaliacao.ficha.corrigir')"
      variante="primario"
      :acao="corrigir"
      testid="dialogo-corrigir-avaliacao"
      @feito="aposCorrigir"
    />
    <DialogoMotivo
      v-model:visivel="dialogoExcluir"
      :titulo="t('pessoas.avaliacao.ficha.excluirRascunho')"
      :texto="t('pessoas.avaliacao.ficha.excluirTexto')"
      :confirmar="t('pessoas.avaliacao.excluir')"
      :acao="excluir"
      testid="dialogo-excluir-avaliacao"
      @feito="aposExcluir"
    />
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
